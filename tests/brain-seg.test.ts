// seg 출력 풀기(src/brain/seg.ts): 프로토 32장 × 계수 → 상자로 자른 0/1 그림, 그 테두리 상자, 바닥 점. 합성 값으로 본다.

import { describe, expect, it } from "vitest";
import { maskCells, maskOf } from "../src/brain/seg.js";

const P = 160;
/** 프로토 [32, 160, 160]: k번 장을 fill(c, r) 값으로 채운다. */
function protos(fills: Record<number, (c: number, r: number) => number>): Float32Array {
  const p = new Float32Array(32 * P * P);
  for (const [k, fill] of Object.entries(fills)) for (let r = 0; r < P; r++) for (let c = 0; c < P; c++) p[Number(k) * P * P + r * P + c] = fill(c, r);
  return p;
}
const coeffs = (v: Record<number, number>) => { const a = new Float32Array(32); for (const [k, x] of Object.entries(v)) a[Number(k)] = x; return a; };
const SAME = { ratio: 1, padX: 0, padY: 0 };
const SQUARE = { width: 640, height: 640 };
const inCircle = (c: number, r: number) => (c + 0.5 - 80) ** 2 + (r + 0.5 - 80) ** 2 < 20 ** 2;

describe("maskOf", () => {
  it("0번 프로토만 「가운데 원」이고 계수가 [8, 0, …]이면 원 안 칸만 1이다. 계수 0인 프로토는 값이 커도 보지 않는다", () => {
    const p = protos({ 0: (c, r) => (inCircle(c, r) ? 1 : -1), 1: () => 50 });
    const m = maskOf(coeffs({ 0: 8 }), p, [240, 240, 160, 160], SAME, SQUARE)!;
    expect([m.mask.cols, m.mask.rows, m.mask.at]).toEqual([40, 40, [240, 240, 160, 160]]);
    const want = new Uint8Array(40 * 40);
    for (let r = 0; r < 40; r++) for (let c = 0; c < 40; c++) want[r * 40 + c] = inCircle(c + 60, r + 60) ? 1 : 0;
    expect(want.reduce((a, b) => a + b, 0)).toBeGreaterThan(1000);
    // base64 왕복: 비트를 풀면 원래 0/1과 같다
    expect(Buffer.from(m.mask.bits, "base64")).toHaveLength(Math.ceil((40 * 40) / 8));
    expect([...maskCells(m.mask)]).toEqual([...want]);
    // 테두리 상자는 원이 닿는 칸 끝, 바닥 점은 가장 아래 1인 줄(칸 76~83)의 가운데
    expect(m.box).toEqual([240, 240, 160, 160]);
    expect(m.foot).toEqual([320, 400]);
  });

  it("상자 밖 칸은 프로토 값이 커도 넣지 않는다(상자로 자름). 칸 수가 8의 배수가 아니어도 비트 길이는 올림", () => {
    const m = maskOf(coeffs({ 0: 1 }), protos({ 0: () => 9 }), [100, 100, 40, 40], SAME, SQUARE)!;
    expect([m.mask.cols, m.mask.rows, m.mask.at]).toEqual([10, 10, [100, 100, 40, 40]]);
    expect(Buffer.from(m.mask.bits, "base64")).toHaveLength(13);
    expect([...maskCells(m.mask)]).toEqual(new Array(100).fill(1));
    expect(m.box).toEqual([100, 100, 40, 40]);
  });

  it("상자가 칸 사이에 걸치면 바깥쪽 칸까지 넣고, 1인 칸이 일부면 box는 그 칸들의 테두리다", () => {
    // 칸 25~35(상자 102~138 → 칸 25~34) 가운데 열 27~30, 줄 26~33만 1
    const p = protos({ 0: (c, r) => (c >= 27 && c <= 30 && r >= 26 && r <= 33 ? 1 : -1) });
    const m = maskOf(coeffs({ 0: 2 }), p, [102, 102, 36, 36], SAME, SQUARE)!;
    expect([m.mask.cols, m.mask.rows, m.mask.at]).toEqual([10, 10, [100, 100, 40, 40]]);
    expect(m.box).toEqual([108, 104, 16, 32]);
    expect(m.foot).toEqual([116, 136]);
  });

  it("box와 foot은 레터박스를 되돌린 원본 픽셀이고 사진 끝에서 잘린다. 채움 줄(사진 밖) 칸은 0이다", () => {
    // 320×178 사진을 2배로 키워 위아래 142줄을 채운 레터박스. 상자는 왼쪽 끝을 넘고 위쪽 채움 줄에 걸친다
    const lb = { ratio: 2, padX: 0, padY: 142 };
    const m = maskOf(coeffs({ 0: 1 }), protos({ 0: () => 9 }), [-10, 130, 60, 50], lb, { width: 320, height: 178 })!;
    expect([m.mask.cols, m.mask.rows, m.mask.at]).toEqual([13, 13, [0, -7, 26, 26]]);
    const cells = maskCells(m.mask);
    const rowsOn = Array.from({ length: 13 }, (_, r) => cells[r * 13]);
    expect(rowsOn).toEqual([0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1]); // 줄 32~34는 가운데가 채움 줄 안
    expect(m.box).toEqual([0, 0, 26, 19]); // 줄 35의 위 끝(−1)은 0으로 자른다
    expect(m.foot).toEqual([13, 19]);
  });

  it("1인 칸이 4칸 미만이면 null", () => {
    const three = protos({ 0: (c, r) => (r === 30 && c >= 30 && c <= 32 ? 1 : -1) });
    expect(maskOf(coeffs({ 0: 1 }), three, [100, 100, 60, 60], SAME, SQUARE)).toBeNull();
    const four = protos({ 0: (c, r) => (r === 30 && c >= 30 && c <= 33 ? 1 : -1) });
    expect(maskOf(coeffs({ 0: 1 }), four, [100, 100, 60, 60], SAME, SQUARE)).not.toBeNull();
    expect(maskOf(coeffs({ 0: 1 }), four, [700, 700, 20, 20], SAME, SQUARE)).toBeNull(); // 격자 밖 상자
  });
});
