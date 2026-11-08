import { describe, expect, it } from "vitest";
import { focusMarks, project, toEdge } from "../ui/src/phone/core/project.js";

// 세로 화각 90°, 가로세로 1, near 0.1, far 100인 원근 투영(열 우선)
const n = 0.1;
const f = 100;
const P = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, (f + n) / (n - f), -1, 0, 0, (2 * f * n) / (n - f), 0];
const I = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
// 카메라가 (0, 0, 1)에 있을 때의 view 행렬 = 이동(0, 0, -1)
const V = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, -1, 1];

describe("초점 투영", () => {
  it("화면 가운데·오른쪽 위·뒤", () => {
    expect(project([0, 0, -2], P, I)).toMatchObject({ u: 0.5, v: 0.5, inside: true, behind: false });
    const p = project([1, 1, -2], P, I);
    expect(p.u).toBeCloseTo(0.75);
    expect(p.v).toBeCloseTo(0.25);
    expect(project([0, 0, 2], P, I)).toMatchObject({ inside: false, behind: true });
    expect(project([0, 0, -1], P, V)).toMatchObject({ u: 0.5, v: 0.5, inside: true });
  });

  it("화면 밖은 가장자리 화살표 자리", () => {
    const e = toEdge({ u: 1.5, v: 0.5 });
    expect(e.u).toBeCloseTo(0.92);
    expect(e.v).toBeCloseTo(0.5);
    expect(e.angle).toBeCloseTo(0);
    expect(toEdge({ u: 0.5, v: -2 }).angle).toBeCloseTo(-90);
  });

  it("focusMarks: 화면 안은 그 자리, 밖은 가장자리(off)", () => {
    const marks = focusMarks([{ id: "a", label: "TV", ar: [0, 0, -2] }, { id: "b", label: "냉장고", ar: [5, 0, -2] }], P, I);
    expect(marks[0]).toMatchObject({ id: "a", label: "TV", u: 0.5, v: 0.5, off: false });
    expect(marks[1]).toMatchObject({ id: "b", off: true });
    expect(marks[1]!.u).toBeCloseTo(0.92);
  });
});
