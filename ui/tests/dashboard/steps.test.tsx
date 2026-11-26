// 대시보드 단계가 바뀔 때 끊기지 않게: Vision 칸·트윈 칸은 다시 만들지 않고 크기·자리(레이아웃)도 바꾸지 않으며, 움직이는 것은
// transform·opacity만 움직인다. 실제 크롬에서 재는 것은 ui/scripts/measure-switch.mjs.
import { act, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DashboardScreen, type ScreenProps } from "../../src/dashboard/DashboardScreen";
import { EYE_FRAMES, imageSlot, PHONE_URL, screenAt, seenOf } from "./fixtures";

const STAGE = { width: 1504, height: 896 };
const ALLOWED = new Set(["transform", "opacity", "offset", "easing", "composite"]);

type Call = { el: Element; keyframes: Record<string, unknown>[] };
let calls: Call[] = [];
let restore: (() => void)[] = [];

/** 움직임 줄이기를 끈 화면(실제 허브 화면과 같다). jsdom 기본값(tests/setup.ts)은 줄이기 켬. */
const motionOn = () => {
  const media = window.matchMedia;
  window.matchMedia = ((q: string) => ({ ...media(q), matches: false })) as typeof window.matchMedia;
  restore.push(() => { window.matchMedia = media; });
};

beforeEach(() => {
  calls = [];
  restore = [];
  // 모든 상자가 같은 크기로 재진다(jsdom은 0을 준다)
  const rect = vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(
    { x: 0, y: 0, left: 0, top: 0, right: STAGE.width, bottom: STAGE.height, ...STAGE, toJSON: () => ({}) } as DOMRect,
  );
  // Element.animate 기록(jsdom에는 없다)
  const proto = Element.prototype as unknown as { animate?: unknown; getAnimations?: unknown };
  const had = { animate: proto.animate, getAnimations: proto.getAnimations };
  proto.animate = function (this: Element, kf: Keyframe[] | PropertyIndexedKeyframes) {
    const list = Array.isArray(kf) ? kf : [kf];
    calls.push({ el: this, keyframes: list as Record<string, unknown>[] });
    const anim = { finished: Promise.resolve(), cancel: () => {}, finish: () => {}, onfinish: null, oncancel: null, playState: "running" };
    return anim as unknown as Animation;
  };
  proto.getAnimations = () => [];
  restore.push(() => rect.mockRestore(), () => { proto.animate = had.animate; proto.getAnimations = had.getAnimations; });
});
afterEach(() => { for (const r of restore.reverse()) r(); });

const phoneOf = (c: HTMLElement) => c.querySelector<HTMLElement>('section[aria-label="폰 카메라"]')!;
const twinOf = (c: HTMLElement) => c.querySelector<HTMLElement>('section[aria-label="트윈"]')!;
/** 칸 크기·자리를 정하는 것: class(트윈 칸은 class flex-1로 너비를 정한다)와 inline style 전부. */
const box = (el: HTMLElement) => `${el.className} | ${el.style.cssText}`;

/** from 순간으로 띄운 뒤 to 순간으로 넘긴다. */
function step(from: ScreenProps, to: ScreenProps) {
  const view = render(<DashboardScreen {...from} />);
  const phone = phoneOf(view.container);
  const twin = twinOf(view.container);
  const was = {
    phone, twin, phoneImg: phone.querySelector("img"), canvas: twin.querySelector("canvas"),
    boxes: {
      phone: box(phone), twin: box(twin), stage: box(twin.parentElement!), map: box(twin.querySelector<HTMLElement>("[data-map]")!), canvas: box(twin.querySelector("canvas")!),
    },
  };
  calls = [];
  view.rerender(<DashboardScreen {...to} />);
  return { view, was };
}

