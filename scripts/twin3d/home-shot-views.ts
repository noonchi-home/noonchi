import type { Vec2 } from "../../src/contract/layout.js";
import { loadCatalog } from "../../src/layout/catalog.js";
import type { Home } from "../../src/layout/homes.js";
import type { loadScene } from "../../src/layout/scene.js";
import { validateStations } from "../../src/layout/stations.js";
import { walkingGeometry, walkingMap } from "../../src/layout/walk-guide.js";

type Scene = NonNullable<ReturnType<typeof loadScene>>;
interface Station {
  id: string;
  scenario: number[];
  name: string;
  stand: Vec2;
  look: Vec2;
  down?: boolean;
}
const stations: Station[] = [
  { id: "living_standby", scenario: [1,2], name: "거실 대기 자리", stand: [10.5,9], look: [7.4,9.8] },
  { id: "kitchen_entry", scenario: [1], name: "주방 입구", stand: [8.15,2.9], look: [5.92,2.46] },
  { id: "fridge_close", scenario: [2], name: "냉장고 바로 앞", stand: [6.7,2.5], look: [5.92,2.46], down: true },
  { id: "meal_watch", scenario: [1], name: "식탁 관찰 자리", stand: [10.55,6.35], look: [9.7,3.9] },
  { id: "table_front", scenario: [1], name: "식탁 앞", stand: [9.96,5.15], look: [9.96,3.92], down: true },
  { id: "sink_front", scenario: [1,2], name: "싱크대 앞", stand: [6.52,0.69], look: [5.86,0.69], down: true },
  { id: "sofa_front", scenario: [1], name: "소파 앞", stand: [8.25,9.4], look: [7.39,9.81], down: true },
  { id: "bed_sw_door_out", scenario: [2], name: "침실 1 문 밖", stand: [6.24,7.3], look: [6.24,9] },
  { id: "bed_sw_door_in", scenario: [2], name: "침실 1 문 안", stand: [6.24,8.3], look: [6.24,11.7] },
  { id: "desk_watch", scenario: [2], name: "책상 관찰 자리", stand: [5.75,10.05], look: [6.23,11.73] },
  // Closest walkable centimetre to the proposed [5.55, 11.35].
  { id: "desk_front", scenario: [2], name: "책상 옆", stand: [5.53,11.35], look: [6.24,11.73], down: true },
];

const walkingSpots: Station[] = [
  { id: "path_living_kitchen", scenario: [1], name: "거실 대기 자리와 주방 입구 사이", stand: [9.4,6], look: [8.15,2.9] },
  { id: "path_table_sink", scenario: [1], name: "식탁과 싱크대 사이", stand: [8.3,3], look: [6.52,0.69] },
  // The proposed [8.5,5] and [7.2,5] are inside the centre bathroom.
  // These are the closest accessible positions on the plan's centimetre grid.
  { id: "path_sink_living", scenario: [1,2], name: "싱크대와 거실 대기 자리 사이", stand: [9.04,5], look: [10.5,9] },
  { id: "path_living_bed_sw", scenario: [2], name: "거실 대기 자리와 침실 1 문 사이", stand: [8.3,7.4], look: [6.24,7.8] },
  { id: "path_bed_sw_kitchen", scenario: [2], name: "침실 1 문과 주방 사이", stand: [7.2,6.25], look: [6.7,2.5] },
];

export const width = 1920;
export const height = 1080;
const yawOffsets = { C: 0, L30: -30, R30: 30, L60: -60, R60: 60, down: 0 } as const;
type View = keyof typeof yawOffsets;
function shot(station: Station, view: View) {
  const { id, scenario, name, stand: [x,z], look } = station;
  const base = Math.atan2(look[1]-z, look[0]-x) * 180 / Math.PI;
  const shotId = `${id}_${view}`;
  return {
    id: shotId, file: shotId + ".png", station_id: id, station_name: name, spot_name: name, scenario, view,
    position: [x,1.15,z] as [number,number,number], look, yaw_deg: (base + yawOffsets[view] + 360) % 360,
    pitch_deg: view === "down" ? -35 : -10, vfov_deg: 40, width, height,
    doors: {
      door_bed_sw: id.includes("bed_sw") || id.startsWith("desk_") ? "open" : "closed",
      fridge_bbc363a3: id === "fridge_close" ? "open" : "closed",
    },
  };
}

export function homeShotViews(home: Home, scene: Scene) {
  const desk = stations.find(s => s.id === "desk_front")!;
  const catalog = loadCatalog(home.catalogDir);
  const size = (type: string) => catalog.get(type)?.footprint;
  const front = { surface_id: "desk_small_ce7e768b", room: "bed_sw", position: desk.stand, look_at: desk.look, near_m: 0.32 };
  validateStations({ ...scene.stations, surface_fronts: [...scene.stations.surface_fronts, front] }, scene, size);
  const { floor, walkable } = walkingGeometry(scene, size);
  const walk = walkingMap(floor, scene, size);
  for (const point of walkingSpots) {
    const room = walk.room(point.stand);
    if (!room || !walkable(room, point.stand) || !scene.stations.stations.some(s =>
      s.room === room && walk.gridReachable(point.stand, s.position, room))) {
      throw new Error(`${point.id}: 걷는 길에 연결된 빈 바닥이 필요합니다.`);
    }
  }
  const entry = floor.portals.find(p => p.rooms.includes("living") && p.rooms.includes("kitchen"));
  if (!entry) throw new Error("목련 주방과 거실 사이 통로가 없습니다.");
  const views = stations.flatMap(s => {
    const directions: View[] = ["C", "L30", "R30", "L60", "R60"];
    if (s.down) directions.push("down");
    return directions.map(v => shot(s,v));
  });
  const living = stations.find(s => s.id === "living_standby")!;
  const entryShot = shot({ ...living, id: "living_entry", scenario: [1], name: "거실 대기 자리", look: entry.point }, "C");
  return [
    ...views, { ...entryShot, look_name: "주방과 거실 사이 통로" },
    ...walkingSpots.flatMap(point => (["C","L30","R30"] as const).map(view => shot(point, view))),
  ];
}
