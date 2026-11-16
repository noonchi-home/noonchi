// @vitest-environment node
import { describe, expect, it } from "vitest";
import { hemisphere, irradiance } from "../../src/twin/3d/irradiance";

const uniform = (w: number, h: number, v: number) => ({ width: w, height: h, data: new Float32Array(w * h * 4).fill(v) });

describe("하늘 사진 조도", () => {
  it("고른 하늘(세기 1)은 위·아래·수평 모두 π다", () => {
    const irr = irradiance(uniform(256, 128, 1));
    for (const v of [...irr.up, ...irr.down, ...irr.horiz]) expect(v).toBeCloseTo(Math.PI, 1);
  });
  it("반구광: 하늘 = 위 × 세기, 아래 = (2·수평 − 위) × 세기(음수면 0)", () => {
    const h = hemisphere({ up: [2, 2, 2], down: [0, 0, 0], horiz: [1.5, 0.5, 1] }, 0.5);
    expect(h).toEqual({ sky: [1, 1, 1], ground: [0.5, 0, 0] });
  });
});
