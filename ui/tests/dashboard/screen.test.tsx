// 대시보드 화면 틀(DashboardScreen): 머리줄 막대·맨 아래 줄·오른쪽 칸 없이 트윈(지도 자리는 칸을 꽉 채운다. 할 일 진행도 알약은 없다)이 화면 전체를 쓴다.
// 그 위에 얹는 것: 오른쪽 위 비전 미니맵 「폰 카메라」(가로 16:9 영상에 마스크·이름표, 영상이 없으면 연결 QR), 오른쪽 아래 마스코트(판 없이 아래 끝을 화면 밑 선에 댄다, 누르면 설정 창),
// 마스코트 위 생각 말풍선(짧은 메시지가 카톡처럼 쌓인 목록과 그 아래 상태·판단 칩, 메시지가 없으면 숨김), 트윈 아래쪽 말풍선 카드 하나. 자리는 화면 크기로만 정해진다(layout.ts). 자료는 fixtures.ts.
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import tokens from "../../../src/design/tokens.json";
import { DashboardScreen, type ScreenProps } from "../../src/dashboard/DashboardScreen";
import { TAG_H, tagWidth } from "../../src/dashboard/detections";
import { mascotPoint, pageLayout, TALK_H, type Rect } from "../../src/dashboard/layout";
import { TALK_ROW_H } from "../../src/dashboard/TalkBox";
import { MASCOT } from "../../src/lib/mascot-image";
import { WORDS } from "../../src/dashboard/words";
import { EMPTY_DASH, reduceDash, talkOf } from "../../src/dashboard/data";
import { BRANCHES, branchDecision, coachPlanAt, type Branch } from "./fixtures";
import { EYE_FRAMES, HUB, imageSlot, MESSAGES, PHONE_URL, PLAN, REASON, screenAt, seenEvent, seenOf, TALK, TIMELINE_CLEAR, TIMELINE_NOW, TIMELINE_WATCH } from "./fixtures";
import { TIMELINE_SPAN_S } from "../../src/dashboard/TimelineCard";
import { createSeenStore } from "../../src/dashboard/masks";
import { clockText } from "../../src/dashboard/clock";
import { act } from "@testing-library/react";
import type { PlanView } from "../../../src/contract/plan.ts";
import type { ServerMessage } from "../../../src/contract/events.ts";

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
const talk = () => document.querySelector<HTMLElement>("[data-talk]")!;
const card = () => document.querySelector<HTMLElement>("[data-timeline-card]")!;
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

  it.each([[1920, 1080], [1440, 900]])("%i×%i: 트윈·폰 카메라(미니맵)·생각 말풍선·마스코트·말풍선 카드는 화면 크기로 정한 자리(layout.ts)에 놓이고 지도 자리는 트윈 칸을 꽉 채운다", (width, height) => {
    const rect = atScreen(width, height);
    try {
      draw(screenAt(2));
      const L = pageLayout({ width, height }, MASCOT);
      expect(close(boxOf(mascot()), L.mascot)).toBe(true);
      expect(close(boxOf(talk()), L.bubble)).toBe(true);
      const stage = twinPane().parentElement!;
      expect(close(boxOf(stage), L.twin)).toBe(true);
      // 미니맵은 보이는 영상(세로 눈 그림 405×720) 비율을 따른다
      expect(close(boxOf(phonePane()), pageLayout({ width, height }, MASCOT, 405 / 720).video)).toBe(true);
      expect(document.querySelector("[data-thought]")).toBeNull();
      const map = twinPane().querySelector<HTMLElement>("[data-map]")!;
      for (const c of ["absolute", "inset-0", "overflow-hidden"]) expect(cls(map, c), c).toBe(true);
      expect(map.getAttribute("style") ?? "").toBe("");
      expect(map.querySelector("canvas[data-fixture-map]")).not.toBeNull();
    } finally { rect.mockRestore(); }
  });

  it("트윈이 판 하나를 다 쓴다: 오른쪽 칸·나눔선이 없고, 폰 카메라·메시지 상자·마스코트는 그 판 밖(main 바로 아래)에서 트윈 위로 얹힌다", () => {
    const { container } = draw(screenAt(2));
    const main = container.querySelector("main")!;
    const twin = twinPane();
    const stage = twin.parentElement!;
    expect(stage.parentElement).toBe(main);
    expect(stage).toHaveAttribute("data-glass", "opaque");
    expect(stage.style.borderRadius).toBe("16px");
    expect(cls(stage, "overflow-hidden")).toBe(true);
    expect([...stage.children].filter((c) => c.tagName === "SECTION")).toEqual([twin]);
    expect(cls(twin, "flex-1")).toBe(true);
    expect(container.querySelector("[data-divider], [data-decision]")).toBeNull();
    // 시간 줄 카드는 트윈 판 밖, 메시지 상자 밖 main 바로 아래 독립 카드다
    expect(stage.querySelector("[data-timeline-card]")).toBeNull();
    expect(talk().querySelector("[data-timeline-card]")).toBeNull();
    expect(card().parentElement).toBe(main);
    for (const el of [phonePane(), talk(), mascot()]) {
      expect(el.parentElement, el.tagName).toBe(main);
      expect(stage.contains(el)).toBe(false);
      expect(before(stage, el)).toBe(true);
    }
    for (const el of [phonePane(), talk()]) {
      expect(cls(el, "pointer-events-none")).toBe(true);
      expect(cls(el, "z-50")).toBe(true);
    }
  });

  it("미니맵은 제 둥근 불투명 판(LiquidGlass) 하나다", () => {
    draw(screenAt(2));
    const glass = [...phonePane().querySelectorAll<HTMLElement>("[data-glass]")];
    expect(glass).toHaveLength(1);
    expect(glass[0]!.parentElement).toBe(phonePane());
    expect(glass[0]).toHaveAttribute("data-glass", "opaque");
    expect(glass[0]!.style.borderRadius).toBe("16px");
    expect(cls(glass[0]!, "size-full")).toBe(true);
  });

  it.each([[1920, 1080], [1440, 900]])("%i×%i: 마스코트 아래 끝은 화면 밑 선이다(빈틈 없음)", (width, height) => {
    const rect = atScreen(width, height);
    try {
      draw(screenAt(2));
      const box = boxOf(mascot());
      expect(box.top + box.height).toBeCloseTo(height, 5);
    } finally { rect.mockRestore(); }
  });

  it.each([[1920, 1080], [1440, 900]])("%i×%i: 미니맵 높이는 들어오는 영상 비율을 따른다: 가로 480×222는 너비 ÷ 비율(빈 띠 없음), 영상이 없으면(QR·빈 칸) 16:9, 세로 영상은 높이 상한까지. 너비·왼쪽·위와 다른 자리는 그대로다", (width, height) => {
    const rect = atScreen(width, height);
    try {
      const boxes = (p: ScreenProps) => {
        const { unmount } = draw(p);
        const out = { phone: boxOf(phonePane()), rest: [mascot(), talk(), twinPane().parentElement!].map((el) => el.style.cssText.replace(/(opacity|transform): [^;]+; ?/g, "")) };
        unmount();
        return out;
      };
      const at = (aspect?: number) => pageLayout({ width, height }, MASCOT, aspect).video;
      const wide = boxes(screenAt(2, { phone: { kind: "image", src: "/w.webp", width: 480, height: 222 } }));
      expect(close(wide.phone, at(480 / 222))).toBe(true);
      expect(wide.phone.height).toBeCloseTo(wide.phone.width / (480 / 222), 5);
      const tall = boxes(screenAt(2));
      expect(close(tall.phone, at(405 / 720))).toBe(true);
      expect(tall.phone.height).toBeLessThan(tall.phone.width / (405 / 720));
      for (const phone of [{ kind: "qr", url: PHONE_URL }, { kind: "none" }, { kind: "live", url: PHONE_URL }] as const) {
        const none = boxes(screenAt(2, { phone }));
        expect(close(none.phone, at()), phone.kind).toBe(true);
        expect(none.rest).toEqual(wide.rest);
      }
      expect(tall.rest).toEqual(wide.rest);
      for (const b of [tall, wide]) expect([b.phone.left, b.phone.top, b.phone.width]).toEqual([at().left, at().top, at().width]);
    } finally { rect.mockRestore(); }
  });

  it("영상 비율이 2% 안에서 흔들리면 미니맵 칸이 그대로이고, 비율이 다른 영상이 오면 높이만 바뀐다", () => {
    const rect = atScreen(1920, 1080);
    try {
      const img = (w: number, h: number) => ({ kind: "image", src: "/w.webp", width: w, height: h }) as const;
      const { rerender } = draw(screenAt(2, { phone: img(480, 222) }));
      const el = phonePane();
      const was = boxOf(el);
      rerender(<DashboardScreen {...screenAt(2, { phone: img(480, 223) })} />);
      expect(phonePane()).toBe(el);
      expect(boxOf(el)).toEqual(was);
      rerender(<DashboardScreen {...screenAt(3, { phone: img(640, 360) })} />);
      expect(phonePane()).toBe(el);
      const now = boxOf(el);
      expect([now.left, now.top, now.width]).toEqual([was.left, was.top, was.width]);
      expect(now.height).toBeCloseTo(now.width / (640 / 360), 5);
      expect(now.height).toBeGreaterThan(was.height);
    } finally { rect.mockRestore(); }
  });

  it("실시간 영상(live)은 첫 장이 오면 마지막 seen의 프레임 크기 비율을 따른다(영상 크기를 알기 전)", () => {
    const rect = atScreen(1920, 1080);
    try {
      draw(screenAt(2, { phone: { kind: "live", url: PHONE_URL }, seen: seenOf(EYE_FRAMES[0]!.boxes, { width: 480, height: 222 }) }));
      const L = (aspect?: number) => pageLayout({ width: 1920, height: 1080 }, MASCOT, aspect).video;
      expect(close(boxOf(phonePane()), L())).toBe(true);
      fireEvent.load(phonePane().querySelector<HTMLImageElement>("img")!);
      expect(close(boxOf(phonePane()), L(480 / 222))).toBe(true);
    } finally { rect.mockRestore(); }
  });

  it("단계·연결·로봇 자리와 상관없이 모든 자리(말풍선 자리 높이 포함)가 같다. 미니맵은 영상이 같으면 같다", () => {
    const rect = atScreen(1920, 1080);
    try {
      const boxes = (p: ScreenProps) => {
        const { unmount } = draw(p);
        const stage = twinPane().parentElement!;
        const out = [mascot(), talk(), stage, phonePane(), twinPane(), twinPane().querySelector<HTMLElement>("[data-map]")!].map((el) =>
          [el.style.left, el.style.top, el.style.width, el.style.height, el.className].join(" "));
        unmount();
        return out;
      };
      const first = boxes(screenAt(1));
      const variants: [string, ScreenProps][] = [
        ["0", screenAt(0)], ["2", screenAt(2)], ["3", screenAt(3)], ["4", screenAt(4)],
        ["로봇 모름", screenAt(2, { robotKnown: false })], ["연결 끊김", screenAt(2, { connected: false })], ["모양 없음", screenAt(0, { seen: seenOf(null) })],
        ["긴 줄", screenAt(2, { talk: { ...TALK, lines: MESSAGES.map((m) => ({ ...m, text: m.text.repeat(5) })) } })],
        ["목표", screenAt(2, { timeline: TIMELINE_WATCH })], ["시간 줄 없음", screenAt(2, { timeline: null })], ["줄 없음", screenAt(2, { talk: null })],
      ];
      for (const [name, p] of variants) expect(boxes(p), name).toEqual(first);
    } finally { rect.mockRestore(); }
  });
});

