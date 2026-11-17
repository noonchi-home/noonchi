import { act, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import type { HealthView, ServerMessage } from "../../src/contract/events.ts";
import type { LayoutMessage } from "../../src/contract/layout.ts";
import { Dashboard } from "../src/dashboard/Dashboard";
import { TwinEngine } from "../src/twin/3d/engine";

/** /api/health는 집 id, /twin/bake/manifest.json은 manifest 상태로 답한다. 나머지는 404. */
function stubHealth(home: string, manifest: number, eye = false) {
  const health: HealthView = {
    ok: true, devices: 0, hub: "memory", transport: null, provider: "openai", model: "m", twin: true, eye,
    home: { id: home, name: "우리 집" }, phone_urls: [], brain: false, mode: "test", assist: "noonchi",
    ready: { ok: false, inference_mode: "mock", vlm: { base_url: "", model: "", key: false, reachable: false }, pam: { url: "", reachable: false, llm: null },
      agent: { provider: "openai", base_url: "", model: "", key: false, reachable: false }, db: false },
  };
  vi.stubGlobal("fetch", vi.fn(async (path: string) => {
    if (path === "/api/health") return Response.json(health);
    if (path === "/twin/bake/manifest.json") return new Response(null, { status: manifest });
    return new Response("{}", { status: 404 });
  }));
}

beforeEach(() => { vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 404 }))); });
afterEach(() => { vi.unstubAllGlobals(); history.replaceState(null, "", "/"); });

describe("대시보드 뼈대", () => {
  it("트윈 칸·대시보드 폰 칸(「폰 카메라」)·마스코트가 한 화면(main)에 있다", () => {
    const { container } = render(<Dashboard />);
    const main = container.querySelector("main")!;
    const twin = container.querySelector<HTMLElement>('section[aria-label="트윈"]')!;
    const phone = container.querySelector<HTMLElement>('section[aria-label="폰 카메라"]')!;
    expect(twin).not.toBeNull();
    expect(phone).not.toBeNull();
    expect(main.contains(twin) && main.contains(phone)).toBe(true);
    // 폰 카메라(미니맵)는 트윈 판 밖에서 트윈 위에 얹힌다
    expect(phone.parentElement).toBe(main);
    expect(twin.contains(phone)).toBe(false);
    expect(main).toHaveAttribute("data-step", "0");
    const mascot = screen.getByRole("region", { name: "마스코트" });
    expect(within(mascot).getByRole("button", { name: "설정 열기" })).toBeInTheDocument();
  });

  it("health 전에는 트윈 칸 지도 자리에 3D 트윈 틀만 있고 iframe·캔버스는 없다", () => {
    const { container } = render(<Dashboard />);
    const map = container.querySelector<HTMLElement>('section[aria-label="트윈"] [data-map]')!;
    expect(within(map).getByLabelText("3D 트윈")).toBeInTheDocument();
    expect(map.querySelector("iframe")).toBeNull();
    expect(map.querySelector("canvas")).toBeNull();
  });

  it("구운 3D가 없는 집은 트윈 칸 지도 자리에 3D 트윈(iframe)이 있다", async () => {
    stubHealth("h", 200);
    const { container } = render(<Dashboard />);
    const map = container.querySelector<HTMLElement>('section[aria-label="트윈"] [data-map]')!;
    await waitFor(() => expect(map.querySelector("iframe")).not.toBeNull());
    expect(within(map).getByLabelText("3D 트윈")).toBeInTheDocument();
    expect(fetch).not.toHaveBeenCalledWith("/twin/bake/manifest.json", expect.anything());
  });

  it("한양목련처럼 구운 3D가 있는 집은 /twin/bake/manifest.json이 있으면 지도 자리에 iframe을 띄우지 않는다", async () => {
    stubHealth("mokryeon_180b", 200);
    const { container } = render(<Dashboard />);
    const map = container.querySelector<HTMLElement>('section[aria-label="트윈"] [data-map]')!;
    await waitFor(() => expect(fetch).toHaveBeenCalledWith("/twin/bake/manifest.json", { method: "HEAD" }));
    await act(async () => { await Promise.resolve(); });
    expect(within(map).getByLabelText("3D 트윈")).toBeInTheDocument();
    expect(map.querySelector("iframe")).toBeNull();
  });

  it("구운 보기가 있는 집이어도 /twin/bake/manifest.json이 없으면 iframe이다", async () => {
    stubHealth("mokryeon_180b", 404);
    const { container } = render(<Dashboard />);
    const map = container.querySelector<HTMLElement>('section[aria-label="트윈"] [data-map]')!;
    await waitFor(() => expect(map.querySelector("iframe")).not.toBeNull());
  });

  it("옛 패널(상태 알약·눈 창·판단 기록)이 없다. 옛 주소 ?look=glass로 열어도 같다", () => {
    history.replaceState(null, "", "/?look=glass");
    const { container } = render(<Dashboard />);
    for (const name of ["집 상태", "클로이드의 눈", "판단 기록"]) expect(screen.queryByRole("region", { name })).toBeNull();
    expect(container.querySelector("[data-panel]")).toBeNull();
    expect(container.querySelector("[data-look]")).toBeNull();
    expect(document.getElementById("glass-distortion")).toBeNull();
    expect(document.getElementById("glass-blur")).toBeNull();
  });

  it("health 전에는 연결 QR·영상·상태 글 없이 빈 대시보드 폰 칸이다", () => {
    const { container } = render(<Dashboard />);
    const phone = container.querySelector<HTMLElement>('section[aria-label="폰 카메라"]')!;
    expect(phone.querySelector("img")).toBeNull();
    expect(within(phone).queryByRole("img", { name: "폰 연결 QR" })).toBeNull();
    expect(phone.textContent).toBe("");
  });

  it("폰 주소가 없으면 대시보드 폰 칸에 지금 상태 한 줄: 폰 서버가 꺼졌으면 「폰 서버가 꺼져 있어요.」, 켜졌으면 「폰에서 AR을 시작하세요.」", async () => {
    stubHealth("h", 404);
    const off = render(<Dashboard />);
    const phone = () => off.container.querySelector<HTMLElement>('section[aria-label="폰 카메라"]')!;
    await waitFor(() => expect(phone()).toHaveTextContent("폰 서버가 꺼져 있어요."));
    off.unmount();
    stubHealth("h", 404, true);
    const on = render(<Dashboard />);
    const live = on.container.querySelector<HTMLElement>('section[aria-label="폰 카메라"]')!;
    await waitFor(() => expect(live).toHaveTextContent("폰에서 AR을 시작하세요."));
    expect(live).not.toHaveTextContent("폰 서버가 꺼져 있어요.");
  });
});

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

