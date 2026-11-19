// 장면·마스크 짝 맞추기 연결(2026-11-20 사용자 「그래 맞춰」): 대시보드 폰 칸(PhonePane)은 실시간 영상 장면이 그려질 때마다 그 장면 촬영 시각의 마스크를 얹고,
// 장면은 마스크 지연만큼 늦게 그린다(영상 일꾼에 지연을 알림). 미니맵만 보기는 실제 폰 명령 자막도 같은 만큼 늦춰 장면과 맞춘다.
import { act, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { HealthView, SeenEvent, ServerMessage } from "../../../src/contract/events.ts";
import type { EyeMode } from "../../src/dashboard/panels/eye-video";

/** 가짜 영상 일꾼(attachEyeVideo): 받은 알림 함수와 지연. */
const eye = vi.hoisted(() => ({
  onMode: null as ((m: EyeMode) => void) | null,
  onFrame: null as ((at: number | null) => void) | null,
  onShown: null as ((at: number | null) => void) | null,
  delays: [] as number[],
}));
vi.mock("../../src/dashboard/panels/eye-video", async (orig) => ({
  ...(await orig<typeof import("../../src/dashboard/panels/eye-video")>()),
  attachEyeVideo: (o: { onMode: (m: EyeMode) => void; onFrame?: (at: number | null) => void; onShown?: (at: number | null) => void }) => {
    eye.onMode = o.onMode;
    eye.onFrame = o.onFrame ?? null;
    eye.onShown = o.onShown ?? null;
    return { mode: "video", close() {}, setDelay: (ms: number) => { eye.delays.push(ms); } };
  },
}));

const { PhonePane } = await import("../../src/dashboard/PhonePane");
const { MinimapView } = await import("../../src/dashboard/MinimapView");
const { createSeenStore } = await import("../../src/dashboard/masks");

const seen = (at: number, label: SeenEvent["shapes"][number]["label"]): SeenEvent => ({
  type: "seen", at_ms: at + 300, frame_id: `e${at}`, captured_at_ms: at, frame: { width: 640, height: 360 },
  shapes: [{ label, score: 0.9, mask: { at: [100, 100, 64, 36], cols: 0, rows: 0, bits: "" } }],
});
const labels = () => [...document.querySelectorAll("[data-detection-label]")].map((t) => t.textContent);
const frames = (from: number, to: number) => { for (let at = from; at <= to; at += 33) eye.onFrame!(at); };

beforeEach(() => {
  Object.assign(eye, { onMode: null, onFrame: null, onShown: null, delays: [] });
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({ x: 0, y: 0, left: 0, top: 0, right: 1280, bottom: 720, width: 1280, height: 720, toJSON: () => ({}) } as DOMRect);
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("대시보드 폰 칸: 장면과 마스크 짝", () => {
  function mount() {
    const store = createSeenStore();
    render(<PhonePane slot={{ kind: "live", url: "" }} seen={store} box={{ left: 0, top: 0, width: 1280, height: 720 }} connected />);
    act(() => eye.onMode!("video"));
    return store;
  }

  it("장면이 그려질 때마다 그 장면 촬영 시각의 마스크를 얹는다(가장 새 마스크가 아니다). 영상 일꾼에는 마스크 지연만큼 늦추라고 알린다", () => {
    const store = mount();
    act(() => {
      frames(1000, 1300);
      store.set(seen(1000, "cup"));
      store.set(seen(1099, "bottle"));
    });
    expect(eye.delays.at(-1)).toBe(347);
    act(() => eye.onShown!(1000));
    expect(labels()).toEqual(["컵"]);
    expect(document.querySelector("[data-eye-video]")).toHaveAttribute("data-scene-at", "1000");
    act(() => eye.onShown!(1066));
    expect(labels()).toEqual(["컵"]);
    act(() => eye.onShown!(1099));
    expect(labels()).toEqual(["병"]);
  });

  it("그 장면을 이미 그린 뒤에 온 마스크(늦은 마스크)는 그리지 않는다", () => {
    const store = mount();
    act(() => {
      frames(1000, 1300);
      eye.onShown!(1200);
      store.set(seen(1000, "cup"));
      eye.onShown!(1233);
    });
    expect(labels()).toEqual([]);
  });

  it("시각 없는 장면(옛 폰·MJPEG)이면 서버 마지막 마스크를 그대로 얹는다", () => {
    const store = mount();
    act(() => {
      store.set(seen(1000, "cup"));
      eye.onShown!(null);
    });
    expect(labels()).toEqual(["컵"]);
  });
});

describe("미니맵만 보기: 명령 자막도 장면만큼 늦춘다", () => {
  class FakeSocket {
    static last: FakeSocket | null = null;
    onopen: (() => void) | null = null;
    onmessage: ((e: { data: string }) => void) | null = null;
    onclose: (() => void) | null = null;
    constructor(public url: string) { FakeSocket.last = this; }
    push(m: ServerMessage) { this.onmessage?.({ data: JSON.stringify(m) }); }
    send() {}
    close() {}
  }
  it("장면 지연(마스크 지연 + 50ms)만큼 뒤에 명령 자막을 바꾼다", async () => {
    FakeSocket.last = null;
    vi.stubGlobal("WebSocket", FakeSocket);
    const health = { ok: true, devices: 0, hub: "memory", transport: null, provider: "openai", model: "m", twin: false, eye: true, home: { id: "h", name: "집" }, phone_urls: [], brain: true, mode: "test" } as unknown as HealthView;
    vi.stubGlobal("fetch", vi.fn(async (path: string) => (path === "/api/health" ? Response.json(health) : new Response("{}", { status: 404 }))));
    render(<MinimapView />);
    await waitFor(() => expect(FakeSocket.last).not.toBeNull());
    act(() => FakeSocket.last!.onopen?.());
    await waitFor(() => expect(eye.onMode).not.toBeNull());
    act(() => {
      eye.onMode!("video");
      frames(1000, 1100);
      FakeSocket.last!.push(seen(1000, "cup"));
      eye.onShown!(1000);
    });
    expect(eye.delays.at(-1)).toBe(149);
    const line = () => document.querySelector("[data-phone-text=명령]");
    act(() => FakeSocket.last!.push({ type: "phone_command", text: "컵을 들어 주세요" }));
    expect(line()).toBeNull();
    await waitFor(() => expect(line()).toHaveTextContent(/^컵을 들어 주세요$/));
    expect(screen.getByRole("region", { name: "폰 카메라" })).toBeInTheDocument();
  });
});
