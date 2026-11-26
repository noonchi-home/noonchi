// 밤 반성(src/brain/history/night.ts runNight)을 서버에서 돌릴 때:
// 1) 큰 하루 기록(12,000줄)을 반성하는 동안 메인 스레드 최대 막힘(monitorEventLoopDelay max)이 한도 안이다.
// 2) 같은 기록이면 서버 반성과 같은 스레드 반성(runReflection을 그 연결에서 바로)이 같은 기억 판본·정책·반성 기록을 낸다.
// 잰 값은 DB_LOAD_OUT 파일이 있으면 한 줄 JSON으로 더한다.
import { appendFileSync, copyFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { monitorEventLoopDelay, performance } from "node:perf_hooks";
import type { Worker } from "node:worker_threads";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CUP_FSM_MEMORY } from "../src/brain/decision.js";
import { HistoryDb } from "../src/brain/history/db.js";
import { runReflection } from "../src/brain/history/reflect.js";
import { REFLECT_TEXT } from "../src/brain/history/labels.js";
import { nightSave } from "../src/brain/history/night.js";
import { reflectInThread, type NightHooks } from "../src/brain/history/night-host.js";
import { candidateFsmOf } from "../src/brain/pam/adopt.js";
import type { CandidateFsm } from "../src/contract/pam.js";
import { fetchRetry } from "../src/shared/net.js";
import { startServer, type RunningServer } from "../src/server/start.js";
import { pamClientFor, pamLlmEnv, startFakePamLlm, type FakePamLlm, type MarkView } from "./helpers/pam.js";

const DAY = "2026-10-01";
const LEAVE_ON = "사용자가 먹거나 마시기를 끝내고 다른 일로 넘어간다.";
/** 한도: 메인 스레드에서 반성하던 코드(perf/db-writer-thread 8cfae802)는 이 PC에서 3번 최대 297.8~314.3ms, 반성 0.64~0.73초였다.
 *  반성 작업 스레드로 옮긴 뒤는 최대 20ms대(처음 반성은 작업 스레드를 띄우느라 2초쯤 더 걸린다). */
const LIMIT = { maxMs: 60 };

const at = (time: string) => Date.parse(`${DAY}T${time}+09:00`);
const CANDIDATES: CandidateFsm = (() => {
  const c = candidateFsmOf(CUP_FSM_MEMORY);
  c.states.find((s) => s.id === "drinking")!.rules.push({ to: "*", action: "컵 치우기", candidates: [{ on: LEAVE_ON }] });
  return c;
})();
const fakePam = () => startFakePamLlm({
  reflect: () => CANDIDATES,
  check: () => ({ ok: true, items: [] }),
  mark: (v: MarkView) => ({
    candidates: v.candidates.map(([state, candidate]) => ({ state, candidate, times: v.lines.some((l) => l.startsWith("08:00:00")) ? ["08:00:00"] : [] })),
    actions: v.actions.map((action) => ({ action, times: [] })), unseen: [],
  }),
});

/** 하루 기록 n줄: 2.5초마다 VLM 관찰(물건 상자 포함)·World State 변화·등장·판단·가전 줄, 그리고 마시다 떠나 「치워 주세요」로 답한 장면 3번. */
function fillDay(db: HistoryDb, n: number): void {
  db.tx(() => {
    const start = at("07:00:00");
    for (let k = 0; k < n; k++) {
      const t = start + k * 2500;
      const r = k % 20;
      if (r < 12) {
        db.add("vlm", t, `식탁 위 컵 ${k % 3}개, 사람 의자에 앉음`, { subject: `f-${k}`, data: {
          captured_at_ms: t - 300, missing: null, scene: { household: { seats: "clear", people: [{ id: "p1", attention: "elsewhere" }], dining_food: "no" } },
          dets: Array.from({ length: 4 }, (_, j) => ({ id: `d${j}`, cls: j ? "cup" : "person", box: { x: 0.1 * j, y: 0.2, w: 0.1, h: 0.2 }, score: 0.9 })),
        } });
      } else if (r < 16) db.add("world", t, `컵 ${k % 3} 식탁 위에 있음`, { data: { kind: "object_state", observed_ms: t - 300 } });
      else if (r === 16) db.add("detection", t, k % 40 === 16 ? "사람 보임" : "사람 안 보임", { data: { kind: k % 40 === 16 ? "person_appeared" : "person_gone" } });
      else if (r === 17) db.add("decision", t, "대기", { subject: `pam-${k}`, data: { seq: k, status: "valid", prediction: { observation: "o", reasoning: "r", task_index: -1 }, memory_version: 1,
        world: { objects: [], person_visible: true, vlm_missing: 0, yolo_missing: 0 }, fsm: { state: "drinking", from: null, next_index: -1, to: null, on: null, when: null, action: null, learned: false } } });
      else if (r === 18) db.add("device", t, "거실 에어컨 켜짐", { subject: "ac_1", data: { attr: "power", from: false, to: true } });
      else db.add("execution", t, "실행 중", { subject: `plan:pam-${k}`, data: { state: "running" } });
    }
    let n2 = 0;
    for (const [leave, answer] of [["08:00:00", "08:01:30"], ["10:00:00", "10:01:30"], ["12:00:00", "12:01:30"]] as const) {
      const id = `ep-${++n2}`;
      db.add("world", at(leave) - 4000, "사람 마시는 중");
      db.add("decision", at(leave), "사용자에게 물어보기", { subject: id, data: { fsm: { state: "away", from: "drinking", next_index: 0, to: "*", on: LEAVE_ON, when: null, action: "사용자에게 물어보기", learned: false } } });
      db.add("feedback", at(answer), "치워 주세요 · 질문: 컵을 치울까요?", { subject: `plan:${id}`, data: { choice: "clear", via: "button" } });
      db.add("decision", at(answer), "컵 치우기", { subject: `say-${n2}`, data: { source: "speech", via: "answer" } });
    }
  });
}

