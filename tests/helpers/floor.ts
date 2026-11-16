// 계획 시험이 함께 쓰는 작은 평면도: 복도(hall)와 주방(kitchen)이 트여 있고, 로봇은 복도 [1, 2], 식탁 [7, 3], 싱크대 [5, 1](싱크볼 [5, 1.2]).
import type { FloorPlan } from "../../src/layout/floor.js";
import { floorPlanFrom } from "../../src/layout/route.js";

export const SMALL_SCENE = {
  plan: {
    rooms: [
      { id: "hall", polygon: [[0, 0], [4, 0], [4, 4], [0, 4]] },
      { id: "kitchen", polygon: [[4, 0], [8, 0], [8, 4], [4, 4]] },
    ],
    doors: [], open_edges: [["hall", "kitchen"]], robot: { reachable_rooms: ["hall", "kitchen"] },
  },
  objects: [
    { id: "robot", type: "robot", room: "hall", plan: { position: [1, 2] } },
    { id: "table_1", type: "dining_table", room: "kitchen", plan: { position: [7, 3] } },
    { id: "sink_1", type: "sink_counter", room: "kitchen", plan: { position: [5, 1] }, anchors: { basin: [5, 1.2] } },
  ],
};

export function smallFloor(): FloorPlan {
  return floorPlanFrom(structuredClone(SMALL_SCENE));
}
