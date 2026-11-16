// 집 평면도(scene.json plan.rooms·plan.walls)와 평면 도우미. 폰 위치 맞추기(src/phone/sync)·World State·폰 서버가 쓴다.
// - 방 쪽 벽 면(roomFaces): 방 다각형은 벽 중심선이라 면은 뷰어 snapToWall과 같게 구한다. 벽은 중심선 + 법선 × 두께/2,
//   고체(샤프트·기둥)는 법선이 같은 다각형 변. 여러 방이 함께 쓰는 벽 면은 그 방과 맞닿고 고체에 가리지 않은 구간으로 자른다.
// - 점이 든 방의 바닥 높이(floorLookup), 집 범위(homeBounds·inBounds), 다각형 안(insidePolygon), 눈높이(eyeHeightOf).

import { readFileSync } from "node:fs";
import type { Plan2 } from "../shared/geometry.js";

export interface PlanRoom {
  id?: string;
  label?: string;
  polygon?: number[][];
  floor_z?: number;
}

export interface PlanWall {
  id?: string;
  thickness?: number | null;
  a?: number[] | null;
  b?: number[] | null;
  polygon?: number[][] | null;
  faces?: { room: string; normal: number[] }[];
}

/** scene.json plan 중 방·벽. */
export interface HomePlan {
  rooms: PlanRoom[];
  walls: PlanWall[];
}

/** 방 쪽 벽 면 한 조각(위치 맞추기 벽 모양 짝, src/phone/sync/walls.ts): a → b, 법선 n은 방 안쪽(길이 1). */
export interface RoomFace {
  room: string;
  a: Plan2;
  b: Plan2;
  n: Plan2;
}

export interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/** 바닥 hit이 없을 때 폰 높이에서 빼는 눈높이(m, PHONE_EYE_HEIGHT_M). */
export const DEFAULT_EYE_HEIGHT_M = 1.5;
/** 집 범위는 방 다각형 경계 상자에서 이만큼 밖까지 받는다(바깥벽 두께). */
export const BOUNDS_MARGIN_M = 0.3;

type V = [number, number];
/** 방 쪽 벽 면 한 조각: a에서 t 방향으로 len, 법선 n은 방 안쪽. */
interface Face {
  room: string;
  a: V;
  t: V;
  len: number;
  n: V;
}

/** 면을 방 쪽으로 이만큼 들어간 점으로 방 안인지 본다(뷰어 좌표는 mm 반올림). */
const ON_FACE_M = 0.01;

const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const isPair = (v: unknown): v is number[] => Array.isArray(v) && v.length >= 2 && finite(v[0]) && finite(v[1]);
const dot = (a: V, b: V) => a[0] * b[0] + a[1] * b[1];
const cross = (a: V, b: V) => a[0] * b[1] - a[1] * b[0];
const along = (p: V, d: V, s: number): V => [p[0] + d[0] * s, p[1] + d[1] * s];
const unit = (v: number[]): V | null => {
  const l = Math.hypot(v[0]!, v[1]!);
  return l > 1e-9 ? [v[0]! / l, v[1]! / l] : null;
};

export function eyeHeightOf(raw: string | undefined): number {
  const h = Number(raw);
  return raw !== undefined && raw.trim() !== "" && Number.isFinite(h) && h >= 0.3 && h <= 2.5 ? h : DEFAULT_EYE_HEIGHT_M;
}

/** 방 다각형 전체의 경계 상자 + 여유. 방이 없으면 null(범위 검사 안 함). */
export function homeBounds(rooms: { polygon?: number[][] }[]): Bounds | null {
  const pts = rooms.flatMap((r) => r.polygon ?? []).filter((p) => Number.isFinite(p[0]) && Number.isFinite(p[1]));
  if (pts.length === 0) return null;
  const xs = pts.map((p) => p[0]!), ys = pts.map((p) => p[1]!);
  const m = BOUNDS_MARGIN_M;
  return { minX: Math.min(...xs) - m, minY: Math.min(...ys) - m, maxX: Math.max(...xs) + m, maxY: Math.max(...ys) + m };
}

/** 집 범위 안인지. 범위가 없으면 늘 안. */
export function inBounds([x, y]: Plan2, bounds: Bounds | null): boolean {
  return !bounds || (x >= bounds.minX && x <= bounds.maxX && y >= bounds.minY && y <= bounds.maxY);
}

/** 평면 점이 다각형 안인지(짝홀 규칙). */
export function insidePolygon([x, y]: Plan2, poly: number[][]): boolean {
  let hit = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i]!, [xj, yj] = poly[j]!;
    if ((yi! > y) !== (yj! > y) && x < ((xj! - xi!) * (y - yi!)) / (yj! - yi!) + xi!) hit = !hit;
  }
  return hit;
}

/** 평면 점이 들어 있는 방의 바닥 높이(floor_z). 어느 방에도 없으면 0. */
export function floorLookup(rooms: { polygon?: number[][]; floor_z?: number }[]): (p: Plan2) => number {
  return (p) => {
    const room = rooms.find((r) => r.polygon && insidePolygon(p, r.polygon));
    return typeof room?.floor_z === "number" && Number.isFinite(room.floor_z) ? room.floor_z : 0;
  };
}

