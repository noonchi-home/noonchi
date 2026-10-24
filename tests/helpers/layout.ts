// 배치 편집기·배치 도구 테스트가 함께 쓰는 작은 원룸 장면과 카탈로그.
import type { TypeInfo } from "../../src/layout/catalog.js";
import type { SceneJson } from "../../src/layout/editor.js";

export const R = (deg: number) => (deg * Math.PI) / 180;
export const yaw = (facing: number) => R(-(facing - 90));

function obj(id: string, type: string, mount: string, x: number, h: number, y: number, facing: number, extra: Record<string, unknown> = {}) {
  return {
    id, name: id, type, mount, category: mount === "opening" ? "fixtures" : "appliances", room: "room",
    asset: `assets/appliances/${type}.glb`, interactive: true,
    plan: { position: [x, y], facing_deg: facing, elevation: h, on: null, surface: null, wall: null },
    position: [x, h, y], rotation: [0, yaw(facing), 0], scale: [1, 1, 1], attrs: {}, states: {}, state: {},
    ...extra,
  };
}

export function scene(): SceneJson {
  return {
    plan: {
      ceiling_height: 2.3,
      rooms: [
        { id: "room", label: "방", polygon: [[0, 0], [4, 0], [4, 4], [0, 4]], floor_z: 0 },
        { id: "entrance", label: "현관", polygon: [[2, 4], [4, 4], [4, 5], [2, 5]], floor_z: -0.1 },
      ],
      walls: [
        { id: "N", a: [0, 0], b: [4, 0], thickness: 0.2 },
        { id: "E", a: [4, 0], b: [4, 5], thickness: 0.2 },
      ],
    },
    objects: [
      { ...obj("walls", "walls", "floor", 0, 0, 0, 90), category: "structure", interactive: false },
      obj("fridge_1", "fridge", "floor", 1, 0, 1, 90, { name: "냉장고", attrs: { door: ["closed", "open"] } }),
      obj("tv_stand_1", "tv_stand", "floor", 2, 0, 3.5, 270, { name: "TV장", category: "furniture" }),
      obj("tv_1", "tv", "surface", 2, 0.45, 3.55, 270, { name: "TV", plan: { position: [2, 3.55], facing_deg: 270, elevation: 0.45, on: "tv_stand_1", surface: "top", wall: null } }),
      obj("ac_1", "wall_ac", "wall", 3.9, 1.95, 2, 180, { name: "벽걸이 에어컨" }),
      { ...obj("light_room", "ceiling_light", "ceiling", 2, 2.3, 2, 90), interactive: false, name: "천장등" },
      { ...obj("door_main", "door_main", "opening", 3, -0.1, 5, 270), interactive: false, name: "현관문" },
    ],
  };
}

export const CATALOG = new Map<string, TypeInfo>([
  ["fridge", { type: "fridge", label: "양문형 냉장고", category: "appliances", mount: "floor", footprint: [0.92, 0.75], height: 1.85, attrs: { door: ["closed", "open"] }, states: {} }],
  ["tv_stand", { type: "tv_stand", label: "TV장", category: "furniture", mount: "floor", footprint: [1.8, 0.42], height: 0.45, attrs: {}, states: {} }],
  ["tv", { type: "tv", label: "TV 65형", category: "appliances", mount: "surface", footprint: [1.45, 0.22], height: 0.9, attrs: { power: ["off", "on"] }, states: {} }],
  ["wall_ac", { type: "wall_ac", label: "벽걸이 에어컨", category: "appliances", mount: "wall", footprint: [0.85, 0.22], height: 0.27, attrs: { power: ["off", "on"] }, states: { power: { default: "off" } } }],
  ["ceiling_light", { type: "ceiling_light", label: "원형 천장등", category: "fixtures", mount: "ceiling", footprint: [0.45, 0.45], height: 0.08, attrs: { power: ["off", "on"] }, states: {} }],
  ["door_main", { type: "door_main", label: "현관문", category: "fixtures", mount: "opening", footprint: [0.95, 0.2], height: 2.1, attrs: {}, states: {} }],
  ["air_purifier", { type: "air_purifier", label: "공기청정기", category: "appliances", mount: "floor", footprint: [0.29, 0.29], height: 0.75, attrs: { power: ["off", "on"] }, states: {} }],
  ["microwave", { type: "microwave", label: "전자레인지", category: "appliances", mount: "surface", footprint: [0.5, 0.4], height: 0.3, attrs: { power: ["off", "on"] }, states: {} }],
]);

