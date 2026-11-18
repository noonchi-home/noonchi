// 트윈 지도 카메라(순수 함수, 시안 A에서 옮김). 맞출 곳의 가운데를 트윈이 가리지 않는 빈 곳(지도 카메라 칸) 가운데에 두고 빈 곳을 채우게 당긴다
// (2026-11-19 사용자 「지금 트윈이 너무 멀어. 3인칭일 때 화면 중앙에 확대되게 수정해」).
// 계획 전 지켜보기는 클로이드가 있는 방과 그 원뿔(watchFocus), 이동 중이면 지금 구간과 목적지 둘레, 서 있는 단계면 그 단계 대상과 클로이드를 맞춘다.
// 카메라는 「상자 가운데에 올 구운 보기 그림 픽셀 자리 + 배율」(twin/3d/view.ts MapCamera와 같음)이다.
import type { BoxSize } from "./fit";
import type { TwinFrame } from "./frame";
import type { RoomShape } from "./home";

export type Px = [number, number];
export interface Bounds { x0: number; y0: number; x1: number; y1: number }
export interface Camera { cx: number; cy: number; scale: number }
export interface Pad { top: number; right: number; bottom: number; left: number }

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** 이동 중 지도가 맞출 곳의 가장 작은 크기(그림 픽셀). 이보다 좁으면 가운데를 두고 넓힌다. */
export const MIN_FOCUS = { w: 440, h: 360 };
/** 목적지 방이 이보다 크면(거실처럼 집 절반) 맞출 곳에 넣지 않는다(그림 픽셀). */
export const ROOM_MAX = 640;
/** 그림을 이보다 크게 늘리지 않는다(흐려짐). */
export const MAX_SCALE = 1.3;
/** 집 전체 보기 배율에 곱하는 가장 큰 당김. 빈 곳을 채우는 배율이 대개 먼저 걸리고, 그림 MAX_SCALE이 그다음이다. */
export const MAX_ZOOM = 3.2;
/** 지켜보기 맞출 곳의 가장 작은 크기(그림 픽셀): 클로이드가 작은 방(욕실 등)에 있어도 둘레가 보인다. */
export const MIN_WATCH = { w: 640, h: 520 };

export function boundsOf(points: Px[]): Bounds | null {
  if (points.length === 0) return null;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [u, v] of points) {
    x0 = Math.min(x0, u); y0 = Math.min(y0, v); x1 = Math.max(x1, u); y1 = Math.max(y1, v);
  }
  return { x0, y0, x1, y1 };
}

/** 지금 단계의 이동 구간. 이동 단계가 아니면 다음 이동 구간, 없으면(계획 전 지켜보기 포함) null. */
export function legOf(frame: TwinFrame): { from: number; to: number; now: boolean } | null {
  const { plan, step } = frame;
  if (!plan || !step) return null;
  const order = (id: string) => plan.steps.findIndex((s) => s.id === id);
  const now = frame.route.legs.find((l) => l.stepId === step.id);
  if (now) return { from: now.from, to: now.to, now: true };
  const next = frame.route.legs.find((l) => order(l.stepId) > order(step.id));
  return next ? { from: next.from, to: next.to, now: false } : null;
}

/** 가운데를 두고 min 크기까지 넓힌다. */
export function atLeast(b: Bounds | null, min: { w: number; h: number }): Bounds | null {
  if (!b) return null;
  const w = Math.max(b.x1 - b.x0, min.w);
  const h = Math.max(b.y1 - b.y0, min.h);
  const cx = (b.x0 + b.x1) / 2;
  const cy = (b.y0 + b.y1) / 2;
  return { x0: cx - w / 2, y0: cy - h / 2, x1: cx + w / 2, y1: cy + h / 2 };
}

