// 벽 하나로 폰 기준점 A·B 구석 채우기(docs/superpowers/plans/2026-11-06-auto-corners.md).
// 방 다각형은 벽 중심선이라 구석은 방 쪽 벽 면끼리 만나는 점으로 구한다. 면은 뷰어 snapToWall과 같다:
// 벽은 중심선 + 법선 × 두께/2, 고체(샤프트·기둥)는 법선이 같은 다각형 변. 구석은 면 중 그 방과 맞닿고 고체에 가리지 않은
// 구간끼리만 구한다(여러 방이 함께 쓰는 벽).
// A: 누른 면을 따라 양쪽으로 가다 처음 만나는 같은 방 면과의 교점 중 가까운 것. B: 누른 점에서 방 안쪽으로 쏜 선이
// 방을 나가기 전에 닿는 맞은편 면의 구석 중 A에서 먼 것. 벽 가운데 점은 실제 집에서 정확히 찾기 어려워 구석을 쓴다.

import { readFileSync } from "node:fs";
import { z } from "zod";
import type { Plan2 } from "./align.js";
import { MAX_LABEL, TouchPointsError, inBounds, insidePolygon, parseTouchPoints, type Bounds, type TouchPoint } from "./touch.js";

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

/** 뷰어 startPick 결과: 방 쪽 벽 면 위 점. 방·법선은 없을 수 있다. */
export interface WallPick {
  position: Plan2;
  room?: string;
  normal?: Plan2;
}

type V = [number, number];
/** 방 쪽 벽 면 한 조각: a에서 t 방향으로 len, 법선 n은 방 안쪽. half는 벽 두께 절반(고체는 0). */
interface Face {
  room: string;
  a: V;
  t: V;
  len: number;
  n: V;
  half: number;
}

/** 면이 같은 줄인지·누른 점이 면 위인지 보는 허용(뷰어 좌표는 mm 반올림). */
const ON_FACE_M = 0.01;
/** 누른 점이 면에서 이보다 멀면 벽을 누른 것으로 보지 않는다. */
const PICK_MAX_M = 0.05;
/** 면 끝 이음 여유. */
const JOIN_M = 0.02;
/** 이보다 얕게 꺾이면(30°) 구석으로 보지 않는다. */
const MIN_TURN_SIN = 0.5;
/** 구석 위에 있다고 보는 거리. */
const SAME_S_M = 1e-4;
/** 맞은편을 찾는 선을 A 구석에서 이만큼 안쪽에서 쏜다. */
const RAY_INSET_M = 0.05;

const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const isPair = (v: unknown): v is number[] => Array.isArray(v) && v.length >= 2 && finite(v[0]) && finite(v[1]);
const dot = (a: V, b: V) => a[0] * b[0] + a[1] * b[1];
const cross = (a: V, b: V) => a[0] * b[1] - a[1] * b[0];
const sub = (a: V, b: V): V => [a[0] - b[0], a[1] - b[1]];
const along = (p: V, d: V, s: number): V => [p[0] + d[0] * s, p[1] + d[1] * s];
const dist = (a: V, b: V) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const unit = (v: number[]): V | null => {
  const l = Math.hypot(v[0]!, v[1]!);
  return l > 1e-9 ? [v[0]! / l, v[1]! / l] : null;
};
const mm = (v: number) => {
  const r = Math.round(v * 1000) / 1000;
  return r === 0 ? 0 : r;
};

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

const num = z.number().refine(Number.isFinite);
const PickSchema = z.object({ position: z.tuple([num, num]), room: z.string().optional(), normal: z.tuple([num, num]).optional() });

/** 요청 본문 {position, room?, normal?} → WallPick. 틀리면 TouchPointsError(한국어). */
export function parseWallPick(raw: unknown): WallPick {
  const parsed = PickSchema.safeParse(raw);
  if (!parsed.success) throw new TouchPointsError("벽 위치는 [x, y] 숫자 두 개여야 합니다");
  const { position, room, normal } = parsed.data;
  return { position: [position[0], position[1]], ...(room !== undefined ? { room } : {}), ...(normal ? { normal: [normal[0], normal[1]] } : {}) };
}

function faceOf(room: string, p: V, q: V, n: V, half: number): Face | null {
  const len = dist(p, q);
  return len > 1e-6 ? { room, a: p, t: [(q[0] - p[0]) / len, (q[1] - p[1]) / len], len, n, half } : null;
}

