// @vitest-environment node
// 트윈 지도 카메라: 트윈이 화면 전체라 구운 보기 그림(1920×1536)보다 옆으로 넓다. 지켜보기는 집 전체(모든 방)를, 계획 단계는 그 단계에 중요한 것(목적지·클로이드·확인한 것·지금 길·말풍선·방 이름표)을
// 지도 카메라 칸(focus) 안, 얹은 것(말풍선 카드·마스코트·미니맵·생각 말풍선) 밑이 아닌 곳에 맞춘다. 그림 밖은 3D 장면 바탕이라 비워 둬도 된다. 가장자리 표시 흐리기, 길을 가리는 말풍선 빼기, 방 이름표 자리.
import { describe, expect, it } from "vitest";
import type { Check } from "../../src/checks/checks";
import { coverScale, focusOf, HOME_ZOOM, homeCamera, legOf, livedOf, still, toScreen, wholeOf, wideCamera } from "../../src/dashboard/camera";
import { BUBBLE_BOX, clearOfRoute, edgeFade } from "../../src/dashboard/checks";
import { twinFrame } from "../../src/dashboard/frame";
import { avoidBoxes, placeLabel } from "../../src/dashboard/labels";
import { pageLayout, type Rect } from "../../src/dashboard/layout";
import { MASCOT } from "../../src/dashboard/mascot-image";
import { LABEL_BOX, mapScene, type Box } from "../../src/dashboard/scene";
import type { ScreenPoint } from "../../src/twin/use-anchors";
import { conePixelBox } from "../../src/twin/3d/eye";
import { anchorOf, CAM, HOME, IMAGE, moment, PLAN_CHECKS } from "./cup-run";

const hit = (a: Box, b: Box) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;
const around = (p: { x: number; y: number }, r: number): Box => ({ x0: p.x - r, y0: p.y - r, x1: p.x + r, y1: p.y + r });
const inside = (p: { x: number; y: number }, b: Box) => p.x >= b.x0 && p.x <= b.x1 && p.y >= b.y0 && p.y <= b.y1;
/** 목적지(둘레 24) 표시 반지름(px). */
const TARGET_R = 26;
/** 클로이드 3D 원뿔이 화면에서 차지하는 상자: 순간 n의 눈으로 잰 꼭짓점 공 ~ 원뿔 넓은 끝(conePixelBox)을 상자 px로. */
function coneBox(n: number, cam: { cx: number; cy: number; scale: number }, box: { width: number; height: number }): Box {
  const b = conePixelBox(CAM, moment(n).eye);
  const [a, c] = [toScreen(cam, box, [b.x0, b.y0]), toScreen(cam, box, [b.x1, b.y1])];
  return { x0: a.x, y0: a.y, x1: c.x, y1: c.y };
}
/** 길 선 반 굵기(px). */
const LINE_R = 6;

const checksAt = (n: number) => (n > 0 ? PLAN_CHECKS : []);
const frameAt = (n: number) => twinFrame({ ...moment(n), checks: checksAt(n), anchor: anchorOf, home: HOME, cam: CAM });

