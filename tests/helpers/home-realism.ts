// 합성 재생의 실제 조건(시나리오 1·2 공용, CLAUDE.md 「합성 재생 시험은 실제 시스템과 같은 조건으로 만든다」):
// 목련 집 장면, 폰 카메라(가로 시험 영상 값), 사진에 사람·든 컵이 찍히는 조건, 시스템이 폰에 보내는 안내 길과 그 길을 걸은 것인지,
// VLM 촬영 간격(빠름 1초·보통 2초)과 답 지연 하한, 폰 자세 간격·걷기 빠르기.
import { readFileSync } from "node:fs";
import { FAST_VLM_MS, loadObserveConfig, vlmStepMs } from "../../src/observe/pipeline.js";
import { walkingMap } from "../../src/layout/walk-guide.js";
import { floorPlanFrom } from "../../src/layout/floor.js";
import { loadScene } from "../../src/layout/scene.js";
import { resolveHome } from "../../src/layout/homes.js";
import { DEFAULT_TWIN_DIR } from "../../src/layout/twin-files.js";
import { loadCatalog } from "../../src/layout/catalog.js";
import type { Vec2 } from "../../src/contract/layout.js";
import type { CameraView } from "../../src/contract/observe.js";
import type { PlannedCommand } from "../../src/contract/phone.js";
import { inView, ndc } from "../../src/world/place.js";
import { projectionFromFov, yawPitchQuat } from "../../ui/src/phone/core/video-math.js";

/** 목련 집 장면(평면도·관찰 자리). */
const home = resolveHome(DEFAULT_TWIN_DIR, "mokryeon_180b");
export const scene = loadScene(home)!;
const catalog = loadCatalog(home.catalogDir);
/** 목련 집 관찰 자리·구역(twin/data/homes/mokryeon_180b/stations.json). */
export const map = scene.stations,
  floor = floorPlanFrom(scene);
/** 확인된 사실 하나(그 시각에 본 값). */
export const fact = (value: string, at: number) => ({ value, at_ms: at, since_ms: at, certainty: "confirmed" as const });
/** 구역 가운데(평면 m). */
export function center(id: string): Vec2 {
  const ps = map.zones.find((z) => z.id === id)!.polygon;
  return ps.reduce<Vec2>((p, q) => [p[0] + q[0] / ps.length, p[1] + q[1] / ps.length], [0, 0]);
}
/** 폰 카메라: 가로 시험 영상(1920×1080)을 찍은 대로 세로 시야각 40°·16:9, 높이 1.15m, 10° 아래(영상 모드 주소 fov=40·pitch=-10·h=1.15).
 *  자리에 서면 그 자리의 바라볼 곳(look_at)을 비춘다. 녹화 장(wide-mug-v1)의 투영과 같아야 한다. */
export const PHONE = { fovDeg: 40, aspect: 16 / 9, pitchDeg: -10, heightM: 1.15 },
  PHONE_PROJECTION = projectionFromFov(PHONE.fovDeg, PHONE.aspect);
{
  const frames: { view: CameraView }[] = JSON.parse(readFileSync(new URL("../fixtures/replay/wide-mug-v1.json", import.meta.url), "utf8"));
  if (frames[0]?.view.projection.some((v, i) => Math.abs(v - PHONE_PROJECTION[i]!) > 1e-9)) throw Error("폰 카메라 투영이 녹화 장 투영과 다릅니다.");
}
/** 사진에 사람이 찍히는 높이(m): 앉은 사람의 몸통. 이 점이 화면 안이어야 사진에 사람이 있다(사람 수). */
const PERSON_M = 0.9;
/** 발 자리는 발(바닥 점)이 화면 아래 끝 2%보다 위에 있어야 안다(src/world/state/people.ts FEET_EDGE 0.98 → NDC y −0.96). */
const FEET_NDC_Y = -0.96;
/** 손에 든 컵: 폰을 든 사람이 컵을 카메라 앞(수평 0.45m, 높이 0.95m)에 들어 올린다(손에 있음 녹화 장처럼). 이 점이 화면 안이어야 찍힌다. */
const HAND = { aheadM: 0.45, heightM: 0.95 };

