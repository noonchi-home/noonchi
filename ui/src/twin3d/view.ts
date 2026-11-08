// 지도 카메라(그림 픽셀 가운데 + 배율, 시안 Camera와 같음) ↔ three 정사영 틀, 판 transform, 움직임 곡선.
// 정사영이라 카메라 확대·이동은 화면 위 판의 2D 변환(translate·scale)과 같다.
import * as THREE from "three";
import { basis, type OrthoCamera } from "./projection";

export interface MapCamera { cx: number; cy: number; scale: number }
export interface Box { width: number; height: number }
export const CAMERA_MS = 380;
/** Blender 좌표 → three(x, 높이, −y). */
const b2t = ([x, y, z]: [number, number, number]) => new THREE.Vector3(x, z, -y);
/** 구운 보기가 바라보는 점(three 좌표). */
export const viewTarget = (v: OrthoCamera) => b2t(v.target);

/** 지도 카메라가 보는 그림 네모를 카메라 면(m) 틀로. 그림 1px = orthoScale / width m, shift는 orthoScale 몫. */
export function frustumOf(v: OrthoCamera, c: MapCamera, box: Box) {
  const m = v.orthoScale / v.width;
  const hw = box.width / (2 * c.scale);
  const hh = box.height / (2 * c.scale);
  const a = (u: number) => (u - v.width / 2) * m + v.shiftX * v.orthoScale;
  const b = (y: number) => (v.height / 2 - y) * m + v.shiftY * v.orthoScale;
  return { left: a(c.cx - hw), right: a(c.cx + hw), top: b(c.cy - hh), bottom: b(c.cy + hh) };
}

/** 구운 보기 방향(방위·고도)에서 바라보는 점을 향하는 정사영 카메라를 지도 카메라 틀로 놓는다. */
export function placeCamera(cam: THREE.OrthographicCamera, v: OrthoCamera, c: MapCamera, box: Box): void {
  Object.assign(cam, frustumOf(v, c, box), { near: 1, far: 200 });
  const target = b2t(v.target);
  cam.position.copy(target).add(b2t(basis(v).toward).multiplyScalar(60));
  cam.up.set(0, 1, 0);
  cam.lookAt(target);
  cam.updateProjectionMatrix();
  cam.updateMatrixWorld();
}

/** three 좌표 [x, 높이, z] → 상자 안 화면 자리(px, 왼쪽 위 0,0). */
export function projectThree(cam: THREE.Camera, box: Box, [x, h, z]: [number, number, number]) {
  const p = new THREE.Vector3(x, h, z).project(cam);
  return { x: ((p.x + 1) / 2) * box.width, y: ((1 - p.y) / 2) * box.height };
}

/** 그림 픽셀 [u, v] → 상자 안 화면 자리. */
export const screenOf = (c: MapCamera, box: Box, [u, v]: [number, number]) => ({ x: box.width / 2 + (u - c.cx) * c.scale, y: box.height / 2 + (v - c.cy) * c.scale });
/** 그림 픽셀 판(왼쪽 위 0,0, transform-origin 0 0)을 지도 카메라에 맞추는 CSS transform. */
export const plateTransform = (c: MapCamera, box: Box) => `translate(${box.width / 2 - c.cx * c.scale}px, ${box.height / 2 - c.cy * c.scale}px) scale(${c.scale})`;

/** 두 지도 카메라 사이(t 0~1). 판 transform의 translate·scale을 곧게 잇는다. */
export function between(a: MapCamera, b: MapCamera, box: Box, t: number): MapCamera {
  if (t <= 0) return a;
  const T = (c: MapCamera) => [box.width / 2 - c.cx * c.scale, box.height / 2 - c.cy * c.scale] as const;
  const [ax, ay] = T(a); const [bx, by] = T(b);
  const s = a.scale + (b.scale - a.scale) * t;
  const x = ax + (bx - ax) * t; const y = ay + (by - ay) * t;
  return { scale: s, cx: (box.width / 2 - x) / s, cy: (box.height / 2 - y) / s };
}

/** cubic-bezier(0.22, 1, 0.36, 1)(대시보드 motion EASE와 같은 곡선). */
export function ease(t: number): number {
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  const [x1, y1, x2, y2] = [0.22, 1, 0.36, 1];
  const f = (u: number, p1: number, p2: number) => 3 * (1 - u) ** 2 * u * p1 + 3 * (1 - u) * u * u * p2 + u ** 3;
  let lo = 0, hi = 1, u = t;
  for (let i = 0; i < 30; i++) { u = (lo + hi) / 2; if (f(u, x1, x2) < t) lo = u; else hi = u; }
  return f(u, y1, y2);
}