describe.each([[1920, 1080], [1440, 900]])("%i×%i", (width, height) => {
  const L = pageLayout({ width, height }, MASCOT);
  const box = { width: L.twin.width, height: L.twin.height };
  const toTwin = (r: Rect): Box => ({ x0: r.left - L.twin.left, y0: r.top - L.twin.top, x1: r.left + r.width - L.twin.left, y1: r.top + r.height - L.twin.top });
  const blocked = L.blocked.map(toTwin);
  const focus = toTwin(L.focus);
  const view = (n: number) => {
    const frame = frameAt(n);
    const f = focusOf(frame, HOME.shapes);
    return { frame, cam: f ? wideCamera(IMAGE, box, f, L.camPad, WHOLE) : homeCamera(box, WHOLE, LIVED, L.camPad) };
  };
  const WHOLE = wholeOf(HOME.shapes)!;
  const LIVED = livedOf(HOME.shapes)!;
  const far = wideCamera(IMAGE, box, null, L.camPad, WHOLE);

  it("집 전체는 모든 방(바닥·벽 위)을 담는 그림 픽셀 상자다", () => {
    for (const r of HOME.shapes) for (const [u, v] of [...r.floor, ...r.top]) {
      expect(u >= WHOLE.x0 && u <= WHOLE.x1 && v >= WHOLE.y0 && v <= WHOLE.y1, r.id).toBe(true);
    }
  });

  it("가장 먼 보기(단계 보기의 배율 하한)는 집 전체가 지도 카메라 칸에 다 드는 보기다", () => {
    const [a, b] = [toScreen(far, box, [WHOLE.x0, WHOLE.y0]), toScreen(far, box, [WHOLE.x1, WHOLE.y1])];
    expect(a.x).toBeGreaterThanOrEqual(focus.x0 - 1e-6);
    expect(a.y).toBeGreaterThanOrEqual(focus.y0 - 1e-6);
    expect(b.x).toBeLessThanOrEqual(focus.x1 + 1e-6);
    expect(b.y).toBeLessThanOrEqual(focus.y1 + 1e-6);
  });

  it("사람이 있는 방은 거실·주방·식당이다", () => {
    const want = HOME.shapes.filter((r) => ["living", "kitchen"].includes(r.id));
    expect(want).toHaveLength(2);
    for (const r of want) for (const [u, v] of [...r.floor, ...r.top]) expect(u >= LIVED.x0 && u <= LIVED.x1 && v >= LIVED.y0 && v <= LIVED.y1, r.id).toBe(true);
    expect(LIVED.x1 - LIVED.x0).toBeLessThan(WHOLE.x1 - WHOLE.x0);
  });

  it("순간 0(지켜보기, 계획 없음) 기본 보기는 집 전체 보기보다 HOME_ZOOM배 당긴다: 집이 화면을 더 채우고, 사람이 있는 방(거실·주방·식당)은 지도 카메라 칸 안이라 미니맵·생각 말풍선·말풍선 카드·진행 칩 밑에 깔리지 않는다", () => {
    const { cam } = view(0);
    expect(focusOf(frameAt(0), HOME.shapes)).toBeNull();
    expect(HOME_ZOOM).toBe(1.3);
    expect(cam.scale).toBeCloseTo(far.scale * HOME_ZOOM, 9);
    const [a, b] = [toScreen(cam, box, [LIVED.x0, LIVED.y0]), toScreen(cam, box, [LIVED.x1, LIVED.y1])];
    const lived: Box = { x0: a.x, y0: a.y, x1: b.x, y1: b.y };
    expect(lived.x0).toBeGreaterThanOrEqual(focus.x0 - 1e-6);
    expect(lived.y0).toBeGreaterThanOrEqual(focus.y0 - 1e-6);
    expect(lived.x1).toBeLessThanOrEqual(focus.x1 + 1e-6);
    expect(lived.y1).toBeLessThanOrEqual(focus.y1 + 1e-6);
    for (const k of blocked) expect(hit(lived, k)).toBe(false);
    // 집 왼쪽 끝은 트윈 안이다(옆으로는 잘리지 않는다). 위아래는 조금 잘려도 된다
    const [h0, h1] = [toScreen(cam, box, [WHOLE.x0, WHOLE.y0]), toScreen(cam, box, [WHOLE.x1, WHOLE.y1])];
    expect(h0.x).toBeGreaterThanOrEqual(-1e-6);
    expect(h1.x).toBeLessThanOrEqual(box.width + 1e-6);
    expect(Math.max(0, -h0.y) + Math.max(0, h1.y - box.height)).toBeLessThan(box.height * 0.1);
  });

  it("사람이 있는 방이 칸보다 커지는 배율로는 당기지 않는다", () => {
    const tight = { top: 300, right: 900, bottom: 300, left: 300 };
    const c = homeCamera(box, WHOLE, LIVED, tight);
    const fit = Math.min((box.width - 1200) / (LIVED.x1 - LIVED.x0), (box.height - 600) / (LIVED.y1 - LIVED.y0));
    expect(c.scale).toBeLessThanOrEqual(fit + 1e-9);
  });

  it.each([0, 1, 2, 3, 4])("순간 %i: 카메라 배율은 집 전체를 보이는 배율 이상이다(집 전체보다 멀어지지 않는다)", (n) => {
    expect(view(n).cam.scale).toBeGreaterThanOrEqual(far.scale - 1e-9);
  });

  it("집 전체를 모르면(whole 없음) 예전처럼 그림이 상자를 빈 곳 없이 덮는다: 그림 가운데, 덮는 배율", () => {
    expect(wideCamera(IMAGE, box, null, L.camPad)).toEqual({ cx: IMAGE.width / 2, cy: IMAGE.height / 2, scale: coverScale(IMAGE, box) });
  });

  it.each([1, 2, 3, 4])("순간 %i: 목적지·클로이드 원뿔·그 단계 대상(확인한 것)이 지도 카메라 칸 안이고, 보이는 확인한 것은 말풍선 카드·마스코트 밑에 없다", (n) => {
    const { frame, cam } = view(n);
    const goal = frame.step?.target?.objectId ?? frame.step?.target?.deviceId;
    const mark = frame.marks.find((m) => m.id === goal);
    expect(mark, "그 단계 대상 표시").toBeDefined();
    const parts: [string, { x: number; y: number }, Box][] = [];
    const at = (name: string, p: { x: number; y: number }, r: number) => parts.push([name, p, around(p, r)]);
    at("그 단계 대상", toScreen(cam, box, mark!.px), 9);
    if (frame.target) at("목적지", toScreen(cam, box, frame.target), TARGET_R);
    if (frame.robot) parts.push(["클로이드 원뿔", toScreen(cam, box, frame.robot.px), coneBox(n, cam, box)]);
    for (const [name, p, b0] of parts) {
      expect(inside(p, focus), `${name}이 지도 카메라 칸 밖`).toBe(true);
      for (const b of blocked) expect(hit(b0, b), `${name}이 말풍선 카드·마스코트 밑`).toBe(false);
    }
    // 다른 단계의 확인한 것은 카메라가 맞추지 않는다(상자 밖이면 안 보인다). 보이면 가린 자리 밑이 아니다
    for (const m of frame.marks) {
      const p = toScreen(cam, box, m.px);
      if (!inside(p, { x0: 0, y0: 0, x1: box.width, y1: box.height })) continue;
      for (const b of blocked) expect(hit(around(p, 9), b), `확인한 것 ${m.id}이 말풍선 카드·마스코트 밑`).toBe(false);
    }
  });

  it.each([0, 1, 2, 3, 4])("순간 %i: 지금 길, 확인한 기기 말풍선, 방 이름표가 트윈 안에 있고 말풍선 카드·마스코트 밑에 없다", (n) => {
    const { frame, cam } = view(n);
    const scene = mapScene(frame, checksAt(n), HOME.shapes, box, cam, blocked);
    const card: Box = { x0: 0, y0: 0, x1: box.width, y1: box.height };
    const parts: [string, Box][] = [];
    if (frame.robot) parts.push(["클로이드 원뿔", coneBox(n, cam, box)]);
    const leg = legOf(frame);
    for (const p of leg ? frame.route.points.slice(leg.from, leg.to + 1) : []) parts.push(["길", around(toScreen(cam, box, p), LINE_R)]);
    for (const c of scene.checks) {
      const p = scene.points.get(c.deviceId ?? c.objectId ?? "")!;
      parts.push([`말풍선 ${c.deviceId ?? c.objectId}`, { x0: p.x - BUBBLE_BOX.w / 2, y0: p.y - BUBBLE_BOX.h, x1: p.x + BUBBLE_BOX.w / 2, y1: p.y + 9 }]);
    }
    for (const l of scene.labels) parts.push([`방 ${l.label}`, { x0: l.at.x - LABEL_BOX.w / 2, y0: l.at.y - LABEL_BOX.h / 2, x1: l.at.x + LABEL_BOX.w / 2, y1: l.at.y + LABEL_BOX.h / 2 }]);
    expect(parts.length).toBeGreaterThan(0);
    for (const [name, b] of parts) {
      for (const k of blocked) expect(hit(b, k), `${name}이 말풍선 카드·마스코트 밑`).toBe(false);
      expect(hit(b, card), `${name}이 트윈 밖`).toBe(true);
    }
  });

  it.each([0, 1, 2, 3, 4])("순간 %i: 카메라를 맞춘 것만으로 말풍선이 비켜 있어 빠지는 것이 없고, 밝힌 방 이름표도 다 있다. 지켜보는 순간 0에는 말풍선이 없다", (n) => {
    const { frame, cam } = view(n);
    const free = mapScene(frame, checksAt(n), HOME.shapes, box, cam, []);
    const kept = mapScene(frame, checksAt(n), HOME.shapes, box, cam, blocked);
    expect(kept.checks.map((c) => c.key)).toEqual(free.checks.map((c) => c.key));
    expect(kept.checks.length > 0).toBe(n > 0);
    expect(kept.labels.map((l) => l.id).sort()).toEqual([...frame.rooms].sort());
  });

  it.each([1, 2, 3, 4])("순간 %i: 말풍선이 덮지 않을 자리(keep)에 클로이드 원뿔 전체(꼭짓점 공 ~ 넓은 끝)와 목적지 표시 둘레가 다 들어 있다", (n) => {
    const { frame, cam } = view(n);
    const scene = mapScene(frame, checksAt(n), HOME.shapes, box, cam, blocked);
    const covers = (b: Box) => scene.keep.some((k) => k.left <= b.x0 + 0.5 && k.top <= b.y0 + 0.5 && k.right >= b.x1 - 0.5 && k.bottom >= b.y1 - 0.5);
    if (frame.robot) expect(covers(coneBox(n, cam, box)), "클로이드 원뿔").toBe(true);
    if (frame.target) expect(covers(around(toScreen(cam, box, frame.target), 24)), "목적지").toBe(true);
    expect(scene.keep.length).toBe(Number(!!frame.robot) + Number(!!frame.target));
  });
});

