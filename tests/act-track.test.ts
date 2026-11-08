// 실행 추적(src/act/track.ts): 실제 폰은 에이전트의 손이다. 계획 단계마다 사람에게 명령 하나를 보내고, 그 단계가 됐는지를
// 폰 눈 위치(이동)와 World State(컵 자리)로 본 뒤 다음 명령을 보낸다. 「완료」(단추·말)는 지금 단계 하나를 넘기고 「그만」은 계획을 그만둔다.
import { describe, expect, it } from "vitest";
import { ExecutionTracker, TRACK_DEFAULTS, type TrackerOptions } from "../src/act/track.js";
import type { CheckResult } from "../src/act/check.js";
import type { BrainLog } from "../src/contract/events.js";
import type { PhoneCommand, PhoneCommandMessage } from "../src/contract/phone.js";
import type { WorldObject, WorldView } from "../src/contract/world.js";
import { PlanHub } from "../src/plan/hub.js";
import { EXEC_TEXT, STEP_COMMAND } from "../src/plan/labels.js";
import type { DecisionRecord } from "../src/world/decide.js";
import { smallFloor } from "./helpers/floor.js";

// smallFloor: 로봇 [1, 2], 식탁 table_1 [7, 3], 싱크대 sink_1 [5, 1]
const cup = (status: WorldObject["status"], place?: string, seen = 9_000): WorldObject => ({
  id: "cup_1", cls: "cup", position: [2, 0.75, 1], surface: "t", surface_label: "식탁", room: "hall", error_m: 0.1, status,
  first_seen_ms: 0, last_seen_ms: seen, last_in_view_ms: seen, facts: place ? { place: { value: place, at_ms: seen, certainty: "confirmed" } } : {}, devices: [],
});
const world = (objects: WorldObject[], personAction?: string): WorldView => ({
  at_ms: 0, objects, person: { visible: !!personAction, since_ms: 0, last_seen_ms: null, facts: personAction ? { action: { value: personAction, at_ms: 0, certainty: "confirmed" } } : {} },
  devices: [], eye: null, vlm_missing: 0, yolo_missing: 0,
});
const pred = { observation: "o", reasoning: "r", task_index: 0 };
const decision: DecisionRecord = {
  id: "pam-1", seq: 1, atMs: 8_000, textSent: "t", finalTime: "x", status: "valid", prediction: pred, action: "컵 치우기", memoryVersion: 1,
  world: { objects: [], person_visible: false, vlm_missing: 0, yolo_missing: 0 },
};
const ask = (id: string, seq: number): DecisionRecord => ({ ...decision, id, seq, action: "사용자에게 물어보기", prediction: { ...pred, task_index: 1 } });
const DONE = [{ id: "done", label: "완료" }];

function setup(over: Partial<TrackerOptions> & { w?: () => WorldView; check?: () => CheckResult } = {}) {
  const logs: BrainLog[] = [];
  const phone: PhoneCommandMessage[] = [];
  const clock = { t: 10_000, now() { return this.t; } };
  const plans = new PlanHub(smallFloor(), () => {}, () => "t");
  const t = new ExecutionTracker({
    plans, world: over.w ?? (() => world([cup("present")])), check: over.check ?? (() => ({ ok: true })), floor: () => plans.floor(),
    toPhone: (m) => phone.push(m), emit: (l) => logs.push(l), clock, ...over,
  });
  const exec = () => logs.flatMap((l) => (l.type === "execution" ? [l] : []));
  const commands = () => phone.flatMap((m) => (m.type === "command" ? [m] : []));
  /** 새로 읽은 명령(speak)만. */
  const spoken = () => commands().filter((m) => m.speak).map((m) => m.text);
  const last = () => phone.at(-1) as PhoneCommand;
  const steps = () => plans.current()!.steps.map((s) => s.status);
  return { t, logs, phone, clock, plans, exec, commands, spoken, last, steps };
}

