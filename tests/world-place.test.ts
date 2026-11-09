import { describe, expect, it } from "vitest";
import { inView, placeBox, rayDir, surfacesFromLayout } from "../src/world/place.js";
import type { CameraView } from "../src/phone/session.js";

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
  it("닿는 면이 없으면 바닥, 시야 뒤 점은 시야 밖", () => {
    const floor = placeBox(view, [220, 160, 40, 20], { width: 480, height: 360 }, [], () => 0);
    expect(floor.surface).toBeNull();
    expect(floor.position![0]).toBeCloseTo(1.5, 2);
    expect(floor.position![1]).toBe(0);
    expect(inView(view, [-2, 0, 0])).toBe(false);
    expect(inView(view, [1.5, 0, 0])).toBe(true);
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