describe("대시보드 단계 바뀜", () => {
  it("단계가 바뀌어도 대시보드 폰 칸·트윈 칸과 그 안 지도 캔버스·영상 그림을 다시 만들지 않는다", () => {
    const { view, was } = step(screenAt(2), screenAt(3, { phone: imageSlot("sink"), seen: seenOf(EYE_FRAMES[2]!.boxes) }));
    expect(phoneOf(view.container)).toBe(was.phone);
    expect(twinOf(view.container)).toBe(was.twin);
    expect(was.phone.querySelector("img")).toBe(was.phoneImg);
    expect(was.phone.querySelector("img")?.getAttribute("src")).toBe("/debug-eye/eye-sink.webp");
    expect(was.twin.querySelector("canvas")).toBe(was.canvas);
    expect(was.canvas).not.toBeNull();
  });

  it("폰 서버 영상(live)도 단계가 바뀌어도 같은 영상 그림이다", () => {
    const live = { kind: "live", url: PHONE_URL } as const;
    const { view, was } = step(screenAt(1, { phone: live }), screenAt(2, { phone: live }));
    expect(phoneOf(view.container).querySelector("img")).toBe(was.phoneImg);
    expect(was.phoneImg).not.toBeNull();
  });

  it("지켜보기에서 1단계로 넘어가도 칸과 그 안 그림을 다시 만들지 않고, 크기 style이 그대로이며 움직임에는 transform·opacity만 쓴다", () => {
    motionOn();
    const { view, was } = step(screenAt(0), screenAt(1));
    expect(view.container.querySelector("main")).toHaveAttribute("data-step", "1");
    expect(phoneOf(view.container)).toBe(was.phone);
    expect(twinOf(view.container)).toBe(was.twin);
    expect(was.twin.querySelector("canvas")).toBe(was.canvas);
    expect(box(was.phone)).toBe(was.boxes.phone);
    expect(box(was.twin)).toBe(was.boxes.twin);
    expect(box(was.twin.parentElement!)).toBe(was.boxes.stage);
    for (const c of calls) {
      for (const k of c.keyframes) for (const p of Object.keys(k)) expect(ALLOWED.has(p), p).toBe(true);
    }
  });

  it("두 판의 크기·자리는 그대로이고, 레이아웃 값을 움직이지 않는다", () => {
    const { view, was } = step(screenAt(2), screenAt(3));
    expect(box(was.phone)).toBe(was.boxes.phone);
    expect(box(was.twin)).toBe(was.boxes.twin);
    expect(box(was.twin.parentElement!)).toBe(was.boxes.stage);
    expect(box(was.twin.querySelector<HTMLElement>("[data-map]")!)).toBe(was.boxes.map);
    expect(box(was.canvas!)).toBe(was.boxes.canvas);
    for (const el of view.container.querySelectorAll<HTMLElement>("*")) {
      expect(el.style.transitionProperty, el.tagName).not.toMatch(/left|top|width|height|inset|all|border-radius/);
    }
  });

  // 2026-11-25 사용자 결정(배치 시안): Vision 칸은 16:9 고정. 세로 영상이 와도 칸 크기를 바꾸지 않고 영상을 칸 안에 맞춘다
  it("Vision 칸 크기는 단계·영상 비율과 상관없이 그대로다(가로 영상에서 단계가 바뀌어도, 세로 영상 720×1280이 와도)", () => {
    const { view, was } = step(screenAt(2, { phone: imageSlot("table-near") }), screenAt(3, { phone: imageSlot("sink") }));
    expect(box(phoneOf(view.container))).toBe(was.boxes.phone);
    view.rerender(<DashboardScreen {...screenAt(3, { phone: { kind: "image", src: "/t.webp", width: 720, height: 1280 } })} />);
    const now = phoneOf(view.container);
    expect(now).toBe(was.phone);
    expect(box(now)).toBe(was.boxes.phone);
    expect(box(was.twin)).toBe(was.boxes.twin);
    expect(box(was.twin.parentElement!)).toBe(was.boxes.stage);
  });

  it("폰 영상 그림은 늘 따로 합성한다(단계가 바뀌어 상자·카드 글이 바뀌어도 영상 그림을 다시 그리지 않는다)", () => {
    const view = render(<DashboardScreen {...screenAt(2)} />);
    const img = phoneOf(view.container).querySelector("img")!;
    expect(img.className).toMatch(/(^|\s)will-change-transform(\s|$)/);
  });

  it("가림판이 없다(미리 그려 보기는 화면이 뜰 때 한 번뿐이다: predraw.test.tsx)", () => {
    const view = render(<DashboardScreen {...screenAt(2)} />);
    expect(view.container.querySelector("[data-veil]")).toBeNull();
  });

  it("준비된 뒤 단계가 바뀌면 화면을 한 번만 다시 그리고 data-ready를 떼지 않는다(새 말의 글꼴 조각은 그리기를 막지 않고 받는다)", async () => {
    const loads: string[] = [];
    const fonts = {
      // 처음 받기만 끝나고, 그 뒤 받기는 끝나지 않는다(단계가 바뀐 그 그림 안에서는 조각이 아직 안 왔다)
      load: vi.fn((_font: string, text: string) => (loads.push(text) === 1 ? Promise.resolve([]) : new Promise<never>(() => {}))),
      ready: Promise.resolve(),
    };
    Object.defineProperty(document, "fonts", { value: fonts, configurable: true });
    restore.push(() => { delete (document as unknown as { fonts?: unknown }).fonts; });
    let draws = 0;
    const map = () => { draws++; return null; };
    const view = render(<DashboardScreen {...screenAt(1, { map })} />);
    const main = view.container.querySelector("main")!;
    await waitFor(() => expect(main).toHaveAttribute("data-ready"));
    draws = 0;
    view.rerender(<DashboardScreen {...screenAt(2, { map })} />);
    await act(async () => { await Promise.resolve(); });
    expect(main).toHaveAttribute("data-step", "2");
    expect(main).toHaveAttribute("data-ready");
    expect(draws).toBe(1);
    expect(loads.at(-1)).toContain(screenAt(2).step!.label);
  });

  it("움직임 줄이기를 켠 화면에서는 단계가 바뀌어도 움직이지 않는다", () => {
    step(screenAt(1), screenAt(2));
    expect(calls).toEqual([]);
  });
});
