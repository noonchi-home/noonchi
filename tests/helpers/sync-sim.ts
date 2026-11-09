// 위치 맞추기 시험용 가짜 카메라와 가짜 집.
// 카메라: WebXR과 같은 모양의 투영 행렬(열 우선)·자세 쿼터니언, AR 점 → 화면 픽셀.
// 집: 정답 변환(AR → 트윈)을 알고, 자세마다 화면 가운데 hit 점(벽·가구 옆면·가구 윗면·바닥)과 YOLO 기준점 상자를 만든다.
import { rotate3, type Quat, type Vec3 } from "../../src/phone/align.js";
import { edgePoint, type TwinLandmark } from "../../src/sync/landmarks.js";
import { applyRigid, invertRigid, rotateVec, type P2, type Rigid } from "../../src/sync/rigid.js";
import type { WallSeg } from "../../src/sync/walls.js";

/** 같은 씨앗이면 같은 수열. */
export function rng(seed: number) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}
export const gauss = (r: () => number) => Math.sqrt(-2 * Math.log(r() + 1e-12)) * Math.cos(2 * Math.PI * r());

/** OpenGL 원근 투영(열 우선). fovY는 rad. */
export function perspective(fovY: number, aspect: number, near = 0.1, far = 50): number[] {
  const f = 1 / Math.tan(fovY / 2);
  return [f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, (far + near) / (near - far), -1, 0, 0, (2 * far * near) / (near - far), 0];
}

const mul = (a: Quat, b: Quat): Quat => [
  a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
  a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
  a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
  a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
];

/** AR 공간에서 수평 방향 heading(rad, AR x축에서 z축 쪽으로)을 보고 pitch(rad, 음수면 아래)만큼 숙인 카메라 자세. */
export function look(heading: number, pitch: number): Quat {
  const beta = Math.atan2(-Math.cos(heading), -Math.sin(heading));
  const qy: Quat = [0, Math.sin(beta / 2), 0, Math.cos(beta / 2)];
  const qx: Quat = [Math.sin(pitch / 2), 0, 0, Math.cos(pitch / 2)];
  return mul(qy, qx);
}

/** AR 점 → 화면 픽셀 [u, v](왼쪽 위 원점). 카메라 뒤거나 화면 밖이면 null. */
export function project(pos: Vec3, q: Quat, P: number[], size: { width: number; height: number }, point: Vec3): [number, number] | null {
  const conj: Quat = [-q[0], -q[1], -q[2], q[3]];
  const local = rotate3(conj, [point[0] - pos[0], point[1] - pos[1], point[2] - pos[2]]);
  if (local[2] >= -1e-6) return null;
  const v4 = [local[0], local[1], local[2], 1];
  const clip = [0, 1, 2, 3].map((r) => P[r]! * v4[0]! + P[4 + r]! * v4[1]! + P[8 + r]! * v4[2]! + P[12 + r]! * v4[3]!);
  const nx = clip[0]! / clip[3]!, ny = clip[1]! / clip[3]!;
  if (Math.abs(nx) > 1 || Math.abs(ny) > 1) return null;
  return [((nx + 1) / 2) * size.width, ((1 - ny) / 2) * size.height];
}

/** 가구 바닥 사각형(가운데·[폭, 깊이]·facing°)과 높이. 화면 가운데 광선이 먼저 닿으면 그 면이 hit이 된다(벽을 가린다). */
export interface SimBox { center: P2; footprint: [number, number]; facingDeg: number; height: number }

export interface SimPose { position: Vec3; orientation: Quat }
export interface SimHit { hit: Vec3; normal: Vec3 }
export interface SimBoxDet { label: string; score: number; box: [number, number, number, number] }

export interface SimOptions {
  truth: Rigid;
  /** AR 바닥 높이(트윈 높이 0의 AR y). */
  floorY: number;
  walls: WallSeg[];
  boxes?: SimBox[];
  landmarks?: TwinLandmark[];
  ceilingM?: number;
  seed?: number;
  /** hit 점 잡음(m), 상자 아래 가운데 픽셀 잡음(px). */
  hitNoiseM?: number;
  pixelNoise?: number;
  /** hit-test 점이 없을 몫(ARCore가 면을 못 찾은 때). */
  hitDropout?: number;
}

