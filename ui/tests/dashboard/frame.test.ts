// @vitest-environment node
// 트윈 위 표시 한 순간(twinFrame): 실제 한양목련 장면·컵 치우기 계획·맞춘 눈 → 경로·목적지·클로이드·확인한 것 자리·밝힐 방(구운 보기 그림 픽셀).
import { describe, expect, it } from "vitest";
import type { Check } from "../../src/checks/checks";
import { litRooms, progressOn, roomSetsOf, twinFrame } from "../../src/dashboard/frame";
import { planToPixel } from "../../src/twin3d/projection";
import { anchorOf, CAM, HOME, moment, PLAN, PLAN_CHECKS, SINK, START, TABLE } from "./cup-run";

const frameAt = (n: number, checks: Check[] = PLAN_CHECKS, over: Partial<Parameters<typeof twinFrame>[0]> = {}) =>
  twinFrame({ ...moment(n), checks, anchor: anchorOf, home: HOME, cam: CAM, ...over });
const px = (p: [number, number], h = 0) => planToPixel(CAM, p, h);
const near = (a: [number, number] | undefined, b: [number, number], tol = 1) => {
  expect(a).toBeDefined();
  expect(Math.hypot(a![0] - b[0], a![1] - b[1])).toBeLessThanOrEqual(tol);
};

describe("트윈 순간", () => {
  it("순간 0(지켜보기)은 계획·경로·목적지가 없고 밝힐 방이 없다(어둡게 하지 않음)", () => {
    const f = frameAt(0, []);
    expect([f.plan, f.index, f.step, f.target]).toEqual([null, 0, null, null]);
    expect(f.route).toEqual({ points: [], legs: [], done: [], ahead: [] });
    expect(f.rooms).toEqual([]);
    near(f.robot?.px, px(START));
  });

  it("순간 1(식탁으로 가기)은 index 1, 목적지는 첫 구간 끝, 지나온 길은 시작 자리 하나", () => {
    const f = frameAt(1);
    expect(f.index).toBe(1);
    expect(f.step?.id).toBe(PLAN.steps[0]!.id);
    near(f.target ?? undefined, px(PLAN.path[PLAN.legs[0]!.end]!));
    expect(f.route.done).toHaveLength(1);
    near(f.route.done[0], px(START));
    near(f.route.ahead[0], px(START));
    expect(f.route.ahead).toHaveLength(PLAN.path.length);
  });

  it("순간 3(싱크대로 가기)은 길을 눈 자리에서 나누고, 목적지는 길 끝, 밝힐 방에 주방", () => {
    const { eye } = moment(3);
    const f = frameAt(3);
    near(f.route.done.at(-1), px(eye.position));
    near(f.route.ahead[0], px(eye.position));
    near(f.target ?? undefined, px(PLAN.path.at(-1)!));
    expect(f.rooms).toContain("kitchen");
    expect(f.robot?.room).toBe(HOME.roomAt(eye.position));
  });

  it("서 있는 단계(순간 2 컵 집기)는 끝난 이동 구간 끝에서 나누고 목적지는 다음 이동 구간 끝이다", () => {
    const f = frameAt(2);
    const end = PLAN.path[PLAN.legs[0]!.end]!;
    near(f.route.done.at(-1), px(end));
    near(f.route.ahead[0], px(end));
    near(f.target ?? undefined, px(PLAN.path.at(-1)!));
  });

  it("확인 목록의 싱크대 표시 자리는 그 물건 자리(anchor x·z)와 윗면 높이(anchor h)의 그림 픽셀이다", () => {
    const f = frameAt(3);
    const [x, h, z] = anchorOf(SINK)!;
    const mark = f.marks.find((m) => m.id === SINK);
    near(mark?.px, px([x, z], h), 1e-6);
    expect(f.marks.map((m) => m.id).sort()).toEqual([SINK, TABLE].sort());
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

  it("밝힐 방: 단계 대상 방과 그 단계 구간이 지나는 방, 정렬", () => {
    expect(roomSetsOf(PLAN, HOME)).toEqual([["living"], ["living"], ["kitchen", "living"], ["kitchen"]]);
    expect(litRooms(PLAN, 2, HOME)).toEqual(["kitchen", "living"]);
    expect(frameAt(1).rooms).toEqual(["living"]);
    expect(frameAt(4).rooms).toEqual(["kitchen"]);
  });

  it("꺾은선 위 가장 가까운 자리의 길이 몫", () => {
    expect(progressOn([[0, 0], [10, 0]], [2.5, 3])).toBeCloseTo(0.25, 9);
    expect(progressOn([[0, 0], [10, 0], [10, 10]], [12, 5])).toBeCloseTo(0.75, 9);
    expect(progressOn([[0, 0], [10, 0]], [-4, 1])).toBe(0);
    expect(progressOn([[0, 0], [10, 0]], [14, 1])).toBe(1);
  });
});
