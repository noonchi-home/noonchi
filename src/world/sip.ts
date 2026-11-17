// 마시기·따르기 사건(관절과 상자만 본다, 2026-11-17 설계). 사건은 확인된 내용물을 「다시 확인 필요」로 여는 데만 쓴다(src/world/state/contents.ts reopen).
// 얼굴 앞에 컵을 들거나 병을 들고 지나가거나 원근으로 겹쳐도 사건이 될 수 있다. 새 값은 사건이 아니라 그 뒤 사진(3장·4초)이나 사람 답이 정한다.
import { heldBy, toBox, type PoseInfo } from "./pose.js";

type Box = [number, number, number, number];
/** 얼굴 점이 든 물건 상자에서 사람 크기(scale) × 이만큼 안이면 입에 댄 것이다. */
export const MOUTH_NEAR = 0.5;
/** 병 상자의 가로/세로가 이만큼 이상이면 기운 병이다(세운 병은 0.3~0.5). */
export const POUR_TILT = 0.8;

/** 컵을 입에 댐: 그 상자를 든 손목이 있고 얼굴 점이 상자에서 scale × MOUTH_NEAR 안. */
export const atMouth = (people: readonly PoseInfo[], box: Box): boolean =>
  people.some((p) => p.face !== null && heldBy(p, box) !== null && toBox(p.face, box) <= p.scale * MOUTH_NEAR);

/** 병을 컵에 따름: 병을 들었고 기울었으며, 병이 컵보다 위에 있고 가로로 겹치며 병 아래가 컵 위에서 컵 높이 안. */
export function pouringInto(people: readonly PoseInfo[], bottle: Box, cup: Box): boolean {
  if (!people.some((p) => heldBy(p, bottle) !== null) || bottle[2] / Math.max(1, bottle[3]) < POUR_TILT) return false;
  const overlap = Math.min(bottle[0] + bottle[2], cup[0] + cup[2]) - Math.max(bottle[0], cup[0]);
  return overlap > 0 && bottle[1] < cup[1] && cup[1] - (bottle[1] + bottle[3]) <= cup[3];
}
