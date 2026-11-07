// 움직임 줄이기(prefers-reduced-motion: reduce)면 저절로 움직이는 것이 멈춘다: 「실시간 연결됨」 ping, 말풍선(Tooltip), 펼침(Collapsible),
// 확인 창(AlertDialog), 글 반짝임(TextShimmer), 단계 상태 반짝임(CallState). jsdom은 CSS를 계산하지 않아 class·prop·Element.animate로 본다.
// tests/setup.ts가 matchMedia를 움직임 줄이기로 둔다.
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentAction, DeviceView, ServerMessage } from "../../src/contract/events.ts";
import { BubbleLayer } from "../src/bubbles/BubbleLayer";
import { DecisionLog } from "../src/chat/DecisionLog";
import { turnsReducer, type Turn } from "../src/chat/turns";
import { AgentToolTimeline, type AgentToolCall } from "../src/components/ui/tool-timeline";
import { StatusPill } from "../src/panels/StatusPill";
import { SetupApp } from "../src/setup/SetupApp";
import { FakeWebSocket, fakeSetupApi, setupView } from "./helpers/setup-api";

const words = (el: Element) => (el.getAttribute("class") ?? "").split(/\s+/);
/** 이 요소의 움직임 class가 움직임 줄이기에서 꺼지는지: animate-*·animate-in이 있으면 motion-reduce:animate-none(또는 늘 animate-none)도 있다. */
const stillWhenReduced = (el: Element) => {
  const w = words(el);
  const moves = w.some((c) => /(^|:)animate-(?!none)/.test(c));
  return !moves || w.includes("motion-reduce:animate-none") || (w.includes("data-[state=open]:animate-none") && w.includes("data-[state=closed]:animate-none"));
};

const find: AgentAction = { tool: "find_devices", args: { query: "거실 조명" }, ok: true, reason: "어느 기기인지 먼저 찾으려고", observation: "1개 찾음", at: "2026-11-06T05:01:12.000Z" };
const turnsOf = (messages: ServerMessage[]) => messages.reduce<Turn[]>(turnsReducer, []);

describe("움직임 줄이기", () => {
  let animate: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    animate = vi.fn(() => ({ cancel() {}, finished: Promise.resolve() }));
    (Element.prototype as unknown as { animate: unknown }).animate = animate;
  });
  afterEach(() => {
    delete (Element.prototype as unknown as { animate?: unknown }).animate;
    vi.unstubAllGlobals();
  });

  it("「실시간 연결됨」 점의 ping은 움직임 줄이기에서 꺼진다", () => {
    render(<StatusPill connected health={null} />);
    const dot = screen.getByText("실시간 연결됨").closest("[data-slot=status]")!.querySelector("[data-slot=status-indicator]")!;
    expect(dot).toHaveAttribute("data-live");
    expect(words(dot)).toContain("motion-reduce:before:animate-none");
  });

  it("트윈 말풍선(Tooltip)은 나타날 때 움직이지 않는다", () => {
    const dev: DeviceView = { id: "a", label: "거실 조명", room: "r", roomLabel: "거실", twinType: "t", kind: "light", matterDeviceType: "x", capabilities: [], sensors: [], twinAttrs: {},
      state: { id: "a", online: true, twin: { power: "on" }, matter: {}, updatedAt: "t" } };
    render(<BubbleLayer checks={[{ key: "device:a", order: 1, source: "agent", deviceId: "a", verb: "바꿈", at: 0 }]} devices={new Map([["a", dev]])} points={new Map([["a", { x: 1, y: 1, visible: true }]])} />);
    const tip = document.querySelector("[data-check] [data-tone=twin]")!;
    expect(stillWhenReduced(tip)).toBe(true);
  });

  it("판단 기록의 펼침(Collapsible)은 움직이지 않고, 생각 글은 반짝이지 않고, 단계 상태(CallState)는 Element.animate를 부르지 않는다", async () => {
    const busy: Turn[] = turnsOf([{ type: "agent", event: "action", sessionId: "phone", action: find }]);
    render(<DecisionLog turns={busy} view="log" onView={vi.fn()} phone={null} />);
    const panel = screen.getByRole("region", { name: "판단 기록" });
    await waitFor(() => expect(panel.querySelector("[data-state=open]")).not.toBeNull());
    // 손으로 접었다 다시 펴도(저절로 펼침이 아닐 때도) 움직이지 않는다
    const thinking = within(panel).getByRole("button", { name: /생각/ });
    await userEvent.click(thinking);
    await userEvent.click(thinking);
    for (const step of within(panel).getAllByRole("button", { expanded: false })) await userEvent.click(step);
    expect(panel.querySelectorAll("[data-state=open]").length).toBeGreaterThan(1);
    const moving = [...panel.querySelectorAll("[data-state]")].filter((el) => !stillWhenReduced(el));
    expect(moving.map((el) => el.getAttribute("class"))).toEqual([]);
    expect(panel.querySelector(".bg-clip-text, [style*='background-position']")).toBeNull();
    expect(animate).not.toHaveBeenCalled();
  });

  it("단계 상태(CallState) 반짝임: 움직임 줄이기면 없고, 아니면 있다", () => {
    const calls: AgentToolCall[] = [{ id: "c1", title: "켜기", kind: "행동", status: "running", icon: null }];
    const { unmount } = render(<AgentToolTimeline calls={calls} status="running" />);
    expect(document.querySelector("[data-running-shimmer]")?.getAttribute("class")).toBe("");
    expect(animate).not.toHaveBeenCalled();
    unmount();
    vi.stubGlobal("matchMedia", (q: string) => ({ matches: false, media: q, onchange: null, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => false }));
    render(<AgentToolTimeline calls={calls} status="running" />);
    expect(document.querySelector("[data-running-shimmer]")?.getAttribute("class")).toContain("bg-clip-text");
  });

  it("설정의 확인 창(AlertDialog)은 움직이지 않고 열린다", async () => {
    vi.stubGlobal("WebSocket", FakeWebSocket);
    history.replaceState(null, "", "/setup/#mode");
    const api = fakeSetupApi(setupView(), {});
    vi.stubGlobal("fetch", api.fetchMock);
    render(<SetupApp navigate={vi.fn()} />);
    await userEvent.click(await screen.findByRole("radio", { name: /실제 모드/ }));
    expect(stillWhenReduced(screen.getByRole("alertdialog"))).toBe(true);
  });
});
