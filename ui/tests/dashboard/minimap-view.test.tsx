// 비전 미니맵만(대시보드 주소 ?view=minimap, 미니맵 녹화): 대시보드 폰 칸(PhonePane 「폰 카메라」)과 같은 부품·같은 자료(health·/events seen)를
// 창 가운데 16:9 칸 하나로 채운다. 3D 트윈 엔진·장면·트윈 파일은 띄우지 않고, 메시지 상자·시간 줄 카드·마스코트도 없다(2026-11-19 사용자 「미니맵만 크게 새로 녹화」).
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import type { HealthView, ServerMessage } from "../../../src/contract/events.ts";
import run from "../../src/dashboard/fake-run.json";
import { MinimapView, minimapBox, minimapOnly } from "../../src/dashboard/MinimapView";
import { TwinEngine } from "../../src/twin/3d/engine";

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

const PHONE_URL = "http://192.168.0.7:8210/phone/";

/** 구운 3D가 있는 집(한양목련): 대시보드라면 트윈 엔진을 띄우는 집이다. eye는 폰 서버가 켜졌는가. */
function stubServer(eye: boolean) {
  const health: HealthView = {
    ok: true, devices: 0, hub: "memory", transport: null, provider: "openai", model: "m", twin: true, eye,
    home: { id: "mokryeon_180b", name: "우리 집" }, phone_urls: [PHONE_URL], brain: true, mode: "test",
    ready: { ok: false, inference_mode: "openai", vlm: { base_url: "", model: "", key: false, reachable: false }, pam: { base_url: "", model: "", key: false, reachable: false },
      agent: { provider: "openai", base_url: "", model: "", key: false, reachable: false }, db: false },
  };
  vi.stubGlobal("fetch", vi.fn(async (path: string) => (
    path === "/api/health" ? Response.json(health)
      : path === "/twin/bake/manifest.json" ? new Response(null, { status: 200 })
        : new Response("{}", { status: 404 }))));
}

const moment = (n: number) => run.moments[n]!.messages as ServerMessage[];
const called = (path: string) => vi.mocked(fetch).mock.calls.some((c) => c[0] === path);
const pane = () => screen.getByRole("region", { name: "폰 카메라" });
const send = (ms: ServerMessage[]) => act(() => { for (const m of ms) FakeSocket.last!.push(m); });
const box = (el: HTMLElement) => [el.style.left, el.style.top, el.style.width, el.style.height];

describe("비전 미니맵만(?view=minimap)", () => {
  let rect: MockInstance;
  let load: MockInstance<typeof TwinEngine.load>;
  /** 창 크기(getBoundingClientRect가 모든 요소에 주는 크기). */
  const windowSize = (width: number, height: number) => rect.mockReturnValue(
    { x: 0, y: 0, left: 0, top: 0, right: width, bottom: height, width, height, toJSON: () => ({}) } as DOMRect,
  );
  beforeEach(() => {
    FakeSocket.last = null;
    vi.stubGlobal("WebSocket", FakeSocket);
    rect = vi.spyOn(HTMLElement.prototype, "getBoundingClientRect");
    windowSize(1280, 720);
    load = vi.spyOn(TwinEngine, "load");
  });
  afterEach(() => {
    rect.mockRestore();
    load.mockRestore();
    vi.unstubAllGlobals();
    history.replaceState(null, "", "/");
  });

  async function mount(eye: boolean) {
    stubServer(eye);
    const view = render(<MinimapView />);
    await waitFor(() => expect(FakeSocket.last).not.toBeNull());
    await waitFor(() => expect(called("/api/health")).toBe(true));
    await act(async () => { await Promise.resolve(); });
    act(() => FakeSocket.last!.onopen?.());
    return view;
  }

  it("주소 view=minimap일 때만 미니맵만 보기다", () => {
    expect(minimapOnly("?view=minimap")).toBe(true);
    expect(minimapOnly("?debug=steps&view=minimap")).toBe(true);
    for (const s of ["", "?view=first", "?view=top", "?debug=steps", "?minimap"]) expect(minimapOnly(s), s).toBe(false);
  });

  it("미니맵 칸은 창 가운데 가장 큰 16:9 칸이다(1280×720 창이면 창 전체)", () => {
    expect(minimapBox({ width: 1280, height: 720 })).toEqual({ left: 0, top: 0, width: 1280, height: 720 });
    expect(minimapBox({ width: 1280, height: 800 })).toEqual({ left: 0, top: 40, width: 1280, height: 720 });
    expect(minimapBox({ width: 1600, height: 720 })).toEqual({ left: 160, top: 0, width: 1280, height: 720 });
    expect(minimapBox({ width: 0, height: 0 })).toEqual({ left: 0, top: 0, width: 0, height: 0 });
  });

  it("폰 카메라 칸 하나가 1280×720 창을 채우고, 트윈·메시지 상자·시간 줄 카드·마스코트가 없으며 트윈 엔진·장면·트윈 파일을 받지 않는다", async () => {
    await mount(true);
    send(moment(2));
    await waitFor(() => expect(document.querySelector("main")).toHaveAttribute("data-ready"));
    expect(box(pane())).toEqual(["0px", "0px", "1280px", "720px"]);
    expect(pane().parentElement).toBe(document.querySelector("main"));
    expect(document.querySelectorAll("section")).toHaveLength(1);
    expect(document.querySelector('[aria-label="트윈"], [aria-label="3D 트윈"], [data-map], iframe')).toBeNull();
    expect(document.querySelector("[data-talk], [data-timeline-card], [data-mascot], [data-mode-text], [data-chips]")).toBeNull();
    expect(screen.queryByRole("region", { name: "마스코트" })).toBeNull();
    await new Promise((r) => setTimeout(r, 50));
    expect(load).not.toHaveBeenCalled();
    const paths = vi.mocked(fetch).mock.calls.map((c) => String(c[0]));
    expect(paths.filter((p) => p.startsWith("/twin") || p.startsWith("/api/scene") || /\.glb/.test(p))).toEqual([]);
  });

  it("대시보드 폰 칸처럼: 폰 서버가 켜져 있어도 첫 장 전에는 QR이고, 첫 장이 오면 QR이 없어지고 컵 마스크와 이름표가 보인다", async () => {
    await mount(true);
    send(moment(2));
    await waitFor(() => expect(screen.getByRole("img", { name: "폰 연결 QR" })).toBeInTheDocument());
    expect(pane().querySelector("canvas[data-masks], [data-detection-label]")).toBeNull();
    fireEvent.load(pane().querySelector<HTMLImageElement>("[data-eye-video] img")!);
    await waitFor(() => expect(screen.queryByRole("img", { name: "폰 연결 QR" })).toBeNull());
    send(moment(2));
    expect(pane().querySelector("canvas[data-masks]")).not.toBeNull();
    expect([...pane().querySelectorAll("[data-detection-label]")].map((t) => t.textContent)).toEqual(["컵"]);
  });

  it("폰 서버가 꺼져 있으면(health.eye false) 연결 QR이다", async () => {
    await mount(false);
    await waitFor(() => expect(screen.getByRole("img", { name: "폰 연결 QR" })).toBeInTheDocument());
    expect(pane().querySelector("[data-eye-video]")).toBeNull();
  });

  it("창이 16:9가 아니면(1280×800) 칸은 가운데 1280×720이다", async () => {
    windowSize(1280, 800);
    await mount(true);
    expect(box(pane())).toEqual(["0px", "40px", "1280px", "720px"]);
  });
});
