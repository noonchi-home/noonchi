// 상태 없는 감지 거르기(src/world/accept.ts): 인식 노드가 World State 없이 같은 감지를 거른다.
// 낱말 표의 모든 종류 × 최소 신뢰도 경계 × 잘린 가장자리에서 WorldState 메서드와 같은 답을 낸다.
import { describe, expect, it } from "vitest";
import { WorldState, accepts, closerObject } from "../src/world/index.js";
import { CLASSES } from "../src/world/vocab.js";

const world = new WorldState({ surfaces: () => [], floorAt: () => 0, roomAt: () => null, devices: () => [] });
const mask = { at: [0, 0, 1, 1] as [number, number, number, number], cols: 0, rows: 0, bits: "" };

describe("상태 없는 감지 거르기", () => {
  const labels = [...Object.keys(CLASSES), "toothbrush", ""];
  const scores = (min: number) => [0, min - 0.001, min, min + 0.001, 1];

  it("accepts는 모든 종류·점수 경계에서 WorldState.accepts와 같다", () => {
    for (const label of labels) {
      const min = (CLASSES as Record<string, { minScore: number } | undefined>)[label]?.minScore ?? 0.5;
      for (const score of scores(min)) expect(accepts({ label: label as never, score }), `${label} ${score}`).toBe(world.accepts({ label: label as never, score }));
    }
  });

  it("closerObject는 모든 종류·점수 경계·가장자리에서 WorldState.closerObject와 같다", () => {
    for (const label of labels) {
      const min = (CLASSES as Record<string, { minScore: number } | undefined>)[label]?.minScore ?? 0.5;
      for (const score of scores(min)) {
        for (const edge of [false, true]) {
          const d = { label: label as never, score, edge, box: [0, 0, 1, 1] as [number, number, number, number], cls: 0, mask, foot: [0, 0] as [number, number] };
          expect(closerObject(d), `${label} ${score} ${edge}`).toBe(world.closerObject(d));
        }
      }
    }
  });
});
