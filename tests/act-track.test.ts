// 실행 추적(src/act/track.ts): 실제 폰은 에이전트의 손이다. 계획은 에이전트 계획 모드(src/agent/planner.ts)가 만들고, 시험의 모델은
// 같은 주소 자리의 가짜 OpenAI 서버가 도구 호출로 낸다(tests/helpers/planner.ts, 지금 서버와 같은 컵 계획). 계획 단계마다 사람에게 명령 하나를 보내고,
// 그 단계가 됐는지를 폰 눈 위치(이동)와 World State(컵 자리)로 본 뒤 다음 명령을 보낸다. 「완료」(단추·말)는 지금 단계 하나를 넘기고 「그만」은 계획을 그만둔다.
// 조건은 단계가 시작된 뒤 본 사실만 쓰므로 손에 있음·싱크대 안 사실은 지금 시계(clock.t)로 둔다.
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ExecutionTracker, TRACK_DEFAULTS, type Stall, type TrackerOptions } from "../src/act/track.js";
import { ApprovalStore, type ApprovalAnswer } from "../src/agent/approval.js";
import type { AgentStep } from "../src/agent/planTools.js";
import type { CheckResult } from "../src/act/check.js";
import type { BrainLog } from "../src/contract/events.js";
import type { PlannedCommand, PlannedCommandMessage } from "../src/contract/phone.js";
import type { WorldObject, WorldView } from "../src/contract/world.js";
import { PlanHub } from "../src/plan/hub.js";
import { APPROVAL_TEXT, EXEC_TEXT, STEP_COMMAND, STEP_LABEL } from "../src/plan/labels.js";
import type { DecisionRecord } from "../src/world/decide.js";
import { WorldState } from "../src/world/state.js";
import { sha256, type EngineFrame } from "../src/observe/ring.js";
import type { Detection } from "../src/brain/detector.js";
import type { CameraView } from "../src/phone/session.js";
import { smallFloor } from "./helpers/floor.js";
import { standing } from "./helpers/poses.js";
import { planContext, startFakePlanner, testPlanner, type FakePlanner } from "./helpers/planner.js";

let llm: FakePlanner;
beforeAll(async () => { llm = await startFakePlanner(); });
afterAll(async () => { await llm.close(); });

// smallFloor: 로봇 [1, 2], 식탁 table_1 [7, 3], 싱크대 sink_1 [5, 1]
const cup = (status: WorldObject["status"], place?: string, seen = 9_000): WorldObject => ({
  id: "cup_1", cls: "cup", position: [2, 0.75, 1], surface: "t", surface_label: "식탁", room: "hall", error_m: 0.1, status,
  first_seen_ms: 0, last_seen_ms: seen, last_in_view_ms: seen, facts: place ? { place: { value: place, at_ms: seen, since_ms: seen, certainty: "confirmed" } } : {}, answered_ms: null, devices: [], closer_hold: false,
});
const world =(objects: WorldObject[], personAction?: string, at = 0): WorldView => ({
  at_ms: 0, objects, person: { visible: !!personAction, since_ms: 0, last_seen_ms: null, count: 0, room: null, room_label: null, position: null, near: [], holding: [], position_ms: null, answered_ms: null, facts: personAction ? { holding: { value: personAction, at_ms: at, since_ms: at, certainty: "confirmed" } } : {} },
  fixtures: [], devices: [], eye: null, frame_ms: null, vlm_missing: 0, yolo_missing: 0,
});
const pred = { observation: "o", reasoning: "r", task_index: 0 };
const decision: DecisionRecord = {
  id: "pam-1", seq: 1, atMs: 8_000, textSent: "t", finalTime: "x", status: "valid", prediction: pred, action: "컵 치우기", memoryVersion: 1,
  world: { objects: [], person_visible: false, vlm_missing: 0, yolo_missing: 0 },
};
const ask = (id: string, seq: number): DecisionRecord => ({ ...decision, id, seq, action: "사용자에게 물어보기", prediction: { ...pred, task_index: 1 } });
const DONE = [{ id: "done", label: "완료" }];
/** 평면도 물건의 트윈 자리(고리 대상). */
const PLACES: Record<string, { label: string; position: [number, number, number] }> = {
  table_1: { label: "식탁", position: [7, 0.75, 3] }, sink_1: { label: "싱크대", position: [5, 0.9, 1] },
};
const TABLE = { id: "table_1", ...PLACES.table_1! };
const SINK = { id: "sink_1", ...PLACES.sink_1! };

/** 승인 기억(파일). remembered: 미리 넣어 둘 답. */
function store(remembered: Record<string, ApprovalAnswer> = {}): ApprovalStore {
  const s = new ApprovalStore(join(mkdtempSync(join(tmpdir(), "track-")), "homes", "h", "approvals.json"), () => "t");
  for (const [key, a] of Object.entries(remembered)) s.answer(key, a);
  return s;
}

/** approvals가 없으면 컵 치우기에 승인을 받아 둔 기억으로 만든다(승인 질문 없이 첫 단계부터). 같은 행동 다시 계획 간격은 0(그 간격은 따로 본다).
 *  decide: 판단을 넘기고 에이전트가 계획을 다 만들 때까지 기다린다. */
function setup(over: Partial<TrackerOptions> & { w?: () => WorldView; check?: () => CheckResult } = {}) {
  const logs: BrainLog[] = [];
  const phone: PlannedCommandMessage[] = [];
  const clock = { t: 10_000, now() { return this.t; } };
  const plans = new PlanHub(smallFloor(), () => {}, () => "t");
  const approvals = over.approvals ?? store({ "task:컵 치우기": "approve" });
  const w = over.w ?? (() => world([cup("present")]));
  const planner = testPlanner(llm);
  const t = new ExecutionTracker({
    plans, world: w, check: over.check ?? (() => ({ ok: true })), floor: () => plans.floor(), planGapMs: 0,
    planner: (d, signal) => planner.plan(planContext({ decision: d, world: w(), floor: plans.floor() }), signal),
    toPhone: (m) => phone.push(m), emit: (l) => logs.push(l), clock, locate: (id) => PLACES[id], ...over, approvals,
  });
  const decide = async (d: DecisionRecord) => {
    t.onDecision(d);
    await t.idle();
  };
  const exec = () => logs.flatMap((l) => (l.type === "execution" ? [l] : []));
  const commands = () => phone.flatMap((m) => (m.type === "command" ? [m] : []));
  /** 새로 읽은 명령(speak)만. */
  const spoken = () => commands().filter((m) => m.speak).map((m) => m.text);
  const last = () => phone.at(-1) as PlannedCommand;
  const steps = () => plans.current()!.steps.map((s) => s.status);
  return { t, decide, logs, phone, clock, plans, exec, commands, spoken, last, steps, approvals };
}

