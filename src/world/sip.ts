// 마시기·따르기 사건(관절과 감지 모양만 본다, 2026-11-17 설계). 사건은 확인된 내용물을 「다시 확인 필요」로 여는 데만 쓴다(src/world/state/contents.ts reopen).
// 얼굴 앞에 컵을 들거나 병을 들고 지나가거나 원근으로 겹쳐도 사건이 될 수 있다. 새 값은 사건이 아니라 그 뒤 사진(3장·4초)이나 사람 답이 정한다.
// 따르기는 YOLO 세그 마스크로 본다: 병 마스크의 긴 축(주성분)을 그 자리의 중력 방향(카메라 자세로 구함, 쓰러짐 의심과 같은 downOf)과 견줘 기울기를 재고,
// 「컵 위」는 두 마스크를 중력 좌표(옆·위)에 비춘 범위로 본다. 폰을 어떻게 돌려 들어도 세운 병은 세운 병이다.
// 보류(따르기로 보지 않음): 카메라 자세가 없거나(중력 모름), 마스크가 없거나 너무 작거나, 병 마스크가 둥글어 긴 축을 모를 때.
import type { Mask } from "../contract/observe.js";
import { maskCells } from "../shared/mask.js";
import { heldBy, toBox, type PoseInfo, type Pt } from "./pose.js";

type Box = [number, number, number, number];
/** 감지 하나의 상자와 모양(마스크). */
export interface Shape { box: Box; mask: Mask }
/** 얼굴 점이 든 물건 상자에서 사람 크기(scale) × 이만큼 안이면 입에 댄 것이다. */
export const MOUTH_NEAR = 0.5;
/** 병 마스크 긴 축이 중력 방향에서 이만큼(°) 넘게 기울면 기운 병이다. */
export const POUR_TILT_DEG = 35;
/** 병 아래가 컵 위보다 컵 높이 × 이만큼까지는 아래여도 된다(병 입이 컵 입에 걸침). 그보다 아래면 컵 앞에서 든 병이다. */
export const POUR_DIP = 0.5;
/** 마스크 칸이 이보다 적으면 모양으로 보지 않는다(보류). */
export const SHAPE_MIN_CELLS = 8;
/** 긴 축 분산 / 짧은 축 분산이 이보다 작으면 둥글어 긴 축을 모른다(보류). */
export const AXIS_MIN_RATIO = 2;

/** 컵을 입에 댐: 그 상자를 든 손목이 있고 얼굴 점이 상자에서 scale × MOUTH_NEAR 안. */
export const atMouth = (people: readonly PoseInfo[], box: Box): boolean =>
  people.some((p) => p.face !== null && heldBy(p, box) !== null && toBox(p.face, box) <= p.scale * MOUTH_NEAR);

/** 마스크 1인 칸의 가운데 점(사진 픽셀). 칸이 SHAPE_MIN_CELLS보다 적으면 null. */
function maskPoints(m: Mask): Pt[] | null {
  if (!m.cols || !m.rows) return null;
  const cells = maskCells(m);
  const cw = m.at[2] / m.cols, ch = m.at[3] / m.rows;
  const out: Pt[] = [];
  for (let r = 0; r < m.rows; r++) for (let c = 0; c < m.cols; c++) if (cells[r * m.cols + c]) out.push([m.at[0] + (c + 0.5) * cw, m.at[1] + (r + 0.5) * ch]);
  return out.length >= SHAPE_MIN_CELLS ? out : null;
}

/** 점들의 긴 축(주성분 단위 벡터)과 긴·짧은 축 분산 비. */
function principal(pts: readonly Pt[]): { axis: Pt; ratio: number } {
  const mx = pts.reduce((a, p) => a + p[0], 0) / pts.length, my = pts.reduce((a, p) => a + p[1], 0) / pts.length;
  let sxx = 0, syy = 0, sxy = 0;
  for (const [x, y] of pts) {
    sxx += (x - mx) ** 2;
    syy += (y - my) ** 2;
    sxy += (x - mx) * (y - my);
  }
  const tr = sxx + syy, det = sxx * syy - sxy * sxy;
  const disc = Math.sqrt(Math.max(0, (tr * tr) / 4 - det));
  const l1 = tr / 2 + disc, l2 = tr / 2 - disc;
  const theta = 0.5 * Math.atan2(2 * sxy, sxx - syy);
  return { axis: [Math.cos(theta), Math.sin(theta)], ratio: l2 > 1e-9 ? l1 / l2 : Infinity };
}

/** 점들을 축(옆 side·위 up)에 비춘 범위. */
function spans(pts: readonly Pt[], side: Pt, up: Pt): { s0: number; s1: number; u0: number; u1: number } {
  let s0 = Infinity, s1 = -Infinity, u0 = Infinity, u1 = -Infinity;
  for (const p of pts) {
    const s = p[0] * side[0] + p[1] * side[1], u = p[0] * up[0] + p[1] * up[1];
    s0 = Math.min(s0, s); s1 = Math.max(s1, s); u0 = Math.min(u0, u); u1 = Math.max(u1, u);
  }
  return { s0, s1, u0, u1 };
}

/** 병을 컵에 따름(down: 그 자리 사진에 비친 중력 아래 방향, 모르면 null이라 보지 않는다): 병을 들었고, 병 마스크 긴 축이 중력에서 POUR_TILT_DEG 넘게 기울었으며,
 *  중력 좌표에서 병 마스크가 컵 마스크보다 위에 있고 옆으로 겹치며, 병 아래가 컵 위에서 위로 컵 높이 안·아래로 컵 높이 × POUR_DIP 안. */
export function pouringInto(people: readonly PoseInfo[], bottle: Shape, cup: Shape, down: Pt | null): boolean {
  if (!down) return false;
  const l = Math.hypot(down[0], down[1]);
  if (l < 1e-9 || !people.some((p) => heldBy(p, bottle.box) !== null)) return false;
  const bp = maskPoints(bottle.mask), cp = maskPoints(cup.mask);
  if (!bp || !cp) return false;
  const up: Pt = [-down[0] / l, -down[1] / l];
  const side: Pt = [up[1], -up[0]];
  const { axis, ratio } = principal(bp);
  if (ratio < AXIS_MIN_RATIO) return false;
  // 긴 축과 중력 사이 각(0° 세움, 90° 눕힘)
  const tilt = (Math.acos(Math.min(1, Math.abs(axis[0] * up[0] + axis[1] * up[1]))) * 180) / Math.PI;
  if (tilt < POUR_TILT_DEG) return false;
  const b = spans(bp, side, up), c = spans(cp, side, up);
  const overlap = Math.min(b.s1, c.s1) - Math.max(b.s0, c.s0);
  const cupH = c.u1 - c.u0;
  const gap = b.u0 - c.u1;
  return overlap > 0 && b.u0 + b.u1 > c.u0 + c.u1 && gap <= cupH && gap >= -cupH * POUR_DIP;
}
