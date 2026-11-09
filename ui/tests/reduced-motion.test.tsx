// 움직임 줄이기(prefers-reduced-motion: reduce)면 저절로 움직이는 것이 멈춘다: 말풍선(Tooltip), 확인 창(AlertDialog).
// jsdom은 CSS를 계산하지 않아 class·prop·Element.animate로 본다.
// tests/setup.ts가 matchMedia를 움직임 줄이기로 둔다.
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DeviceView } from "../../src/contract/events.ts";
import { BubbleLayer } from "../src/bubbles/BubbleLayer";
import { SetupApp } from "../src/setup/SetupApp";
import { FakeWebSocket, fakeSetupApi, setupView } from "./helpers/setup-api";

const words = (el: Element) => (el.getAttribute("class") ?? "").split(/\s+/);
/** 이 요소의 움직임 class가 움직임 줄이기에서 꺼지는지: animate-*·animate-in이 있으면 motion-reduce:animate-none(또는 늘 animate-none)도 있다. */
const stillWhenReduced = (el: Element) => {
  const w = words(el);
  const moves = w.some((c) => /(^|:)animate-(?!none)/.test(c));
  return !moves || w.includes("motion-reduce:animate-none") || (w.includes("data-[state=open]:animate-none") && w.includes("data-[state=closed]:animate-none"));
};

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

  it("트윈 말풍선(Tooltip)은 나타날 때 움직이지 않는다", () => {
    const dev: DeviceView = { id: "a", label: "거실 조명", room: "r", roomLabel: "거실", twinType: "t", kind: "light", matterDeviceType: "x", capabilities: [], sensors: [], twinAttrs: {},
      state: { id: "a", online: true, twin: { power: "on" }, matter: {}, updatedAt: "t" } };
    render(<BubbleLayer checks={[{ key: "device:a", order: 1, source: "agent", deviceId: "a", verb: "바꿈", at: 0 }]} devices={new Map([["a", dev]])} points={new Map([["a", { x: 1, y: 1, visible: true }]])} />);
    const tip = document.querySelector("[data-check] [data-tone=twin]")!;
    expect(stillWhenReduced(tip)).toBe(true);
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
