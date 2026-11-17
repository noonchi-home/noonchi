// 물건의 트윈 위치: 박스 아래 가운데로 카메라 광선을 쏴 트윈의 아는 면(식탁·책상·조리대·싱크대 윗면)과 만나는 점, 없으면 바닥.
// 광선: 투영 역행렬로 시점 방향을 구하고, AR 회전 → 맞춤 회전(theta, 수평)으로 트윈 [x, 높이, y]로 옮긴다.
import { rotate2, rotate3 } from "../shared/geometry.js";
import type { Quat, CameraView } from "../contract/observe.js";
import { REST_PLACES, type RestKind } from "./vocab.js";

type V3 = [number, number, number];
/** 면 안의 싱크볼 사각형: 가운데 평면도 [x, y], 크기 [폭, 깊이](m), 깊이는 facing_deg 방향(배치 facing, 0 = +x, 90 = +y). */
export interface Basin { center: [number, number]; size: [number, number]; facing_deg: number }
/** 물건이 놓일 수 있는 윗면. center는 평면도 [x, y], top은 바닥에서 윗면 높이(m), radius는 윗면을 덮는 원. basin은 그 면의 싱크볼(있을 때). */
export interface PlaneSurface { id: string; label: string; center: [number, number]; top: number; radius: number; basin?: Basin }

/** 싱크볼 크기 [폭, 깊이](m). 도면 설비 자료(drawn_fixtures.json)는 싱크볼 가운데 점(sink)만 있다.
 *  근거: 구운 트윈(twin/homes/mokryeon_180b/bake) sink_counter_kitchen_basin 노드 상자가 폭 0.74 × 깊이 0.44(가운데는 sink 점과 1.3cm 차이),
 *  흔한 주방 사각 싱크볼 0.75~0.9 × 0.45~0.5. 영상 판정(2026-11-12 home-place.mp4)의 싱크볼 속 컵 상자를 그 판 폰 자리에서 다시 놓으면
 *  폰이 싱크볼 점을 볼 때 그 점에서 0.08m다(조리대 가운데를 볼 때는 0.57m). */
export const BASIN_SIZE: [number, number] = [0.74, 0.44];

/** 쉬는 가구(침대·소파): 종류, 바닥 사각형(가운데·[폭, 깊이]·facing)과 누울 면(매트리스·좌판) 높이 top(바닥에서 m).
 *  쓰러짐 의심(src/world/fall.ts)에서 그 위에 누운 것을 뺀다: 기하(onRest)는 후보만 고르고, 빼는 결정은 VLM 자리 답(REST_PLACES)으로 한다. */
export interface RestSpot extends Basin { id: string; label: string; kind: RestKind; top: number }
/** 쉬는 가구 위라고 볼 때 누울 면 가장자리에서 안쪽으로 둘 여유(m): 트윈 배치가 실제와 조금 어긋나도 가구 앞·옆 바닥을 가구 위로 보지 않는다. */
export const REST_INSET_M = 0.1;
/** 누운 사람의 엉덩이·어깨 관절 점이 누울 면보다 높은 범위(m). 관절 점은 몸 두께·너비의 가운데쯤이다: 똑바로 누우면 가슴·엉덩이 두께(성인 약 0.2~0.25m,
 *  ANSUR II 평균)의 절반인 약 0.1~0.13m, 옆으로 누우면 어깨 너비(약 0.36~0.40m)·엉덩이 너비(약 0.35m)의 절반인 약 0.17~0.2m다. 매트리스가 눌리는 만큼과
 *  관절 점 흔들림을 더해 0.1~0.25m로 둔다. */
export const REST_BODY_M: readonly [number, number] = [0.1, 0.25];

/** 평면 점이 싱크볼 사각형 안인가. */
export function inBasin(b: Basin, p: [number, number]): boolean {
  const a = (b.facing_deg * Math.PI) / 180;
  const dx = p[0] - b.center[0], dy = p[1] - b.center[1];
  const depth = dx * Math.cos(a) + dy * Math.sin(a), width = -dx * Math.sin(a) + dy * Math.cos(a);
  return Math.abs(depth) <= b.size[1] / 2 && Math.abs(width) <= b.size[0] / 2;
}

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

