// 물건 기준점: 엔진 프레임 YOLO 상자(크고 바닥에 서는 물건)를 AR 바닥 점으로 바꿔 모으고, 트윈 물건과 짝짓는다.
//
// - 종류 표 LANDMARK_TYPES: 기준점 종류 → 트윈 종류(뒤 번호 `_2`는 뗀다). 무리마다 차례로 보고 집에 있는 첫 무리만 쓴다
//   (TV 물건이 없으면 TV수납장). 종류마다 상자 아래 가장자리가 놓인 면: floor(물건 바닥), top(물건 윗면, 싱크대·세면대),
//   rest(물건 바닥 높이 = 받침 윗면, 받침에 놓인 TV·전자레인지).
// - floorPoint: 상자 아래 가운데 픽셀의 광선이 AR 수평면 y = planeY와 만나는 점. 광선이 수평에서 5°보다 덜 숙었거나
//   6m보다 멀면 쓰지 않는다(어긋남이 거리에 따라 커진다).
// - edgePoint: 상자 아래 가운데는 물건 가운데가 아니라 카메라 쪽 앞 가장자리다. 카메라 → 물건 가운데 선이 물건 바닥
//   사각형에 들어가는 점을 그 관찰의 짝으로 쓴다(카메라가 사각형 안이면 가운데).
// - LandmarkStore: 종류마다 최근 관찰만 두고(기본 40개), 자리로 묶은 뒤 묶음 가운데에서 먼 관찰을 버린다. 관찰이 3개 이상인
//   묶음만 쓴다.

import { rayDir } from "../world/place.js";
import type { Quat, Vec3 } from "../phone/align.js";
import { LANDMARK_KEYS, type LandmarkClass } from "./classes.js";
import type { P2 } from "./rigid.js";

type Rest = "floor" | "top" | "rest";
interface TypeGroup { types: string[]; rest: Rest; footprint?: [number, number] }

/** 기준점 종류 → 트윈 종류 무리(앞 무리가 집에 있으면 그것만). */
export const LANDMARK_TYPES: Record<LandmarkClass, { groups: TypeGroup[]; footprint: [number, number] }> = {
  refrigerator: { groups: [{ types: ["fridge", "kimchi_fridge", "freezer"], rest: "floor" }], footprint: [0.7, 0.7] },
  sink: { groups: [{ types: ["sink_counter", "utility_sink", "vanity"], rest: "top" }], footprint: [0.6, 0.5] },
  toilet: { groups: [{ types: ["toilet"], rest: "floor" }], footprint: [0.45, 0.7] },
  bed: { groups: [{ types: ["bed_single", "bed_queen", "bed_double", "bed_king", "bed"], rest: "floor" }], footprint: [1.4, 2] },
  couch: { groups: [{ types: ["sofa"], rest: "floor" }], footprint: [2, 0.9] },
  dining_table: { groups: [{ types: ["dining_table"], rest: "floor" }], footprint: [1.4, 0.8] },
  oven: { groups: [{ types: ["oven", "range"], rest: "floor" }], footprint: [0.6, 0.6] },
  microwave: { groups: [{ types: ["microwave"], rest: "rest" }], footprint: [0.5, 0.4] },
  // TV 화면은 얇다: TV수납장으로 쓸 때도 깊이를 화면 두께로 둔다
  tv: { groups: [{ types: ["tv"], rest: "rest" }, { types: ["tv_stand"], rest: "top", footprint: [1.2, 0.1] }], footprint: [1.2, 0.1] },
};

/** 개수대가 따로 표시된 싱크 조리대(도면 설비)의 개수대 크기. */
const BASIN: [number, number] = [0.6, 0.45];

export interface TwinLandmark {
  cls: LandmarkClass;
  id: string;
  label: string;
  /** 평면 [x, y]. 싱크 조리대는 개수대 가운데. */
  center: P2;
  /** [폭, 깊이] m. 깊이는 facing 방향. */
  footprint: [number, number];
  facingDeg: number;
  /** 상자 아래 가장자리가 놓인 높이(트윈 높이, m). */
  baseM: number;
  /** 그 종류가 집에 하나뿐이다. */
  unique: boolean;
}

/** 트윈 물건(배치 편집기 objects 또는 scene.json objects + 도면 설비) 중 이 함수가 읽는 칸. */
export interface LandmarkSource {
  id: string;
  name: string;
  type: string;
  plan: { position: number[]; facing_deg?: number; elevation?: number };
  footprint?: number[];
  height?: number;
  anchors?: unknown;
}