/** 고체(샤프트·기둥) 다각형들. */
function planSolids(plan: HomePlan): V[][] {
  return plan.walls
    .filter((w) => !(isPair(w.a) && isPair(w.b) && finite(w.thickness) && w.thickness > 0) && Array.isArray(w.polygon) && w.polygon.length >= 3 && w.polygon.every(isPair))
    .map((w) => w.polygon!.map((p) => [p[0]!, p[1]!] as V));
}

/**
 * 면 f 중 방 쪽으로 1cm 들어간 점이 그 방 다각형 안이고 고체 밖인 구간들. 여러 방이 함께 쓰는 벽 면은 벽 전체 길이라
 * 이렇게 잘라야 그 방에 없는 구석(다른 방 쪽에서 두 면이 만나는 점)이 생기지 않는다. 방 다각형이 없으면 그대로.
 */
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
  return spans.flatMap(([s1, s2]) => faceOf(f.room, along(f.a, f.t, s1), along(f.a, f.t, s2), f.n, f.half) ?? []);
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
        push(faceOf(f.room, along([w.a[0]!, w.a[1]!], n, half), along([w.b[0]!, w.b[1]!], n, half), n, half));
      } else if (Array.isArray(w.polygon) && w.polygon.length >= 3 && w.polygon.every(isPair)) {
        const poly = w.polygon.map((p) => [p[0]!, p[1]!] as V);
        const sign = Math.sign(poly.reduce((s, p, i) => s + cross(p, poly[(i + 1) % poly.length]!), 0));
        for (let i = 0; i < poly.length; i++) {
          const p = poly[i]!, q = poly[(i + 1) % poly.length]!;
          const outward = unit([sign * (q[1] - p[1]), -sign * (q[0] - p[0])]);
          if (outward && dot(outward, n) >= 0.99) push(faceOf(f.room, p, q, n, 0));
        }
      }
    }
  }
  return out;
}

/** 방 쪽 벽 면 한 조각(위치 맞추기 벽 모양 짝, src/sync/walls.ts): a → b, 법선 n은 방 안쪽(길이 1). */
export interface RoomFace {
  room: string;
  a: Plan2;
  b: Plan2;
  n: Plan2;
}

/** 평면도의 모든 방 쪽 면을 그 방 다각형과 맞닿은 구간으로 자르고 고체(샤프트·기둥)에 가린 곳을 뺀 것. 구석 찾기와 같은 면이다. */
export function roomFaces(plan: HomePlan): RoomFace[] {
  const solids = planSolids(plan);
  const polygonOf = new Map(plan.rooms.map((r) => [r.id, r.polygon]));
  return planFaces(plan)
    .flatMap((f) => clipToRoom(f, polygonOf.get(f.room), solids))
    .map((f) => ({ room: f.room, a: [f.a[0], f.a[1]], b: along(f.a, f.t, f.len), n: [f.n[0], f.n[1]] }));
}

const distToFace = (p: V, f: Face) => dist(p, along(f.a, f.t, Math.min(f.len, Math.max(0, dot(sub(p, f.a), f.t)))));

/** 점이 다각형 안이거나 변 위(ON_FACE_M 안)인지. 두 방 사이 경계 위 점은 두 방 모두에 든다. */
function inOrOn(p: V, poly: number[][]): boolean {
  if (insidePolygon(p, poly)) return true;
  return poly.some((q, i) => {
    const r = poly[(i + 1) % poly.length]!;
    const a: V = [q[0]!, q[1]!], d = sub([r[0]!, r[1]!], a);
    const len2 = dot(d, d);
    const t = len2 > 0 ? Math.min(1, Math.max(0, dot(sub(p, a), d) / len2)) : 0;
    return dist(p, along(a, d, t)) < ON_FACE_M;
  });
}

/**
 * 누른 점이 붙은 면. 여러 방이 같은 쪽을 함께 쓰는 벽(뷰어는 첫 방을 보낼 수 있다)은 점 바로 안쪽이 든 방을 고르고,
 * 두 방 경계 위라 둘 다 들면 보낸 방을 따른다.
 */
