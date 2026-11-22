// 시연 2번(토요일 저녁 TV와 맥주)을 합성 기록으로 검증한다. 4주 동안 TV를 매일 19시에 보기 시작해 20시 30분에 끝내고, 맥주는 토요일에만 사용자가 직접 가져오고(19시 3분) 캔도 직접 싱크대에 놓는다(20시 31분).
// 밤 흐름(src/brain/history/night.ts)이 토요일 맥락 규칙 둘(맥주 가져다주기·맥주 캔 치우기)을 채택하고, 낮 판단(src/brain/decide.ts)이 토요일 저녁에만 그 화살표를 PAM에 보인다.
// AI 자리(덩어리·반성·뜻 검사·시각 찾기)는 가짜 PAM LLM이 정해 둔 답을 한다. 실제 AI는 부르지 않는다.
import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { tasksFor } from "../src/act/tasks.js";
import { Decider } from "../src/brain/decide.js";
import { CUP_FSM_MEMORY, type FsmMemory } from "../src/brain/decision.js";
import { HistoryDb } from "../src/brain/history/db.js";
import { runNight, type NightResult } from "../src/brain/history/night.js";
import { memoryForDay } from "../src/brain/history/reflect.js";
import { candidateFsmOf } from "../src/brain/pam/adopt.js";
import type { CandidateFsm } from "../src/contract/pam.js";
import type { DecisionRecord } from "../src/contract/events.js";
import { WorldState } from "../src/world/state/world.js";
import { Trigger } from "../src/world/trigger.js";
import { pamClientFor, startFakePamLlm, type ChunkView, type FakePamLlm, type MarkView, type PredictView } from "./helpers/pam.js";

const TV_START = "사용자가 돌아와 TV를 본다.";
const TV_END = "사용자가 TV 보기를 끝내고 다른 일로 넘어간다.";
const TV_END_WHEN = "같이 마시는 중이었다.";
const BEER = "맥주 가져다주기";
const CAN = "맥주 캔 치우기";
const at = (day: string, time: string) => Date.parse(`${day}T${time}+09:00`);
const dayOf = (i: number) => new Date(Date.UTC(2026, 9, 12 + i)).toISOString().slice(0, 10);   // 2026-10-12는 월요일
const isSaturday = (i: number) => i % 7 === 5;

/** 후보 FSM: 반성이 «TV 보기 시작 → 맥주 가져다주기»(자리에 없음)와 «TV 보기 끝 → 맥주 캔 치우기»(TV 보는 중)를 낸다.
 *  같은 사건의 행동 없는 화살표(돌아와 TV를 본다)는 후보와 겹치지 않게 next에서 뺀다(로봇 FSM은 seed에서 다시 가져온다). */
const CANDIDATES: CandidateFsm = (() => {
  const c = candidateFsmOf(CUP_FSM_MEMORY);
  const away = c.states.find((s) => s.id === "away")!;
  away.next = away.next.filter((e) => e.on !== TV_START);
  away.rules.push({ to: "watching_tv", action: BEER, candidates: [{ on: TV_START }] });
  c.states.find((s) => s.id === "watching_tv")!.rules.push({ to: "*", action: CAN, candidates: [{ on: TV_END, when: TV_END_WHEN }] });
  return c;
})();

const oneChunkPerLine = (v: ChunkView) => ({ chunks: v.lines.map((l) => ({ start: l.substring(0, 8), end: l.substring(0, 8), text: l.substring(11) })) });
const startsAt = (lines: string[], time: string) => (lines.some((l) => l.startsWith(time)) ? [time] : []);
const timesOf = (lines: string[], text: string) => lines.filter((l) => l.includes(text)).map((l) => l.substring(0, 8));
/** 시각 찾기: 후보는 그 시각 줄, 행동은 사용자가 그 일을 한 줄의 시각. 안 보인 구간 없음. */
const mark = (v: MarkView) => ({
  candidates: v.candidates.map(([state, candidate]) => ({ state, candidate, times: candidate.includes("TV를 본다") ? [...startsAt(v.lines, "14:00:00"), ...startsAt(v.lines, "19:00:00")] : candidate.includes("TV 보기를 끝내고") ? [...startsAt(v.lines, "14:30:00"), ...startsAt(v.lines, "20:30:00")] : [] })),
  actions: v.actions.map((action) => ({ action, times: action === BEER ? timesOf(v.lines, "맥주를 꺼내") : action === CAN ? timesOf(v.lines, "캔을 싱크대") : [] })),
  unseen: [] as { start: string; end: string }[],
});