/** 박스 [x, y, w, h](픽셀)의 트윈 위치. 광선이 위를 향하면 위치를 모른다. 오차는 거리에 따라 늘린다(5cm + 거리의 3%).
 *  part: 광선이 그 면 윗면 높이에서 싱크볼 사각형 안을 지나면 basin. 싱크볼 바닥에 놓인 물건의 아래 가장자리는 윗면 높이에서 싱크볼 구멍을 지나야 보인다. */
export function placeBox(view: CameraView, box: [number, number, number, number], size: { width: number; height: number }, surfaces: PlaneSurface[], floorAt: (p: [number, number]) => number): { position: V3 | null; surface: string | null; part: "basin" | null; errorM: number | null } {
  return placePoint(view, [box[0] + box[2] / 2, box[1] + box[3]], size, surfaces, floorAt);
}

/** 픽셀 [u, v]의 트윈 위치(placeBox와 같은 규칙). 물건은 마스크 바닥 점(Detection.foot)을 준다: 손이 아래를 가려 상자가 늘어나도 바닥은 그대로다. */
export function placePoint(view: CameraView, point: [number, number], size: { width: number; height: number }, surfaces: PlaneSurface[], floorAt: (p: [number, number]) => number): { position: V3 | null; surface: string | null; part: "basin" | null; errorM: number | null } {
  const [u, v] = point;
  const d = rayDir(view, [(u / size.width) * 2 - 1, 1 - (v / size.height) * 2]);
  if (d[1] >= -1e-6) return { position: null, surface: null, part: null, errorM: null };
  const o = view.origin;
  let best: { t: number; surface: PlaneSurface | null; top: number } | null = null;
  for (const s of surfaces) {
    const t = (s.top - o[1]) / d[1];
    if (t <= 0) continue;
    const x = o[0] + d[0] * t, y = o[2] + d[2] * t;
    if (Math.hypot(x - s.center[0], y - s.center[1]) <= s.radius && (!best || t < best.t)) best = { t, surface: s, top: s.top };
  }
  if (!best) {
    const t0 = (0 - o[1]) / d[1];
    const floor = floorAt([o[0] + d[0] * t0, o[2] + d[2] * t0]);
    best = { t: (floor - o[1]) / d[1], surface: null, top: floor };
  }
  const p: V3 = [o[0] + d[0] * best.t, best.top, o[2] + d[2] * best.t];
  const basin = best.surface?.basin;
  return {
    position: p.map((x) => Math.round(x * 1000) / 1000) as V3, surface: best.surface?.id ?? null, part: basin && inBasin(basin, [p[0], p[2]]) ? "basin" : null,
    errorM: Math.round((0.05 + 0.03 * best.t) * 100) / 100,
  };
}

/** 쉬는 가구 후보: 몸 점들(엉덩이·어깨 픽셀)마다 광선이 몸 점 높이(누울 면 top + REST_BODY_M)를 지나는 동안 가장자리에서 REST_INSET_M 안쪽을 지나면 그 가구.
 *  카메라 한 대의 광선으로는 높이와 거리를 가르지 못한다(가구 너머 바닥의 몸도 이 높이에서 가구 위로 비칠 수 있다). 그래서 이것은 후보일 뿐이고,
 *  빼는 결정은 그 사람의 VLM 자리 답(침대 위·소파 위)으로 한다(src/world/state/people.ts). 광선이 그 높이에 닿지 않으면 후보가 아니다. */