/** scene.json의 plan.rooms·plan.walls. 읽지 못하면 빈 목록. */
export function readScenePlan(scenePath: string): HomePlan {
  try {
    const scene = JSON.parse(readFileSync(scenePath, "utf8").replace(/^﻿/, "")) as { plan?: Partial<HomePlan> } | null;
    const plan = scene?.plan ?? {};
    return { rooms: Array.isArray(plan.rooms) ? plan.rooms : [], walls: Array.isArray(plan.walls) ? plan.walls : [] };
  } catch {
    return { rooms: [], walls: [] };
  }
}

function faceOf(room: string, p: V, q: V, n: V): Face | null {
  const len = Math.hypot(q[0] - p[0], q[1] - p[1]);
  return len > 1e-6 ? { room, a: p, t: [(q[0] - p[0]) / len, (q[1] - p[1]) / len], len, n } : null;
}

/** 고체(샤프트·기둥) 다각형들. */
function planSolids(plan: HomePlan): V[][] {
  return plan.walls
    .filter((w) => !(isPair(w.a) && isPair(w.b) && finite(w.thickness) && w.thickness > 0) && Array.isArray(w.polygon) && w.polygon.length >= 3 && w.polygon.every(isPair))
    .map((w) => w.polygon!.map((p) => [p[0]!, p[1]!] as V));
}

/** 면 f 중 방 쪽으로 1cm 들어간 점이 그 방 다각형 안이고 고체 밖인 구간들. 방 다각형이 없으면 그대로. */
function clipToRoom(f: Face, polygon: number[][] | undefined, solids: V[][]): Face[] {
  if (!Array.isArray(polygon) || polygon.length < 3 || !polygon.every(isPair)) return [f];
  const o = along(f.a, f.n, ON_FACE_M);
  const cuts = [0, f.len];
  for (const poly of [polygon, ...solids]) {
    for (let i = 0; i < poly.length; i++) {
      const p = poly[i]!, q = poly[(i + 1) % poly.length]!;
      const e: V = [q[0]! - p[0]!, q[1]! - p[1]!];
      const c = cross(f.t, e);
      if (Math.abs(c) < 1e-12) continue;
      const w: V = [p[0]! - o[0], p[1]! - o[1]];
      const s = cross(w, e) / c, u = cross(w, f.t) / c;
      if (u >= 0 && u <= 1 && s > 0 && s < f.len) cuts.push(s);
    }
  }
  cuts.sort((x, y) => x - y);
  const spans: V[] = [];
  for (let i = 0; i + 1 < cuts.length; i++) {
    const s1 = cuts[i]!, s2 = cuts[i + 1]!;
    if (s2 - s1 < 1e-9) continue;
    const mid = along(o, f.t, (s1 + s2) / 2);
    if (!insidePolygon(mid, polygon) || solids.some((s) => insidePolygon(mid, s))) continue;
    const last = spans.at(-1);
    if (last && s1 - last[1] < 1e-9) last[1] = s2;
    else spans.push([s1, s2]);
  }
  return spans.flatMap(([s1, s2]) => faceOf(f.room, along(f.a, f.t, s1), along(f.a, f.t, s2), f.n) ?? []);
}

/** 평면도의 모든 방 쪽 면. */
function planFaces(plan: HomePlan): Face[] {
  const out: Face[] = [];
  const push = (f: Face | null) => { if (f) out.push(f); };
  for (const w of plan.walls) {
    for (const f of w.faces ?? []) {
      const n = typeof f?.room === "string" && isPair(f.normal) ? unit(f.normal) : null;
      if (!n) continue;
      if (isPair(w.a) && isPair(w.b) && finite(w.thickness) && w.thickness > 0) {
        const half = w.thickness / 2;
        push(faceOf(f.room, along([w.a[0]!, w.a[1]!], n, half), along([w.b[0]!, w.b[1]!], n, half), n));
      } else if (Array.isArray(w.polygon) && w.polygon.length >= 3 && w.polygon.every(isPair)) {
        const poly = w.polygon.map((p) => [p[0]!, p[1]!] as V);
        const sign = Math.sign(poly.reduce((s, p, i) => s + cross(p, poly[(i + 1) % poly.length]!), 0));
        for (let i = 0; i < poly.length; i++) {
          const p = poly[i]!, q = poly[(i + 1) % poly.length]!;
          const outward = unit([sign * (q[1] - p[1]), -sign * (q[0] - p[0])]);
          if (outward && dot(outward, n) >= 0.99) push(faceOf(f.room, p, q, n));
        }
      }
    }
  }
  return out;
}

/** 평면도의 모든 방 쪽 면을 그 방 다각형과 맞닿은 구간으로 자르고 고체(샤프트·기둥)에 가린 곳을 뺀 것. */
export function roomFaces(plan: HomePlan): RoomFace[] {
  const solids = planSolids(plan);
  const polygonOf = new Map(plan.rooms.map((r) => [r.id, r.polygon]));
  return planFaces(plan)
    .flatMap((f) => clipToRoom(f, polygonOf.get(f.room), solids))
    .map((f) => ({ room: f.room, a: [f.a[0], f.a[1]], b: along(f.a, f.t, f.len), n: [f.n[0], f.n[1]] }));
}