/** 하루 기록. daytimeTv면 낮 14시~14시 30분에도 TV를 본다(맥주는 안 마신다). */
function recordDay(db: HistoryDb, day: string, saturday: boolean, daytimeTv = false): void {
  if (daytimeTv) {
    db.add("device", at(day, "14:00:00"), "거실 TV 켜짐");
    db.add("world", at(day, "14:00:05"), "사람 TV 보는 중");
    db.add("device", at(day, "14:30:00"), "거실 TV 꺼짐");
  }
  db.add("detection", at(day, "18:59:50"), "사람 보임");
  db.add("device", at(day, "19:00:00"), "거실 TV 켜짐");
  db.add("world", at(day, "19:00:05"), "사람 TV 보는 중");
  if (saturday) db.add("world", at(day, "19:03:00"), "사용자가 냉장고에서 맥주를 꺼내 가져온다");
  db.add("device", at(day, "20:30:00"), "거실 TV 꺼짐");
  if (saturday) db.add("world", at(day, "20:31:00"), "사용자가 맥주 캔을 싱크대에 놓는다");
  db.add("detection", at(day, "20:32:00"), "사람 안 보임");
}

let pam: FakePamLlm | undefined;
afterEach(async () => { await pam?.close(); pam = undefined; });

async function learn(weeks: number, saturdayDaytimeTv = false): Promise<{ r: Extract<NightResult, { ok: true }>; fsm: FsmMemory }> {
  pam = await startFakePamLlm({ chunk: oneChunkPerLine, reflect: () => CANDIDATES, check: () => ({ ok: true, items: [] }), mark });
  const db = HistoryDb.open(":memory:");
  const days = Array.from({ length: weeks * 7 }, (_, i) => dayOf(i));
  days.forEach((d, i) => recordDay(db, d, isSaturday(i), saturdayDaytimeTv && isSaturday(i)));
  const res = await runNight(db, pamClientFor(pam), days.at(-1)!, { dir: mkdtempSync(join(tmpdir(), "beer-")) });
  expect(res.ok).toBe(true);
  const r = res as Extract<NightResult, { ok: true }>;
  const saved = memoryForDay(db, r.appliesDay) as { memory: FsmMemory } | FsmMemory;
  return { r, fsm: ("memory" in saved ? saved.memory : saved) as FsmMemory };
}

describe("시연 2번 합성 기록: 밤에 토요일 규칙 배우기", () => {
  it("4주: 맥주 가져다주기와 맥주 캔 치우기가 맥락 없이는 4/28(14%)로 떨어지고 토요일 맥락(4번 중 4번)으로 통과한다", async () => {
    const { r, fsm } = await learn(4);
    expect(r.checks.map((c) => [c.action, c.n, c.k, c.passed]).sort()).toEqual([[BEER, 28, 4, true], [CAN, 28, 4, true]].sort());
    for (const c of r.checks) {
      expect(c.ctx_rules).toHaveLength(1);
      expect(c.ctx_rules![0]).toMatchObject({ ctx: { dow: 5 }, n: 4, k: 4 });
      expect(Math.abs(c.ctx_rules![0]!.p_value - (4 / 28) ** 4)).toBeLessThan(1e-12);   // 0.14⁴ ≈ 0.0004
    }
    expect(r.learned.map((e) => [e.from, e.action, e.ctx]).sort()).toEqual([["away", BEER, { dow: 5 }], ["watching_tv", CAN, { dow: 5 }]].sort());
    // 저장된 로봇 FSM: 맥락 없는 화살표(상태 넘김·묻기)는 그대로, 토요일 화살표가 끝에 붙는다
    const away = fsm.states.find((s) => s.id === "away")!;
    expect(away.next.filter((e) => e.on === TV_START)).toEqual([{ to: "watching_tv", on: TV_START }, { to: "watching_tv", on: TV_START, action: BEER, ctx: { dow: 5 } }]);
    const tv = fsm.states.find((s) => s.id === "watching_tv")!;
    expect(tv.next.filter((e) => e.on === TV_END)).toEqual([
      { to: "*", on: TV_END, when: TV_END_WHEN, action: "사용자에게 물어보기" },
      { to: "*", on: TV_END, when: TV_END_WHEN, action: CAN, ctx: { dow: 5 } },
    ]);
  });
  it("3주(토요일 3번, 0.0029)는 통과하고 2주(0.020)는 통과하지 못한다", async () => {
    expect((await learn(3)).r.learned).toHaveLength(2);
    await pam!.close(); pam = undefined;
    expect((await learn(2)).r.learned).toHaveLength(0);
  });
});

