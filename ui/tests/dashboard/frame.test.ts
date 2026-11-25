// @vitest-environment node
// 트윈 위 표시 한 순간(twinFrame): 실제 한양목련 장면·컵 치우기 계획·맞춘 눈 → 경로(카메라 맞춤용, 그리지 않음)·목적지·클로이드·확인한 것 자리·밝힐 방(구운 보기 그림 픽셀).
import { describe, expect, it } from "vitest";
import type { PlanView } from "../../../src/contract/plan.ts";
import type { TraceRow } from "../../../src/contract/trace.ts";
import type { WorldObject, WorldView } from "../../../src/contract/world.ts";
import { TraceJournal } from "../../../src/record/trace.ts";
import type { Check } from "../../src/dashboard/checks/checks";
import { litRooms, roomSetsOf, twinFrame } from "../../src/dashboard/frame";
import { planToPixel } from "../../src/twin/3d/projection";
import { anchorOf, CAM, CUP_PLAN, HOME, moment, PLAN, PLAN_CHECKS, SINK, START, TABLE } from "./cup-run";

const frameAt = (n: number, checks: Check[] = PLAN_CHECKS, over: Partial<Parameters<typeof twinFrame>[0]> = {}) =>
  twinFrame({ ...moment(n), checks, anchor: anchorOf, home: HOME, cam: CAM, ...over });
const px = (p: [number, number], h = 0) => planToPixel(CAM, p, h);
const near = (a: [number, number] | undefined, b: [number, number], tol = 1) => {
  expect(a).toBeDefined();
  expect(Math.hypot(a![0] - b[0], a![1] - b[1])).toBeLessThanOrEqual(tol);
};

