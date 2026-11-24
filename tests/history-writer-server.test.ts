// 서버와 기록 작업 스레드: 연속 3번 죽으면 /api/health db가 false이고 그 뒤 집을 바꿔도 집이 열린다,
// srv.settle()이 남은 기록 쓰기를 기다린다, srv.close()가 남은 쓰기를 커밋한다.
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { Worker } from "node:worker_threads";
import { afterEach, describe, expect, it, vi } from "vitest";
import { startFakeOpenAI, type FakeServer } from "../scripts/fake-openai.js";
import { HistoryDb } from "../src/brain/history/db.js";
import type { HealthView } from "../src/contract/events.js";
import type { PlanView } from "../src/contract/plan.js";
import { fetchRetry } from "../src/shared/net.js";
import { startServer, type RunningServer } from "../src/server/start.js";
import { ScriptedDetector } from "./helpers/detectors.js";
import { startFakePamLlm, pamLlmEnv, type FakePamLlm } from "./helpers/pam.js";

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

const docPlan = (): PlanView => {
  const md = readFileSync(new URL("../docs/plan-contract.md", import.meta.url), "utf8");
  return JSON.parse(/```json\r?\n([\s\S]*?)```/.exec(md)![1]!).plan as PlanView;
};

describe("서버와 기록 작업 스레드", () => {
  it("작업 스레드가 연속 3번 죽으면 /api/health db가 false이고, 그 뒤 다른 집으로 바꿔도 집이 열린다", async () => {
    fake = await startFakeOpenAI();
    pam = await startFakePamLlm();
    const workers: Worker[] = [];
    const logs: string[] = [];
    srv = await startServer({
      env: { HUB: "memory", PORT: "0", RUNTIME_DIR: mkdtempSync(join(tmpdir(), "rt-")), REFLECT_AT: "off", PHONE_PORT: "0", PHONE_HOST: "127.0.0.1", BRAIN: "1",
        VLM_BASE_URL: `${fake.url}/v1`, ...pamLlmEnv(pam), OPENAI_API_KEY: "fake-key", OPENAI_BASE_URL: `${fake.url}/v1` },
      brain: { detector: new ScriptedDetector(() => []) }, log: (l) => logs.push(l), onHistoryWorker: (w) => workers.push(w),
    });
    for (let k = 0; k < 3; k++) {
      await vi.waitFor(() => expect(workers.length).toBeGreaterThan(k), { timeout: 8000 });
      await workers[k]!.terminate();
    }
    await vi.waitFor(() => expect(srv!.historyWriter.writable()).toBe(false), { timeout: 8000 });
    const health = (await (await fetchRetry(`${srv.url}/api/health`)).json()) as HealthView;
    expect(health.ready.db).toBe(false);
    const from = srv.twin.home.id;
    const to = from === "oneroom" ? "apartment" : "oneroom";
    await srv.switchHome(to);
    expect(srv.twin.home.id).toBe(to);
  }, 60_000);

  it("srv.settle()이 남은 기록 쓰기가 커밋될 때까지 기다린다", async () => {
    const runtime = mkdtempSync(join(tmpdir(), "rt-"));
    srv = await startServer({ env: { HUB: "memory", PORT: "0", HOME_ID: "oneroom", RUNTIME_DIR: runtime, REFLECT_AT: "off" }, log: () => {} });
    // 다른 연결이 쓰기 잠금을 잡고 있는 동안 계획을 받는다(계획 줄 쓰기가 기다린다)
    const blocker = new DatabaseSync(join(runtime, "noonchi.db"));
    blocker.exec("PRAGMA busy_timeout = 5000; BEGIN IMMEDIATE");
    const release = setTimeout(() => blocker.exec("ROLLBACK"), 300);
    try {
      const r = await fetchRetry(`${srv.url}/api/plan`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ plan: docPlan() }) });
      expect(r.status).toBe(200);
      expect(await srv.settle(5000)).toBe(true);
      expect(srv.history.list({ kinds: ["plan"] }).map((row) => row.subject)).toEqual(["cup-1"]);
    } finally {
      clearTimeout(release);
      try { blocker.exec("ROLLBACK"); } catch { /* 이미 풀림 */ }
      blocker.close();
    }
  });

  it("srv.close()가 아직 커밋하지 않은 쓰기를 커밋하고 닫는다", async () => {
    const runtime = mkdtempSync(join(tmpdir(), "rt-"));
    srv = await startServer({ env: { HUB: "memory", PORT: "0", HOME_ID: "oneroom", RUNTIME_DIR: runtime, REFLECT_AT: "off" }, log: () => {} });
    const writes = Array.from({ length: 50 }, (_, i) => srv!.historyWriter.add("execution", i, `일 ${i}`, { subject: `c-${i}` }));
    await srv.close();
    srv = undefined;
    await expect(Promise.all(writes)).resolves.toHaveLength(50);
    const db = HistoryDb.open(join(runtime, "noonchi.db"), 540, { readOnly: true });
    try {
      expect(db.list({ kinds: ["execution"] })).toHaveLength(50);
    } finally {
      db.close();
    }
  });
});
