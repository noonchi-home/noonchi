// 대시보드 화면 틀(DashboardScreen): 머리줄 막대·맨 아래 줄 없이, 왼쪽에 트윈(지도 자리는 칸을 꽉 채우고, 할 일 진행도는 여기에만), 오른쪽에 대시보드 폰 칸
// 「폰 카메라」(세로 9:16 영상에 YOLO 상자, 영상 안 위쪽에 떠 있는 FSM·행동 반투명 카드, 영상이 없으면 연결 QR)가 화면 높이를 다 쓴다.
// 두 칸은 틈 없이 한 판(LiquidGlass)으로 붙고 사이에 나눔선 하나만 있다. 마스코트는 판 없이 가운데 축을 나눔선에 두고 아래 끝을 화면 밑 선에 대며(누르면 설정 창),
// 말풍선은 트윈 아래쪽 카드 하나다. 자리는 화면 크기로만 정해진다(layout.ts). 자료는 fixtures.ts.
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import tokens from "../../../src/design/tokens.json";
import { DashboardScreen, type ScreenProps } from "../../src/dashboard/DashboardScreen";
import { TAG_H, tagWidth } from "../../src/dashboard/detections";
import { pageLayout, type Rect } from "../../src/dashboard/layout";
import { MASCOT } from "../../src/dashboard/mascot-image";
import { WORDS } from "../../src/dashboard/words";
import { CLEAR_CUP, EYE_FRAMES, HUB, imageSlot, LEFT_CUP, PHONE_URL, PLAN, SAY, screenAt, WATCHING } from "./fixtures";
import type { PlanView } from "../../../src/contract/plan.ts";

/** WCAG 대비(hex 두 개). */
const lum = (hex: string) => {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]!;
};
const contrast = (a: string, b: string) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x! + 0.05) / (y! + 0.05); };
/** 바탕 위에 겹친 반투명 색(hex). */
const over = (top: string, alpha: number, back: string) => "#" + [1, 3, 5].map((i) =>
  Math.round(parseInt(top.slice(i, i + 2), 16) * alpha + parseInt(back.slice(i, i + 2), 16) * (1 - alpha)).toString(16).padStart(2, "0")).join("");

const phonePane = () => screen.getByRole("region", { name: "폰 카메라" });
const twinPane = () => screen.getByRole("region", { name: "트윈" });
const mascot = () => screen.getByRole("region", { name: "마스코트" });
const say = () => document.querySelector<HTMLElement>("[data-say-card]")!;
/** class 하나가 있는지(변형 접두·대괄호 값 포함 그대로). */
const cls = (el: Element, name: string) => el.className.split(/\s+/).includes(name);
const before = (a: Element, b: Element) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
const px = (v: string) => Number.parseFloat(v);
const boxOf = (el: HTMLElement): Rect => ({ left: px(el.style.left), top: px(el.style.top), width: px(el.style.width), height: px(el.style.height) });
const close = (a: Rect, b: Rect) => (["left", "top", "width", "height"] as const).every((k) => Math.abs(a[k] - b[k]) < 0.01);
const draw = (p: ScreenProps) => render(<DashboardScreen {...p} />);

/** 모든 상자가 화면 크기로 재진다(jsdom은 0을 준다). main 크기가 곧 화면 크기다. */
function atScreen(width: number, height: number) {
  return vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(
    { x: 0, y: 0, left: 0, top: 0, right: width, bottom: height, width, height, toJSON: () => ({}) } as DOMRect,
  );
}

