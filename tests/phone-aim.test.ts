// 폰 화면 가운데 조준점(ui/src/phone/core/aim.js): hit-test 점, 없으면 시선이 어림 바닥과 만나는 점. 면 법선.
import { describe, expect, it } from "vitest";
import { aimPoint, floorPlaneY, floorRayPoint, planeNormal } from "../ui/src/phone/core/aim.js";

type Quat = [number, number, number, number];
/** x축으로 deg도 돌린 폰 방향(음수면 아래를 본다). */
const pitch = (deg: number): Quat => { const r = (deg * Math.PI) / 360; return [Math.sin(r), 0, 0, Math.cos(r)]; };
/** y축으로 deg도 돌린 폰 방향(90이면 -x 쪽을 본다). */
const yaw = (deg: number): Quat => { const r = (deg * Math.PI) / 360; return [0, Math.sin(r), 0, Math.cos(r)]; };
/** a·b 쿼터니언 곱(b를 먼저 돌리고 a를 돌린다). */
const mul = ([ax, ay, az, aw]: Quat, [bx, by, bz, bw]: Quat): Quat => [
  aw * bx + ax * bw + ay * bz - az * by,
  aw * by - ax * bz + ay * bw + az * bx,
  aw * bz + ax * by - ay * bx + az * bw,
  aw * bw - ax * bx - ay * by - az * bz,
];
const close = (got: number[] | null, want: number[]) => {
  expect(got).not.toBeNull();
  got!.forEach((v, i) => expect(v).toBeCloseTo(want[i]!, 6));
};

describe("floorRayPoint: 화면 가운데 시선이 바닥 면과 만나는 점", () => {
  it("45° 아래를 보면 폰 높이만큼 앞(-z)의 바닥", () => {
    close(floorRayPoint([1, 1.5, 2], pitch(-45), 0), [1, 0, 0.5]);
  });

  it("옆으로 돈 폰도 그 방향으로 간다(90° 돌고 45° 아래 → -x 쪽)", () => {
    close(floorRayPoint([0, 1.5, 0], mul(yaw(90), pitch(-45)), 0), [-1.5, 0, 0]);
  });

  it("수평이나 위를 보면 null", () => {
    expect(floorRayPoint([0, 1.5, 0], [0, 0, 0, 1], 0)).toBeNull();
    expect(floorRayPoint([0, 1.5, 0], pitch(20), 0)).toBeNull();
  });

  it("6m보다 멀면 null(10° 아래는 8.6m, 15° 아래는 5.8m)", () => {
    expect(floorRayPoint([0, 1.5, 0], pitch(-10), 0)).toBeNull();
    expect(floorRayPoint([0, 1.5, 0], pitch(-15), 0)).not.toBeNull();
  });

  it("바닥 면이 폰보다 위면 null", () => {
    expect(floorRayPoint([0, 1.5, 0], pitch(-45), 1.6)).toBeNull();
  });
});

describe("floorPlaneY: 어림 바닥 높이", () => {
  it("local-floor가 없으면 폰보다 1.5m 아래", () => {
    expect(floorPlaneY(1.2, null)).toBeCloseTo(-0.3);
  });

  it("local-floor가 폰보다 0.9m~2.5m 아래면 그 높이", () => {
    expect(floorPlaneY(1.2, 0)).toBe(0);
    expect(floorPlaneY(1.2, 0.25)).toBe(0.25);
    expect(floorPlaneY(1.2, -1.3)).toBe(-1.3);
  });

  it("local-floor가 너무 가깝거나(0.9m 미만) 멀면(2.5m 초과) 폰보다 1.5m 아래", () => {
    expect(floorPlaneY(1.2, 0.8)).toBeCloseTo(-0.3);
    expect(floorPlaneY(1.2, 1.5)).toBeCloseTo(-0.3);
    expect(floorPlaneY(1.2, -1.4)).toBeCloseTo(-0.3);
  });
});

describe("planeNormal: hit 자세의 +Y", () => {
  it("수평면은 위, z축으로 90° 눕힌 면(벽)은 -x", () => {
    expect(planeNormal([0, 0, 0, 1])).toEqual([0, 1, 0]);
    expect(planeNormal([0, 0, Math.SQRT1_2, Math.SQRT1_2])).toEqual([-1, 0, 0]);
  });
});

describe("aimPoint: 조준점 고르기", () => {
  const viewer = [0, 1.5, 0];
  const UP: Quat = [0, 0, 0, 1];

  it("hit-test 점이 있으면 그 점(어림 아님). 위를 봐도 같다", () => {
    expect(aimPoint({ hit: [0.2, 0.1, -1], hitOrientation: UP, viewer, viewerOrientation: pitch(30), localFloorY: null }))
      .toEqual({ point: [0.2, 0.1, -1], orientation: UP, estimated: false });
  });

  it("hit-test 점이 없으면 어림 바닥(폰 1.5m 아래)과 시선이 만나는 점, 어림 표시", () => {
    const aim = aimPoint({ hit: null, hitOrientation: null, viewer, viewerOrientation: pitch(-45), localFloorY: null });
    expect(aim).toMatchObject({ orientation: UP, estimated: true });
    close(aim!.point, [0, 0, -1.5]);
  });

  it("local-floor 높이가 있으면 그 면과 만나는 점", () => {
    const aim = aimPoint({ hit: null, hitOrientation: null, viewer, viewerOrientation: pitch(-45), localFloorY: 0.2 });
    close(aim!.point, [0, 0.2, -1.3]);
  });

  it("hit-test 점이 없고 수평 위를 보거나 자세가 없으면 null", () => {
    expect(aimPoint({ hit: null, hitOrientation: null, viewer, viewerOrientation: UP, localFloorY: null })).toBeNull();
    expect(aimPoint({ hit: null, hitOrientation: null, viewer: null, viewerOrientation: null, localFloorY: null })).toBeNull();
  });
});
