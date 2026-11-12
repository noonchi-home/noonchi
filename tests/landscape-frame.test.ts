// 폰을 가로로 든 엔진 프레임(640×360)과 세로로 든 프레임(360×640): 서버 셈은 프레임 헤더의 width·height·투영 행렬만 쓰므로 방향과 상관없이 같은 트윈 자리가 나와야 한다.
// 트윈 자리 ↔ 프레임 픽셀(src/world/place.ts), 가까이 보기 자르기(프레임 절반 크기, src/observe/crop.ts), 잘라 본 감지의 상자·바닥 점·마스크 자리.
import { describe, expect, it } from "vitest";
import { fullMask } from "../src/brain/seg.js";
import { cropBox, toFrameDetection } from "../src/observe/crop.js";
import type { CameraView } from "../src/phone/session.js";
import { pixelOf, placePoint } from "../src/world/place.js";
import { cameraAt } from "./helpers/camera.js";

type V3 = [number, number, number];
/** 세로 시야각 60°와 비율(가로/세로)의 투영 행렬(열 우선). 폰은 화면 방향에 맞는 행렬을 프레임마다 보낸다. */
function projection(aspect: number, vfovDeg = 60): number[] {
  const f = 1 / Math.tan((vfovDeg * Math.PI) / 360);
  return [f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, -1.0002, -1, 0, 0, -0.020002, 0];
}
const LANDSCAPE = { width: 640, height: 360 };
const PORTRAIT = { width: 360, height: 640 };
const view = (size: { width: number; height: number }): CameraView => ({ ...cameraAt(-Math.PI / 2), projection: projection(size.width / size.height) });
/** 카메라 (0, 1.5, 0)에서 +x를 45° 숙여 본다: 바닥 위 점들. */
const FLOOR: V3[] = [[1.5, 0, 0], [1.2, 0, 0.3], [2, 0, -0.4]];

describe.each([["가로 640×360", LANDSCAPE], ["세로 360×640", PORTRAIT]])("%s 엔진 프레임", (_, size) => {
  const v = view(size);

  it("그림 가운데 광선 위의 바닥 점은 프레임 가운데 픽셀이다", () => {
    const px = pixelOf(v, [1.5, 0, 0], size)!;
    expect(px[0]).toBeCloseTo(size.width / 2, 3);
    expect(px[1]).toBeCloseTo(size.height / 2, 3);
  });

  it.each(FLOOR)("바닥 점 (%f, %f, %f)을 픽셀로 찍고 그 픽셀을 다시 놓으면 같은 트윈 자리다", (...p) => {
    const px = pixelOf(v, p, size)!;
    expect(px[0]).toBeGreaterThanOrEqual(0);
    expect(px[0]).toBeLessThanOrEqual(size.width);
    expect(px[1]).toBeGreaterThanOrEqual(0);
    expect(px[1]).toBeLessThanOrEqual(size.height);
    const placed = placePoint(v, px, size, [], () => 0).position!;
    expect(placed[0]).toBeCloseTo(p[0], 2);
    expect(placed[1]).toBe(0);
    expect(placed[2]).toBeCloseTo(p[2], 2);
  });

  it("가까이 보기는 프레임 절반 크기(같은 비율)로 자르고 그림 안으로 붙인다", () => {
    const [w, h] = [size.width / 2, size.height / 2];
    expect(cropBox([size.width / 2, size.height / 2], size)).toEqual([w / 2, h / 2, w, h]);
    expect(cropBox([4, 4], size)).toEqual([0, 0, w, h]);
    expect(cropBox([size.width - 4, size.height - 4], size)).toEqual([w, h, w, h]);
  });

  it("잘라 키운 사진의 감지(상자·바닥 점·마스크 자리)를 프레임 픽셀로 옮기면 그 바닥 점이 같은 트윈 자리다", () => {
    const target: V3 = [1.2, 0, 0.3];
    const at = pixelOf(v, target, size)!;
    const crop = cropBox(at, size);
    // 잘라 키운 사진 안의 그 점(프레임 픽셀 → 키운 사진 픽셀)
    const k = size.width / crop[2];
    const foot: [number, number] = [(at[0] - crop[0]) * k, (at[1] - crop[1]) * k];
    const box: [number, number, number, number] = [foot[0] - 20, foot[1] - 40, 40, 40];
    const moved = toFrameDetection({ box, foot, mask: fullMask(box) }, crop, size);
    expect(moved.foot[0]).toBeCloseTo(at[0], 6);
    expect(moved.foot[1]).toBeCloseTo(at[1], 6);
    expect(moved.box).toEqual(moved.mask.at);
    expect(moved.box[2]).toBeCloseTo(40 / k, 6);
    expect(moved.box[3]).toBeCloseTo(40 / k, 6);
    const placed = placePoint(v, moved.foot, size, [], () => 0).position!;
    expect(placed[0]).toBeCloseTo(target[0], 2);
    expect(placed[2]).toBeCloseTo(target[2], 2);
  });
});

describe("가로·세로 프레임", () => {
  it("같은 자리에서 같은 쪽을 보면 폰을 가로로 들든 세로로 들든 같은 바닥 점이 같은 트윈 자리로 놓인다", () => {
    for (const p of FLOOR) {
      const a = placePoint(view(LANDSCAPE), pixelOf(view(LANDSCAPE), p, LANDSCAPE)!, LANDSCAPE, [], () => 0).position!;
      const b = placePoint(view(PORTRAIT), pixelOf(view(PORTRAIT), p, PORTRAIT)!, PORTRAIT, [], () => 0).position!;
      expect(a[0]).toBeCloseTo(b[0], 2);
      expect(a[2]).toBeCloseTo(b[2], 2);
    }
  });
});
