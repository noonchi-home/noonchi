import { describe, expect, it } from "vitest";
import { maskFromBg, maskFromBits, sampleColors, shotStats } from "../scripts/twin3d/shot-stats.js";

/** 10×10, 배경 #BDBDBD, (x 2~5, y 3~7)을 paint로 칠한 RGBA */
function image(paint: (x: number, y: number) => [number, number, number]) {
  const px = new Uint8Array(10 * 10 * 4);
  for (let y = 0; y < 10; y++) for (let x = 0; x < 10; x++) {
    const inside = x >= 2 && x <= 5 && y >= 3 && y <= 7;
    const [r, g, b] = inside ? paint(x, y) : [0xbd, 0xbd, 0xbd];
    px.set([r, g, b, 255], (y * 10 + x) * 4);
  }
  return px;
}
const BG: [number, number, number] = [0xbd, 0xbd, 0xbd];
const stats = (px: Uint8Array) => shotStats(px, 10, 10, maskFromBg(px, 10, 10, BG));

describe("shotStats", () => {
  it("집 영역·외곽 상자·밝기", () => {
    const s = stats(image(() => [240, 240, 240]));
    expect(s.houseFrac).toBeCloseTo(0.2);
    expect(s.bbox).toEqual({ x0: 2, y0: 3, x1: 5, y1: 7 });
    expect(s.bboxFill).toEqual({ w: 0.4, h: 0.5 });
    expect([s.p5, s.p95, s.std, s.bright, s.dark, s.clipped, s.saturation]).toEqual([240, 240, 0, 1, 0, 0, 0]);
  });
  it("검정·흰색 반반: 어두운 픽셀·날아간 픽셀", () => {
    const s = stats(image((x) => (x < 4 ? [0, 0, 0] : [255, 255, 255])));
    expect(s.dark).toBeCloseTo(0.5);
    expect(s.clipped).toBeCloseTo(0.5);
    expect([s.p5, s.p95]).toEqual([0, 255]);
  });
  it("마스크가 정한 픽셀만 집: 배경과 같은 색이어도 마스크 안이면 집", () => {
    const px = image(() => [0xbd, 0xbd, 0xbd]);
    expect(stats(px).bbox).toBeNull();
    const mask = new Uint8Array(100); mask[33] = 1;
    expect(shotStats(px, 10, 10, mask).bbox).toEqual({ x0: 3, y0: 3, x1: 3, y1: 3 });
  });
  it("표본 색: 점 둘레 3×3 평균", () => {
    expect(sampleColors(image(() => [240, 230, 220]), 10, [[3, 5]])).toEqual([[240, 230, 220]]);
  });
});

describe("maskFromBits", () => {
  it("캔버스 자리(left·top)에 놓는다: 위에 막대가 있는 화면", () => {
    // 4×2 캔버스에서 (1,0)·(3,1)이 집. 사진 6×4, 캔버스는 left 1·top 2
    const bits = Buffer.from([(1 << 1) | (1 << 7)]).toString("base64");
    const m = maskFromBits({ width: 4, height: 2, bits, left: 1, top: 2 }, 6, 4);
    expect([...m].flatMap((v, i) => (v ? [i] : []))).toEqual([2 * 6 + 2, 3 * 6 + 4]);
  });
  it("자리가 없으면 사진 왼쪽 위, 사진을 벗어나면 오류", () => {
    const one = Buffer.from([1]).toString("base64");
    expect(maskFromBits({ width: 1, height: 1, bits: one }, 2, 2)[0]).toBe(1);
    expect(() => maskFromBits({ width: 3, height: 1, bits: one }, 2, 2)).toThrow("마스크 3×1(자리 0,0)가 사진 2×2를 벗어나요");
  });
});
