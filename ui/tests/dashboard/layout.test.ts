// @vitest-environment node
// 대시보드 화면 배치(순수 함수): 왼쪽에 트윈(남은 너비, 화면 높이 꽉), 오른쪽에 영상(대시보드 폰 칸: 세로 9:16, 화면 높이 꽉, 안쪽 위에 떠 있는 FSM 상태·행동 카드).
// 트윈과 영상은 틈 없이 맞닿고 그 사이에 1px 나눔선 하나만 있다. 마스코트(판 없이, 아래 끝이 화면 밑 선)는 가운데 축이 나눔선 위다. 트윈 아래쪽에 말풍선 카드.
// 트윈 지도는 트윈 칸을 꽉 채우고, 말풍선·마스코트는 지도 위에 얹는다. 지도 카메라는 그 단계에 중요한 것을 진행도 아래·말풍선 위·마스코트 왼쪽 칸(focus)에 맞춘다.
import { describe, expect, it } from "vitest";
import tokens from "../../../src/design/tokens.json";
import { mascotLogoBox } from "../../src/dashboard/bust";
import { DIVIDER, LIFT, MASCOT_SHARE, mascotPoint, pageLayout, RING, SAY_LINE, type Rect } from "../../src/dashboard/layout";
import { MASCOT } from "../../src/dashboard/mascot-image";

const M = MASCOT;
/** 브랜드 mascot.png에서 잰 자리(그림 픽셀): 머리 꼭대기 줄, 귀 뒤 [x, y], 주둥이 끝 [x, y]. */
const HEAD_TOP = 64;
const EAR_BACK: [number, number] = [477, 214];
const SNOUT: [number, number] = [886, 196];
const right = (r: Rect) => r.left + r.width;
const bottom = (r: Rect) => r.top + r.height;
const hit = (a: Rect, b: Rect) => a.left < right(b) && b.left < right(a) && a.top < bottom(b) && b.top < bottom(a);
const near = (a: number, b: number, d = 1e-6) => Math.abs(a - b) < d;

