// 벽 모양: AR 중 자세마다 오는 실제 hit-test 점(어림 바닥 점은 빼고)을 벽 점·바닥 점으로 가르고,
// 벽 점을 평면도 방 쪽 벽 면(src/phone/corners.ts roomFaces)에 2D ICP로 맞출 점-선 항을 만든다.
//
// - 가르기: 면 법선이 거의 수평(|y| ≤ 0.3)이면 벽 점, 위를 보고(|y| ≥ 0.9) 폰보다 0.9m 이상 아래면 바닥 점(바닥 높이만 쓴다).
//   탁자·조리대 윗면과 비스듬한 면은 버린다.
// - 모으기: 벽 점은 10cm 칸마다 마지막 하나(같은 곳을 오래 비춰도 무게가 쏠리지 않게), 1200칸을 넘으면 오래된 칸부터 버린다.
// - 짝: 지금 변환으로 옮긴 점에서 가장 가까운 면. 법선이 30° 안이고(부호는 보지 않는다), 그 면이 카메라 쪽을 보고,
//   면 길이 안(끝에서 15cm 여유)이고, 거리가 gateM 안일 때만. 남은 짝 중 거리가 먼 15%는 잘라낸다.
//   한 면에 점이 30개를 넘으면 그 면 점마다 시그마를 키워 한 벽이 다른 증거를 누르지 않게 한다.

import { roomFaces, type HomePlan } from "../phone/corners.js";
import type { Vec3 } from "../phone/align.js";
import { applyRigid, rotateVec, type LineTerm, type P2, type Rigid } from "./rigid.js";

export interface WallSeg {
  room: string;
  a: P2;
  /** a에서 b로 가는 방향(길이 1). */
  t: P2;
  len: number;
  /** 방 안쪽 법선(길이 1). */
  n: P2;
}

export function wallSegments(plan: HomePlan): WallSeg[] {
  return roomFaces(plan).flatMap((f) => {
    const len = Math.hypot(f.b[0] - f.a[0], f.b[1] - f.a[1]);
    return len > 0.05 ? [{ room: f.room, a: f.a, t: [(f.b[0] - f.a[0]) / len, (f.b[1] - f.a[1]) / len] as P2, len, n: f.n }] : [];
  });
}

/** 바닥으로 받는 면은 폰보다 이만큼 아래(탁자 윗면을 거른다, src/phone/session.ts MIN_FLOOR_DROP_M과 같다). */
export const FLOOR_DROP_M = 0.9;
const WALL_MAX_UP = 0.3;
const FLOOR_MIN_UP = 0.9;

/** hit 점·면 법선(AR) → 벽 점([x, z]·수평 법선) 또는 바닥 높이. 못 쓰면 null. */
export function classifyHit(hit: Vec3, normal: Vec3, phoneY: number): { kind: "wall"; point: P2; normal: P2 } | { kind: "floor"; y: number } | null {
  const len = Math.hypot(...normal);
  if (!(len > 1e-6)) return null;
  const ny = normal[1] / len;
  if (Math.abs(ny) >= FLOOR_MIN_UP) return ny > 0 && phoneY - hit[1] >= FLOOR_DROP_M ? { kind: "floor", y: hit[1] } : null;
  if (Math.abs(ny) > WALL_MAX_UP) return null;
  const h = Math.hypot(normal[0], normal[2]);
  return { kind: "wall", point: [hit[0], hit[2]], normal: [normal[0] / h, normal[2] / h] };
}

export interface WallPoint {
  /** AR [x, z]. */
  point: P2;
  /** AR 수평 법선(길이 1, 부호는 보지 않는다). */
  normal: P2;
  /** 그 점을 볼 때 카메라 자리(AR [x, z]). */
  camera: P2;
  at: number;
}

