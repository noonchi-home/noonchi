import { describe, expect, it } from "vitest";
import type { WorldObject, WorldView } from "../src/contract/world.js";
import { cupStepOf, planFor, planTargetId, targetOf, TASKS } from "../src/act/tasks.js";
import { STEP_COMMAND } from "../src/plan/labels.js";
import type { DecisionRecord } from "../src/world/decide.js";
import { smallFloor } from "./helpers/floor.js";

const cupAt = (over: Partial<WorldObject> = {}): WorldObject => ({
  id: "cup_1", cls: "cup", position: [7, 0.75, 3], surface: "table_1", surface_label: "식탁", room: "kitchen", error_m: 0.1, status: "present",
  first_seen_ms: 0, last_seen_ms: 0, last_in_view_ms: 0, facts: {}, answered_ms: null, devices: [], ...over,
});
const world = (objects: WorldObject[] = [cupAt()]): WorldView => ({
  at_ms: 0, frame_ms: null, vlm_missing: 0, yolo_missing: 0, eye: null, fixtures: [], devices: [], person: { visible: false, since_ms: 0, last_seen_ms: null, count: 0, room: null, room_label: null, position: null, near: [], holding: [], position_ms: null, answered_ms: null, facts: {} }, objects,
});
const decision = (task_index: number): DecisionRecord => ({
  id: "pam-1", seq: 1, atMs: 0, textSent: "t", finalTime: "2026-11-07T21:00:00.000+09:00", status: "valid",
  prediction: { observation: "o", reasoning: "식사가 끝나 컵을 치운다", task_index },
  action: task_index === 0 ? "컵 치우기" : task_index === 1 ? "사용자에게 물어보기" : null, memoryVersion: 1,
  world: { objects: [], person_visible: false, vlm_missing: 0, yolo_missing: 0 },
});

describe("PAM 결과 → 계획", () => {
  it("컵 치우기는 식탁·싱크대 단계 계획이 되고 판단 이유를 단다. 집기 단계의 대상은 World State 물건", () => {
    const p = planFor(smallFloor(), decision(0), world(), "2026-11-07T12:00:00.000Z")!;
    expect(p).toMatchObject({ id: "plan:pam-1", source: "brain", dryRun: true, judgment: "식사가 끝나 컵을 치운다", goal: "컵 치우기" });
    expect(p.steps.map((s) => s.kind)).toEqual(["move", "act", "move", "act"]);
    expect(p.steps[1]!.target).toEqual({ objectId: "cup_1", position: [7, 3] });
    expect(planTargetId(p)).toBe("cup_1");
  });
  it("물건 위치를 알면 첫 이동은 그 물건 앞까지, 모르면 식탁 앞까지", () => {
    const known = planFor(smallFloor(), decision(0), world([cupAt({ position: [6, 0.75, 2], surface: null, surface_label: null })]), "x")!;
    const end = known.path[known.legs[0]!.end]!;
    expect(Math.hypot(end[0] - 6, end[1] - 2)).toBeCloseTo(0.55, 2);
    const unknown = planFor(smallFloor(), decision(0), world([cupAt({ position: null, surface: null, surface_label: null, error_m: null })]), "x")!;
    expect(unknown.steps[1]!.target).toEqual({ objectId: "cup_1" });
    const toTable = unknown.path[unknown.legs[0]!.end]!;
    expect(Math.hypot(toTable[0] - 7, toTable[1] - 3)).toBeCloseTo(0.55, 2);
  });
  it("대상은 사라지지 않았고 싱크대 안이 아닌 같은 종류 중 가장 최근에 본 것. 없으면 집기 단계는 식탁을 가리킨다", () => {
    const inSink = { place: { value: "in_sink", at_ms: 40, since_ms: 40, certainty: "confirmed" as const } };
    const objects = [cupAt({ id: "cup_1", last_seen_ms: 5 }), cupAt({ id: "cup_2", last_seen_ms: 9 }), cupAt({ id: "cup_3", last_seen_ms: 20, status: "gone" }),
      cupAt({ id: "bottle_1", cls: "bottle", last_seen_ms: 30 }), cupAt({ id: "cup_4", last_seen_ms: 40, facts: inSink })];
    expect(targetOf(TASKS["컵 치우기"]!, world(objects))?.id).toBe("cup_2");
    expect(targetOf(TASKS["사용자에게 물어보기"]!, world(objects))).toBeNull();
    const none = planFor(smallFloor(), decision(0), world([]), "x")!;
    expect(planTargetId(none)).toBe("table_1");
  });
  it("물어보기는 한 단계, 대기·판단 실패·목록 밖 행동은 계획이 없다", () => {
    expect(planFor(smallFloor(), decision(1), world(), "x")!.steps.map((s) => s.kind)).toEqual(["ask"]);
    expect(planFor(smallFloor(), decision(-1), world(), "x")).toBeNull();
    expect(planFor(smallFloor(), { ...decision(0), status: "failed", prediction: null, action: null }, world(), "x")).toBeNull();
    expect(planFor(smallFloor(), { ...decision(0), action: "춤추기" }, world(), "x")).toBeNull();
  });
  it("행동 목록의 행동마다 계획 모양이 있다. 컵 치우기 단계마다 실제 폰 명령이 있고, 물어보기는 질문과 답이 있다", () => {
    expect(Object.keys(TASKS)).toEqual(["컵 치우기", "사용자에게 물어보기"]);
    const cup = planFor(smallFloor(), decision(0), world(), "x")!;
    expect(cup.steps.map((s) => cupStepOf(s))).toEqual(["goTable", "pickCup", "goSink", "placeCup"]);
    expect(cup.steps.map((s) => STEP_COMMAND[cupStepOf(s)!])).toEqual(["식탁으로 가 주세요", "컵을 들어 주세요", "싱크대로 가 주세요", "컵을 싱크대에 넣어 주세요"]);
    const asked = TASKS["사용자에게 물어보기"]!;
    expect(asked.kind === "ask" && asked.prompt.choices.length).toBeGreaterThan(0);
    expect(cupStepOf(planFor(smallFloor(), decision(1), world(), "x")!.steps[0]!)).toBeNull();
  });
});
