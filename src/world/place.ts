// 물건의 트윈 위치: 박스 아래 가운데로 카메라 광선을 쏴 트윈의 아는 면(식탁·책상·조리대·싱크대 윗면)과 만나는 점, 없으면 바닥.
// 광선: 투영 역행렬로 시점 방향을 구하고, AR 회전 → 맞춤 회전(theta, 수평)으로 트윈 [x, 높이, y]로 옮긴다.
import { rotate2, rotate3, type Quat } from "../phone/align.js";
import type { CameraView } from "../phone/session.js";

type V3 = [number, number, number];
/** 물건이 놓일 수 있는 윗면. center는 평면도 [x, y], top은 바닥에서 윗면 높이(m), radius는 윗면을 덮는 원. */
export interface PlaneSurface { id: string; label: string; center: [number, number]; top: number; radius: number }

function invert4(m: number[]): number[] {
  const inv = new Array<number>(16);
  inv[0] = m[5]!*m[10]!*m[15]! - m[5]!*m[11]!*m[14]! - m[9]!*m[6]!*m[15]! + m[9]!*m[7]!*m[14]! + m[13]!*m[6]!*m[11]! - m[13]!*m[7]!*m[10]!;
  inv[4] = -m[4]!*m[10]!*m[15]! + m[4]!*m[11]!*m[14]! + m[8]!*m[6]!*m[15]! - m[8]!*m[7]!*m[14]! - m[12]!*m[6]!*m[11]! + m[12]!*m[7]!*m[10]!;
  inv[8] = m[4]!*m[9]!*m[15]! - m[4]!*m[11]!*m[13]! - m[8]!*m[5]!*m[15]! + m[8]!*m[7]!*m[13]! + m[12]!*m[5]!*m[11]! - m[12]!*m[7]!*m[9]!;
  inv[12] = -m[4]!*m[9]!*m[14]! + m[4]!*m[10]!*m[13]! + m[8]!*m[5]!*m[14]! - m[8]!*m[6]!*m[13]! - m[12]!*m[5]!*m[10]! + m[12]!*m[6]!*m[9]!;
  inv[1] = -m[1]!*m[10]!*m[15]! + m[1]!*m[11]!*m[14]! + m[9]!*m[2]!*m[15]! - m[9]!*m[3]!*m[14]! - m[13]!*m[2]!*m[11]! + m[13]!*m[3]!*m[10]!;
  inv[5] = m[0]!*m[10]!*m[15]! - m[0]!*m[11]!*m[14]! - m[8]!*m[2]!*m[15]! + m[8]!*m[3]!*m[14]! + m[12]!*m[2]!*m[11]! - m[12]!*m[3]!*m[10]!;
  inv[9] = -m[0]!*m[9]!*m[15]! + m[0]!*m[11]!*m[13]! + m[8]!*m[1]!*m[15]! - m[8]!*m[3]!*m[13]! - m[12]!*m[1]!*m[11]! + m[12]!*m[3]!*m[9]!;
  inv[13] = m[0]!*m[9]!*m[14]! - m[0]!*m[10]!*m[13]! - m[8]!*m[1]!*m[14]! + m[8]!*m[2]!*m[13]! + m[12]!*m[1]!*m[10]! - m[12]!*m[2]!*m[9]!;
  inv[2] = m[1]!*m[6]!*m[15]! - m[1]!*m[7]!*m[14]! - m[5]!*m[2]!*m[15]! + m[5]!*m[3]!*m[14]! + m[13]!*m[2]!*m[7]! - m[13]!*m[3]!*m[6]!;
  inv[6] = -m[0]!*m[6]!*m[15]! + m[0]!*m[7]!*m[14]! + m[4]!*m[2]!*m[15]! - m[4]!*m[3]!*m[14]! - m[12]!*m[2]!*m[7]! + m[12]!*m[3]!*m[6]!;
  inv[10] = m[0]!*m[5]!*m[15]! - m[0]!*m[7]!*m[13]! - m[4]!*m[1]!*m[15]! + m[4]!*m[3]!*m[13]! + m[12]!*m[1]!*m[7]! - m[12]!*m[3]!*m[5]!;
  inv[14] = -m[0]!*m[5]!*m[14]! + m[0]!*m[6]!*m[13]! + m[4]!*m[1]!*m[14]! - m[4]!*m[2]!*m[13]! - m[12]!*m[1]!*m[6]! + m[12]!*m[2]!*m[5]!;
  inv[3] = -m[1]!*m[6]!*m[11]! + m[1]!*m[7]!*m[10]! + m[5]!*m[2]!*m[11]! - m[5]!*m[3]!*m[10]! - m[9]!*m[2]!*m[7]! + m[9]!*m[3]!*m[6]!;
  inv[7] = m[0]!*m[6]!*m[11]! - m[0]!*m[7]!*m[10]! - m[4]!*m[2]!*m[11]! + m[4]!*m[3]!*m[10]! + m[8]!*m[2]!*m[7]! - m[8]!*m[3]!*m[6]!;
  inv[11] = -m[0]!*m[5]!*m[11]! + m[0]!*m[7]!*m[9]! + m[4]!*m[1]!*m[11]! - m[4]!*m[3]!*m[9]! - m[8]!*m[1]!*m[7]! + m[8]!*m[3]!*m[5]!;
  inv[15] = m[0]!*m[5]!*m[10]! - m[0]!*m[6]!*m[9]! - m[4]!*m[1]!*m[10]! + m[4]!*m[2]!*m[9]! + m[8]!*m[1]!*m[6]! - m[8]!*m[2]!*m[5]!;
  const det = m[0]! * inv[0]! + m[1]! * inv[4]! + m[2]! * inv[8]! + m[3]! * inv[12]!;
  return inv.map((v) => v / det);
}
const apply4 = (m: number[], v: [number, number, number, number]) =>
  [0, 1, 2, 3].map((r) => m[r]! * v[0] + m[4 + r]! * v[1] + m[8 + r]! * v[2] + m[12 + r]! * v[3]!) as [number, number, number, number];