export function onRest(view: CameraView, points: readonly [number, number][], size: { width: number; height: number }, rests: readonly RestSpot[]): RestSpot | null {
  if (points.length === 0) return null;
  const o = view.origin;
  const rays = points.map((p) => rayDir(view, [(p[0] / size.width) * 2 - 1, 1 - (p[1] / size.height) * 2]));
  for (const r of rests) {
    const inner: Basin = { center: r.center, size: [r.size[0] - 2 * REST_INSET_M, r.size[1] - 2 * REST_INSET_M], facing_deg: r.facing_deg };
    if (inner.size[0] <= 0 || inner.size[1] <= 0) continue;
    const on = rays.every((d) => {
      if (Math.abs(d[1]) <= 1e-6) return false;
      const [a, b] = REST_BODY_M.map((h) => (r.top + h - o[1]) / d[1]) as [number, number];
      const from = Math.max(0, Math.min(a, b)), to = Math.max(a, b);
      if (to <= 0) return false;
      for (let k = 0; k <= 8; k++) {
        const t = from + ((to - from) * k) / 8;
        if (inBasin(inner, [o[0] + d[0] * t, o[2] + d[2] * t])) return true;
      }
      return false;
    });
    if (on) return r;
  }
  return null;
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

/** 컵 안 모양(안 반지름·깊이 m). */
export interface CupInside { radius: number; depth: number }
/** 크기를 모를 때 컵 안 모양: 좁고 깊은 컵(안 반지름 3cm·깊이 15cm). 이 모양은 거의 입구 바로 위에서만 안이 보인다. */
export const TOP_CUP_FALLBACK: CupInside = { radius: 0.03, depth: 0.15 };
/** 컵 안을 볼 때 컵 자리가 있어야 하는 화면 가운데(NDC |x|·|y| ≤ center): 잘라 보기(cropBox, 프레임 절반 크기)가 화면 밖으로 밀리지 않는 자리. */
export const TOP_VIEW = { center: 0.5 } as const;
/** 위에서 보기 VLM 상자: 컵 자리(바닥 가운데)에 세운 원기둥(반지름·높이 m). 흔한 컵(지름 7~9cm·높이 9~12cm)을 덮는다. */
export const TOP_BOX_M = { radius: 0.05, height: 0.12 } as const;

/** 잰 크기(높이·폭 m) → 컵 안 모양: 안 반지름 0.85 × min(폭, 높이) ÷ 2(손잡이로 넓어진 폭을 막고 벽 두께를 뺌), 깊이 높이 − 1cm(바닥 두께).
 *  모르면 TOP_CUP_FALLBACK. */
export function cupInside(size: { height: number; width: number } | null | undefined): CupInside {
  if (!size) return TOP_CUP_FALLBACK;
  return { radius: (0.85 * Math.min(size.width, size.height)) / 2, depth: Math.max(0.01, size.height - 0.01) };
}

/** 이 카메라가 point(컵 바닥 가운데)에 놓인 cup 모양 컵의 안을 보는가.
 *  수평 거리 d, 카메라의 컵 바닥 위 높이 H, 안 반지름 r, 깊이 h일 때: 테두리보다 높고(H > h), 입구 바로 위(d ≤ r)이거나
 *  먼 쪽 안벽 바닥 모서리로 가는 선이 가까운 테두리 위로 지난다(H·2r ≥ h·(d + r)). 그리고 컵 자리가 화면 가운데(TOP_VIEW)다. 카메라 뒤면 false.
 *  먼 쪽 안벽 바닥 모서리가 보이면 조금만 담겨도 그 모서리를 수면이 덮으므로 빈 컵과 갈린다.
 *  edge: point가 가운데가 아니라 가까운 바닥 가장자리다(World State 자리, 가운데를 모를 때). 가운데가 어느 쪽인지 몰라 d에 r을 더해 본다. */
export function topView(view: CameraView, point: V3, cup: CupInside, edge = false): boolean {
  const n = ndc(view, point);
  if (!n || Math.abs(n[0]) > TOP_VIEW.center || Math.abs(n[1]) > TOP_VIEW.center) return false;
  const o = view.origin;
  const d = Math.hypot(o[0] - point[0], o[2] - point[2]) + (edge ? cup.radius : 0);
  const H = o[1] - point[1];
  const { radius: r, depth: h } = cup;
  return H > h && (d <= r || H * 2 * r >= h * (d + r));
}

/** point에 세운 TOP_BOX_M 원기둥 꼭짓점 16개(아래·위 원마다 8개)를 찍은 엔진 프레임 픽셀 상자 [x, y, w, h]. 하나라도 카메라 뒤면 null. */
export function topBox(view: CameraView, point: V3, size: { width: number; height: number }): [number, number, number, number] | null {
  const xs: number[] = [], ys: number[] = [];
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2;
    for (const y of [0, TOP_BOX_M.height]) {
      const p = pixelOf(view, [point[0] + TOP_BOX_M.radius * Math.cos(a), point[1] + y, point[2] + TOP_BOX_M.radius * Math.sin(a)], size);
      if (!p) return null;
      xs.push(p[0]);
      ys.push(p[1]);
    }
  }
  const x = Math.min(...xs), y = Math.min(...ys);
  return [x, y, Math.max(...xs) - x, Math.max(...ys) - y];
}

