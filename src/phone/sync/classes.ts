// 위치 맞추기에 쓰는 물건 종류: 크고 바닥에 서고 집에 보통 하나뿐인 것. 이름·COCO 번호는 World State 낱말 표(src/world/vocab.ts) 하나에서 온다.
// 감지기(src/observe/detector.ts)가 이 번호의 상자를 World State 감지와 따로 낸다. 트윈 종류와의 짝은 landmarks.ts.
// 공용 표: 낱말 표만 가져온다. 감지 Worker가 phone 입구(폰 서버) 없이 이 파일만 읽는다.

import { CLASSES, type ClassKey } from "../../world/vocab.js";

/** 기준점 종류(낱말 표 키). 소파·침대·식탁·변기는 World State가 거르는 가구지만 여기서는 쓴다. */
export const LANDMARK_KEYS = ["couch", "bed", "dining_table", "toilet", "tv", "microwave", "oven", "sink", "refrigerator"] as const satisfies readonly ClassKey[];

export type LandmarkClass = (typeof LANDMARK_KEYS)[number];

const BY_COCO = new Map<number, LandmarkClass>(LANDMARK_KEYS.flatMap((k) => Object.keys(CLASSES[k].coco).map((n): [number, LandmarkClass] => [Number(n), k])));

/** 기준점 종류의 COCO 번호. */
export const LANDMARK_IDS: readonly number[] = [...BY_COCO.keys()];

/** COCO 번호 → 기준점 종류. 기준점 종류가 아니면 null. */
export function landmarkClass(cls: number): LandmarkClass | null {
  return BY_COCO.get(cls) ?? null;
}
