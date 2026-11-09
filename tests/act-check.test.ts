import { describe, expect, it } from "vitest";
import { checkDecision, checkPlan, loadActConfig, type CheckInput } from "../src/act/check.js";
import { CHECK_TEXT } from "../src/plan/labels.js";
import type { WorldObject } from "../src/contract/world.js";

const obj = (over: Partial<WorldObject> = {}): WorldObject => ({
  id: "cup_1", cls: "cup", position: [2, 0.75, 0], surface: "t", surface_label: "식탁", room: "kitchen", error_m: 0.1, status: "present",
  first_seen_ms: 0, last_seen_ms: 9_000, last_in_view_ms: 9_000, facts: {}, answered_ms: null, devices: [], ...over,
});
const base = (over: Partial<CheckInput> = {}): CheckInput => ({
  decision: {
    id: "pam-1", seq: 1, atMs: 8_000, textSent: "t", finalTime: "x", status: "valid", prediction: { observation: "o", reasoning: "r", task_index: 0 }, action: "컵 치우기", memoryVersion: 1,
    world: { objects: [], person_visible: false, vlm_missing: 0, yolo_missing: 0 },
  },
  tasks: ["컵 치우기", "사용자에게 물어보기"],
  plan: {
    id: "plan:pam-1", revision: 1, source: "brain", goal: "g", judgment: "r", dryRun: true, robot: { position: [0, 0], room: "living" }, path: [[0, 0], [2, 0]], legs: [{ stepId: "s1", end: 1 }],
    steps: [{ id: "s1", kind: "move", label: "l", target: { objectId: "table_1" }, status: "pending" }, { id: "s2", kind: "act", label: "l", target: { objectId: "cup_1" }, status: "pending" }],
    status: "planned", updatedAt: "",
  },
  world: { at_ms: 10_000, objects: [obj()], person: { visible: false, since_ms: 0, last_seen_ms: null, count: 0, room: null, room_label: null, position: null, near: [], holding: [], position_ms: null, answered_ms: null, facts: {} }, fixtures: [], devices: [], eye: null, frame_ms: null, vlm_missing: 0, yolo_missing: 0 },
  nowMs: 10_000, staleMs: 3000, mode: "test", ...over,
});
const fact = (value: string) => ({ value, at_ms: 9_000, since_ms: 9_000, certainty: "inferred" as const });