describe("대시보드 배치", () => {
  it("머리줄 막대·맨 아래 줄·추론 과정 카드·판단 기록 목록이 없다", () => {
    const { container } = draw(screenAt(2));
    expect(container.querySelector("header")).toBeNull();
    expect(screen.queryByRole("banner")).toBeNull();
    expect(screen.queryByRole("complementary")).toBeNull();
    expect(screen.queryByRole("region", { name: "추론 과정" })).toBeNull();
    expect(screen.queryByRole("region", { name: "판단 기록" })).toBeNull();
    expect(screen.queryByRole("list", { name: "판단 기록" })).toBeNull();
  });

  it("main에 단계 번호(data-step)를 달고, 글꼴·마스코트 그림·지도가 준비되고 미리 그려 본 뒤 data-ready를 단다", async () => {
    const { container, rerender } = draw(screenAt(3, { mapReady: false }));
    const main = container.querySelector("main")!;
    expect(main).toHaveAttribute("data-step", "3");
    expect(main).not.toHaveAttribute("data-ready");
    rerender(<DashboardScreen {...screenAt(3)} />);
    await waitFor(() => expect(main).toHaveAttribute("data-ready"));
  });

  it("마스코트는 칸·카드·유리 판 없이 화면 바탕(main) 위에 바로 있다", () => {
    const { container } = draw(screenAt(2));
    const m = mascot();
    expect(m.parentElement).toBe(container.querySelector("main"));
    expect(m.querySelector("[data-glass], [data-slot=card]")).toBeNull();
    expect(m.closest("[data-glass], [data-slot=card]")).toBeNull();
    const button = within(m).getByRole("button", { name: "설정 열기" });
    expect(button.closest("[data-glass]")).toBeNull();
  });

  it.each([[1920, 1080], [1440, 900]])("%i×%i: 트윈·폰 카메라·FSM 카드·마스코트·말풍선은 화면 크기로 정한 자리(layout.ts)에 놓이고 지도 자리는 트윈 칸을 꽉 채운다", (width, height) => {
    const rect = atScreen(width, height);
    try {
      draw(screenAt(2));
      const L = pageLayout({ width, height }, MASCOT);
      expect(close(boxOf(mascot()), L.mascot)).toBe(true);
      expect(close(boxOf(say()), L.bubble)).toBe(true);
      const stage = phonePane().parentElement!;
      expect(close(boxOf(stage), { left: L.twin.left, top: L.twin.top, width: L.video.left + L.video.width - L.twin.left, height: L.twin.height })).toBe(true);
      expect(px(phonePane().style.width)).toBeCloseTo(L.video.width, 5);
      expect(stage.style.columnGap).toBe("");
      expect(stage.style.gap).toBe("");
      const map = twinPane().querySelector<HTMLElement>("[data-map]")!;
      for (const c of ["absolute", "inset-0", "overflow-hidden"]) expect(cls(map, c), c).toBe(true);
      expect(map.getAttribute("style") ?? "").toBe("");
      expect(map.querySelector("canvas[data-fixture-map]")).not.toBeNull();
      const card = phonePane().querySelector<HTMLElement>("[data-fsm-card]")!;
      expect(close(boxOf(card), { left: L.card.left - L.video.left, top: L.card.top - L.video.top, width: L.card.width, height: L.card.height })).toBe(true);
    } finally { rect.mockRestore(); }
  });

  it("트윈이 왼쪽, 폰 카메라가 오른쪽으로 좌우로 있다: 트윈이 남은 너비를 채운다", () => {
    draw(screenAt(2));
    const [phone, twin] = [phonePane(), twinPane()];
    const stage = phone.parentElement!;
    expect(twin.parentElement).toBe(stage);
    expect(before(twin, phone)).toBe(true);
    expect(cls(stage, "flex")).toBe(true);
    expect(cls(stage, "flex-col")).toBe(false);
    expect(cls(phone, "shrink-0")).toBe(true);
    expect(cls(twin, "flex-1")).toBe(true);
    expect(stage.contains(mascot())).toBe(false);
  });

  it("트윈과 폰 카메라는 틈 없이 한 판으로 붙는다: 판(LiquidGlass)은 하나이고 바깥 모서리만 둥글며, 두 칸 사이에는 세로 나눔선(Separator) 하나만 있다", () => {
    draw(screenAt(2));
    const [phone, twin] = [phonePane(), twinPane()];
    const stage = phone.parentElement!;
    expect(stage).toHaveAttribute("data-glass", "opaque");
    expect(stage.style.borderRadius).toBe("16px");
    expect(cls(stage, "overflow-hidden")).toBe(true);
    for (const pane of [twin, phone]) {
      const glass = [...pane.querySelectorAll<HTMLElement>("[data-glass]")].filter((g) => cls(g, "size-full") && !g.closest("[data-fsm-card]"));
      expect(glass, pane.getAttribute("aria-label")!).toEqual([]);
      expect(pane.style.borderRadius).toBe("");
    }
    const dividers = stage.querySelectorAll<HTMLElement>("[data-divider]");
    expect(dividers).toHaveLength(1);
    const divider = dividers[0]!;
    expect(divider.parentElement).toBe(stage);
    expect(divider.previousElementSibling).toBe(twin);
    expect(divider.nextElementSibling).toBe(phone);
    expect(divider).toHaveAttribute("data-orientation", "vertical");
    expect(cls(divider, "bg-border")).toBe(true);
    expect(cls(divider, "w-[1px]")).toBe(true);
    expect(cls(divider, "h-full")).toBe(true);
    for (const el of [stage, twin, phone]) expect(el.className, el.tagName).not.toMatch(/(^|\s)(gap|gap-x|space-x|m[lrx]?|p[lrx]?)-(?!0(\s|$))\S+/);
  });

  it.each([[1920, 1080], [1440, 900]])("%i×%i: 마스코트 아래 끝은 화면 밑 선이다(빈틈 없음)", (width, height) => {
    const rect = atScreen(width, height);
    try {
      draw(screenAt(2));
      const box = boxOf(mascot());
      expect(box.top + box.height).toBeCloseTo(height, 5);
    } finally { rect.mockRestore(); }
  });

  it("단계·영상·연결·로봇 자리와 상관없이 모든 자리(말풍선 자리 높이 포함)가 같다", () => {
    const rect = atScreen(1920, 1080);
    try {
      const boxes = (p: ScreenProps) => {
        const { unmount } = draw(p);
        const stage = phonePane().parentElement!;
        const out = [mascot(), say(), stage, phonePane(), twinPane(), twinPane().querySelector<HTMLElement>("[data-map]")!].map((el) =>
          [el.style.left, el.style.top, el.style.width, el.style.height, el.className].join(" "));
        unmount();
        return out;
      };
      const first = boxes(screenAt(1));
      const variants: [string, ScreenProps][] = [
        ["0", screenAt(0)], ["2", screenAt(2)], ["3", screenAt(3)], ["4", screenAt(4)],
        ["qr", screenAt(3, { phone: { kind: "qr", url: PHONE_URL } })], ["live", screenAt(2, { phone: { kind: "live", url: PHONE_URL } })],
        ["로봇 모름", screenAt(2, { robotKnown: false })], ["연결 끊김", screenAt(2, { connected: false })], ["상자 없음", screenAt(0, { boxes: [], frame: null })],
      ];
      for (const [name, p] of variants) expect(boxes(p), name).toEqual(first);
    } finally { rect.mockRestore(); }
  });
});