const FRIDGE = "fridge_1";
const SOFA = "sofa_1";
const hello: ServerMessage = { type: "hello", devices: 1, provider: null, hub: "memory", home: "mokryeon_180b" };
const fridgeOpen: ServerMessage = { type: "state", state: { id: FRIDGE, online: true, twin: { door: "open" }, matter: {}, updatedAt: "t" } };
const moveSofa = (x: number): LayoutMessage => ({ type: "layout", op: "move", id: SOFA, room: "living", plan: { position: [x, 9], facing_deg: 0, elevation: 0 }, position: [x, 0, 9], rotation: [0, 0, 0] });

/** TwinEngine.load 대신 돌려줄 엔진: attachLive·Twin3D가 쓰는 것만. draw()가 첫 그림(onView)을 알린다. */
function fakeEngine() {
  const views = new Set<(c: unknown) => void>();
  return {
    states: { getState: vi.fn(() => ({ door: "closed" })), getAttrs: vi.fn((id: string) => (id === FRIDGE ? { door: ["closed", "open"] } : null)), setState: vi.fn() },
    layout: { move: vi.fn((_id: string, _patch: unknown) => true), add: vi.fn(async () => true), remove: vi.fn(() => true), restore: vi.fn(() => false), isRemoved: () => false, dispose: vi.fn() },
    requestRender: vi.fn(), resize: vi.fn(), setView: vi.fn(), setEye: vi.fn(), stand: vi.fn((p: [number, number]) => p), dispose: vi.fn(),
    onView: vi.fn((cb: (c: unknown) => void) => { views.add(cb); return () => { views.delete(cb); }; }),
    draw() { for (const cb of [...views]) cb({ cx: 0, cy: 0, scale: 1 }); },
  };
}

