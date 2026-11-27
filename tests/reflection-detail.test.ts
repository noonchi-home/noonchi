// 반성 하나 읽기(src/brain/history/reflection-detail.ts, GET /api/reflection/:day): 화면이 단계마다 쓰는 자료.
// 채택 검사 숫자는 싣고, 모델이 쓴 글·p0·base_rate는 내보내지 않는다. 새 판본 그림(after_graph)으로 빠진 배운 화살표도 보인다.
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ASK_ACTION } from "../src/act/tasks.js";
import { CUP_FSM_MEMORY, type FsmMemory } from "../src/brain/decision.js";
import { HistoryDb, addDays } from "../src/brain/history/db.js";
import { nightSave } from "../src/brain/history/night.js";
import { reflectionDetail } from "../src/brain/history/reflection-detail.js";
import { fetchRetry } from "../src/shared/net.js";
import { startServer, type RunningServer } from "../src/server/start.js";
import { pamLlmEnv, startFakePamLlm, type FakePamLlm } from "./helpers/pam.js";

const DAY = "2026-11-27";
const ask = CUP_FSM_MEMORY.states.find((s) => s.id === "drinking")!.next.find((e) => e.action === ASK_ACTION)!;
const learnedMemory: FsmMemory = { ...CUP_FSM_MEMORY, states: CUP_FSM_MEMORY.states.map((s) => s.id !== "drinking" ? s : { ...s, next: s.next.map((e) => e === ask ? { ...e, action: "컵 치우기" } : e) }) };
const check = (o: Record<string, unknown>) => ({ state: "drinking", action: "컵 치우기", to: ask.to, on: ask.on, when: null, n: 2, k: 2, unknown: 0, rate: 1, base_rate: 0, p0: 0.01, p_value: 0.0001, passed: true, moments: [], ...o });

function saved(): HistoryDb {
  const db = HistoryDb.open(":memory:");
  const at = Date.parse(`${DAY}T15:03:00+09:00`);
  nightSave(db, {
    day: DAY, appliesDay: "2026-11-28", robot: learnedMemory, candidates: { initial_state: "away", states: [] }, atMs: at, learnedCount: 1, used: {},
    found: {
      learned: [{ from: "drinking", to: ask.to, on: ask.on, when: null, action: "컵 치우기" }], active: [], rejected: null,
      dropped: [{ from: "cooking", to: "cooking", on: "모델 글", action: "라면 끓이기 알려 주기", kept: false, reason: "coach" }],
      chunks: [{ start: "08:10:00", end: "08:24:30", state: "drinking", room: "kitchen" }],
      did: [{ action: "컵 치우기", at: "14:41:10", via: "person" }],
      checks: [
        check({ moments: [{ day: DAY, at: "14:40:20", verdict: "followed", action_at: "14:41:10", via: "person" }] }),
        check({ on: "모델 글 둘", n: 3, k: 1, rate: 1 / 3, p_value: 0.0297, passed: false }),
        check({ state: "watching_tv", to: "watching_tv", action: "에어컨 켜기", on: "모델 글 셋", n: 1, k: 1, p_value: 0.01, passed: false }),
      ],
    },
  });
  db.add("reflection", Date.parse("2026-11-26T23:30:00+09:00"), "반성 기억 안 씀: 모델 까닭", { data: { day: "2026-11-26", ok: false, version: null, applies_day: null, rejected: "모델 까닭" } });
  return db;
}

