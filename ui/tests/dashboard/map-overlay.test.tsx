// 3D 트윈 위 표시 판(MapOverlay): 어둡게 한 방 층은 계획이 오면 묶음마다 미리 만들고 지금 묶음만 보인다. 판 transform은 엔진 카메라가 그림마다 바꾼다.
// 선·점은 마우스를 받지 않고 점선이 없다. 확인한 기기·물건에만 말풍선이 있다. 클로이드는 SVG가 아니라 엔진의 3D 원뿔(setEye)이 맞춘 눈을 따른다.
// 계획 길(지나온 길·지금 구간·남은 길)과 단계 번호(①②③④, 지금 단계 brand·끝난 단계 흐림)·지금 단계 이름표·사람 이름표를 그린다(2026-11-18 사용자 결정).
// 목적지 고리는 그리지 않는다(지금 단계 번호가 그 자리다). 확인한 것 점은 그린다. 목표 글은 트윈에 없다.
import { act, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import type { DeviceView, EyeEvent, HealthView, ServerMessage } from "../../../src/contract/events.ts";
import type { WorldView } from "../../../src/contract/world.ts";
import run from "../../src/dashboard/fake-run.json";
import type { Check } from "../../src/dashboard/checks/checks";
import { coverScale, focusOf, livedOf, toScreen, wideCamera } from "../../src/dashboard/camera";
import { Dashboard } from "../../src/dashboard/Dashboard";
import { roomSetsOf, twinFrame } from "../../src/dashboard/frame";
import { MapOverlay } from "../../src/dashboard/MapOverlay";
import { PreDrawing } from "../../src/dashboard/motion";
import { TwinEngine } from "../../src/twin/3d/engine";
import { plateTransform, type MapCamera } from "../../src/twin/3d/view";
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
/** 그 카메라(지켜보기 기본 보기)로 사람이 있는 방(거실·주방·식당)이 트윈 칸 안에 다 보이는가. */
function showsLivedRooms(c: MapCamera) {
  const w = livedOf(HOME.shapes)!;
  return ([[w.x0, w.y0], [w.x1, w.y1]] as [number, number][]).every((q) => {
    const p = toScreen(c, SIZE, q);
    return p.x >= -1e-6 && p.x <= SIZE.width + 1e-6 && p.y >= -1e-6 && p.y <= SIZE.height + 1e-6;
  });
}

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

function propsAt(n: number, checks: Check[] = n > 0 ? PLAN_CHECKS : [], world: WorldView | null = null) {
  const frame = twinFrame({ ...moment(n), checks, anchor: anchorOf, home: HOME, cam: CAM, world });
  const cam = wideCamera(IMAGE, SIZE, focusOf(frame, HOME.shapes), PAD);
  return { frame, checks, cam };
}

function overlay(n: number, engine: ReturnType<typeof fakeEngine> | null, roomSets = roomSetsOf(PLAN, HOME), checks?: Check[], world: WorldView | null = null) {
  const p = propsAt(n, checks, world);
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

  it("선·점은 마우스를 받지 않는 층 안에 있고 점선이 없다", () => {
    const { container } = render(overlay(3, null));
    const root = container.firstElementChild as HTMLElement;
    expect(root).toHaveClass("pointer-events-none");
    for (const sel of ['[data-line="now"]', "[data-stop]", "[data-step-tag]", `[data-mark="${SINK}"]`]) {
      const el = container.querySelector(sel);
      expect(el, sel).not.toBeNull();
      expect(el!.closest(".pointer-events-none")).not.toBeNull();
    }
    expect(container.querySelector('[class*="dashed"]')).toBeNull();
    expect(container.querySelector("[stroke-dasharray]")).toBeNull();
    expect(container.innerHTML).not.toMatch(/dasharray/);
  });

  it("클로이드는 SVG 판에 그리지 않는다(3D 원뿔이 맞춘 눈을 따른다). 카메라 맞춤용 frame.robot은 그대로다", () => {
    expect(propsAt(3).frame.robot).not.toBeNull();
    const { container } = render(overlay(3, null));
    expect(container.querySelector("[data-robot]")).toBeNull();
    expect(container.querySelector("linearGradient, radialGradient")).toBeNull();
    expect(container.querySelector('[fill^="url("]')).toBeNull();
  });

  it.each([0, 1, 2, 3, 4])("순간 %i: 판에는 어둡게 한 방·밝힌 방 테두리·계획 길·확인한 것 점만 있다. 계획이 있으면 길을 그리고 목적지 고리는 없다", (n) => {
    const { frame } = propsAt(n);
    expect(frame.route.points.length > 0).toBe(n > 0);
    const { container } = render(overlay(n, null));
    const plate = container.querySelector("[data-map-plate]")!;
    expect(!!plate.querySelector("[data-line]")).toBe(n > 0);
    const kinds = [...plate.children].map((el) => (el as HTMLElement).dataset);
    for (const d of kinds) expect(d.mapDim !== undefined || d.roomEdge !== undefined || d.line !== undefined || d.mark !== undefined, JSON.stringify(d)).toBe(true);
    expect(plate.querySelector("[data-target]")).toBeNull();
  });

  it("순간 3(싱크대로 가기): 지나온 길과 지금 구간이 있고, 번호 넷 중 지금 3번만 brand, 끝난 1·2번은 흐림, 남은 4번은 회색이며 지금 단계 이름표는 「③ 싱크대로 가기」다", () => {
    const { container } = render(overlay(3, null));
    expect([...container.querySelectorAll<HTMLElement>("[data-map-plate] [data-line]")].map((l) => l.dataset.line)).toEqual(["done", "now"]);
    const stops = [...container.querySelectorAll<HTMLElement>("[data-stop]")];
    expect(stops.map((s) => [s.dataset.stop, s.dataset.status, s.querySelector("[data-tone]")?.getAttribute("data-tone"), s.style.opacity])).toEqual([
      ["1", "done", "brand", "0.4"], ["2", "done", "brand", "0.4"], ["3", "active", "brand", "1"], ["4", "pending", "off", "1"],
    ]);
    expect(stops[2]).toHaveAttribute("data-now");
    expect(container.querySelector("[data-step-tag]")).toHaveTextContent("③ 싱크대로 가기");
    expect(container.querySelector("[data-step-tag] [data-slot=status]")).toHaveAttribute("data-variant", "brand");
    expect(container).not.toHaveTextContent("목표");
  });

  it("World State 사람 자리가 있으면 그 자리 위에 「사람 · 마시는 중」 이름표(Status)가 있다. 없으면 이름표가 없다", () => {
    const world = (run.moments[0]!.messages as ServerMessage[]).flatMap((m) => (m.type === "world" ? [m.world] : []))[0]!;
    const { container, unmount } = render(overlay(0, null, undefined, undefined, world));
    expect(container.querySelector("[data-person-tag]")).toHaveTextContent("사람 · 마시는 중");
    unmount();
    expect(render(overlay(0, null)).container.querySelector("[data-person-tag]")).toBeNull();
  });

  it("표시는 21st.dev Line Draw SVG를 겹친 것이고, 한 장은 받은 코드처럼 path 하나만 그린다", () => {
    const { container } = render(overlay(3, null));
    const plate = container.querySelector("[data-map-plate]")!;
    const svgs = [...plate.querySelectorAll("svg")];
    expect(svgs.length).toBeGreaterThan(0);
    for (const svg of svgs) expect([...svg.children].map((c) => c.tagName.toLowerCase())).toEqual(["path"]);
    expect(container.querySelector('[data-line="now"]')!.querySelectorAll("svg")).toHaveLength(3);
    expect(container.querySelector(`[data-mark="${SINK}"]`)!.querySelectorAll("svg")).toHaveLength(3);
  });

  it("확인한 물건에만 말풍선이 있고 확인하지 않은 기기는 없다", () => {
    const { container } = render(overlay(3, null));
    expect(container.querySelector(`[data-check="${SINK}"]`)).not.toBeNull();
    expect(container.querySelector(`[data-check="${FRIDGE}"]`)).toBeNull();
    for (const el of container.querySelectorAll("[data-check]")) expect(el.closest(".pointer-events-none")).not.toBeNull();
  });

  it("화면이 뜰 때 미리 그려 보는 동안만 이름표·말풍선 층을 opacity 1 그대로 따로 합성해 그려 보고, 단계가 바뀔 때는 하지 않는다", () => {
    const anims: { el: Element; opacity: unknown[]; cancel: ReturnType<typeof vi.fn> }[] = [];
    const proto = Element.prototype as unknown as { animate?: unknown };
    const had = proto.animate;
    proto.animate = function (this: Element, kf: Keyframe[]) {
      const cancel = vi.fn();
      anims.push({ el: this, opacity: kf.map((k) => k.opacity), cancel });
      return { cancel } as unknown as Animation;
    };
    try {
      const at = (n: number, predraw: boolean) => <PreDrawing.Provider value={predraw}>{overlay(n, null)}</PreDrawing.Provider>;
      const view = render(at(3, true));
      const layer = view.container.querySelector("[data-map-marks]")!;
      expect(layer.querySelector(`[data-check="${SINK}"]`)).not.toBeNull();
      const on = anims.filter((a) => a.el === layer);
      expect(on).toHaveLength(1);
      expect(on[0]!.opacity).toEqual([1, 1]);
      view.rerender(at(3, false));
      expect(on[0]!.cancel).toHaveBeenCalled();
      for (const n of [4, 0, 1, 2, 3]) view.rerender(at(n, false));
      expect(anims.filter((a) => a.el === layer)).toHaveLength(1);
    } finally {
      proto.animate = had;
    }
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
  ready: { ok: false, inference_mode: "openai", vlm: { base_url: "", model: "", key: false, reachable: false }, pam: { base_url: "", model: "", key: false, reachable: false },
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
    setEye: vi.fn((_eye: EyeEvent | null) => {}),
    stand: vi.fn((p: [number, number]): [number, number] => [p[0], p[1]]),
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

  it("?debug=steps면 트윈 위 표시도 그 순간 것이고 서버 계획은 쓰지 않는다: 순간 3은 계획 길·번호·클로이드 원뿔·주방 묶음, 순간 0은 길 없이 집 전체와 사람 이름표", async () => {
    history.replaceState(null, "", "/?debug=steps&step=3");
    const { container } = render(<Dashboard />);
    await waitFor(() => expect(load).toHaveBeenCalled());
    await waitFor(() => expect(engine.setEye.mock.calls.at(-1)?.[0]).toEqual(moment(3).eye));
    // 표시 판의 클로이드 자리는 엔진이 원뿔을 그리는 자리(stand)로 묻고, 엔진에는 받은 눈을 그대로 넣는다
    expect(engine.stand.mock.calls.at(-1)?.[0]).toEqual(moment(3).eye!.position);
    for (const sel of ["[data-map-plate] [data-line]", "[data-stop]", `[data-mark="${SINK}"]`]) expect(container.querySelector(sel), sel).not.toBeNull();
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
    await waitFor(() => expect(container.querySelector("[data-stop]")).toBeNull());
    expect(container.querySelector("[data-map-plate] [data-line]")).toBeNull();
    expect(container.querySelector("[data-person-tag]")).toHaveTextContent("사람 · 마시는 중");
    expect(engine.setEye.mock.calls.at(-1)![0]).toEqual(moment(0).eye);
    expect(container.querySelector("[data-robot]")).toBeNull();
    expect(lit()).toEqual([]);
    const watching = engine.setView.mock.calls.at(-1)![0];
    expect(watching.scale).toBeLessThan(moved[0].scale);
    expect(showsLivedRooms(watching)).toBe(true);
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

  it("계획·맞춘 눈이 오면 트윈 위에 계획 길·단계 번호·확인한 것을 그리고, 3D 원뿔이 맞춘 눈을 따르며, 카메라가 그 단계로 옮긴다", async () => {
    const { container } = render(<Dashboard />);
    await waitFor(() => expect(load).toHaveBeenCalled());
    await waitFor(() => expect(FakeSocket.last).not.toBeNull());
    await waitFor(() => expect(container.querySelector("[data-map-plate]")).not.toBeNull());
    // 눈이 오기 전: 엔진에 눈 없음(원뿔 숨김)
    expect(engine.setEye).toHaveBeenCalled();
    expect(engine.setEye.mock.calls.every(([e]) => e === null)).toBe(true);
    const whole = engine.setView.mock.calls.at(-1)![0];
    expect(showsLivedRooms(whole)).toBe(true);
    const { plan, eye } = moment(3);
    act(() => {
      FakeSocket.last!.push({ type: "hello", devices: 0, provider: null, hub: "memory", home: "mokryeon_180b" });
      FakeSocket.last!.push({ type: "plan", plan });
      FakeSocket.last!.push({ type: "eye", eye });
    });
    await waitFor(() => expect(engine.setEye.mock.calls.at(-1)?.[0]).toEqual(eye));
    for (const sel of ["[data-map-plate] [data-line]", "[data-stop]", `[data-mark="${SINK}"]`]) expect(container.querySelector(sel), sel).not.toBeNull();
    expect(container.querySelector("[data-robot]")).toBeNull();
    const dims = [...container.querySelectorAll<HTMLElement>("[data-map-dim]")];
    expect(dims.filter((d) => d.style.opacity === "1").map((d) => d.dataset.mapDim)).toEqual(["kitchen+living"]);
    const moved = engine.setView.mock.calls.at(-1)!;
    expect(moved[0].scale).toBeGreaterThan(whole.scale);
    // 추정 눈은 버린다: 카메라도 원뿔도 그대로
    const eyes = engine.setEye.mock.calls.length;
    act(() => FakeSocket.last!.push({ type: "eye", eye: { ...eye, position: [1, 1], estimated: true } }));
    expect(engine.setView.mock.calls.at(-1)).toBe(moved);
    expect(engine.setEye.mock.calls.length).toBe(eyes);
    expect(engine.setEye.mock.calls.some(([e]) => e?.estimated)).toBe(false);
    // 계획이 끝나면 길·번호·어둡게 한 층이 없어진다
    act(() => FakeSocket.last!.push({ type: "plan", plan: { ...plan!, revision: plan!.revision + 1, status: "done" } }));
    await waitFor(() => expect(container.querySelector("[data-stop]")).toBeNull());
    expect(container.querySelector("[data-map-plate] [data-line]")).toBeNull();
    expect(container.querySelector("[data-map-dim]")).toBeNull();
  });
});