describe("대시보드 말풍선(트윈 아래쪽 카드 하나)", () => {
  it.each([0, 1, 2, 3, 4])("%i: 트윈 아래쪽 마스코트 왼쪽 카드(LiquidGlass 불투명 판 + Item say)에 그 순간 말을 보인다", (n) => {
    const rect = atScreen(1920, 1080);
    try {
      draw(screenAt(n));
      const L = pageLayout({ width: 1920, height: 1080 }, MASCOT);
      const card = say();
      expect(close(boxOf(card), L.bubble)).toBe(true);
      expect(card).toHaveAttribute("data-glass", "opaque");
      expect(card.style.borderRadius).toBe("16px");
      const item = card.querySelector<HTMLElement>("[data-slot=item]")!;
      expect(item).toHaveAttribute("data-size", "say");
      expect(cls(item, "size-full")).toBe(true);
      const now = [...card.querySelectorAll("[data-say-line]")].at(-1)!;
      expect(now).toHaveTextContent(SAY[n]!);
      expect(item.contains(now)).toBe(true);
    } finally { rect.mockRestore(); }
  });

  it("말풍선은 꼬리·생각 동그라미 없는 카드 하나다: Tooltip·꼬리·그림이 없고, 대시보드 폰 칸·트윈 칸 밖에 있다", () => {
    draw(screenAt(3));
    const card = say();
    expect(document.querySelectorAll("[data-say-card]")).toHaveLength(1);
    expect(card.querySelector('[data-slot="tooltip-content"], [data-slot="tooltip-arrow"], [role="tooltip"], svg, img')).toBeNull();
    expect(document.querySelector("[data-say-anchor]")).toBeNull();
    expect(card.children).toHaveLength(1);
    expect(card.querySelectorAll("[data-slot=item]")).toHaveLength(1);
    expect(phonePane().contains(card)).toBe(false);
    expect(twinPane().contains(card)).toBe(false);
    expect(phonePane().querySelector('[data-slot="tooltip-content"], [role="tooltip"]')).toBeNull();
  });

  it.each([[1920, 1080], [1440, 900]])("%i×%i: 카드 글은 가운데 정렬·16px(text-base)·굵게이고, 카드 높이는 그 글 두 줄(줄 24px) + 26으로 정해져 있다. 말 길이와 단계가 크기를 바꾸지 않는다", (width, height) => {
    const rect = atScreen(width, height);
    try {
      const L = pageLayout({ width, height }, MASCOT);
      const seen = new Set<string>();
      const long = "아주 긴 말이 와도 카드 크기는 그대로이고 글은 두 줄 높이 안에서 두 줄까지 잘려요. 그래서 자리가 바뀌지 않아요.";
      for (const p of [0, 1, 2, 3, 4].map((n) => screenAt(n)).concat([screenAt(2, { say: long }), screenAt(2, { say: "" })])) {
        const { unmount } = draw(p);
        const card = say();
        expect(close(boxOf(card), L.bubble)).toBe(true);
        seen.add([card.style.left, card.style.top, card.style.width, card.style.height].join(" "));
        const item = card.querySelector<HTMLElement>("[data-slot=item]")!;
        for (const c of ["text-base", "font-bold", "text-center"]) expect(cls(item, c), c).toBe(true);
        expect(item.className).not.toMatch(/(^|\s)(text-sm|text-lg|text-body\S*|min-\[\S+:text-\S+)(\s|$)/);
        const lines = card.querySelector<HTMLElement>("[data-say]")!;
        expect(cls(lines, "h-[2lh]")).toBe(true);
        for (const line of card.querySelectorAll("[data-say-line]")) expect(cls(line, "line-clamp-2")).toBe(true);
        unmount();
      }
      expect(seen.size).toBe(1);
      expect(L.bubble.height).toBe(2 * 24 + 26);
    } finally { rect.mockRestore(); }
  });

  it("말풍선은 보기만 한다: 마우스를 받지 않고 트윈·폰 칸보다 위에 있다", () => {
    draw(screenAt(1));
    expect(cls(say(), "pointer-events-none")).toBe(true);
    expect(cls(say(), "z-50")).toBe(true);
    expect(say().parentElement).toBe(document.querySelector("main"));
  });
});

describe("대시보드 마스코트", () => {
  const turnOf = () => mascot().querySelector<HTMLElement>("[data-mascot-turn]")!;
  const logoOf = () => mascot().querySelector<HTMLElement>("[data-mascot-logo]")!;
  const transformOf = (el: HTMLElement) => getComputedStyle(el).transform;

  it.each([[1920, 1080], [1440, 900]])("%i×%i: 브랜드 마스코트 전신 그림을 정한 자리·크기로 단추 안에 둔다(그림 자리는 늘지도 돌지도 않는다)", (width, height) => {
    const rect = atScreen(width, height);
    try {
      draw(screenAt(2));
      const L = pageLayout({ width, height }, MASCOT);
      const img = mascot().querySelector("img")!;
      expect(img.getAttribute("src")).toBe(MASCOT.src);
      expect(close(boxOf(img), L.image)).toBe(true);
      expect(img.style.transform).toBe("");
      expect(img.className).not.toMatch(/scale|rotate|flip|grayscale|opacity-|invert|sepia/);
      expect(img).toHaveAttribute("aria-hidden", "true");
    } finally { rect.mockRestore(); }
  });

  it("지켜보기(계획 없음)에서는 영상을 보고, 계획이 생기면 같은 마스코트가 축을 중심으로 돌아 트윈을 본다(transform만)", () => {
    const { container, rerender } = draw(screenAt(0));
    const [m, turn] = [mascot(), turnOf()];
    const box = [m.style.left, m.style.top, m.style.width, m.style.height].join(" ");
    expect(container.querySelector("main")).toHaveAttribute("data-step", "0");
    expect(m).toHaveAttribute("data-facing", "video");
    expect(transformOf(turn)).toBe("scaleX(1)");
    rerender(<DashboardScreen {...screenAt(1)} />);
    expect(container.querySelector("main")).toHaveAttribute("data-step", "1");
    expect(mascot()).toBe(m);
    expect(turnOf()).toBe(turn);
    expect(m).toHaveAttribute("data-facing", "twin");
    expect(transformOf(turn)).toBe("scaleX(-1)");
    expect([m.style.left, m.style.top, m.style.width, m.style.height].join(" ")).toBe(box);
  });

  it.each([0, 1, 2, 3, 4])("%i: 대기 때는 오른쪽(영상)을 보고, 계획이 있으면 좌우를 뒤집어 왼쪽(트윈)을 본다. 뒤집기는 단추 가운데 축(나눔선)을 중심으로 한 transform이다", (n) => {
    draw(screenAt(n));
    const turn = turnOf();
    expect(mascot()).toHaveAttribute("data-facing", n > 0 ? "twin" : "video");
    expect(transformOf(turn)).toBe(n > 0 ? "scaleX(-1)" : "scaleX(1)");
    expect(turn.style.transformOrigin).toBe("50% 50%");
    for (const c of ["absolute", "inset-0", "will-change-transform", "transition-transform", "motion-reduce:transition-none"]) expect(cls(turn, c), c).toBe(true);
    expect(turn.contains(mascot().querySelector("img"))).toBe(true);
    expect(turn.contains(logoOf())).toBe(true);
  });

  it.each([0, 1, 4])("%i: 가슴 LG 표시는 늘 바로 읽힌다: 표시 원은 그림과 같은 transform으로 제 가운데를 중심으로 다시 뒤집혀 원래 그림 그대로 보인다", (n) => {
    const rect = atScreen(1920, 1080);
    try {
      draw(screenAt(n));
      const L = pageLayout({ width: 1920, height: 1080 }, MASCOT);
      const logo = logoOf();
      expect(close(boxOf(logo), L.logo)).toBe(true);
      expect(transformOf(logo)).toBe(transformOf(turnOf()));
      expect(logo.style.transformOrigin).toBe("50% 50%");
      expect(logo.style.clipPath).toBe("circle(50%)");
      const inner = logo.querySelector<HTMLImageElement>("img")!;
      expect(inner.getAttribute("src")).toBe(MASCOT.src);
      expect(close(boxOf(inner), { left: L.image.left - L.logo.left, top: L.image.top - L.logo.top, width: L.image.width, height: L.image.height })).toBe(true);
      expect(logo.parentElement).toBe(mascot().querySelector("img")!.parentElement);
    } finally { rect.mockRestore(); }
  });

  it("뒤집어도 자리·크기는 그대로다: 단추·그림·표시 원 자리가 같고 transform만 다르다", () => {
    const rect = atScreen(1920, 1080);
    try {
      const boxes = (p: ScreenProps) => {
        const { unmount } = draw(p);
        const out = [mascot(), turnOf(), mascot().querySelector<HTMLElement>("img")!, logoOf()].map((el) => [el.style.left, el.style.top, el.style.width, el.style.height, el.className].join(" "));
        const html = mascot().outerHTML.replace(/radix-[^"\s]+/g, "radix-id").replace(/scaleX\(-?1\)/g, "T").replace(/data-facing="\w+"/, "");
        unmount();
        return { out, html };
      };
      const [idle, acting] = [boxes(screenAt(0)), boxes(screenAt(1))];
      expect(acting.out).toEqual(idle.out);
      expect(acting.html).toBe(idle.html);
    } finally { rect.mockRestore(); }
  });

  it("계획 단계끼리는 마스코트가 그대로다(글 없음)", () => {
    const html = (p: ScreenProps) => {
      const { unmount } = draw(p);
      const out = mascot().outerHTML.replace(/radix-[^"\s]+/g, "radix-id");
      unmount();
      return out;
    };
    expect(html(screenAt(1))).toBe(html(screenAt(4)));
    draw(screenAt(1));
    expect(mascot().textContent).toBe("");
  });
});

describe("대시보드 폰 카메라(대시보드 폰 칸)", () => {
  // 1920×1080 화면의 영상 칸 크기(layout.ts, 9:16). jsdom은 0을 준다.
  const SLOT = { width: 590, height: 1048 };
  let rect: ReturnType<typeof vi.spyOn>;
  beforeEach(() => { rect = atScreen(SLOT.width, SLOT.height); });
  afterEach(() => rect.mockRestore());
  const slotOf = (phone: HTMLElement) => phone.querySelector<HTMLElement>("[data-video]")!;
  const qrOf = () => within(slotOf(phonePane())).queryByRole("img", { name: "폰 연결 QR" });

  it("영상 칸은 폰 카메라 칸(9:16)을 다 채우고, 영상은 잘리지 않게 다 보인다(contain)", () => {
    draw(screenAt(3));
    const slot = slotOf(phonePane());
    expect(cls(slot, "size-full")).toBe(true);
    expect(cls(slot, "overflow-hidden")).toBe(true);
    const img = slot.querySelector("img")!;
    expect(img.getAttribute("src")).toBe("/debug-eye/eye-table-far.webp");
    expect(cls(img, "object-contain")).toBe(true);
    expect(img.className).not.toMatch(/object-cover/);
  });

  it("FSM·행동은 영상 안에 떠 있는 둥근 유리 카드(LiquidGlass)다: 영상 끝에서 띄우고, glass-soft(0.6)라 0.9보다 투명해 영상이 비친다", () => {
    draw(screenAt(1));
    const slot = slotOf(phonePane());
    const L = pageLayout(SLOT, MASCOT);
    const card = slot.querySelector<HTMLElement>("[data-fsm-card]")!;
    expect(card).not.toBeNull();
    expect(cls(card, "absolute")).toBe(true);
    expect(close(boxOf(card), { left: L.card.left - L.video.left, top: L.card.top - L.video.top, width: L.card.width, height: L.card.height })).toBe(true);
    expect(px(card.style.left)).toBeGreaterThan(0);
    expect(px(card.style.top)).toBeGreaterThan(0);
    const glass = card.querySelector<HTMLElement>("[data-glass]")!;
    expect(glass.dataset.glass).not.toBe("opaque");
    const tint = Number(glass.dataset.tint);
    expect(tint).toBe(tokens.colorRgba["glass-soft"].alpha);
    expect(tint).toBeLessThan(0.9);
    expect(glass.style.borderRadius).toBe("16px");
    expect(glass.contains(card.querySelector("[data-decision]"))).toBe(true);
    // 카드는 YOLO 상자·이름표 위에 그린다(뒤에 놓인 것)
    expect(before(slot.querySelector("[data-detection]")!, card)).toBe(true);
  });

  it("FSM 카드 글은 「FSM」 칩 + 관찰 한 문장, 「행동」 칩 + 행동이다", () => {
    draw(screenAt(1));
    const card = slotOf(phonePane()).querySelector<HTMLElement>("[data-fsm-card]")!;
    const chips = [...card.querySelectorAll<HTMLElement>("[data-slot=status]")].map((e) => e.textContent);
    expect(chips).toEqual([WORDS.fsm, WORDS.action]);
    expect(card.querySelector("[data-fsm] [data-slot=item-title]")).toHaveTextContent(LEFT_CUP);
    expect(card.querySelector("[data-action] [data-slot=item-title]")).toHaveTextContent(CLEAR_CUP);
  });

  it("지켜보기는 관찰 글과 행동 대기를 보이고, 판단이 아직 없으면 「아직 판단 없음」이다", () => {
    const { unmount } = draw(screenAt(0));
    expect(phonePane().querySelector("[data-fsm]")).toHaveTextContent(WATCHING);
    expect(phonePane().querySelector("[data-action]")).toHaveTextContent(WORDS.wait);
    unmount();
    draw(screenAt(0, { observation: null }));
    expect(phonePane().querySelector("[data-fsm]")).toHaveTextContent(WORDS.noObservation);
  });

  it("FSM 카드 글은 어느 장면에서도 읽힌다: 유리 위 글은 ink 값뿐이고 이름(FSM·행동)은 불투명 칩이다. 검정·흰 영상 위에서 4.5:1을 넘는다", () => {
    draw(screenAt(1));
    const card = slotOf(phonePane()).querySelector<HTMLElement>("[data-fsm-card]")!;
    const leaves = [...card.querySelectorAll<HTMLElement>("*")].filter((e) => e.children.length === 0 && e.textContent?.trim());
    expect(leaves.length).toBeGreaterThan(0);
    for (const e of leaves) expect(e.closest("[data-slot=item-title], [data-slot=status]"), e.textContent!).not.toBeNull();
    expect(card.querySelectorAll("[data-slot=item-description]")).toHaveLength(0);
    for (const chip of card.querySelectorAll<HTMLElement>("[data-slot=status]")) expect(chip.dataset.variant).toBe("default");
    const { color, colorRgba } = tokens;
    const alpha = colorRgba["glass-soft"].alpha;
    const surface = color[colorRgba["glass-soft"].ref as keyof typeof color].value;
    for (const back of ["#000000", "#ffffff"]) expect(contrast(color.ink.value, over(surface, alpha, back))).toBeGreaterThanOrEqual(4.5);
  });

  it.each(EYE_FRAMES.map((f) => [f.id, f] as const))("%s: YOLO 상자와 이름표가 영상 칸 안, FSM 카드 아래에 다 들어오고 이름·신뢰도를 보인다", (_, f) => {
    draw(screenAt(2, { phone: imageSlot(f.id), boxes: f.boxes, frame: { width: f.width, height: f.height } }));
    const slot = slotOf(phonePane());
    const L = pageLayout(SLOT, MASCOT);
    const roof = L.card.top + L.card.height - L.video.top;
    const boxes = [...slot.querySelectorAll<HTMLElement>("[data-detection]")];
    expect(boxes).toHaveLength(f.boxes.length);
    for (const b of boxes) {
      const box = b.querySelector<HTMLElement>('[data-slot="bounding-box"]')!;
      expect(px(b.style.left)).toBeGreaterThanOrEqual(0);
      expect(px(b.style.top)).toBeGreaterThanOrEqual(roof);
      expect(px(b.style.left) + px(box.style.width)).toBeLessThanOrEqual(SLOT.width);
      expect(px(b.style.top) + px(box.style.height)).toBeLessThanOrEqual(SLOT.height);
    }
    const tags = [...slot.querySelectorAll<HTMLElement>("[data-detection-label]")];
    expect(tags.map((t) => t.textContent)).toEqual(f.boxes.map((d) => `${d.label} ${d.score.toFixed(2)}`));
    for (const t of tags) {
      expect(px(t.style.left)).toBeGreaterThanOrEqual(0);
      expect(px(t.style.top)).toBeGreaterThanOrEqual(roof);
      expect(px(t.style.top) + TAG_H).toBeLessThanOrEqual(SLOT.height);
      expect(px(t.style.left) + tagWidth(t.textContent!.split(" ")[0]!)).toBeLessThanOrEqual(SLOT.width);
    }
  });

  it("그림 크기(frame)를 모르면 영상 칸 그림 크기로 상자를 둔다", () => {
    draw(screenAt(2, { frame: null }));
    expect(slotOf(phonePane()).querySelectorAll("[data-detection]")).toHaveLength(1);
  });

  it("YOLO 상자는 테두리 한 겹만 그린다: 보기만 하는 화면이라 크기 바꿈 손잡이가 없어 작은 컵 상자 안이 가려지지 않는다", () => {
    draw(screenAt(1, { boxes: EYE_FRAMES[0]!.boxes }));
    const boxes = [...phonePane().querySelectorAll<HTMLElement>('[data-detection] [data-slot="bounding-box"]')];
    expect(boxes.map((b) => b.closest<HTMLElement>("[data-detection]")!.dataset.detection)).toEqual(["식탁", "컵"]);
    for (const b of boxes) {
      const lined = [...b.querySelectorAll<HTMLElement>("*")].filter((e) => e.style.borderStyle === "solid" || /solid/.test(e.style.border));
      expect(lined).toHaveLength(1);
      expect(lined[0]!.children).toHaveLength(0);
    }
  });

  it("YOLO 이름표는 폰 영상 이름표 토큰(twin.phoneFocus labelBg·labelText) 색이고 Status 원래 크기(text-xs)다", () => {
    draw(screenAt(1, { boxes: EYE_FRAMES[0]!.boxes }));
    const { labelBg, labelText } = tokens.twin.phoneFocus;
    const tags = [...phonePane().querySelectorAll<HTMLElement>("[data-detection-label]")];
    expect(tags).toHaveLength(2);
    for (const t of tags) {
      expect(cls(t, `bg-${labelBg.ref}`)).toBe(true);
      expect(cls(t, `text-${labelText.ref}`)).toBe(true);
      expect(t.className).not.toMatch(/(^|\s)(bg-muted|text-brand)(\s|$)/);
      expect(cls(t, "text-xs")).toBe(true);
      expect(t.className).not.toMatch(/text-(body|label)/);
    }
  });

  it("FSM과 행동은 Item 원래 크기(sm, text-sm) 한 줄이고 넘치면 자른다", () => {
    draw(screenAt(1));
    const phone = phonePane();
    expect(phone.querySelector("[data-fsm]")).toHaveAttribute("data-size", "sm");
    expect(phone.querySelector("[data-action]")).toHaveAttribute("data-size", "sm");
    const titles = [...phone.querySelectorAll("[data-decision] [data-slot=item-title]")];
    expect(titles).toHaveLength(2);
    for (const title of titles) expect(cls(title, "truncate")).toBe(true);
  });

  it("영상이 없으면(qr) 영상·YOLO·FSM 카드 대신 영상 칸 자리에 영상 칸에 맞춘 연결 QR을 보인다", () => {
    draw(screenAt(3, { phone: { kind: "qr", url: PHONE_URL } }));
    const phone = phonePane();
    expect(phone.querySelector("img")).toBeNull();
    expect(phone.querySelector("[data-detection-label]")).toBeNull();
    expect(phone.querySelector("[data-fsm-card]")).toBeNull();
    const slot = slotOf(phone);
    const qr = within(slot).getByRole("img", { name: "폰 연결 QR" });
    expect(Number(qr.getAttribute("width"))).toBe(Math.min(SLOT.width, SLOT.height) - 48);
    expect(slot).toHaveTextContent("폰 카메라로 찍으세요");
    expect(slot).toHaveTextContent(PHONE_URL);
  });

  it("폰 서버가 꺼져 있고(qr) 폰 주소가 없으면 QR 대신 영상 칸에 「폰 서버가 꺼져 있어요.」 한 줄(Item sm)만 보인다", () => {
    draw(screenAt(3, { phone: { kind: "qr", url: "" } }));
    expect(qrOf()).toBeNull();
    expect(phonePane().querySelector("[data-fsm-card]")).toBeNull();
    const slot = slotOf(phonePane());
    expect(slot.textContent).toBe("폰 서버가 꺼져 있어요.");
    expect(within(slot).getByText("폰 서버가 꺼져 있어요.").closest("[data-slot=item]")).toHaveAttribute("data-size", "sm");
  });

  it("폰 서버는 켜졌는데(live) 폰 주소가 없으면 첫 장 전에 「폰에서 AR을 시작하세요.」 한 줄을 보이고, 첫 장이 오면 없앤다", () => {
    draw(screenAt(1, { phone: { kind: "live", url: "" } }));
    const slot = slotOf(phonePane());
    expect(qrOf()).toBeNull();
    expect(slot).toHaveTextContent("폰에서 AR을 시작하세요.");
    expect(within(slot).getByText("폰에서 AR을 시작하세요.").closest("[data-slot=item]")).toHaveAttribute("data-size", "sm");
    expect(slot).not.toHaveTextContent("폰 서버가 꺼져 있어요.");
    fireEvent.load(slot.querySelector<HTMLImageElement>("img")!);
    expect(slot).not.toHaveTextContent("폰에서 AR을 시작하세요.");
    expect(slot.querySelector("[data-fsm-card]")).not.toBeNull();
  });

  it("health 전(none)에는 영상 칸이 비어 있다", () => {
    draw(screenAt(1, { phone: { kind: "none" } }));
    const slot = slotOf(phonePane());
    expect(slot.textContent).toBe("");
    expect(slot.querySelector("img")).toBeNull();
    expect(qrOf()).toBeNull();
  });

  it("폰 서버가 켜져 있으면(live) 첫 장 전에는 연결 QR만 있고 FSM 카드·상자가 없다. 영상 그림에 첫 장이 오면 QR이 없어지고 FSM 카드·상자가 보인다", () => {
    draw(screenAt(1, { phone: { kind: "live", url: PHONE_URL } }));
    const slot = slotOf(phonePane());
    const img = slot.querySelector<HTMLImageElement>("img")!;
    expect(img.getAttribute("src")).toMatch(/^\/api\/eye\/stream\?t=\d+$/);
    expect(cls(img, "object-contain")).toBe(true);
    expect(cls(img, "size-full")).toBe(true);
    expect(qrOf()).not.toBeNull();
    expect(slot.querySelector("[data-fsm-card]")).toBeNull();
    expect(slot.querySelector("[data-detection]")).toBeNull();
    fireEvent.load(img);
    expect(slot.querySelector("img")).toBe(img);
    expect(qrOf()).toBeNull();
    expect(slot.querySelector("[data-fsm-card]")).not.toBeNull();
    expect(slot.querySelectorAll("[data-detection]")).toHaveLength(1);
  });

  it("live 칸의 영상 상자는 칸을 덮고(absolute inset-0) 크기를 정하지 않는다", () => {
    draw(screenAt(1, { phone: { kind: "live", url: PHONE_URL } }));
    const img = slotOf(phonePane()).querySelector<HTMLImageElement>("img")!;
    const wrap = img.closest<HTMLElement>("[data-eye-video]")!;
    for (const c of ["absolute", "inset-0"]) expect(cls(wrap, c), c).toBe(true);
    expect(wrap.getAttribute("style") ?? "").toBe("");
  });

  it("할 일 진행도는 대시보드 폰 칸에 없다", () => {
    draw(screenAt(2));
    expect(phonePane()).not.toHaveTextContent(`2/${PLAN.steps.length}`);
    expect(phonePane().querySelector("[data-progress]")).toBeNull();
  });
});

describe("대시보드 트윈", () => {
  it("할 일·지금 단계·단계 수와 단계 막대를 트윈 안에만 보인다", () => {
    draw(screenAt(2));
    const progress = twinPane().querySelector<HTMLElement>("[data-progress]")!;
    expect(progress).toHaveTextContent(PLAN.goal);
    expect(progress).toHaveTextContent(`2/${PLAN.steps.length}`);
    expect(progress).toHaveTextContent(PLAN.steps[1]!.label);
    expect(progress.querySelectorAll("[data-segment]")).toHaveLength(PLAN.steps.length);
    expect(document.querySelectorAll("[data-progress]")).toHaveLength(1);
    expect(mascot()).not.toHaveTextContent(`2/${PLAN.steps.length}`);
    expect(say()).not.toHaveTextContent(`2/${PLAN.steps.length}`);
  });

  it("단계 막대 칸: 끝난 칸 completed, 지금 칸 active, 남은 칸 inactive", () => {
    draw(screenAt(2));
    const segs = [...twinPane().querySelector("[data-progress]")!.querySelectorAll("[data-segment]")].map((e) => e.getAttribute("data-state"));
    expect(segs).toEqual(["completed", "active", "inactive", "inactive"]);
  });

  it("예정 계획(단계 모두 예정)은 「1/4」 글과 같이 단계 막대도 첫 칸이 지금 칸이고 끝난 칸이 없다", () => {
    const plan: PlanView = { ...PLAN, status: "planned", steps: PLAN.steps.map((s) => ({ ...s, status: "pending" })) };
    draw(screenAt(1, { plan, step: plan.steps[0]! }));
    const progress = twinPane().querySelector<HTMLElement>("[data-progress]")!;
    expect(progress.querySelector("[data-slot=item-description]")).toHaveTextContent(`1/${PLAN.steps.length} · ${PLAN.steps[0]!.label}`);
    const segs = [...progress.querySelectorAll("[data-segment]")].map((e) => e.getAttribute("data-state"));
    expect(segs).toEqual(["active", "inactive", "inactive", "inactive"]);
  });

  it("행동 중 기다리기 단계는 진행도에만 「기다리는 중 · 단계 이름」으로 보인다", () => {
    const plan: PlanView = {
      ...PLAN, goal: "세탁물 건조기로 옮기기",
      steps: [{ id: "w:1", kind: "wait", label: "세탁 멈춤", status: "active" }, { id: "w:2", kind: "move", label: "세탁기로 가기", status: "pending" }],
    };
    draw(screenAt(1, { plan, step: plan.steps[0]! }));
    const progress = twinPane().querySelector<HTMLElement>("[data-progress]")!;
    expect(progress.querySelector("[data-slot=item-description]")).toHaveTextContent("1/2 · 기다리는 중 · 세탁 멈춤");
    expect(phonePane()).not.toHaveTextContent("기다리는 중");
  });

  it("지켜보기(계획 없음)에는 할 일 진행도가 없다", () => {
    draw(screenAt(0));
    expect(document.querySelector("[data-progress]")).toBeNull();
    expect(say()).toHaveTextContent(SAY[0]!);
  });

  it("지켜보기에서 1단계로 넘어가면 할 일 진행도가 트윈 왼쪽 위에 생긴다(1/4 · 첫 계획 단계 이름)", () => {
    const { rerender } = draw(screenAt(0));
    rerender(<DashboardScreen {...screenAt(1)} />);
    const progress = twinPane().querySelector<HTMLElement>("[data-progress]")!;
    expect(progress.querySelector("[data-slot=item-description]")).toHaveTextContent(`1/${PLAN.steps.length} · ${PLAN.steps[0]!.label}`);
    expect(progress.querySelectorAll("[data-segment]")).toHaveLength(PLAN.steps.length);
  });

  it("지도는 트윈 칸 전체(data-map)에 그리고, 할 일 진행도는 트윈 왼쪽 위, 칩은 트윈 오른쪽 위에 지도 위로 쌓는다", () => {
    draw(screenAt(2, { robotKnown: false, connected: false }));
    const twin = twinPane();
    const map = twin.querySelector<HTMLElement>("[data-map]")!;
    for (const c of ["absolute", "inset-0", "overflow-hidden"]) expect(cls(map, c), c).toBe(true);
    const progress = twin.querySelector<HTMLElement>("[data-progress]")!;
    expect(map.contains(progress)).toBe(false);
    for (const c of ["absolute", "left-4", "top-4"]) expect(cls(progress, c), c).toBe(true);
    const chips = twin.querySelector<HTMLElement>("[data-chips]")!;
    expect(map.contains(chips)).toBe(false);
    for (const c of ["pointer-events-none", "absolute", "right-4", "top-4", "flex", "flex-col", "items-end", "gap-2"]) expect(cls(chips, c), c).toBe(true);
    expect([...chips.querySelectorAll("[data-slot=status]")].map((e) => e.textContent)).toEqual([WORDS.noRobot, WORDS.offline]);
  });

  it("로봇 자리를 모르면 트윈에 「클로이드 위치 모름」을 보인다", () => {
    const { unmount } = draw(screenAt(2, { robotKnown: false }));
    expect(twinPane()).toHaveTextContent(WORDS.noRobot);
    unmount();
    draw(screenAt(2));
    expect(twinPane()).not.toHaveTextContent(WORDS.noRobot);
  });

  it("연결이 끊기면 칩 「연결 끊김 · 다시 연결 중」(error)이 있고, 다시 붙거나 아직 모르면 없다", () => {
    const { rerender } = draw(screenAt(2, { connected: false }));
    const chip = [...twinPane().querySelectorAll<HTMLElement>("[data-slot=status]")].find((e) => e.textContent === WORDS.offline)!;
    expect(chip).toHaveAttribute("data-variant", "error");
    rerender(<DashboardScreen {...screenAt(2, { connected: true })} />);
    expect(twinPane()).not.toHaveTextContent(WORDS.offline);
    rerender(<DashboardScreen {...screenAt(2, { connected: null })} />);
    expect(twinPane()).not.toHaveTextContent(WORDS.offline);
  });
});

describe("대시보드 진행도 글", () => {
  it.each([1, 2, 3, 4])("%i단계: 지금 단계는 계획 단계 이름 그대로다(클로이드가 하는 중이라고 말하지 않는다)", (n) => {
    draw(screenAt(n));
    const progress = twinPane().querySelector<HTMLElement>("[data-progress]")!;
    expect(progress.querySelector("[data-slot=item-description]")).toHaveTextContent(`${n}/${PLAN.steps.length} · ${PLAN.steps[n - 1]!.label}`);
    expect(progress.textContent).not.toMatch(/중|어요/);
  });
});

describe("대시보드 승인", () => {
  it("승인·대기 글(「승인」)이 화면 어디에도 없다", () => {
    for (const p of [0, 1, 2, 3, 4].map((n) => screenAt(n)).concat([screenAt(2, { connected: false, robotKnown: false }), screenAt(0, { phone: { kind: "qr", url: PHONE_URL } })])) {
      const { unmount } = draw(p);
      expect(document.body.textContent).not.toMatch(/승인/);
      unmount();
    }
  });
});

describe("대시보드 글 크기", () => {
  /** 글 크기 class(변형 접두를 뗀 것). Tailwind 크기·px 크기·화면 너비로 커지는 토큰 크기. */
  const SIZE = /^text-(xs|sm|base|lg|xl|\dxl|\[[^\]]+\]|caption|label|body-sm|body|title-sm|title|headline|display|far)(\/\S+)?$/;
  const sizesIn = (root: Element, keep: (el: Element) => boolean = () => true) => new Set([root, ...root.querySelectorAll("*")].filter(keep).flatMap((el) =>
    (typeof el.className === "string" ? el.className : el.getAttribute("class") ?? "").split(/\s+/).map((c) => c.replace(/^.*:/, "")).filter((c) => SIZE.test(c))));

  it.each([0, 1, 2, 3, 4])("1920×1080 %i: 화면 글은 부품 원래 크기(text-xs 12px·text-sm 14px)이고 말풍선 카드 글만 text-base(16px)다: far·화면 너비로 커지는 글 크기가 없다", (n) => {
    const rect = atScreen(1920, 1080);
    try {
      draw(screenAt(n, { robotKnown: n !== 2, connected: n === 3 ? false : true }));
      const card = say();
      const outside = sizesIn(document.body, (el) => !card.contains(el));
      expect(outside.size).toBeGreaterThan(0);
      for (const c of outside) expect(["text-xs", "text-sm"], c).toContain(c);
      expect([...sizesIn(card)]).toEqual(["text-base"]);
    } finally { rect.mockRestore(); }
  });

  it.each([["qr", PHONE_URL], ["qr", ""], ["live", ""]] as const)("연결 QR 칸·상태 한 줄 글도 부품 원래 크기다(%s, 주소 %j)", (kind, url) => {
    draw(screenAt(0, { phone: { kind, url } }));
    const sizes = sizesIn(phonePane());
    expect(sizes.size).toBeGreaterThan(0);
    for (const c of sizes) expect(["text-xs", "text-sm"], c).toContain(c);
  });

  it("설정 창 글은 Dialog 제목 18px(text-[18px]/7)과 부품 원래 크기(text-xs·text-sm)뿐이다", async () => {
    draw({ ...screenAt(2), hub: HUB });
    within(mascot()).getByRole("button", { name: "설정 열기" }).click();
    const dialog = await screen.findByRole("dialog");
    for (const c of sizesIn(dialog)) expect(["text-xs", "text-sm", "text-[18px]/7"], c).toContain(c);
    expect(sizesIn(dialog).has("text-[18px]/7")).toBe(true);
  });
});
