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
    expect(planMarks({ plan: null, robot: [1, 1], world: null, at })).toEqual({ route: { done: [], now: [], ahead: [] }, stops: [], step: null, person: null, goal: null, pre: null });
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

  it("글에 목표가 없다", () => {
    const m = planMarks({ plan: planAt(2), robot: [4, 0], world: person({}), at });
    expect(JSON.stringify(m)).not.toContain("목표");
  });

  // 사용자 결정(2026-11-18): 목표가 선 동안 치울 컵 위에 작은 빨간 고리 하나(동선·글 없음, 끝·버림이면 사라짐). AR에도 같은 자료를 쓴다
  it("목표 고리: 목표가 선 동안 그 대상 물건 자리(World State position, 없으면 놓인 면의 자리), 글 없음. 목표가 없거나 섰지 않거나 대상을 모르면 없다", () => {
    const cup = (over: object) => ({ ...person({}), objects: [{ id: "cup_1", cls: "cup", position: null, surface: "table", surface_label: "식탁", room: "living", error_m: null, status: "present", first_seen_ms: 0, last_seen_ms: 0, last_in_view_ms: 0, facts: {}, answered_ms: null, devices: [], closer_hold: false, followed_by: null, ...over }] }) as WorldView;
    const standing = { object: "cup_1", standing: true };
    expect(planMarks({ plan: null, robot: null, world: cup({ position: [4.4, 0.78, 0.3] }), at, goal: standing }).goal).toEqual({ at: [4.4, 0.78, 0.3] });
    expect(planMarks({ plan: null, robot: null, world: cup({}), at, goal: standing }).goal).toEqual({ at: ANCHORS.table });
    expect(planMarks({ plan: null, robot: null, world: cup({}), at, goal: { ...standing, standing: false } }).goal).toBeNull();
    expect(planMarks({ plan: null, robot: null, world: cup({}), at, goal: { object: "cup_9", standing: true } }).goal).toBeNull();
    expect(planMarks({ plan: null, robot: null, world: cup({}), at, goal: null }).goal).toBeNull();
    expect(planMarks({ plan: null, robot: null, world: cup({}), at }).goal).toBeNull();
    // 자리를 모르는 컵(손에 있음·놓인 면 없음·사라짐)은 고리를 그리지 않는다(2026-11-25 시연 의견 2: 바닥 「컵」)
    expect(planMarks({ plan: null, robot: null, world: cup({ position: [4.4, 0.78, 0.3], facts: { place: { value: "in_hand", certainty: "confirmed", at_ms: 0 } } }), at, goal: standing }).goal).toBeNull();
    expect(planMarks({ plan: null, robot: null, world: cup({ position: [4.4, 0, 0.3], surface: null, surface_label: null }), at, goal: standing }).goal).toBeNull();
    expect(planMarks({ plan: null, robot: null, world: cup({ status: "gone" }), at, goal: standing }).goal).toBeNull();
  });

  it("번호 자리를 바닥으로 대신하는 것은 이동 단계 목적지뿐이다: 이동 아닌 단계의 대상 자리를 모르면 그 번호가 없다", () => {
    const steps: PlanStep[] = [
      { id: "s1", kind: "move", label: "식탁으로 가기", target: { objectId: "nowhere", position: [3, 1] }, status: "active" },
      { id: "s2", kind: "act", label: "컵 집기", target: { objectId: "cup_9", position: [3, 1.2] }, status: "pending" },
    ];
    const m = planMarks({ plan: { ...planAt(1), path: [], legs: [], steps }, robot: null, world: null, at });
    expect(m.stops).toEqual([{ n: 1, at: [3, 0, 1], status: "active", now: true }]);
  });

  // 2026-11-19 사용자 결정(「만들기, 1.6초 크게」 A+C): 목표가 준비되면 미리 만든 계획의 길과 번호를 흐리게(글 없이) 그려 두고, 시작되면 진해지며 지금 번호 길로 이어진다
  it("미리 그린 길: 목표가 준비됨이고 열린 계획이 없으면 미리 만든 계획의 길 전체와 단계 번호(글 없음, 흐림)다. 시작(떠남)이면 진하다. 열린 계획이 오면 그 번호 길만이고, 세움·버림·끝이면 없다", () => {
    const pre = { ...planAt(1), id: "plan:goal-1", status: "planned" as const, steps: STEPS.map((x) => ({ ...x, status: "pending" as const })) };
    const goal = (stage: "set" | "ready" | "started" | "done" | "dropped") => ({ object: "cup_1", standing: stage === "set" || stage === "ready" || stage === "started", stage, plan: pre });
    const ready = planMarks({ plan: null, robot: [0, 0], world: null, at, goal: goal("ready") });
    expect(ready.pre).toEqual({
      route: PATH.map(([x, z]) => [x, 0, z]),
      stops: [{ n: 1, at: [4, 0, 0] }, { n: 2, at: ANCHORS.table }, { n: 3, at: [8, 0, 3] }, { n: 4, at: ANCHORS.sink }],
      strong: false,
    });
    expect(ready.stops).toEqual([]);
    expect(ready.step).toBeNull();
    expect(JSON.stringify(ready.pre)).not.toMatch(/가기|집기|내려놓기/);
    expect(planMarks({ plan: null, robot: [0, 0], world: null, at, goal: goal("started") }).pre!.strong).toBe(true);
    for (const stage of ["set", "dropped", "done"] as const) expect(planMarks({ plan: null, robot: [0, 0], world: null, at, goal: goal(stage) }).pre, stage).toBeNull();
    const open = planMarks({ plan: planAt(1), robot: [0, 0], world: null, at, goal: goal("started") });
    expect(open.pre).toBeNull();
    expect(open.stops.map((x) => x.n)).toEqual([1, 2, 3, 4]);
    expect(planMarks({ plan: null, robot: [0, 0], world: null, at, goal: { ...goal("ready"), plan: null } }).pre).toBeNull();
  });
});
