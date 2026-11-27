// 트레이스 줄 → 트윈 표시(순수 함수, ui/src/dashboard/trace-marks.ts). 가장 최근 활동 하나의 줄만, 자리를 아는 줄만 낸다.
// 자리는 장면 물건·가전 anchor, surface가 있는 World State 물건 자리(손에 든 물건 제외), 계획 구간 끝만 쓴다.
import { describe, expect, it } from "vitest";
import type { PlanStep, PlanView, XZ } from "../../../src/contract/plan.ts";
import type { TraceEvent, TraceOutput, TraceRefs, TraceRow } from "../../../src/contract/trace.ts";
import type { WorldObject, WorldView } from "../../../src/contract/world.ts";
import { TraceJournal } from "../../../src/record/trace.ts";
import type { Vec3 } from "../../src/dashboard/plan-marks";
import { markTone, traceMarks } from "../../src/dashboard/trace-marks";

const STEPS: PlanStep[] = [
  { id: "s1", kind: "move", label: "식탁으로 가기", target: { objectId: "table" }, status: "done" },
  { id: "s2", kind: "act", label: "컵 집기", target: { objectId: "cup_1" }, status: "active" },
  { id: "s3", kind: "move", label: "싱크대로 가기", target: { objectId: "sink" }, status: "pending" },
  { id: "s4", kind: "act", label: "컵 내려놓기", target: { objectId: "sink" }, status: "pending" },
];
const PATH: XZ[] = [[0, 0], [4, 0], [4, 3], [8, 3]];
const PLAN: PlanView = {
  id: "plan:pam-1", revision: 1, source: "brain", goal: "컵 치우기", judgment: "", dryRun: false, robot: { position: [0, 0], room: "living" },
  path: PATH, legs: [{ stepId: "s1", end: 1 }, { stepId: "s3", end: 3 }], steps: STEPS, status: "running", updatedAt: "t",
};
const ANCHORS: Record<string, Vec3> = { table: [4.5, 0.75, 0.2], sink: [8.5, 0.9, 3.1], tv_1: [2, 1.1, 6] };
const anchor = (id: string): Vec3 | null => ANCHORS[id] ?? null;

const cup = (over: Partial<WorldObject> = {}): WorldObject => ({
  id: "cup_1", cls: "cup", position: [4.4, 0.78, 0.3], surface: "table", surface_label: "식탁", room: "living", error_m: null, status: "present",
  first_seen_ms: 0, last_seen_ms: 0, last_in_view_ms: 0, facts: {}, answered_ms: null, devices: [], closer_hold: false, followed_by: null, ...over,
} as WorldObject);
const world = (objects: WorldObject[] = [cup()]): WorldView => ({
  at_ms: 0, objects, fixtures: [], devices: [], eye: null, frame_ms: null, vlm_missing: 0, yolo_missing: 0,
  person: { visible: false, since_ms: 0, last_seen_ms: 0, count: 0, position: null, position_ms: 0, room: null, room_label: null, near: [], holding: [], facts: {}, answered_ms: null },
} as unknown as WorldView);
const held = cup({ facts: { place: { value: "in_hand", certainty: "confirmed", at_ms: 0 } } } as Partial<WorldObject>);

let seq = 0;
/** 서버 기록기(TraceJournal)가 만든 줄 그대로: 이름·종류는 서버의 정해진 낱말이다. */
function journal() {
  const rows = new Map<string, TraceRow>();
  const j = new TraceJournal(`e${++seq}`, () => 1000, (m) => { for (const r of m.rows) rows.set(r.id, r); });
  return {
    start: (event: TraceEvent, refs: TraceRefs = {}) => j.start(event, refs),
    finish: (id: string, output: TraceOutput) => j.finish(id, "done", output),
    event: (event: TraceEvent, refs: TraceRefs, output: TraceOutput) => j.event(event, refs, output),
    rows: () => [...rows.values()],
  };
}
const marks = (rows: TraceRow[], w: WorldView | null = world(), plans: PlanView[] = [PLAN]) => traceMarks(rows, plans, w, anchor);