describe("시연 2번 합성 기록: 낮에 토요일에만 동작하기", () => {
  /** 배운 FSM으로 그 시각에 PAM을 한 번 부르고, PAM이 받은 기억을 돌려준다. PAM은 자리에 없음 → TV 보기 시작 화살표(있으면 맥락 있는 것)를 고른다. */
  async function callAt(fsm: FsmMemory, iso: string): Promise<{ record: DecisionRecord; sent: FsmMemory }> {
    const now = Date.parse(iso);
    const server = await startFakePamLlm({ predict: (v: PredictView) => {
      const away = (v.memory as FsmMemory).states.find((s) => s.id === "away")!;
      const i = away.next.findIndex((e) => e.on === TV_START && e.action === BEER);
      return { observation: "o", reasoning: "r", state: "watching_tv", from: "away", next_index: i >= 0 ? i : away.next.findIndex((e) => e.on === TV_START) };
    } });
    pam = server;
    const records: DecisionRecord[] = [];
    const world = new WorldState({ surfaces: () => [], floorAt: () => 0, roomAt: () => null, devices: () => [] });
    const trigger = new Trigger({ mode: "event", minGapMs: 0, periodMs: 1000, idleStopMs: 1e9, liveMs: 10_000, maxInflight: 1 }, now - 5000);
    const d = new Decider({ pam: pamClientFor(server), world, trigger, tasks: () => tasksFor("noonchi"), memory: () => ({ memory: fsm, kind: "fsm" as const, version: 7 }),
      emit: () => {}, onDecision: (r) => records.push(r), offsetMinutes: 540, clock: { now: () => now } });
    d.onChanges([{ kind: "person_gone", at_ms: now - 1000, subject: "person", text: "사람 안 보임", meaningful: true }]);
    d.tick();
    await d.idle();
    return { record: records[0]!, sent: (server.bodies[0] as PredictView).memory as FsmMemory };
  }
  const tvEnd = (m: FsmMemory) => m.states.find((s) => s.id === "watching_tv")!.next.filter((e) => e.on === TV_END).map((e) => e.action);

  it("토요일 19시: TV 보기 시작에 맥주 가져다주기 화살표가 PAM에 가고 고른다. TV 보기 끝에는 맥주 캔 치우기가 묻기를 대신한다", async () => {
    const { fsm } = await learn(4);
    await pam!.close(); pam = undefined;
    const { record, sent } = await callAt(fsm, "2026-11-21T19:00:00+09:00");
    expect(record).toMatchObject({ status: "valid", action: BEER, memoryVersion: 7, fsm: { from: "away", to: "watching_tv", action: BEER } });
    expect(sent.states.find((s) => s.id === "away")!.next.filter((e) => e.on === TV_START)).toEqual([{ to: "watching_tv", on: TV_START, action: BEER }]);   // 맥락 칸은 떼고, 행동 없는 화살표는 뺐다
    expect(tvEnd(sent)).toEqual([CAN]);
  });
  it("일요일 19시·금요일 19시: 맥주 화살표는 안 보이고 행동 없이 TV 보기로 넘어가며, TV 보기 끝에는 예전 묻기가 남는다", async () => {
    const { fsm } = await learn(4);
    for (const iso of ["2026-11-22T19:00:00+09:00", "2026-11-20T19:00:00+09:00"]) {
      await pam!.close(); pam = undefined;
      const { record, sent } = await callAt(fsm, iso);
      expect(record, iso).toMatchObject({ status: "valid", action: null, fsm: { from: "away", to: "watching_tv", action: null } });
      expect(sent.states.find((s) => s.id === "away")!.next.some((e) => e.action === BEER), iso).toBe(false);
      expect(tvEnd(sent), iso).toEqual(["사용자에게 물어보기"]);
    }
  });
  it("학습 기록의 TV 시작이 모두 19시라 규칙은 «토요일» 하나뿐이다: 토요일 10시에도 맥주 화살표가 보인다(시각은 필요한 기록이 있을 때만 붙는다)", async () => {
    const { fsm } = await learn(4);
    await pam!.close(); pam = undefined;
    const { record } = await callAt(fsm, "2026-11-21T10:00:00+09:00");
    expect(record).toMatchObject({ action: BEER });
  });
  it("토요일 낮에도 TV를 보는데 맥주는 안 마셨다면 규칙에 시각이 붙는다: 토요일 19시에는 보이고 토요일 10시·14시 반에는 안 보인다", async () => {
    const { r, fsm } = await learn(4, true);
    expect(r.checks.map((c) => [c.action, c.n, c.k]).sort()).toEqual([[BEER, 32, 4], [CAN, 32, 4]].sort());                 // 토요일 낮 4번이 더해져 32번 중 4번
    expect(r.learned.map((e) => e.ctx)).toEqual([{ dow: 5, slot: 6 }, { dow: 5, slot: 6 }]);                                  // 18~21시
    for (const [iso, want] of [["2026-11-21T19:00:00+09:00", BEER], ["2026-11-21T10:00:00+09:00", null], ["2026-11-21T14:30:00+09:00", null], ["2026-11-22T19:00:00+09:00", null]] as const) {
      await pam!.close(); pam = undefined;
      expect((await callAt(fsm, iso)).record.action, iso).toBe(want);
    }
  });
});