/** 이동 중 맞출 곳: 지금 구간 전체, 목적지, 목적지 물건, 작은 목적지 방. 구간 전체라 이동하는 동안 지도가 흔들리지 않는다. */
function moveFocus(frame: TwinFrame, shapes: RoomShape[], leg: { from: number; to: number }): Bounds | null {
  const pts: Px[] = frame.route.points.slice(leg.from, leg.to + 1);
  if (frame.target) pts.push(frame.target);
  const goal = frame.step?.target;
  const room = goal?.room ? shapes.find((s) => s.id === goal.room) : undefined;
  const roomBox = room ? boundsOf([...room.floor, ...room.top]) : null;
  if (room && roomBox && roomBox.x1 - roomBox.x0 <= ROOM_MAX && roomBox.y1 - roomBox.y0 <= ROOM_MAX) pts.push(...room.floor, ...room.top);
  const id = goal?.deviceId ?? goal?.objectId;
  const mark = id ? frame.marks.find((m) => m.id === id) : undefined;
  if (mark) pts.push(mark.px);
  return atLeast(boundsOf(pts), MIN_FOCUS);
}

/**
 * 지도가 맞출 곳. 계획 전 지켜보기(열린 계획 없음)는 null(watchFocus). 이동 중이면 지금 구간과 목적지 둘레만(moveFocus).
 * 서 있는 단계면 확인한 것(그 단계 대상 포함)·다음 이동 길·목적지·클로이드(바닥 자리와 원뿔)이고, 그 둘레 MIN_FOCUS까지 넓힌다. 밝힐 방 전체는 넣지 않는다(더 가깝게).
 */
export function focusOf(frame: TwinFrame, shapes: RoomShape[]): Bounds | null {
  if (!frame.plan) return null;
  const now = legOf(frame);
  if (now?.now && frame.robot) return moveFocus(frame, shapes, now);
  const pts: Px[] = frame.marks.map((m) => m.px);
  if (now) pts.push(...frame.route.points.slice(now.from, now.to + 1));
  if (frame.target) pts.push(frame.target);
  if (frame.robot) pts.push(frame.robot.px, [frame.robot.body.x0, frame.robot.body.y0], [frame.robot.body.x1, frame.robot.body.y1]);
  return atLeast(boundsOf(pts), MIN_FOCUS);
}

/**
 * 계획 전 지켜보기가 맞출 곳: 클로이드(맞춘 눈)가 있는 방(바닥·벽 위)과 그 3D 원뿔, 사람 이름표 자리. 가운데를 두고 MIN_WATCH까지 넓힌다.
 * 눈을 모르면(맞추기 전) 사람이 있는 방(livedOf). 방이 없으면 null.
 */
export function watchFocus(frame: Pick<TwinFrame, "robot" | "planned">, shapes: RoomShape[]): Bounds | null {
  const r = frame.robot;
  if (!r) return livedOf(shapes);
  const pts: Px[] = [[r.body.x0, r.body.y0], [r.body.x1, r.body.y1]];
  const room = r.room ? shapes.find((s) => s.id === r.room) : undefined;
  if (room) pts.push(...room.floor, ...room.top);
  if (frame.planned.person) pts.push(frame.planned.person.px);
  return atLeast(boundsOf(pts), MIN_WATCH);
}

/** 그림이 상자를 빈 곳 없이 덮는 가장 작은 배율. */
export const coverScale = (image: BoxSize, box: BoxSize) =>
  image.width > 0 && image.height > 0 ? Math.max(box.width / image.width, box.height / image.height) : 0;

/** 그림 밖 빈 곳이 보이지 않게: 그 방향으로 그림이 상자보다 크면 가장자리 안으로, 작으면 가운데로. */
export function clampCamera(c: Camera, image: BoxSize, box: BoxSize): Camera {
  if (c.scale <= 0) return c;
  const keep = (len: number, view: number, v: number) => {
    const seen = view / c.scale;
    return seen >= len ? len / 2 : clamp(v, seen / 2, len - seen / 2);
  };
  return { scale: c.scale, cx: keep(image.width, box.width, c.cx), cy: keep(image.height, box.height, c.cy) };
}

