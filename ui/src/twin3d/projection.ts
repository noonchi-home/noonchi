// 미리 그린 집 그림(Blender 정사영 카메라) 위 자리 계산. 순수 함수만 둔다.
// 평면 [x, z] 미터는 Blender (x, -z, 높이)다. 카메라는 바라보는 점에서 방위·고도 쪽에 있고,
// ortho_scale은 그림 가로 길이(m, 가로가 더 길다), shift는 그 길이에 대한 비율로 화면 가운데를 옮긴다.
import type { XZ } from "../../../src/contract/plan.ts";

export interface OrthoCamera {
  /** Blender +x에서 반시계로 잰 방위(도). */
  azimuth: number;
  /** 수평에서 위로 잰 고도(도). */
  elevation: number;
  /** 바라보는 점(Blender 좌표). */
  target: [number, number, number];
  orthoScale: number;
  shiftX: number;
  shiftY: number;
  /** 그림 크기(px). */
  width: number;
  height: number;
}

/** 한양목련 180B 사실 그림(1920×1536)의 카메라. 그림 계획 파일의 camera·res 값 그대로. */
export const MOKRYEON_MAP_CAMERA: OrthoCamera = {
  azimuth: -45,
  elevation: 45,
  target: [8.1, -6.8484375, 1.0939999999999999],
  orthoScale: 20.64610379708482,
  shiftX: 0.012040636344955143,
  shiftY: -0.03439662306164869,
  width: 1920,
  height: 1536,
};

type V3 = [number, number, number];
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = (v: V3): V3 => { const n = Math.hypot(...v); return [v[0] / n, v[1] / n, v[2] / n]; };

/** 카메라 쪽·화면 오른쪽·화면 위쪽 단위 벡터(twin-studio-render studio/prerender/view.py basis와 같다). */
export function basis(cam: Pick<OrthoCamera, "azimuth" | "elevation">): { toward: V3; right: V3; up: V3 } {
  const a = (cam.azimuth * Math.PI) / 180;
  const e = (cam.elevation * Math.PI) / 180;
  const toward: V3 = [Math.cos(a) * Math.cos(e), Math.sin(a) * Math.cos(e), Math.sin(e)];
  const right = unit(cross([0, 0, 1], toward));
  const up = unit(cross(toward, right));
  return { toward, right, up };
}

/** 평면 [x, z]와 높이 h(m) → 그림 픽셀 [u, v](왼쪽 위 0,0). */
export function planToPixel(cam: OrthoCamera, [x, z]: XZ, h = 0): [number, number] {
  const { right, up } = basis(cam);
  const d: V3 = [x - cam.target[0], -z - cam.target[1], h - cam.target[2]];
  const pxPerM = cam.width / cam.orthoScale;
  const u = cam.width / 2 + (dot(d, right) - cam.shiftX * cam.orthoScale) * pxPerM;
  const v = cam.height / 2 - (dot(d, up) - cam.shiftY * cam.orthoScale) * pxPerM;
  return [u, v];
}

/** 평면 위 방향 [dx, dz] → 그림 위 단위 방향 [du, dv]. 로봇 머리 방향 화살표를 돌릴 때 쓴다. */
export function planDirToScreen(cam: OrthoCamera, [dx, dz]: XZ): [number, number] {
  const [u0, v0] = planToPixel(cam, [0, 0]);
  const [u1, v1] = planToPixel(cam, [dx, dz]);
  const n = Math.hypot(u1 - u0, v1 - v0) || 1;
  return [(u1 - u0) / n, (v1 - v0) / n];
}

/** 그림 위 방향의 각도(도, 화면 오른쪽 0, 시계 방향 +). CSS rotate에 바로 쓴다. */
export function screenAngle([du, dv]: [number, number]): number {
  return (Math.atan2(dv, du) * 180) / Math.PI;
}

/** 다각형(평면)을 높이 h의 그림 픽셀 다각형으로. */
export function polygonToPixels(cam: OrthoCamera, polygon: XZ[], h = 0): [number, number][] {
  return polygon.map((p) => planToPixel(cam, p, h));
}

/** SVG path d 글(닫힌 다각형). */
export function pathOf(points: [number, number][]): string {
  return points.length ? `M${points.map(([u, v]) => `${u.toFixed(1)},${v.toFixed(1)}`).join("L")}Z` : "";
}

/** 구운 보기가 있는 집(구운 GLB를 이 카메라로 그린다). 없는 집은 iframe 뷰어 그대로다. */
export const BAKE_VIEWS: Record<string, OrthoCamera> = { mokryeon_180b: MOKRYEON_MAP_CAMERA };