const SIZE = { width: 360, height: 640 };
const PROJ = perspective((62 * Math.PI) / 180, SIZE.width / SIZE.height);

/** 선분 a→b(평면)와 벽 면 seg가 만나는 a 쪽 거리 비(0~1). 없으면 null. */
function crossSeg(a: P2, b: P2, s: WallSeg): number | null {
  const d: P2 = [b[0] - a[0], b[1] - a[1]];
  const e: P2 = [s.t[0] * s.len, s.t[1] * s.len];
  const den = d[0] * e[1] - d[1] * e[0];
  if (Math.abs(den) < 1e-12) return null;
  const w: P2 = [s.a[0] - a[0], s.a[1] - a[1]];
  const u = (w[0] * e[1] - w[1] * e[0]) / den, v = (w[0] * d[1] - w[1] * d[0]) / den;
  return u > 1e-6 && u < 1 - 1e-6 && v >= 0 && v <= 1 ? u : null;
}

/** 가구 사각형의 네 변(법선은 바깥). */
function boxSides(b: SimBox): WallSeg[] {
  const a = (b.facingDeg * Math.PI) / 180;
  const fwd: P2 = [Math.cos(a), Math.sin(a)], side: P2 = [-Math.sin(a), Math.cos(a)];
  const hd = b.footprint[1] / 2, hw = b.footprint[0] / 2;
  const corner = (i: number, j: number): P2 => [b.center[0] + fwd[0] * hd * i + side[0] * hw * j, b.center[1] + fwd[1] * hd * i + side[1] * hw * j];
  const ring = [corner(1, -1), corner(1, 1), corner(-1, 1), corner(-1, -1)];
  return ring.map((p, k) => {
    const q = ring[(k + 1) % 4]!;
    const len = Math.hypot(q[0] - p[0], q[1] - p[1]);
    const t: P2 = [(q[0] - p[0]) / len, (q[1] - p[1]) / len];
    const mid: P2 = [(p[0] + q[0]) / 2 - b.center[0], (p[1] + q[1]) / 2 - b.center[1]];
    const n: P2 = [t[1], -t[0]];
    const out: P2 = n[0] * mid[0] + n[1] * mid[1] > 0 ? n : [-n[0], -n[1]];
    return { room: "box", a: p, t, len, n: out };
  });
}

/** 점이 가구 사각형 안인지. */
function insideBox(b: SimBox, p: P2): boolean {
  const a = (b.facingDeg * Math.PI) / 180;
  const rel: P2 = [p[0] - b.center[0], p[1] - b.center[1]];
  const d = rel[0] * Math.cos(a) + rel[1] * Math.sin(a), w = -rel[0] * Math.sin(a) + rel[1] * Math.cos(a);
  return Math.abs(d) <= b.footprint[1] / 2 && Math.abs(w) <= b.footprint[0] / 2;
}

export class SimHome {
  readonly size = SIZE;
  readonly projection = PROJ;
  private readonly r: () => number;
  private readonly back: Rigid;
  private readonly sides: { seg: WallSeg; height: number }[];

  constructor(readonly o: SimOptions) {
    this.r = rng(o.seed ?? 1);
    this.back = invertRigid(o.truth);
    this.sides = (o.boxes ?? []).flatMap((b) => boxSides(b).map((seg) => ({ seg, height: b.height })));
  }

  /** 트윈 자리·눈 높이·방향(트윈 각, rad)·숙임 → AR 자세. */
  pose(at: P2, heading: number, pitch: number, eyeM = 1.45): SimPose {
    const p = applyRigid(this.back, at);
    return { position: [p[0], this.o.floorY + eyeM, p[1]], orientation: look(heading - this.o.truth.theta, pitch) };
  }

  /** AR 점 [x, y, z] → 트윈 [x, 높이, y]. */
  toTwin(p: Vec3): Vec3 {
    const q = applyRigid(this.o.truth, [p[0], p[2]]);
    return [q[0], p[1] - this.o.floorY, q[1]];
  }

  toAr(p: Vec3): Vec3 {
    const q = applyRigid(this.back, [p[0], p[2]]);
    return [q[0], p[1] + this.o.floorY, q[1]];
  }

