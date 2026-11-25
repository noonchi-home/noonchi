import { fireEvent, render, screen, within } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { TraceRow } from "../../../src/contract/trace.ts";
import { DashboardScreen, type ScreenProps } from "../../src/dashboard/DashboardScreen";
import { screenAt } from "./fixtures";

afterEach(() => vi.restoreAllMocks());

const names = ["Vision", "Digital Twin", "Agent Trace"];
const panel = (name: string) => screen.getByRole("group", { name });
const base = {
  activity_id: "home:a1", rev: 1, refs: {},
  started_ms: 100, ended_ms: 250, state: "done",
} as const satisfies Omit<TraceRow, "id" | "kind" | "name" | "input" | "output">;
const attempt = { boot: "boot", homeEpoch: "home", attemptId: "pam-3", gen: 1 };
const picking: TraceRow = {
  ...base, id: "home:2", kind: "EXECUTION", name: "집기 안내", input: "컵 2 · 식탁", output: "시연자 수행 대기",
  refs: { plan_id: "cup", step_id: "cup:2", object_id: "cup", attempt }, state: "pending", started_ms: 300, ended_ms: null,
};
const scene = (over: Partial<ScreenProps> = {}) => screenAt(2, { command: "컵을 들어 주세요.", trace: [], ...over });
const ctrl1 = (over: Partial<KeyboardEventInit> = {}) => fireEvent.keyDown(window, { key: "1", code: "Digit1", ctrlKey: true, ...over });

function size(width: number, height: number) {
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(DOMRect.fromRect({ width, height }));
}

function box(name: string) {
  const { left, top, width, height } = panel(name).style;
  return { x: parseFloat(left), y: parseFloat(top), w: parseFloat(width), h: parseFloat(height) };
}