describe.each([[1920, 1080], [1440, 900], [1522, 722]])("%i×%i", (width, height) => {
  const L = pageLayout({ width, height }, M);
  const wide = width >= 1680;
  const space = wide ? tokens.layout.hub1920 : tokens.layout.hub1440;
  const head = mascotPoint(L, M, [M.headTop[0], HEAD_TOP]);
  const ear = mascotPoint(L, M, EAR_BACK);
  const snout = mascotPoint(L, M, SNOUT);

  it("여백·사이는 디자인 토큰 layout 값이다", () => {
    expect([L.pad, L.gap]).toEqual([space.gutter, space.gap]);
  });

  it("트윈은 왼쪽, 영상은 오른쪽이고 둘 다 화면 높이를 다 쓴다(여백 안). 트윈이 남은 너비를 다 쓴다", () => {
    expect([L.twin.left, L.twin.top]).toEqual([L.pad, L.pad]);
    expect(near(bottom(L.twin), height - L.pad)).toBe(true);
    expect(L.video.top).toBe(L.pad);
    expect(near(bottom(L.video), height - L.pad)).toBe(true);
    expect(near(right(L.video), width - L.pad)).toBe(true);
    expect(L.twin.width).toBeGreaterThanOrEqual(1.5 * L.video.width);
  });

  it("트윈과 영상은 틈 없이 맞닿는다: 사이에는 화면 높이의 1px 나눔선 하나만 있다", () => {
    expect(DIVIDER).toBe(1);
    expect(L.divider.width).toBe(DIVIDER);
    expect(near(right(L.twin), L.divider.left)).toBe(true);
    expect(near(right(L.divider), L.video.left)).toBe(true);
    expect([L.divider.top, L.divider.height]).toEqual([L.twin.top, L.twin.height]);
  });

  it("영상 칸은 세로 9:16이다", () => {
    expect(near(L.video.width / L.video.height, 9 / 16)).toBe(true);
  });

  it("FSM 상태·행동 카드는 영상 안 위쪽에 떠 있다: 영상 끝에서 사이(gap)만큼 띄우고, 높이는 Item 원래 글(text-sm, 줄 20px) 한 줄 Item 두 개(위아래 여백 12, 아이콘 28)와 사이 선이다", () => {
    expect(L.card.left).toBe(L.video.left + L.gap);
    expect(L.card.top).toBe(L.video.top + L.gap);
    expect(near(right(L.card), right(L.video) - L.gap)).toBe(true);
    expect(L.card.height).toBe(2 * (12 + Math.max(20, 28)) + 1);
    expect(bottom(L.card)).toBeLessThan(bottom(L.video));
  });

  it("마스코트 단추 아래 끝이 화면 밑 선이고, 그림은 그 아래로 이어져 밑 선에서 올라온 모습이다(빈틈 없음)", () => {
    expect(near(bottom(L.mascot), height)).toBe(true);
    expect(L.image.top + L.image.height).toBeGreaterThan(L.mascot.height);
    expect(near((L.mascot.height - L.image.top) / L.scale, M.cut)).toBe(true);
    expect(near(L.image.width / M.width, L.image.height / M.height)).toBe(true);
    expect(near(L.image.width, M.width * L.scale)).toBe(true);
  });

  it("마스코트는 작다: 보이는 높이가 화면 높이의 0.3이다", () => {
    expect(MASCOT_SHARE).toBe(0.3);
    expect(near(L.mascot.height, height * MASCOT_SHARE)).toBe(true);
  });

  it("마스코트는 가운데 축이 나눔선 위다: 단추 가운데가 나눔선 가운데이고 트윈과 영상에 반씩 겹친다", () => {
    const axis = L.divider.left + L.divider.width / 2;
    expect(near(L.mascot.left + L.mascot.width / 2, axis)).toBe(true);
    expect(L.mascot.left).toBeLessThan(right(L.twin));
    expect(right(L.mascot)).toBeGreaterThan(L.video.left);
  });

  it("머리 꼭대기·귀 뒤·주둥이 끝이 단추 안이고, 그림의 주둥이는 축 오른쪽(영상 쪽)이다. 마우스를 올려 그림이 8px 올라와도 머리가 단추 안이다", () => {
    const axis = L.divider.left + L.divider.width / 2;
    expect(LIFT).toBe(8);
    expect(head.y - LIFT).toBeGreaterThan(L.mascot.top);
    expect(ear.x).toBeGreaterThan(L.mascot.left);
    expect(snout.x).toBeLessThan(right(L.mascot));
    expect(snout.x).toBeGreaterThan(head.x);
    expect(snout.x).toBeGreaterThan(axis);
    expect(ear.x).toBeLessThan(axis);
  });

  it("행동하는 동안 단추 가운데 축(나눔선)을 중심으로 좌우를 뒤집으면 주둥이는 축 왼쪽(트윈 쪽)이고, 머리·귀·주둥이·LG 표시 원은 단추 안에 그대로 있다", () => {
    const axis = L.divider.left + L.divider.width / 2;
    const flip = (x: number) => 2 * axis - x;
    expect(flip(snout.x)).toBeLessThan(axis);
    expect(flip(ear.x)).toBeGreaterThan(axis);
    for (const x of [head.x, ear.x, snout.x].map(flip)) {
      expect(x).toBeGreaterThan(L.mascot.left);
      expect(x).toBeLessThan(right(L.mascot));
    }
    const logo = { left: L.mascot.left + L.logo.left, width: L.logo.width };
    expect(L.logo).toEqual(mascotLogoBox(M, L.scale, L.image));
    for (const x of [logo.left, logo.left + logo.width]) {
      expect(flip(x)).toBeGreaterThan(L.mascot.left);
      expect(flip(x)).toBeLessThan(right(L.mascot));
    }
    expect(L.logo.top).toBeGreaterThan(0);
    expect(L.logo.top + L.logo.height).toBeLessThan(L.mascot.height);
  });

  it("FSM 카드는 마스코트와 겹치지 않는다(카드 글이 마스코트에 가리지 않는다)", () => {
    expect(hit(L.card, L.mascot)).toBe(false);
    expect(bottom(L.card)).toBeLessThan(L.mascot.top);
  });

  it("말풍선은 트윈 아래쪽 안, 마스코트 왼쪽 카드 하나다: 높이는 말풍선 글(Item say text-base 16px, 줄 24px) 두 줄 + 위아래 여백(py-3)·테두리 26px로 정해져 있고 초점 고리와도 겹치지 않는다. 꼬리는 없다", () => {
    expect(RING).toBe(4);
    expect(SAY_LINE).toBe(24);
    expect(L.bubble.left).toBe(L.twin.left + space.panelPadding);
    expect(near(bottom(L.bubble), bottom(L.twin) - space.panelPadding)).toBe(true);
    expect(L.bubble.height).toBe(2 * 24 + 26);
    expect(near(right(L.bubble), L.mascot.left - RING)).toBe(true);
    expect(L.bubble.width).toBeGreaterThan(L.twin.width / 2);
    expect(hit(L.bubble, L.video)).toBe(false);
    expect(head.y).toBeLessThan(L.bubble.top);
    expect("tail" in L).toBe(false);
  });

  it("트윈 지도는 트윈 칸을 꽉 채운다: 지도 자리는 트윈 칸 그대로다", () => {
    expect("map" in L).toBe(false);
  });

  it("지도 위에 얹는 것(말풍선 카드, 마스코트·초점 고리)은 가린 자리(blocked)다", () => {
    expect(L.blocked).toHaveLength(2);
    const [say, mascot] = L.blocked as [Rect, Rect];
    expect(say).toEqual(L.bubble);
    expect(near(mascot.left, L.mascot.left - RING)).toBe(true);
    expect(near(mascot.top, L.mascot.top - RING)).toBe(true);
    expect(right(mascot)).toBeGreaterThanOrEqual(right(L.twin));
  });

  it("지도 카메라가 맞추는 칸(focus)은 트윈 안, 할 일 진행도 아래, 가린 자리(말풍선·마스코트) 밖이고, 카메라 여백(camPad)은 그 칸의 트윈 기준 여백이다", () => {
    const f = L.focus;
    expect(f.left).toBeGreaterThanOrEqual(L.twin.left);
    expect(f.top).toBeGreaterThanOrEqual(L.twin.top + 60);
    expect(right(f)).toBeLessThanOrEqual(right(L.twin));
    for (const b of L.blocked) expect(hit(f, b)).toBe(false);
    expect(f.width).toBeGreaterThan(L.twin.width * 0.6);
    expect(f.height).toBeGreaterThan(L.twin.height * 0.6);
    expect(L.camPad).toEqual({ left: f.left - L.twin.left, top: f.top - L.twin.top, right: right(L.twin) - right(f), bottom: bottom(L.twin) - bottom(f) });
  });

  it("모든 자리가 화면 안이다(가로·세로 넘침 없음)", () => {
    for (const r of [L.twin, L.divider, L.focus, L.video, L.card, L.mascot, L.bubble]) {
      expect(r.left).toBeGreaterThanOrEqual(0);
      expect(r.top).toBeGreaterThanOrEqual(0);
      expect(right(r)).toBeLessThanOrEqual(width + 1e-6);
      expect(bottom(r)).toBeLessThanOrEqual(height + 1e-6);
    }
  });
});