describe("실행 전 검사", () => {
  it("판단 뒤에 다시 본 대상, 갈 수 있는 길이면 통과", () => expect(checkPlan(base())).toEqual({ ok: true }));
  it("목록 밖 행동, 계획 없음", () => {
    expect(checkPlan(base({ decision: { ...base().decision, action: "춤추기" } }))).toEqual({ ok: false, reason: "unknown_task", text: CHECK_TEXT.unknown_task });
    expect(checkPlan(base({ tasks: ["사용자에게 물어보기"] }))).toMatchObject({ reason: "unknown_task" });
    expect(checkPlan(base({ plan: null }))).toMatchObject({ reason: "unknown_task" });
  });
  it("대상 물건이 World State에 없거나 사라짐", () => {
    expect(checkPlan(base({ world: { ...base().world, objects: [] } }))).toMatchObject({ reason: "no_target" });
    expect(checkPlan(base({ world: { ...base().world, objects: [obj({ status: "gone" })] } }))).toMatchObject({ reason: "no_target" });
  });
  it("대상이 이미 싱크대 안이거나, 남은 같은 종류 물건이 모두 싱크대 안", () => {
    const inSink = { place: fact("in_sink") };
    expect(checkPlan(base({ world: { ...base().world, objects: [obj({ facts: inSink })] } }))).toEqual({ ok: false, reason: "in_sink", text: CHECK_TEXT.in_sink });
    const noTarget = { ...base().plan!, steps: [base().plan!.steps[0]!, { ...base().plan!.steps[1]!, target: { objectId: "table_1" } }] };
    expect(checkPlan(base({ plan: noTarget, world: { ...base().world, objects: [obj({ facts: inSink })] } }))).toMatchObject({ reason: "in_sink" });
    expect(checkPlan(base({ plan: noTarget, world: { ...base().world, objects: [obj({ facts: inSink, status: "gone" })] } }))).toMatchObject({ reason: "no_target" });
  });
  it("판단 뒤에 다시 보지 않았거나 STALE_MS가 넘은 근거", () => {
    expect(checkPlan(base({ world: { ...base().world, objects: [obj({ last_seen_ms: 8_000 })] } }))).toMatchObject({ reason: "stale" });
    expect(checkPlan(base({ nowMs: 12_001 }))).toMatchObject({ reason: "stale" });
    expect(checkPlan(base({ nowMs: 12_000 }))).toEqual({ ok: true });
  });
  it("사람이 그 물건을 들고 있거나 쓰는 중", () => {
    for (const facts of [{ place: fact("in_hand") }, { use: fact("in_use") }]) {
      expect(checkPlan(base({ world: { ...base().world, objects: [obj({ facts })] } }))).toMatchObject({ reason: "in_hand", text: CHECK_TEXT.in_hand });
    }
    const holding = { ...base().world, person: { visible: true, since_ms: 0, last_seen_ms: 9_000, count: 0, room: null, room_label: null, position: null, near: [], holding: [], position_ms: null, answered_ms: null, facts: { holding: fact("holding_object") } } };
    expect(checkPlan(base({ world: holding }))).toMatchObject({ reason: "in_hand" });
  });
  it("물어보기는 대상 물건을 보지 않는다", () => {
    const ask = base({
      decision: { ...base().decision, action: "사용자에게 물어보기", prediction: { observation: "o", reasoning: "r", task_index: 1 } },
      plan: { ...base().plan!, path: [], legs: [], steps: [{ id: "s1", kind: "ask", label: "l", status: "pending" }] }, world: { ...base().world, objects: [] },
    });
    expect(checkPlan(ask)).toEqual({ ok: true });
  });
  it("이동 단계가 있는데 경로가 없음", () => {
    expect(checkPlan(base({ plan: { ...base().plan!, path: [], legs: [] } }))).toMatchObject({ reason: "unreachable" });
  });
  it("시험 모드에서 짝지은 실제 가전 단계는 막는다", () => {
    expect(checkPlan(base({ deviceSteps: [{ deviceId: "aircon_1", paired: true }] }))).toMatchObject({ reason: "device_mode" });
    expect(checkPlan(base({ deviceSteps: [{ deviceId: "aircon_1", paired: false }] }))).toEqual({ ok: true });
    expect(checkPlan(base({ mode: "live", deviceSteps: [{ deviceId: "aircon_1", paired: true }] }))).toEqual({ ok: true });
  });
  it("STALE_MS 기본 3000, 틀린 값이면 시작을 막는다", () => {
    expect(loadActConfig({}).staleMs).toBe(3000);
    expect(loadActConfig({ STALE_MS: "60000" }).staleMs).toBe(60_000);
    expect(() => loadActConfig({ STALE_MS: "-1" })).toThrow(/STALE_MS/);
    expect(() => loadActConfig({ STALE_MS: "abc" })).toThrow(/STALE_MS/);
  });
});

describe("계획 전 검사(에이전트를 부르기 전)", () => {
  const w = (objects: WorldObject[]) => ({ ...base().world, objects });
  const pre = (objects: WorldObject[], action = "컵 치우기") => checkDecision({ decision: { ...base().decision, action }, tasks: base().tasks, world: w(objects) });
  it("지금 보이는 치우지 않은 대상이 있어야 부른다. 시야 밖의 낡은 컵·싱크대 안 컵만 있으면 부르지 않는다", () => {
    expect(pre([obj()])).toEqual({ ok: true });
    expect(pre([obj({ status: "out_of_view" })])).toMatchObject({ reason: "no_target" });
    expect(pre([obj({ facts: { place: { value: "in_sink", at_ms: 0, since_ms: 0, certainty: "confirmed" } } })])).toMatchObject({ reason: "in_sink" });
    expect(pre([], "춤추기")).toMatchObject({ reason: "unknown_task" });
    expect(pre([], "사용자에게 물어보기")).toEqual({ ok: true });
  });
});