const CELL_M = 0.1;
const median = (vs: number[]) => {
  const s = [...vs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
};

export class SurfacePoints {
  private readonly cells = new Map<string, WallPoint>();
  private floors: number[] = [];
  private readonly maxWall: number;
  private readonly maxFloor: number;

  constructor(opts: { maxWall?: number; maxFloor?: number } = {}) {
    this.maxWall = opts.maxWall ?? 1200;
    this.maxFloor = opts.maxFloor ?? 60;
  }

  addWall(point: P2, normal: P2, camera: P2, at: number): void {
    const key = `${Math.floor(point[0] / CELL_M)},${Math.floor(point[1] / CELL_M)}`;
    // 다시 넣어 맨 뒤(가장 최근)로 보낸다
    this.cells.delete(key);
    this.cells.set(key, { point: [point[0], point[1]], normal: [normal[0], normal[1]], camera: [camera[0], camera[1]], at });
    while (this.cells.size > this.maxWall) this.cells.delete(this.cells.keys().next().value!);
  }

  addFloor(y: number, _at: number): void {
    this.floors.push(y);
    if (this.floors.length > this.maxFloor) this.floors.splice(0, this.floors.length - this.maxFloor);
  }

  walls(): WallPoint[] {
    return [...this.cells.values()];
  }

  /** 최근 바닥 점 높이의 중앙값(AR y). 없으면 null. */
  floorY(): number | null {
    return this.floors.length ? median(this.floors) : null;
  }

  clear(): void {
    this.cells.clear();
    this.floors = [];
  }
}

export interface WallMatch { point: WallPoint; seg: WallSeg; d: number }

export interface WallTermOptions {
  /** 이보다 먼 면과는 짝짓지 않는다(m). */
  gateM: number;
  /** 법선이 이 cos보다 덜 맞으면 짝짓지 않는다(기본 cos 30°). */
  normalCos?: number;
  /** 거리가 가까운 쪽에서 남길 몫(기본 0.85). */
  keep?: number;
  /** 점 하나의 시그마(m, 기본 0.05). */
  sigma?: number;
  /** 한 면에서 제 무게를 다 주는 점 수(기본 30). */
  perSeg?: number;
}

const END_SLACK_M = 0.15;

/** 점 하나의 가장 가까운 면 짝(거리 d는 면 법선 쪽 부호). 없으면 null. */
function nearest(T: Rigid, p: WallPoint, segs: readonly WallSeg[], gateM: number, normalCos: number): WallMatch | null {
  const q = applyRigid(T, p.point), m = rotateVec(T.theta, p.normal), cam = applyRigid(T, p.camera);
  let best: WallMatch | null = null;
  for (const seg of segs) {
    if (Math.abs(m[0] * seg.n[0] + m[1] * seg.n[1]) < normalCos) continue;
    const rel: P2 = [q[0] - seg.a[0], q[1] - seg.a[1]];
    const d = rel[0] * seg.n[0] + rel[1] * seg.n[1];
    if (Math.abs(d) > gateM) continue;
    const s = rel[0] * seg.t[0] + rel[1] * seg.t[1];
    if (s < -END_SLACK_M || s > seg.len + END_SLACK_M) continue;
    // 면이 카메라 쪽을 봐야 그 면에 맞은 점이다
    if ((cam[0] - seg.a[0]) * seg.n[0] + (cam[1] - seg.a[1]) * seg.n[1] <= 0) continue;
    if (!best || Math.abs(d) < Math.abs(best.d)) best = { point: p, seg, d };
  }
  return best;
}

/** 지금 변환 T에서 벽 점마다 짝을 찾아 점-선 항으로. matched는 잘라낸 뒤 남은 짝. */
export function wallTerms(T: Rigid, points: readonly WallPoint[], segs: readonly WallSeg[], opts: WallTermOptions): { terms: LineTerm[]; matched: WallMatch[] } {
  const normalCos = opts.normalCos ?? Math.cos(Math.PI / 6);
  const all = points.flatMap((p) => nearest(T, p, segs, opts.gateM, normalCos) ?? []);
  all.sort((a, b) => Math.abs(a.d) - Math.abs(b.d));
  const matched = all.slice(0, Math.ceil(all.length * (opts.keep ?? 0.85)));
  const perSeg = opts.perSeg ?? 30;
  const count = new Map<WallSeg, number>();
  for (const m of matched) count.set(m.seg, (count.get(m.seg) ?? 0) + 1);
  const sigma = opts.sigma ?? 0.05;
  const terms = matched.map((m): LineTerm => ({
    kind: "line", from: m.point.point, at: m.seg.a, normal: m.seg.n, sigma: sigma * Math.sqrt(Math.max(1, count.get(m.seg)! / perSeg)),
  }));
  return { terms, matched };
}

/** 법선 방향 맞추기: 벽 점 법선(지금 변환으로 돌린 것)과 트윈 벽 면 법선 방향(180° 접기, 면 길이 무게)이 가장 잘 겹치는 회전 고침(rad).
 *  ±maxDeg 안을 0.25°씩 본다(폭 3° 가우스 무게). 이동과 상관없어 시작 방향이 15° 틀려도 바로 고친다.
 *  점이 minPoints(기본 20)보다 적거나, 점 4분의 1도 트윈 방향에 맞지 않거나, 6° 넘게 떨어진 다른 봉우리가 90% 넘게 높으면 null. */
export function normalRotation(T: Rigid, points: readonly WallPoint[], segs: readonly WallSeg[], opts: { maxDeg: number; minPoints?: number }): number | null {
  if (points.length < (opts.minPoints ?? 20) || !segs.length) return null;
  const fold = (a: number) => ((a % Math.PI) + Math.PI) % Math.PI;
  const dirs = new Map<number, number>();
  for (const s of segs) {
    const key = Math.round((fold(Math.atan2(s.n[1], s.n[0])) * 180) / Math.PI) % 180;
    dirs.set(key, (dirs.get(key) ?? 0) + s.len);
  }
  const top = Math.max(...dirs.values());
  const twin = [...dirs].map(([d, w]) => ({ a: (d * Math.PI) / 180, w: w / top }));
  const angles = points.map((p) => fold(Math.atan2(p.normal[1], p.normal[0]) + T.theta));
  const sigma = (3 * Math.PI) / 180;
  const score = (delta: number) => {
    let s = 0;
    for (const a of angles) {
      let best = 0;
      for (const t of twin) {
        let d = Math.abs(fold(a + delta) - t.a);
        d = Math.min(d, Math.PI - d);
        best = Math.max(best, t.w * Math.exp(-(d * d) / (2 * sigma * sigma)));
      }
      s += best;
    }
    return s;
  };
  const step = (0.25 * Math.PI) / 180, max = (opts.maxDeg * Math.PI) / 180;
  const scores: { delta: number; s: number }[] = [];
  for (let d = -max; d <= max + 1e-9; d += step) scores.push({ delta: d, s: score(d) });
  const best = scores.reduce((x, y) => (y.s > x.s ? y : x));
  if (best.s < 0.25 * angles.length) return null;
  const rival = scores.filter((x) => Math.abs(x.delta - best.delta) > (6 * Math.PI) / 180).reduce((m, x) => Math.max(m, x.s), 0);
  return rival > best.s * 0.9 ? null : best.delta;
}

export interface WallQuality {
  /** inlierM 안에 든 점 수. */
  inliers: number;
  /** 그 점들의 거리 RMS(m). 없으면 null. */
  rmsM: number | null;
  /** 짝을 찾은 점 중 inlier 몫. */
  ratio: number;
  /** 벽이 두 방향 이상이라 이동을 두 방향 모두 정한다(복도처럼 한 방향이면 false). */
  twoD: boolean;
}

/** 두 방향이라고 보는 기준: 법선 퍼짐 Σnnᵀ의 작은 고윳값이 큰 것의 15% 이상이고, 점 8개 몫 이상. */
export const TWO_D_RATIO = 0.15;
export const TWO_D_MIN = 8;

/** 변환 T에서 벽 점이 면에 얼마나 맞는지. */
export function wallQuality(T: Rigid, points: readonly WallPoint[], segs: readonly WallSeg[], opts: { inlierM: number; gateM?: number }): WallQuality {
  const normalCos = Math.cos(Math.PI / 6);
  const found = points.flatMap((p) => nearest(T, p, segs, opts.gateM ?? 0.3, normalCos) ?? []);
  const ins = found.filter((m) => Math.abs(m.d) <= opts.inlierM);
  let xx = 0, xy = 0, yy = 0;
  for (const m of ins) {
    xx += m.seg.n[0] * m.seg.n[0];
    xy += m.seg.n[0] * m.seg.n[1];
    yy += m.seg.n[1] * m.seg.n[1];
  }
  const tr = xx + yy, det = xx * yy - xy * xy;
  const disc = Math.sqrt(Math.max(0, (tr * tr) / 4 - det));
  const lmax = tr / 2 + disc, lmin = tr / 2 - disc;
  return {
    inliers: ins.length,
    rmsM: ins.length ? Math.sqrt(ins.reduce((s, m) => s + m.d * m.d, 0) / ins.length) : null,
    ratio: found.length ? ins.length / found.length : 0,
    twoD: lmax > 0 && lmin / lmax >= TWO_D_RATIO && lmin >= TWO_D_MIN,
  };
}
