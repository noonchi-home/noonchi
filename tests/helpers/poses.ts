// 시험용 관절: COCO 17개(기본은 안 보임, 신뢰도 0)에 번호별 [x, y, 신뢰도]를 넣는다. 5·6 어깨, 9·10 손목, 11·12 엉덩이, 13·14 무릎.
import type { Keypoint, Pose } from "../../src/contract/observe.js";

export function poseOf(points: Record<number, Keypoint>, box: Pose["box"] = [80, 60, 100, 300], score = 0.9): Pose {
  const keypoints: Keypoint[] = Array.from({ length: 17 }, () => [0, 0, 0] as Keypoint);
  for (const [i, p] of Object.entries(points)) keypoints[Number(i)] = p;
  return { score, box, keypoints };
}

/** 서 있는 사람(어깨 y100·엉덩이 y200·무릎 y280, x 115~145)에 손목 등 더할 관절. */
export const standing = (extra: Record<number, Keypoint> = {}, box?: Pose["box"]): Pose => poseOf({
  5: [110, 100, 0.9], 6: [150, 100, 0.9], 11: [115, 200, 0.9], 12: [145, 200, 0.9], 13: [115, 280, 0.9], 14: [145, 280, 0.9], ...extra,
}, box);