describe("장면 중심 대시보드", () => {
  it("세 제목은 흰 글씨와 브랜드 빨강 토큰을 쓰고 영상마다 테두리는 한 겹이다", () => {
    size(1440, 900);
    render(<DashboardScreen {...scene()} />);
    for (const name of names) expect(panel(name).firstElementChild).toHaveAttribute("data-scene-legend");
    const css = (name: string) => readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), "../../src", `${name}.css`), "utf8");
    const styles = css("styles"), tokens = css("tokens");
    expect(styles).toMatch(/\[data-scene-legend\]\s*\{[^}]*background:\s*var\(--brand-portal\)[^}]*color:\s*var\(--on-brand\)/s);
    expect(styles).toMatch(/\[data-scene-panel\]\s*\{[^}]*border:\s*1px solid var\(--line\)/s);
    expect(tokens).toContain("--brand-portal: #a50034");
    expect(tokens).toContain("--on-brand: #ffffff");
  });

  // 2026-11-25 사용자 확인 배치 시안(work/dashboard-sketch/layout.html): 왼쪽 열 55%, Vision 16:9 위·트윈 아래, 오른쪽 Agent Trace 전체 높이, 여백·칸 사이 16
  it.each([[1280, 720], [1440, 900], [1920, 1080]])(
    "%d×%d: 왼쪽 열에 Vision(16:9) 위·트윈 아래, 오른쪽에 Agent Trace를 화면 높이 전체로 두고 다음 단계에서도 칸·미디어를 유지한다",
    (width, height) => {
      size(width, height);
      const mounted = render(<DashboardScreen {...scene()} />);
      const phone = box("Vision"), twin = box("Digital Twin"), trace = box("Agent Trace");
      expect([...document.querySelectorAll("fieldset > legend")].map(e => e.textContent)).toEqual(names);
      expect([twin.x, twin.w]).toEqual([phone.x, phone.w]);
      expect(twin.y).toBe(phone.y + phone.h + 16);
      expect(Math.abs(phone.h - (phone.w * 9) / 16)).toBeLessThanOrEqual(1);
      expect(phone.w / (phone.w + trace.w)).toBeCloseTo(0.55, 2);
      expect(trace.x).toBe(phone.x + phone.w + 16);
      expect(trace.y).toBe(phone.y);
      expect(trace.y + trace.h).toBe(twin.y + twin.h);
      expect([phone.x, phone.y, width - trace.x - trace.w, height - twin.y - twin.h]).toEqual([16, 16, 16, 16]);
      const camera = screen.getByRole("region", { name: "폰 카메라" });
      mounted.rerender(<DashboardScreen {...scene(screenAt(3))} />);
      expect(screen.getByRole("region", { name: "폰 카메라" })).toBe(camera);
      expect(box("Vision")).toEqual(phone);
      expect(box("Digital Twin")).toEqual(twin);
    },
  );

  it("1920×1080은 배치 시안 자리 그대로다", () => {
    size(1920, 1080);
    render(<DashboardScreen {...scene()} />);
    expect(names.map(box)).toEqual([
      { x: 16, y: 16, w: 1030, h: 579 }, { x: 16, y: 611, w: 1030, h: 453 }, { x: 1062, y: 16, w: 842, h: 1048 },
    ]);
  });

  it.each([[1280, 720, 1280, 720], [1440, 900, 720, 1280], [1920, 1080, 405, 720]])(
    "%d×%d에서 %d×%d 영상이 와도 Vision 칸은 16:9 그대로다(영상은 칸 안에 맞춘다)",
    (width, height, fw, fh) => {
      size(width, height);
      const mounted = render(<DashboardScreen {...scene()} />);
      const before = box("Vision");
      mounted.rerender(<DashboardScreen {...scene({ phone: { kind: "image", src: "/sample.png", width: fw, height: fh } })} />);
      expect(box("Vision")).toEqual(before);
      expect(Math.abs(before.h - (before.w * 9) / 16)).toBeLessThanOrEqual(1);
    },
  );

  it("390px에서 세 칸을 Vision → 트윈 → Agent Trace 차례로 세로로 읽고 폰 명령·QR을 쓸 수 있다", () => {
    size(390, 740);
    vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockImplementation(function (this: HTMLElement) {
      return this.tagName === "MAIN" ? 373 : 0;
    });
    const url = "https://hub.example.ts.net/mobile/";
    const mounted = render(<DashboardScreen {...scene({ phone: { kind: "qr", url } })} />);
    const rectangles = names.map(box);
    for (const [index, rect] of rectangles.entries()) {
      expect(rect.x + rect.w).toBeLessThanOrEqual(373);
      if (index > 0) expect(rect.y).toBeGreaterThan(rectangles[index - 1]!.y + rectangles[index - 1]!.h);
    }
    expect(Math.abs(rectangles[0]!.h - (rectangles[0]!.w * 9) / 16)).toBeLessThanOrEqual(1);
    expect(document.querySelector("main")).toHaveClass("overflow-y-auto");
    expect(within(panel("Vision")).getByRole("img", { name: "폰 연결 QR" })).toBeVisible();
    expect(within(panel("Vision")).getByText(url)).toBeVisible();
    mounted.rerender(<DashboardScreen {...scene()} />);
    expect(screen.getByText("컵을 들어 주세요.").closest("[data-video]")).not.toBeNull();
    expect(screen.queryByRole("button", { name: "연결" })).toBeNull();
  });

  // 2026-11-25 사용자 결정: 설정 창은 화면에 단추를 두지 않고 Ctrl+1로만 연다
  it("화면에 설정 단추·마스코트·「집 전체」 링크가 없고, Ctrl+1이면 설정 창이 열리며 Esc로 닫힌다. 다른 조합키를 더한 1은 열지 않는다", () => {
    size(1920, 1080);
    render(<DashboardScreen {...scene()} />);
    expect(screen.queryByRole("button", { name: "설정 열기" })).toBeNull();
    expect(screen.queryByRole("region", { name: "마스코트" })).toBeNull();
    expect(screen.queryByRole("link")).toBeNull();
    for (const extra of [{ shiftKey: true }, { altKey: true }, { ctrlKey: false }, { metaKey: true }]) {
      ctrl1(extra);
      expect(screen.queryByRole("dialog"), JSON.stringify(extra)).toBeNull();
    }
    ctrl1();
    expect(screen.getByRole("dialog", { name: "설정" })).toBeVisible();
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape", code: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    ctrl1({ key: "1", code: "Numpad1" });
    expect(screen.getByRole("dialog", { name: "설정" })).toBeVisible();
  });

  it("폰 연결을 모르는 첫 화면에는 QR과 폰 명령을 만들지 않는다", () => {
    size(390, 340);
    render(<DashboardScreen {...scene({ phone: { kind: "none" }, connected: null, command: null, plan: null, step: null })} />);
    const vision = within(panel("Vision"));
    expect(vision.queryByRole("img", { name: "폰 연결 QR" })).toBeNull();
    expect(vision.queryByText("컵을 들어 주세요.")).toBeNull();
  });

  // 2026-11-25 시연 의견 5: 트레이스 칸에서 지금 트윈에 그린 줄에 같은 색 점을 붙여 두 칸을 잇는다
  it("지금 트윈에 그린 줄(onTwin)에는 data-on-twin과 트윈 표시와 같은 색 점(Status)이 있고, 그 밖의 줄에는 없다", () => {
    size(1440, 900);
    const placed: TraceRow = { ...base, id: "home:3", kind: "EXECUTION", name: "배치 안내", input: "컵 · 싱크대", output: "배치 확인" };
    render(<DashboardScreen {...scene({ trace: [picking, placed], onTwin: new Map([["home:2", "brand"]]) })} />);
    const rows = Array.from(panel("Agent Trace").querySelectorAll<HTMLElement>("[data-row]"));
    const on = rows.filter(r => r.hasAttribute("data-on-twin"));
    expect(on.map(r => r.dataset.row)).toEqual(["home:2"]);
    const dot = on[0]!.querySelector("[data-twin-dot]")!;
    expect(dot).toHaveAttribute("data-variant", "brand");
    expect(dot.querySelector("[data-slot=status-indicator]")).not.toBeNull();
    expect(panel("Agent Trace").querySelectorAll("[data-twin-dot]")).toHaveLength(1);
  });

  it("Trace 보존 해제 뒤에도 같은 활동의 실행과 준비 차례를 유지한다", () => {
    size(1440, 900);
    const prepared: TraceRow = { ...base, id: "home:1", kind: "AGENT", name: "목표 준비", input: "컵 치우기", output: "준비 시작", retained: true };
    const placed: TraceRow = { ...base, id: "home:2", kind: "EXECUTION", name: "배치 안내", input: "컵 · 싱크대", output: "배치 확인" };
    const mounted = render(<DashboardScreen {...scene({ trace: [prepared, placed] })} />);
    const output = () => Array.from(panel("Agent Trace").querySelectorAll("[data-slot=trace-step]"), row => row.textContent);
    const before = output();
    expect(before).toHaveLength(2);
    expect(before[0]).toContain("준비 시작");
    expect(before[1]).toContain("배치 확인");
    mounted.rerender(<DashboardScreen {...scene({ trace: [{ ...prepared, rev: 2, retained: undefined }, placed] })} />);
    expect(output()).toEqual(before);
  });

  it("겹치는 활동과 관련 안전 근거를 함께 갱신하고 알약과 활동 펼치기 단추만 둔다", () => {
    size(390, 740);
    const pendingAc: TraceRow = { ...base, id: "home:3", activity_id: "home:a2", kind: "AGENT", name: "행동 선택", input: "에어컨", output: "에어컨 켜기", state: "pending", ended_ms: null };
    const safety: TraceRow = { ...base, id: "home:4", activity_id: "home:a3", kind: "GUARDRAIL", name: "안전 상태", input: "안전 검사", output: "쓰러짐 의심" };
    const guard: TraceRow = { ...base, id: "home:5", cause_id: "home:4", kind: "GUARDRAIL", name: "실행 보류", input: "실행 전 검사", output: "안전 조치 우선" };
    const mounted = render(<DashboardScreen {...scene({ trace: [picking, pendingAc, safety, guard] })} />);
    const trace = within(panel("Agent Trace"));
    expect(trace.getAllByText(/에어컨 켜기/).length).toBeGreaterThan(0);
    expect(trace.getAllByText(/쓰러짐 의심/).length).toBeGreaterThan(0);
    const steps = Array.from(panel("Agent Trace").querySelectorAll<HTMLElement>("[data-slot=trace-step]"));
    expect(steps.find(row => /실행 보류.*안전 조치 우선.*쓰러짐 의심/.test(row.textContent ?? ""))).toBeVisible();
    const buttons = trace.getAllByRole("button", { hidden: true });
    expect(buttons.filter(button => button.getAttribute("data-slot") === "scroll-to-bottom")).toHaveLength(1);
    expect(buttons.filter(button => button.getAttribute("data-slot") !== "scroll-to-bottom")
      .every(button => button.hasAttribute("aria-expanded"))).toBe(true);
    mounted.rerender(<DashboardScreen {...scene({ trace: [{ ...picking, rev: 2, state: "done", ended_ms: 450, output: "수행 확인" }, pendingAc, safety, guard] })} />);
    expect(trace.getAllByText(/수행 확인/).length).toBeGreaterThan(0);
    expect(trace.queryByText(/시연자 수행 대기/)).toBeNull();
  });
});