/** 크기를 잴 상자가 사진 가장자리에서 이만큼(픽셀) 안이면 잘렸을 수 있어 재지 않는다. */
const SIZE_EDGE_PX = 2;
/** 사진 세로(아래)가 중력과 이만큼(도) 넘게 어긋나면(폰을 옆으로 돌림) 상자 좌우·윗변이 물건 폭·높이가 아니라 재지 않는다. */
export const SIZE_ROLL_DEG = 15;
/** 그 사진 점에서 중력이 사진 아래와 SIZE_ROLL_DEG 안으로 맞는가: 광선 2m 앞 점과 그보다 0.1m 아래 점을 다시 비춘 방향을 본다.
 *  광선이 수직에서 30° 안이면(거의 바로 아래·위, 높이를 잴 수 없다) false. */
function upright(view: CameraView, px: [number, number], frame: { width: number; height: number }): boolean {
  const d = rayDir(view, [(px[0] / frame.width) * 2 - 1, 1 - (px[1] / frame.height) * 2]);
  if (Math.abs(d[1]) >= Math.cos(Math.PI / 6)) return false;
  const o = view.origin;
  const near: V3 = [o[0] + d[0] * 2, o[1] + d[1] * 2, o[2] + d[2] * 2];
  const a = pixelOf(view, near, frame), b = pixelOf(view, [near[0], near[1] - 0.1, near[2]], frame);
  if (!a || !b) return false;
  const vx = b[0] - a[0], vy = b[1] - a[1];
  return vy > 0 && (Math.atan2(Math.abs(vx), vy) * 180) / Math.PI <= SIZE_ROLL_DEG;
}
/** 광선이 수평 법선 nrm(단위)·점 base를 지나는 세로 평면과 만나는 점. 평면과 나란하거나 카메라 뒤면 null. */
function onPlane(o: V3, dir: V3, base: V3, nrm: [number, number]): V3 | null {
  const den = dir[0] * nrm[0] + dir[2] * nrm[1];
  if (Math.abs(den) < 1e-9) return null;
  const t = ((base[0] - o[0]) * nrm[0] + (base[2] - o[2]) * nrm[1]) / den;
  return t > 0 ? [o[0] + dir[0] * t, o[1] + dir[1] * t, o[2] + dir[2] * t] : null;
}

/** 감지 상자 하나로 그 물건 크기(높이·폭 m)와 바닥 가운데를 잰다. at은 그 물건 자리(마스크 바닥 점이라 카메라에 가까운 바닥 가장자리)다.
 *  폭: 상자 왼쪽·오른쪽 변 가운데 광선이 그 물건 가운데 깊이(at에서 반 폭 더 먼)의 세로 평면에서 벌어진 거리(한 번 고쳐 잰다).
 *  높이: 상자 윗변 가운데 광선이 먼 테두리 깊이(at에서 폭만큼 더 먼)의 세로 평면과 만나는 점의 at 위 높이. 위에서 내려다본 원기둥의 상자 윗변은 먼 테두리다.
 *  가운데: at에서 카메라 반대쪽(수평)으로 반 폭 옮긴 점(높이는 at).
 *  상자가 사진 가장자리에 닿았거나(잘렸을 수 있음), 사진 세로가 중력과 어긋났거나(upright, 폰을 옆으로 돌림), 광선이 그 평면에 닿지 않으면 null. */