/** 반성이 남기는 것(시각·만든 시각은 뺀다). */
function saved(db: HistoryDb) {
  const all = (sql: string) => db.db.prepare(sql).all();
  return {
    memories: all("SELECT version, kind, memory, applies_day, day, source FROM memories ORDER BY version"),
    pins: all("SELECT key, value FROM meta WHERE key LIKE 'memory_day:%' ORDER BY key"),
    policy: all("SELECT * FROM intervention_policy ORDER BY home, user, action, context, applies_day, version"),
    beer: all("SELECT * FROM beer_rules ORDER BY version"),
    nights: all("SELECT * FROM assistance_nights ORDER BY day"),
    reflections: all("SELECT day, text, data FROM events WHERE kind = 'reflection' ORDER BY id"),
  };
}

let srv: RunningServer | undefined;
let pam: FakePamLlm | undefined;
afterEach(async () => {
  await srv?.close();
  srv = undefined;
  await pam?.close();
  pam = undefined;
});

/** 직접 반성(pamClientFor)과 같은 PAM 설정(vllm 표)으로 서버를 띄운다. */
const serve = async (runtime: string) => {
  srv = await startServer({ env: { HUB: "memory", PORT: "0", RUNTIME_DIR: runtime, REFLECT_AT: "off", INFERENCE_MODE: "vllm", ...pamLlmEnv(pam!) }, log: () => {} });
  return srv;
};
const reflectOn = async (s: RunningServer) => {
  const r = await fetchRetry(`${s.url}/api/reflection/run`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ day: DAY }) });
  return { status: r.status, json: (await r.json()) as Record<string, unknown> };
};

/** 작은 하루 기록 파일. */
function smallDay(): string {
  const path = join(mkdtempSync(join(tmpdir(), "rt-night-")), "noonchi.db");
  const db = HistoryDb.open(path);
  fillDay(db, 200);
  db.close();
  return path;
}

/** 서버 없이 반성 작업 스레드로 반성한다(저장은 시험이 연 쓰기 연결로). */
async function threadReflect(path: string, hooks: Partial<NightHooks> = {}) {
  const w = HistoryDb.open(path);
  try {
    return await reflectInThread({ path, offsetMinutes: 540, day: DAY, env: { INFERENCE_MODE: "vllm", ...pamLlmEnv(pam!) } }, {
      store: { add: (k, t, x, o) => w.add(k, t, x, o), saveNight: (a) => nightSave(w, a) }, now: () => Date.now(), ...hooks,
    });
  } finally {
    w.close();
  }
}

