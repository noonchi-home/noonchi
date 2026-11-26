// 3D 트윈 위 표시 판(MapOverlay): 어둡게 한 방 층은 계획이 오면 묶음마다 미리 만들고 지금 묶음만 보인다. 판 transform은 엔진 카메라가 그림마다 바꾼다.
// 선·점은 마우스를 받지 않고 점선이 없다. 확인한 기기·물건에만 말풍선이 있다. 클로이드는 SVG가 아니라 엔진의 3D 원뿔(setEye)이 맞춘 눈을 따른다.
// 계획 길(지나온 길·지금 구간·남은 길)과 단계 번호(①②③④, 지금 단계 brand·끝난 단계 흐림)·지금 단계 이름표·사람 이름표를 그린다(2026-11-18 사용자 결정).
// 목적지 고리는 그리지 않는다(지금 단계 번호가 그 자리다). 확인한 것 점은 그린다. 목표 글은 트윈에 없다.
import { act, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import type { DeviceView, EyeEvent, HealthView, ServerMessage } from "../../../src/contract/events.ts";
import type { TraceEvent, TraceRefs, TraceRow } from "../../../src/contract/trace.ts";
import type { WorldView } from "../../../src/contract/world.ts";
import { TraceJournal } from "../../../src/record/trace.ts";
import run from "../../src/dashboard/fake-run.json";
import type { Check } from "../../src/dashboard/checks/checks";
import { coverScale, focusOf, livedOf, toScreen, wideCamera } from "../../src/dashboard/camera";
import { Dashboard } from "../../src/dashboard/Dashboard";
import { roomSetsOf, twinFrame } from "../../src/dashboard/frame";
import { MapOverlay, PRE_FADE } from "../../src/dashboard/MapOverlay";
import { tagSize } from "../../src/dashboard/labels";
import type { GoalMarkInput } from "../../src/dashboard/plan-marks";
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
/** 순간 n의 클로이드 원뿔(그림 픽셀 상자)이 상자 안에 다 보이는가. */
function showsRobot(c: MapCamera, n: number) {
  const b = twinFrame({ ...moment(n), checks: [], anchor: anchorOf, home: HOME, cam: CAM }).robot!.body;
  return ([[b.x0, b.y0], [b.x1, b.y1]] as [number, number][]).every((q) => {
    const p = toScreen(c, SIZE, q);
    return p.x >= -1e-6 && p.x <= SIZE.width + 1e-6 && p.y >= -1e-6 && p.y <= SIZE.height + 1e-6;
  });
}
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

function propsAt(n: number, checks: Check[] = n > 0 ? PLAN_CHECKS : [], world: WorldView | null = null, goal: GoalMarkInput | null = null) {
  const frame = twinFrame({ ...moment(n), checks, anchor: anchorOf, home: HOME, cam: CAM, world, goal });
  const cam = wideCamera(IMAGE, SIZE, focusOf(frame, HOME.shapes), PAD);
  return { frame, checks, cam };
}

function overlay(n: number, engine: ReturnType<typeof fakeEngine> | null, roomSets = roomSetsOf(PLAN, HOME), checks?: Check[], world: WorldView | null = null, goal: GoalMarkInput | null = null) {
  const p = propsAt(n, checks, world, goal);
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

  it("선·점·이름표는 마우스를 받지 않는 층 안에 있고 점선이 없다", () => {
    const { container } = render(traced(3, moveRows(), { checks: PLAN_CHECKS }));
    const root = container.firstElementChild as HTMLElement;
    expect(root).toHaveClass("pointer-events-none");
    for (const sel of ['[data-line="now"]', "[data-trace-mark]", `[data-mark="${SINK}"]`]) {
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

  // 2026-11-25 사용자 결정 5-1: 트윈에는 집·클로이드 원뿔·밝힌 방·가전 상태·트레이스 표시만. 길·고리도 트레이스 줄에서만 나온다
  it.each([0, 1, 2, 3, 4])("순간 %i: 트레이스 줄이 없으면 계획이 있어도 판에는 어둡게 한 방·밝힌 방 테두리·확인한 것 점만 있고 길·번호·고리가 없다", (n) => {
    const { frame } = propsAt(n);
    expect(frame.route.points.length > 0).toBe(n > 0);
    const { container } = render(overlay(n, null));
    const plate = container.querySelector("[data-map-plate]")!;
    const kinds = [...plate.children].map((el) => (el as HTMLElement).dataset);
    for (const d of kinds) expect(d.mapDim !== undefined || d.roomEdge !== undefined || d.mark !== undefined, JSON.stringify(d)).toBe(true);
    expect(container.querySelector("[data-line], [data-stop], [data-goal-ring], [data-target]")).toBeNull();
  });

  it("이동 안내 줄: 끝난 구간은 지나온 길, 진행 중 구간은 진한 지금 구간이고 그 끝에 「이동 안내 · 시연자 수행 대기」 이름표다. 단계 번호·남은 길·지금 단계 이름표는 없다", () => {
    const { container } = render(traced(3, moveRows()));
    const lines = [...container.querySelectorAll<HTMLElement>("[data-map-plate] [data-line]")];
    expect(lines.map((l) => l.dataset.line)).toEqual(["done", "now"]);
    expect(container.querySelector("[data-stop], [data-step-tag]")).toBeNull();
    const tags = [...container.querySelectorAll<HTMLElement>("[data-trace-mark]")];
    // 같은 활동의 끝난 집기 안내는 그 단계 대상(식탁) 자리에 남는다. 끝난 이동 구간은 길만 있고 이름표는 없다
    expect(tags.map((t) => [t.dataset.kind, t.textContent])).toEqual([["spot", "집기 안내 · 수행 확인"], ["leg", "이동 안내 · 시연자 수행 대기"]]);
    expect(container).not.toHaveTextContent("목표");
  });

  it("World State 사람 자리가 있어도 사람 이름표와 관계 이름표가 없다", () => {
    const world = worldAt0();
    expect(world.person.position).not.toBeNull();
    const { container } = render(overlay(0, null, undefined, undefined, world));
    expect(container.querySelector("[data-person-tag], [data-relation-label]")).toBeNull();
    expect(container).not.toHaveTextContent("마시는 중");
  });

  it("목표 고리는 목표 준비 줄이 있을 때만: 대상 컵 위 작은 빨간 고리(Line Draw SVG 세 겹, 글 없음)와 「목표 준비 · …」 이름표다. 목표가 서 있어도 그 줄이 없으면 없다", () => {
    const world = worldAt0();
    const standing: GoalMarkInput = { object: "cup_1", standing: true };
    const { container, unmount } = render(traced(0, goalRows("goal_ready"), { world, goal: standing }));
    const ring = container.querySelector<HTMLElement>("[data-map-plate] [data-goal-ring]")!;
    expect(ring).not.toBeNull();
    expect(ring.querySelectorAll("svg")).toHaveLength(3);
    for (const svg of ring.querySelectorAll("svg")) expect([...svg.children].map((c) => c.tagName.toLowerCase())).toEqual(["path"]);
    expect(ring.textContent).toBe("");
    expect(container.querySelector("[data-trace-mark]")!.textContent).toBe("목표 준비 · 미리 만든 계획 준비됨");
    unmount();
    expect(render(overlay(0, null, undefined, undefined, world, standing)).container.querySelector("[data-goal-ring]")).toBeNull();
  });

  // 2026-11-19 사용자 결정(A+C 만들기)의 미리 그린 길은 목표 준비 줄의 표시로만 남는다(번호 없음)
  it("미리 그린 길: 목표 준비 줄이 있고 목표가 준비되면 미리 만든 계획의 길(흐림)이고 시작이면 진하다. 번호는 없고, 줄이 없거나 버리면 없다", () => {
    const world = worldAt0();
    const pre = { ...PLAN, status: "planned" as const, steps: PLAN.steps.map((s) => ({ ...s, status: "pending" as const })) };
    const goal = (stage: GoalMarkInput["stage"]): GoalMarkInput => ({ object: "cup_1", standing: stage !== "dropped", stage, plan: pre });
    const rows = goalRows("goal_ready");
    const { container, rerender } = render(traced(0, rows, { world, goal: goal("ready") }));
    const line = container.querySelector<HTMLElement>('[data-map-plate] [data-line="pre"]')!;
    expect(line).not.toBeNull();
    expect(Number(line.style.opacity)).toBe(PRE_FADE);
    expect(line.querySelectorAll("svg").length).toBeGreaterThan(0);
    expect(container.querySelector("[data-stop], [data-step-tag]")).toBeNull();
    rerender(traced(0, rows, { world, goal: goal("started") }));
    expect(Number(container.querySelector<HTMLElement>('[data-line="pre"]')!.style.opacity)).toBe(1);
    rerender(traced(0, [], { world, goal: goal("ready") }));
    expect(container.querySelector('[data-line="pre"]')).toBeNull();
    rerender(traced(0, rows, { world, goal: goal("dropped") }));
    expect(container.querySelector('[data-line="pre"]')).toBeNull();
  });

  it("표시는 21st.dev Line Draw SVG를 겹친 것이고, 한 장은 받은 코드처럼 path 하나만 그린다", () => {
    const { container } = render(traced(3, moveRows(), { checks: PLAN_CHECKS }));
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

/** 서버 기록기(TraceJournal)가 만든 트레이스 줄. */
function traceRows(epoch: string, add: (t: { start: (e: TraceEvent, r?: TraceRefs) => string; finish: TraceJournal["finish"] }) => void): TraceRow[] {
  const rows = new Map<string, TraceRow>();
  const j = new TraceJournal(epoch, () => 1000, (m) => { for (const r of m.rows) rows.set(r.id, r); });
  add({ start: (e, r = {}) => j.start(e, r), finish: j.finish.bind(j) });
  return [...rows.values()];
}

/** 트레이스 줄을 실은 순간 n의 표시 판. */
function traced(n: number, rows: TraceRow[], o: { size?: { width: number; height: number }; checks?: Check[]; world?: WorldView | null; goal?: GoalMarkInput | null } = {}) {
  const size = o.size ?? SIZE;
  const checks = o.checks ?? [];
  const frame = twinFrame({ ...moment(n), checks, anchor: anchorOf, home: HOME, cam: CAM, trace: rows, world: o.world ?? null, goal: o.goal ?? null });
  const cam = wideCamera(IMAGE, size, focusOf(frame, HOME.shapes), PAD);
  return <MapOverlay frame={frame} checks={checks} cam={cam} shapes={HOME.shapes} roomSets={roomSetsOf(PLAN, HOME)} image={IMAGE} size={size} engine={null} devices={devices} objects={objects} moveMs={0} blocked={[]} />;
}

let rowsSeq = 0;
/** 순간 3(싱크대로 가기)의 실행 줄: 식탁 구간 이동 끝, 컵 집기 끝, 싱크대 구간 이동 중. */
function moveRows(): TraceRow[] {
  const plan = moment(3).plan!;
  const [toTable, toSink] = plan.legs.map((l) => l.stepId);
  const pick = plan.steps.find((s) => s.kind === "act")!.id;
  return traceRows(`m${++rowsSeq}`, (t) => {
    t.finish(t.start("move", { plan_id: plan.id, step_id: toTable }), "done", "move_done");
    t.finish(t.start("pick", { plan_id: plan.id, step_id: pick }), "done", "step_done");
    t.start("move", { plan_id: plan.id, step_id: toSink });
  });
}

/** 목표 줄(cup_1). */
function goalRows(output: "goal_ready" | "goal_fired"): TraceRow[] {
  const rows = new Map<string, TraceRow>();
  const j = new TraceJournal(`g${++rowsSeq}`, () => 1000, (m) => { for (const r of m.rows) rows.set(r.id, r); });
  j.event("goal", { goal_id: "goal-1", object_id: "cup_1" }, output);
  return [...rows.values()];
}

/** 가짜 단계 순간 0의 World State(사람이 마시는 중, cup_1이 식탁 위). */
const worldAt0 = () => (run.moments[0]!.messages as ServerMessage[]).flatMap((m) => (m.type === "world" ? [m.world] : []))[0]!;

// 2026-11-25 시연 의견 5: 트윈은 Agent Trace 줄을 집 안 자리에 그린다(가장 최근 활동 하나)
describe("트윈 위 트레이스 표시", () => {
  it("근접 관찰 진행 중: 대상 자리에 점과 「근접 관찰 · 결과 대기 중」 이름표(글 전부, 자르지 않음), 클로이드 원뿔에서 대상까지 선", () => {
    const rows = traceRows("t1", (t) => { t.start("closer", { plan_id: PLAN.id, request_id: "r1", object_id: SINK }); });
    const { container } = render(traced(3, rows));
    const tag = container.querySelector<HTMLElement>("[data-trace-mark]")!;
    expect(tag).not.toBeNull();
    expect(tag.textContent).toBe("근접 관찰 · 결과 대기 중");
    expect(tag).toHaveAttribute("data-state", "pending");
    expect(container.querySelector('[data-map-marks] [class*="truncate"], [data-map-marks] [class*="max-w-"]')).toBeNull();
    expect(container.querySelector("[data-map-plate] [data-trace-line]")).not.toBeNull();
    expect(container.querySelector("[data-map-plate] [data-trace-dot]")).not.toBeNull();
    for (const el of container.querySelectorAll("[data-trace-mark], [data-trace-line]")) expect(el.closest(".pointer-events-none")).not.toBeNull();
  });

  it("근접 관찰이 끝나면 선 없이 대상 자리에 결과(「컵 안 확인 · 빈 컵 확인」)만 남는다", () => {
    const rows = traceRows("t2", (t) => { t.finish(t.start("top", { plan_id: PLAN.id, request_id: "r1", object_id: SINK }), "done", "cup_empty"); });
    const { container } = render(traced(3, rows));
    expect(container.querySelector("[data-trace-mark]")!.textContent).toBe("컵 안 확인 · 빈 컵 확인");
    expect(container.querySelector("[data-trace-line]")).toBeNull();
  });

  it("칸 가장자리에 걸린 자리의 이름표는 칸 안으로 옮겨 글이 끝까지 보인다", () => {
    const rows = traceRows("t3", (t) => { t.finish(t.start("top", { plan_id: PLAN.id, request_id: "r1", object_id: SINK }), "done", "cup_contents"); });
    const tiny = { width: 120, height: 90 };
    const { container } = render(traced(3, rows, { size: tiny }));
    const tag = container.querySelector<HTMLElement>("[data-trace-mark]")!;
    const [x, y] = [parseFloat(tag.style.left), parseFloat(tag.style.top)];
    const w = tagSize(tag.textContent!).w;
    expect(x - w / 2).toBeGreaterThanOrEqual(0);
    expect(y).toBeGreaterThanOrEqual(13);
    expect(y).toBeLessThanOrEqual(tiny.height - 13);
  });

  it("가전 도구 줄은 그 가전 말풍선의 칩 글(결과)이다", () => {
    const rows = traceRows("t4", (t) => { t.finish(t.start("device_tool", { object_id: FRIDGE }), "done", "device_ack"); });
    const { container } = render(traced(0, rows));
    const bubble = container.querySelector<HTMLElement>(`[data-check="${FRIDGE}"]`)!;
    expect(bubble).not.toBeNull();
    expect(bubble).toHaveAttribute("data-trace-mark");
    expect(bubble.getAttribute("aria-label") ?? bubble.textContent).toContain("가전 응답 확인");
  });

  it("행동 선택·VLM 장면 해석 줄만 있으면 트윈에 트레이스 표시가 없다", () => {
    const rows = traceRows("t5", (t) => { t.finish(t.start("vlm"), "done", "scene_objects"); t.start("pam", { decision_id: "pam-1" }); });
    const { container } = render(traced(3, rows));
    expect(container.querySelector("[data-trace-mark], [data-trace-line], [data-trace-dot]")).toBeNull();
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
    requestRender: vi.fn(), layoutChanged: vi.fn(), resize: vi.fn(), dispose: vi.fn(),
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

  it("?debug=steps면 트윈 위 표시도 그 순간 것이고 서버 계획은 쓰지 않는다: 순간 3은 클로이드 원뿔·주방 묶음, 순간 0은 집 전체. 계획 순간에는 Agent Trace 이동 안내 줄의 길이 있고, 번호·사람 이름표·두뇌 말풍선은 없다", async () => {
    history.replaceState(null, "", "/?debug=steps&step=3");
    const { container } = render(<Dashboard />);
    await waitFor(() => expect(load).toHaveBeenCalled());
    await waitFor(() => expect(engine.setEye.mock.calls.at(-1)?.[0]).toEqual(moment(3).eye));
    // 표시 판의 클로이드 자리는 엔진이 원뿔을 그리는 자리(stand)로 묻고, 엔진에는 받은 눈을 그대로 넣는다
    expect(engine.stand.mock.calls.at(-1)?.[0]).toEqual(moment(3).eye!.position);
    // 이동 안내 줄의 길: 지금 싱크대로 가는 구간(now)과 지난 식탁 구간(done). 계획 번호는 그리지 않는다
    expect([...container.querySelectorAll<HTMLElement>("[data-map-plate] [data-trace-leg]")].map((e) => e.dataset.line).sort()).toEqual(["done", "now"]);
    expect(container.querySelector("[data-stop]")).toBeNull();
    // 두뇌 「확인」 말풍선은 트윈에 없다(5-1)
    expect(container.querySelector(`[data-check="${SINK}"], [data-mark="${SINK}"]`)).toBeNull();
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
    await waitFor(() => expect(engine.setEye.mock.calls.at(-1)![0]).toEqual(moment(0).eye));
    expect(container.querySelector("[data-person-tag], [data-check], [data-trace-leg]")).toBeNull();
    expect(engine.setEye.mock.calls.at(-1)![0]).toEqual(moment(0).eye);
    expect(container.querySelector("[data-robot]")).toBeNull();
    expect(lit()).toEqual([]);
    // 지켜보기는 클로이드가 있는 방과 그 원뿔을 빈 곳 가운데에 당겨 보인다(2026-11-19 사용자 「트윈이 너무 멀어 … 화면 중앙에 확대」)
    const watching = engine.setView.mock.calls.at(-1)![0];
    expect(watching).not.toEqual(moved[0]);
    expect(showsRobot(watching, 0)).toBe(true);
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

  it("계획·맞춘 눈이 오면 밝힌 방을 바꾸고 3D 원뿔이 맞춘 눈을 따르며 카메라가 그 단계로 옮긴다. 길은 이동 안내 트레이스 줄이 와야 그린다", async () => {
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
      FakeSocket.last!.push({ type: "hello", devices: 0, provider: null, hub: "memory", home: "mokryeon_180b", trace_epoch: "p1" });
      FakeSocket.last!.push({ type: "plan", plan });
      FakeSocket.last!.push({ type: "eye", eye });
    });
    await waitFor(() => expect(engine.setEye.mock.calls.at(-1)?.[0]).toEqual(eye));
    expect(container.querySelector("[data-map-plate] [data-line], [data-stop]")).toBeNull();
    act(() => FakeSocket.last!.push({ type: "trace", epoch: "p1", rows: moveRows() }));
    await waitFor(() => expect([...container.querySelectorAll<HTMLElement>("[data-map-plate] [data-line]")].map((l) => l.dataset.line)).toEqual(["done", "now"]));
    expect(container.querySelector("[data-stop]")).toBeNull();
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
    // 계획이 끝나면 어둡게 한 층이 없어진다
    act(() => FakeSocket.last!.push({ type: "plan", plan: { ...plan!, revision: plan!.revision + 1, status: "done" } }));
    await waitFor(() => expect(container.querySelector("[data-map-dim]")).toBeNull());
  });

  it("트레이스 메시지가 오면 트윈 칸에 그 줄의 표시(data-trace-mark)가 보인다", async () => {
    const { container } = render(<Dashboard />);
    await waitFor(() => expect(load).toHaveBeenCalled());
    await waitFor(() => expect(FakeSocket.last).not.toBeNull());
    await waitFor(() => expect(container.querySelector("[data-map-plate]")).not.toBeNull());
    const rows = traceRows("w1", (t) => { t.start("closer", { request_id: "r1", object_id: SINK }); });
    act(() => {
      FakeSocket.last!.push({ type: "hello", devices: 0, provider: null, hub: "memory", home: "mokryeon_180b", trace_epoch: "w1" });
      FakeSocket.last!.push({ type: "eye", eye: moment(0).eye });
      FakeSocket.last!.push({ type: "trace", epoch: "w1", rows });
    });
    await waitFor(() => expect(container.querySelector('[aria-label="3D 트윈"] [data-trace-mark]')).not.toBeNull());
    expect(container.querySelector('[aria-label="3D 트윈"] [data-trace-mark]')!.textContent).toBe("근접 관찰 · 결과 대기 중");
    // 트레이스 칸의 같은 줄에 트윈 표시와 같은 색 점(data-on-twin)이 붙는다
    const row = rows[0]!.id;
    await waitFor(() => expect(container.querySelector(`[data-row="${row}"][data-on-twin]`)).not.toBeNull());
    expect(container.querySelector(`[data-row="${row}"] [data-twin-dot]`)).toHaveAttribute("data-variant", "brand");
  });
});