export function sizeOf(view: CameraView, box: [number, number, number, number], frame: { width: number; height: number }, at: V3): { height: number; width: number; center: V3 } | null {
  const [x, y, w, h] = box;
  if (x <= SIZE_EDGE_PX || y <= SIZE_EDGE_PX || x + w >= frame.width - SIZE_EDGE_PX || y + h >= frame.height - SIZE_EDGE_PX) return null;
  if (!upright(view, [x + w / 2, y + h / 2], frame)) return null;
  const o = view.origin;
  const flat = Math.hypot(at[0] - o[0], at[2] - o[2]);
  if (flat < 1e-6) return null;
  const nrm: [number, number] = [(at[0] - o[0]) / flat, (at[2] - o[2]) / flat];
  const ray = (u: number, v: number) => rayDir(view, [(u / frame.width) * 2 - 1, 1 - (v / frame.height) * 2]);
  const ahead = (m: number): V3 => [at[0] + nrm[0] * m, at[1], at[2] + nrm[1] * m];
  const widthAt = (m: number): number | null => {
    const l = onPlane(o, ray(x, y + h / 2), ahead(m), nrm), r = onPlane(o, ray(x + w, y + h / 2), ahead(m), nrm);
    return l && r ? Math.hypot(l[0] - r[0], l[2] - r[2]) : null;
  };
  const first = widthAt(0);
  if (first === null) return null;
  const width = widthAt(first / 2);
  if (width === null) return null;
  const top = onPlane(o, ray(x + w / 2, y), ahead(width), nrm);
  if (!top || top[1] <= at[1]) return null;
  return { height: top[1] - at[1], width, center: ahead(width / 2) };
}

const SURFACE_TYPE = /table|desk|counter|sink/;
/** 이름에 면 낱말이 들어도 면이 아닌 것(책상 조명). */
const NOT_SURFACE = /lamp/;

/** 배치 물건 중 식탁·책상·조리대·싱크대 윗면. top은 물건 바닥 + 높이, radius는 윗면을 덮는 원(footprint 대각선의 절반, 없으면 0.4m).
 *  싱크볼 점(배치 anchors.basin, 평면도 점)이 있으면 그 점을 가운데로 BASIN_SIZE·배치 facing의 싱크볼을 붙인다. */
/** 침대·소파 배치 종류(협탁·조명은 아니다): 배치 type 앞 낱말이 쉬는 가구 종류(REST_PLACES 키)다. */
const REST_TYPE = new RegExp(`^(${Object.keys(REST_PLACES).join("|")})(_|$)`);
/** 카탈로그에 누울 면이 없을 때 누울 면 높이(m): 침대는 이 저장소 카탈로그 매트리스 윗면(0.55~0.57), 소파는 흔한 좌판 높이(0.4~0.5)의 가운데. */
const REST_TOP: Record<RestKind, number> = { bed: 0.55, sofa: 0.45 };
/** 배치의 침대·소파 → 쉬는 가구. surface는 바닥에서 누울 면 높이(카탈로그 면), 없으면 REST_TOP. 바닥 크기를 모르면 뺀다. */
export function restsFromLayout(objects: readonly { id: string; name: string; type: string; plan: [number, number]; base: number; footprint?: [number, number]; facing_deg?: number; surface?: number }[]): RestSpot[] {
  return objects.flatMap((o) => {
    const kind = REST_TYPE.exec(o.type)?.[1] as RestKind | undefined;
    if (!kind || !o.footprint) return [];
    return [{
      id: o.id, label: o.name, kind, center: [o.plan[0], o.plan[1]] as [number, number], size: o.footprint, facing_deg: o.facing_deg ?? 0,
      top: Math.round((o.base + (o.surface ?? REST_TOP[kind])) * 1000) / 1000,
    }];
  });
}

export function surfacesFromLayout(objects: readonly { id: string; name: string; type: string; plan: [number, number]; base: number; height: number; footprint?: [number, number]; facing_deg?: number; basin?: [number, number] }[]): PlaneSurface[] {
  return objects.filter((o) => SURFACE_TYPE.test(o.type) && !NOT_SURFACE.test(o.type)).map((o) => ({
    id: o.id, label: o.name, center: [o.plan[0], o.plan[1]], top: o.base + o.height, radius: o.footprint ? Math.hypot(o.footprint[0], o.footprint[1]) / 2 : 0.4,
    ...(o.basin ? { basin: { center: [o.basin[0], o.basin[1]] as [number, number], size: BASIN_SIZE, facing_deg: o.facing_deg ?? 0 } } : {}),
  }));
}