function pickedFace(faces: Face[], rooms: PlanRoom[], pick: WallPick): Face | null {
  const n = pick.normal ? unit(pick.normal) : null;
  const near = faces.filter((f) => (!n || dot(f.n, n) >= 0.9) && distToFace(pick.position, f) <= PICK_MAX_M);
  const holds = (f: Face) => {
    const poly = rooms.find((r) => r.id === f.room)?.polygon;
    return Array.isArray(poly) && poly.length >= 3 && poly.every(isPair) && inOrOn(along(pick.position, f.n, JOIN_M), poly);
  };
  const order = (list: Face[]) => [...list].sort((x, y) => distToFace(pick.position, x) - distToFace(pick.position, y));
  const inRoom = near.filter(holds);
  const pool = inRoom.length ? inRoom : near;
  return order(pool.filter((f) => f.room === pick.room))[0] ?? order(pool)[0] ?? null;
}

/** 누른 벽 점의 방 id(구석 찾기와 같은 면 고르기). 벽 면 위가 아니면 null. 손으로 고른 점 이름에 쓴다. */
export function pickedRoom(plan: HomePlan, pick: WallPick): string | null {
  return pickedFace(planFaces(plan), plan.rooms, pick)?.room ?? null;
}

/** 면 줄 위 구석. s는 f 위 거리, reach는 맞닿은 벽 두께 절반 + 여유(면이 그만큼 구석을 지나 벽 속으로 이어진다). */
interface Corner {
  s: number;
  reach: number;
  at: V;
}

/** 면 f 줄 위 같은 방 면 구간들(f 위 거리, 순서대로). 벽 I12와 기둥 S03처럼 한 줄로 이어진 면은 한 구간이다. */
function lineSpans(faces: Face[], f: Face): V[] {
  const spans = faces
    .filter((g) => dot(g.n, f.n) > 0.999 && Math.abs(dot(sub(g.a, f.a), f.n)) < ON_FACE_M)
    .map((g) => {
      const s1 = dot(sub(g.a, f.a), f.t), s2 = s1 + g.len * dot(g.t, f.t);
      return [Math.min(s1, s2), Math.max(s1, s2)] as V;
    })
    .sort((x, y) => x[0] - y[0]);
  const merged: V[] = [];
  for (const s of spans) {
    const last = merged.at(-1);
    if (last && s[0] <= last[1] + JOIN_M) last[1] = Math.max(last[1], s[1]);
    else merged.push([s[0], s[1]]);
  }
  return merged;
}

/**
 * 면 f 줄의 한 조각(같은 줄에 이어진 같은 방 면은 한 벽)과 그 위 같은 방 구석들(s 순).
 * 끝 구석 밖으로 면이 맞닿은 벽 두께만큼만 이어지면 그 끝은 벽 속(lowInWall·highInWall)이다.
 */
interface Piece {
  span: V;
  corners: Corner[];
  lowInWall: boolean;
  highInWall: boolean;
}

/**
 * 면 f 줄에서 s0가 든 조각. 끝이 벽 속이면 그 벽 두께 절반만큼 밖도 그 조각이다(뷰어는 벽 중심선 끝까지 붙이고,
 * 방 다각형이 벽 중심선이라 자른 면도 거기서 끝난다). s0가 면 위가 아니면 null.
 */
function cornersOn(faces: Face[], f: Face, s0: number): Piece | null {
  const piece = (span: V): Piece => {
    const corners: Corner[] = [];
    for (const g of faces) {
      const c = cross(f.t, g.t);
      if (Math.abs(c) < MIN_TURN_SIN) continue;
      const w = sub(g.a, f.a);
      const s = cross(w, g.t) / c; // f 위 거리
      const u = cross(w, f.t) / c; // g 위 거리
      // 면 끝은 벽 중심선 끝이라, 맞닿는 벽 두께 절반만큼은 이어진 것으로 본다(바깥 모서리)
      const reach = g.half + JOIN_M;
      if (s < span[0] - reach || s > span[1] + reach) continue;
      if (u < -(f.half + JOIN_M) || u > g.len + f.half + JOIN_M) continue;
      if (!corners.some((k) => Math.abs(k.s - s) < ON_FACE_M)) corners.push({ s, reach, at: along(f.a, f.t, s) });
    }
    corners.sort((x, y) => x.s - y.s);
    const first = corners[0], last = corners.at(-1);
    return { span, corners, lowInWall: !!first && first.s - span[0] <= first.reach, highInWall: !!last && span[1] - last.s <= last.reach };
  };
  const pieces = lineSpans(faces, f).map(piece);
  const has = (p: Piece, wide: boolean) => {
    const lo = wide && p.lowInWall ? Math.max(JOIN_M, p.corners[0]!.reach) : JOIN_M;
    const hi = wide && p.highInWall ? Math.max(JOIN_M, p.corners.at(-1)!.reach) : JOIN_M;
    return s0 >= p.span[0] - lo && s0 <= p.span[1] + hi;
  };
  return pieces.find((p) => has(p, false)) ?? pieces.find((p) => has(p, true)) ?? null;
}

