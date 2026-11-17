// 마시기·따르기 사건(관절과 상자만 본다, 2026-11-17 설계). 사건은 확인된 내용물을 「다시 확인 필요」로 여는 데만 쓴다(src/world/state/contents.ts reopen).
// 얼굴 앞에 컵을 들거나 병을 들고 지나가거나 원근으로 겹쳐도 사건이 될 수 있다. 새 값은 사건이 아니라 그 뒤 사진(3장·4초)이나 사람 답이 정한다.
// 따르기는 사진 축이 아니라 그 자리의 중력 방향(카메라 자세로 구함, 쓰러짐 의심과 같은 downOf) 좌표에서 본다: 폰을 돌려 들어도 세운 병은 세운 병이다.
// 카메라 자세가 없으면(맞추기 전·거의 바로 아래를 봄) 따르기를 보지 않는다. 상자는 사진 축에 맞춘 네모라, 중력이 사진 축에서 POUR_AXIS_DEG 넘게 기울면
// 병 방향을 알 수 없어(45°로 돌린 세운 병도 정사각 상자) 보지 않는다. 그 안이면 가까운 사진 축으로 맞춰 본다.
import { heldBy, toBox, type PoseInfo, type Pt } from "./pose.js";

type Box = [number, number, number, number];
/** 얼굴 점이 든 물건 상자에서 사람 크기(scale) × 이만큼 안이면 입에 댄 것이다. */
export const MOUTH_NEAR = 0.5;
/** 병 상자의 중력 옆/위 길이가 이만큼 이상이면 기운 병이다(세운 병은 0.3~0.5). */
export const POUR_TILT = 0.8;
/** 병 아래가 컵 위보다 컵 높이 × 이만큼까지는 아래여도 된다(병 입이 컵 입에 걸침). 그보다 아래면 컵 앞에서 든 병이다. */
export const POUR_DIP = 0.5;
/** 중력이 사진 축에서 이만큼(°) 넘게 기울면 따르기를 보지 않는다. */
export const POUR_AXIS_DEG = 20;

/** 컵을 입에 댐: 그 상자를 든 손목이 있고 얼굴 점이 상자에서 scale × MOUTH_NEAR 안. */
export const atMouth = (people: readonly PoseInfo[], box: Box): boolean =>
  people.some((p) => p.face !== null && heldBy(p, box) !== null && toBox(p.face, box) <= p.scale * MOUTH_NEAR);

/** 상자의 네 귀를 중력 옆(side)·위(up) 축에 비춘 범위. */
function spans(b: Box, side: Pt, up: Pt): { s0: number; s1: number; u0: number; u1: number } {
  const corners: Pt[] = [[b[0], b[1]], [b[0] + b[2], b[1]], [b[0], b[1] + b[3]], [b[0] + b[2], b[1] + b[3]]];
  const s = corners.map((c) => c[0] * side[0] + c[1] * side[1]);
  const u = corners.map((c) => c[0] * up[0] + c[1] * up[1]);
  return { s0: Math.min(...s), s1: Math.max(...s), u0: Math.min(...u), u1: Math.max(...u) };
}

/** 병을 컵에 따름(down: 그 자리 사진에 비친 중력 아래 방향, 모르면 null이라 보지 않는다): 병을 들었고, 중력 좌표에서 기울었으며(옆/위 POUR_TILT 이상),
 *  병이 컵보다 위에 있고 옆으로 겹치며, 병 아래가 컵 위에서 위로 컵 높이 안·아래로 컵 높이 × POUR_DIP 안. */
export function pouringInto(people: readonly PoseInfo[], bottle: Box, cup: Box, down: Pt | null): boolean {
  if (!down) return false;
  const l = Math.hypot(down[0], down[1]);
  if (l < 1e-9 || !people.some((p) => heldBy(p, bottle) !== null)) return false;
  const ax = Math.abs(down[0]) / l, ay = Math.abs(down[1]) / l;
  if (Math.max(ax, ay) < Math.cos((POUR_AXIS_DEG * Math.PI) / 180)) return false;
  // 가까운 사진 축으로 맞춘 중력 위 방향(축에 맞춘 상자를 그대로 비춘다)
  const up: Pt = ax > ay ? [-Math.sign(down[0]), 0] : [0, -Math.sign(down[1])];
  const side: Pt = [up[1], -up[0]];
  const b = spans(bottle, side, up), c = spans(cup, side, up);
  if ((b.s1 - b.s0) / Math.max(1, b.u1 - b.u0) < POUR_TILT) return false;
  const overlap = Math.min(b.s1, c.s1) - Math.max(b.s0, c.s0);
  const cupH = c.u1 - c.u0;
  const gap = b.u0 - c.u1;
  return overlap > 0 && b.u0 + b.u1 > c.u0 + c.u1 && gap <= cupH && gap >= -cupH * POUR_DIP;
}