const baseType = (t: string) => t.replace(/_\d+$/, "");
const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const pair = (v: unknown): v is [number, number] => Array.isArray(v) && finite(v[0]) && finite(v[1]);

/** 트윈 물건 → 기준점 목록. catalog는 종류별 크기·높이(src/layout/catalog.ts). */
export function twinLandmarks(objects: readonly LandmarkSource[], catalog: ReadonlyMap<string, { footprint: [number, number]; height: number }>): TwinLandmark[] {
  const out: TwinLandmark[] = [];
  for (const [cls, spec] of Object.entries(LANDMARK_TYPES) as [LandmarkClass, (typeof LANDMARK_TYPES)[LandmarkClass]][]) {
    for (const group of spec.groups) {
      const found = objects.filter((o) => group.types.includes(baseType(o.type)) && pair(o.plan?.position));
      if (!found.length) continue;
      for (const o of found) {
        const info = catalog.get(baseType(o.type));
        const basin = (o.anchors as { basin?: unknown } | undefined)?.basin;
        const elevation = finite(o.plan.elevation) ? o.plan.elevation : 0;
        const height = finite(o.height) ? o.height : info?.height ?? 0;
        const footprint: [number, number] = pair(basin) ? BASIN : group.footprint ?? (pair(o.footprint) ? [o.footprint[0], o.footprint[1]] : info?.footprint ?? spec.footprint);
        out.push({
          cls, id: o.id, label: o.name,
          center: pair(basin) ? [basin[0], basin[1]] : [o.plan.position[0]!, o.plan.position[1]!],
          footprint, facingDeg: finite(o.plan.facing_deg) ? o.plan.facing_deg : 0,
          baseM: group.rest === "top" ? elevation + height : elevation,
          unique: false,
        });
      }
      break;
    }
  }
  for (const l of out) l.unique = out.filter((k) => k.cls === l.cls).length === 1;
  return out;
}

/** 엔진 프레임 한 장의 카메라(AR 공간): 위치, 회전, 투영 행렬(열 우선 16개). */
export interface FrameCamera {
  position: Vec3;
  orientation: Quat;
  projection: number[];
}

/** 광선이 이만큼(rad)보다 덜 숙으면 바닥 점으로 쓰지 않는다. */
export const MIN_RAY_DROP = Math.sin((5 * Math.PI) / 180);
/** 이보다 먼 바닥 점은 쓰지 않는다(m, 수평). */
export const MAX_RANGE_M = 6;

export interface Ray { origin: Vec3; dir: Vec3 }

/** 상자 아래 가운데 픽셀의 AR 광선. */
export function boxRay(cam: FrameCamera, box: [number, number, number, number], size: { width: number; height: number }): Ray {
  const u = box[0] + box[2] / 2, v = box[1] + box[3];
  // theta 0이면 rayDir는 AR 축 그대로 [x, y, z]
  const dir = rayDir({ origin: cam.position, orientation: cam.orientation, theta: 0, projection: cam.projection }, [(u / size.width) * 2 - 1, 1 - (v / size.height) * 2]);
  return { origin: [...cam.position], dir };
}

/** 광선이 y = planeY와 만나는 AR 점 [x, z]와 수평 거리. 위를 보거나, 덜 숙었거나, 멀면 null. */
export function rayFloor(ray: Ray, planeY: number): { point: P2; rangeM: number } | null {
  const { origin: o, dir: d } = ray;
  if (d[1] > -MIN_RAY_DROP) return null;
  const t = (planeY - o[1]) / d[1];
  if (t <= 0) return null;
  const point: P2 = [o[0] + d[0] * t, o[2] + d[2] * t];
  const rangeM = Math.hypot(point[0] - o[0], point[1] - o[2]);
  return rangeM <= MAX_RANGE_M ? { point, rangeM } : null;
}

/** 상자 [x, y, w, h](픽셀) 아래 가운데가 AR 수평면 y = planeY에 닿는 점. 못 쓰면 null. */
export function floorPoint(cam: FrameCamera, box: [number, number, number, number], size: { width: number; height: number }, planeY: number): { point: P2; rangeM: number } | null {
  return rayFloor(boxRay(cam, box, size), planeY);
}