describe("1920×1080 크기(사용자가 고른 구조 그림 v6)", () => {
  const L = pageLayout({ width: 1920, height: 1080 }, M);

  it("트윈 약 1298×1048, 영상 약 590×1048, FSM 카드 약 558×81", () => {
    expect(near(L.twin.width, 1297.5, 1)).toBe(true);
    expect(L.twin.height).toBe(1048);
    expect(near(L.video.width, 590, 1)).toBe(true);
    expect(L.video.height).toBe(1048);
    expect(near(L.card.width, 558, 1)).toBe(true);
    expect(L.card.height).toBe(81);
  });

  it("마스코트는 약 320 높이, 말풍선 카드는 약 1197×74", () => {
    expect(near(L.mascot.height, 320, 10)).toBe(true);
    expect(near(L.bubble.width, 1197, 2)).toBe(true);
    expect(L.bubble.height).toBe(74);
  });
});

describe("크기를 모를 때", () => {
  it("크기를 모르면(0) 모두 0 크기다", () => {
    const L = pageLayout({ width: 0, height: 0 }, M);
    for (const r of [L.twin, L.divider, L.focus, L.video, L.card, L.mascot, L.bubble]) expect(Math.max(0, r.width) * Math.max(0, r.height)).toBe(0);
  });
});
