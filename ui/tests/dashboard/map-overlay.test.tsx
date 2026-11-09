// 3D 트윈 위 표시 판(MapOverlay): 어둡게 한 방 층은 계획이 오면 묶음마다 미리 만들고 지금 묶음만 보인다. 판 transform은 엔진 카메라가 그림마다 바꾼다.
// 선·점·클로이드는 마우스를 받지 않고 점선이 없다. 확인한 기기·물건에만 말풍선이 있다.
import { act, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import type { DeviceView, HealthView, ServerMessage } from "../../../src/contract/events.ts";
import type { Check } from "../../src/checks/checks";
import { coverScale, focusOf, wideCamera } from "../../src/dashboard/camera";
import { Dashboard } from "../../src/dashboard/Dashboard";
import { roomSetsOf, twinFrame } from "../../src/dashboard/frame";
import { MapOverlay } from "../../src/dashboard/MapOverlay";
import { TwinEngine } from "../../src/twin3d/engine";
import { plateTransform, type MapCamera } from "../../src/twin3d/view";
import { anchorOf, CAM, HOME, IMAGE, moment, PLAN, PLAN_CHECKS, SCENE, SINK } from "./cup-run";

const SIZE = { width: 1320, height: 1020 };
const PAD = { top: 80, right: 40, bottom: 140, left: 40 };
const FRIDGE = "fridge_bbc363a3";
const fridge: DeviceView = {
  id: FRIDGE, label: "냉장고", room: "kitchen", roomLabel: "주방·식당", twinType: "fridge", kind: "fridge", matterDeviceType: "x", capabilities: [], sensors: [], twinAttrs: {},
  state: { id: FRIDGE, online: true, twin: { door: "closed" }, matter: {}, updatedAt: "t" },
};
const devices = new Map([[FRIDGE, fridge]]);
const objects = new Map([...HOME.objects].map(([id, o]) => [id, o.name]));
const key = (rooms: string[]) => [...rooms].sort().join("+");

/** 엔진 대신: 그릴 때마다 카메라를 알린다. */
function fakeEngine(start: MapCamera) {
  const views = new Set<(c: MapCamera) => void>();
  return {
    current: () => ({ ...start }),
    onView: (cb: (c: MapCamera) => void) => { views.add(cb); return () => { views.delete(cb); }; },
    draw(c: MapCamera) { for (const cb of [...views]) cb(c); },
    listeners: () => views.size,
  };
}

function propsAt(n: number, checks: Check[] = n > 0 ? PLAN_CHECKS : []) {
  const frame = twinFrame({ ...moment(n), checks, anchor: anchorOf, home: HOME, cam: CAM });
  const cam = wideCamera(IMAGE, SIZE, focusOf(frame, HOME.shapes), PAD);
  return { frame, checks, cam };
}

function overlay(n: number, engine: ReturnType<typeof fakeEngine> | null, roomSets = roomSetsOf(PLAN, HOME), checks?: Check[]) {
  const p = propsAt(n, checks);
  return <MapOverlay {...p} shapes={HOME.shapes} roomSets={roomSets} image={IMAGE} size={SIZE} engine={engine} devices={devices} objects={objects} moveMs={0} blocked={[]} />;
}

describe("트윈 위 표시 판", () => {
  it("계획이 오면 밝힐 방 묶음마다 어둡게 한 층을 미리 만들고, 단계가 바뀌어도 새로 만들지 않으며 지금 묶음만 보인다", () => {
    const { container, rerender } = render(overlay(1, null));
    const sets = new Set(roomSetsOf(PLAN, HOME).filter((r) => r.length).map(key));
    const layers = () => [...container.querySelectorAll<HTMLElement>("[data-map-dim]")];
    const first = layers();
    expect(first).toHaveLength(sets.size);
    const plate = container.querySelector("[data-map-plate]");
    expect(plate).not.toBeNull();
    for (const n of [1, 2, 3, 4]) {
      rerender(overlay(n, null));
      const now = layers();
      expect(now).toHaveLength(sets.size);
      now.forEach((el, i) => expect(el).toBe(first[i]));
      const lit = key(propsAt(n).frame.rooms);
      for (const el of now) expect(el.style.opacity).toBe(el.dataset.mapDim === lit ? "1" : "0");
      expect(container.querySelector("[data-map-plate]")).toBe(plate);
    }
  });

  it("밝힐 방이 없으면(지켜보기) 어둡게 한 층이 모두 opacity 0이다", () => {
    const { container } = render(overlay(0, null));
    const layers = [...container.querySelectorAll<HTMLElement>("[data-map-dim]")];
    expect(layers.length).toBeGreaterThan(0);
    for (const el of layers) expect(el.style.opacity).toBe("0");
  });

  it("판 transform은 엔진이 그릴 때마다 그 카메라로 바뀌고, 다시 그려도(React) 되돌리지 않는다", () => {
    const { cam } = propsAt(1);
    const engine = fakeEngine(cam);
    const { container, rerender, unmount } = render(overlay(1, engine));
    const plate = container.querySelector<HTMLElement>("[data-map-plate]")!;
    expect(plate.style.transform).toBe(plateTransform(cam, SIZE));
    expect(plate).toHaveClass("origin-top-left", "will-change-transform");
    const mid = { cx: cam.cx + 40, cy: cam.cy - 30, scale: cam.scale * 1.1 };
    act(() => engine.draw(mid));
    expect(plate.style.transform).toBe(plateTransform(mid, SIZE));
    rerender(overlay(2, engine));
    expect(plate.style.transform).toBe(plateTransform(mid, SIZE));
    unmount();
    expect(engine.listeners()).toBe(0);
  });

  it("선·점·클로이드는 마우스를 받지 않는 층 안에 있고 점선이 없다", () => {
    const { container } = render(overlay(3, null));
    const root = container.firstElementChild as HTMLElement;
    expect(root).toHaveClass("pointer-events-none");
    for (const sel of ['[data-line="passed"]', '[data-line="ahead"]', '[data-line="leg-ahead"]', "[data-target]", `[data-mark="${SINK}"]`, "[data-robot]"]) {
      const el = container.querySelector(sel);
      expect(el, sel).not.toBeNull();
      expect(el!.closest(".pointer-events-none")).not.toBeNull();
    }
    expect(container.querySelector('[class*="dashed"]')).toBeNull();
    expect(container.querySelector("[stroke-dasharray]")).toBeNull();
    expect(container.innerHTML).not.toMatch(/dasharray/);
  });

  it("클로이드는 점과 머리 방향만 있고 시야 원뿔이 없다", () => {
    const { container } = render(overlay(3, null));
    const robot = container.querySelector("[data-robot]")!;
    // 둘레·테·점 네 겹과 머리 방향 하나
    expect(robot.querySelectorAll("path")).toHaveLength(5);
    expect(container.querySelector("linearGradient, radialGradient")).toBeNull();
    expect(container.querySelector('[fill^="url("]')).toBeNull();
  });

  it("확인한 물건에만 말풍선이 있고 확인하지 않은 기기는 없다", () => {
    const { container } = render(overlay(3, null));
    expect(container.querySelector(`[data-check="${SINK}"]`)).not.toBeNull();
    expect(container.querySelector(`[data-check="${FRIDGE}"]`)).toBeNull();
    for (const el of container.querySelectorAll("[data-check]")) expect(el.closest(".pointer-events-none")).not.toBeNull();
  });

  it("확인한 기기는 말풍선이 있다", () => {
    const checked: Check = { key: `device:${FRIDGE}`, order: 3, source: "agent", deviceId: FRIDGE, verb: "확인", at: 0 };
    const { container } = render(overlay(4, null, roomSetsOf(PLAN, HOME), [checked]));
    expect(container.querySelector(`[data-check="${FRIDGE}"]`)).not.toBeNull();
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

const HEALTH: HealthView = {
  ok: true, devices: 0, hub: "memory", transport: null, provider: "openai", model: "m", twin: true, eye: false,
  home: { id: "mokryeon_180b", name: "한양목련 180B" }, phone_urls: [], brain: false, mode: "test",
  ready: { ok: false, inference_mode: "mock", vlm: { base_url: "", model: "", key: false, reachable: false }, pam: { url: "", reachable: false, llm: null },
    agent: { provider: "openai", base_url: "", model: "", key: false, reachable: false }, db: false },
};

/** TwinEngine.load 대신 돌려줄 엔진: Twin3D·attachLive·표시 판이 쓰는 것만. */
function dashEngine() {
  let cur: MapCamera = { cx: 0, cy: 0, scale: 1 };
  const views = new Set<(c: MapCamera) => void>();
  return {
    states: { getState: vi.fn(() => ({})), getAttrs: vi.fn(() => null), setState: vi.fn() },
    layout: { move: vi.fn(() => true), add: vi.fn(async () => true), remove: vi.fn(() => true), restore: vi.fn(() => false), isRemoved: () => false, dispose: vi.fn() },
    requestRender: vi.fn(), resize: vi.fn(), dispose: vi.fn(),
    setView: vi.fn((c: MapCamera) => { cur = { ...c }; }),
    current: () => ({ ...cur }),
    anchor: vi.fn((id: string) => anchorOf(id)),
    onView: vi.fn((cb: (c: MapCamera) => void) => { views.add(cb); return () => { views.delete(cb); }; }),
    draw() { for (const cb of [...views]) cb({ ...cur }); },
  };
}

describe("대시보드 구운 트윈 위 표시", () => {
  const width = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetWidth")!;
  const height = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetHeight")!;
  let engine: ReturnType<typeof dashEngine>;
  let load: MockInstance<typeof TwinEngine.load>;

  beforeEach(() => {
    Object.defineProperty(HTMLElement.prototype, "offsetWidth", { configurable: true, get: () => SIZE.width });
    Object.defineProperty(HTMLElement.prototype, "offsetHeight", { configurable: true, get: () => SIZE.height });
    FakeSocket.last = null;
    vi.stubGlobal("WebSocket", FakeSocket);
    vi.stubGlobal("fetch", vi.fn(async (path: string) => {
      if (path === "/api/health") return Response.json(HEALTH);
      if (path === "/twin/bake/manifest.json") return new Response(null, { status: 200 });
      if (path === "/api/scene") return Response.json({ scene: SCENE });
      return new Response("{}", { status: 404 });
    }));
    engine = dashEngine();
    load = vi.spyOn(TwinEngine, "load").mockImplementation(async () => engine as unknown as TwinEngine);
  });
  afterEach(() => {
    load.mockRestore();
    vi.unstubAllGlobals();
    history.replaceState(null, "", "/");
    Object.defineProperty(HTMLElement.prototype, "offsetWidth", width);
    Object.defineProperty(HTMLElement.prototype, "offsetHeight", height);
  });

  it("?debug=steps면 트윈 위 표시도 그 순간 것이고 서버 계획은 쓰지 않는다: 순간 3은 경로·목적지·클로이드·주방 묶음, 순간 0은 목적지 없이 집 전체", async () => {
    history.replaceState(null, "", "/?debug=steps&step=3");
    const { container } = render(<Dashboard />);
    await waitFor(() => expect(load).toHaveBeenCalled());
    await waitFor(() => expect(container.querySelector("[data-robot]")).not.toBeNull());
    for (const sel of ['[data-line="leg-ahead"]', "[data-target]", `[data-mark="${SINK}"]`]) expect(container.querySelector(sel), sel).not.toBeNull();
    const lit = () => [...container.querySelectorAll<HTMLElement>("[data-map-dim]")].filter((d) => d.style.opacity === "1").map((d) => d.dataset.mapDim);
    expect(lit()).toEqual(["kitchen+living"]);
    const cover = coverScale(IMAGE, SIZE);
    const moved = engine.setView.mock.calls.at(-1)!;
    expect(moved[0].scale).toBeGreaterThan(cover);
    // 서버에서 온 계획은 쓰지 않는다
    await waitFor(() => expect(FakeSocket.last).not.toBeNull());
    act(() => FakeSocket.last!.push({ type: "plan", plan: moment(1).plan }));
    expect(lit()).toEqual(["kitchen+living"]);
    expect(engine.setView.mock.calls.at(-1)).toBe(moved);
    act(() => window.__dash!.step(0));
    await waitFor(() => expect(container.querySelector("[data-target]")).toBeNull());
    expect(container.querySelector("[data-robot]")).not.toBeNull();
    expect(lit()).toEqual([]);
    expect(engine.setView.mock.calls.at(-1)![0].scale).toBeCloseTo(cover, 6);
  });

  it("단계가 바뀌면 엔진은 카메라만 옮기고(setView) 캔버스 크기(resize)는 다시 정하지 않는다", async () => {
    const { container } = render(<Dashboard />);
    await waitFor(() => expect(load).toHaveBeenCalled());
    await waitFor(() => expect(FakeSocket.last).not.toBeNull());
    await waitFor(() => expect(container.querySelector("[data-map-plate]")).not.toBeNull());
    act(() => FakeSocket.last!.push({ type: "hello", devices: 0, provider: null, hub: "memory", home: "mokryeon_180b" }));
    const resized = engine.resize.mock.calls.length;
    for (const n of [1, 2, 3, 4]) {
      const moved = engine.setView.mock.calls.length;
      const { plan, eye } = moment(n);
      act(() => {
        FakeSocket.last!.push({ type: "plan", plan });
        FakeSocket.last!.push({ type: "eye", eye });
      });
      await waitFor(() => expect(container.querySelector("main")).toHaveAttribute("data-step", String(n)));
      await waitFor(() => expect(engine.setView.mock.calls.length, `단계 ${n}`).toBeGreaterThan(moved));
    }
    expect(engine.resize.mock.calls.length).toBe(resized);
  });

  it("계획·맞춘 눈이 오면 트윈 위에 경로·목적지·클로이드·확인한 것을 그리고, 카메라가 그 단계로 옮긴다", async () => {
    const { container } = render(<Dashboard />);
    await waitFor(() => expect(load).toHaveBeenCalled());
    await waitFor(() => expect(FakeSocket.last).not.toBeNull());
    await waitFor(() => expect(container.querySelector("[data-map-plate]")).not.toBeNull());
    expect(container.querySelector("[data-robot]")).toBeNull();
    const whole = engine.setView.mock.calls.at(-1)![0];
    expect(whole.scale).toBeCloseTo(coverScale(IMAGE, SIZE), 6);
    const { plan, eye } = moment(3);
    act(() => {
      FakeSocket.last!.push({ type: "hello", devices: 0, provider: null, hub: "memory", home: "mokryeon_180b" });
      FakeSocket.last!.push({ type: "plan", plan });
      FakeSocket.last!.push({ type: "eye", eye });
    });
    await waitFor(() => expect(container.querySelector("[data-robot]")).not.toBeNull());
    for (const sel of ['[data-line="leg-ahead"]', "[data-target]", `[data-mark="${SINK}"]`]) expect(container.querySelector(sel), sel).not.toBeNull();
    const dims = [...container.querySelectorAll<HTMLElement>("[data-map-dim]")];
    expect(dims.filter((d) => d.style.opacity === "1").map((d) => d.dataset.mapDim)).toEqual(["kitchen+living"]);
    const moved = engine.setView.mock.calls.at(-1)!;
    expect(moved[0].scale).toBeGreaterThan(whole.scale);
    // 추정 눈은 버린다
    act(() => FakeSocket.last!.push({ type: "eye", eye: { ...eye, position: [1, 1], estimated: true } }));
    expect(engine.setView.mock.calls.at(-1)).toBe(moved);
    // 계획이 끝나면 목적지·어둡게 한 층이 없어진다
    act(() => FakeSocket.last!.push({ type: "plan", plan: { ...plan!, revision: plan!.revision + 1, status: "done" } }));
    await waitFor(() => expect(container.querySelector("[data-target]")).toBeNull());
    expect(container.querySelector("[data-map-dim]")).toBeNull();
  });
});