describe("반성 하나 읽기", () => {
  it("성공한 밤: 전·후 판본, 그날 FSM 그림, 새 판본 그림, 덩어리, 한 일, 뺀 후보, 채택 기준, 배운 화살표의 전 행동을 준다", () => {
    const d = reflectionDetail(saved(), DAY);
    expect(d).toMatchObject({ ok: true, day: DAY, state: "done", rejected: false, before: { version: 1 }, after: { version: 2, applies_day: "2026-11-28" }, window_s: 300, rate_min: 0.75, alpha: 0.001, skipped_to: null });
    expect(d.graph.states).toEqual(CUP_FSM_MEMORY.states.map((s) => s.id));
    expect(d.graph.edges).toContainEqual({ from: "drinking", to: "*", action: ASK_ACTION });
    expect(d.graph.edges).toContainEqual({ from: "away", to: "drinking", action: null });
    expect(d.after_graph?.edges).toContainEqual({ from: "drinking", to: "*", action: "컵 치우기" });
    expect(d.after_graph?.edges).not.toContainEqual({ from: "drinking", to: "*", action: ASK_ACTION });
    expect(d.chunks).toEqual([{ start: "08:10:00", end: "08:24:30", state: "drinking", room: "kitchen" }]);
    expect(d.did).toEqual([{ action: "컵 치우기", at: "14:41:10", via: "person" }]);
    expect(d.dropped).toEqual([{ from: "cooking", to: "cooking", action: "라면 끓이기 알려 주기", reason: "coach", seen: null, fired: null, p: null }]);
    expect(d.learned).toEqual([{ from: "drinking", to: ask.to, action: "컵 치우기", was: ASK_ACTION, was_to: ask.to }]);
  });

  it("같은 (출발 상태, 도착, 행동) 검사는 하나로 묶는다: 통과한 것, 없으면 따라온 수가 많은 것", () => {
    const d = reflectionDetail(saved(), DAY);
    expect(d.checks.map((c) => [c.state, c.to, c.action, c.passed, c.p_value, c.moments.length])).toEqual([
      ["drinking", ask.to, "컵 치우기", true, 0.0001, 1],
      ["watching_tv", "watching_tv", "에어컨 켜기", false, 0.01, 0],
    ]);
    expect(d.candidates).toEqual([{ state: "drinking", to: ask.to, action: "컵 치우기" }, { state: "watching_tv", to: "watching_tv", action: "에어컨 켜기" }]);
  });

  it("모델이 쓴 글·p0·base_rate는 내보내지 않는다(거절된 반성의 까닭 글도)", () => {
    const db = saved();
    const failed = reflectionDetail(db, "2026-11-26");
    expect(failed).toMatchObject({ state: "failed", rejected: true, after: null, after_graph: null });
    const text = JSON.stringify([reflectionDetail(db, DAY), failed]);
    for (const key of ["\"p0\"", "base_rate", "\"on\"", "\"when\"", "\"text\"", "\"description\"", "모델 글", "모델 까닭", ask.on]) expect(text).not.toContain(key);
  });

  it("전에 배운 화살표가 오늘 검사를 못 지나 새 판본에서 빠지면 새 판본 그림에 없다", () => {
    const db = HistoryDb.open(":memory:");
    db.saveMemory({ kind: "fsm", memory: learnedMemory, day: addDays(DAY, -1), appliesDay: DAY, source: "reflection" });
    nightSave(db, {
      day: DAY, appliesDay: "2026-11-28", robot: CUP_FSM_MEMORY, candidates: { initial_state: "away", states: [] }, atMs: Date.parse(`${DAY}T15:03:00+09:00`), learnedCount: 0, used: {},
      found: { learned: [], active: [], dropped: [], rejected: null, chunks: [], did: [], checks: [check({ n: 3, k: 1, rate: 1 / 3, p_value: 0.0297, passed: false })] },
    });
    const d = reflectionDetail(db, DAY);
    expect(d.graph.edges).toContainEqual({ from: "drinking", to: "*", action: "컵 치우기" });
    expect(d.after_graph?.edges).not.toContainEqual({ from: "drinking", to: "*", action: "컵 치우기" });
    expect(d.after_graph?.edges).toContainEqual({ from: "drinking", to: "*", action: ASK_ACTION });
  });

  it("하루 마치기로 넘긴 날이면 넘긴 날을, 반성이 없으면 none과 그날 쓸 FSM 그림을 준다", () => {
    const db = saved();
    db.skipDay(Date.parse(`${DAY}T15:04:00+09:00`), DAY);
    expect(reflectionDetail(db, DAY).skipped_to).toBe("2026-11-28");
    const none = reflectionDetail(db, "2026-11-20");
    expect(none).toMatchObject({ state: "none", rejected: false, checks: [], after: null, after_graph: null });
    expect(none.graph.states.length).toBeGreaterThan(0);
  });
});

// 서버를 띄우고 반성 작업 스레드까지 돌아 몇 초 걸린다(무거운 일과 함께 돌면 5초를 넘는다)
describe("GET /api/reflection/:day", { timeout: 20_000 }, () => {
  let srv: RunningServer | undefined;
  let pam: FakePamLlm | undefined;
  afterEach(async () => {
    await srv?.close(); srv = undefined;
    await pam?.close(); pam = undefined;
  });

  it("하루 마치기 뒤 그날 반성을 읽는다: done, 넘긴 날, FSM 그림. p0·base_rate·모델 글 칸은 없다", async () => {
    pam = await startFakePamLlm();
    srv = await startServer({ env: { HUB: "memory", PORT: "0", REFLECT_AT: "off", FINISH_DAY: "1", RUNTIME_DIR: mkdtempSync(join(tmpdir(), "rt-")), ...pamLlmEnv(pam) }, log: () => {} });
    await srv.historyWriter.add("detection", Date.now(), "사람 보임");
    await srv.historyWriter.flush();
    const get = async (path: string) => (await (await fetchRetry(`${srv!.url}${path}`)).json()) as Record<string, any>;
    const today = (await get("/api/day")).today as string;
    const r = await fetchRetry(`${srv.url}/api/day/finish`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ day: today }) });
    expect(r.status).toBe(200);
    const body = await fetchRetry(`${srv.url}/api/reflection/${today}`);
    const raw = await body.text();
    expect(JSON.parse(raw)).toMatchObject({ ok: true, day: today, state: "done", skipped_to: addDays(today, 1) });
    expect(JSON.parse(raw).graph.states.length).toBeGreaterThan(0);
    for (const key of ["\"p0\"", "base_rate", "\"text\"", "\"on\""]) expect(raw).not.toContain(key);
    expect((await fetchRetry(`${srv.url}/api/reflection/2026-13-40`)).status).toBe(400);
  });
});
