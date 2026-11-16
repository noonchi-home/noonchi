// 대시보드 단계가 바뀔 때 끊기지 않게: 대시보드 폰 칸(미니맵)·트윈 칸·생각 말풍선 칸은 다시 만들지 않고 크기·자리(레이아웃)도 바꾸지 않으며, 움직이는 것(말풍선 말, 생각 말풍선)은
// transform·opacity만 움직인다. 실제 크롬에서 재는 것은 ui/scripts/measure-switch.mjs.
import { act, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DashboardScreen, type ScreenProps } from "../../src/dashboard/DashboardScreen";
import { EYE_FRAMES, imageSlot, LINES, PHONE_URL, REASON, SAY, screenAt, seenOf, THOUGHT, THOUGHT_LINES } from "./fixtures";

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
const thoughtOf = (c: HTMLElement) => c.querySelector<HTMLElement>("[data-thought]")!;
/** 칸 크기·자리를 정하는 것: class(트윈 칸은 class flex-1로 너비를 정한다)와 inline style 전부. */
const box = (el: HTMLElement) => `${el.className} | ${el.style.cssText}`;
/** 생각 말풍선 칸은 숨길 때 opacity·transform만 바뀐다: 그 둘을 뺀 class와 inline style. */
const still = (el: HTMLElement) => `${el.className} | ${el.style.cssText.replace(/(opacity|transform): [^;]+; ?/g, "")}`;

