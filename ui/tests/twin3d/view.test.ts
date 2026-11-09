// @vitest-environment node
// 구운 보기 카메라: 그림 픽셀 지도 카메라(가운데 + 배율)를 three 정사영 틀로 바꾸면 투영 자리가 그림 픽셀 자리와 같고,
// 두 카메라 사이는 판 transform(translate·scale)을 곧게 잇는다.
import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { MOKRYEON_MAP_CAMERA as V, planToPixel } from "../../src/twin3d/projection";
import { between, ease, frustumOf, placeCamera, plateTransform, projectThree, screenOf } from "../../src/twin3d/view";

const box = { width: 1282, height: 1048 };
const whole = { cx: V.width / 2, cy: V.height / 2, scale: box.width / V.width };
const tx = (c: { cx: number; scale: number }) => box.width / 2 - c.cx * c.scale;

describe("구운 보기 카메라", () => {
  it("집 전체 틀은 그림 계획 카메라 그대로다(가로 ortho_scale, shift)", () => {
    const f = frustumOf(V, whole, box);
    expect(f.left).toBeCloseTo(-V.orthoScale / 2 + V.shiftX * V.orthoScale, 9);
    expect(f.right - f.left).toBeCloseTo(V.orthoScale, 9);
    expect(f.top - f.bottom).toBeCloseTo((V.orthoScale * box.height) / box.width, 9);
  });
  it("three 카메라로 투영한 자리가 planToPixel을 상자로 옮긴 자리와 같다", () => {
    const cam = new THREE.OrthographicCamera();
    const c = { cx: 980, cy: 700, scale: 0.95 };
    placeCamera(cam, V, c, box);
    for (const [x, z, h] of [[9.96, 3.92, 0.75], [5.853, 0.761, 0.9], [0, 0, 0], [16.2, 13.6, 1.05]] as const) {
      const p = projectThree(cam, box, [x, h, z]);
      const q = screenOf(c, box, planToPixel(V, [x, z], h));
      expect(p.x).toBeCloseTo(q.x, 2);
      expect(p.y).toBeCloseTo(q.y, 2);
    }
  });
  it("사이 카메라는 판 transform의 translate·scale을 곧게 잇는다", () => {
    const b = { cx: 1200, cy: 500, scale: 1.6 };
    expect(between(whole, b, box, 0)).toEqual(whole);
    const end = between(whole, b, box, 1);
    expect([end.cx, end.cy, end.scale].map((v) => Number(v.toFixed(9)))).toEqual([b.cx, b.cy, b.scale]);
    const half = between(whole, b, box, 0.5);
    expect(tx(half)).toBeCloseTo((tx(whole) + tx(b)) / 2, 9);
    expect(half.scale).toBeCloseTo((whole.scale + b.scale) / 2, 9);
    expect(plateTransform(half, box)).toBe(`translate(${tx(half)}px, ${box.height / 2 - half.cy * half.scale}px) scale(${half.scale})`);
  });
  it("움직임 곡선은 0에서 시작해 1에서 멈추고 빨리 시작한다", () => {
    expect([ease(0), ease(1)]).toEqual([0, 1]);
    expect(ease(0.25)).toBeGreaterThan(0.6);
    for (let t = 0; t < 0.95; t += 0.05) expect(ease(t + 0.05)).toBeGreaterThanOrEqual(ease(t));
  });
});
