// 폰 화면의 벽 대기 기록: 버튼을 누른 뒤 0.5초 동안의 폰 위치를 모아 평균을 낸다(ui/src/phone/core/touch.js).

import { describe, expect, it } from "vitest";
import { createTouchSampler, floorCandidate } from "../ui/src/phone/core/touch.js";

const steady = (sampler: ReturnType<typeof createTouchSampler>, from: number, to: number, step = 33, at = [1, 1.2, 2]) => {
  for (let t = from; t <= to; t += step) sampler.add(t, at, "ok", [at[0], -0.3, at[2]]);
};

describe("createTouchSampler", () => {
  it("0.5초 동안 가만히 있으면 평균 위치와 바닥 조준점 평균을 준다", () => {
    const s = createTouchSampler({ start: 0 });
    expect(s.result(100)).toEqual({ state: "sampling" });
    steady(s, 0, 520);
    const r = s.result(520);
    expect(r.state).toBe("done");
    expect(r.point).toEqual([1, 1.2, 2]);
    expect(r.floor).toEqual([1, -0.3, 2]);
  });

  it("바닥 조준점이 없던 순간은 빼고, 하나도 없으면 floor는 null", () => {
    const s = createTouchSampler({ start: 0 });
    for (let t = 0; t <= 520; t += 33) s.add(t, [1, 1, 2], "ok", null);
    expect(s.result(520)).toMatchObject({ state: "done", floor: null });
  });

  it("움직였으면(퍼짐 3cm 초과) 취소", () => {
    const s = createTouchSampler({ start: 0 });
    steady(s, 0, 250);
    steady(s, 280, 520, 33, [1.05, 1.2, 2]);
    expect(s.result(520)).toMatchObject({ state: "failed", reason: expect.stringContaining("움직") });
  });

  it("추적이 약했던 순간이 있으면 취소", () => {
    const s = createTouchSampler({ start: 0 });
    steady(s, 0, 250);
    s.add(280, [1, 1.2, 2], "limited", null);
    steady(s, 310, 520);
    expect(s.result(520)).toMatchObject({ state: "failed", reason: expect.stringContaining("추적") });
  });

  it("자세가 150ms 넘게 끊겼거나 10개보다 적으면 취소", () => {
    const gap = createTouchSampler({ start: 0 });
    steady(gap, 0, 100);
    steady(gap, 300, 520);
    expect(gap.result(520)).toMatchObject({ state: "failed", reason: expect.stringContaining("끊") });
    const few = createTouchSampler({ start: 0 });
    for (const t of [0, 100, 200, 300, 400, 500]) few.add(t, [1, 1, 2], "ok", null);
    expect(few.result(520)).toMatchObject({ state: "failed" });
    const none = createTouchSampler({ start: 0 });
    expect(none.result(800)).toMatchObject({ state: "failed" });
  });
});

describe("floorCandidate: 바닥으로 쓸 조준점", () => {
  // y축을 x축 쪽으로 90° 눕힌 쿼터니언(벽처럼 옆을 보는 면)
  const SIDEWAYS: [number, number, number, number] = [0, 0, Math.SQRT1_2, Math.SQRT1_2];
  const UP: [number, number, number, number] = [0, 0, 0, 1];

  it("위를 보는 수평면이고 폰보다 0.9m 이상 아래면 바닥", () => {
    expect(floorCandidate([1, -0.3, 2], UP, [1, 1.2, 2])).toEqual([1, -0.3, 2]);
  });

  it("벽처럼 옆을 보는 면은 바닥이 아니다", () => {
    expect(floorCandidate([1, -0.3, 2], SIDEWAYS, [1, 1.2, 2])).toBeNull();
  });

  it("폰보다 0.9m 안쪽 아래의 수평면(탁자)은 바닥이 아니다", () => {
    expect(floorCandidate([1, 0.6, 2], UP, [1, 1.2, 2])).toBeNull();
  });

  it("조준점이 없으면 null", () => {
    expect(floorCandidate(null, null, [1, 1.2, 2])).toBeNull();
  });
});