/**
 * 면 f 위 s0를 사이에 둔 두 구석 lo(s가 작은 쪽)·hi. 열린 쪽은 null. s0가 면 위가 아니면 null.
 * 누른 점이 벽 속인 끝 구석 밖이면 그 구석 안쪽 조각을 쓴다.
 */
function bracket(faces: Face[], f: Face, s0: number): { lo: Corner | null; hi: Corner | null } | null {
  const on = cornersOn(faces, f, s0);
  if (!on) return null;
  const { span, corners: cs, lowInWall, highInWall } = on;
  const first = cs[0], last = cs.at(-1);
  if (!first || !last) return { lo: null, hi: null };
  let s = s0;
  if (lowInWall && s < first.s) s = first.s;
  if (highInWall && s > last.s) s = last.s;
  const k = cs.findIndex((c) => Math.abs(c.s - s) < SAME_S_M);
  if (k < 0) return { lo: cs.findLast((c) => c.s < s) ?? null, hi: cs.find((c) => c.s > s) ?? null };
  // 구석 바로 위: 벽 속이 아닌 쪽 조각. 둘 다 되면 양 끝이 구석인 쪽, 그다음 긴 쪽(벽을 그린 방향과 상관없게)
  const low = { lo: cs[k - 1] ?? null, hi: cs[k]! }, high = { lo: cs[k]!, hi: cs[k + 1] ?? null };
  const lowOk = !(k === 0 && lowInWall), highOk = !(k === cs.length - 1 && highInWall);
  if (lowOk !== highOk) return lowOk ? low : high;
  if ((low.lo === null) !== (high.hi === null)) return low.lo ? low : high;
  const lowLen = cs[k]!.s - (low.lo?.s ?? span[0]), highLen = (high.hi?.s ?? span[1]) - cs[k]!.s;
  return lowLen > highLen ? low : high;
}

/** 값 d가 가장 작은 구석. 같으면(1µm) x, 그다음 y가 작은 쪽이라 벽을 그린 방향과 상관없다. */
function least(cs: (Corner | null)[], d: (c: Corner) => number): Corner | undefined {
  const cmp = (p: number, q: number) => (Math.abs(p - q) > 1e-6 ? p - q : 0);
  return cs.filter((c): c is Corner => c !== null)
    .sort((x, y) => cmp(d(x), d(y)) || cmp(x.at[0], y.at[0]) || cmp(x.at[1], y.at[1]))[0];
}

/** 점 p에서 d 방향으로 다각형을 처음 나가는 거리. 못 나가면 null. */
function exitDistance(p: V, d: V, polygon: number[][]): number | null {
  let best: number | null = null;
  for (let i = 0; i < polygon.length; i++) {
    const q0 = polygon[i]!, q1 = polygon[(i + 1) % polygon.length]!;
    const e: V = [q1[0]! - q0[0]!, q1[1]! - q0[1]!];
    const c = cross(d, e);
    if (Math.abs(c) < 1e-12) continue;
    const w: V = [q0[0]! - p[0], q0[1]! - p[1]];
    const s = cross(w, e) / c, u = cross(w, d) / c;
    if (s > JOIN_M && u >= 0 && u <= 1 && (best === null || s < best)) best = s;
  }
  return best;
}

/** p에서 f 안쪽 법선으로 쏜 선이 방을 나가기 전에 처음 닿는, 이쪽을 보는 같은 방 면. */
function oppositeHit(faces: Face[], f: Face, p: V, polygon: number[][] | undefined): { face: Face; at: number } | null {
  if (!Array.isArray(polygon) || polygon.length < 3) return null;
  const exit = exitDistance(p, f.n, polygon);
  if (exit === null) return null;
  let best: { face: Face; at: number; s: number } | null = null;
  for (const g of faces) {
    if (g === f || dot(g.n, f.n) >= -0.1) continue;
    const c = cross(f.n, g.t);
    if (Math.abs(c) < 0.1) continue;
    const w = sub(g.a, p);
    const s = cross(w, g.t) / c, u = cross(w, f.n) / c;
    // 허용 끝(1cm)에 딱 걸린 점도 벽 방향과 상관없이 같게 계산 오차만큼 더 본다
    if (s <= JOIN_M || u < -ON_FACE_M - 1e-9 || u > g.len + ON_FACE_M + 1e-9) continue;
    if (!best || s < best.s) best = { face: g, at: u, s };
  }
  return best && best.s <= exit + ON_FACE_M ? { face: best.face, at: best.at } : null;
}

