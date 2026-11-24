// 기록 DB 쓰기 부하: 실제 서버 구성(startServer, BRAIN=1·폰 포트라 버스 노드가 다 뜬다, 기록 노드, RUNTIME_DIR/noonchi.db)에 기록 노드만 받는 RELIABLE 메시지 2,000건을
// 다섯 토픽에 400건씩 몰아 보내고, 다 ack될 때까지 메인 스레드 지연(monitorEventLoopDelay p99)과 사용률(eventLoopUtilization)을 잰다.
// 커밋 수는 메인 스레드 DatabaseSync.exec("COMMIT") 수와 기록 작업 스레드가 센 커밋 수를 더한다(synchronous = FULL이라 커밋마다 WAL fsync 한 번).
// 잰 값은 DB_LOAD_OUT 파일이 있으면 한 줄 JSON으로 더한다.
import { appendFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { monitorEventLoopDelay, performance } from "node:perf_hooks";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { BusNode, MemoryBus } from "../src/bus/index.js";
import { startServer, type RunningServer } from "../src/server/start.js";
import { startFakeOpenAI, type FakeServer } from "../scripts/fake-openai.js";
import { ScriptedDetector } from "./helpers/detectors.js";
import { startFakePamLlm, pamLlmEnv, type FakePamLlm } from "./helpers/pam.js";

const TOTAL = 2000;
const TOPICS = ["/act/log", "/robot/changes", "/safety/changes", "/brain/person_changes", "/manager/changes"] as const;
/** 한도: 메인 스레드에서 메시지마다 FULL 커밋하던 코드(main 365f0353)는 이 PC에서 3번 p99 21.3~23.3ms, 사용률 1.0, 4.0~4.5초, 커밋 2,000번이었다.
 *  기록 작업 스레드로 옮긴 뒤는 p99 6.5~10.3ms, 사용률 0.27~0.31, 1.4~2.1초, 커밋 400번(모두 작업 스레드). */
const LIMIT = { p99Ms: 15, elu: 0.6 };
/** 기록 줄 시각: 서버가 스스로 남기는 줄과 섞이지 않게 먼 날로 둔다. */
const BASE_MS = Date.parse("2099-01-01T00:00:00Z");

let srv: RunningServer | undefined;
let fake: FakeServer | undefined;
let pam: FakePamLlm | undefined;
afterEach(async () => {
  await srv?.close();
  srv = undefined;
  await fake?.close();
  fake = undefined;
  await pam?.close();
  pam = undefined;
});

const report = (v: unknown) => { if (process.env.DB_LOAD_OUT) appendFileSync(process.env.DB_LOAD_OUT, JSON.stringify(v) + "\n"); };

describe("기록 DB 쓰기 부하", () => {
  it("RELIABLE 2,000건을 몰아 받는 동안 메인 스레드 p99 지연과 사용률이 한도 안이다", async () => {
    const bus = new MemoryBus({ warn: () => {} });
    let boot = "";
    const runtime = mkdtempSync(join(tmpdir(), "rt-load-"));
    fake = await startFakeOpenAI();
    pam = await startFakePamLlm();
    srv = await startServer({
      env: { HUB: "memory", PORT: "0", RUNTIME_DIR: runtime, REFLECT_AT: "off", PHONE_PORT: "0", PHONE_HOST: "127.0.0.1", BRAIN: "1",
        VLM_BASE_URL: `${fake.url}/v1`, ...pamLlmEnv(pam), OPENAI_API_KEY: "fake-key", OPENAI_BASE_URL: `${fake.url}/v1` },
      brain: { detector: new ScriptedDetector(() => []) }, log: () => {}, openBus: async (_env, o) => { boot = o.boot; return bus; },
    });
    await srv.settle(5000);
    // 첫 집의 세대는 <집 id>#1이다(src/server/start.ts epochOf)
    const epoch = { boot, home: `${srv.twin.home.id}#1` };
    const node = (name: "act" | "brain" | "manager") => new BusNode({ name, bus, epoch, log: () => {} });
    const act = node("act"), brain = node("brain"), manager = node("manager");
    const send = (i: number): Promise<void> => {
      const at = BASE_MS + i;
      switch (TOPICS[i % TOPICS.length]) {
        case "/act/log": return act.publish("/act/log", { type: "execution", at_ms: at, plan_id: `load-${i}`, state: "running", text: `부하 ${i}` });
        case "/robot/changes": return act.publish("/robot/changes", { state: "idle", since_ms: at, step: null });
        case "/safety/changes": return act.publish("/safety/changes", { state: "normal", since_ms: at, fall: false, hot: [], notices: [] });
        case "/brain/person_changes": return brain.publish("/brain/person_changes", { type: "person", state: "load", name: "부하", source: "world", decision_id: null, since_ms: at });
        default: return manager.publish("/manager/changes", { owner: "idle", mode: "noonchi", since_ms: at, tasks: [] });
      }
    };

    // 메인 스레드 커밋 수(지금 코드의 기록 노드는 메시지마다 여기서 커밋한다)
    let mainCommits = 0;
    const exec = DatabaseSync.prototype.exec;
    DatabaseSync.prototype.exec = function (this: DatabaseSync, sql: string) {
      if (/^\s*COMMIT\b/i.test(sql)) mainCommits++;
      return exec.call(this, sql);
    };
    const writer = (srv as unknown as { historyWriter?: { stats(): Promise<{ commits: number }> } }).historyWriter;
    const before = (await writer?.stats())?.commits ?? 0;
    const delay = monitorEventLoopDelay({ resolution: 1 });
    let elapsedMs: number, elu: number;
    try {
      delay.enable();
      const elu0 = performance.eventLoopUtilization();
      const t0 = performance.now();
      // 20건씩 한 차례에 보낸다(보내는 쪽이 한 번에 메인 스레드를 오래 잡지 않게)
      for (let i = 0; i < TOTAL; i += 20) {
        await Promise.all(Array.from({ length: Math.min(20, TOTAL - i) }, (_, k) => send(i + k)));
        await new Promise((r) => setImmediate(r));
      }
      while (TOPICS.some((t) => bus.length(t) > 0)) await new Promise((r) => setTimeout(r, 5));
      elapsedMs = performance.now() - t0;
      elu = performance.eventLoopUtilization(elu0).utilization;
      delay.disable();
    } finally {
      DatabaseSync.prototype.exec = exec;
    }
    const commits = mainCommits + ((await writer?.stats())?.commits ?? 0) - before;
    const p99Ms = delay.percentile(99) / 1e6;
    const result = { p99Ms: Math.round(p99Ms * 10) / 10, maxMs: Math.round(delay.max / 1e5) / 10, elu: Math.round(elu * 1000) / 1000, elapsedMs: Math.round(elapsedMs), commits, mainCommits };
    report(result);
    console.log("[기록 부하]", JSON.stringify(result));

    // 2,000건이 모두 한 줄씩 남았다
    expect(srv.history.list({ since: BASE_MS, limit: TOTAL * 2 })).toHaveLength(TOTAL);
    expect(p99Ms).toBeLessThan(LIMIT.p99Ms);
    expect(elu).toBeLessThan(LIMIT.elu);
    // 메인 스레드는 noonchi.db에 커밋하지 않고, 작업 스레드는 여러 토픽의 메시지를 한 커밋에 묶는다
    expect(mainCommits).toBe(0);
    expect(commits).toBeLessThan(TOTAL / 2);
  }, 180_000);
});
