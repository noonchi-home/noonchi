import { describe, expect, it } from "vitest";
import { forwardOf, MIN_BASELINE_M, solveAlignment, toTwin, type Plan2, type Quat, type Vec3 } from "../src/phone/align.js";

const DOCK: Plan2 = [3.9, 5.51];
const DOOR: Plan2 = [2.4, 3.55];
const yawQ = (deg: number): Quat => {
  const h = (deg * Math.PI) / 360;
  return [0, Math.sin(h), 0, Math.cos(h)];
};
const pitchQ = (deg: number): Quat => {
  const h = (deg * Math.PI) / 360;
  return [Math.sin(h), 0, 0, Math.cos(h)];
};

/** 평면 점 → AR 점. 평면 = rot(theta)·AR + t 인 공간을 구현과 따로 거꾸로 계산한다. */
function arOf(plan: Plan2, theta: number, t: Plan2, floorY: number): Vec3 {
  const x = plan[0] - t[0], y = plan[1] - t[1];
  const c = Math.cos(-theta), s = Math.sin(-theta);
  return [x * c - y * s, floorY, x * s + y * c];
}

describe("forwardOf", () => {
  it("돌리지 않은 폰은 -Z를 보고, Y축 90° 회전이면 -X를 본다", () => {
    expect(forwardOf([0, 0, 0, 1])).toEqual([0, 0, -1]);
    const f = forwardOf(yawQ(90));
    expect(f[0]).toBeCloseTo(-1);
    expect(f[1]).toBeCloseTo(0);
    expect(f[2]).toBeCloseTo(0);
  });
});

describe("solveAlignment + toTwin", () => {
  it("AR과 평면이 같으면 그대로 옮긴다", () => {
    const al = solveAlignment({ ar: [DOCK[0], 0, DOCK[1]], plan: DOCK }, { ar: [DOOR[0], 0, DOOR[1]], plan: DOOR });
    expect(al.theta).toBeCloseTo(0);
    expect(toTwin([1, 1.5, 2], [0, 0, 0, 1], al)).toEqual({ position: [1, 2], height_m: 1.5, yaw_deg: 270, pitch_deg: 0 });
  });

  it("30° 돌아가고 옮겨진 AR 공간을 되찾는다", () => {
    const theta = Math.PI / 6, floorY = -1.4;
    const al = solveAlignment(
      { ar: arOf(DOCK, theta, DOCK, floorY), plan: DOCK },
      { ar: arOf(DOOR, theta, DOCK, floorY), plan: DOOR },
    );
    expect(al.theta).toBeCloseTo(theta);
    expect(al.tx).toBeCloseTo(3.9);
    expect(al.ty).toBeCloseTo(5.51);
    expect(al.floorY).toBeCloseTo(floorY);
    expect(al.mismatchM).toBeCloseTo(0);
    const eye = toTwin([0.5, 0, -1], [0, 0, 0, 1], al);
    expect(eye.position[0]).toBeCloseTo(4.833, 2);
    expect(eye.position[1]).toBeCloseTo(4.894, 2);
    expect(eye.height_m).toBeCloseTo(1.4);
    expect(eye.yaw_deg).toBeCloseTo(300, 0);
  });

  it("고개를 숙이면 pitch가 음수다", () => {
    const al = solveAlignment({ ar: [DOCK[0], 0, DOCK[1]], plan: DOCK }, { ar: [DOOR[0], 0, DOOR[1]], plan: DOOR });
    expect(toTwin([0, 1.2, 0], pitchQ(-30), al).pitch_deg).toBeCloseTo(-30, 1);
  });

  it("실제 거리와 트윈 거리가 다르면 그 차이를 알려준다", () => {
    const far: Vec3 = [DOCK[0] + (DOOR[0] - DOCK[0]) * 1.1, 0, DOCK[1] + (DOOR[1] - DOCK[1]) * 1.1];
    const al = solveAlignment({ ar: [DOCK[0], 0, DOCK[1]], plan: DOCK }, { ar: far, plan: DOOR });
    expect(al.mismatchM).toBeCloseTo(Math.hypot(1.5, 1.96) * 0.1, 3);
  });

  it("기준점이 너무 가까우면 거절한다", () => {
    expect(() => solveAlignment({ ar: [0, 0, 0], plan: DOCK }, { ar: [0.1, 0, 0], plan: DOOR })).toThrow(String(MIN_BASELINE_M));
  });
});
