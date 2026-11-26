// 대시보드 화면 틀(DashboardScreen): 기본 라이브 보기는 세 칸(Vision 16:9 위·트윈 아래 왼쪽 열, 오른쪽 Agent Trace)이고 화면에 설정 단추가 없다(Ctrl+1).
// 폰 카메라 칸(영상·마스크·이름표, 영상이 없으면 연결 QR), 트윈 칸(지도·칩), 글 크기를 본다. 배치 자리는 bento.test.tsx, 자료는 fixtures.ts.
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import tokens from "../../../src/design/tokens.json";
import { DashboardScreen, type ScreenProps } from "../../src/dashboard/DashboardScreen";
import { TAG_H, tagWidth } from "../../src/dashboard/detections";
import { type Rect } from "../../src/dashboard/layout";
import { sceneLayout } from "../../src/dashboard/bento-layout";
import { MASCOT } from "../../src/lib/mascot-image";
import { WORDS } from "../../src/dashboard/words";
import { coachPlanAt } from "./fixtures";
import { EYE_FRAMES, HUB, imageSlot, PHONE_URL, PLAN, screenAt, seenEvent, seenOf } from "./fixtures";
import { createSeenStore } from "../../src/dashboard/masks";
import { clockText } from "../../src/dashboard/clock";
import { act } from "@testing-library/react";


const phonePane = () => screen.getByRole("region", { name: "폰 카메라" });
const twinPane = () => screen.getByRole("region", { name: "트윈" });
/** class 하나가 있는지(변형 접두·대괄호 값 포함 그대로). */
const cls = (el: Element, name: string) => el.className.split(/\s+/).includes(name);
const px = (v: string) => Number.parseFloat(v);
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
      // 컵 [168, 102, 192, 127]: 영상 칸에 contain으로 놓인 그림과 같은 배율·자리
      const scale = Math.min(SLOT.width / f.width, SLOT.height / f.height);
      const left = (SLOT.width - f.width * scale) / 2, top = (SLOT.height - f.height * scale) / 2;
      const cup = drawn[1]!;
      expect(cup[0]).toBeCloseTo(left + 168 * scale, 3);
      expect(cup[1]).toBeCloseTo(top + 102 * scale, 3);
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
    expect(slot).toHaveTextContent("NOONCHI 앱으로 스캔해 서버에 연결하세요");
    expect(slot).toHaveTextContent(PHONE_URL);
  });

  it("앱에 연결할 HTTPS 주소가 없으면 QR 대신 영상 칸에 안내 한 줄(Item sm)만 보인다", () => {
    draw(screenAt(3, { phone: { kind: "qr", url: "" } }));
    expect(qrOf()).toBeNull();
    const slot = slotOf(phonePane());
    expect(slot.textContent).toBe("앱에 연결할 HTTPS 주소가 없어요.");
    expect(within(slot).getByText("앱에 연결할 HTTPS 주소가 없어요.").closest("[data-slot=item]")).toHaveAttribute("data-size", "sm");
  });

  it("폰 서버는 켜졌는데(live) 폰 주소가 없으면 첫 장 전에 「폰에서 AR을 시작하세요.」 한 줄을 보이고, 첫 장이 오면 없앤다", () => {
    draw(screenAt(1, { phone: { kind: "live", url: "" } }));
    const slot = slotOf(phonePane());
    expect(qrOf()).toBeNull();
    expect(slot).toHaveTextContent("폰에서 AR을 시작하세요.");
    expect(within(slot).getByText("폰에서 AR을 시작하세요.").closest("[data-slot=item]")).toHaveAttribute("data-size", "sm");
    expect(slot).not.toHaveTextContent("앱에 연결할 HTTPS 주소가 없어요.");
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

  it("지도는 트윈 칸 전체(data-map)에 그리고, 칩은 트윈 칸 오른쪽 아래에 지도 위로 한 줄로 둔다", () => {
    const rect = atScreen(1920, 1080);
    try {
      draw(screenAt(2, { robotKnown: false, connected: false }));
      const L = sceneLayout({ width: 1920, height: 1080 }, MASCOT);
      const twin = twinPane();
      const map = twin.querySelector<HTMLElement>("[data-map]")!;
      for (const c of ["absolute", "inset-0", "overflow-hidden"]) expect(cls(map, c), c).toBe(true);
      const chips = twin.querySelector<HTMLElement>("[data-chips]")!;
      expect(map.contains(chips)).toBe(false);
      for (const c of ["pointer-events-none", "absolute", "bottom-2", "flex", "flex-wrap", "justify-end", "gap-1"]) expect(cls(chips, c), c).toBe(true);
      expect(px(chips.style.right)).toBeCloseTo(L.chipsRight, 5);
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
  /** 받은 트레이스 부품 파일(ui/src/components/ui/trace-group·conversation·scroll-to-bottom·status)에 적힌 원래 글 크기. */
  const TRACE_PART_SIZES = ["text-xs", "text-sm", "text-base", "text-[0.75rem]", "text-[0.8125rem]", "text-[0.875rem]", "text-[13px]"];
  /** 글 크기 class(변형 접두를 뗀 것). Tailwind 크기·px 크기·화면 너비로 커지는 토큰 크기. */
  const SIZE = /^text-(xs|sm|base|lg|xl|\dxl|\[[^\]]+\]|caption|label|body-sm|body|title-sm|title|headline|display|far)(\/\S+)?$/;
  const sizesIn = (root: Element, keep: (el: Element) => boolean = () => true) => new Set([root, ...root.querySelectorAll("*")].filter(keep).flatMap((el) =>
    (typeof el.className === "string" ? el.className : el.getAttribute("class") ?? "").split(/\s+/).map((c) => c.replace(/^.*:/, "")).filter((c) => SIZE.test(c))));

  it.each([0, 1, 2, 3, 4])("1920×1080 %i: 화면 글은 부품 원래 크기다(text-xs 12px·text-sm 14px, 트레이스 부품의 원래 크기). far·화면 너비로 커지는 글 크기가 없다", (n) => {
    const rect = atScreen(1920, 1080);
    try {
      draw(screenAt(n, { robotKnown: n !== 2, connected: n === 3 ? false : true }));
      // Agent Trace 칸 안은 받은 트레이스 부품(Conversation·Trace Group·Scroll To Bottom)의 원래 크기, 그 밖은 text-xs·text-sm
      const trace = screen.getByRole("group", { name: "Agent Trace" });
      const all = sizesIn(document.body, (el) => !trace.contains(el));
      expect(all.size).toBeGreaterThan(0);
      for (const c of all) expect(["text-xs", "text-sm"], c).toContain(c);
      for (const c of sizesIn(trace)) expect(TRACE_PART_SIZES, c).toContain(c.replace(/\/.*$/, ""));
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
    fireEvent.keyDown(window, { key: "1", code: "Digit1", ctrlKey: true });
    const dialog = await screen.findByRole("dialog");
    for (const c of sizesIn(dialog)) expect(["text-xs", "text-sm", "text-[18px]/7"], c).toContain(c);
    expect(sizesIn(dialog).has("text-[18px]/7")).toBe(true);
  });
});
