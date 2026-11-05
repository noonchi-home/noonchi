// 폰 AR(WebXR local 공간) 자세를 트윈 평면 좌표의 눈 자세로 바꾼다. 순수 함수만 둔다.
//
// WebXR 공간은 오른손, +Y 위, 미터다. 트윈 three 좌표도 (평면 x, 높이, 평면 y)라 축 모양이 같으므로
// AR (x, z)를 평면 (x, y)로 읽고 수평 회전 하나와 이동만 구하면 된다. 크기는 둘 다 미터라 맞출 필요가 없다.
// 회전 각은 평면 규칙(yaw 0 = +x, 90 = +y)을 따른다.

import type { EyePose, Plan2, Vec3 } from "../contract/events.js";

export type { EyePose, Plan2, Vec3 } from "../contract/events.js";
export type Quat = [number, number, number, number]; // x, y, z, w

export interface FloorPoint {
  ar: Vec3;
  plan: Plan2;
}

export interface Alignment {
  theta: number;
  tx: number;
  ty: number;
  floorY: number;
  mismatchM: number;
}

/** 두 기준점이 이보다 가까우면 방향이 불안정하다. */
export const MIN_BASELINE_M = 0.5;

const round = (v: number, digits: number) => Math.round(v * 10 ** digits) / 10 ** digits;
const deg = (rad: number) => (rad * 180) / Math.PI;

export function rotate2(theta: number, [x, y]: Plan2): Plan2 {
  const c = Math.cos(theta), s = Math.sin(theta);
  return [x * c - y * s, x * s + y * c];
}

/** 쿼터니언으로 벡터를 돌린다: v' = v + 2w(u×v) + 2u×(u×v). */
export function rotate3([qx, qy, qz, qw]: Quat, [vx, vy, vz]: Vec3): Vec3 {
  const cx = qy * vz - qz * vy, cy = qz * vx - qx * vz, cz = qx * vy - qy * vx;
  const ccx = qy * cz - qz * cy, ccy = qz * cx - qx * cz, ccz = qx * cy - qy * cx;
  return [vx + 2 * (qw * cx + ccx), vy + 2 * (qw * cy + ccy), vz + 2 * (qw * cz + ccz)];
}

/** 카메라가 보는 방향. WebXR 시점은 자기 -Z를 본다. */
export function forwardOf(q: Quat): Vec3 {
  return rotate3(q, [0, 0, -1]);
}

/** 바닥 기준점 두 곳(AR 점 ↔ 평면 점)으로 수평 회전·이동·바닥 높이를 구한다. */
export function solveAlignment(a: FloorPoint, b: FloorPoint): Alignment {
  const da: Plan2 = [b.ar[0] - a.ar[0], b.ar[2] - a.ar[2]];
  const dt: Plan2 = [b.plan[0] - a.plan[0], b.plan[1] - a.plan[1]];
  const lenA = Math.hypot(...da), lenT = Math.hypot(...dt);
  if (lenA < MIN_BASELINE_M || lenT < MIN_BASELINE_M) throw new Error(`두 기준점이 ${MIN_BASELINE_M}m보다 가깝습니다`);
  const theta = Math.atan2(dt[1], dt[0]) - Math.atan2(da[1], da[0]);
  const [rx, ry] = rotate2(theta, [a.ar[0], a.ar[2]]);
  return { theta, tx: a.plan[0] - rx, ty: a.plan[1] - ry, floorY: (a.ar[1] + b.ar[1]) / 2, mismatchM: Math.abs(lenT - lenA) };
}

export function toTwin(position: Vec3, orientation: Quat, al: Alignment): EyePose {
  const [px, py] = rotate2(al.theta, [position[0], position[2]]);
  const f = forwardOf(orientation);
  const [fx, fy] = rotate2(al.theta, [f[0], f[2]]);
  return {
    position: [round(px + al.tx, 3), round(py + al.ty, 3)],
    height_m: round(position[1] - al.floorY, 3),
    yaw_deg: round((deg(Math.atan2(fy, fx)) + 360) % 360, 1) % 360,
    pitch_deg: round(deg(Math.atan2(f[1], Math.hypot(f[0], f[2]))), 1),
  };
}

/** AR 공간의 바닥 점 → 평면도 [x, y]. */
export function planOf(ar: Vec3, al: Alignment): Plan2 {
  const [px, py] = rotate2(al.theta, [ar[0], ar[2]]);
  return [round(px + al.tx, 3), round(py + al.ty, 3)];
}

/** 트윈 점 [x, 높이, y](three.js 좌표) → AR 공간 [x, y, z]. toTwin·planOf의 역. 초점 고리를 폰 화면에 그릴 때 쓴다. */
export function fromTwin([x, h, y]: Vec3, al: Alignment): Vec3 {
  const [ax, az] = rotate2(-al.theta, [x - al.tx, y - al.ty]);
  return [round(ax, 6), round(h + al.floorY, 6), round(az, 6)];
}