describe("트윈 순간", () => {
  it("가짜 단계 자료(fake-run.json)의 계획은 지금 장면으로 짠 컵 치우기 계획과 같다: 다르면 npx tsx scripts/twin3d/fake-run.ts로 다시 만든다", () => {
    const shape = (p: PlanView) => ({ path: p.path, legs: p.legs.map((l) => l.end), steps: p.steps.map((s) => [s.kind, s.target]) });
    expect(shape(PLAN)).toEqual(shape(CUP_PLAN));
  });

  it("순간 0(지켜보기)은 계획·경로·목적지가 없고 밝힐 방이 없다(어둡게 하지 않음)", () => {
    const f = frameAt(0, []);
    expect([f.plan, f.index, f.step, f.target]).toEqual([null, 0, null, null]);
    expect(f.route).toEqual({ points: [], legs: [] });
    expect(f.rooms).toEqual([]);
    near(f.robot?.px, px(START));
  });

  it("순간 1(식탁으로 가기)은 index 1, 목적지는 첫 구간 끝, 경로는 계획 경로 그대로(지나온 길·남은 길로 나누지 않는다)", () => {
    const f = frameAt(1);
    expect(f.index).toBe(1);
    expect(f.step?.id).toBe(PLAN.steps[0]!.id);
    near(f.target ?? undefined, px(PLAN.path[PLAN.legs[0]!.end]!));
    expect(Object.keys(f.route).sort()).toEqual(["legs", "points"]);
    expect(f.route.points).toHaveLength(PLAN.path.length);
    near(f.route.points[0], px(START));
  });

  it("순간 3(싱크대로 가기)은 목적지가 길 끝이고 밝힐 방에 주방", () => {
    const { eye } = moment(3);
    const f = frameAt(3);
    near(f.target ?? undefined, px(PLAN.path.at(-1)!));
    expect(f.rooms).toContain("kitchen");
    expect(f.robot?.room).toBe(HOME.roomAt(eye.position));
  });

  it("서 있는 단계(순간 2 컵 집기)의 목적지는 다음 이동 구간 끝이다", () => {
    const f = frameAt(2);
    near(f.target ?? undefined, px(PLAN.path.at(-1)!));
  });

  it("확인 목록의 싱크대 표시 자리는 그 물건 자리(anchor x·z)와 윗면 높이(anchor h)의 그림 픽셀이다", () => {
    const f = frameAt(3);
    const [x, h, z] = anchorOf(SINK)!;
    const mark = f.marks.find((m) => m.id === SINK);
    near(mark?.px, px([x, z], h), 1e-6);
    expect(f.marks.map((m) => m.id).sort()).toEqual([SINK, TABLE].sort());
  });

  it("장면 물건이 아닌 자리(폰 눈·World State 물건, pos)의 표시는 그 트윈 자리 그림 픽셀이다(고리를 찾지 않는다)", () => {
    const here: Check = { key: "brain", order: 1, source: "brain", objectId: "spot:eye", pos: [7.5, 0.9, 2.5], label: "주방·식당", verb: "지켜봄", at: 0 };
    const f = frameAt(3, [here], { anchor: () => null });
    near(f.marks.find((m) => m.id === "spot:eye")?.px, px([7.5, 2.5], 0.9), 1e-6);
  });

  it("자리를 모르는 것과 승인을 기다리는 기기는 표시하지 않는다", () => {
    const waiting: Check = { key: "device:fridge_bbc363a3", order: 3, source: "agent", deviceId: "fridge_bbc363a3", verb: "승인 대기", at: 0 };
    const f = frameAt(3, [...PLAN_CHECKS, waiting], { anchor: (id) => (id === SINK ? null : anchorOf(id)) });
    expect(f.marks.map((m) => m.id)).toEqual([TABLE]);
  });

  it("열린 계획만 쓴다: 끝난 계획이면 계획·경로가 없고 어둡게 하지 않는다", () => {
    const f = frameAt(4, PLAN_CHECKS, { plan: { ...moment(4).plan!, status: "done" } });
    expect([f.plan, f.index, f.target]).toEqual([null, 0, null]);
    expect(f.route.points).toEqual([]);
    expect(f.rooms).toEqual([]);
  });

  it("추정 눈(맞추기 전)은 클로이드로 그리지 않는다", () => {
    const { eye } = moment(1);
    expect(frameAt(1, PLAN_CHECKS, { eye: { ...eye, estimated: true } }).robot).toBeNull();
  });

  it("클로이드 머리 방향은 눈 yaw 방향 [cos, sin]의 그림 위 각도다", () => {
    const { eye } = moment(3);
    const f = frameAt(3);
    const a = (eye.yaw_deg * Math.PI) / 180;
    const [u0, v0] = px(eye.position);
    const [u1, v1] = px([eye.position[0] + Math.cos(a), eye.position[1] + Math.sin(a)]);
    expect(f.robot!.angle).toBeCloseTo((Math.atan2(v1 - v0, u1 - u0) * 180) / Math.PI, 6);
  });

  // 2026-11-25 시연 의견 2: 손에 든 컵·자리를 모르는 컵이 바닥에 「컵」으로 보였다. 자리를 모르는 물건은 그리지 않고, 바닥 대체는 이동 단계 목적지뿐이다
  it("컵 집기 대상 컵이 손에 있거나 놓인 면이 없으면 그 단계 번호·목표 고리·트레이스 표시가 없다. 식탁 위 컵이면 그 자리에 있다", () => {
    const steps = PLAN.steps.map((s, i) => (i === 1 ? { ...s, target: { objectId: "cup_1", position: [9.9, 3.9] as [number, number] } } : s));
    const plan = { ...moment(2).plan!, steps: moment(2).plan!.steps.map((s, i) => ({ ...s, target: steps[i]!.target })) };
    const rows: TraceRow[] = [];
    const journal = new TraceJournal("e1", () => 1000, (m) => rows.push(...m.rows));
    journal.start("pick", { plan_id: plan.id, step_id: plan.steps[1]!.id, object_id: "cup_1" });
    const cup = (over: Partial<WorldObject>): WorldView => ({
      at_ms: 0, fixtures: [], devices: [], eye: null, frame_ms: null, vlm_missing: 0, yolo_missing: 0,
      person: { visible: false, since_ms: 0, last_seen_ms: 0, count: 0, position: null, position_ms: 0, room: null, room_label: null, near: [], holding: [], facts: {}, answered_ms: null },
      objects: [{ id: "cup_1", cls: "cup", position: [9.9, 0.78, 3.9], surface: TABLE, surface_label: "식탁", room: "living", error_m: null, status: "present",
        first_seen_ms: 0, last_seen_ms: 0, last_in_view_ms: 0, facts: {}, answered_ms: null, devices: [], closer_hold: false, followed_by: null, ...over } as WorldObject],
    } as unknown as WorldView);
    const at = (world: WorldView) => frameAt(2, [], { plan, world, goal: { object: "cup_1", standing: true }, trace: rows, plans: [plan] });
    const onTable = at(cup({}));
    expect(onTable.planned.stops.map((s) => s.n)).toEqual([1, 2, 3, 4]);
    near(onTable.planned.stops[1]!.px, px([9.9, 3.9], 0.78), 1e-6);
    expect(onTable.planned.goal).not.toBeNull();
    expect(onTable.trace.map((m) => m.text)).toEqual(["집기 안내 · 시연자 수행 대기"]);
    for (const world of [cup({ facts: { place: { value: "in_hand", certainty: "confirmed", at_ms: 0 } } as WorldObject["facts"] }), cup({ surface: null, surface_label: null, position: [9.9, 0, 3.9] })]) {
      const f = at(world);
      expect(f.planned.stops.map((s) => s.n)).toEqual([1, 3, 4]);
      expect(f.planned.goal).toBeNull();
      expect(f.trace).toEqual([]);
    }
  });

  it("밝힐 방: 단계 대상 방과 그 단계 구간이 지나는 방, 정렬", () => {
    expect(roomSetsOf(PLAN, HOME)).toEqual([["living"], ["living"], ["kitchen", "living"], ["kitchen"]]);
    expect(litRooms(PLAN, 2, HOME)).toEqual(["kitchen", "living"]);
    expect(frameAt(1).rooms).toEqual(["living"]);
    expect(frameAt(4).rooms).toEqual(["kitchen"]);
  });

});