describe("실행 추적: 단계마다 실제 폰 명령", () => {
  it("컵 치우기는 단계마다 사람에게 하는 명령 하나를 보내고, 폰 위치와 World State로 그 단계가 된 것을 본 뒤 다음 명령을 보낸다", async () => {
    let w = world([cup("present")]);
    const { t, decide, phone, clock, plans, exec, commands, spoken, last, steps } = setup({ w: () => w });
    await decide(decision);
    // 1 이동: 폰 눈을 아직 모르면 거리 모름
    // 명령 대상(실제 폰 고리)은 식탁 → 컵 → 싱크대 → 싱크대
    expect(phone).toEqual([{ type: "command", id: "plan:pam-1", step: "plan:pam-1:1", text: "식탁으로 가 주세요", vision: "식탁까지 거리 모름", choices: DONE, target: TABLE, speak: true, kind: "go" }]);
    expect(plans.current()).toMatchObject({ id: "plan:pam-1", status: "running" });
    expect(steps()).toEqual(["active", "pending", "pending", "pending"]);
    clock.t += 600;
    t.onEye([1, 2]);
    t.tick();
    expect(last()).toMatchObject({ step: "plan:pam-1:1", vision: "식탁까지 6.1m", speak: false });
    clock.t += 600;
    t.onEye([6.2, 3]);
    t.tick();
    // 2 집기: 식탁 가까이(1.2m 안)라 다음 명령, 컵 자리는 World State
    expect(last()).toEqual({
      type: "command", id: "plan:pam-1", step: "plan:pam-1:2", text: "컵을 들어 주세요", vision: "컵 · 식탁 위", choices: DONE,
      target: { id: "cup_1", label: "컵", position: [2, 0.75, 1] }, speak: true, kind: "pick",
    });
    expect(steps()).toEqual(["done", "active", "pending", "pending"]);
    clock.t += 600;
    w = world([cup("present", "in_hand", clock.t)]);
    t.onWorld();
    // 3 이동: 컵이 손에 있음
    expect(last()).toMatchObject({ step: "plan:pam-1:3", text: "싱크대로 가 주세요", vision: "컵 · 손에 있음 · 싱크대까지 2.3m", target: SINK, speak: true, kind: "go" });
    expect(steps()).toEqual(["done", "done", "active", "pending"]);
    // 싱크대에서 1.3m면 아직 안 넘긴다(비전 상태만 바뀐다)
    clock.t += 600;
    t.onEye([5, 2.3]);
    t.tick();
    expect(last()).toMatchObject({ step: "plan:pam-1:3", vision: "컵 · 손에 있음 · 싱크대까지 1.3m", speak: false });
    expect(steps()).toEqual(["done", "done", "active", "pending"]);
    clock.t += 600;
    t.onEye([5.3, 1.5]);
    t.tick();
    // 4 내려놓기
    expect(last()).toMatchObject({ step: "plan:pam-1:4", text: "컵을 싱크대에 넣어 주세요", vision: "컵 · 손에 있음", target: SINK, speak: true, kind: "place" });
    expect(steps()).toEqual(["done", "done", "done", "active"]);
    // 컵이 아직 손에 있으면 안 넘긴다
    clock.t += 600;
    t.onWorld();
    t.tick();
    expect(last()).toMatchObject({ step: "plan:pam-1:4" });
    expect(steps()).toEqual(["done", "done", "done", "active"]);
    clock.t += 600;
    w = world([cup("present", "in_sink", clock.t)]);
    t.onWorld();
    // 싱크대 안이면 명령을 지우고 계획 완료
    expect(last()).toEqual({ type: "command_clear", id: "plan:pam-1" });
    expect(plans.current()).toMatchObject({ status: "done", steps: [{ status: "done" }, { status: "done" }, { status: "done" }, { status: "done" }] });
    expect(exec().map((l) => l.state)).toEqual(["decided", "planned", "running", "done"]);
    expect(exec().every((l) => l.plan_id === "plan:pam-1")).toBe(true);
    expect(spoken()).toEqual(["식탁으로 가 주세요", "컵을 들어 주세요", "싱크대로 가 주세요", "컵을 싱크대에 넣어 주세요"]);
    // 명령은 사람에게 하는 말이다(클로이드가 스스로 하는 말이 아니다). 답 단추는 「완료」 하나(나중에 없음)
    for (const text of Object.values(STEP_COMMAND)) expect(text).toMatch(/주세요$/);
    expect(commands().every((m) => JSON.stringify(m.choices) === JSON.stringify(DONE))).toBe(true);
    expect(t.current()).toMatchObject({ planId: "plan:pam-1", state: "done" });
  });

  it("집기는 사람이 물건을 들고 있어도(holding_object) 된 것으로 본다", async () => {
    let w = world([cup("present")]);
    const { t, decide, last } = setup({ w: () => w });
    await decide(decision);
    t.onAnswer("plan:pam-1", "plan:pam-1:1", "done");
    expect(last()).toMatchObject({ step: "plan:pam-1:2" });
    w = world([cup("present")], "holding_object", 10_000);
    t.onWorld();
    expect(last()).toMatchObject({ step: "plan:pam-1:3", text: "싱크대로 가 주세요" });
  });

  it("컵이 움직여 World State가 새 id를 붙여도(맞춘 카메라, 0.25m 넘게) 같은 컵으로 보고, 그 사이 판단은 같은 행동으로 이어 간다", async () => {
    // cup_9는 계획 전부터 싱크대 안에 있던 다른 컵: 내려놓기로 보지 않는다
    const other = { ...cup("present", "in_sink", 8_000), id: "cup_9" };
    let w = world([cup("present"), other]);
    const { t, decide, logs, plans, last, steps } = setup({ w: () => w });
    await decide(decision);
    t.onAnswer("plan:pam-1", "plan:pam-1:1", "done");
    // 집기: 손에 든 컵이 cup_2로 보이고 식탁 자리 cup_1은 사라짐
    w = world([{ ...cup("gone"), last_seen_ms: 9_000 }, { ...cup("present", "in_hand", 10_000), id: "cup_2", first_seen_ms: 9_400 }, other]);
    t.onWorld();
    expect(last()).toMatchObject({ step: "plan:pam-1:3", vision: "컵 · 손에 있음 · 싱크대까지 거리 모름" });
    // 새 판단의 대상이 새 id(cup_2)여도 같은 행동: 1단계부터 다시 하지 않는다
    await decide({ ...decision, id: "pam-2", seq: 2 });
    expect(logs.at(-1)).toMatchObject({ type: "execution", plan_id: "plan:pam-2", text: EXEC_TEXT.same });
    expect(plans.current()).toMatchObject({ id: "plan:pam-1", status: "running" });
    t.onAnswer("plan:pam-1", "plan:pam-1:3", "done");
    expect(last()).toMatchObject({ step: "plan:pam-1:4", vision: "컵 · 손에 있음" });
    t.tick();
    expect(steps()).toEqual(["done", "done", "done", "active"]);
    // 내려놓기: 싱크대 안 컵이 또 새 id(cup_3)
    w = world([{ ...cup("gone"), last_seen_ms: 9_000 }, { ...cup("gone", "in_hand", 9_500), id: "cup_2", first_seen_ms: 9_400 }, { ...cup("present", "in_sink", 10_000), id: "cup_3", first_seen_ms: 9_800 }, other]);
    t.onWorld();
    expect(last()).toEqual({ type: "command_clear", id: "plan:pam-1" });
    expect(plans.current()).toMatchObject({ id: "plan:pam-1", status: "done" });
  });

  it("완료 단추와 말(완료·다 했어)은 지금 단계 하나만 넘긴다. 지난 단계·다른 계획·없는 답은 무시한다", async () => {
    const { t, decide, spoken, steps, last } = setup();
    await decide(decision);
    expect(t.onAnswer("plan:pam-1", "plan:pam-1:1", "done")).toBe(true);
    expect(t.onAnswer("plan:pam-1", "plan:pam-1:1", "done")).toBe(false);
    expect(t.onAnswer("plan:other", "plan:pam-1:2", "done")).toBe(false);
    expect(t.onAnswer("plan:pam-1", "plan:pam-1:2", "later")).toBe(false);
    expect(steps()).toEqual(["done", "active", "pending", "pending"]);
    expect(t.onHeard("완료")).toMatchObject({ id: "done", reply: "" });
    expect(steps()).toEqual(["done", "done", "active", "pending"]);
    expect(t.onHeard("응 다 했어")).toMatchObject({ id: "done" });
    expect(steps()).toEqual(["done", "done", "done", "active"]);
    expect(t.onHeard("불 꺼 줘")).toBeNull();
    expect(last()).toMatchObject({ step: "plan:pam-1:4" });
    expect(t.onAnswer("plan:pam-1", "plan:pam-1:4", "done")).toBe(true);
    expect(last()).toEqual({ type: "command_clear", id: "plan:pam-1" });
    expect(spoken()).toEqual(["식탁으로 가 주세요", "컵을 들어 주세요", "싱크대로 가 주세요", "컵을 싱크대에 넣어 주세요"]);
    expect(t.onHeard("완료")).toBeNull();
  });

  it("한 번 볼 때 한 단계만 넘긴다: 컵을 든 채 싱크대 옆이어도 집기 다음 tick에 이동을 넘긴다", async () => {
    let w = world([cup("present")]);
    const { t, decide, steps } = setup({ w: () => w });
    await decide(decision);
    t.onAnswer("plan:pam-1", "plan:pam-1:1", "done");
    w = world([cup("present", "in_hand", 10_000)]);
    t.onEye([5, 1.5]);
    t.tick();
    expect(steps()).toEqual(["done", "done", "active", "pending"]);
    t.tick();
    expect(steps()).toEqual(["done", "done", "done", "active"]);
  });

  it("말로 「그만」이면 명령을 지우고 계획을 취소한다. 실행 기록은 실패(그만둠)", async () => {
    const { t, decide, plans, exec, last } = setup();
    await decide(decision);
    t.onAnswer("plan:pam-1", "plan:pam-1:1", "done");
    expect(t.onHeard("이제 그만")).toMatchObject({ id: "stop", reply: "" });
    expect(last()).toEqual({ type: "command_clear", id: "plan:pam-1" });
    expect(plans.current()).toMatchObject({ status: "cancelled", steps: [{ status: "done" }, { status: "skipped" }, { status: "skipped" }, { status: "skipped" }] });
    expect(exec().at(-1)).toMatchObject({ state: "failed", text: EXEC_TEXT.stopped });
    expect(t.openCommand()).toBeNull();
    expect(t.onHeard("그만")).toBeNull();
  });

  it("한 단계가 오래 걸리면 30초마다 명령을 다시 읽고, 2분이 지나면 실패로 닫는다. 다음 단계로 가면 다시 잰다", async () => {
    expect(TRACK_DEFAULTS).toEqual({ repeatMs: 30_000, visionMs: 500, recheckMs: 3000, askMs: 120_000, planGapMs: 15_000, stallMs: 8000, stallMax: 3 });
    const { t, decide, clock, spoken, plans, exec, last } = setup();
    await decide(decision);
    clock.t += 29_999;
    t.tick();
    expect(spoken()).toEqual(["식탁으로 가 주세요"]);
    clock.t += 1;
    t.tick();
    expect(spoken()).toEqual(["식탁으로 가 주세요", "식탁으로 가 주세요"]);
    expect(last()).toMatchObject({ step: "plan:pam-1:1", speak: true });
    clock.t += 30_000;
    t.tick();
    expect(spoken()).toHaveLength(3);
    t.onAnswer("plan:pam-1", "plan:pam-1:1", "done");
    for (let i = 0; i < 4; i++) {
      clock.t += 30_000;
      t.tick();
    }
    expect(t.current()).toMatchObject({ state: "running" });
    expect(spoken()).toEqual(["식탁으로 가 주세요", "식탁으로 가 주세요", "식탁으로 가 주세요", "컵을 들어 주세요", "컵을 들어 주세요", "컵을 들어 주세요", "컵을 들어 주세요", "컵을 들어 주세요"]);
    clock.t += 1;
    t.tick();
    expect(exec().at(-1)).toMatchObject({ state: "failed", text: EXEC_TEXT.timeout });
    expect(last()).toEqual({ type: "command_clear", id: "plan:pam-1" });
    expect(plans.current()).toMatchObject({ status: "failed", steps: [{ status: "done" }, { status: "failed" }, { status: "skipped" }, { status: "skipped" }] });
  });

  it("비전 상태는 바뀔 때만, 0.5초에 한 번까지 보낸다", async () => {
    const { t, decide, clock, phone } = setup();
    await decide(decision);
    t.onEye([1, 2]);
    clock.t += 100;
    t.tick();
    expect(phone).toHaveLength(1);
    clock.t += 400;
    t.tick();
    expect(phone.map((m) => m.type === "command" && m.vision)).toEqual(["식탁까지 거리 모름", "식탁까지 6.1m"]);
    clock.t += 500;
    t.tick();
    expect(phone).toHaveLength(2);
    t.onEye([2, 2], true);
    clock.t += 500;
    t.tick();
    expect(phone).toHaveLength(2);
    t.onEye([4, 2.8]);
    clock.t += 500;
    t.tick();
    expect(phone.at(-1)).toMatchObject({ vision: "식탁까지 3.0m", speak: false });
  });

  it("물어보기는 같은 자리에 질문과 답 단추를 띄우고, 답(단추·말)을 받으면 명령을 지우고 완료. 「완료」 단추는 없다", async () => {
    const a = setup();
    await a.decide(ask("pam-1", 1));
    expect(a.phone).toEqual([{
      type: "command", id: "plan:pam-1", step: "plan:pam-1:1", text: "컵을 치울까요?", vision: null,
      choices: [{ id: "clear", label: "치워 주세요" }, { id: "keep", label: "그대로 둬요" }], target: null, speak: true,
    }]);
    expect(a.steps()).toEqual(["active"]);
    expect(a.t.onAnswer("plan:pam-1", "plan:pam-1:1", "done")).toBe(false);
    expect(a.t.onHeard("완료")).toBeNull();
    expect(a.t.onHeard("그냥 그대로 둬")).toMatchObject({ id: "keep", reply: "알겠어요. 그대로 둘게요" });
    expect(a.exec().at(-1)).toMatchObject({ state: "done", text: "완료: 그대로 둬요" });
    expect(a.last()).toEqual({ type: "command_clear", id: "plan:pam-1" });
    expect(a.plans.current()).toMatchObject({ status: "done", steps: [{ status: "done" }] });
    const b = setup();
    await b.decide(ask("pam-1", 1));
    expect(b.t.onAnswer("plan:pam-1", "plan:pam-1:1", "clear")).toBe(true);
    expect(b.exec().at(-1)).toMatchObject({ state: "done", text: "완료: 치워 주세요" });
    const c = setup();
    await c.decide(ask("pam-1", 1));
    c.clock.t += 120_001;
    c.t.tick();
    expect(c.exec().at(-1)).toMatchObject({ state: "failed", text: EXEC_TEXT.noAnswer });
  });

  it("다른 행동을 고른 새 판단은 진행 중 계획을 바꾸고, 실제 폰의 앞 명령을 지운 뒤 새 명령을 보낸다", async () => {
    const { t, decide, phone, plans, exec } = setup();
    await decide(decision);
    await decide(ask("pam-2", 2));
    expect(exec().find((l) => l.plan_id === "plan:pam-1" && l.state === "failed")).toMatchObject({ text: EXEC_TEXT.superseded });
    expect(phone.map((m) => [m.type, m.id])).toEqual([["command", "plan:pam-1"], ["command_clear", "plan:pam-1"], ["command", "plan:pam-2"]]);
    expect(plans.current()).toMatchObject({ id: "plan:pam-2", supersedes: "plan:pam-1", status: "running" });
  });
});

