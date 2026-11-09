// 위치 맞추기에 쓰는 물건 종류(COCO 번호 → 이름). 크고 바닥에 서고 집에 보통 하나뿐인 것만 둔다.
// 감지기(src/brain/detector.ts)가 이 번호의 상자를 World State 감지와 따로 낸다. 트윈 종류와의 짝은 landmarks.ts.

export const LANDMARK_COCO = {
  57: "couch",
  59: "bed",
  60: "dining table",
  61: "toilet",
  62: "tv",
  68: "microwave",
  69: "oven",
  71: "sink",
  72: "refrigerator",
} as const;

export type LandmarkClass = (typeof LANDMARK_COCO)[keyof typeof LANDMARK_COCO];

export const LANDMARK_IDS: readonly number[] = Object.keys(LANDMARK_COCO).map(Number);

/** COCO 번호 → 기준점 종류 이름. 기준점 종류가 아니면 null. */
export function landmarkClass(cls: number): LandmarkClass | null {
  return (LANDMARK_COCO as Record<number, LandmarkClass>)[cls] ?? null;
}
