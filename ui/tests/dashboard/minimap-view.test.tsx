// 비전 미니맵만(대시보드 주소 ?view=minimap, 미니맵 녹화): 대시보드 폰 칸(PhonePane 「폰 카메라」)과 같은 부품·같은 자료(health·/events seen)를
// 창 가운데 16:9 칸 하나로 채운다. 3D 트윈 엔진·장면·트윈 파일은 띄우지 않고, 메시지 상자·시간 줄 카드·마스코트도 없다(2026-11-19 사용자 「미니맵만 크게 새로 녹화」).
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import type { HealthView, ServerMessage } from "../../../src/contract/events.ts";
import run from "../../src/dashboard/fake-run.json";
import { MinimapView, minimapBox, minimapOnly } from "../../src/dashboard/MinimapView";
import { TwinEngine } from "../../src/twin/3d/engine";
import { SHOTS } from "../../src/phone/fixtures";
import { PhoneScreen } from "../../src/phone/PhoneScreen";

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

  // 2026-11-19 사용자 「우리 실제 폰에서 내리는 명령 UI랑 좀 다른 것 같아」: 자막은 실제 폰 위 줄(미어캣 + 지금 명령)과 같은 부품·배치·글이고 자리도 위쪽이다
  it("지금 실제 폰 명령(phone_command)은 칸 위쪽 실제 폰 위 줄(data-phone-zone=top: 미어캣 얼굴 + 명령 한 줄)로 보이고, 지우면(null) 명령 줄만 사라진다", async () => {
    await mount(true);
    const top = () => document.querySelector<HTMLElement>("main > [data-phone-line] > [data-phone-zone=top]")!;
    expect(top()).not.toBeNull();
    expect(top().querySelector("[data-phone-text]")).toBeNull();
    const slot = top().parentElement!;
    expect([slot.style.left, slot.style.top, slot.style.width]).toEqual(["0px", "0px", "1280px"]);
    expect(top().closest(".pointer-events-none")).not.toBeNull();
    expect(top().querySelector("[data-shape=logo]")).not.toBeNull();
    expect(top().querySelector("button")).toBeNull();
    send([{ type: "phone_command", text: "식탁으로 가 주세요" }]);
    expect(top().querySelector("[data-phone-text=명령]")).toHaveTextContent(/^식탁으로 가 주세요$/);
    send([{ type: "phone_command", text: "컵을 들어 주세요" }]);
    expect(top().querySelector("[data-phone-text=명령]")).toHaveTextContent(/^컵을 들어 주세요$/);
    send([{ type: "phone_command", text: null }]);
    expect(top().querySelector("[data-phone-text]")).toBeNull();
    expect(document.querySelector("[data-phone-command]")).toBeNull();
  });

  it("명령 줄은 실제 폰 화면 위 줄과 같은 부품·글이다(같은 명령이면 그 칸 마크업이 같다)", async () => {
    const phone = render(<PhoneScreen view={SHOTS["pick-cup"].view} act={{
      startAr: vi.fn(), startPlace: vi.fn(), startFromSpot: vi.fn(), confirmStart: vi.fn(), endSetup: vi.fn(), setSettings: vi.fn(), micOn: vi.fn(), say: vi.fn(), confirm: vi.fn(), answer: vi.fn(),
    }} />);
    const phoneTop = phone.container.querySelector<HTMLElement>("[data-phone-zone=top]")!;
    const phoneLine = phoneTop.lastElementChild!.outerHTML;
    const phoneZone = phoneTop.getAttribute("class")!.split(/\s+/);
    phone.unmount();
    await mount(true);
    send([{ type: "phone_command", text: "컵을 들어 주세요" }]);
    const top = document.querySelector<HTMLElement>("main > [data-phone-line] > [data-phone-zone=top]")!;
    expect(top.lastElementChild!.outerHTML).toBe(phoneLine);
    // 위 줄 배치(flex·gap·여백)도 폰과 같다. 다른 것은 자리(폰 fixed, 미니맵 칸 위 absolute)뿐
    const layout = (c: string[]) => c.filter((x) => !/^(fixed|absolute|inset-x-0|top-0|z-50|pointer-events-none)$/.test(x));
    expect(layout(top.getAttribute("class")!.split(/\s+/))).toEqual(layout(phoneZone));
  });

  // 2026-11-20 사용자 「말풍선 글자 크기만큼만 나오게 해 줘」: 명령 말풍선은 남은 너비를 채우지 않고 글 너비만큼(줄어들 수 있어 긴 명령은 줄을 바꾼다)
  it("명령 말풍선은 늘어나지 않고(flex-1·grow·w-full 없음) 줄어들 수 있다(min-w-0). 실제 폰도 같은 부품이다", async () => {
    await mount(true);
    send([{ type: "phone_command", text: "컵을 들어 주세요" }]);
    const bubble = document.querySelector<HTMLElement>("main > [data-phone-line] > [data-phone-zone=top]")!.lastElementChild!;
    const words = (bubble.getAttribute("class") ?? "").split(/\s+/);
    expect(bubble.getAttribute("data-slot")).toBe("liquid-glass");
    expect(words.filter((w) => /^(flex-1|grow|flex-grow|w-full|flex-auto)$/.test(w))).toEqual([]);
    expect(words).toContain("min-w-0");
    expect(bubble.querySelector("[data-phone-text=명령]")).toHaveClass("break-keep");
  });

  it("창이 16:9가 아니면(1280×800) 칸은 가운데 1280×720이다", async () => {
    windowSize(1280, 800);
    await mount(true);
    expect(box(pane())).toEqual(["0px", "40px", "1280px", "720px"]);
  });
});