/** p에 서서 look 쪽을 보는 폰의 엔진 프레임 카메라(src/phone/session.ts viewAt과 같은 꼴, 트윈 좌표라 theta 0). */
export function cameraAt(p: Vec2, look: Vec2): CameraView {
  const yaw = Math.atan2(-(look[0] - p[0]), -(look[1] - p[1]));
  return { origin: [p[0], PHONE.heightM, p[1]], orientation: yawPitchQuat(yaw, PHONE.pitchDeg), theta: 0, projection: [...PHONE_PROJECTION] };
}
/** 사람이 그 사진에 어떻게 찍히나: 몸통(PERSON_M)이 화면 안이면 보임(사람 수), 발(바닥 점)까지 화면 아래 끝보다 위에 보이면 발 자리·방도 안다. */
export function personSight(camera: CameraView, p: Vec2): { visible: boolean; located: boolean } {
  const visible = inView(camera, [p[0], PERSON_M, p[1]]);
  const n = ndc(camera, [p[0], 0, p[1]]);
  return { visible, located: visible && !!n && Math.abs(n[0]) <= 1 && n[1] >= FEET_NDC_Y && n[1] <= 1 };
}
/** 폰을 든 사람이 카메라 앞에 들어 올린 컵 자리(트윈 [x, 높이, y]): 폰 자리에서 보는 쪽으로 HAND.aheadM, 높이 HAND.heightM. */
export function heldCupAt(phone: { position: Vec2; look: Vec2 }): [number, number, number] {
  const dx = phone.look[0] - phone.position[0],
    dz = phone.look[1] - phone.position[1],
    d = Math.hypot(dx, dz) || 1;
  return [phone.position[0] + (dx / d) * HAND.aheadM, HAND.heightM, phone.position[1] + (dz / d) * HAND.aheadM];
}

/** 서버가 쓰는 걷는 지도와 같다(가구 바닥 크기는 카탈로그, src/server/home/act.ts). 시스템이 폰에 보내는 안내 길(plan, 문·경유점)을 낸다. */
export const walkMap = walkingMap(floor, scene, (type) => catalog.get(type)?.footprint);
/** 같은 두 자리의 안내 길은 한 번만 계산한다(재생은 자세마다 폰 자리를 다시 묻는다. 가구가 막은 칸 찾기는 한 번에 0.1초 넘게 걸린다). */
const guides = new Map<string, ReturnType<typeof walkMap.plan>>();
/** 시스템이 그 두 자리 사이에 보내는 안내 길(가기 명령 guide와 같은 계산). */
export function guideBetween(a: Vec2, b: Vec2) {
  const key = `${a[0]},${a[1]}>${b[0]},${b[1]}`;
  if (!guides.has(key)) guides.set(key, walkMap.plan(a, b, 0.5, true));
  const guide = guides.get(key)!;
  return guide && structuredClone(guide);
}
export function pathBetween(a: Vec2, b: Vec2): Vec2[] | null {
  const guide = guideBetween(a, b);
  return guide ? [a, ...guide.remaining.map((p) => [p.position[0], p.position[2]] as Vec2)] : null;
}
/** 걷는 동안 그 가기 명령으로 다시 보낸 안내(경유점을 지나 줄어든 길, 보류면 null)와 보낸 때. */
export type GuideUpdate = { at: number; remaining: PlannedCommand["guide"] | null };
/** 폰이 걸은 길(안내 길)이 가기 명령이 보낸 안내 길과 같은가. 다르거나 안내가 없으면(보류) 까닭 글, 같으면 null.
 *  updates·depart·arrive를 주면 출발 때 받은 안내와 걷는 동안 바뀐 안내마다, 그 안내가 남긴 경유점이 걸은 길과 같고
 *  그 경유점을 넘은 때가 같은 빠르기로 걸은 자리와 맞는지 본다(영상 폰은 문을 12cm 넘어가며 다음 100ms 자세에서 문 통과를 확인한다). */
