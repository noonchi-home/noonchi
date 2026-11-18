// 계획 표시 자료(순수 함수, ui/src/dashboard/plan-marks.ts): 무엇을 어디에 그릴지(트윈 좌표 [x, 높이, z]와 글)만 정한다. 그리기(트윈 판·나중에 폰 카메라 화면)는 따로다.
// 길: 지나온 길·지금 구간(로봇 자리부터)·남은 길. 번호: 단계마다 그 단계 자리(이동은 구간 끝, 그 밖은 대상 자리). 지금 단계 이름표, 사람 이름표. 목표는 없다.
import { describe, expect, it } from "vitest";
import type { PlanStep, PlanView, XZ } from "../../../src/contract/plan.ts";
import type { WorldView } from "../../../src/contract/world.ts";
import { PERSON_H, planMarks, type Vec3 } from "../../src/dashboard/plan-marks";

const STEPS: Omit<PlanStep, "status">[] = [
  { id: "s1", kind: "move", label: "식탁으로 가기", target: { objectId: "table" } },
  { id: "s2", kind: "act", label: "컵 집기", target: { objectId: "table" } },
  { id: "s3", kind: "move", label: "싱크대로 가기", target: { objectId: "sink" } },
  { id: "s4", kind: "act", label: "컵 내려놓기", target: { objectId: "sink" } },
];
const PATH: XZ[] = [[0, 0], [4, 0], [4, 3], [8, 3]];
/** n번째 단계가 지금(앞 done, 뒤 pending). */
const planAt = (n: number): PlanView => ({
  id: "cup", revision: n, source: "brain", goal: "컵 치우기", judgment: "", dryRun: false, robot: { position: [0, 0], room: "living" },
  path: PATH, legs: [{ stepId: "s1", end: 1 }, { stepId: "s3", end: 3 }],
  steps: STEPS.map((s, i) => ({ ...s, status: i + 1 < n ? "done" : i + 1 === n ? "active" : "pending" })), status: "running", updatedAt: "t",
});
const ANCHORS: Record<string, Vec3> = { table: [4.5, 0.75, 0.2], sink: [8.5, 0.9, 3.1] };
const at = (t: { objectId?: string }) => (t.objectId ? ANCHORS[t.objectId] ?? null : null);
const person = (over: Partial<WorldView["person"]>): WorldView => ({
  at_ms: 0, objects: [], fixtures: [], devices: [], eye: null, frame_ms: null, vlm_missing: 0, yolo_missing: 0,
  person: { visible: true, since_ms: 0, last_seen_ms: 0, count: 1, position: [5, 1], position_ms: 0, room: "living", room_label: "거실", near: [], holding: [], facts: {}, answered_ms: null, ...over },
});

describe("계획 표시 자료(planMarks)", () => {
  it("계획이 없으면 길·번호·단계 이름표가 없다", () => {
    expect(planMarks({ plan: null, robot: [1, 1], world: null, at })).toEqual({ route: { done: [], now: [], ahead: [] }, stops: [], step: null, person: null });
  });

  it("단계마다 번호 자리: 이동은 그 구간 끝(바닥), 그 밖은 대상 자리. 상태는 단계 상태, 지금 단계는 now. 지금 단계 이름표는 「② 컵 집기」", () => {
    const m = planMarks({ plan: planAt(2), robot: [4, 0], world: null, at });
    expect(m.stops).toEqual([
      { n: 1, at: [4, 0, 0], status: "done", now: false },
      { n: 2, at: ANCHORS.table, status: "active", now: true },
      { n: 3, at: [8, 0, 3], status: "pending", now: false },
      { n: 4, at: ANCHORS.sink, status: "pending", now: false },
    ]);
    expect(m.step).toEqual({ at: ANCHORS.table, text: "② 컵 집기" });
  });

  it("길: 지금 이동 구간은 로봇 자리에서 나눠 지나온 길과 지금 구간이 되고, 뒤 구간은 남은 길이다(바닥 높이 0)", () => {
    const m = planMarks({ plan: planAt(1), robot: [2, 0.3], world: null, at });
    expect(m.route.done).toEqual([[0, 0, 0], [2, 0, 0]]);
    expect(m.route.now).toEqual([[2, 0, 0], [4, 0, 0]]);
    expect(m.route.ahead).toEqual([[4, 0, 0], [4, 0, 3], [8, 0, 3]]);
  });

  it("길: 이동 아닌 단계(컵 집기)면 끝난 구간까지 지나온 길, 다음 구간이 남은 길이다. 마지막 구간을 가는 중이면 남은 길이 없다", () => {
    const pick = planMarks({ plan: planAt(2), robot: [4, 0], world: null, at });
    expect(pick.route).toEqual({ done: [[0, 0, 0], [4, 0, 0]], now: [], ahead: [[4, 0, 0], [4, 0, 3], [8, 0, 3]] });
    const sink = planMarks({ plan: planAt(3), robot: [4, 3], world: null, at });
    expect(sink.route).toEqual({ done: [[0, 0, 0], [4, 0, 0], [4, 0, 3]], now: [[4, 0, 3], [8, 0, 3]], ahead: [] });
  });

  it("사람 이름표: 발 자리 위(머리 높이)에 「사람 · <하는 일>」(하는 일이 없으면 자세, 그것도 없으면 보임), 안 보이면 「사람 · 안 보임」, 자리를 모르면 없다", () => {
    const drinking = person({ facts: { activity: { value: "drinking", certainty: "confirmed", at_ms: 0 } } } as Partial<WorldView["person"]>);
    expect(planMarks({ plan: null, robot: null, world: drinking, at }).person).toEqual({ at: [5, PERSON_H, 1], text: "사람 · 마시는 중" });
    expect(planMarks({ plan: null, robot: null, world: person({}), at }).person!.text).toBe("사람 · 보임");
    expect(planMarks({ plan: null, robot: null, world: person({ visible: false }), at }).person!.text).toBe("사람 · 안 보임");
    expect(planMarks({ plan: null, robot: null, world: person({ position: null }), at }).person).toBeNull();
  });

  it("글에 목표가 없다(목표는 메시지 상자 FSM 카드에만)", () => {
    const m = planMarks({ plan: planAt(2), robot: [4, 0], world: person({}), at });
    expect(JSON.stringify(m)).not.toContain("목표");
  });
});