describe("트레이스 줄 → 트윈 표시(traceMarks)", () => {
  it("이동 안내 진행 중(plan_id·step_id)이면 그 단계 구간이 진행 중 표시이고 자리는 구간 끝 바닥이다", () => {
    const t = journal();
    t.start("move", { plan_id: PLAN.id, step_id: "s3" });
    const [m, ...rest] = marks(t.rows());
    expect(rest).toEqual([]);
    expect(m).toMatchObject({ kind: "leg", state: "pending", legOf: { planId: PLAN.id, stepId: "s3" }, at: [8, 0, 3], text: "이동 안내 · 시연자 수행 대기" });
  });

  it("컵 안 확인이 끝나고 cup_1이 식탁 위면 그 컵 자리에 「컵 안 확인 · 빈 컵 확인」이다", () => {
    const t = journal();
    t.finish(t.start("top", { plan_id: PLAN.id, request_id: "r1", object_id: "cup_1" }), "cup_empty");
    expect(marks(t.rows())).toEqual([expect.objectContaining({ kind: "look", state: "done", at: [4.4, 0.78, 0.3], text: "컵 안 확인 · 빈 컵 확인" })]);
  });

  it("자리를 모르는 컵(손에 있음, 놓인 면이 없음, 사라짐)이면 표시가 없다: 바닥이나 폰 눈 자리로 대신하지 않는다", () => {
    const t = journal();
    t.finish(t.start("top", { plan_id: PLAN.id, request_id: "r1", object_id: "cup_1" }), "cup_empty");
    expect(marks(t.rows(), world([held]))).toEqual([]);
    expect(marks(t.rows(), world([cup({ surface: null, surface_label: null })]))).toEqual([]);
    expect(marks(t.rows(), world([cup({ status: "gone" })]))).toEqual([]);
    expect(marks(t.rows(), world([]))).toEqual([]);
  });

  it("집기 안내는 그 단계 대상 자리에 「집기 안내 · …」, 손에 든 컵이면 없다", () => {
    const t = journal();
    t.start("pick", { plan_id: PLAN.id, step_id: "s2", object_id: "cup_1" });
    expect(marks(t.rows())).toEqual([expect.objectContaining({ kind: "spot", at: [4.4, 0.78, 0.3], text: "집기 안내 · 시연자 수행 대기" })]);
    expect(marks(t.rows(), world([held]))).toEqual([]);
  });

  it("배치 안내는 그 단계 대상(싱크대) 자리다", () => {
    const t = journal();
    t.start("place", { plan_id: PLAN.id, step_id: "s4", object_id: "cup_1" });
    expect(marks(t.rows(), world([held]))).toEqual([expect.objectContaining({ kind: "spot", at: ANCHORS.sink, text: "배치 안내 · 시연자 수행 대기" })]);
  });

  it("VLM 장면 해석·PAM 판단·행동 선택·사용자 상태 변화·안전 상태 줄만 있으면 표시가 없다", () => {
    const t = journal();
    t.finish(t.start("vlm"), "scene_objects");
    t.finish(t.start("pam", { decision_id: "pam-1" }), "model_answer");
    t.event("action", { decision_id: "pam-1" }, "select_cup");
    t.event("person_changed", {}, "person_not_seen");
    t.event("safety", {}, "safety_cleared");
    expect(marks(t.rows())).toEqual([]);
  });

  it("활동이 둘이면 최근 활동의 표시만 낸다", () => {
    const t = journal();
    t.finish(t.start("top", { plan_id: "plan:old", request_id: "r0", object_id: "cup_1" }), "cup_contents");
    t.event("object_changed", { object_id: "cup_1" }, "changed");
    const all = marks(t.rows());
    expect(all.map((m) => m.text)).toEqual(["물건 상태 변화 · 상태 변화 확인"]);
  });

  it("진행 중인 줄이 있는 활동은 뒤에 끝난 다른 활동보다 앞선다", () => {
    const t = journal();
    t.start("move", { plan_id: PLAN.id, step_id: "s3" });
    t.event("object_changed", { object_id: "cup_1" }, "changed");
    expect(marks(t.rows()).map((m) => m.kind)).toEqual(["leg"]);
  });

  it("실행 전 검사 통과 줄은 대상 컵 자리에 점과 이름표다", () => {
    const t = journal();
    t.event("check", { plan_id: PLAN.id, object_id: "cup_1" }, "check_passed");
    expect(marks(t.rows())).toEqual([expect.objectContaining({ kind: "spot", state: "done", at: [4.4, 0.78, 0.3], target: "cup_1", text: "실행 전 검사 · 통과" })]);
  });

  it("가전 도구·가전 상태 변화는 그 가전 자리에 OUTPUT 글이다", () => {
    const t = journal();
    t.finish(t.start("device_tool", { object_id: "tv_1" }), "device_ack");
    expect(marks(t.rows())).toEqual([expect.objectContaining({ kind: "device", at: ANCHORS.tv_1, target: "tv_1", text: "가전 응답 확인" })]);
  });

  it("VLM 근접 해석은 같은 요청의 근접 관찰 대상 자리이고, 같은 대상 표시는 마지막 줄 하나다", () => {
    const t = journal();
    t.start("closer", { plan_id: PLAN.id, request_id: "r2", object_id: "cup_1" });
    t.start("closer_vlm", { request_id: "r2" });
    const got = marks(t.rows());
    expect(got).toHaveLength(1);
    expect(got[0]).toMatchObject({ kind: "look", state: "pending", at: [4.4, 0.78, 0.3], text: "VLM 근접 해석 · 결과 대기 중" });
  });

  it("실행 보류는 대상이 없으면 그 계획의 지금 단계 자리에 경고 표시다", () => {
    const t = journal();
    t.event("guard", { plan_id: PLAN.id }, "guard_safety");
    expect(marks(t.rows())).toEqual([expect.objectContaining({ kind: "guard", at: [4.4, 0.78, 0.3], text: "실행 보류 · 안전 조치 우선" })]);
  });

  it("목표 준비·사용자 자리 이탈은 목표 대상 물건 자리다", () => {
    const t = journal();
    t.event("goal", { goal_id: "g1", object_id: "cup_1" }, "goal_ready");
    expect(marks(t.rows())).toEqual([expect.objectContaining({ kind: "goal", at: [4.4, 0.78, 0.3], text: "목표 준비 · 미리 만든 계획 준비됨" })]);
  });
});

describe("표시 색(markTone)", () => {
  it("정한 색(밤 반성 표시)이 있으면 그 색을 먼저 쓴다", () => {
    expect(markTone({ kind: "spot", state: "done", tone: "success" })).toBe("success");
    expect(markTone({ kind: "spot", state: "done" })).toBe("default");
  });
});