export function walkProblem(from: Vec2, to: Vec2, guide: PlannedCommand["guide"] | null | undefined,
  updates: readonly GuideUpdate[] = [], depart = 0, arrive = 0, walkLength?: number): string | null {
  const path = pathBetween(from, to);
  if (!path) return "걸을 안내 길 없음";
  const initial = updates.findLast(u => u.at <= depart);
  const first = initial ? initial.remaining : guide;
  if (!first) return "보낸 안내 길 없음·보류";
  const matches = (points: NonNullable<typeof guide>["remaining"], start: number) =>
    start >= 1 && points.every((p, i) => {
      const step = path[start + i];
      return step && Math.hypot(p.position[0] - step[0], p.position[2] - step[1]) < 0.05;
    });
  if (first.remaining.length !== path.length - 1 || !matches(first.remaining, 1))
    return `보낸 안내 길의 경유점이 걸은 길과 다름(걸은 길 경유점 ${path.length - 1}개, 보낸 안내 길 경유점 ${first.remaining.length}개)`;
  if (arrive <= depart) return null;

  const length = walkLength ?? pathLength(path);
  const travelled = (at: number) => length * (at - depart) / (arrive - depart);
  const revisions = [{ at: depart, remaining: first }, ...updates.filter(u => u.at > depart && u.at < arrive)];
  for (const [i, update] of revisions.entries()) {
    const until = revisions[i + 1]?.at ?? arrive;
    if (until <= update.at) continue;
    const next = update.remaining;
    if (!next) return "보낸 안내 길 없음·보류";
    const start = path.length - next.remaining.length;
    if (!matches(next.remaining, start)) return "바뀐 안내 길이 걸은 길과 다름";
    const begin = pathLength(path.slice(0, start)), end = pathLength(path.slice(0, start + 1));
    if (begin - travelled(update.at) > 0.2 || travelled(until) - end > 0.2)
      return "경유점을 넘은 때가 받은 안내 길과 다름";
  }
  return null;
}
export const pathLength = (path: readonly Vec2[]) => path.slice(1).reduce((sum, p, i) => sum + Math.hypot(p[0] - path[i]![0], p[1] - path[i]![1]), 0);

export const OBSERVE = loadObserveConfig({}),
  VLM_STEP_MS = vlmStepMs(OBSERVE),
  /** 합성 기록 VLM 답 지연의 아래 끝(ms): 잰 평균은 nano 1.6초, mini 1.8초다. */
  VLM_LAG_MIN_MS = 1000,
  /** 폰 자세 간격(ms, ui/src/phone/core/ar.js SEND_MS). */
  POSE_MS = 100,
  /** 폰을 든 사람의 걷기(m/s, ui/src/phone/core/video-ar.js WALK_MPS)와 명령을 듣고 움직이기까지(ms, 영상 모드 REACT_S). */
  WALK_MPS = 0.8,
  REACT_MS = 1500;
/** VLM 사진 간격(src/observe/pipeline.ts frame.vlm): 앞 VLM 촬영 prev 뒤 엔진 프레임마다 보고, 처음으로 「그때 간격(빠름 1초·보통 2초)」 이상 지난 프레임.
 *  fast(t)는 그 시각의 src/server/home/observe.ts vlmFast와 같은 값이다. */
export function nextVlmCapture(prev: number, fast: (t: number) => boolean): number {
  for (let t = prev + FAST_VLM_MS; ; t += OBSERVE.engineMs) if (t - prev >= (fast(t) ? FAST_VLM_MS : VLM_STEP_MS)) return t;
}