describe("대시보드 메시지 상자(트윈 아래쪽 하나, 생각 말풍선 없음)", () => {
  const lines = () => [...talk().querySelectorAll<HTMLElement>("[data-talk-line]")];

  it("오른쪽 생각 말풍선은 없다. 메시지 상자 하나가 트윈 아래쪽 마스코트 옆에 있고, 줄(지난 줄은 흐리게 ItemDescription, 최신 줄은 진하게 ItemTitle)과 ▼다. 오른쪽 꼬리가 마스코트를 가리킨다", () => {
    draw(screenAt(2));
    expect(document.querySelector("[data-thought], [data-say-card], [data-slot=thought-bubble], [data-talk-who]")).toBeNull();
    expect(document.querySelectorAll("[data-talk]")).toHaveLength(1);
    expect(lines().map((l) => [l.dataset.talkLine, l.getAttribute("data-slot"), l.textContent])).toEqual([
      ["old", "item-description", MESSAGES[0]!.text], ["new", "item-title", MESSAGES[1]!.text],
    ]);
    const more = talk().querySelector("[data-talk-more]")!;
    expect(more).toHaveTextContent("▼");
    expect(before(lines().at(-1)!, more)).toBe(true);
    expect(talk()).not.toHaveTextContent(REASON);
  });

  it("상자 오른쪽 꼬리가 마스코트를 가리킨다: 상자 밖 형제(마우스 받지 않음), 21st.dev Line Draw SVG 두 장(칠한 삼각형과 바깥 선), 상자 오른쪽 끝에서 시작해 상자 높이 안", () => {
    const rect = atScreen(1920, 1080);
    try {
      draw(screenAt(2));
      const L = pageLayout({ width: 1920, height: 1080 }, MASCOT);
      const tail = document.querySelector<HTMLElement>("[data-talk-tail]")!;
      expect(tail.parentElement).toBe(talk().parentElement);
      expect(cls(tail, "pointer-events-none")).toBe(true);
      expect(px(tail.style.left)).toBeCloseTo(L.bubble.left + L.bubble.width - 1, 0);
      expect(px(tail.style.top)).toBeGreaterThan(L.bubble.top);
      expect(px(tail.style.top)).toBeLessThan(L.bubble.top + L.bubble.height);
      expect(tail.querySelectorAll("svg")).toHaveLength(2);
      expect(px(tail.style.left) + 12).toBeLessThan(L.mascot.left);
    } finally { rect.mockRestore(); }
  });

  // 사용자 결정(2026-11-18): 메시지 상자 알약(상태·트리거·액션)과 목표 알약을 뺀다. 사람 상태·목표·단계의 때는 시간 줄 카드가 보인다(2026-11-19)
  it("알약(상태·트리거·액션·목표)이 없고 「배운 습관」 줄·칩·모드 글도 없다", () => {
    for (const p of [screenAt(0), screenAt(2)]) {
      const { unmount } = draw(p);
      expect(talk().querySelector("[data-talk-pill], [data-talk-habit], [data-thought-chips], [data-talk-mode]")).toBeNull();
      expect(talk()).not.toHaveTextContent(/상태 ·|트리거 ·|액션 ·|배운 습관/);
      unmount();
    }
  });

  // 사용자 바로잡음(2026-11-18): 「자동 이런 말 쓰지말고 어떤 모드인지 쓰라니까」. 모드는 마스코트 머리 위 말풍선(눈치/코치)만이고 설정 이름(「자동」)은 어디에도 없다
  it("메시지 상자에는 모드 글이 없고, 화면 어디에도 설정 이름 「자동」이 없다. 모드 말풍선은 눈치·코치 둘뿐이다", () => {
    draw(screenAt(0));
    expect(talk()).not.toHaveTextContent(/자동|모드/);
    expect(document.querySelector("[data-mode-text]")).toHaveTextContent(/^(눈치|코치) 모드$/);
    expect(document.body).not.toHaveTextContent("자동");
  });

  // 사용자 결정(2026-11-19): 「A+C가 그나마 낫네」, 「만들기, 1.6초 크게」. FSM 원 카드 자리를 시간 줄(21st.dev Timeline)이 쓴다
  // 사용자 결정(2026-11-19): 「예상을 없애자」. 줄은 사람 · 로봇 둘이다
  it("시간 줄 카드는 메시지 상자 왼쪽 자리(layout timeline)의 21st.dev Timeline이고, 사람 · 로봇 두 줄과 오른쪽 끝 「지금」 선, 초 눈금 「N초 전」이 있다. 예상 줄·목표 글이 없다. 보기만 한다", () => {
    const rect = atScreen(1920, 1080);
    try {
      draw(screenAt(2));
      const L = pageLayout({ width: 1920, height: 1080 }, MASCOT);
      expect(close(boxOf(card()), L.timeline)).toBe(true);
      expect(cls(card(), "pointer-events-none")).toBe(true);
      expect(card().querySelector("[data-slot=timeline-grid]")).not.toBeNull();
      expect([...card().querySelectorAll<HTMLElement>("[data-slot=timeline-row]")].map((r) => [r.dataset.row, r.querySelector("[data-slot=timeline-row-name]")!.textContent])).toEqual([
        ["person", "사람"], ["robot", "로봇"],
      ]);
      expect(card()).not.toHaveTextContent(/예상|준비됨|먼저/);
      expect(card().querySelector("[data-timeline-caption], [data-slot=timeline-caption]")).toBeNull();
      const now = card().querySelector<HTMLElement>("[data-slot=timeline-current-time]")!;
      expect(now).toHaveTextContent("지금");
      expect([...card().querySelectorAll("[data-slot=timeline-hour-marker]")].map((m) => m.textContent)).toEqual(["10초 전", "20초 전"]);
      // 끌어 옮기기·마우스 시각 표시가 없다
      expect(card().querySelector("[data-slot=timeline-mouse-indicator], [data-slot=timeline-drag-overlay], [data-slot=timeline-drop-ghost]")).toBeNull();
    } finally { rect.mockRestore(); }
  });

  it("구간: 사람 줄은 사람 상태, 로봇 줄은 계획 단계(지금 단계는 brand 빨강)와 지켜봄이다. 지금보다 앞 SPAN초 밖은 그리지 않는다", () => {
    draw(screenAt(2));
    const row = (id: string) => card().querySelector<HTMLElement>(`[data-slot=timeline-row][data-row=${id}]`)!;
    const slots = (id: string) => [...row(id).querySelectorAll<HTMLElement>("[data-slot=timeline-slot]")];
    expect(slots("person").map((s) => s.textContent)).toEqual(["먹거나 마시는 중", "컵을 두고 자리를 뜸"]);
    expect(slots("robot").map((s) => [s.textContent, s.dataset.tone])).toEqual([["지켜봄", "plain"], ["식탁으로 가기", "muted"], ["컵 집기", "brand"]]);
    // 보이는 때(지금에서 SPAN초 앞까지) 밖만 있는 구간은 없다
    const old = { id: "old", row: "robot" as const, from: TIMELINE_NOW - (TIMELINE_SPAN_S + 30) * 1000, to: TIMELINE_NOW - (TIMELINE_SPAN_S + 5) * 1000, text: "옛 단계", tone: "muted" as const };
    const { unmount } = draw(screenAt(0, { timeline: { ...TIMELINE_WATCH, spans: [...TIMELINE_WATCH.spans, old] } }));
    expect(document.querySelectorAll("[data-timeline-card]")[1]).not.toHaveTextContent("옛 단계");
    unmount();
  });

  // 사용자 바로잡음(2026-11-19): 「글자가 너무 크더라 초나오는거」. 22px을 빼고 부품 원래 크기(14px)에 굵기·LG 빨강으로만 띄운다
  it("사람이 떠난 때 → 첫 명령은 두 줄을 가로지르는 brand 구간과 「N.N초」(부품 원래 크기 14px, 굵게, brand 바탕)다. 간격을 모르면 없다", () => {
    draw(screenAt(2));
    const region = card().querySelector<HTMLElement>("[data-slot=timeline-drop-region]")!;
    expect(region).toHaveTextContent(TIMELINE_CLEAR.gap!.text);
    const label = region.querySelector<HTMLElement>("[data-slot=timeline-region-label]")!;
    expect(cls(label, "text-sm")).toBe(true);
    expect(cls(label, "text-[22px]")).toBe(false);
    expect(cls(label, "font-bold")).toBe(true);
    expect(cls(label, "bg-brand")).toBe(true);
    const { unmount } = draw(screenAt(0));
    expect(document.querySelectorAll("[data-timeline-card]")[1]!.querySelector("[data-slot=timeline-drop-region]")).toBeNull();
    unmount();
  });

  it("목표는 메시지 상자에 칩·글로 없다(목표 문장은 메시지 줄로만 온다). 트윈 글에도 목표가 없다", () => {
    draw(screenAt(0));
    expect(talk().querySelector("[data-goal-line], [data-talk-goal]")).toBeNull();
    expect(talk()).not.toHaveTextContent("목표 ·");
    expect(twinPane()).not.toHaveTextContent("목표");
  });

  it("첫 판단 전(timeline null)이면 시간 줄 카드가 없다(빈 틀을 두지 않는다). 옛 FSM 원 카드도 없다", () => {
    draw(screenAt(2, { timeline: null }));
    expect(document.querySelector("[data-timeline-card]")).toBeNull();
    expect(document.querySelector("[data-fsm-card], [data-fsm-state]")).toBeNull();
  });

  it("자리·크기는 layout의 메시지 상자 자리이고 줄 길이·습관 줄과 상관없이 같다. 줄은 한 줄로 자른다. 보기만 하고(마우스 받지 않음) 트윈·폰 칸보다 위다", () => {
    const rect = atScreen(1920, 1080);
    try {
      const L = pageLayout({ width: 1920, height: 1080 }, MASCOT);
      for (const p of [screenAt(0), screenAt(2), screenAt(2, { talk: { lines: MESSAGES.map((m) => ({ ...m, text: m.text.repeat(8) })) } })]) {
        const { unmount } = draw(p);
        expect(close(boxOf(talk()), L.bubble)).toBe(true);
        expect(L.bubble.height).toBe(TALK_H);
        for (const l of lines()) expect(cls(l, "truncate") || cls(l.firstElementChild as HTMLElement, "truncate")).toBe(true);
        expect(cls(talk(), "pointer-events-none")).toBe(true);
        expect(cls(talk(), "z-50")).toBe(true);
        unmount();
      }
    } finally { rect.mockRestore(); }
  });

  // 사용자 허락(2026-11-18): 「메시지박스 글씨 키워」. 문장 줄만 16px(item.tsx talk), 목표 줄은 Status 그대로
  it("21st.dev 부품으로 그린다: 판은 LiquidGlass 불투명 판, 안은 Item 대화 상자 크기(talk, 문장 줄 16px)이고 말풍선 카드 크기(say)를 쓰지 않는다. 줄 칸은 한 줄 높이 24px", () => {
    draw(screenAt(2));
    expect(talk()).toHaveAttribute("data-glass", "opaque");
    const item = talk().querySelector<HTMLElement>("[data-slot=item]")!;
    expect(item).toHaveAttribute("data-size", "talk");
    for (const l of lines()) expect(cls(l, "h-6")).toBe(true);
    expect(TALK_ROW_H).toBe(24);
    expect(talk().querySelector<HTMLElement>("[data-talk-lines]")!.parentElement!.style.height).toBe(`${3 * 24 + 2 * 4}px`);
  });

  it("줄이 없으면(talk null) 상자는 그대로 두고 줄이 없다(시간 줄 카드는 그대로)", () => {
    draw(screenAt(2, { talk: null }));
    expect(talk().querySelector("[data-talk-mode], [data-talk-pill]")).toBeNull();
    expect(lines()).toEqual([]);
    expect(document.querySelector("[data-timeline-card]")).not.toBeNull();
  });
});