describe("대시보드 구운 트윈 연결", () => {
  const width = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetWidth")!;
  const height = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetHeight")!;
  let engine: ReturnType<typeof fakeEngine>;
  let release: () => void;
  let load: MockInstance<typeof TwinEngine.load>;

  beforeEach(() => {
    // jsdom은 상자 크기를 0으로 준다. 지도 상자에 크기를 줘야 Twin3D가 엔진을 부른다
    Object.defineProperty(HTMLElement.prototype, "offsetWidth", { configurable: true, get: () => 1280 });
    Object.defineProperty(HTMLElement.prototype, "offsetHeight", { configurable: true, get: () => 1000 });
    FakeSocket.last = null;
    vi.stubGlobal("WebSocket", FakeSocket);
    stubHealth("mokryeon_180b", 200);
    engine = fakeEngine();
    const gate = new Promise<void>((r) => { release = r; });
    load = vi.spyOn(TwinEngine, "load").mockImplementation(async () => { await gate; return engine as unknown as TwinEngine; });
  });
  afterEach(() => {
    load.mockRestore();
    Object.defineProperty(HTMLElement.prototype, "offsetWidth", width);
    Object.defineProperty(HTMLElement.prototype, "offsetHeight", height);
  });

  /** 대시보드를 그리고 Twin3D가 엔진을 부를 때까지 기다린다. */
  async function mount() {
    const view = render(<Dashboard />);
    await waitFor(() => expect(load).toHaveBeenCalled());
    await waitFor(() => expect(FakeSocket.last).not.toBeNull());
    return view;
  }

  it("한양목련이고 manifest가 있으면 지도 자리의 Twin3D가 집 mokryeon_180b로 엔진을 부른다", async () => {
    const { container } = await mount();
    expect(load).toHaveBeenCalledTimes(1);
    expect(load.mock.calls[0]![0]).toMatchObject({ home: "mokryeon_180b", box: { width: 1280, height: 1000 } });
    const map = container.querySelector<HTMLElement>('section[aria-label="트윈"] [data-map]')!;
    expect(map.querySelector("canvas[data-twin3d]")).not.toBeNull();
    expect(map.querySelector("iframe")).toBeNull();
  });

  it("엔진이 뜨기 전에 온 가전 상태·배치는 엔진이 뜨면 넣고, 그 뒤 메시지는 바로 넣는다", async () => {
    await mount();
    act(() => {
      FakeSocket.last!.push(hello);
      FakeSocket.last!.push(fridgeOpen);
      FakeSocket.last!.push(moveSofa(6.5));
    });
    expect(engine.states.setState).not.toHaveBeenCalled();
    expect(engine.layout.move).not.toHaveBeenCalled();
    await act(async () => { release(); await Promise.resolve(); });
    await waitFor(() => expect(engine.layout.move).toHaveBeenCalledTimes(1));
    expect(engine.states.setState.mock.calls).toEqual([[FRIDGE, "door", "open"]]);
    expect(engine.layout.move.mock.calls[0]![0]).toBe(SOFA);
    expect(engine.layout.move.mock.calls[0]![1]).toMatchObject({ position: [6.5, 0, 9] });
    act(() => FakeSocket.last!.push(moveSofa(7)));
    expect(engine.layout.move).toHaveBeenCalledTimes(2);
    expect(engine.layout.move.mock.calls[1]![1]).toMatchObject({ position: [7, 0, 9] });
  });

  it("첫 그림 전에는 main에 data-ready가 없고, 첫 그림을 그리면 단다", async () => {
    const { container } = await mount();
    await act(async () => { release(); await Promise.resolve(); });
    await waitFor(() => expect(engine.onView).toHaveBeenCalled());
    const main = container.querySelector("main")!;
    expect(main).not.toHaveAttribute("data-ready");
    act(() => engine.draw());
    await waitFor(() => expect(main).toHaveAttribute("data-ready"));
    expect(container.querySelector("canvas[data-twin3d]")).toHaveAttribute("data-twin3d", "ready");
  });
});
