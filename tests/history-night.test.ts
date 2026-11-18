// 밤 흐름(src/brain/history/night.ts): 덩어리 기록 → 반성(후보 FSM) → 검사 → 시각 찾기(모르는 것만) → 채택 검사 → 로봇 FSM → 한 트랜잭션 저장.
// 셈하기: 「치워 주세요」 답은 따라온 것, 「그대로 둬요」 답은 안 보였어도 본 것(따라오지 않음), 로봇이 그 일을 한 구간은 못 봄(사용자 결정 2026-11-18).
// 가짜 PAM LLM(같은 주소 자리)이 덩어리·반성·뜻 검사·시각 찾기에 답한다. 시각은 서울 시간대 HH:MM:SS.
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CUP_FSM_MEMORY, type FsmMemory } from "../src/brain/decision.js";
import { candidateFsmOf } from "../src/brain/pam/adopt.js";
import { HistoryDb } from "../src/brain/history/db.js";
import { answerActions, answerTimes, robotSpans, runNight, type NightResult } from "../src/brain/history/night.js";
import { memoryForDay } from "../src/brain/history/reflect.js";
import type { CandidateFsm } from "../src/contract/pam.js";
import { pamClientFor, startFakePamLlm, type ChunkView, type MarkView } from "./helpers/pam.js";

const LEAVE_ON = "사용자가 먹거나 마시기를 끝내고 다른 일로 넘어간다.";
const t = (s: string) => { const [h, m, x] = s.split(":").map(Number); return h! * 3600 + m! * 60 + x!; };
const at = (day: string, time: string) => Date.parse(`${day}T${time}+09:00`);
const tmp = () => mkdtempSync(join(tmpdir(), "night-"));
/** 후보 FSM: seed 모양 + 마시는 중에서 떠나는 컵 치우기 후보 하나(seed 묻기 화살표와 같은 on). */
const CANDIDATES_ASK_THEN_CLEAR: CandidateFsm = (() => {
  const c = candidateFsmOf(CUP_FSM_MEMORY);
  c.states.find((s) => s.id === "drinking")!.rules.push({ to: "*", action: "컵 치우기", candidates: [{ on: LEAVE_ON }] });
  return c;
})();
/** 덩어리: 기록 줄마다 한 덩어리. */
const oneChunkPerLine = (v: ChunkView) => ({ chunks: v.lines.map((l) => ({ start: l.substring(0, 8), end: l.substring(0, 8), text: l.substring(11) })) });
/** 시각 찾기: 물은 후보는 그 시각 줄이 있으면 그 시각, 행동은 사람이 한 때 없음, 안 보인 구간 없음. */
const markLeaveAt = (time: string) => (v: MarkView) => ({
  candidates: v.candidates.map(([state, candidate]) => ({ state, candidate, times: v.lines.some((l) => l.startsWith(time)) ? [time] : [] })),
  actions: v.actions.map((action) => ({ action, times: [] })), unseen: [],
});