describe("반성 작업 스레드의 LLM 요청", () => {
  it("LLM 요청 하나가 EFAULT로 실패해도 반성 스레드가 다시 시도해 그날 반성을 마친다", async () => {
    pam = await fakePam();
    let calls = 0;
    const flaky = (async (url, init) => {
      if (calls++ === 0) throw new TypeError("fetch failed", { cause: Object.assign(new Error("connect EFAULT 127.0.0.1"), { code: "EFAULT", syscall: "connect" }) });
      return fetch(url, init);
    }) as typeof fetch;
    const r = await threadReflect(smallDay(), { fetch: flaky });
    expect(r).toMatchObject({ ok: true });
    expect(calls).toBeGreaterThan(1);
  }, 60_000);

  it("이미 끊긴 신호로 부르면 취소 결과이고 메인 LLM 요청은 0번이다", async () => {
    pam = await fakePam();
    let calls = 0;
    const counted = ((url, init) => { calls++; return fetch(url, init); }) as typeof fetch;
    const ac = new AbortController();
    ac.abort();
    expect(await threadReflect(smallDay(), { signal: ac.signal, fetch: counted })).toEqual({ ok: false, error: REFLECT_TEXT.cancelled });
    expect(calls).toBe(0);
  }, 60_000);

  it("반성 작업 스레드가 죽으면 진행 중인 메인 LLM 요청을 끊고 반성은 실패로 돌아온다", async () => {
    pam = await fakePam();
    let seen: AbortSignal | undefined;
    const workers: Worker[] = [];
    const hang = ((_url, init) => {
      seen = init?.signal ?? undefined;
      return new Promise<Response>((_, reject) => init?.signal?.addEventListener("abort", () => reject(new Error("끊김"))));
    }) as typeof fetch;
    const run = threadReflect(smallDay(), { fetch: hang, onWorker: (w) => workers.push(w) });
    run.catch(() => {});
    await vi.waitFor(() => expect(seen).toBeDefined(), { timeout: 20_000 });
    await workers.at(-1)!.terminate();
    await expect(run).rejects.toThrow(/반성 작업 스레드가 끝났어요/);
    expect(seen!.aborted).toBe(true);
  }, 60_000);
});

describe("밤 반성과 메인 스레드", () => {
  it("큰 하루 기록(12,000줄)을 서버가 반성하는 동안 메인 스레드 최대 막힘이 한도 안이다", async () => {
    pam = await fakePam();
    const runtime = mkdtempSync(join(tmpdir(), "rt-night-"));
    const db = HistoryDb.open(join(runtime, "noonchi.db"));
    fillDay(db, 12_000);
    db.close();
    const s = await serve(runtime);
    await s.settle(5000);
    // 반성 요청을 보내고 답을 받을 때까지만 잰다
    const delay = monitorEventLoopDelay({ resolution: 1 });
    delay.enable();
    const t0 = performance.now();
    const r = await reflectOn(s).finally(() => delay.disable());
    const elapsedMs = Math.round(performance.now() - t0);
    expect(r).toMatchObject({ status: 200, json: { ok: true, day: DAY } });
    const result = { what: "night", maxMs: Math.round(delay.max / 1e5) / 10, p99Ms: Math.round(delay.percentile(99) / 1e5) / 10, elapsedMs };
    if (process.env.DB_LOAD_OUT) appendFileSync(process.env.DB_LOAD_OUT, JSON.stringify(result) + "\n");
    console.log("[밤 반성]", JSON.stringify(result));
    expect(result.maxMs).toBeLessThan(LIMIT.maxMs);
  }, 180_000);

  it("같은 기록이면 서버 반성과 같은 스레드 반성이 같은 기억 판본·정책·반성 기록을 낸다", async () => {
    pam = await fakePam();
    const runtime = mkdtempSync(join(tmpdir(), "rt-night-"));
    const path = join(runtime, "noonchi.db");
    const db = HistoryDb.open(path);
    fillDay(db, 2_000);
    db.close();
    const directPath = join(mkdtempSync(join(tmpdir(), "night-direct-")), "noonchi.db");
    copyFileSync(path, directPath);
    // 같은 스레드에서 그 연결로 바로 반성한다
    const direct = HistoryDb.open(directPath);
    const want = await runReflection(direct, pamClientFor(pam), DAY, { dir: mkdtempSync(join(tmpdir(), "habit-")) });
    const wantSaved = saved(direct);
    direct.close();
    expect(want).toMatchObject({ ok: true });
    // 서버로 반성한다
    const got = await reflectOn(await serve(runtime));
    expect(got.status).toBe(200);
    const { version, appliesDay } = want as { version: number; appliesDay: string };
    expect(got.json).toMatchObject({ ok: true, day: DAY, version, appliesDay });
    await srv!.historyWriter.flush();
    expect(saved(srv!.history)).toEqual(wantSaved);
    expect(wantSaved.memories.length).toBeGreaterThan(0);
  }, 180_000);
});
