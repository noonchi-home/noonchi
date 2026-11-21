import type { Vec2 } from "../../src/contract/layout.js";
import { loadCatalog } from "../../src/layout/catalog.js";
import type { Home } from "../../src/layout/homes.js";
import type { loadScene } from "../../src/layout/scene.js";
import { validateStations } from "../../src/layout/stations.js";
import { walkingGeometry } from "../../src/layout/walk-guide.js";

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

export const width = 1920;
export const height = 1080;
type View = "가운데" | "L30" | "R30" | "down";
function shot(station: Station, view: View) {
  const { id, scenario, name, stand: [x,z], look } = station;
  const base = Math.atan2(look[1]-z, look[0]-x) * 180 / Math.PI;
  const offset = { 가운데: 0, L30: -30, R30: 30, down: 0 }[view];
  return {
    id: `${id}_${view}`, station_id: id, station_name: name, scenario, view,
    position: [x,1.15,z] as [number,number,number], look, yaw_deg: (base + offset + 360) % 360,
    pitch_deg: view === "down" ? -35 : -10, vfov_deg: 40, width, height,
    doors: {
      door_bed_sw: id.startsWith("bed_sw_") || id.startsWith("desk_") ? "open" : "closed",
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
  const { floor } = walkingGeometry(scene, size);
  const entry = floor.portals.find(p => p.rooms.includes("living") && p.rooms.includes("kitchen"));
  if (!entry) throw new Error("목련 주방과 거실 사이 통로가 없습니다.");
  const views = stations.flatMap(s => {
    const directions: View[] = ["가운데", "L30", "R30"];
    if (s.down) directions.push("down");
    return directions.map(v => shot(s,v));
  });
  const living = stations.find(s => s.id === "living_standby")!;
  views.push(shot({ ...living, id: "living_entry", scenario: [1], name: "거실 대기 자리에서 주방 통로 방향", look: entry.point }, "가운데"));
  return views;
}