type NightCheckRow = { state: string; action: string; on: string; n: number; k: number; unknown: number };
let n = 0;
/** 마시는 중(07:50) → 떠남(leave, 묻기 판단) → 답(answer: 「치워 주세요」면 말 부탁 판단도). */
function drinkAndLeave(db: HistoryDb, day: string, leave: string): string {
  db.add("detection", at(day, "07:50:00"), "사람 보임");
  db.add("world", at(day, "07:50:04"), "사람 마시는 중");
  db.add("decision", at(day, "07:50:04"), "대기", { subject: `pam-${++n}`, data: { fsm: { state: "drinking", from: null, next_index: -1, to: null, on: null, when: null, action: null, learned: false } } });
  db.add("detection", at(day, leave), "사람 안 보임");
  return `pam-${++n}`;
}
function leaveAndAnswer(db: HistoryDb, day: string, leave: string, answer: string, choice: "clear" | "keep"): void {
  const id = drinkAndLeave(db, day, leave);
  db.add("decision", at(day, leave), "사용자에게 물어보기", { subject: id, data: { fsm: { state: "away", from: "drinking", next_index: 0, to: "*", on: LEAVE_ON, when: null, action: "사용자에게 물어보기", learned: false } } });
  db.add("feedback", at(day, answer), `${choice === "clear" ? "치워 주세요" : "그대로 둬요"} · 질문: 컵을 치울까요?`, { subject: `plan:${id}`, data: { choice, via: "button" } });
  if (choice === "clear") db.add("decision", at(day, answer), "컵 치우기", { subject: `say-${++n}`, data: { source: "speech", via: "answer" } });
}
function leaveAndRobotClears(db: HistoryDb, day: string, leave: string, running: string, finished: string): void {
  const id = drinkAndLeave(db, day, leave);
  db.add("decision", at(day, leave), "컵 치우기", { subject: id, data: { fsm: { state: "away", from: "drinking", next_index: 0, to: "*", on: LEAVE_ON, when: null, action: "컵 치우기", learned: true } } });
  db.add("execution", at(day, running), "실행 중", { subject: `plan:${id}`, data: { state: "running" } });
  db.add("execution", at(day, finished), "완료", { subject: `plan:${id}`, data: { state: "done" } });
}
const fake = () => startFakePamLlm({ chunk: oneChunkPerLine, reflect: () => CANDIDATES_ASK_THEN_CLEAR, check: () => ({ ok: true, items: [] }), mark: markLeaveAt("08:00:00") });

