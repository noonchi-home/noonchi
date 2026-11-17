import { describe, expect, it } from "vitest";
import { checkDecision, checkPlan, loadActConfig, type CheckInput } from "../src/act/check.js";
import { CHECK_TEXT } from "../src/act/labels.js";
import type { WorldObject } from "../src/contract/world.js";
import { planObjectOf } from "../src/act/tasks.js";

const obj = (over: Partial<WorldObject> = {}): WorldObject => ({
  id: "cup_1", cls: "cup", position: [2, 0.75, 0], surface: "t", surface_label: "식탁", room: "kitchen", error_m: 0.1, status: "present",
  first_seen_ms: 0, last_seen_ms: 9_000, last_in_view_ms: 9_000, facts: {}, answered_ms: null, devices: [], closer_hold: false, followed_by: null, ...over,
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

describe("행동 조건(내용물)", () => {
  type C = { value: string; certainty: "confirmed" | "inferred" };
  const fill = (contents?: C, over: Partial<WorldObject> = {}) => base({
    decision: { ...base().decision, action: "컵에 물 채워 주기" }, tasks: ["컵에 물 채워 주기", "컵 그대로 두기"],
    world: { ...base().world, objects: [obj({ facts: contents ? { contents: { ...contents, at_ms: 9_000, since_ms: 9_000 } } : {}, ...over })] },
  });
  const pre = (i: CheckInput) => checkDecision({ decision: i.decision, tasks: i.tasks, world: i.world });
  it("계획 전 검사: 확인된 반대 값이면 막고, 모르면 계획으로 넘긴다(실행 전 검사가 붙잡는다)", () => {
    expect(pre(fill({ value: "has_contents", certainty: "confirmed" }))).toEqual({ ok: false, reason: "contents_mismatch", text: CHECK_TEXT.contents_mismatch });
    expect(pre(fill({ value: "empty", certainty: "inferred" }))).toEqual({ ok: true });
    expect(pre(fill({ value: "empty", certainty: "confirmed" }))).toEqual({ ok: true });
  });
  it("계획 없는 행동(그대로 두기)은 모르면 계획 전 검사가 막는다(묻지 않는다)", () => {
    const keep = (c?: C) => ({ ...fill(c), decision: { ...base().decision, action: "컵 그대로 두기" } });
    expect(pre(keep({ value: "has_contents", certainty: "inferred" }))).toMatchObject({ ok: false, reason: "contents_unknown" });
    expect(pre(keep({ value: "has_contents", certainty: "confirmed" }))).toEqual({ ok: true });
    expect(pre(keep({ value: "empty", certainty: "confirmed" }))).toMatchObject({ reason: "contents_mismatch" });
  });
  it("실행 전 검사: 계획의 대상 컵이 모르면 contents_unknown과 그 컵 id, 확인된 반대 값이면 contents_mismatch. 낡음·들고 있음 뒤에 본다", () => {
    expect(checkPlan(fill({ value: "empty", certainty: "inferred" }))).toEqual({ ok: false, reason: "contents_unknown", text: CHECK_TEXT.contents_unknown, object: "cup_1" });
    expect(checkPlan(fill({ value: "has_contents", certainty: "confirmed" }))).toMatchObject({ reason: "contents_mismatch" });
    expect(checkPlan(fill({ value: "empty", certainty: "confirmed" }))).toEqual({ ok: true });
    expect(checkPlan(fill({ value: "empty", certainty: "inferred" }, { last_seen_ms: 1_000 }))).toMatchObject({ reason: "stale" });
    expect(checkPlan(fill({ value: "empty", certainty: "inferred" }, { facts: { place: { value: "in_hand", at_ms: 9_000, since_ms: 9_000, certainty: "confirmed" } } }))).toMatchObject({ reason: "in_hand" });
  });
});

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
  it("실행 추적이 놓기 단계를 끝낸 물건(placed)은 이미 치운 것이라 계획 전 검사·실행 전 검사가 막는다", () => {
    const placed = new Map([["cup_1", { target: "sink_1", atMs: 9_000 }]]);
    expect(checkPlan(base({ placed }))).toEqual({ ok: false, reason: "in_sink", text: CHECK_TEXT.in_sink });
    expect(checkDecision({ decision: base().decision, tasks: base().tasks, world: base().world, placed })).toMatchObject({ reason: "in_sink" });
    expect(checkDecision({ decision: base().decision, tasks: base().tasks, world: base().world })).toEqual({ ok: true });
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
  // Codex(a2cf199): 검사를 막은 물건과 들고 감 보호 중인 물건이 같은지 보지 않아, 다른 물건의 보호가 다시 보기 기한을 끝없이 멈췄다
  it("손에 있음이 대상 물건의 들고 감 보호에서만 오면 carried를 붙인다(쓰는 중·보호 아님이면 붙이지 않는다)", () => {
    const carried = obj({ facts: { place: fact("in_hand") }, carried: true });
    expect(checkPlan(base({ world: { ...base().world, objects: [carried] } }))).toEqual({ ok: false, reason: "in_hand", text: CHECK_TEXT.in_hand, carried: true });
    const inUse = obj({ facts: { place: fact("in_hand"), use: fact("in_use") }, carried: true });
    expect(checkPlan(base({ world: { ...base().world, objects: [inUse] } }))).toEqual({ ok: false, reason: "in_hand", text: CHECK_TEXT.in_hand });
    expect(checkPlan(base({ world: { ...base().world, objects: [obj({ facts: { place: fact("in_hand") } })] } }))).toEqual({ ok: false, reason: "in_hand", text: CHECK_TEXT.in_hand });
  });

  describe("채워 주기: 대상은 계획 단계 대상 가운데 그 행동의 대상 종류(컵)", () => {
    const person = (holding: string[]) => ({ ...base().world.person, visible: true, last_seen_ms: 9_000, holding, facts: { holding: fact("holding_object") } });
    const bottle = obj({ id: "bottle_1", cls: "bottle" });
    // 채워 주기의 조건(컵 비어 있음)이 확인된 컵(이 묶음은 내용물 말고 다른 검사를 본다)
    const emptyCup = (over: Partial<WorldObject> = {}) => obj({ ...over, facts: { contents: { value: "empty", at_ms: 9_000, since_ms: 9_000, certainty: "confirmed" }, ...over.facts } });
    const fill = (over: Partial<CheckInput> = {}): CheckInput => base({
      world: { ...base().world, objects: [emptyCup()] },
      decision: { ...base().decision, action: "컵에 물 채워 주기", prediction: { observation: "o", reasoning: "r", task_index: 5 } },
      tasks: ["컵 치우기", "사용자에게 물어보기", "세탁물 건조기로 옮기기", "에어컨 켜기", "컵 그대로 두기", "컵에 물 채워 주기", "컵에 콜라 따라 주기"],
      plan: {
        ...base().plan!, legs: [{ stepId: "s1", end: 1 }, { stepId: "s3", end: 1 }],
        steps: [
          { id: "s1", kind: "move", label: "l", target: { objectId: "fridge_1" }, status: "pending" }, { id: "s2", kind: "act", label: "l", target: { objectId: "fridge_1" }, status: "pending" },
          { id: "s3", kind: "move", label: "l", target: { objectId: "table_1" }, status: "pending" }, { id: "s4", kind: "act", label: "l", target: { objectId: "cup_1" }, status: "pending" },
        ],
      },
      ...over,
    });
    it("첫 act 단계가 냉장고에서 집기여도 넷째 단계 대상 컵을 판단 뒤에 다시 봤으면 통과한다", () => {
      expect(checkPlan(fill())).toEqual({ ok: true });
      expect(planObjectOf(fill().plan!, fill().world, "cup")).toBe("cup_1");
      expect(planObjectOf(fill().plan!, fill().world, "bottle")).toBeNull();
      expect(checkPlan(fill({ world: { ...base().world, objects: [emptyCup({ last_seen_ms: 8_000 })] } }))).toMatchObject({ reason: "stale" });
    });
    it("병을 집는 단계의 대상이 보이는 병이어도 검사 대상은 컵이다", () => {
      const seen = fill();
      seen.plan!.steps[1] = { ...seen.plan!.steps[1]!, target: { objectId: "bottle_1" } };
      const w = { ...base().world, objects: [bottle, emptyCup()] };
      expect(planObjectOf(seen.plan!, w, "cup")).toBe("cup_1");
      expect(checkPlan({ ...seen, world: w })).toEqual({ ok: true });
    });
    it("컵을 실제로 들고 있으면 시야 밖 병이 들고 감 보호 중이어도 carried를 붙이지 않는다", () => {
      const away = obj({ id: "bottle_1", cls: "bottle", status: "out_of_view", facts: { place: fact("in_hand") }, carried: true });
      expect(checkPlan(fill({ world: { ...base().world, objects: [away, obj({ facts: { place: fact("in_hand") } })] } }))).toEqual({ ok: false, reason: "in_hand", text: CHECK_TEXT.in_hand });
      const carriedCup = obj({ facts: { place: fact("in_hand") }, carried: true });
      expect(checkPlan(fill({ world: { ...base().world, objects: [away, carriedCup], person: person(["cup_1"]) } }))).toEqual({ ok: false, reason: "in_hand", text: CHECK_TEXT.in_hand });
    });
    it("컵을 사람이 들고 있거나 쓰는 중이면 in_hand로 막는다", () => {
      for (const facts of [{ place: fact("in_hand") }, { use: fact("in_use") }]) {
        expect(checkPlan(fill({ world: { ...base().world, objects: [obj({ facts })] } }))).toMatchObject({ reason: "in_hand" });
      }
      expect(checkPlan(fill({ world: { ...fill().world, person: person(["cup_1"]) } }))).toMatchObject({ reason: "in_hand" });
    });
    it("사람이 있는 자리에서 하는 일이라 든 것을 모르거나 숟가락을 든 것만으로는 막지 않는다(컵 치우기는 든 것을 모르면 막는다)", () => {
      expect(checkPlan(fill({ world: { ...fill().world, person: person([]) } }))).toEqual({ ok: true });
      expect(checkPlan(fill({ world: { ...fill().world, person: person(["spoon_1"]) } }))).toEqual({ ok: true });
      expect(checkPlan(base({ world: { ...base().world, person: person([]) } }))).toMatchObject({ reason: "in_hand" });
    });
    it("컵이 사라졌으면 no_target", () => {
      expect(checkPlan(fill({ world: { ...base().world, objects: [obj({ status: "gone" })] } }))).toMatchObject({ reason: "no_target" });
      expect(checkPlan(fill({ world: { ...base().world, objects: [bottle] } }))).toMatchObject({ reason: "no_target" });
    });
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
    // 감지가 끊겨 남은 「보임」(10초 넘게 못 본 컵)으로는 부르지 않는다
    const at = (nowMs: number) => checkDecision({ decision: base().decision, tasks: base().tasks, world: w([obj({ last_seen_ms: 9_000 })]), nowMs });
    expect(at(19_000)).toEqual({ ok: true });
    expect(at(19_001)).toMatchObject({ reason: "no_target" });
  });
});