/** 집 전체: 모든 방(바닥·벽 위)을 담는 그림 픽셀 상자. 방이 없으면 null. */
export const wholeOf = (shapes: RoomShape[]): Bounds | null => boundsOf(shapes.flatMap((s) => [...s.floor, ...s.top]));

/**
 * 지도: focus가 pad 안쪽(빈 곳)에 다 보이게, focus 가운데를 pad 안쪽 가운데에 두고 빈 곳을 채우는 배율로 당긴다.
 * whole(집 전체)이 있으면 가장 먼 보기는 집 전체가 pad 안쪽에 다 보이는 배율이고, focus가 없으면 그 보기다. 그 배율의 maxZoom배, 그림 MAX_SCALE배까지 당긴다.
 *   트윈 칸이 그림보다 옆으로 넓어 그림 밖(3D 장면 바탕)이 보여도 된다: 얹은 것(미니맵·말풍선) 밑에 집이 깔리지 않는 것이 먼저다.
 * whole이 없으면 그림이 상자를 빈 곳 없이 덮는 배율(cover)부터이고, 그림 가장자리가 상자 안으로 들어오지 않게 가운데를 당긴다(clampCamera).
 */
export function wideCamera(image: BoxSize, box: BoxSize, focus: Bounds | null, pad: Pad, whole: Bounds | null = null, maxZoom = MAX_ZOOM): Camera {
  const c0 = coverScale(image, box);
  const aw = Math.max(1, box.width - pad.left - pad.right);
  const ah = Math.max(1, box.height - pad.top - pad.bottom);
  const fit = (b: Bounds) => Math.min(aw / Math.max(1, b.x1 - b.x0), ah / Math.max(1, b.y1 - b.y0));
  const target = focus ?? whole;
  if (!target || c0 <= 0) return { cx: image.width / 2, cy: image.height / 2, scale: c0 };
  const base = whole ? fit(whole) : c0;
  const scale = clamp(fit(target), base, Math.max(base, Math.min(base * maxZoom, MAX_SCALE)));
  // target 가운데를 pad 안쪽 가운데에 둔다
  const cx = (target.x0 + target.x1) / 2 + (box.width / 2 - (pad.left + aw / 2)) / scale;
  const cy = (target.y0 + target.y1) / 2 + (box.height / 2 - (pad.top + ah / 2)) / scale;
  return whole ? { cx, cy, scale } : clampCamera({ cx, cy, scale }, image, box);
}

/** 사람이 있는 방(방 id): 거실·주방·식당. 눈을 모를 때 지켜보기가 맞춘다. */
const LIVED_ROOM = /^(living|kitchen|dining)/;
/** 사람이 있는 방을 담는 그림 픽셀 상자. 그런 방이 없으면 집 전체, 방이 없으면 null. */
export function livedOf(shapes: RoomShape[]): Bounds | null {
  const lived = shapes.filter((s) => LIVED_ROOM.test(s.id));
  return wholeOf(lived.length ? lived : shapes);
}

/** 카메라를 그대로 두는 차이: 가운데가 화면에서 px 안, 배율이 ratio 몫 안. 클로이드가 조금 움직일 때마다 지도를 다시 맞추지 않는다. */
export const STILL = { px: 6, ratio: 0.015 };
export const still = (a: Camera, b: Camera) =>
  a.scale > 0 && b.scale > 0 && Math.abs(a.scale / b.scale - 1) < STILL.ratio && Math.hypot(a.cx - b.cx, a.cy - b.cy) * b.scale < STILL.px;

/** 그림 픽셀 → 상자 안 자리. */
export const toScreen = (c: Camera, box: BoxSize, [u, v]: Px) => ({ x: box.width / 2 + (u - c.cx) * c.scale, y: box.height / 2 + (v - c.cy) * c.scale });