describe("실행 추적: 단계마다 실제 폰 명령", () => {
  it("컵 치우기는 단계마다 사람에게 하는 명령 하나를 보내고, 폰 위치와 World State로 그 단계가 된 것을 본 뒤 다음 명령을 보낸다", () => {
    let w = world([cup("present")]);
    const { t, phone, clock, plans, exec, commands, spoken, last, steps } = setup({ w: () => w });
    t.onDecision(decision);
    // 1 이동: 폰 눈을 아직 모르면 거리 모름
    expect(phone).toEqual([{ type: "command", id: "plan:pam-1", step: "plan:pam-1:1", text: "식탁으로 가 주세요", vision: "식탁까지 거리 모름", choices: DONE, speak: true }]);
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
    expect(last()).toEqual({ type: "command", id: "plan:pam-1", step: "plan:pam-1:2", text: "컵을 들어 주세요", vision: "컵 · 식탁 위", choices: DONE, speak: true });
    expect(steps()).toEqual(["done", "active", "pending", "pending"]);
    clock.t += 600;
    w = world([cup("present", "in_hand")]);
    t.onWorld();
    // 3 이동: 컵이 손에 있음
    expect(last()).toMatchObject({ step: "plan:pam-1:3", text: "싱크대로 가 주세요", vision: "컵 · 손에 있음 · 싱크대까지 2.3m", speak: true });
    expect(steps()).toEqual(["done", "done", "active", "pending"]);
    clock.t += 600;
    t.onEye([5.3, 1.5]);
    t.tick();
    // 4 내려놓기
    expect(last()).toMatchObject({ step: "plan:pam-1:4", text: "컵을 싱크대에 넣어 주세요", vision: "컵 · 손에 있음", speak: true });
    expect(steps()).toEqual(["done", "done", "done", "active"]);
    clock.t += 600;
    w = world([cup("present", "in_sink")]);
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

  it("집기는 사람이 물건을 들고 있어도(holding_object) 된 것으로 본다", () => {
    let w = world([cup("present")]);
    const { t, last } = setup({ w: () => w });
    t.onDecision(decision);
    t.onAnswer("plan:pam-1", "plan:pam-1:1", "done");
    expect(last()).toMatchObject({ step: "plan:pam-1:2" });
    w = world([cup("present")], "holding_object");
    t.onWorld();
    expect(last()).toMatchObject({ step: "plan:pam-1:3", text: "싱크대로 가 주세요" });
  });

  it("완료 단추와 말(완료·다 했어)은 지금 단계 하나만 넘긴다. 지난 단계·다른 계획·없는 답은 무시한다", () => {
    const { t, spoken, steps, last } = setup();
    t.onDecision(decision);
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

  it("한 번 볼 때 한 단계만 넘긴다: 컵을 든 채 싱크대 옆이어도 집기 다음 tick에 이동을 넘긴다", () => {
    let w = world([cup("present")]);
    const { t, steps } = setup({ w: () => w });
    t.onDecision(decision);
    t.onAnswer("plan:pam-1", "plan:pam-1:1", "done");
    w = world([cup("present", "in_hand")]);
    t.onEye([5, 1.5]);
    t.tick();
    expect(steps()).toEqual(["done", "done", "active", "pending"]);
    t.tick();
    expect(steps()).toEqual(["done", "done", "done", "active"]);
  });

  it("말로 「그만」이면 명령을 지우고 계획을 취소한다. 실행 기록은 실패(그만둠)", () => {
    const { t, plans, exec, last } = setup();
    t.onDecision(decision);
    t.onAnswer("plan:pam-1", "plan:pam-1:1", "done");
    expect(t.onHeard("이제 그만")).toMatchObject({ id: "stop", reply: "" });
    expect(last()).toEqual({ type: "command_clear", id: "plan:pam-1" });
    expect(plans.current()).toMatchObject({ status: "cancelled", steps: [{ status: "done" }, { status: "skipped" }, { status: "skipped" }, { status: "skipped" }] });
    expect(exec().at(-1)).toMatchObject({ state: "failed", text: EXEC_TEXT.stopped });
    expect(t.openCommand()).toBeNull();
    expect(t.onHeard("그만")).toBeNull();
  });

  it("한 단계가 오래 걸리면 30초마다 명령을 다시 읽고, 2분이 지나면 실패로 닫는다. 다음 단계로 가면 다시 잰다", () => {
    expect(TRACK_DEFAULTS).toEqual({ arriveM: 1.2, repeatMs: 30_000, stepTimeoutMs: 120_000, visionMs: 500, recheckMs: 3000 });
    const { t, clock, spoken, plans, exec, last } = setup();
    t.onDecision(decision);
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

  it("비전 상태는 바뀔 때만, 0.5초에 한 번까지 보낸다", () => {
    const { t, clock, phone } = setup();
    t.onDecision(decision);
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

  it("물어보기는 같은 자리에 질문과 답 단추를 띄우고, 답(단추·말)을 받으면 명령을 지우고 완료. 「완료」 단추는 없다", () => {
    const a = setup();
    a.t.onDecision(ask("pam-1", 1));
    expect(a.phone).toEqual([{
      type: "command", id: "plan:pam-1", step: "plan:pam-1:1", text: "컵을 치울까요?", vision: null,
      choices: [{ id: "clear", label: "치워 주세요" }, { id: "keep", label: "그대로 둬요" }], speak: true,
    }]);
    expect(a.steps()).toEqual(["active"]);
    expect(a.t.onAnswer("plan:pam-1", "plan:pam-1:1", "done")).toBe(false);
    expect(a.t.onHeard("완료")).toBeNull();
    expect(a.t.onHeard("그냥 그대로 둬")).toMatchObject({ id: "keep", reply: "알겠어요. 그대로 둘게요" });
    expect(a.exec().at(-1)).toMatchObject({ state: "done", text: "완료: 그대로 둬요" });
    expect(a.last()).toEqual({ type: "command_clear", id: "plan:pam-1" });
    expect(a.plans.current()).toMatchObject({ status: "done", steps: [{ status: "done" }] });
    const b = setup();
    b.t.onDecision(ask("pam-1", 1));
    expect(b.t.onAnswer("plan:pam-1", "plan:pam-1:1", "clear")).toBe(true);
    expect(b.exec().at(-1)).toMatchObject({ state: "done", text: "완료: 치워 주세요" });
    const c = setup();
    c.t.onDecision(ask("pam-1", 1));
    c.clock.t += 120_001;
    c.t.tick();
    expect(c.exec().at(-1)).toMatchObject({ state: "failed", text: EXEC_TEXT.noAnswer });
  });

  it("다른 행동을 고른 새 판단은 진행 중 계획을 바꾸고, 실제 폰의 앞 명령을 지운 뒤 새 명령을 보낸다", () => {
    const { t, phone, plans, exec } = setup();
    t.onDecision(decision);
    t.onDecision(ask("pam-2", 2));
    expect(exec().find((l) => l.plan_id === "plan:pam-1" && l.state === "failed")).toMatchObject({ text: EXEC_TEXT.superseded });
    expect(phone.map((m) => [m.type, m.id])).toEqual([["command", "plan:pam-1"], ["command_clear", "plan:pam-1"], ["command", "plan:pam-2"]]);
    expect(plans.current()).toMatchObject({ id: "plan:pam-2", supersedes: "plan:pam-1", status: "running" });
  });
});

describe("실행 추적: 한 번에 한 계획, 실행 전 검사", () => {
  it("검사가 통과할 때까지 tick마다 다시 보고, 그 사이 통과하면 첫 명령을 보낸다", () => {
    let ok = false;
    const { t, clock, spoken } = setup({ check: () => (ok ? { ok: true } : { ok: false, reason: "stale", text: "x" }), recheckMs: 3000 });
    t.onDecision(decision);
    expect(t.current()).toMatchObject({ state: "planned" });
    clock.t += 1000;
    t.tick();
    expect(t.current()).toMatchObject({ state: "planned" });
    ok = true;
    t.tick();
    expect(t.current()).toMatchObject({ state: "running" });
    expect(spoken()).toEqual(["식탁으로 가 주세요"]);
  });

  it("recheckMs가 지나도 검사를 통과하지 못하면 실패로 끝내고 이유를 남긴다. 폰에는 아무것도 보내지 않는다. 대기는 기록만", () => {
    const { t, logs, plans, phone } = setup({ check: () => ({ ok: false, reason: "in_hand", text: "사람이 그 물건을 쓰는 중이라 실행하지 않아요" }), recheckMs: 0 });
    t.onDecision(decision);
    t.tick();
    expect(logs.at(-1)).toMatchObject({ type: "execution", state: "failed", text: "사람이 그 물건을 쓰는 중이라 실행하지 않아요" });
    expect(plans.current()?.status).toBe("failed");
    expect(phone).toEqual([]);
    t.onDecision({ ...decision, id: "pam-2", seq: 2, action: null, prediction: { ...pred, task_index: -1 } });
    expect(logs.at(-1)).toMatchObject({ type: "execution", plan_id: "plan:pam-2", state: "decided", text: EXEC_TEXT.wait });
    t.onDecision({ ...decision, id: "pam-3", seq: 3, status: "failed", action: null, prediction: null, error: "e" });
    expect(logs.at(-1)).toMatchObject({ type: "execution", plan_id: "plan:pam-3", state: "decided", text: EXEC_TEXT.decisionFailed });
  });

  it("periodic처럼 같은 판단이 연달아 와도 명령은 한 번이고 그 계획이 끝까지 간다", () => {
    const { t, logs, spoken } = setup();
    for (let s = 1; s <= 4; s++) t.onDecision({ ...decision, id: `pam-${s}`, seq: s });
    expect(spoken()).toEqual(["식탁으로 가 주세요"]);
    expect(t.current()!.planId).toBe("plan:pam-1");
    expect(logs.filter((l) => l.type === "execution" && l.text === EXEC_TEXT.same).map((l) => l.type === "execution" && l.plan_id)).toEqual(["plan:pam-2", "plan:pam-3", "plan:pam-4"]);
    for (let s = 1; s <= 4; s++) t.onAnswer("plan:pam-1", `plan:pam-1:${s}`, "done");
    expect(t.current()).toMatchObject({ planId: "plan:pam-1", state: "done" });
  });

  it("지금 계획보다 먼저 보낸 판단의 답이 늦게 오면 버린다", () => {
    const { t, logs, spoken } = setup();
    t.onDecision(ask("pam-5", 5));
    t.onDecision({ ...decision, id: "pam-4", seq: 4 });
    expect(t.current()).toMatchObject({ planId: "plan:pam-5", state: "running" });
    expect(logs.at(-1)).toMatchObject({ type: "execution", plan_id: "plan:pam-4", text: EXEC_TEXT.late });
    expect(spoken()).toEqual(["컵을 치울까요?"]);
  });

  it("지금 명령을 알려 주고, 멈추면 더 기록하지 않고 폰에도 보내지 않는다", () => {
    const { t, logs, phone, clock } = setup();
    expect(t.openCommand()).toBeNull();
    t.onDecision(decision);
    expect(t.openCommand()).toEqual({ planId: "plan:pam-1", stepId: "plan:pam-1:1", kind: "pick_place", text: "식탁으로 가 주세요", choices: [expect.objectContaining({ id: "done", label: "완료" })] });
    t.stop();
    const n = logs.length;
    const m = phone.length;
    t.onDecision({ ...decision, id: "pam-2", seq: 2, action: "사용자에게 물어보기" });
    clock.t += 60_000;
    t.tick();
    expect(t.onHeard("완료")).toBeNull();
    expect(logs).toHaveLength(n);
    expect(phone).toHaveLength(m);
  });
});
