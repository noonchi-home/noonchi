// 폰 AR(WebXR local 공간) 자세를 트윈 평면 좌표의 눈 자세로 바꾼다. 순수 함수만 둔다.
//
// WebXR 공간은 오른손, +Y 위, 미터다. 트윈 three 좌표도 (평면 x, 높이, 평면 y)라 축 모양이 같으므로
// AR (x, z)를 평면 (x, y)로 읽고 수평 회전 하나와 이동만 있으면 된다(위치 맞추기 src/sync가 구한다). 크기는 둘 다 미터라 맞출 필요가 없다.
// 회전 각은 평면 규칙(yaw 0 = +x, 90 = +y)을 따른다.

import type { EyePose, Plan2, Vec3 } from "../contract/events.js";
import type { Quat } from "../contract/observe.js";

export type { EyePose, Plan2, Vec3 } from "../contract/events.js";

/** AR → 트윈 맞춤: 수평 회전 theta·이동 tx·ty(src/sync/rigid.ts Rigid)와 트윈 높이 0의 AR y. */
export interface Alignment {
  theta: number;
  tx: number;
  ty: number;
  floorY: number;
}

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
