// 사람 관절 규칙(출처: docs/provenance.md). YOLO26-pose 관절 17개(COCO) → 자세·손목, 한 사람 고르기, 손에 듦.
// - 자세: 어깨·엉덩이 가운데를 이은 몸통이 수직에서 60° 넘게 기울면 누움, 아니면 엉덩이·무릎을 이은 허벅지가 45° 넘으면 앉음, 아니면 서 있음.
//   무릎이 안 보이면 다리 가림(upright), 엉덩이가 안 보이고 어깨만 보여도 다리 가림. 관절은 신뢰도 0.3 이상만 쓴다.
//   출처 규칙의 「어깨·엉덩이가 없고 상자가 가로로 1.4배 넘게 길면 누움」은 쓰지 않는다: 팔만 보이거나 상반신이 가까운 폰 프레임에서
//   누움으로 잘못 나왔다(Pexels 프레임 43장 중 7장, 맞은 것 없음).
// - 확실함: 자세를 모르거나 쓴 관절이 없으면 low, 쓴 관절이 모두 0.5 이상이고 다리 가림이 아니면 high, 그 밖은 mid.
// - 한 사람(1인 가구, 자세에 씀): low가 아닌 사람 먼저, 그 안에서 점수 × 상자 넓이가 큰 사람.
// - 손에 듦: 사람 상자 넓이의 25%를 넘는 큰 물건은 손목이 상자 안, 작은 물건은 손목과 상자 사이가 scale × 0.35 안.
//   관절 모델이 한 사람을 팔 조각 여럿으로 낼 때가 있어 World State는 모든 관절의 손목을 본다(heldByAny).
//   scale은 어깨 너비, 몸통 길이 × 0.6, 상자 짧은 변 × 0.25, 1 가운데 큰 값.
import type { Keypoint, Pose } from "../brain/detector.js";

type Pt = [number, number];
type Box = [number, number, number, number];

const L_SH = 5, R_SH = 6, L_WR = 9, R_WR = 10, L_HIP = 11, R_HIP = 12, L_KNEE = 13, R_KNEE = 14;
/** 이 신뢰도 아래 관절은 쓰지 않는다. */
export const KPT_LOW = 0.3;
/** 쓴 관절이 모두 이 신뢰도 이상이면 확실(high). */
export const KPT_HIGH = 0.5;

/** upright: 몸은 서 있는데 다리가 가려 서기·앉기를 모름. */
export type Posture = "standing" | "sitting" | "lying" | "upright" | "unknown";

export interface PoseInfo {
  posture: Posture;
  level: "high" | "mid" | "low";
  /** 보이는 손목(원본 픽셀). */
  wrists: Partial<Record<"left" | "right", Pt>>;
  /** 거리 기준 길이(픽셀). */
  scale: number;
  score: number;
  /** 원본 픽셀 [x, y, w, h]. */
  box: Box;
}

const kp = (k: Keypoint[], i: number): Pt | null => (k[i] && k[i]![2] >= KPT_LOW ? [k[i]![0], k[i]![1]] : null);
const mid = (a: Pt | null, b: Pt | null): Pt | null => (a && b ? [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2] : a ?? b);
const dist = (a: Pt, b: Pt) => Math.hypot(a[0] - b[0], a[1] - b[1]);
/** 두 점을 이은 선이 수직에서 몇 도 기울었나(0 수직, 90 수평). */
const tilt = (top: Pt, bottom: Pt) => (Math.atan2(Math.abs(bottom[0] - top[0]), Math.abs(bottom[1] - top[1]) + 1e-6) * 180) / Math.PI;

export function describePose(p: Pose): PoseInfo {
  const k = p.keypoints;
  const shL = kp(k, L_SH), shR = kp(k, R_SH);
  const sh = mid(shL, shR), hip = mid(kp(k, L_HIP), kp(k, R_HIP)), knee = mid(kp(k, L_KNEE), kp(k, R_KNEE));
  const [, , bw, bh] = p.box; // 거리 기준(scale)에만 쓴다
  const shW = shL && shR ? dist(shL, shR) : 0;
  const torso = sh && hip ? dist(sh, hip) : 0;
  const scale = Math.max(shW, torso * 0.6, Math.min(bw, bh) * 0.25, 1);
  const used: number[] = [];

  let posture: Posture = "unknown";
  if (sh && hip) {
    for (const i of [L_SH, R_SH, L_HIP, R_HIP]) if (k[i]![2] >= KPT_LOW) used.push(k[i]![2]);
    if (tilt(sh, hip) > 60) posture = "lying";
    else if (knee) posture = tilt(hip, knee) > 45 ? "sitting" : "standing";
    else posture = "upright";
  } else if (sh) posture = "upright";

  const wrists: PoseInfo["wrists"] = {};
  for (const [side, i] of [["left", L_WR], ["right", R_WR]] as const) {
    const w = kp(k, i);
    if (!w) continue;
    wrists[side] = w;
    used.push(k[i]![2]);
  }
  const level = posture === "unknown" || !used.length ? "low" : Math.min(...used) >= KPT_HIGH && posture !== "upright" ? "high" : "mid";
  return { posture, level, wrists, scale, score: p.score, box: p.box };
}

const area = (b: Box) => Math.max(0, b[2]) * Math.max(0, b[3]);

/** 1인 가구: 가장 확실한 사람 하나(없으면 null). */
export function mainPerson(poses: Pose[]): PoseInfo | null {
  let best: PoseInfo | null = null;
  for (const info of poses.map(describePose)) {
    if (!best) { best = info; continue; }
    const a = Number(info.level !== "low"), b = Number(best.level !== "low");
    if (a > b || (a === b && info.score * area(info.box) > best.score * area(best.box))) best = info;
  }
  return best;
}

/** 점과 상자 [x, y, w, h] 사이 거리(안이면 0). */
const toBox = (p: Pt, b: Box) => Math.hypot(Math.max(b[0] - p[0], 0, p[0] - (b[0] + b[2])), Math.max(b[1] - p[1], 0, p[1] - (b[1] + b[3])));

/** 이 물건을 든 손(가까운 손목 쪽). 들지 않았으면 null. */
export function heldBy(person: PoseInfo, box: Box): "left" | "right" | null {
  const big = area(box) > 0.25 * area(person.box);
  let best: { d: number; side: "left" | "right" } | null = null;
  for (const [side, w] of Object.entries(person.wrists) as ["left" | "right", Pt][]) {
    const d = toBox(w, box);
    if ((big ? d === 0 : d < person.scale * 0.35) && (!best || d < best.d)) best = { d, side };
  }
  return best?.side ?? null;
}

/** 관절 여럿 가운데 하나라도 이 물건을 들었는가. */
export const heldByAny = (people: readonly PoseInfo[], box: Box): boolean => people.some((p) => heldBy(p, box) !== null);