describe("실행 추적: 한 번에 한 계획, 실행 전 검사", () => {
  it("검사가 통과할 때까지 tick마다 다시 보고, 그 사이 통과하면 첫 명령을 보낸다", async () => {
    let ok = false;
    const { t, decide, clock, spoken } = setup({ check: () => (ok ? { ok: true } : { ok: false, reason: "stale", text: "x" }), recheckMs: 3000 });
    await decide(decision);
    expect(t.current()).toMatchObject({ state: "planned" });
    clock.t += 1000;
    t.tick();
    expect(t.current()).toMatchObject({ state: "planned" });
    ok = true;
    t.tick();
    expect(t.current()).toMatchObject({ state: "running" });
    expect(spoken()).toEqual(["식탁으로 가 주세요"]);
  });

  it("recheckMs가 지나도 검사를 통과하지 못하면 실패로 끝내고 이유를 남긴다. 폰에는 아무것도 보내지 않는다. 대기는 기록만", async () => {
    const { t, decide, logs, plans, phone } = setup({ check: () => ({ ok: false, reason: "in_hand", text: "사람이 그 물건을 쓰는 중이라 실행하지 않아요" }), recheckMs: 0 });
    await decide(decision);
    t.tick();
    expect(logs.at(-1)).toMatchObject({ type: "execution", state: "failed", text: "사람이 그 물건을 쓰는 중이라 실행하지 않아요" });
    expect(plans.current()?.status).toBe("failed");
    expect(phone).toEqual([]);
    await decide({ ...decision, id: "pam-2", seq: 2, action: null, prediction: { ...pred, task_index: -1 } });
    expect(logs.at(-1)).toMatchObject({ type: "execution", plan_id: "plan:pam-2", state: "decided", text: EXEC_TEXT.wait });
    await decide({ ...decision, id: "pam-3", seq: 3, status: "failed", action: null, prediction: null, error: "e" });
    expect(logs.at(-1)).toMatchObject({ type: "execution", plan_id: "plan:pam-3", state: "decided", text: EXEC_TEXT.decisionFailed });
  });

  it("periodic처럼 같은 판단이 연달아 와도 명령은 한 번이고 그 계획이 끝까지 간다", async () => {
    const { t, decide, logs, spoken } = setup();
    for (let s = 1; s <= 4; s++) await decide({ ...decision, id: `pam-${s}`, seq: s });
    expect(spoken()).toEqual(["식탁으로 가 주세요"]);
    expect(t.current()!.planId).toBe("plan:pam-1");
    expect(logs.filter((l) => l.type === "execution" && l.text === EXEC_TEXT.same).map((l) => l.type === "execution" && l.plan_id)).toEqual(["plan:pam-2", "plan:pam-3", "plan:pam-4"]);
    for (let s = 1; s <= 4; s++) t.onAnswer("plan:pam-1", `plan:pam-1:${s}`, "done");
    expect(t.current()).toMatchObject({ planId: "plan:pam-1", state: "done" });
  });

  it("지금 계획보다 먼저 보낸 판단의 답이 늦게 오면 버린다", async () => {
    const { t, decide, logs, spoken } = setup();
    await decide(ask("pam-5", 5));
    await decide({ ...decision, id: "pam-4", seq: 4 });
    expect(t.current()).toMatchObject({ planId: "plan:pam-5", state: "running" });
    expect(logs.at(-1)).toMatchObject({ type: "execution", plan_id: "plan:pam-4", text: EXEC_TEXT.late });
    expect(spoken()).toEqual(["컵을 치울까요?"]);
  });

  it("지금 명령을 알려 주고, 멈추면 더 기록하지 않고 폰에도 보내지 않는다", async () => {
    const { t, decide, logs, phone, clock } = setup();
    expect(t.openCommand()).toBeNull();
    await decide(decision);
    expect(t.openCommand()).toEqual({ planId: "plan:pam-1", stepId: "plan:pam-1:1", kind: "command", text: "식탁으로 가 주세요", choices: [expect.objectContaining({ id: "done", label: "완료" })] });
    t.stop();
    const n = logs.length;
    const m = phone.length;
    await decide({ ...decision, id: "pam-2", seq: 2, action: "사용자에게 물어보기" });
    clock.t += 60_000;
    t.tick();
    expect(t.onHeard("완료")).toBeNull();
    expect(logs).toHaveLength(n);
    expect(phone).toHaveLength(m);
  });
});