/** from 순간으로 띄운 뒤 to 순간으로 넘긴다. */
function step(from: ScreenProps, to: ScreenProps) {
  const view = render(<DashboardScreen {...from} />);
  const phone = phoneOf(view.container);
  const twin = twinOf(view.container);
  const thought = thoughtOf(view.container);
  const was = {
    phone, twin, thought, phoneImg: phone.querySelector("img"), canvas: twin.querySelector("canvas"),
    boxes: {
      phone: box(phone), twin: box(twin), stage: box(twin.parentElement!), map: box(twin.querySelector<HTMLElement>("[data-map]")!), canvas: box(twin.querySelector("canvas")!),
      thought: still(thought), bubble: box(thought.querySelector<HTMLElement>("[data-slot=thought-bubble]")!),
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
    expect(calls.length).toBeGreaterThan(0);
    for (const c of calls) {
      for (const k of c.keyframes) for (const p of Object.keys(k)) expect(ALLOWED.has(p), p).toBe(true);
    }
  });

  it("지켜보기에서 1단계로 넘어가 생각 말풍선이 나타나도 같은 칸이고, 바뀌는 것은 opacity·transform뿐이다(크기·자리 그대로). 대기로 돌아가 숨을 때도 같다", () => {
    motionOn();
    const { view, was } = step(screenAt(0), screenAt(1));
    const t = thoughtOf(view.container);
    expect(t).toBe(was.thought);
    expect(t.style.opacity).toBe("1");
    expect(still(t)).toBe(was.boxes.thought);
    expect(box(t.querySelector<HTMLElement>("[data-slot=thought-bubble]")!)).toBe(was.boxes.bubble);
    for (const c of ["transition-[opacity,transform]", "motion-reduce:transition-none"]) expect(t.className.split(/\s+/)).toContain(c);
    view.rerender(<DashboardScreen {...screenAt(0)} />);
    expect(thoughtOf(view.container)).toBe(t);
    expect(t.style.opacity).toBe("0");
    expect(still(t)).toBe(was.boxes.thought);
    // 숨는 동안 마지막 생각 글을 그대로 둔다(글을 비우면 사라지는 동안 빈 말풍선이 보인다)
    expect(t).toHaveTextContent(REASON);
    for (const c of calls) for (const k of c.keyframes) for (const p of Object.keys(k)) expect(ALLOWED.has(p), p).toBe(true);
  });

  it("생각이 바뀌면 앞 생각은 opacity로 사라지고 새 생각은 opacity·transform으로 떠오른다. 말풍선 칸 크기는 그대로다", () => {
    motionOn();
    const next = { ...THOUGHT, reasoning: "컵이 비어 있어요." };
    const { view, was } = step(screenAt(1), screenAt(1, { thought: next }));
    const t = thoughtOf(view.container);
    expect(still(t)).toBe(was.boxes.thought);
    expect(box(t.querySelector<HTMLElement>("[data-slot=thought-bubble]")!)).toBe(was.boxes.bubble);
    const items = [...t.querySelectorAll<HTMLElement>("[data-thought-item]")];
    expect(items.map((l) => l.querySelector("[data-thought-line]")!.textContent)).toEqual([REASON, next.reasoning]);
    const [old, now] = items;
    const out = calls.filter((c) => c.el === old);
    const into = calls.filter((c) => c.el === now);
    expect(out).toHaveLength(1);
    expect(into).toHaveLength(1);
    expect(out[0]!.keyframes.map((k) => k.opacity)).toEqual([1, 0]);
    expect(into[0]!.keyframes.map((k) => k.opacity)).toEqual([0, 1]);
    expect(into[0]!.keyframes.some((k) => "transform" in k)).toBe(true);
  });

  it("원래 생각에 그 판단의 두 줄(본 것·그래서)이 오면 원래 생각은 opacity로 사라지고 두 줄이 opacity·transform으로 떠오른다. 말풍선 칸 크기는 그대로다", () => {
    motionOn();
    const { view, was } = step(screenAt(1), screenAt(1, { thought: THOUGHT_LINES }));
    const t = thoughtOf(view.container);
    expect(still(t)).toBe(was.boxes.thought);
    expect(box(t.querySelector<HTMLElement>("[data-slot=thought-bubble]")!)).toBe(was.boxes.bubble);
    const [old, now] = [...t.querySelectorAll<HTMLElement>("[data-thought-item]")];
    expect(old!.querySelector("[data-thought-line]")).toHaveAttribute("data-thought-line", "raw");
    expect([...now!.querySelectorAll("[data-thought-line]")].map((l) => l.textContent)).toEqual([LINES.seen, LINES.why]);
    const out = calls.filter((c) => c.el === old);
    const into = calls.filter((c) => c.el === now);
    expect(out.map((c) => c.keyframes.map((k) => k.opacity))).toEqual([[1, 0]]);
    expect(into.map((c) => c.keyframes.map((k) => k.opacity))).toEqual([[0, 1]]);
    for (const c of calls) for (const k of c.keyframes) for (const p of Object.keys(k)) expect(ALLOWED.has(p), p).toBe(true);
  });

  it("계획 단계끼리는 생각이 같아 생각 말풍선을 다시 띄우지 않는다", () => {
    motionOn();
    const { view } = step(screenAt(1), screenAt(2));
    const t = thoughtOf(view.container);
    expect(t.querySelectorAll("[data-thought-item]")).toHaveLength(1);
    expect(calls.filter((c) => t.contains(c.el))).toEqual([]);
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

  it("단계가 바뀌어도 미니맵 칸 크기는 그대로다: 칸은 영상 비율이 바뀔 때만 높이가 바뀐다(가로 영상에서 단계만 바뀜 → 그대로, 세로 영상으로 바뀜 → 높이만)", () => {
    const wide = { kind: "image", src: "/debug-eye/eye-table-near-wide.webp", width: 405, height: 228 } as const;
    const { view, was } = step(screenAt(2, { phone: wide }), screenAt(3, { phone: { ...wide, src: "/debug-eye/eye-sink-wide.webp" } }));
    expect(box(phoneOf(view.container))).toBe(was.boxes.phone);
    view.rerender(<DashboardScreen {...screenAt(3, { phone: imageSlot("sink") })} />);
    const now = phoneOf(view.container);
    expect(now).toBe(was.phone);
    expect(box(now)).not.toBe(was.boxes.phone);
    const strip = (v: string) => v.replace(/height: [^;]+;/, "");
    expect(strip(box(now))).toBe(strip(was.boxes.phone));
    expect(box(was.twin)).toBe(was.boxes.twin);
    expect(box(was.twin.parentElement!)).toBe(was.boxes.stage);
  });

  it("말풍선 말이 바뀌면 앞 말은 opacity로 사라지고 새 말은 opacity·transform으로 떠오른다", () => {
    motionOn();
    const { view } = step(screenAt(1), screenAt(2));
    const lines = [...view.container.querySelectorAll<HTMLElement>("[data-say-line]")];
    expect(lines.map((l) => l.textContent)).toEqual([SAY[1], SAY[2]]);
    const [old, now] = lines;
    const out = calls.filter((c) => c.el === old);
    const into = calls.filter((c) => c.el === now);
    expect(out).toHaveLength(1);
    expect(into).toHaveLength(1);
    expect(out[0]!.keyframes.map((k) => k.opacity)).toEqual([1, 0]);
    expect(into[0]!.keyframes.map((k) => k.opacity)).toEqual([0, 1]);
    expect(into[0]!.keyframes.some((k) => "transform" in k)).toBe(true);
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
    expect(loads.at(-1)).toContain(SAY[2]);
  });

  it("움직임 줄이기를 켠 화면에서는 단계가 바뀌어도 움직이지 않는다", () => {
    const { view } = step(screenAt(1), screenAt(2));
    expect(view.container.querySelectorAll("[data-say-line]").length).toBeGreaterThan(0);
    expect(calls).toEqual([]);
  });
});