describe("작은 눈 움직임", () => {
  it("가운데가 화면 6 px 안, 배율이 1.5% 안이면 카메라를 그대로 둔다", () => {
    const a = { cx: 900, cy: 700, scale: 1 };
    expect(still(a, { cx: 905, cy: 700, scale: 1.01 })).toBe(true);
    expect(still(a, { cx: 907, cy: 700, scale: 1 })).toBe(false);
    expect(still(a, { cx: 900, cy: 700, scale: 1.02 })).toBe(false);
  });
});

const obj = (id: string, order: number): Check => ({ key: `object:${id}`, order, source: "agent", objectId: id, verb: "확인", at: 0 });
const pt = (x: number, y: number): ScreenPoint => ({ x, y, visible: true });

describe("가장자리 표시", () => {
  const box = { width: 400, height: 225 };
  it("표시 원이 상자 가장자리에 걸리면 지우고, 충분히 안쪽이면 다 보인다", () => {
    expect(edgeFade({ x: 6, y: 100 }, box, 10)).toBe(0);
    expect(edgeFade({ x: 200, y: 222 }, box, 10)).toBe(0);
    expect(edgeFade({ x: 200, y: 100 }, box, 10)).toBe(1);
  });

  it("가장자리 쪽으로 갈수록 서서히 흐려진다", () => {
    const a = edgeFade({ x: 200, y: 218 - 16 }, box, 10);
    const b = edgeFade({ x: 200, y: 218 - 8 }, box, 10);
    expect(a).toBeGreaterThan(b);
    expect(b).toBeGreaterThan(0);
    expect(a).toBeLessThan(1);
  });
});