describe("밤 흐름: 채택 검사", () => {
  it("「치워 주세요」 답은 따라온 것으로 센다: 하루 한 번 떠남 + 답이면 둘째 밤에 통과해 로봇 FSM에 그 화살표가 생긴다", async () => {
    const pam = await fake();
    try {
      const db = HistoryDb.open(":memory:");
      for (const d of ["2026-11-10", "2026-11-11"]) leaveAndAnswer(db, d, "08:00:00", "08:01:30", "clear");   // 08:00 떠남, 08:01:30 「치워 주세요」
      const first = await runNight(db, pamClientFor(pam), "2026-11-10", { dir: tmp() });
      expect(first.passed).toEqual([]);
      const second = await runNight(db, pamClientFor(pam), "2026-11-11", { dir: tmp() });
      expect(second.passed).toEqual([{ state: "drinking", action: "컵 치우기", on: LEAVE_ON }]);
      // 반성 답은 후보 FSM 종류로 받아 정상 후보 rules가 답 오류 없이 채택까지 간다(Codex 2966378 P2)
      expect(pam.bodies.filter((b) => b.role === "reflect").every((b) => b.memory_kind === "fsm_candidates")).toBe(true);
      expect((memoryForDay(db, "2026-11-12").memory as FsmMemory).states.find((s) => s.id === "drinking")!.next.some((e) => e.action === "컵 치우기" && e.on === LEAVE_ON)).toBe(true);
    } finally {
      await pam.close();
    }
  });

  it("채택 뒤 로봇이 바로 치운 날(사람이 하지도 답하지도 않음)은 못 봄이라 셈이 늘지 않고 채택이 이어진다", async () => {
    const pam = await fake();
    try {
      const db = HistoryDb.open(":memory:");
      const dir = tmp();
      for (const d of ["2026-11-10", "2026-11-11"]) leaveAndAnswer(db, d, "08:00:00", "08:01:30", "clear");
      leaveAndRobotClears(db, "2026-11-12", "08:00:00", "08:00:03", "08:01:40");   // 08:00 떠남, 08:00:03 로봇 컵 치우기 running, 08:01:40 done, 답 없음
      await runNight(db, pamClientFor(pam), "2026-11-10", { dir });
      await runNight(db, pamClientFor(pam), "2026-11-11", { dir });
      const third = await runNight(db, pamClientFor(pam), "2026-11-12", { dir });
      expect(robotSpans(db, "2026-11-12", "컵 치우기")).toEqual([[t("08:00:03"), t("08:01:40")]]);
      expect(third.checks).toContainEqual(expect.objectContaining({ state: "drinking", action: "컵 치우기", on: LEAVE_ON, n: 2, k: 2, unknown: 1, passed: true }));
    } finally {
      await pam.close();
    }
  });

  // Codex(1b07d3e2 P2): 로봇 실행 구간을 안 보인 구간에 더해도, 그 안에서 사람이 폰 명령대로 한 행동을 시각 찾기가 행동으로 표시하면 checkCandidate가 먼저 따라온 것으로 셌다
  it("로봇이 그 일을 한 구간 안의 행동 표시(폰 명령대로 사람이 컵을 옮김)는 따라온 것으로 세지 않는다(로봇이 한 때는 못 봄, 사용자 결정)", async () => {
    const pam = await startFakePamLlm({ chunk: oneChunkPerLine, reflect: () => CANDIDATES_ASK_THEN_CLEAR,
      mark: (v) => ({ ...markLeaveAt("08:00:00")(v), actions: v.actions.map((action) => ({ action, times: v.lines.some((l) => l.startsWith("08:00:30")) ? ["08:00:30"] : [] })) }) });
    try {
      const db = HistoryDb.open(":memory:");
      const dir = tmp();
      for (const d of ["2026-11-10", "2026-11-11"]) leaveAndAnswer(db, d, "08:00:00", "08:01:30", "clear");
      leaveAndRobotClears(db, "2026-11-12", "08:00:00", "08:00:03", "08:01:40");
      db.add("world", at("2026-11-12", "08:00:30"), "컵 손에 있음");   // 로봇 명령대로 사람이 컵을 들고 감
      for (const d of ["2026-11-10", "2026-11-11", "2026-11-12"]) await runNight(db, pamClientFor(pam), d, { dir });
      const third = JSON.parse(readFileSync(join(dir, "marks-2026-11-12.json"), "utf8")) as { actions: Record<string, string[]> };
      expect(third.actions["컵 치우기"]).toEqual(["08:00:30"]);
      const last = db.list({ kinds: ["reflection"], latest: true, limit: 1 })[0]!.data as { checks: NightCheckRow[] };
      expect(last.checks).toContainEqual(expect.objectContaining({ state: "drinking", action: "컵 치우기", on: LEAVE_ON, n: 2, k: 2, unknown: 1 }));
    } finally {
      await pam.close();
    }
  });

  // Codex(1b07d3e2 P2): 안 보인 구간 끝(마지막 안 보인 줄)을 반열린 구간 끝으로 그대로 써, 「사람 안 보임」 한 줄뿐이면 빈 구간이 돼 못 봄을 따라오지 않은 것으로 셌다.
  // 석준 님 daily_run.py는 끝에 줄 간격(step)을 더한다: 이 집 기록은 바뀔 때만 줄이 생기므로 다음 줄까지(없으면 그날 끝까지)가 안 보인 구간이다
  it("안 보인 구간은 다음 기록 줄까지(마지막 줄이면 그날 끝까지) 이어진다: 「사람 안 보임」 한 줄뿐인 구간에 걸린 후보 창도 못 봄이다", async () => {
    const pam = await startFakePamLlm({ chunk: oneChunkPerLine, reflect: () => CANDIDATES_ASK_THEN_CLEAR,
      mark: (v) => ({ ...markLeaveAt("08:00:00")(v), unseen: v.lines.some((l) => l.startsWith("08:00:00")) ? [{ start: "08:00:00", end: "08:00:00" }] : [] }) });
    try {
      const db = HistoryDb.open(":memory:");
      const dir = tmp();
      drinkAndLeave(db, "2026-11-10", "08:00:00");
      db.add("detection", at("2026-11-10", "09:00:00"), "사람 보임");   // 한 시간 뒤 돌아옴
      drinkAndLeave(db, "2026-11-11", "08:00:00");                      // 떠난 줄이 그날 마지막 줄
      for (const d of ["2026-11-10", "2026-11-11"]) await runNight(db, pamClientFor(pam), d, { dir });
      const last = db.list({ kinds: ["reflection"], latest: true, limit: 1 })[0]!.data as { checks: NightCheckRow[] };
      expect(last.checks).toContainEqual(expect.objectContaining({ state: "drinking", action: "컵 치우기", on: LEAVE_ON, n: 0, k: 0, unknown: 2 }));
    } finally {
      await pam.close();
    }
  });

  // Codex(1b07d3e2 P2): 시각 찾기 사본에 기록 범위 표시가 없어, 23:30 반성 뒤 더해진 같은 날 기록은 다음 밤에도 사본 때문에 건너뛰어 셈에서 빠졌다
  it("시각 찾기 사본을 만든 뒤 그날 기록이 늘면 다음 밤에 그날을 다시 묻고 늘어난 기록도 센다", async () => {
    const leaves = (v: MarkView) => v.lines.filter((l) => l.endsWith("| 사람 안 보임")).map((l) => l.substring(0, 8));
    const pam = await startFakePamLlm({ chunk: oneChunkPerLine, reflect: () => CANDIDATES_ASK_THEN_CLEAR,
      mark: (v) => ({ candidates: v.candidates.map(([state, candidate]) => ({ state, candidate, times: leaves(v) })), actions: v.actions.map((action) => ({ action, times: [] })), unseen: [] }) });
    try {
      const db = HistoryDb.open(":memory:");
      const dir = tmp();
      leaveAndAnswer(db, "2026-11-10", "08:00:00", "08:01:30", "clear");
      await runNight(db, pamClientFor(pam), "2026-11-10", { dir });
      leaveAndAnswer(db, "2026-11-10", "23:40:00", "23:41:30", "clear");   // 23:30 반성 뒤 더해진 같은 날 기록
      leaveAndAnswer(db, "2026-11-11", "08:00:00", "08:01:30", "clear");
      const second = await runNight(db, pamClientFor(pam), "2026-11-11", { dir });
      const marks = pam.bodies.filter((b): b is MarkView => b.role === "mark");
      expect(marks.map((m) => leaves(m))).toEqual([["08:00:00"], ["08:00:00", "23:40:00"], ["08:00:00"]]);
      expect(second.checks).toContainEqual(expect.objectContaining({ state: "drinking", action: "컵 치우기", on: LEAVE_ON, n: 3, k: 3 }));
    } finally {
      await pam.close();
    }
  });

  // Codex(1b07d3e2 P2): 시각 찾기가 실패하면(답 틀림·문맥 한도) 밤 흐름 전체가 실패하고, 다음 밤에도 같은 날을 다시 물어 계속 실패했다
  it("한 날의 시각 찾기가 실패하면 그날만 셈에서 빼고 밤 흐름을 잇는다. 그날 사본은 남기지 않아 다음 밤에 다시 묻는다", async () => {
    let calls = 0;
    const good = markLeaveAt("08:00:00");
    const pam = await startFakePamLlm({ chunk: oneChunkPerLine, reflect: () => CANDIDATES_ASK_THEN_CLEAR, mark: (v) => (++calls === 1 ? "{}" : good(v)) });
    try {
      const db = HistoryDb.open(":memory:");
      const dir = tmp();
      const logged: string[] = [];
      for (const d of ["2026-11-10", "2026-11-11"]) leaveAndAnswer(db, d, "08:00:00", "08:01:30", "clear");
      const first = await runNight(db, pamClientFor(pam), "2026-11-10", { dir, log: (l) => logged.push(l) });
      expect(first.ok).toBe(true);
      expect(first.checks).toContainEqual(expect.objectContaining({ action: "컵 치우기", n: 0, k: 0, unknown: 0, passed: false }));
      expect(logged.some((l) => l.includes("2026-11-10") && l.includes("시각 찾기"))).toBe(true);
      const second = await runNight(db, pamClientFor(pam), "2026-11-11", { dir });
      expect(calls).toBe(3);   // 둘째 밤: 11-10을 다시 묻고 11-11을 묻는다
      expect(second.passed).toEqual([{ state: "drinking", action: "컵 치우기", on: LEAVE_ON }]);
    } finally {
      await pam.close();
    }
  });

  it("「그대로 둬요」 답은 사람이 떠나 안 보였어도 셈에 든다: 치워·둬요·둬요·치워면 n=4·k=2로 통과하지 않고 떠날 때는 계속 묻는다", async () => {
    const pam = await fake();
    try {
      const db = HistoryDb.open(":memory:");
      const dir = tmp();
      const days = ["2026-11-10", "2026-11-11", "2026-11-12", "2026-11-13"];
      (["clear", "keep", "keep", "clear"] as const).forEach((a, i) => leaveAndAnswer(db, days[i]!, "08:00:00", "08:01:30", a));
      let last: NightResult | null = null;
      for (const d of days) last = await runNight(db, pamClientFor(pam), d, { dir });
      expect(last!.checks).toContainEqual(expect.objectContaining({ state: "drinking", action: "컵 치우기", on: LEAVE_ON, n: 4, k: 2, unknown: 0, passed: false }));
      expect((memoryForDay(db, "2026-11-14").memory as FsmMemory).states.find((s) => s.id === "drinking")!.next[0]!.action).toBe("사용자에게 물어보기");
    } finally {
      await pam.close();
    }
  });

  it("후보 판본(fsm_candidates)은 실행 기억으로 뽑히지 않는다: 밤 흐름이 후보를 로봇 FSM과 함께 저장해도 다음 날 판단 기억·/api/memory/day·가장 새 판본은 로봇 FSM이다", async () => {
    const pam = await fake();
    try {
      const db = HistoryDb.open(":memory:");
      leaveAndAnswer(db, "2026-11-10", "08:00:00", "08:01:30", "clear");
      await runNight(db, pamClientFor(pam), "2026-11-10", { dir: tmp() });
      const uses = db.memoryFor("2026-11-11")!;
      expect(uses.kind).toBe("fsm");
      expect(db.memoryVersion(db.latestMemoryVersion()!)!.kind).toBe("fsm");
      expect(db.candidatesFor("2026-11-11")!.kind).toBe("fsm_candidates");
      expect(() => db.pinMemory("2026-11-11", db.candidatesFor("2026-11-11")!.version)).toThrow(/not an execution memory/);
    } finally {
      await pam.close();
    }
  });

  it("밤 저장은 하나로 한다: 로봇 판본 뒤 후보 판본 저장이 실패하면 둘 다 없고 다음 날은 전날 기억, 반성 기록은 실패다. 검사 파일 쓰기가 실패해도 기억과 반성 기록 checks는 남는다", async () => {
    const pam = await fake();
    try {
      const db = HistoryDb.open(":memory:");
      for (const d of ["2026-11-10", "2026-11-11"]) leaveAndAnswer(db, d, "08:00:00", "08:01:30", "clear");
      await runNight(db, pamClientFor(pam), "2026-11-10", { dir: tmp() });
      const before = db.memoryFor("2026-11-12")!.version;
      const save = db.saveMemory.bind(db);
      db.saveMemory = (m) => { if (m.kind === "fsm_candidates") throw new Error("disk full"); return save(m); };
      const failed = await runNight(db, pamClientFor(pam), "2026-11-11", { dir: tmp() });
      expect(failed.ok).toBe(false);
      expect(db.memoryFor("2026-11-12")!.version).toBe(before);
      expect(db.list({ kinds: ["reflection"], latest: true, limit: 1 })[0]).toMatchObject({ data: { ok: false } });
      db.saveMemory = save;
      const dir = tmp();
      const ok = await runNight(db, pamClientFor(pam), "2026-11-11", { dir, writeFile: () => { throw new Error("disk full"); } });
      expect(ok.ok).toBe(true);
      expect(db.memoryFor("2026-11-12")!.version).toBeGreaterThan(before);
      expect(existsSync(join(dir, "check-2026-11-11.json"))).toBe(false);
      expect(db.list({ kinds: ["reflection"], limit: 5 }).at(-1)!.data).toMatchObject({ ok: true, checks: expect.arrayContaining([expect.objectContaining({ action: "컵 치우기", passed: true })]) });
    } finally {
      await pam.close();
    }
  });

  // Codex(1b07d3e2 P3): 밤 흐름이 여러 번 부른 PAM 사용량을 덮어써 마지막 호출 비용만 남았다
  it("반성 기록 사용량은 그 밤에 부른 PAM 호출(덩어리·반성·뜻 검사·시각 찾기)을 모두 더한 것이다", async () => {
    const pam = await startFakePamLlm({ chunk: oneChunkPerLine, reflect: () => CANDIDATES_ASK_THEN_CLEAR, mark: markLeaveAt("08:00:00"),
      usage: { chunk: { prompt_tokens: 10, completion_tokens: 1 }, reflect: { prompt_tokens: 20, completion_tokens: 2 }, check: { prompt_tokens: 30, completion_tokens: 3 }, mark: { prompt_tokens: 40, completion_tokens: 4 } } });
    try {
      const db = HistoryDb.open(":memory:");
      leaveAndAnswer(db, "2026-11-10", "08:00:00", "08:01:30", "clear");
      expect((await runNight(db, pamClientFor(pam), "2026-11-10", { dir: tmp() })).ok).toBe(true);
      expect(pam.calls).toEqual(["chunk", "reflect", "check", "mark"]);
      expect(db.list({ kinds: ["reflection"], latest: true, limit: 1 })[0]!.data).toMatchObject({ usage: { prompt: 100, completion: 10, cached: 0 } });
    } finally {
      await pam.close();
    }
  });

  it("「두세요」 답·아무 일 없음은 따라오지 않은 것, 안 보인 창은 못 봄", () => {
    const db = HistoryDb.open(":memory:");
    leaveAndAnswer(db, "2026-11-10", "08:00:00", "08:01:30", "keep");
    expect(answerActions(db, "2026-11-10")).toEqual([]);
    expect(answerTimes(db, "2026-11-10", "컵 치우기")).toEqual([t("08:01:30")]);   // 답은 본 것: 떠나서 안 보였어도 n
    leaveAndAnswer(db, "2026-11-11", "08:00:00", "08:01:30", "clear");
    expect(answerActions(db, "2026-11-11")).toEqual([{ action: "컵 치우기", times: [t("08:01:30")] }]);
  });

  it("시각 찾기는 날마다 모르는 (상태, 후보)·행동만 묻고, 덩어리 기록에 사람 상태가 붙는다. 시각 찾기 결과는 그날 사본으로 남는다", async () => {
    const pam = await fake();
    try {
      const db = HistoryDb.open(":memory:");
      const dir = tmp();
      for (const d of ["2026-11-10", "2026-11-11"]) leaveAndAnswer(db, d, "08:00:00", "08:01:30", "clear");
      await runNight(db, pamClientFor(pam), "2026-11-10", { dir });
      await runNight(db, pamClientFor(pam), "2026-11-11", { dir });
      const marks = pam.bodies.filter((b): b is MarkView => b.role === "mark");
      // 첫 밤에 11-10을 물었고, 둘째 밤에는 11-11만 묻는다(11-10은 사본에 있다)
      expect(marks).toHaveLength(2);
      expect(marks.map((m) => m.candidates)).toEqual([[["drinking", LEAVE_ON]], [["drinking", LEAVE_ON]]]);
      expect(JSON.parse(readFileSync(join(dir, "marks-2026-11-10.json"), "utf8"))).toMatchObject({ day: "2026-11-10", actions: { "컵 치우기": [] } });
      // 반성 입력은 사람 상태가 붙은 덩어리 기록이다
      const reflected = pam.bodies.filter((b) => b.role === "reflect").at(-1)!;
      expect(reflected.observation_text).toContain("07:50:04~07:50:04 [drinking] 사람 마시는 중");
      expect(reflected.observation_text).toContain("08:00:00~08:00:00 [away] 사람 안 보임");
      // 둘째 밤 반성은 첫 밤 검사 결과(후보마다 n·k·통과)를 받는다
      expect(reflected.action_summary).toContain("drinking | 사용자가 먹거나 마시기를 끝내고 다른 일로 넘어간다. | 컵 치우기 | n=1 k=1 not passed");
    } finally {
      await pam.close();
    }
  });
});