const SUFFIX_A = " 구석";
const SUFFIX_B = " 맞은편 구석";

/** 방 이름으로 만든 A·B 이름(40자까지). 방 이름이 없으면 빈 글. */
function cornerLabels(name: string | undefined): [string, string] {
  const room = (name ?? "").trim().slice(0, MAX_LABEL - SUFFIX_B.length).trim();
  return room ? [`${room}${SUFFIX_A}`, `${room}${SUFFIX_B}`] : ["", ""];
}

/**
 * 누른 벽 점 하나 → 기준점 A(그 벽의 가까운 구석)·B(맞은편 벽의 대각선 구석). 저장하지 않는다.
 * 구석을 못 찾거나 A가 방 밖이면 빈 목록. 맞은편이 없거나, B가 방 밖이거나, A–B가 너무 가깝거나,
 * 저장 검사(parseTouchPoints)에 걸리면 A만.
 */
export function autoCorners(plan: HomePlan, pick: WallPick, bounds: Bounds | null = null): TouchPoint[] {
  const all = planFaces(plan);
  const f = pickedFace(all, plan.rooms, pick);
  if (!f) return [];
  const room = plan.rooms.find((r) => r.id === f.room);
  const solids = planSolids(plan);
  const faces = all.filter((g) => g.room === f.room).flatMap((g) => clipToRoom(g, room?.polygon, solids));
  const poly = room?.polygon;
  const roomPoly = Array.isArray(poly) && poly.length >= 3 && poly.every(isPair) ? poly : null;
  const inRoom = (p: Plan2) => !roomPoly || inOrOn(p, roomPoly);
  let s0 = dot(sub(pick.position, f.a), f.t);
  // 같은 방 안 기둥·샤프트에 가린 벽 부분(잘라 보기 단면)을 누르면 같은 줄에서 가장 가까운 보이는 면 끝으로 옮긴다
  const probe = along(pick.position, f.n, JOIN_M);
  if (!cornersOn(faces, f, s0) && roomPoly && inOrOn(probe, roomPoly) && solids.some((s) => insidePolygon(probe, s))) {
    const end = least(lineSpans(faces, f).flat().map((s) => ({ s, reach: 0, at: along(f.a, f.t, s) })), (c) => Math.abs(c.s - s0));
    if (end) s0 = end.s;
  }
  const near = bracket(faces, f, s0);
  const a = near && least([near.lo, near.hi], (c) => Math.abs(c.s - s0));
  if (!near || !a) return [];
  const A: TouchPoint = { id: "A", label: "", position: [mm(a.at[0]), mm(a.at[1])] };
  if (!inBounds(A.position, bounds) || !inRoom(A.position)) return [];
  const [labelA, labelB] = cornerLabels(room?.label);
  A.label = labelA;
  // 맞은편을 찾는 선은 A에서 구석 사이 쪽으로 조금 들어간 곳에서 쏜다. 누른 점이 구석 위나 옆 벽 속이어도 대각선 구석이 나온다
  const other = a === near.lo ? near.hi : near.lo;
  const inward = a === near.lo ? 1 : -1;
  const inset = Math.min(RAY_INSET_M, other ? Math.abs(other.s - a.s) / 2 : RAY_INSET_M);
  const sRay = inward === 1 ? Math.max(s0, a.s + inset) : Math.min(s0, a.s - inset);
  const hit = oppositeHit(faces, f, along(f.a, f.t, sRay), room?.polygon);
  const ends = hit && bracket(faces, hit.face, hit.at);
  const far = ends && least([ends.lo, ends.hi], (c) => -dist(c.at, a.at));
  if (!far) return [A];
  const B: TouchPoint = { id: "B", label: labelB, position: [mm(far.at[0]), mm(far.at[1])] };
  if (!inRoom(B.position)) return [A];
  try {
    parseTouchPoints({ points: [A, B] }, bounds);
  } catch (e) {
    if (e instanceof TouchPointsError) return [A];
    throw e;
  }
  return [A, B];
}