const conj = ([x, y, z, w]: Quat): Quat => [-x, -y, -z, w];
const norm = (v: V3): V3 => { const l = Math.hypot(...v); return [v[0] / l, v[1] / l, v[2] / l]; };

/** NDC [-1..1] 점의 광선 방향(트윈 [x, 높이, y]). */
export function rayDir(view: CameraView, [nx, ny]: [number, number]): V3 {
  const inv = invert4(view.projection);
  const near = apply4(inv, [nx, ny, -1, 1]), far = apply4(inv, [nx, ny, 1, 1]);
  const a: V3 = [near[0] / near[3], near[1] / near[3], near[2] / near[3]], b: V3 = [far[0] / far[3], far[1] / far[3], far[2] / far[3]];
  const ar = rotate3(view.orientation, norm([b[0] - a[0], b[1] - a[1], b[2] - a[2]]));
  const [px, py] = rotate2(view.theta, [ar[0], ar[2]]);
  return norm([px, ar[1], py]);
}

/** 박스 [x, y, w, h](픽셀)의 트윈 위치. 광선이 위를 향하면 위치를 모른다. 오차는 거리에 따라 늘린다(5cm + 거리의 3%). */
export function placeBox(view: CameraView, box: [number, number, number, number], size: { width: number; height: number }, surfaces: PlaneSurface[], floorAt: (p: [number, number]) => number): { position: V3 | null; surface: string | null; errorM: number | null } {
  const u = box[0] + box[2] / 2, v = box[1] + box[3];
  const d = rayDir(view, [(u / size.width) * 2 - 1, 1 - (v / size.height) * 2]);
  if (d[1] >= -1e-6) return { position: null, surface: null, errorM: null };
  const o = view.origin;
  let best: { t: number; id: string | null; top: number } | null = null;
  for (const s of surfaces) {
    const t = (s.top - o[1]) / d[1];
    if (t <= 0) continue;
    const x = o[0] + d[0] * t, y = o[2] + d[2] * t;
    if (Math.hypot(x - s.center[0], y - s.center[1]) <= s.radius && (!best || t < best.t)) best = { t, id: s.id, top: s.top };
  }
  if (!best) {
    const t0 = (0 - o[1]) / d[1];
    const floor = floorAt([o[0] + d[0] * t0, o[2] + d[2] * t0]);
    best = { t: (floor - o[1]) / d[1], id: null, top: floor };
  }
  const p: V3 = [o[0] + d[0] * best.t, best.top, o[2] + d[2] * best.t];
  return { position: p.map((x) => Math.round(x * 1000) / 1000) as V3, surface: best.id, errorM: Math.round((0.05 + 0.03 * best.t) * 100) / 100 };
}

/** 트윈 점의 화면 자리(NDC [x, y], 화면 안이면 -1..1). 카메라 뒤면 null. */
export function ndc(view: CameraView, point: V3): [number, number] | null {
  const rel: V3 = [point[0] - view.origin[0], point[1] - view.origin[1], point[2] - view.origin[2]];
  const [ax, az] = rotate2(-view.theta, [rel[0], rel[2]]);
  const local = rotate3(conj(view.orientation), [ax, rel[1], az]);
  if (local[2] >= 0) return null;
  const c = apply4(view.projection, [local[0], local[1], local[2], 1]);
  return [c[0] / c[3], c[1] / c[3]];
}

/** 트윈 점의 엔진 프레임 픽셀 [x, y](placeBox와 같은 NDC 방향). 카메라 뒤면 null. 그림 밖이어도 낸다. */
export function pixelOf(view: CameraView, point: V3, size: { width: number; height: number }): [number, number] | null {
  const n = ndc(view, point);
  return n ? [((n[0] + 1) / 2) * size.width, ((1 - n[1]) / 2) * size.height] : null;
}

/** 트윈 점이 카메라 시야(NDC 안, 카메라 앞)에 드는가. margin만큼 화면 밖도 시야로 본다. */
export function inView(view: CameraView, point: V3, margin = 0): boolean {
  const n = ndc(view, point);
  return !!n && Math.abs(n[0]) <= 1 + margin && Math.abs(n[1]) <= 1 + margin;
}

const SURFACE_TYPE = /table|desk|counter|sink/;
/** 이름에 면 낱말이 들어도 면이 아닌 것(책상 조명). */
const NOT_SURFACE = /lamp/;

/** 배치 물건 중 식탁·책상·조리대·싱크대 윗면. top은 물건 바닥 + 높이, radius는 윗면을 덮는 원(footprint 대각선의 절반, 없으면 0.4m). */
export function surfacesFromLayout(objects: readonly { id: string; name: string; type: string; plan: [number, number]; base: number; height: number; footprint?: [number, number] }[]): PlaneSurface[] {
  return objects.filter((o) => SURFACE_TYPE.test(o.type) && !NOT_SURFACE.test(o.type)).map((o) => ({
    id: o.id, label: o.name, center: [o.plan[0], o.plan[1]], top: o.base + o.height, radius: o.footprint ? Math.hypot(o.footprint[0], o.footprint[1]) / 2 : 0.4,
  }));
}