describe("말풍선과 지금 갈 길", () => {
  it("꼬리 끝 위 말풍선 자리가 지금 갈 길에 걸리면 빼고, 비켜 있으면 둔다", () => {
    const checks = [obj("cup", 2), obj("table", 1)];
    const points = new Map([["cup", pt(300, 300)], ["table", pt(600, 300)]]);
    const route: [number, number][] = [[300, 300], [305, 200], [320, 120]];
    expect(clearOfRoute(checks, points, route).map((c) => c.objectId)).toEqual(["table"]);
  });

  it("길이 꼬리 끝에서 옆이나 아래로 가면 말풍선을 둔다", () => {
    const checks = [obj("cup", 2)];
    const points = new Map([["cup", pt(300, 300)]]);
    expect(clearOfRoute(checks, points, [[300, 300], [300, 420], [500, 440]]).map((c) => c.objectId)).toEqual(["cup"]);
    expect(clearOfRoute(checks, points, []).map((c) => c.objectId)).toEqual(["cup"]);
  });

  it("말풍선 자리는 디자인 시스템 전 크기(가로 약 170px)다: 꼬리 끝에서 옆으로 100px 지나는 길은 가리지 않는다", () => {
    const checks = [obj("cup", 2)];
    const points = new Map([["cup", pt(300, 300)]]);
    expect(clearOfRoute(checks, points, [[400, 320], [400, 200]]).map((c) => c.objectId)).toEqual(["cup"]);
  });
});

describe("방 이름표와 말풍선", () => {
  it("말풍선 꼬리 끝에서 옆으로 140px 떨어진 방 가운데에는 이름표를 그대로 둔다", () => {
    const avoid = avoidBoxes([{ x: 400, y: 300 }], []);
    expect(placeLabel({ x: 540, y: 270 }, avoid, { width: 1000, height: 800 })).toEqual({ x: 540, y: 270 });
  });

  it("말풍선 바로 위 방 가운데는 피해 옮긴다", () => {
    const avoid = avoidBoxes([{ x: 400, y: 300 }], []);
    expect(placeLabel({ x: 420, y: 270 }, avoid, { width: 1000, height: 800 })).not.toEqual({ x: 420, y: 270 });
  });
});