  /** 화면 가운데 광선의 첫 hit(벽·가구 옆면·가구 윗면·바닥), AR 좌표와 면 법선. 없거나 빠지면 null. */
  centerHit(pose: SimPose): SimHit | null {
    if (this.r() < (this.o.hitDropout ?? 0.3)) return null;
    const f = rotate3(pose.orientation, [0, 0, -1]);
    const o = this.toTwin(pose.position);
    const h = rotateVec(this.o.truth.theta, [f[0], f[2]]);
    const dir: Vec3 = [h[0], f[1], h[1]];
    const far = 8;
    const a: P2 = [o[0], o[2]], b: P2 = [o[0] + dir[0] * far, o[2] + dir[2] * far];
    let best: { t: number; point: Vec3; normal: Vec3 } | null = null;
    const consider = (seg: WallSeg, top: number) => {
      const u = crossSeg(a, b, seg);
      if (u === null) return;
      const t = u * far;
      const y = o[1] + dir[1] * t;
      if (y < 0 || y > top) return;
      if ((a[0] - seg.a[0]) * seg.n[0] + (a[1] - seg.a[1]) * seg.n[1] <= 0) return;
      if (!best || t < best.t) best = { t, point: [o[0] + dir[0] * t, y, o[2] + dir[2] * t], normal: [seg.n[0], 0, seg.n[1]] };
    };
    for (const s of this.o.walls) consider(s, this.o.ceilingM ?? 2.3);
    for (const s of this.sides) consider(s.seg, s.height);
    if (dir[1] < 0) {
      // 가구 윗면, 그다음 바닥
      for (const box of this.o.boxes ?? []) {
        const t = (box.height - o[1]) / dir[1];
        const p: P2 = [o[0] + dir[0] * t, o[2] + dir[2] * t];
        if (t > 0 && insideBox(box, p) && (!best || t < best.t)) best = { t, point: [p[0], box.height, p[1]], normal: [0, 1, 0] };
      }
      const tFloor = (0 - o[1]) / dir[1];
      if (!best || tFloor < best.t) best = { t: tFloor, point: [o[0] + dir[0] * tFloor, 0, o[2] + dir[2] * tFloor], normal: [0, 1, 0] };
    }
    if (!best) return null;
    const got: { t: number; point: Vec3; normal: Vec3 } = best;
    if (got.t * Math.hypot(dir[0], dir[2]) > 6) return null;
    const n = this.o.hitNoiseM ?? 0.015;
    const noisy: Vec3 = [got.point[0] + gauss(this.r) * n, got.point[1] + gauss(this.r) * n * 0.3, got.point[2] + gauss(this.r) * n];
    const nn = rotateVec(-this.o.truth.theta, [got.normal[0], got.normal[2]]);
    return { hit: this.toAr(noisy), normal: [nn[0], got.normal[1], nn[1]] };
  }

  /** 엔진 프레임 한 장의 기준점 상자(COCO 이름). 벽에 가리거나, 화면 밖이거나, 아래 가장자리가 잘리면 없다. */
  detections(pose: SimPose): { projection: number[]; width: number; height: number; boxes: SimBoxDet[] } {
    const cam = this.toTwin(pose.position);
    const boxes: SimBoxDet[] = [];
    for (const l of this.o.landmarks ?? []) {
      const edge = edgePoint(l, [cam[0], cam[2]]);
      if (this.o.walls.some((s) => crossSeg([cam[0], cam[2]], edge, s) !== null)) continue;
      const px = project(pose.position, pose.orientation, this.projection, SIZE, this.toAr([edge[0], l.baseM, edge[1]]));
      if (!px) continue;
      const noise = this.o.pixelNoise ?? 3;
      const u = px[0] + gauss(this.r) * noise, v = px[1] + gauss(this.r) * noise;
      if (v > SIZE.height * 0.95 || u < 12 || u > SIZE.width - 12) continue;
      // 상자는 그림 안에 두고 아래 가운데가 u, v에 오게
      const w = Math.min(90, 2 * (u - 4), 2 * (SIZE.width - 4 - u)), h = Math.min(160, v - 4);
      boxes.push({ label: l.cls, score: 0.7 + this.r() * 0.25, box: [u - w / 2, v - h, w, h] });
    }
    return { projection: this.projection, width: SIZE.width, height: SIZE.height, boxes };
  }
}