describe("마스코트 머리 위 모드 말풍선", () => {
  const bubble = () => document.querySelector<HTMLElement>("[data-mode-bubble]");
  const content = () => bubble()?.querySelector<HTMLElement>("[data-slot=tooltip-content]") ?? null;
  const text = () => bubble()?.querySelector<HTMLElement>("[data-mode-text]") ?? null;

  it("지금 행동이 눈치 모드면 brand 색(tone noonchi), 코치 모드면 초록(tone coach) 말풍선이고 화살표(꼬리)가 있다. 대기(모드 없음)도 지금 모드인 눈치 모드다", () => {
    const { rerender } = draw(screenAt(2));
    expect(text()).toHaveTextContent(/^눈치 모드$/);
    expect(content()).toHaveAttribute("data-tone", "noonchi");
    expect(bubble()!.querySelector("[data-slot=tooltip-arrow]")).not.toBeNull();
    rerender(<DashboardScreen {...screenAt(2, { mode: "coach" })} />);
    expect(text()).toHaveTextContent(/^코치 모드$/);
    expect(content()).toHaveAttribute("data-tone", "coach");
    rerender(<DashboardScreen {...screenAt(0)} />);
    expect(text()).toHaveTextContent(/^눈치 모드$/);
  });

  it("말풍선 끝은 마스코트 머리 바로 위(늘 왼쪽을 보는 그림의 머리 가운데)에 있고 마우스를 받지 않는다. 메시지 상자에는 모드 글이 없다", () => {
    const rect = atScreen(1920, 1080);
    try {
      draw(screenAt(2));
      const L = pageLayout({ width: 1920, height: 1080 }, MASCOT);
      const anchor = bubble()!;
      const x = parseFloat(anchor.style.left);
      const y = parseFloat(anchor.style.top);
      const head = mascotPoint(L, MASCOT, MASCOT.headTop);
      // 그림이 왼쪽을 보도록 단추 가운데 축으로 뒤집혔다
      expect(Math.abs(x - (2 * (L.mascot.left + L.mascot.width / 2) - head.x))).toBeLessThan(1);
      expect(y).toBeLessThanOrEqual(head.y);
      expect(y).toBeGreaterThan(head.y - 24);
      expect(cls(anchor, "pointer-events-none")).toBe(true);
      expect(talk().querySelector("[data-talk-mode]")).toBeNull();
      expect(talk()).not.toHaveTextContent(/모드/);
    } finally { rect.mockRestore(); }
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

  // 사용자 결정(2026-11-18): 마스코트는 대기·행동과 상관없이 늘 왼쪽(메시지 상자·트윈 쪽)을 본다
  it("지켜보기에서 계획이 생겨도 마스코트는 같은 그림으로 늘 왼쪽을 보고 자리·크기가 그대로다", () => {
    const { container, rerender } = draw(screenAt(0));
    const [m, turn] = [mascot(), turnOf()];
    const box = [m.style.left, m.style.top, m.style.width, m.style.height].join(" ");
    expect(container.querySelector("main")).toHaveAttribute("data-step", "0");
    expect(transformOf(turn)).toBe("scaleX(-1)");
    rerender(<DashboardScreen {...screenAt(1)} />);
    expect(container.querySelector("main")).toHaveAttribute("data-step", "1");
    expect(mascot()).toBe(m);
    expect(turnOf()).toBe(turn);
    expect(transformOf(turn)).toBe("scaleX(-1)");
    expect(m).not.toHaveAttribute("data-facing");
    expect([m.style.left, m.style.top, m.style.width, m.style.height].join(" ")).toBe(box);
  });

  it.each([0, 1, 2, 3, 4])("%i: 마스코트는 늘 좌우를 뒤집어 왼쪽을 본다. 뒤집기는 단추 가운데 축(나눔선)을 중심으로 한 transform이다", (n) => {
    draw(screenAt(n));
    const turn = turnOf();
    expect(transformOf(turn)).toBe("scaleX(-1)");
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
  // 1920×1080 화면의 미니맵 영상 칸 크기(layout.ts, 16:9). jsdom은 0을 준다.
  const SLOT = { width: 600, height: 337.5 };
  let rect: ReturnType<typeof vi.spyOn>;
  beforeEach(() => { rect = atScreen(SLOT.width, SLOT.height); });
  afterEach(() => rect.mockRestore());
  const slotOf = (phone: HTMLElement) => phone.querySelector<HTMLElement>("[data-video]")!;
  const qrOf = () => within(slotOf(phonePane())).queryByRole("img", { name: "폰 연결 QR" });

  it("영상 칸은 폰 카메라 칸(가로 16:9)을 다 채우고, 영상은 잘리지 않게 다 보인다(contain: 세로 영상이면 양옆을 비운다)", () => {
    draw(screenAt(3));
    const slot = slotOf(phonePane());
    expect(cls(slot, "size-full")).toBe(true);
    expect(cls(slot, "overflow-hidden")).toBe(true);
    const img = slot.querySelector("img")!;
    expect(img.getAttribute("src")).toBe("/debug-eye/eye-table-far.webp");
    expect(cls(img, "object-contain")).toBe(true);
    expect(img.className).not.toMatch(/object-cover/);
  });

  it.each([0, 1, 4])("%i: FSM·행동 카드가 없다(생각 말풍선으로 옮겼다): 영상 칸에는 영상·마스크·이름표뿐이다", (n) => {
    draw(screenAt(n));
    const phone = phonePane();
    expect(phone.querySelector("[data-fsm-card], [data-decision], [data-fsm], [data-action], [data-slot=item]")).toBeNull();
    expect(phone).not.toHaveTextContent(/FSM|행동|판단|상태/);
  });

  it.each(EYE_FRAMES.map((f) => [f.id, f] as const))("%s: 네모 상자 없이 마스크 canvas 한 장과 이름표만 있고, 이름표는 영상 칸 안에 다 들어와 이름만 보인다(확신 숫자 없음)", (_, f) => {
    draw(screenAt(2, { phone: imageSlot(f.id), seen: seenOf(f.boxes, { width: f.width, height: f.height }) }));
    const slot = slotOf(phonePane());
    const roof = 0;
    expect(slot.querySelectorAll('[data-detection], [data-slot="bounding-box"]')).toHaveLength(0);
    expect(slot.querySelectorAll("canvas[data-masks]")).toHaveLength(1);
    const tags = [...slot.querySelectorAll<HTMLElement>("[data-detection-label]")];
    // 확신 숫자는 개발용 보기(?scores=1)에서만 보인다
    expect(tags.map((t) => t.textContent)).toEqual(f.boxes.map((d) => d.label));
    for (const t of tags) {
      expect(px(t.style.left)).toBeGreaterThanOrEqual(0);
      expect(px(t.style.top)).toBeGreaterThanOrEqual(roof);
      expect(px(t.style.top) + TAG_H).toBeLessThanOrEqual(SLOT.height);
      expect(px(t.style.left) + tagWidth(t.textContent!.split(" ")[0]!)).toBeLessThanOrEqual(SLOT.width);
    }
  });

  it("모양(seen)이 아직 없으면 마스크 canvas만 있고 이름표가 없다. 영상이 안 보이면(live 첫 장 전·QR) canvas도 없다", () => {
    draw(screenAt(2, { seen: seenOf(null) })).unmount();
    const empty = draw(screenAt(2, { seen: seenOf(null) }));
    expect(slotOf(phonePane()).querySelectorAll("canvas[data-masks]")).toHaveLength(1);
    expect(slotOf(phonePane()).querySelectorAll("[data-detection-label]")).toHaveLength(0);
    empty.unmount();
    for (const phone of [{ kind: "live", url: PHONE_URL }, { kind: "qr", url: PHONE_URL }] as const) {
      const view = draw(screenAt(2, { phone }));
      expect(phonePane().querySelectorAll("canvas[data-masks], [data-detection-label]")).toHaveLength(0);
      view.unmount();
    }
  });

  it("네모 테두리를 그리지 않는다: 마스크는 꾸밈 없는 canvas 한 장에 칠하고, 이름표 말고는 영상 위에 테두리 선이 없다", () => {
    draw(screenAt(1, { seen: seenOf(EYE_FRAMES[0]!.boxes) }));
    const slot = slotOf(phonePane());
    expect(slot.querySelectorAll('[data-detection], [data-slot="bounding-box"]')).toHaveLength(0);
    const canvas = slot.querySelector<HTMLCanvasElement>("canvas[data-masks]")!;
    expect(canvas.className).toBe("absolute inset-0 size-full");
    expect(canvas.getAttribute("style")).toBeNull();
    const lined = [...slot.querySelectorAll<HTMLElement>("*")].filter((e) => e.style.borderStyle === "solid" || /solid/.test(e.style.border));
    expect(lined).toEqual([]);
  });

  it("마스크는 영상과 같은 자리에 칠한다: 모양마다 한 번 그리고, 새 seen이 오면 다시 그리며, 600ms 넘게 안 오면 마스크와 이름표를 지운다", () => {
    vi.useFakeTimers();
    const drawn: number[][] = [];
    const cleared: number[] = [];
    const ctx = {
      globalAlpha: 1, imageSmoothingEnabled: false,
      setTransform() {}, save() {}, restore() {}, beginPath() {}, rect() {}, clip() {}, putImageData() {},
      clearRect() { cleared.push(drawn.length); },
      createImageData: (w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h }),
      drawImage: (_s: unknown, ...a: number[]) => { drawn.push(a); },
    };
    const getContext = vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation((() => ctx) as never);
    try {
      const store = createSeenStore();
      const f = EYE_FRAMES[0]!;
      act(() => store.set(seenEvent(f.boxes)));
      draw(screenAt(2, { seen: store }));
      const slot = slotOf(phonePane());
      expect(drawn).toHaveLength(2);
      // 컵 [168, 332, 192, 357]: 영상 칸에 contain으로 놓인 그림과 같은 배율·자리
      const scale = Math.min(SLOT.width / f.width, SLOT.height / f.height);
      const left = (SLOT.width - f.width * scale) / 2, top = (SLOT.height - f.height * scale) / 2;
      const cup = drawn[1]!;
      expect(cup[0]).toBeCloseTo(left + 168 * scale, 3);
      expect(cup[1]).toBeCloseTo(top + 332 * scale, 3);
      expect(cup[2]).toBeCloseTo(24 * scale, 3);
      expect(cup[3]).toBeCloseTo(25 * scale, 3);
      expect(slot.querySelectorAll("[data-detection-label]")).toHaveLength(2);
      act(() => { vi.advanceTimersByTime(500); store.set(seenEvent([f.boxes[1]!])); });
      expect(drawn).toHaveLength(3);
      expect(slot.querySelectorAll("[data-detection-label]")).toHaveLength(1);
      act(() => { vi.advanceTimersByTime(601); });
      expect(slot.querySelectorAll("[data-detection-label]")).toHaveLength(0);
      expect(drawn).toHaveLength(3);
      expect(cleared.at(-1)).toBe(3); // 마지막에 한 번 더 지웠다
    } finally {
      getContext.mockRestore();
      vi.useRealTimers();
    }
  });

  it("YOLO 이름표는 폰 영상 이름표 토큰(twin.phoneFocus labelBg·labelText) 색이고 Status 원래 크기(text-xs)다", () => {
    draw(screenAt(1, { seen: seenOf(EYE_FRAMES[0]!.boxes) }));
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

  it("영상이 없으면(qr) 영상·마스크 대신 영상 칸 자리에 영상 칸에 맞춘 연결 QR을 보인다: 가로 칸이라 QR과 할 일·주소를 옆으로 나란히 둔다", () => {
    draw(screenAt(3, { phone: { kind: "qr", url: PHONE_URL } }));
    const phone = phonePane();
    expect(phone.querySelector("img")).toBeNull();
    expect(phone.querySelector("[data-detection-label], canvas[data-masks]")).toBeNull();
    const slot = slotOf(phone);
    const qr = within(slot).getByRole("img", { name: "폰 연결 QR" });
    expect(Number(qr.getAttribute("width"))).toBe(Math.floor(Math.min(SLOT.width, SLOT.height) - 48));
    const row = qr.parentElement!;
    expect(cls(row, "flex")).toBe(true);
    expect(cls(row, "flex-col")).toBe(false);
    expect(slot).toHaveTextContent("폰 카메라로 찍으세요");
    expect(slot).toHaveTextContent(PHONE_URL);
  });

  it("폰 서버가 꺼져 있고(qr) 폰 주소가 없으면 QR 대신 영상 칸에 「폰 서버가 꺼져 있어요.」 한 줄(Item sm)만 보인다", () => {
    draw(screenAt(3, { phone: { kind: "qr", url: "" } }));
    expect(qrOf()).toBeNull();
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
    expect(slot.querySelector("canvas[data-masks]")).not.toBeNull();
  });

  it("health 전(none)에는 영상 칸이 비어 있다", () => {
    draw(screenAt(1, { phone: { kind: "none" } }));
    const slot = slotOf(phonePane());
    expect(slot.textContent).toBe("");
    expect(slot.querySelector("img")).toBeNull();
    expect(qrOf()).toBeNull();
  });

  it("폰 서버가 켜져 있으면(live) 첫 장 전에는 연결 QR만 있고 마스크·이름표가 없다. 영상 그림에 첫 장이 오면 QR이 없어지고 마스크·이름표가 보인다", () => {
    draw(screenAt(1, { phone: { kind: "live", url: PHONE_URL } }));
    const slot = slotOf(phonePane());
    const img = slot.querySelector<HTMLImageElement>("img")!;
    expect(img.getAttribute("src")).toMatch(/^\/api\/eye\/stream\?t=\d+$/);
    expect(cls(img, "object-contain")).toBe(true);
    expect(cls(img, "size-full")).toBe(true);
    expect(qrOf()).not.toBeNull();
    expect(slot.querySelector("canvas[data-masks], [data-detection-label]")).toBeNull();
    fireEvent.load(img);
    expect(slot.querySelector("img")).toBe(img);
    expect(qrOf()).toBeNull();
    expect(slot.querySelectorAll("canvas[data-masks]")).toHaveLength(1);
    expect(slot.querySelectorAll("[data-detection-label]")).toHaveLength(1);
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
  // 사용자 결정(2026-11-18): 왼쪽 위 계획 글·진행 막대 알약을 뺀다(계획은 트윈 위 번호 길). 로봇 상태 줄(대기·관찰·이동·실행·복귀)도 두지 않는다
  it("할 일 진행도 알약(할 일·단계 번호·단계 막대)과 로봇 상태 줄이 화면 어디에도 없다", () => {
    for (const p of [screenAt(0), screenAt(2), screenAt(4, { plan: coachPlanAt(4), step: coachPlanAt(4).steps[3]! })]) {
      const { unmount } = draw(p);
      expect(document.querySelector("[data-progress], [data-predraw], [data-segment]")).toBeNull();
      expect(twinPane()).not.toHaveTextContent(/\d+\/\d+ ·/);
      expect(document.body).not.toHaveTextContent(/대기 · 관찰|이동 · 실행|실행 · 복귀/);
      unmount();
    }
  });

  it("지도는 트윈 칸 전체(data-map)에 그리고, 칩은 트윈 위쪽 미니맵 왼쪽에 지도 위로 쌓는다(미니맵에 가리지 않는다)", () => {
    const rect = atScreen(1920, 1080);
    try {
      draw(screenAt(2, { robotKnown: false, connected: false }));
      const L = pageLayout({ width: 1920, height: 1080 }, MASCOT);
      const twin = twinPane();
      const map = twin.querySelector<HTMLElement>("[data-map]")!;
      for (const c of ["absolute", "inset-0", "overflow-hidden"]) expect(cls(map, c), c).toBe(true);
      const chips = twin.querySelector<HTMLElement>("[data-chips]")!;
      expect(map.contains(chips)).toBe(false);
      for (const c of ["pointer-events-none", "absolute", "top-4", "flex", "flex-col", "items-end", "gap-2"]) expect(cls(chips, c), c).toBe(true);
      expect(cls(chips, "right-4")).toBe(false);
      expect(px(chips.style.right)).toBeCloseTo(L.chipsRight, 5);
      expect(L.twin.left + L.twin.width - L.chipsRight).toBeLessThan(L.video.left);
      expect([...chips.querySelectorAll("[data-slot=status]")].slice(1).map((e) => e.textContent)).toEqual([WORDS.noRobot, WORDS.offline]);
    } finally { rect.mockRestore(); }
  });

  it("트윈 오른쪽 위 칩 줄 맨 위에 날짜·시간 칩(Status)을 늘 둔다: 서버 기록 시간대(tzMinutes)로 「11월 17일 (화) 01:30」 꼴이고, 분이 바뀔 때만 그 칩만 다시 그린다(지도·트윈 칸은 다시 그리지 않는다)", () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    try {
      vi.setSystemTime(Date.UTC(2026, 10, 16, 16, 30, 59));
      let draws = 0;
      const map = () => { draws++; return null; };
      draw({ ...screenAt(2), map, tzMinutes: 540 });
      const chips = twinPane().querySelector<HTMLElement>("[data-chips]")!;
      const clock = chips.querySelector<HTMLElement>("[data-clock]")!;
      expect(chips.firstElementChild).toBe(clock);
      expect([clock.dataset.slot, clock.dataset.variant]).toEqual(["status", "default"]);
      expect(clock).toHaveTextContent("11월 17일 (화) 01:30");
      expect(chips.querySelectorAll("[data-slot=status]")).toHaveLength(1);
      const was = draws;
      act(() => { vi.advanceTimersByTime(500); });
      expect(clock).toHaveTextContent("11월 17일 (화) 01:30");
      act(() => { vi.advanceTimersByTime(600); });
      expect(clock).toHaveTextContent("11월 17일 (화) 01:31");
      act(() => { vi.advanceTimersByTime(60_000); });
      expect(clock).toHaveTextContent("11월 17일 (화) 01:32");
      expect(draws).toBe(was);
    } finally { vi.useRealTimers(); }
  });

  it("기록 시간대를 모르면(tzMinutes 없음) 브라우저 시간대로 쓴다", () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    try {
      const at = Date.UTC(2026, 10, 16, 16, 30, 0);
      vi.setSystemTime(at);
      draw(screenAt(2));
      expect(twinPane().querySelector("[data-clock]")).toHaveTextContent(clockText(at, -new Date(at).getTimezoneOffset()));
    } finally { vi.useRealTimers(); }
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

  // 사용자 허락(2026-11-18): 「메시지박스 글씨 키워」. 메시지 상자 문장 줄만 16px(Item talk), 그 밖은 부품 원래 크기
  // 사용자 바로잡음(2026-11-19): 「글자가 너무 크더라 초나오는거」. 시간 줄 반응 간격 숫자도 부품 원래 크기
  it.each([0, 1, 2, 3, 4])("1920×1080 %i: 화면 글은 부품 원래 크기(text-xs 12px·text-sm 14px)다. 메시지 상자만 사용자가 허락한 16px(Item talk)가 있다. far·화면 너비로 커지는 글 크기가 없다", (n) => {
    const rect = atScreen(1920, 1080);
    try {
      draw(screenAt(n, { robotKnown: n !== 2, connected: n === 3 ? false : true }));
      const box = talk();
      const all = sizesIn(document.body, (el) => !box.contains(el));
      expect(all.size).toBeGreaterThan(0);
      for (const c of all) expect(["text-xs", "text-sm"], c).toContain(c);
      const inBox = sizesIn(box);
      for (const c of inBox) expect(["text-xs", "text-sm", "text-base"], c).toContain(c);
      expect(inBox.has("text-base")).toBe(true);
      expect(box.querySelector("[data-slot=item]")).toHaveAttribute("data-size", "talk");
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
