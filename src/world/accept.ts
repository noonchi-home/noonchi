// accept.ts — 상태 없는 감지 거르기: 낱말 표의 종류와 그 종류의 최소 신뢰도만 본다.
// World State와 인식 노드(World State를 갖지 않음)가 같은 함수로 같은 감지를 거른다(stage-queue 묶음 2).
import type { Detection } from "../contract/observe.js";
import { CLASSES, type ClassKey } from "./vocab.js";

/** 물건 종류(낱말 표 role object). */
export const OBJ_CLASSES: ReadonlySet<string> = new Set((Object.keys(CLASSES) as ClassKey[]).filter((k) => CLASSES[k].role === "object"));

/** 이 감지를 받는가: 낱말 표의 사람·물건·가전 설비 종류이고 그 종류의 최소 신뢰도 이상. 관찰 흐름은 받는 감지만 상자·YOLO 글·VLM 감지 목록에 싣는다. */
export function accepts(d: Pick<Detection, "label" | "score">): boolean {
  const c = (CLASSES as Record<string, (typeof CLASSES)[ClassKey] | undefined>)[d.label];
  return !!c && c.role !== "scene" && d.score >= c.minScore;
}

/** 가까이 본 감지가 물건 감지인가: 잘라 본 사진 가장자리에 걸리지 않고, 받는 감지이고, 물건 종류. */
export function closerObject(d: Pick<Detection, "label" | "score"> & { edge: boolean }): boolean {
  return !d.edge && accepts(d) && OBJ_CLASSES.has(d.label);
}
