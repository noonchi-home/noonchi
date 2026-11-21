// 시나리오 2(침실 1 책상, 2026-11-22): 부름에 응하기 → 「무엇을 도와드릴까요?」 → 물 한 잔 가져다주기 → 도움 기록 → 여러 날 기록으로 습관 → 그 시각에 부르지 않아도 확인하러 가기.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { helpRecord } from "../src/act/help-record.js";
import { ASK_FOLLOW, ASK_FROM, HELP_PROMPT } from "../src/act/prompts.js";
import { CALL_ACTION, TASK_NAMES, WATER_ACTION, matchChoice } from "../src/act/tasks.js";
import { CUP_FSM_MEMORY, validateMemory, type FsmMemory } from "../src/brain/decision.js";
import { habitView } from "../src/brain/habit.js";
import { findRoutines, hourText, routineEdge, withRoutines, STUDY_STATE, type HelpRoutine } from "../src/brain/history/routines.js";
import type { HelpRecord, HistoryRow } from "../src/contract/history.js";
import type { DecisionRecord } from "../src/contract/events.js";
import type { GoalIntent } from "../src/contract/machines.js";
import type { WorldObject, WorldView } from "../src/contract/world.js";
import { HabitWatch } from "../src/goal/habit-watch.js";
import { floorPlanFrom } from "../src/layout/floor.js";
import { loadScene } from "../src/layout/scene.js";
import { resolveHome } from "../src/layout/homes.js";
import { DEFAULT_TWIN_DIR } from "../src/layout/twin-files.js";
import { validateStations } from "../src/layout/stations.js";
import { planContext, SCENARIO2_SCRIPTS, startFakePlanner, testPlanner, type FakePlanner } from "./helpers/planner.js";
import { testTracker } from "./helpers/tracker-ports.js";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HistoryDb } from "../src/brain/history/db.js";
import { runNight } from "../src/brain/history/night.js";
import { memoryForDay } from "../src/brain/history/reflect.js";
import { candidateFsmOf } from "../src/brain/pam/adopt.js";
import { pamClientFor, startFakePamLlm, type ChunkView, type MarkView } from "./helpers/pam.js";
import { PlanHub } from "../src/act/hub.js";
import { memoryApprovals } from "../src/agent/approval.js";
import type { PlannedCommandMessage, PlannedCommand } from "../src/contract/phone.js";

const scene = loadScene(resolveHome(DEFAULT_TWIN_DIR, "mokryeon_180b"))!;
const map = scene.stations;
const floor = floorPlanFrom(scene);
const DESK = "desk_small_ce7e768b";
/** 집 시간대(서울) 그날 HH:MM의 ms. */
const kst = (day: string, hm: string) => Date.parse(`${day}T${hm}:00+09:00`);
const person = (activity: string | null, room = "bed_sw"): WorldView["person"] => ({
  visible: activity !== null, since_ms: 0, last_seen_ms: 0, count: activity ? 1 : 0, room, room_label: "침실 1", position: [6.2, 11.0], position_ms: 0, near: [], holding: [], answered_ms: null,
  facts: activity ? { activity: { value: activity, at_ms: 0, since_ms: 0, certainty: "confirmed" } } : {},
});
const view = (objects: WorldObject[], activity: string | null): WorldView => ({
  at_ms: 0, objects, person: person(activity), fixtures: [], devices: [], eye: null, frame_ms: 0, vlm_missing: 0, yolo_missing: 0,
});
const sinkCup: WorldObject = {
  id: "cup_1", cls: "cup", position: [5.9, 0.9, 0.7], surface: "sink_counter_kitchen", surface_label: "싱크대", room: "kitchen", error_m: 0.05, status: "present",
  first_seen_ms: 0, last_seen_ms: 0, last_in_view_ms: 0, facts: { contents: { value: "empty", at_ms: 0, since_ms: 0, certainty: "confirmed" } }, answered_ms: null, devices: [], closer_hold: false, followed_by: null,
};
const decisionFor = (action: string, source?: "speech"): DecisionRecord => ({
  id: source ? "say-1" : "pam-1", seq: source ? 0 : 1, atMs: 1, textSent: "t", finalTime: "x", status: "valid", action, memoryVersion: 1,
  prediction: { observation: "o", reasoning: "r", task_index: TASK_NAMES.indexOf(action) },
  world: { objects: [], person_visible: true, vlm_missing: 0, yolo_missing: 0 }, ...(source ? { source } : {}),
});
const helpRow = (id: number, day: string, hm: string, over: Partial<HelpRecord> = {}): HistoryRow => {
  const asked = kst(day, hm);
  const data: HelpRecord = { at_ms: asked + 240_000, asked_ms: asked, action: WATER_ACTION, via: "call", place: DESK, place_label: "책상", activity: "using_laptop", room: "bed_sw", result: "done", text: "t", ...over };
  return { id, at_ms: data.at_ms, day, kind: "help", subject: WATER_ACTION, text: data.text, data };
};