describe("실행 추적: 멈춘 집기·놓기 단계(관찰 모드 A)와 사람 부탁 다시 보내기", () => {
  const PICK_UNTIL = { any: [{ object: "cup_1", follow: true, facts: { place: "in_hand" } }, { person_holding: "cup" }] };
  const CLOSER = "컵이 보이게 가까이 비춰 주세요";

  /** stalled는 받은 알림을 모은다. accept(false)면 받지 않았다고 돌려준다. */
  function stallSetup(over: Parameters<typeof setup>[0] = {}) {
    const stalls: Stall[] = [];
    let accept = true;
    const s = setup({ ...over, stalled: (x) => { stalls.push(x); return accept; } });
    return { ...s, stalls, accept: (v: boolean) => { accept = v; } };
  }
  /** 컵 계획 2단계(집기)를 바꾼 계획. */
  function variant(change: (st: AgentStep) => AgentStep, over: Parameters<typeof setup>[0] = {}) {
    const planner = testPlanner(llm);
    return stallSetup({
      ...over,
      planner: async (d, signal) => {
        const r = await planner.plan(planContext({ decision: d, world: world([cup("present")]), floor: smallFloor() }), signal);
        if (r.ok) r.plan.steps[1] = change(r.plan.steps[1]!);
        return r;
      },
    });
  }
  /** 식탁 가기를 「완료」로 넘겨 집기 단계(시작 10초)로. */
  async function toPick(s: ReturnType<typeof stallSetup>) {
    await s.decide(decision);
    s.t.onAnswer("plan:pam-1", "plan:pam-1:1", "done");
    expect(s.steps()).toEqual(["done", "active", "pending", "pending"]);
  }

  it("집기 단계가 8초 넘게 안 끝나면 관찰 모드를 부른다. 단계 시작 뒤·받은 부름 뒤 8초마다, 단계마다 3번까지", async () => {
    expect(TRACK_DEFAULTS).toMatchObject({ stallMs: 8000, stallMax: 3 });
    const s = stallSetup();
    await toPick(s);
    s.clock.t += 7_999;
    s.t.tick();
    expect(s.stalls).toEqual([]);
    s.clock.t += 1;
    s.t.tick();
    expect(s.stalls).toHaveLength(1);
    expect(s.stalls[0]).toMatchObject({
      planId: "plan:pam-1", stepId: "plan:pam-1:2", kind: "pick", label: STEP_LABEL.pickCup, command: STEP_COMMAND.pickCup, until: PICK_UNTIL,
      stuckMs: 8000, looks: 0, spots: [{ id: "cup_1", label: "컵", position: [2, 0.75, 1] }],
    });
    expect(s.stalls[0]!.gen).toEqual(expect.any(Number));
    expect(s.stalls[0]!.signal.aborted).toBe(false);
    s.clock.t += 250;
    s.t.tick();
    expect(s.stalls).toHaveLength(1);
    for (const since of [16_000, 24_000, 32_000, 40_000]) {
      s.clock.t = 10_000 + since;
      s.t.tick();
    }
    expect(s.stalls.map((x) => [x.stepId, x.stuckMs, x.looks])).toEqual([["plan:pam-1:2", 8000, 0], ["plan:pam-1:2", 16_000, 1], ["plan:pam-1:2", 24_000, 2]]);
    expect(s.t.current()).toMatchObject({ state: "running" });
    expect(s.stalls.some((x) => x.signal.aborted)).toBe(false);
  });

  it("이동·물어보기·알림·기다리기·기기 단계와 끝난 조건 없는 사람 단계는 부르지 않는다", async () => {
    const quiet = async (s: ReturnType<typeof stallSetup>, name: string) => {
      for (let i = 0; i < 5; i++) {
        s.clock.t += 4000;
        s.t.tick();
      }
      expect(s.t.current(), name).toMatchObject({ state: "running" });
      expect(s.stalls, name).toEqual([]);
    };
    const go = stallSetup();
    await go.decide(decision);
    await quiet(go, "이동");
    const q = stallSetup();
    await q.decide(ask("pam-1", 1));
    await quiet(q, "물어보기");
    const never = () => new Promise<never>(() => {});
    const kinds: [string, (st: AgentStep) => AgentStep, Parameters<typeof setup>[0]?][] = [
      ["조건 없는 집기", (st) => ({ ...st, until: null })],
      ["알림", (st) => ({ ...st, kind: "say", command: null, text: "컵을 치우는 중이에요" })],
      ["기다리기", (st) => ({ ...st, kind: "wait", command: null })],
      ["기기", (st) => ({ ...st, kind: "device", command: null, device: { tool: "turn_on", deviceId: "ac_living", args: {} } }), { devices: { run: never, confirm: never, cancel: () => {} } }],
    ];
    for (const [name, change, over] of kinds) {
      const s = variant(change, over);
      await toPick(s);
      await quiet(s, name);
    }
  });

  it("관찰 모드가 받지 않으면(false) 세지 않고 다음 tick에 다시 부른다. 받은 부름부터 8초를 잰다", async () => {
    const s = stallSetup();
    s.accept(false);
    await toPick(s);
    s.clock.t += 8000;
    s.t.tick();
    s.clock.t += 250;
    s.t.tick();
    s.accept(true);
    s.clock.t += 250;
    s.t.tick();
    s.clock.t += 250;
    s.t.tick();
    expect(s.stalls.map((x) => [x.stuckMs, x.looks])).toEqual([[8000, 0], [8250, 0], [8500, 0]]);
    s.clock.t = 10_000 + 16_499;
    s.t.tick();
    expect(s.stalls).toHaveLength(3);
    s.clock.t += 1;
    s.t.tick();
    expect(s.stalls.at(-1)).toMatchObject({ stuckMs: 16_500, looks: 1 });
  });

  it("다음 단계로 가면 셈과 기준 시각을 다시 잡는다. 놓기 단계는 컵과 싱크대를 보고, 끝난 단계 알림의 신호는 끊긴다", async () => {
    const s = stallSetup();
    await toPick(s);
    for (let i = 0; i < 3; i++) {
      s.clock.t += 8000;
      s.t.tick();
    }
    expect(s.stalls).toHaveLength(3);
    s.clock.t += 1000;
    s.t.onAnswer("plan:pam-1", "plan:pam-1:2", "done");
    expect(s.stalls.every((x) => x.signal.aborted)).toBe(true);
    s.t.onAnswer("plan:pam-1", "plan:pam-1:3", "done");
    expect(s.last()).toMatchObject({ step: "plan:pam-1:4" });
    s.clock.t += 7_999;
    s.t.tick();
    expect(s.stalls).toHaveLength(3);
    s.clock.t += 1;
    s.t.tick();
    expect(s.stalls).toHaveLength(4);
    const place = s.stalls[3]!;
    expect(place).toMatchObject({
      planId: "plan:pam-1", stepId: "plan:pam-1:4", kind: "place", label: STEP_LABEL.placeCup, command: STEP_COMMAND.placeCup,
      until: { object: "cup_1", follow: true, facts: { place: "in_sink" } }, stuckMs: 8000, looks: 0,
      spots: [{ id: "cup_1", label: "컵", position: [2, 0.75, 1] }, SINK],
    });
    expect(place.gen).toBeGreaterThan(s.stalls[0]!.gen);
    expect(place.signal.aborted).toBe(false);
  });

  it("단계가 끝나면(시간 초과 실패·「그만」·새 계획·멈춤·계획 완료) 그 알림의 신호를 끊는다", async () => {
    const ends: [string, (s: ReturnType<typeof stallSetup>) => void | Promise<void>][] = [
      ["시간 초과", (s) => { s.clock.t += 120_001; s.t.tick(); }],
      ["그만", (s) => { s.t.onHeard("그만"); }],
      ["새 계획", (s) => s.decide(ask("pam-2", 2))],
      ["멈춤", (s) => { s.t.stop(); }],
      ["계획 완료", (s) => { s.t.onAnswer("plan:pam-1", "plan:pam-1:2", "done"); s.t.onAnswer("plan:pam-1", "plan:pam-1:3", "done"); s.clock.t += 8000; s.t.tick(); s.t.onAnswer("plan:pam-1", "plan:pam-1:4", "done"); }],
    ];
    for (const [name, end] of ends) {
      const s = stallSetup();
      await toPick(s);
      s.clock.t += 8000;
      s.t.tick();
      expect(s.stalls, name).toHaveLength(1);
      await end(s);
      expect(s.stalls.map((x) => x.signal.aborted), name).toEqual(s.stalls.map(() => true));
    }
  });

  it("사람 부탁(askCloser)은 지금 명령을 같은 계획·단계 id로 글만 바꿔 다시 보낸다(소리로 읽음). 그 뒤 다시 읽기·비전 상태도 새 글이다", async () => {
    let w = world([cup("present")]);
    const s = stallSetup({ w: () => w });
    await toPick(s);
    s.clock.t += 8000;
    s.t.tick();
    const n = s.phone.length;
    expect(s.t.askCloser("plan:pam-1", "plan:pam-1:2", CLOSER)).toBe(true);
    expect(s.phone).toHaveLength(n + 1);
    expect(s.last()).toEqual({
      type: "command", id: "plan:pam-1", step: "plan:pam-1:2", text: CLOSER, vision: "컵 · 식탁 위", choices: DONE,
      target: { id: "cup_1", label: "컵", position: [2, 0.75, 1] }, speak: true, kind: "pick",
    });
    expect(s.t.openCommand()).toEqual({ planId: "plan:pam-1", stepId: "plan:pam-1:2", kind: "command", text: CLOSER, choices: [expect.objectContaining({ id: "done", label: "완료" })] });
    // 30초 뒤 다시 읽을 때도 새 글
    s.clock.t += 29_999;
    s.t.tick();
    expect(s.phone).toHaveLength(n + 1);
    s.clock.t += 1;
    s.t.tick();
    expect(s.phone).toHaveLength(n + 2);
    expect(s.last()).toMatchObject({ step: "plan:pam-1:2", text: CLOSER, speak: true, kind: "pick" });
    // 비전 상태만 바뀐 명령도 새 글
    w = world([cup("present", "in_sink", s.clock.t)]);
    s.clock.t += 500;
    s.t.onWorld();
    expect(s.last()).toMatchObject({ step: "plan:pam-1:2", text: CLOSER, vision: "컵 · 싱크대 안", speak: false, kind: "pick" });
    // 「완료」는 그대로 받고 다음 단계는 그 단계 명령이다
    expect(s.t.onAnswer("plan:pam-1", "plan:pam-1:2", "done")).toBe(true);
    expect(s.last()).toMatchObject({ step: "plan:pam-1:3", text: STEP_COMMAND.goSink, speak: true });
    expect(s.spoken()).toEqual([STEP_COMMAND.goTable, STEP_COMMAND.pickCup, CLOSER, CLOSER, STEP_COMMAND.goSink]);
  });

  it("사람 부탁은 지금 그 계획의 그 사람 단계이고 글이 「주세요」로 끝날 때만 보낸다. 다른 단계·계획, 승인·다시 묻기·물어보기 중, 끝난 계획·멈춘 뒤면 false이고 아무것도 보내지 않는다", async () => {
    const s = stallSetup();
    await toPick(s);
    const n = s.phone.length;
    expect(s.t.askCloser("plan:pam-1", "plan:pam-1:1", CLOSER)).toBe(false);
    expect(s.t.askCloser("plan:pam-1", "plan:pam-1:3", CLOSER)).toBe(false);
    expect(s.t.askCloser("plan:pam-9", "plan:pam-1:2", CLOSER)).toBe(false);
    // 사람에게 하는 말(「주세요」로 끝남)만 보낸다
    expect(s.t.askCloser("plan:pam-1", "plan:pam-1:2", "컵을 가까이 볼게요")).toBe(false);
    expect(s.t.askCloser("plan:pam-1", "plan:pam-1:2", "")).toBe(false);
    expect(s.phone).toHaveLength(n);
    s.t.onHeard("그만");
    const m = s.phone.length;
    expect(s.t.askCloser("plan:pam-1", "plan:pam-1:2", CLOSER)).toBe(false);
    expect(s.phone).toHaveLength(m);

    const a = stallSetup({ approvals: store() });
    await a.decide(decision);
    expect(a.t.askCloser("plan:pam-1", "plan:pam-1:approve", CLOSER)).toBe(false);
    expect(a.t.askCloser("plan:pam-1", "plan:pam-1:1", CLOSER)).toBe(false);
    expect(a.phone).toHaveLength(1);

    const q = stallSetup();
    await q.decide(ask("pam-1", 1));
    expect(q.t.askCloser("plan:pam-1", "plan:pam-1:1", CLOSER)).toBe(false);
    expect(q.phone).toHaveLength(1);

    // 시간 초과로 계속할지 묻는 중: 부탁도, 관찰 모드 부름도 없다
    const g = variant((st) => ({ ...st, onTimeout: "ask" }));
    await toPick(g);
    g.clock.t += 120_001;
    g.t.tick();
    expect(g.last()).toMatchObject({ step: "plan:pam-1:2:again" });
    const k = g.phone.length;
    expect(g.t.askCloser("plan:pam-1", "plan:pam-1:2", CLOSER)).toBe(false);
    g.clock.t += 8000;
    g.t.tick();
    expect(g.phone).toHaveLength(k);
    expect(g.stalls).toEqual([]);

    const z = stallSetup();
    await toPick(z);
    z.t.stop();
    expect(z.t.askCloser("plan:pam-1", "plan:pam-1:2", CLOSER)).toBe(false);
  });

  it("가까이 봐서 지키는 중인 옛 물건(closer_hold)은 「아직 있음」으로 세지 않는다: 그 뒤 새로 보인 같은 종류 물건으로 이어 가 놓기가 비전으로 넘어간다", async () => {
    for (const hold of [false, true]) {
      let w = world([cup("present")]);
      const s = setup({ w: () => w });
      await s.decide(decision);
      for (const step of ["plan:pam-1:1", "plan:pam-1:2", "plan:pam-1:3"]) s.t.onAnswer("plan:pam-1", step, "done");
      expect(s.last()).toMatchObject({ step: "plan:pam-1:4" });
      s.clock.t += 600;
      const old: WorldObject = { ...cup("present", "in_hand", 9_000), closer_hold: hold };
      w = world([old, { ...cup("present", "in_sink", s.clock.t), id: "cup_2", position: [5, 0.9, 1], first_seen_ms: s.clock.t - 200 }]);
      s.t.onWorld();
      if (hold) {
        expect(s.last(), "지킴").toEqual({ type: "command_clear", id: "plan:pam-1" });
        expect(s.t.current(), "지킴").toMatchObject({ state: "done" });
      } else {
        expect(s.last(), "지킴 없음").toMatchObject({ step: "plan:pam-1:4", vision: "컵 · 손에 있음" });
        expect(s.t.current(), "지킴 없음").toMatchObject({ state: "running" });
      }
    }
  });
});

