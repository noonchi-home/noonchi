// @vitest-environment node
// 대시보드 화면 배치(순수 함수): 트윈이 화면 전체(여백 안)를 쓴다. 그 위에 얹는 것: 오른쪽 위 비전 미니맵(가로 16:9, 1280 너비에서 320×180, 화면 너비에 비례),
// 오른쪽 아래 마스코트(판 없이, 아래 끝이 화면 밑 선), 마스코트 위 생각 말풍선(크기 고정)과 꼬리 점 둘, 트윈 아래쪽 말풍선 카드(마스코트 왼쪽까지).
// 트윈 지도는 트윈 칸을 꽉 채운다. 지도 카메라는 그 단계에 중요한 것을 칩 줄 아래·메시지 상자 위·미니맵과 마스코트 왼쪽 칸(focus)에 맞춘다.
import { describe, expect, it } from "vitest";
import tokens from "../../../src/design/tokens.json";
import { mascotLogoBox } from "../../src/dashboard/bust";
import { ASPECT_STEP, FSM_TOP_SHARE, LIFT, MASCOT_SHARE, mascotPoint, MINIMAP_ASPECT, MINIMAP_MAX_SHARE, MINIMAP_SHARE, nextAspect, pageLayout, RING, TALK_H, TALK_MIN_W, TALK_SHARE, type Rect } from "../../src/dashboard/layout";
import { MASCOT } from "../../src/lib/mascot-image";

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

  it("트윈은 화면 전체를 쓴다(여백 안). 오른쪽 칸·나눔선·FSM 카드가 없다", () => {
    expect(L.twin).toEqual({ left: L.pad, top: L.pad, width: width - 2 * L.pad, height: height - 2 * L.pad });
    for (const k of ["divider", "card"]) expect(k in L, k).toBe(false);
  });

  it("비전 미니맵은 트윈 오른쪽 위 가로 16:9 칸이다: 너비는 화면 너비의 320/1280이고 트윈 끝에서 안쪽 여백만큼 띄운다", () => {
    expect(MINIMAP_SHARE).toBe(320 / 1280);
    expect(near(L.video.width, width * MINIMAP_SHARE)).toBe(true);
    expect(near(L.video.width / L.video.height, 16 / 9)).toBe(true);
    expect(near(right(L.video), right(L.twin) - space.panelPadding)).toBe(true);
    expect(near(L.video.top, L.twin.top + space.panelPadding)).toBe(true);
  });

  it("트윈 오른쪽 위 칩은 미니맵 왼쪽에 둔다(미니맵에 가리지 않는다)", () => {
    expect(near(L.chipsRight, right(L.twin) - L.video.left + L.gap)).toBe(true);
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

  it("마스코트는 트윈 오른쪽 아래다: 단추 오른쪽 끝을 트윈 끝에서 안쪽 여백만큼 띄운다", () => {
    expect(near(right(L.mascot), right(L.twin) - space.panelPadding)).toBe(true);
    expect(L.mascot.left).toBeGreaterThan(L.twin.left + L.twin.width / 2);
  });

  it("머리 꼭대기·귀 뒤·주둥이 끝이 단추 안이다. 마우스를 올려 그림이 8px 올라와도 머리가 단추 안이다", () => {
    expect(LIFT).toBe(8);
    expect(head.y - LIFT).toBeGreaterThan(L.mascot.top);
    expect(ear.x).toBeGreaterThan(L.mascot.left);
    expect(snout.x).toBeLessThan(right(L.mascot));
    expect(snout.x).toBeGreaterThan(head.x);
  });

  it("행동하는 동안 단추 가운데 축을 중심으로 좌우를 뒤집어도 머리·귀·주둥이·LG 표시 원은 단추 안에 그대로 있다", () => {
    const axis = L.mascot.left + L.mascot.width / 2;
    const flip = (x: number) => 2 * axis - x;
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

  // 사용자 결정(2026-11-18): 「메시지박스를 절반으로 줄이고 마스코트 쪽으로 붙이자 / 남은 왼쪽 자리에 FSM 표시」, 「FSM은 훨씬 더 크게」
  it("메시지 상자는 트윈 아래쪽 안, 마스코트 바로 왼쪽에서 사이(gap)만큼 띄운 상자 하나다(마스코트가 옆에서 말한다): 너비는 트윈 안 남은 너비의 절반(TALK_SHARE, 좁은 화면은 TALK_MIN_W까지), 높이는 TALK_H(140)이고 초점 고리와도 겹치지 않는다", () => {
    expect(RING).toBe(4);
    // 문장 줄 16px(사용자 허락 2026-11-18 「메시지박스 글씨 키워」): 위아래 여백 24 + 테두리 2 + 목표 줄 24 + 사이 4 + 세 줄(24씩)과 사이 둘(4씩) 80 + 여유 6
    expect(TALK_H).toBe(140);
    expect(TALK_SHARE).toBe(0.5);
    const full = L.mascot.left - RING - L.gap - (L.twin.left + space.panelPadding);
    expect(near(L.bubble.width, Math.max(full * TALK_SHARE, TALK_MIN_W), 1)).toBe(true);
    expect(near(bottom(L.bubble), bottom(L.twin) - space.panelPadding)).toBe(true);
    expect(L.bubble.height).toBe(TALK_H);
    expect(near(right(L.bubble), L.mascot.left - RING - L.gap)).toBe(true);
    expect(("thought" in L) || ("tail" in L)).toBe(false);
    for (const r of [L.video, L.mascot]) expect(hit(L.bubble, r)).toBe(false);
    expect(head.y).toBeLessThan(L.bubble.top);
  });

  it("트윈 지도는 트윈 칸을 꽉 채운다: 지도 자리는 트윈 칸 그대로다", () => {
    expect("map" in L).toBe(false);
  });

  it("FSM 카드는 메시지 상자 왼쪽 남은 자리 전체를 쓰는 큰 카드다: 왼쪽은 트윈 안쪽 여백, 오른쪽은 상자에서 사이(gap)만큼, 바닥 줄은 상자와 같고 위는 화면 높이의 FSM_TOP_SHARE(아래에서 1/3)까지", () => {
    expect(FSM_TOP_SHARE).toBeCloseTo(2 / 3, 5);
    expect(L.fsm.left).toBe(L.twin.left + space.panelPadding);
    expect(near(right(L.fsm), L.bubble.left - L.gap)).toBe(true);
    expect(near(bottom(L.fsm), bottom(L.bubble))).toBe(true);
    expect(near(L.fsm.top, height * FSM_TOP_SHARE, 1)).toBe(true);
    expect(L.fsm.height).toBeGreaterThan(TALK_H);
    expect(L.fsm.width).toBeGreaterThan(L.bubble.width * 0.8);
    for (const r of [L.video, L.mascot, L.bubble]) expect(hit(L.fsm, r)).toBe(false);
  });

  it("지도 위에 얹는 것(메시지 상자, 마스코트·초점 고리, 미니맵, FSM 카드)은 가린 자리(blocked)다. 생각 말풍선은 없다(트윈을 가리지 않는다)", () => {
    expect(L.blocked).toHaveLength(4);
    const [say, mascot, video, fsm] = L.blocked as [Rect, Rect, Rect, Rect];
    expect(fsm).toEqual(L.fsm);
    expect(say).toEqual(L.bubble);
    expect(near(mascot.left, L.mascot.left - RING)).toBe(true);
    expect(near(mascot.top, L.mascot.top - RING)).toBe(true);
    expect(video).toEqual(L.video);
  });

  it("지도 카메라가 맞추는 칸(focus)은 트윈 안, 칩 줄 아래, 가린 자리(메시지 상자·마스코트·미니맵) 밖이고, 카메라 여백(camPad)은 그 칸의 트윈 기준 여백이다", () => {
    const f = L.focus;
    expect(f.left).toBeGreaterThanOrEqual(L.twin.left);
    // 칩 줄(top-4 16 + 칩 28) 아래. 할 일 진행도 알약은 없다(계획은 트윈 위 번호 길)
    expect(f.top).toBeGreaterThanOrEqual(L.twin.top + 44);
    expect(right(f)).toBeLessThanOrEqual(right(L.twin));
    for (const b of L.blocked) expect(hit(f, b)).toBe(false);
    expect(right(f)).toBeLessThan(Math.min(L.video.left, L.mascot.left));
    expect(f.width).toBeGreaterThan(L.twin.width * 0.55);
    // FSM 카드(아래에서 1/3)가 가린 자리 위가 카메라 칸이다
    expect(f.height).toBeGreaterThan(L.twin.height * 0.5);
    expect(bottom(f)).toBeLessThanOrEqual(L.fsm.top);
    expect(L.camPad).toEqual({ left: f.left - L.twin.left, top: f.top - L.twin.top, right: right(L.twin) - right(f), bottom: bottom(L.twin) - bottom(f) });
  });

  it("모든 자리가 화면 안이다(가로·세로 넘침 없음)", () => {
    for (const r of [L.twin, L.focus, L.video, L.mascot, L.bubble]) {
      expect(r.left).toBeGreaterThanOrEqual(0);
      expect(r.top).toBeGreaterThanOrEqual(0);
      expect(right(r)).toBeLessThanOrEqual(width + 1e-6);
      expect(bottom(r)).toBeLessThanOrEqual(height + 1e-6);
    }
  });
});

describe("미니맵 높이 상한(마스코트 위 사이)", () => {
  it.each([[1920, 1080], [1440, 900], [1522, 722]])("%i×%i: 16:9 미니맵은 마스코트 위 사이에 걸리지 않는다", (width, height) => {
    const L = pageLayout({ width, height }, M);
    expect(near(L.video.height, (width * 320) / 1280 * (9 / 16))).toBe(true);
    expect(bottom(L.video)).toBeLessThanOrEqual(L.mascot.top - LIFT - L.gap + 1e-6);
  });
});

describe.each([[1920, 1080], [1440, 900], [1522, 722]])("%i×%i 미니맵은 영상 비율을 따른다", (width, height) => {
  const at = (aspect?: number) => pageLayout({ width, height }, M, aspect);
  const base = at();

  it("영상이 없으면(비율 모름) 16:9다", () => {
    expect(MINIMAP_ASPECT).toBe(16 / 9);
    expect(at(MINIMAP_ASPECT)).toEqual(base);
  });

  it.each([[480, 222], [640, 360]])("가로 영상 %i×%i: 너비·왼쪽·위는 그대로이고 높이만 너비 ÷ 영상 비율이라 위아래 빈 띠가 없다", (w, h) => {
    const L = at(w / h);
    expect([L.video.left, L.video.top, L.video.width]).toEqual([base.video.left, base.video.top, base.video.width]);
    expect(near(L.video.height, L.video.width / (w / h))).toBe(true);
  });

  it("세로 영상(360×640)은 칸이 너무 길어지지 않게 높이 상한에 걸린다: 트윈 높이의 절반, 마스코트(올라온 머리) 위 사이(gap)까지 중 작은 쪽", () => {
    expect(MINIMAP_MAX_SHARE).toBe(0.5);
    const L = at(360 / 640);
    const cap = Math.min(L.twin.height * MINIMAP_MAX_SHARE, L.mascot.top - LIFT - L.gap - L.video.top);
    expect(near(L.video.height, cap)).toBe(true);
    expect(L.video.height).toBeLessThan(L.video.width / (360 / 640));
    expect(L.video.width).toBe(base.video.width);
  });

  it.each([480 / 222, 16 / 9, 4 / 3, 1, 360 / 640])("비율 %f: 미니맵 높이가 바뀌어도 마스코트·메시지 상자와 겹치지 않고, 지도 카메라 칸은 미니맵 밖이며, 다른 자리는 그대로다", (aspect) => {
    const L = at(aspect);
    for (const r of [L.mascot, L.bubble, L.focus]) expect(hit(L.video, r)).toBe(false);
    expect(bottom(L.video)).toBeLessThanOrEqual(L.mascot.top - LIFT - L.gap + 1e-6);
    expect(bottom(L.video)).toBeLessThanOrEqual(height);
    expect(L.blocked[2]).toEqual(L.video);
    const { video: _v, blocked: _b, ...rest } = L;
    const { video: _v0, blocked: _b0, ...rest0 } = base;
    expect(rest).toEqual(rest0);
  });
});

describe("영상 비율 고르기(떨림 방지)", () => {
  it("영상 크기를 모르면 16:9", () => {
    expect(nextAspect(480 / 222, null)).toBe(MINIMAP_ASPECT);
    expect(nextAspect(1, { width: 0, height: 0 })).toBe(MINIMAP_ASPECT);
  });

  it("비율 차이가 2% 안이면 지금 비율을 그대로 둔다(프레임마다 1px 흔들려도 칸이 떨리지 않는다). 넘으면 새 비율이다", () => {
    expect(ASPECT_STEP).toBe(0.02);
    const now = 480 / 222;
    expect(nextAspect(now, { width: 480, height: 223 })).toBe(now);
    expect(nextAspect(now, { width: 481, height: 222 })).toBe(now);
    expect(nextAspect(now, { width: 640, height: 360 })).toBe(640 / 360);
    expect(nextAspect(now, { width: 222, height: 480 })).toBe(222 / 480);
  });
});

describe("크기(스케치 6안)", () => {
  it("1280×720: 미니맵 320×180", () => {
    const L = pageLayout({ width: 1280, height: 720 }, M);
    expect([L.video.width, L.video.height]).toEqual([320, 180]);
  });

  it("1920×1080: 트윈 1888×1048, 미니맵 480×270, 마스코트 약 320 높이, 메시지 상자 높이 TALK_H(140: 목표 줄 + 16px 문장 세 줄)", () => {
    const L = pageLayout({ width: 1920, height: 1080 }, M);
    expect([L.twin.width, L.twin.height]).toEqual([1888, 1048]);
    expect([L.video.width, L.video.height]).toEqual([480, 270]);
    expect(near(L.mascot.height, 320, 10)).toBe(true);
    expect(L.bubble.height).toBe(TALK_H);
    expect(TALK_H).toBe(140);
    expect(near(L.fsm.top, 1080 * FSM_TOP_SHARE, 1)).toBe(true);
  });
});

describe("크기를 모를 때", () => {
  it("크기를 모르면(0) 모두 0 크기다", () => {
    const L = pageLayout({ width: 0, height: 0 }, M);
    for (const r of [L.twin, L.focus, L.video, L.mascot, L.bubble]) expect(Math.max(0, r.width) * Math.max(0, r.height)).toBe(0);
  });
});