describe("시나리오 2 판단 기능", () => {
  let llm: FakePlanner;
  beforeAll(async () => { llm = await startFakePlanner({ ...SCENARIO2_SCRIPTS }); });
  afterAll(async () => { await llm.close(); });

  it("부르면 책상으로 가서 「무엇을 도와드릴까요?」를 묻고, 「물 한 잔만 가져다줘」는 물 한 잔 가져다주기로 이어진다", async () => {
    const plan = await testPlanner(llm).plan(planContext({ decision: decisionFor(CALL_ACTION, "speech"), world: view([], null), floor }));
    expect(plan.ok, JSON.stringify(plan)).toBe(true);
    if (!plan.ok) return;
    expect(plan.plan.steps.map((s) => [s.kind, s.kind === "go" ? s.target : s.prompt?.text])).toEqual([["go", DESK], ["ask", "무엇을 도와드릴까요?"]]);
    expect(plan.plan.steps[1]!.prompt?.choices.map((c) => c.id)).toEqual(["water", "none"]);
    const water = matchChoice("물 한 잔만 가져다줘", HELP_PROMPT.choices);
    expect(water?.id).toBe("water");
    expect(ASK_FROM).toContain(CALL_ACTION);
    expect(ASK_FOLLOW[water!.id]).toBe(WATER_ACTION);
    expect(matchChoice("괜찮아", HELP_PROMPT.choices)?.id).toBe("none");
  });

  it("물 한 잔 가져다주기는 냉장고 → 물병 꺼내기 → 싱크대 → 컵에 따르기 → 컵 들기 → 책상 → 책상에 놓기를 비전 조건으로 넘긴다", async () => {
    const plan = await testPlanner(llm).plan(planContext({ decision: decisionFor(WATER_ACTION, "speech"), world: view([sinkCup], "using_laptop"), floor }));
    expect(plan.ok, JSON.stringify(plan)).toBe(true);
    if (!plan.ok) return;
    expect(plan.plan.steps.map((s) => s.kind)).toEqual(["go", "pick", "go", "do", "pick", "go", "place"]);
    expect(plan.plan.steps.at(-1)).toMatchObject({ kind: "place", target: DESK });
    // 모든 사람 단계는 비전·폰 위치 조건으로 넘어간다(「완료」에만 기대지 않음)
    expect(plan.plan.steps.every((s) => !!s.until)).toBe(true);
  });

  it("책상 앞 자리(물컵 놓기)는 집 자료 검사를 지나고 사용자 자리 밖이다", () => {
    const checked = validateStations(map, scene);
    const front = checked.surface_fronts.find((f) => f.surface_id === DESK)!;
    expect(front).toBeTruthy();
    const seat = map.zones.find((z) => z.id === "desk_seat")!.polygon;
    const inSeat = front.position[0] >= Math.min(...seat.map((p) => p[0])) && front.position[0] <= Math.max(...seat.map((p) => p[0]))
      && front.position[1] >= Math.min(...seat.map((p) => p[1])) && front.position[1] <= Math.max(...seat.map((p) => p[1]));
    expect(inSeat).toBe(false);
  });

  it("도움 기록 한 줄: 부탁이면 「20:02 · 책상에서 공부 중 · 물 한 잔 요청 · 전달 완료」, 습관이면 「습관 기반 도움 · 물 전달 완료」", () => {
    const w = view([], "using_laptop");
    const call = helpRecord({ atMs: kst("2026-11-22", "20:02"), askedMs: kst("2026-11-22", "19:58"), offsetMinutes: 540, action: WATER_ACTION, via: "call", place: DESK, placeLabel: "책상", world: w });
    expect(call.text).toBe("20:02 · 책상에서 공부 중 · 물 한 잔 요청 · 전달 완료");
    expect(call).toMatchObject({ asked_ms: kst("2026-11-22", "19:58"), activity: "using_laptop", room: "bed_sw", place: DESK });
    const habit = helpRecord({ atMs: kst("2026-11-25", "20:04"), askedMs: kst("2026-11-25", "20:00"), offsetMinutes: 540, action: WATER_ACTION, via: "habit", place: DESK, placeLabel: "책상", world: w });
    expect(habit.text).toBe("20:04 · 책상에서 공부 중 · 습관 기반 도움 · 물 전달 완료");
    // 사용자가 안 보이면 하던 일 없이
    expect(helpRecord({ atMs: kst("2026-11-22", "20:02"), askedMs: 0, offsetMinutes: 540, action: WATER_ACTION, via: "call", place: DESK, placeLabel: "책상", world: view([], null) }).text)
      .toBe("20:02 · 책상에서 · 물 한 잔 요청 · 전달 완료");
  });

  it("사흘 모두 저녁 8시 ±15분에 같은 자리에서 부탁받으면 습관이다. 이틀이거나 한 날이 벗어나면 습관이 아니다", () => {
    const rows = [helpRow(1, "2026-11-22", "20:02"), helpRow(2, "2026-11-23", "19:58"), helpRow(3, "2026-11-24", "20:04")];
    const [r] = findRoutines(rows, 540);
    expect(r).toMatchObject({ action: WATER_ACTION, place: DESK, place_label: "책상", room: "bed_sw", center_min: 20 * 60 + 2, window_min: 15, days: ["2026-11-22", "2026-11-23", "2026-11-24"] });
    expect(hourText(r!.center_min)).toBe("저녁 8시 2분");
    expect(findRoutines(rows.slice(0, 2), 540)).toEqual([]);
    expect(findRoutines([...rows.slice(0, 2), helpRow(4, "2026-11-24", "20:40")], 540)).toEqual([]);
    // 그날 두 번 부탁하면 처음 것만 센다
    expect(findRoutines([...rows, helpRow(5, "2026-11-24", "22:30")], 540)).toHaveLength(1);
  });

  it("습관은 로봇 FSM에 「공부하는 중」 상태와 배운 화살표로 들어가 대시보드 FSM에 보인다", () => {
    const r: HelpRoutine = { action: WATER_ACTION, place: DESK, place_label: "책상", room: "bed_sw", center_min: 20 * 60, window_min: 15, days: ["a", "b", "c"] };
    const m = validateMemory(withRoutines(CUP_FSM_MEMORY, [r]), "fsm") as FsmMemory;
    const study = m.states.find((s) => s.id === STUDY_STATE)!;
    expect(study.activity).toEqual(["using_laptop", "reading"]);
    expect(study.next[0]).toEqual(routineEdge(r));
    expect(routineEdge(r)).toMatchObject({ on: "사용자가 저녁 8시 전후에 책상에서 공부한다.", when: "책상 위에 마실 물이 없다.", action: WATER_ACTION });
    expect(m.states.find((s) => s.id === "away")!.next.some((e) => e.to === STUDY_STATE)).toBe(true);
    // 같은 습관을 두 번 더해도 화살표는 하나
    expect(withRoutines(m, [r]).states.find((s) => s.id === STUDY_STATE)!.next.filter((e) => e.action === WATER_ACTION)).toHaveLength(1);
    const fsm = habitView(m, 3);
    expect(fsm.states.find((s) => s.id === STUDY_STATE)).toMatchObject({ name: "공부하는 중", learned: true });
    expect(fsm.transitions.find((t) => t.action === WATER_ACTION)).toMatchObject({ from: STUDY_STATE, learned: true });
  });

  it("부름 → 책상 도착 → 「물 한 잔」 답 → 물 한 잔 가져다주기를 비전으로 끝까지 하면 도움 기록 한 줄이 남는다", async () => {
    const clock = { t: kst("2026-11-22", "19:58"), now() { return this.t; } };
    const plans = new PlanHub(floor, () => {}, () => new Date(clock.t).toISOString());
    const objs: WorldObject[] = [{ ...sinkCup }];
    // 책상 앞 사용자는 보이고 VLM이 늘 답한다(손에 든 것 없음 = 들고 있다는 사실이 없음)
    const w = (): WorldView => { const v = view(objs, "using_laptop"); return { ...v, at_ms: clock.t, frame_ms: clock.t, person: { ...v.person, answered_ms: clock.t } }; };
    const planner = testPlanner(llm);
    const phone: PlannedCommandMessage[] = [];
    const decided: DecisionRecord[] = [];
    const records: HelpRecord[] = [];
    const t = testTracker({
      plans, world: w, check: () => ({ ok: true }), floor: () => floor, planGapMs: 0, approvals: memoryApprovals(), offsetMinutes: 540,
      planner: (d, signal) => planner.plan(planContext({ decision: d, world: w(), floor }), signal), onSpeech: (d) => decided.push(d),
      toPhone: (m) => phone.push(m), emit: () => {}, clock, sentSeq: () => 0, help: (r) => records.push(r),
      locate: (id) => { const o = floor.objects.get(id); return o ? { label: id === DESK ? "책상" : id, position: [o.position[0], 0.8, o.position[1]] } : undefined; },
    });
    const at = (id: string) => { const p = floor.objects.get(id)!.position; t.onEye([p[0], p[1]]); };
    const fact = (value: string) => ({ value, at_ms: clock.t, since_ms: clock.t, certainty: "confirmed" as const });
    const step = async (ms = 500) => { clock.t += ms; t.tick(); await t.idle(); };
    // 1) 「클로이드!」 → 부름에 응하기(에이전트 request_task) → 책상으로 가서 묻기
    t.onRequest({ task: CALL_ACTION, heard: "클로이드!", atMs: clock.t, afterSeq: 0 });
    await t.idle();
    expect(plans.current()).toMatchObject({ goal: CALL_ACTION, status: "running" });
    at(DESK); await step();
    const question = phone.findLast((m): m is PlannedCommand => m.type === "command" && m.text === "무엇을 도와드릴까요?")!;
    expect(question.choices.map((c) => c.label)).toEqual(["물 한 잔", "괜찮아요"]);
    // 2) 「물 한 잔만 가져다줘」 → 물 한 잔 가져다주기(답으로 시작한 말 부탁)
    expect(t.onAnswer(question.id, question.step, "water")).toBe(true);
    await t.idle();
    expect(decided.at(-1)).toMatchObject({ source: "speech", via: "answer", action: WATER_ACTION });
    expect(plans.current()).toMatchObject({ goal: WATER_ACTION, status: "running" });
    // 3) 냉장고 → 물병 꺼내기 → 싱크대 → 따르기 → 컵 들기 → 책상 → 놓기(비전 사실로 넘김)
    at("fridge_bbc363a3"); await step();
    objs.push({ ...sinkCup, id: "bottle_1", cls: "bottle", surface: null, surface_label: null, facts: { place: fact("in_hand") }, last_seen_ms: clock.t });
    await step();
    at("sink_counter_kitchen"); await step();
    objs[0] = { ...objs[0]!, facts: { contents: fact("has_contents") }, last_seen_ms: clock.t };
    await step();
    objs[0] = { ...objs[0]!, surface: null, facts: { contents: fact("has_contents"), place: fact("in_hand") }, last_seen_ms: clock.t };
    await step();
    at(DESK); await step();
    objs[0] = { ...objs[0]!, surface: DESK, surface_label: "책상", position: [6.24, 0.75, 11.73], facts: { contents: fact("has_contents"), place: fact("on_table") }, last_seen_ms: clock.t };
    await step(); await step();
    expect(plans.current()).toMatchObject({ goal: WATER_ACTION, status: "done" });
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ action: WATER_ACTION, via: "call", place: DESK, place_label: "책상", activity: "using_laptop" });
    expect(records[0]!.text).toMatch(/^\d\d:\d\d · 책상에서 공부 중 · 물 한 잔 요청 · 전달 완료$/);
  });

  it("하루 끝 반성은 사흘의 도움 기록에서 찾은 습관을 다음 날 로봇 FSM의 「공부하는 중」 화살표로 더한다", async () => {
    const pam = await startFakePamLlm({
      chunk: (v: ChunkView) => ({ chunks: v.lines.map((l) => ({ start: l.substring(0, 8), end: l.substring(0, 8), text: l.substring(11) })) }),
      reflect: () => candidateFsmOf(CUP_FSM_MEMORY), check: () => ({ ok: true, items: [] }),
      mark: (v: MarkView) => ({ candidates: v.candidates.map(([state, candidate]) => ({ state, candidate, times: [] })), actions: v.actions.map((action) => ({ action, times: [] })), unseen: [] }),
    });
    try {
      const db = HistoryDb.open(":memory:");
      for (const [day, hm] of [["2026-11-22", "20:02"], ["2026-11-23", "19:58"], ["2026-11-24", "20:04"]] as const) {
        db.add("detection", kst(day, hm) - 60_000, "사람 보임");
        const row = helpRow(0, day, hm).data as HelpRecord;
        db.add("help", row.at_ms, row.text, { subject: WATER_ACTION, data: row });
      }
      const r = await runNight(db, pamClientFor(pam), "2026-11-24", { dir: mkdtempSync(join(tmpdir(), "s2-night-")) });
      expect(r.ok, JSON.stringify(r)).toBe(true);
      const m = memoryForDay(db, "2026-11-25").memory as FsmMemory;
      expect(m.states.find((st) => st.id === STUDY_STATE)?.next.find((e) => e.action === WATER_ACTION)).toMatchObject({ on: "사용자가 저녁 8시 2분 전후에 책상에서 공부한다." });
      // 이틀 기록으로는 더하지 않는다
      const two = HistoryDb.open(":memory:");
      for (const [day, hm] of [["2026-11-22", "20:02"], ["2026-11-23", "19:58"]] as const) {
        two.add("detection", kst(day, hm) - 60_000, "사람 보임");
        const row = helpRow(0, day, hm).data as HelpRecord;
        two.add("help", row.at_ms, row.text, { subject: WATER_ACTION, data: row });
      }
      await runNight(two, pamClientFor(pam), "2026-11-23", { dir: mkdtempSync(join(tmpdir(), "s2-night-")) });
      expect((memoryForDay(two, "2026-11-24").memory as FsmMemory).states.some((st) => st.id === STUDY_STATE)).toBe(false);
    } finally { await pam.close(); }
  });

  it("습관 시각(가운데 −5분부터 +15분까지)이 되면 부르지 않아도 책상을 보는 자리로 하루 한 번 확인하러 간다", () => {
    const r: HelpRoutine = { action: WATER_ACTION, place: DESK, place_label: "책상", room: "bed_sw", center_min: 20 * 60, window_min: 15, days: ["a", "b", "c"] };
    const sent: GoalIntent[] = [];
    const w = new HabitWatch((i) => sent.push(i));
    const tick = (day: string, hm: string, busy = false) => w.tick({ now: kst(day, hm), rev: 1, map, routines: [r], offsetMinutes: 540, busy });
    tick("2026-11-25", "19:50");
    expect(sent).toEqual([]);
    tick("2026-11-25", "19:56", true);
    expect(sent).toEqual([]);
    tick("2026-11-25", "19:56");
    expect(sent).toEqual([expect.objectContaining({ op: "offer", kind: "visit", target_id: "desk_watch", goal_id: null, note: "평소 물을 찾는 시간이에요. 책상을 확인할게요." })]);
    tick("2026-11-25", "20:05");
    expect(sent).toHaveLength(1);
    tick("2026-11-25", "20:16");
    tick("2026-11-26", "20:00");
    expect(sent).toHaveLength(2);
  });
});