describe("실행 추적: 승인(처음 하는 PAM 계획)", () => {
  const APPROVE = [{ id: "approve", label: "승인" }, { id: "reject", label: "거절" }];

  it("처음 컵 치우기는 실제 폰에 「컵 치우기를 할까요?」와 승인·거절 두 단추를 띄우고, 「승인」이면 기억하고 첫 명령을 보낸다", async () => {
    const { t, decide, phone, plans, approvals, spoken, exec } = setup({ approvals: store() });
    await decide(decision);
    expect(phone).toEqual([{ type: "command", id: "plan:pam-1", step: "plan:pam-1:approve", text: "컵 치우기를 할까요?", vision: null, choices: APPROVE, target: null, speak: true }]);
    expect(APPROVAL_TEXT.ask("컵 치우기")).toBe("컵 치우기를 할까요?");
    expect(plans.current()).toMatchObject({ id: "plan:pam-1", status: "planned", steps: [{ status: "pending" }, { status: "pending" }, { status: "pending" }, { status: "pending" }] });
    expect(t.current()).toMatchObject({ state: "planned" });
    expect(t.openCommand()).toMatchObject({ planId: "plan:pam-1", stepId: "plan:pam-1:approve", kind: "ask", text: "컵 치우기를 할까요?" });
    // 「완료」와 예전 답은 승인 답이 아니다
    for (const old of ["done", "once", "always", "never"]) expect(t.onAnswer("plan:pam-1", "plan:pam-1:approve", old), old).toBe(false);
    expect(t.onHeard("완료")).toBeNull();
    expect(t.onAnswer("plan:pam-1", "plan:pam-1:approve", "approve")).toBe(true);
    expect(approvals.memory()).toEqual({ always: { "task:컵 치우기": "t" } });
    expect(spoken()).toEqual(["컵 치우기를 할까요?", "식탁으로 가 주세요"]);
    expect(phone.at(-1)).toMatchObject({ step: "plan:pam-1:1", text: "식탁으로 가 주세요", choices: [{ id: "done", label: "완료" }] });
    expect(plans.current()).toMatchObject({ status: "running" });
    expect(exec().map((l) => l.state)).toEqual(["decided", "planned", "running"]);
  });

  it("말 「승인」이면 기억하고 첫 명령으로 간다. 다음 컵 치우기는 묻지 않는다", async () => {
    const { t, decide, approvals, spoken } = setup({ approvals: store() });
    await decide(decision);
    expect(t.onHeard("승인할게요")).toMatchObject({ id: "approve", reply: "" });
    expect(approvals.memory()).toEqual({ always: { "task:컵 치우기": "t" } });
    expect(spoken()).toEqual(["컵 치우기를 할까요?", "식탁으로 가 주세요"]);
    for (let s = 1; s <= 4; s++) t.onAnswer("plan:pam-1", `plan:pam-1:${s}`, "done");
    await decide({ ...decision, id: "pam-2", seq: 2 });
    expect(spoken().at(-1)).toBe("식탁으로 가 주세요");
    expect(spoken().filter((s) => s === "컵 치우기를 할까요?")).toHaveLength(1);
  });

  it("기억에 승인이 있으면 묻지 않고 첫 명령이 바로 「식탁으로 가 주세요」", async () => {
    const { t, decide, spoken, phone } = setup({ approvals: store({ "task:컵 치우기": "approve" }) });
    await decide(decision);
    expect(spoken()).toEqual(["식탁으로 가 주세요"]);
    expect(phone.some((m) => m.type === "command" && m.step.endsWith(":approve"))).toBe(false);
  });

  it("「거절」이면 기억하지 않고 계획을 취소한다. 실행 기록은 「사용자가 거절한 일」, 다음 판단은 또 묻는다", async () => {
    const { t, decide, plans, approvals, exec, last, spoken } = setup({ approvals: store() });
    await decide(decision);
    expect(t.onHeard("거절")).toMatchObject({ id: "reject" });
    expect(approvals.memory()).toEqual({ always: {} });
    expect(last()).toEqual({ type: "command_clear", id: "plan:pam-1" });
    expect(plans.current()).toMatchObject({ id: "plan:pam-1", status: "cancelled" });
    expect(exec().at(-1)).toMatchObject({ plan_id: "plan:pam-1", state: "failed", text: APPROVAL_TEXT.refused });
    expect(APPROVAL_TEXT.refused).toBe("사용자가 거절한 일");
    await decide({ ...decision, id: "pam-2", seq: 2 });
    expect(last()).toMatchObject({ type: "command", id: "plan:pam-2", step: "plan:pam-2:approve", text: "컵 치우기를 할까요?", choices: APPROVE });
    expect(spoken()).toEqual(["컵 치우기를 할까요?", "컵 치우기를 할까요?"]);
    expect(t.onAnswer("plan:pam-2", "plan:pam-2:approve", "reject")).toBe(true);
    expect(approvals.memory()).toEqual({ always: {} });
  });

  it("예전 파일의 「하지 마」 기억은 버린다: 그 계획도 판단이 오면 다시 묻는다", async () => {
    const path = join(mkdtempSync(join(tmpdir(), "track-")), "approvals.json");
    writeFileSync(path, JSON.stringify({ always: {}, never: { "task:컵 치우기": "t0" } }));
    const { t, decide, last } = setup({ approvals: new ApprovalStore(path, () => "t") });
    await decide(decision);
    expect(last()).toMatchObject({ type: "command", step: "plan:pam-1:approve", text: "컵 치우기를 할까요?", choices: APPROVE });
  });

  it("승인 질문 중 들은 주변 말에 승인·거절 말이 들어 있어도 답으로 받지 않는다. 말 전체가 답일 때만 받는다", async () => {
    const { t, decide, approvals, spoken } = setup({ approvals: store() });
    await decide(decision);
    for (const said of ["승인 받았다고 했잖아", "그거 좋아 보여", "아니 그게 아니라", "그거 하지 마라고 했잖아", "거절당했어", "응", "네", "앞으로도 해 줘", "이번만"]) {
      expect(t.onHeard(said), said).toBeNull();
    }
    expect(approvals.memory()).toEqual({ always: {} });
    expect(spoken()).toEqual(["컵 치우기를 할까요?"]);
    expect(t.openCommand()).toMatchObject({ stepId: "plan:pam-1:approve" });
    expect(t.onHeard("응 좋아")).toMatchObject({ id: "approve" });
  });

  it("승인 답을 2분 안에 받지 못하면 실패(답을 받지 못함)로 닫는다. 그 사이 30초마다 다시 읽는다", async () => {
    const { t, decide, clock, spoken, exec, last } = setup({ approvals: store() });
    await decide(decision);
    clock.t += 30_000;
    t.tick();
    expect(spoken()).toEqual(["컵 치우기를 할까요?", "컵 치우기를 할까요?"]);
    clock.t += 90_001;
    t.tick();
    expect(exec().at(-1)).toMatchObject({ state: "failed", text: EXEC_TEXT.noAnswer });
    expect(last()).toEqual({ type: "command_clear", id: "plan:pam-1" });
  });

  it("기억이 비어 있어도 질문 계획(사용자에게 물어보기)은 승인을 묻지 않고 첫 명령이 바로 그 질문이다", async () => {
    const { t, decide, spoken, phone } = setup({ approvals: store() });
    await decide(ask("pam-1", 1));
    expect(spoken()).toEqual(["컵을 치울까요?"]);
    expect(phone[0]).toMatchObject({ step: "plan:pam-1:1", choices: [{ id: "clear", label: "치워 주세요" }, { id: "keep", label: "그대로 둬요" }] });
  });
});

