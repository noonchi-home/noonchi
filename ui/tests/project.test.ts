import { describe, expect, it } from "vitest";
import { projectPoint, screenPoints } from "../src/lib/twin-project";

const I = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

describe("projectPoint", () => {
  it("단위 행렬: 원점은 화면 가운데", () => {
    expect(projectPoint(I, [0, 0, 0], 800, 600)).toEqual({ x: 400, y: 300, visible: true });
  });
  it("NDC (1,1)은 오른쪽 위", () => {
    expect(projectPoint(I, [1, 1, 0], 800, 600)).toMatchObject({ x: 800, y: 0 });
  });
  it("카메라 뒤(w<=0)나 화면 밖은 보이지 않음", () => {
    const behind = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, -1, 0, 0, 0, 0]; // w = -z
    expect(projectPoint(behind, [0, 0, 1], 800, 600).visible).toBe(false);
    expect(projectPoint(I, [3, 0, 0], 800, 600).visible).toBe(false);
  });
  it("원근(w로 나눔): 열 우선 행렬의 이동 칸을 쓴다", () => {
    // x' = x + 2 (m[12]), w = 2 (m[15]) → NDC x = (0 + 2) / 2 = 1 → 오른쪽 끝
    const m = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 2, 0, 0, 2];
    expect(projectPoint(m, [0, 0, 0], 800, 600)).toEqual({ x: 800, y: 300, visible: true });
  });
});

describe("screenPoints", () => {
  const rect = { left: 0, top: 30, width: 800, height: 600 };
  it("캔버스 자리(위 막대 아래)만큼 옮기고 반올림한다", () => {
    const world = new Map<string, [number, number, number] | null>([["a", [0.001, 0, 0]]]);
    expect(screenPoints(I, world, rect, () => false).get("a")).toEqual({ x: 400, y: 330, visible: true });
  });
  it("숨은 노드·자리 없는 기기·화면 밖은 보이지 않음", () => {
    const world = new Map<string, [number, number, number] | null>([["hid", [0, 0, 0]], ["none", null], ["out", [3, 0, 0]]]);
    const pts = screenPoints(I, world, rect, (id) => id === "hid");
    expect([...pts.values()].map((p) => p.visible)).toEqual([false, false, false]);
  });
});
