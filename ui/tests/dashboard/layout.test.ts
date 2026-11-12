// @vitest-environment node
// 대시보드 화면 배치(순수 함수): 트윈이 화면 전체(여백 안)를 쓴다. 그 위에 얹는 것: 오른쪽 위 비전 미니맵(가로 16:9, 1280 너비에서 400×225, 화면 너비에 비례),
// 오른쪽 아래 마스코트(판 없이, 아래 끝이 화면 밑 선), 마스코트 위 생각 말풍선(크기 고정)과 꼬리 점 둘, 트윈 아래쪽 말풍선 카드(마스코트 왼쪽까지).
// 트윈 지도는 트윈 칸을 꽉 채운다. 지도 카메라는 그 단계에 중요한 것을 진행도 아래·말풍선 카드 위·미니맵과 생각 말풍선 왼쪽 칸(focus)에 맞춘다.
import { describe, expect, it } from "vitest";
import tokens from "../../../src/design/tokens.json";
import { mascotLogoBox } from "../../src/dashboard/bust";
import { LIFT, MASCOT_SHARE, mascotPoint, MINIMAP_SHARE, pageLayout, RING, SAY_LINE, THOUGHT, type Rect } from "../../src/dashboard/layout";
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

  it("트윈은 화면 전체를 쓴다(여백 안). 오른쪽 칸·나눔선·FSM 카드가 없다", () => {
    expect(L.twin).toEqual({ left: L.pad, top: L.pad, width: width - 2 * L.pad, height: height - 2 * L.pad });
    for (const k of ["divider", "card"]) expect(k in L, k).toBe(false);
  });

  it("비전 미니맵은 트윈 오른쪽 위 가로 16:9 칸이다: 너비는 화면 너비의 400/1280이고 트윈 끝에서 안쪽 여백만큼 띄운다", () => {
    expect(MINIMAP_SHARE).toBe(400 / 1280);
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

  it("생각 말풍선은 마스코트 위다: 크기는 화면과 상관없이 정해져 있고(360 × 글 두 줄·칩 한 줄), 오른쪽 끝은 마스코트와 같으며 미니맵·마스코트·말풍선 카드와 겹치지 않는다", () => {
    expect(THOUGHT).toEqual({ width: 360, height: 104 });
    expect([L.thought.width, L.thought.height]).toEqual([THOUGHT.width, THOUGHT.height]);
    expect(near(right(L.thought), right(L.mascot))).toBe(true);
    expect(bottom(L.thought)).toBeLessThan(L.mascot.top);
    expect(L.thought.top).toBeGreaterThan(bottom(L.video));
    for (const r of [L.video, L.mascot, L.bubble]) expect(hit(L.thought, r)).toBe(false);
  });

  it("생각 말풍선 꼬리는 점 둘이다: 말풍선과 마스코트 사이에 있고 마스코트 쪽 점이 더 작다", () => {
    expect(L.tail).toHaveLength(2);
    const [big, small] = L.tail as [Rect, Rect];
    expect([big.width, big.height, small.width, small.height]).toEqual([16, 16, 10, 10]);
    for (const d of L.tail) {
      expect(d.top).toBeGreaterThanOrEqual(bottom(L.thought));
      expect(bottom(d)).toBeLessThanOrEqual(L.mascot.top);
      expect(d.left).toBeGreaterThanOrEqual(L.mascot.left);
      expect(right(d)).toBeLessThanOrEqual(right(L.mascot));
    }
    expect(small.top).toBeGreaterThan(big.top);
  });

  it("말풍선 카드는 트윈 아래쪽 안, 마스코트 왼쪽에서 사이(gap)만큼 띄운 카드 하나다: 높이는 말풍선 글(Item say text-base 16px, 줄 24px) 두 줄 + 위아래 여백(py-3)·테두리 26px로 정해져 있고 초점 고리와도 겹치지 않는다", () => {
    expect(RING).toBe(4);
    expect(SAY_LINE).toBe(24);
    expect(L.bubble.left).toBe(L.twin.left + space.panelPadding);
    expect(near(bottom(L.bubble), bottom(L.twin) - space.panelPadding)).toBe(true);
    expect(L.bubble.height).toBe(2 * 24 + 26);
    expect(near(right(L.bubble), L.mascot.left - RING - L.gap)).toBe(true);
    expect(L.bubble.width).toBeGreaterThan(L.twin.width / 2);
    for (const r of [L.video, L.mascot, L.thought]) expect(hit(L.bubble, r)).toBe(false);
    expect(head.y).toBeLessThan(L.bubble.top);
  });

  it("트윈 지도는 트윈 칸을 꽉 채운다: 지도 자리는 트윈 칸 그대로다", () => {
    expect("map" in L).toBe(false);
  });

  it("지도 위에 얹는 것(말풍선 카드, 마스코트·초점 고리, 미니맵, 생각 말풍선과 꼬리)은 가린 자리(blocked)다", () => {
    expect(L.blocked).toHaveLength(4);
    const [say, mascot, video, thought] = L.blocked as [Rect, Rect, Rect, Rect];
    expect(say).toEqual(L.bubble);
    expect(near(mascot.left, L.mascot.left - RING)).toBe(true);
    expect(near(mascot.top, L.mascot.top - RING)).toBe(true);
    expect(video).toEqual(L.video);
    expect([thought.left, thought.top, thought.width]).toEqual([L.thought.left, L.thought.top, L.thought.width]);
    expect(near(bottom(thought), L.mascot.top)).toBe(true);
  });

  it("지도 카메라가 맞추는 칸(focus)은 트윈 안, 할 일 진행도 아래, 가린 자리(말풍선 카드·마스코트·미니맵·생각 말풍선) 밖이고, 카메라 여백(camPad)은 그 칸의 트윈 기준 여백이다", () => {
    const f = L.focus;
    expect(f.left).toBeGreaterThanOrEqual(L.twin.left);
    expect(f.top).toBeGreaterThanOrEqual(L.twin.top + 60);
    expect(right(f)).toBeLessThanOrEqual(right(L.twin));
    for (const b of L.blocked) expect(hit(f, b)).toBe(false);
    expect(right(f)).toBeLessThan(Math.min(L.video.left, L.thought.left, L.mascot.left));
    expect(f.width).toBeGreaterThan(L.twin.width * 0.55);
    expect(f.height).toBeGreaterThan(L.twin.height * 0.6);
    expect(L.camPad).toEqual({ left: f.left - L.twin.left, top: f.top - L.twin.top, right: right(L.twin) - right(f), bottom: bottom(L.twin) - bottom(f) });
  });

  it("모든 자리가 화면 안이다(가로·세로 넘침 없음)", () => {
    for (const r of [L.twin, L.focus, L.video, L.mascot, L.bubble, L.thought, ...L.tail]) {
      expect(r.left).toBeGreaterThanOrEqual(0);
      expect(r.top).toBeGreaterThanOrEqual(0);
      expect(right(r)).toBeLessThanOrEqual(width + 1e-6);
      expect(bottom(r)).toBeLessThanOrEqual(height + 1e-6);
    }
  });
});

describe("크기(스케치 6안)", () => {
  it("1280×720: 미니맵 400×225", () => {
    const L = pageLayout({ width: 1280, height: 720 }, M);
    expect([L.video.width, L.video.height]).toEqual([400, 225]);
  });

  it("1920×1080: 트윈 1888×1048, 미니맵 600×337.5, 마스코트 약 320 높이, 말풍선 카드 높이 74", () => {
    const L = pageLayout({ width: 1920, height: 1080 }, M);
    expect([L.twin.width, L.twin.height]).toEqual([1888, 1048]);
    expect([L.video.width, L.video.height]).toEqual([600, 337.5]);
    expect(near(L.mascot.height, 320, 10)).toBe(true);
    expect(L.bubble.height).toBe(74);
  });
});

describe("크기를 모를 때", () => {
  it("크기를 모르면(0) 모두 0 크기다", () => {
    const L = pageLayout({ width: 0, height: 0 }, M);
    for (const r of [L.twin, L.focus, L.video, L.mascot, L.bubble, L.thought, ...L.tail]) expect(Math.max(0, r.width) * Math.max(0, r.height)).toBe(0);
  });
});
