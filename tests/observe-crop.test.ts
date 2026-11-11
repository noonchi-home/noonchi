import { describe, expect, it } from "vitest";
import jpeg from "jpeg-js";
import { cropBox, cropJpeg, onCropEdge, toFrameBox } from "../src/observe/crop.js";
import { pixelOf, placeBox } from "../src/world/place.js";
import { frameJpeg, LOOK_SIZE, LOOK_VIEW } from "./helpers/camera.js";

const gray = (img: { width: number; data: Uint8Array }, x: number, y: number) => img.data[(y * img.width + x) * 4]!;

describe("가까이 보기 자르기 셈", () => {
  it("트윈 점을 엔진 프레임 픽셀로 찍는다: 그림 가운데 광선 위의 점은 가운데, 카메라 뒤는 null", () => {
    for (const p of [[1.5, 0, 0], [0.6, 0.9, 0]] as [number, number, number][]) {
      const px = pixelOf(LOOK_VIEW, p, LOOK_SIZE)!;
      expect(px[0]).toBeCloseTo(240, 3);
      expect(px[1]).toBeCloseTo(180, 3);
    }
    expect(pixelOf(LOOK_VIEW, [-2, 0, 0], LOOK_SIZE)).toBeNull();
  });

  it("자르는 상자는 프레임 절반 크기이고 그림 안으로 붙인다", () => {
    expect(cropBox([240, 180], LOOK_SIZE)).toEqual([120, 90, 240, 180]);
    expect(cropBox([10, 10], LOOK_SIZE)).toEqual([0, 0, 240, 180]);
    expect(cropBox([470, 350], LOOK_SIZE)).toEqual([240, 180, 240, 180]);
  });

  it("잘라 키운 사진의 상자를 엔진 프레임 픽셀로 옮기면 같은 트윈 자리로 돌아온다", () => {
    const box = toFrameBox([220, 160, 40, 20], [120, 90, 240, 180], LOOK_SIZE);
    expect(box).toEqual([230, 170, 20, 10]);
    const placed = placeBox(LOOK_VIEW, box, LOOK_SIZE, [], () => 0);
    expect(placed.position![0]).toBeCloseTo(1.5, 2);
    expect(placed.position![1]).toBe(0);
    expect(placed.position![2]).toBeCloseTo(0, 2);
  });

  it("잘라 낸 자리를 프레임 크기로 2배 키운 JPEG을 만든다", () => {
    const out = cropJpeg(frameJpeg(1, [[170, 140, 20, 10]]), [120, 90, 240, 180], LOOK_SIZE);
    const img = jpeg.decode(out, { useTArray: true, formatAsRGBA: true });
    expect([img.width, img.height]).toEqual([480, 360]);
    expect(gray(img, 120, 110)).toBeGreaterThan(200);   // 흰 네모가 [100, 100, 40, 20]으로 커졌다
    expect(gray(img, 20, 20)).toBeLessThan(160);
    expect(() => cropJpeg(frameJpeg(1), [0, 0, 240, 180], { width: 640, height: 480 })).toThrow(/사진 크기/);
  });

  it("잘라 본 상자 경계 4px 안에 닿은 상자(엔진 프레임 픽셀)는 경계 상자다", () => {
    const crop: [number, number, number, number] = [120, 90, 240, 180];
    expect(onCropEdge([230, 170, 20, 10], crop)).toBe(false);
    expect(onCropEdge([123, 170, 20, 10], crop)).toBe(true);
    expect(onCropEdge([230, 92, 20, 10], crop)).toBe(true);
    expect(onCropEdge([340, 170, 17, 10], crop)).toBe(true);
    expect(onCropEdge([230, 170, 20, 97], crop)).toBe(true);
    expect(onCropEdge([125, 95, 230, 170], crop)).toBe(false);
  });
});
