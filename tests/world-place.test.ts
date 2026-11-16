import { describe, expect, it } from "vitest";
import { BASIN_SIZE, inView, placeBox, placePoint, rayDir, surfacesFromLayout } from "../src/world/place.js";
import type { CameraView } from "../src/contract/observe.js";

// 90° 시야 정사각형 투영(열 우선), 카메라는 트윈 (0, 1.5, 0)에서 +x를 보고 45° 아래로 숙임
const P = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, -1.0002, -1, 0, 0, -0.020002, 0];
const tilt = Math.sin(-Math.PI / 8), c = Math.cos(-Math.PI / 8);
const yawToX: [number, number, number, number] = [0, Math.sin(-Math.PI / 4), 0, Math.cos(-Math.PI / 4)];   // AR -Z를 +x로
const mul = (a: number[], b: number[]) => [a[3]! * b[0]! + a[0]! * b[3]! + a[1]! * b[2]! - a[2]! * b[1]!, a[3]! * b[1]! - a[0]! * b[2]! + a[1]! * b[3]! + a[2]! * b[0]!, a[3]! * b[2]! + a[0]! * b[1]! - a[1]! * b[0]! + a[2]! * b[3]!, a[3]! * b[3]! - a[0]! * b[0]! - a[1]! * b[1]! - a[2]! * b[2]!];
const view: CameraView = { origin: [0, 1.5, 0], orientation: mul(yawToX, [tilt, 0, 0, c]) as [number, number, number, number], theta: 0, projection: P };

describe("트윈 위치", () => {
  it("화면 가운데 광선은 앞으로 45° 아래를 향한다", () => {
    const d = rayDir(view, [0, 0]);
    expect(d[0]).toBeCloseTo(Math.SQRT1_2, 3);
    expect(d[1]).toBeCloseTo(-Math.SQRT1_2, 3);
    expect(d[2]).toBeCloseTo(0, 3);
  });
  it("맞춤 회전 theta만큼 수평으로 돈다", () => {
    const d = rayDir({ ...view, theta: Math.PI / 2 }, [0, 0]);
    expect(d[0]).toBeCloseTo(0, 3);
    expect(d[2]).toBeCloseTo(Math.SQRT1_2, 3);
  });
  it("박스 아래 가운데 광선이 식탁 윗면에 닿으면 그 점과 식탁 id", () => {
    const table = { id: "table_1", label: "식탁", center: [0.75, 0] as [number, number], top: 0.75, radius: 0.6 };
    const r = placeBox(view, [220, 160, 40, 20], { width: 480, height: 360 }, [table], () => 0);
    expect(r.surface).toBe("table_1");
    expect(r.position![1]).toBeCloseTo(0.75, 2);
    expect(r.position![0]).toBeCloseTo(0.75, 1);
    expect(r.errorM).toBeGreaterThan(0);
  });
  it("placePoint는 그 픽셀의 광선으로 자리를 낸다. placeBox는 상자 아랫변 가운데 픽셀의 placePoint다", () => {
    const table = { id: "table_1", label: "식탁", center: [0.75, 0] as [number, number], top: 0.75, radius: 0.6 };
    const size = { width: 480, height: 360 };
    expect(placePoint(view, [240, 180], size, [table], () => 0)).toEqual(placeBox(view, [220, 160, 40, 20], size, [table], () => 0));
    // 20px 아래 픽셀은 식탁을 벗어나 다른 자리(0.1m 넘게 다름)
    const lower = placePoint(view, [240, 200], size, [table], () => 0);
    const upper = placePoint(view, [240, 180], size, [table], () => 0);
    expect(Math.hypot(lower.position![0] - upper.position![0], lower.position![2] - upper.position![2])).toBeGreaterThan(0.1);
  });
  it("닿는 면이 없으면 바닥, 시야 뒤 점은 시야 밖", () => {
    const floor = placeBox(view, [220, 160, 40, 20], { width: 480, height: 360 }, [], () => 0);
    expect(floor.surface).toBeNull();
    expect(floor.position![0]).toBeCloseTo(1.5, 2);
    expect(floor.position![1]).toBe(0);
    expect(inView(view, [-2, 0, 0])).toBe(false);
    expect(inView(view, [1.5, 0, 0])).toBe(true);
  });
  it("싱크볼이 있는 면: 광선이 윗면 높이에서 싱크볼 사각형(깊이는 facing 방향) 안이면 part basin, 그 밖 조리대면 part 없음", () => {
    const sink = (size: [number, number], facing_deg: number) => ({
      id: "sink_1", label: "싱크대", center: [0.6, 0.5] as [number, number], top: 0.9, radius: 1.2, basin: { center: [0.6, 0] as [number, number], size, facing_deg },
    });
    const at = (box: [number, number, number, number], s: ReturnType<typeof sink>) => placeBox(view, box, { width: 480, height: 360 }, [s], () => 0);
    const middle: [number, number, number, number] = [220, 160, 40, 20]; // 윗면 (0.6, 0)
    const side: [number, number, number, number] = [400, 160, 40, 20]; // 윗면 (0.6, ±0.64)
    expect(at(middle, sink([0.6, 0.4], 0))).toMatchObject({ surface: "sink_1", part: "basin" });
    const beside = at(side, sink([0.6, 0.4], 0));
    expect(beside).toMatchObject({ surface: "sink_1", part: null });
    expect(Math.abs(beside.position![2])).toBeCloseTo(0.64, 1);
    // 폭 0.4·깊이 1.4: facing 0이면 깊이가 x라 옆 점은 밖, facing 90이면 깊이가 y라 안
    expect(at(side, sink([0.4, 1.4], 0)).part).toBeNull();
    expect(at(side, sink([0.4, 1.4], 90)).part).toBe("basin");
    expect(at(middle, { ...sink([0.6, 0.4], 0), basin: undefined } as never).part).toBeNull();
  });

  it("싱크볼 기준점(anchors.basin, 평면도 점)이 있는 싱크대 면은 싱크볼 사각형을 가진다: 가운데는 그 점, 크기는 BASIN_SIZE, 방향은 배치 facing", () => {
    const [k] = surfacesFromLayout([{ id: "k", name: "싱크대", type: "sink_counter", plan: [5.853, 0.761], base: 0, height: 0.9, footprint: [2.278, 0.65], facing_deg: 0, basin: [5.86, 1.38] }]);
    expect(k!.basin).toEqual({ center: [5.86, 1.38], size: BASIN_SIZE, facing_deg: 0 });
    expect(BASIN_SIZE).toEqual([0.74, 0.44]);
    expect(surfacesFromLayout([{ id: "t", name: "식탁", type: "dining_table", plan: [1, 2], base: 0, height: 0.75 }])[0]!.basin).toBeUndefined();
  });

  it("배치의 식탁·책상·조리대·싱크대만 면으로 쓴다(조명은 빼고)", () => {
    const s = surfacesFromLayout([
      { id: "t", name: "식탁", type: "dining_table", plan: [1, 2], base: 0, height: 0.75, footprint: [1.2, 0.8] },
      { id: "s", name: "소파", type: "sofa", plan: [3, 3], base: 0, height: 0.4 },
      { id: "k", name: "싱크대", type: "sink_counter", plan: [0, 0], base: 0, height: 0.9 },
      { id: "l", name: "스탠드", type: "desk_lamp", plan: [1, 1], base: 0.75, height: 0.4 },
    ]);
    expect(s.map((x) => [x.id, x.top])).toEqual([["t", 0.75], ["k", 0.9]]);
    expect(s[0]!.radius).toBeCloseTo(Math.hypot(1.2, 0.8) / 2, 6);
  });
});