/** 카메라(평면 점) → 물건 가운데 선이 물건 바닥 사각형에 들어가는 점. 카메라가 사각형 안이면 가운데. */
export function edgePoint(l: Pick<TwinLandmark, "center" | "footprint" | "facingDeg">, camera: P2): P2 {
  const a = (l.facingDeg * Math.PI) / 180;
  const depth: P2 = [Math.cos(a), Math.sin(a)], width: P2 = [-Math.sin(a), Math.cos(a)];
  const hd = l.footprint[1] / 2, hw = l.footprint[0] / 2;
  const rel: P2 = [camera[0] - l.center[0], camera[1] - l.center[1]];
  // 사각형 좌표로: 카메라 c, 가운데 0. 선 c + s(0 − c), s ∈ [0, 1]이 처음 사각형에 드는 s
  const c: P2 = [rel[0] * depth[0] + rel[1] * depth[1], rel[0] * width[0] + rel[1] * width[1]];
  if (Math.abs(c[0]) <= hd && Math.abs(c[1]) <= hw) return [l.center[0], l.center[1]];
  let enter = 0;
  for (const [ci, h] of [[c[0], hd], [c[1], hw]] as const) {
    if (Math.abs(ci) <= h) continue;
    // ci + s(−ci)가 ±h에 닿는 s
    enter = Math.max(enter, (Math.abs(ci) - h) / Math.abs(ci));
  }
  const round = (v: number) => Math.round(v * 1e9) / 1e9 + 0;
  return [round(l.center[0] + rel[0] * (1 - enter)), round(l.center[1] + rel[1] * (1 - enter))];
}

/** 관찰 하나: AR 바닥 점(관찰할 때 그 종류의 면 높이), 그때 카메라 자리(AR [x, z]), 광선(면 높이가 바뀌면 다시 셈). */
export interface LandmarkObs {
  cls: LandmarkClass;
  point: P2;
  camera: P2;
  rangeM: number;
  score: number;
  at: number;
  ray?: Ray;
}

export interface LandmarkCluster {
  cls: LandmarkClass;
  /** 관찰 점 중앙값(AR [x, z]). */
  center: P2;
  /** 버리지 않은 관찰. */
  obs: LandmarkObs[];
}

export interface StoreOptions {
  /** 같은 물건으로 묶는 거리(종류별, m). */
  radiusM: (cls: LandmarkClass) => number;
  /** 묶음 가운데에서 이보다 멀면 버린다(종류별, m). */
  outlierM: (cls: LandmarkClass) => number;
  /** 종류마다 둘 최근 관찰 수(기본 40). */
  maxPerClass?: number;
  /** 묶음으로 쓰려면 있어야 하는 관찰 수(기본 3). */
  minObs?: number;
}

const median = (vs: number[]) => {
  const s = [...vs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
};
const medianPoint = (ps: P2[]): P2 => [median(ps.map((p) => p[0])), median(ps.map((p) => p[1]))];
const dist = (a: P2, b: P2) => Math.hypot(a[0] - b[0], a[1] - b[1]);

export class LandmarkStore {
  private readonly byClass = new Map<LandmarkClass, LandmarkObs[]>();
  private readonly max: number;
  private readonly minObs: number;

  constructor(private readonly o: StoreOptions) {
    this.max = o.maxPerClass ?? 40;
    this.minObs = o.minObs ?? 3;
  }

  add(obs: LandmarkObs): void {
    const list = this.byClass.get(obs.cls) ?? [];
    list.push(obs);
    if (list.length > this.max) list.splice(0, list.length - this.max);
    this.byClass.set(obs.cls, list);
  }

  size(): number {
    let n = 0;
    for (const l of this.byClass.values()) n += l.length;
    return n;
  }

  clear(): void {
    this.byClass.clear();
  }

  /** 쓸 수 있는 묶음(관찰 minObs개 이상). 종류 표 차례, 같은 종류는 관찰이 많은 묶음부터. */
  clusters(): LandmarkCluster[] {
    const out: LandmarkCluster[] = [];
    for (const cls of LANDMARK_KEYS) {
      const list = this.byClass.get(cls);
      if (!list?.length) continue;
      const radius = this.o.radiusM(cls), outlier = this.o.outlierM(cls);
      const groups: LandmarkObs[][] = [];
      for (const ob of list) {
        let best: { g: LandmarkObs[]; d: number } | null = null;
        for (const g of groups) {
          const d = dist(medianPoint(g.map((x) => x.point)), ob.point);
          if (d <= radius && (!best || d < best.d)) best = { g, d };
        }
        if (best) best.g.push(ob);
        else groups.push([ob]);
      }
      const made = groups.flatMap((g) => {
        const center = medianPoint(g.map((x) => x.point));
        const kept = g.filter((x) => dist(x.point, center) <= outlier);
        return kept.length >= this.minObs ? [{ cls, center: medianPoint(kept.map((x) => x.point)), obs: kept }] : [];
      });
      out.push(...made.sort((a, b) => b.obs.length - a.obs.length));
    }
    return out;
  }
}
