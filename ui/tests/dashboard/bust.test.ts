// @vitest-environment node
// 대시보드 마스코트 그림 자리(순수 함수): 브랜드 마스코트 전신 그림(1254×1254)을 마스코트 단추 안에 놓는 배율과 자리,
// 단추에 담는 그림 열, 머리 꼭대기, 오른쪽을 보는 주둥이 끝, 화면 밑 선에 걸리는 줄, 가슴 LG 표시 원.
// 그림은 행동하는 동안만 좌우로 뒤집고(Mascot.tsx), 그때 LG 표시 원만 다시 뒤집어 바로 읽히게 한다.
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { mascotImageBox, mascotLogoBox, mascotScale } from "../../src/dashboard/bust";
import { MASCOT } from "../../src/dashboard/mascot-image";
import { readPng } from "../helpers/png";

/** 브랜드 mascot.png에서 잰 자리(그림 픽셀, 알파 128 넘는 픽셀): 머리 꼭대기 줄과 그 줄의 왼쪽·오른쪽 끝, 발끝, 귀 뒤, 주둥이 끝, 손 아래, 무릎 아래. */
const HEAD_TOP = { y: 64, x0: 652, x1: 696 };
const FEET = 1192;
const EAR_BACK = 477;
const SNOUT_TIP = 886;
const HANDS_BOTTOM = 770;
const KNEES_BOTTOM = 1010;
const M = MASCOT;

describe("마스코트 그림", () => {
  it("브랜드 전신 그림(ui/public/brand/mascot.png, 1254×1254)을 쓴다", () => {
    expect(M.src).toMatch(/\/brand\/mascot\.png$/);
    expect([M.width, M.height]).toEqual([1254, 1254]);
  });

  it("단추에 담는 그림 열은 귀 뒤와 주둥이 끝을 다 담는다: 머리 뒤와 귀가 잘리지 않는다", () => {
    expect(M.x0).toBeGreaterThanOrEqual(0);
    expect(M.x1).toBeLessThanOrEqual(M.width);
    expect(M.x0).toBeLessThan(EAR_BACK);
    expect(M.x1).toBeGreaterThan(SNOUT_TIP);
    expect(M.earBack).toBe(EAR_BACK);
  });

  it("주둥이 끝은 그림에서 가장 오른쪽 점이다: 그림은 오른쪽(영상 쪽)을 본다", () => {
    expect(M.snout).toEqual([SNOUT_TIP, 196]);
    expect(M.snout[0]).toBeGreaterThan(M.headTop[0]);
    expect(M.x1 - M.snout[0]).toBeLessThan(20);
  });

  it("머리 꼭대기는 그림 맨 위 줄 가운데다", () => {
    expect(M.headTop[1]).toBe(HEAD_TOP.y);
    expect(M.headTop[0]).toBeGreaterThan(HEAD_TOP.x0);
    expect(M.headTop[0]).toBeLessThan(HEAD_TOP.x1);
  });

  it("화면 밑 선에 걸리는 줄(cut)은 손 아래, 무릎 아래보다 위다: 머리·가슴 LG 표시·손이 보이고 발은 밑 선 아래에 있다", () => {
    expect(M.cut).toBeGreaterThan(HANDS_BOTTOM + 100);
    expect(M.cut).toBeLessThan(KNEES_BOTTOM);
    expect(M.cut).toBeLessThan(FEET);
  });
});

describe("마스코트 그림 배율과 자리", () => {
  it("배율은 보이는 높이(단추 높이)에서 머리 위 빈자리를 뺀 만큼이 머리 꼭대기에서 cut 줄까지와 같게 한다", () => {
    const m = { headTop: [674, 64] as [number, number], cut: 964 };
    expect(mascotScale(m, 910, 10)).toBeCloseTo(1, 10);
    expect(mascotScale(m, 460, 10)).toBeCloseTo(0.5, 10);
    expect(mascotScale(m, 5, 10)).toBe(0);
  });

  it("그림은 배율만큼 키우고 x0 열을 단추 왼쪽에, 머리 꼭대기를 단추 위에서 headRoom 아래에 둔다", () => {
    const b = mascotImageBox({ width: 1000, height: 800, x0: 200, headTop: [500, 50] }, 0.5, 10);
    expect(b).toEqual({ left: -100, top: 10 - 25, width: 500, height: 400 });
  });

  it("그림 자리는 옮기고 키우기만 한다: 너비·높이가 양수이고 그림 비율 그대로다(뒤집기는 Mascot.tsx의 transform)", () => {
    const b = mascotImageBox(M, 1.1, 10);
    expect(b.width).toBeGreaterThan(0);
    expect(b.height).toBeGreaterThan(0);
    expect(b.width / b.height).toBeCloseTo(M.width / M.height, 10);
    expect(Object.keys(b).sort()).toEqual(["height", "left", "top", "width"]);
  });
});

describe("가슴 LG 표시", () => {
  const png = readPng(fileURLToPath(new URL("../../public/brand/mascot.png", import.meta.url)));
  const [cx, cy] = M.logo.center;
  const red = ([r, g, b, a]: number[]) => a! > 128 && r! > 120 && g! < 80 && b! < 90;
  const ring = (radius: number) => Array.from({ length: 72 }, (_, k) => png.at(cx + radius * Math.cos((k * Math.PI) / 36), cy + radius * Math.sin((k * Math.PI) / 36)));

  it("LG 표시(빨간 원)는 logo 원 안에 다 든다", () => {
    let n = 0;
    for (let y = 440; y < 580; y++) {
      for (let x = 640; x < 820; x++) {
        if (y < 455 || !red(png.at(x, y))) continue;
        n++;
        expect(Math.hypot(x - cx, y - cy), `${x},${y}`).toBeLessThan(M.logo.r - 1);
      }
    }
    expect(n).toBeGreaterThan(1500);
  });

  it("logo 원 둘레는 고른 가슴 크림색이다: 원만 다시 뒤집어 얹어도 이음매가 보이지 않는다", () => {
    for (const radius of [M.logo.r, M.logo.r + 1]) {
      for (const [r, g, b, a] of ring(radius)) {
        expect(a).toBeGreaterThan(250);
        expect(r).toBeGreaterThan(235);
        expect(g).toBeGreaterThan(200);
        expect(b).toBeGreaterThan(185);
      }
    }
  });

  it("LG 표시 원 자리(단추 기준 px)는 그림 자리에서 배율만큼 옮긴 원을 담는 네모다", () => {
    const image = mascotImageBox(M, 0.5, 10);
    const box = mascotLogoBox(M, 0.5, image);
    expect(box.width).toBeCloseTo(2 * M.logo.r * 0.5, 10);
    expect(box.height).toBeCloseTo(box.width, 10);
    expect(box.left + box.width / 2).toBeCloseTo(image.left + cx * 0.5, 10);
    expect(box.top + box.height / 2).toBeCloseTo(image.top + cy * 0.5, 10);
  });
});