describe("실행 추적 + 실제 World State(기준점을 맞춘 카메라)", () => {
  // 카메라: 트윈 (0, 1.5, 0)에서 45° 아래로 숙이고 +x를 본다(tests/world-state.test.ts와 같다). 90° 시야 투영(열 우선)
  const P = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, -1.0002, -1, 0, 0, -0.020002, 0];
  const mul = (a: number[], b: number[]) => [a[3]! * b[0]! + a[0]! * b[3]! + a[1]! * b[2]! - a[2]! * b[1]!, a[3]! * b[1]! - a[0]! * b[2]! + a[1]! * b[3]! + a[2]! * b[0]!, a[3]! * b[2]! + a[0]! * b[1]! - a[1]! * b[0]! + a[2]! * b[3]!, a[3]! * b[3]! - a[0]! * b[0]! - a[1]! * b[1]! - a[2]! * b[2]!];
  const tilt = [Math.sin(-Math.PI / 8), 0, 0, Math.cos(-Math.PI / 8)];
  const look: CameraView = { origin: [0, 1.5, 0], orientation: mul([0, Math.sin(-Math.PI / 4), 0, Math.cos(-Math.PI / 4)], tilt) as [number, number, number, number], theta: 0, projection: P };
  const frame = (i: number): EngineFrame => ({ id: `e${i}`, capturedAtMs: i * 1000, latestAtMs: i * 1000, jpeg: Buffer.from(`${i}`), sha256: sha256(Buffer.from(`${i}`)), width: 480, height: 360, eye: null, view: look });
  const box = (b: [number, number, number, number]): Detection => ({ label: "cup", score: 0.9, cls: 41, box: b });
  const onTable = box([220, 160, 40, 20]);
  const moved = box([60, 300, 40, 20]);

  it("식탁 위 컵을 들어 옮기면 새 id(cup_2)가 붙어도 집기·내려놓기가 비전으로 넘어가고 비전 상태 줄이 그 컵을 따라간다", async () => {
    const ws = new WorldState({
      surfaces: () => [{ id: "table_1", label: "식탁", center: [2, 0], top: 0.75, radius: 0.6 }, { id: "sink_1", label: "싱크대", center: [1.2, 0.8], top: 0.9, radius: 0.5 }],
      floorAt: () => 0, roomAt: () => ({ id: "kitchen", label: "주방" }), devices: () => [],
    });
    const see = (i: number, d: Detection, state: "on_table" | "in_hand" | "in_sink") => {
      const { ids } = ws.applyDetections(frame(i), [d]);
      ws.applyScene(`e${i}`, i * 1000, { scene: "k", observations: [{ object_id: "d1", state }], summary: "s" }, ids);
    };
    for (let i = 1; i <= 3; i++) see(i, onTable, "on_table");
    const { t, decide, last, clock } = setup({ w: () => ws.view(10_000) });
    clock.t = 3_500;
    await decide({ ...decision, atMs: 0 });
    t.onAnswer("plan:pam-1", "plan:pam-1:1", "done");
    expect(last()).toMatchObject({ step: "plan:pam-1:2", vision: "컵 · 식탁 위" });
    for (let i = 4; i <= 6; i++) see(i, moved, "in_hand");
    expect(ws.view(6000).objects.map((o) => [o.id, o.status])).toEqual([["cup_1", "gone"], ["cup_2", "present"]]);
    t.onWorld();
    expect(last()).toMatchObject({ step: "plan:pam-1:3", vision: "컵 · 손에 있음 · 싱크대까지 거리 모름" });
    t.onAnswer("plan:pam-1", "plan:pam-1:3", "done");
    see(7, moved, "in_sink");
    t.onWorld();
    expect(last()).toEqual({ type: "command_clear", id: "plan:pam-1" });
  });

  it("관절: 손목이 컵 상자 안이면 같은 프레임 VLM 답이 「식탁 위」여도 「컵을 들어 주세요」 단계가 비전으로 넘어간다. 손목이 멀면 넘기지 않는다", async () => {
    const ws = new WorldState({
      surfaces: () => [{ id: "table_1", label: "식탁", center: [2, 0], top: 0.75, radius: 0.6 }],
      floorAt: () => 0, roomAt: () => ({ id: "kitchen", label: "주방" }), devices: () => [],
    });
    const person: Detection = { label: "person", score: 0.9, cls: 0, box: [150, 40, 160, 300] };
    for (let i = 1; i <= 3; i++) {
      const { ids } = ws.applyDetections(frame(i), [onTable]);
      ws.applyScene(`e${i}`, i * 1000, { scene: "k", observations: [{ object_id: "d1", state: "on_table" }], summary: "s" }, ids);
    }
    const { t, decide, last, clock } = setup({ w: () => ws.view(10_000) });
    clock.t = 3_500;
    await decide({ ...decision, atMs: 0 });
    t.onAnswer("plan:pam-1", "plan:pam-1:1", "done");
    expect(last()).toMatchObject({ step: "plan:pam-1:2", text: STEP_COMMAND.pickCup, vision: "컵 · 식탁 위" });
    const grab = (i: number, wrist: [number, number]) => {
      const { ids } = ws.applyDetections(frame(i), [person, onTable], [standing({ 10: [...wrist, 0.9] }, [150, 40, 160, 300])]);
      ws.applyScene(`e${i}`, i * 1000, { scene: "k", observations: [{ object_id: "d2", state: "on_table" }], summary: "s" }, ids);
      t.onWorld();
    };
    grab(4, [160, 300]); // 손목이 컵 상자 [220, 160, 40, 20]에서 멀다
    expect(last()).toMatchObject({ step: "plan:pam-1:2", vision: "컵 · 식탁 위" });
    grab(5, [235, 170]); // 손목이 컵 상자 안
    expect(ws.view(5000).objects[0]!.facts.place?.value).toBe("in_hand");
    expect(last()).toMatchObject({ step: "plan:pam-1:3", text: STEP_COMMAND.goSink, vision: "컵 · 손에 있음 · 싱크대까지 거리 모름" });
  });
});
