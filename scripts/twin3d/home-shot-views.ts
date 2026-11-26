import type { Vec2 } from "../../src/contract/layout.js";
import type { StationMap } from "../../src/contract/stations.js";
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
/** 집 자료(stations.json)의 관찰 자리에서 찍는 장면. 서는 곳·바라볼 곳·이름은 집 자료에서만 읽는다. */
const STATION_SCENES = [
  { id: "living_standby", scenario: [1,2] },
  { id: "kitchen_entry", scenario: [1] },
  { id: "meal_watch", scenario: [1] },
  { id: "desk_watch", scenario: [2] },
] as const;
/** 집 자료(stations.json)의 면 앞 자리에서 찍는 장면(내려다보기 포함). 서는 곳·바라볼 곳은 집 자료에서만 읽는다. */
const FRONT_SCENES = [
  { id: "table_front", surface: "dining_table_978b20c7", scenario: [1], name: "식탁 앞" },
  { id: "sink_front", surface: "sink_counter_kitchen", scenario: [1,2], name: "싱크대 앞" },
  { id: "sofa_front", surface: "sofa_a848b595", scenario: [1], name: "소파 앞" },
  { id: "desk_front", surface: "desk_small_ce7e768b", scenario: [2], name: "책상 옆" },
] as const;
/** 집 자료에 없는 촬영 자리. living_tv_side는 거실 대기 자리를 옮기기 전 자리로, 위치 찾기 기준 사진 범위를 지킨다. */
const EXTRA_SPOTS: Station[] = [
  { id: "fridge_close", scenario: [2], name: "냉장고 바로 앞", stand: [6.7,2.5], look: [5.92,2.46], down: true },
  { id: "bed_sw_door_out", scenario: [2], name: "침실 1 문 밖", stand: [6.24,7.3], look: [6.24,9] },
  { id: "bed_sw_door_in", scenario: [2], name: "침실 1 문 안", stand: [6.24,8.3], look: [6.24,11.7] },
  { id: "living_tv_side", scenario: [1], name: "거실 TV 옆", stand: [10.5,9], look: [7.4,9.8] },
];

/** 장면을 찍을 자리: 집 자료의 관찰 자리·면 앞(찍는 차례 그대로) + 집 자료에 없는 자리. 집 자료에 없으면 멈춘다. */
export function homeSpots(map: StationMap): Station[] {
  const station = (id: string, scenario: readonly number[]): Station => {
    const s = map.stations.find(x => x.id === id);
    if (!s) throw new Error(`${id}: 집 자료에 관찰 자리가 없습니다.`);
    return { id, scenario: [...scenario], name: s.name, stand: s.position, look: s.look_at };
  };
  const front = (f: (typeof FRONT_SCENES)[number]): Station => {
    const x = map.surface_fronts.find(x => x.surface_id === f.surface);
    if (!x) throw new Error(`${f.id}: 집 자료에 ${f.surface} 앞 자리가 없습니다.`);
    return { id: f.id, scenario: [...f.scenario], name: f.name, stand: x.position, look: x.look_at, down: true };
  };
  const [living, kitchen, meal, desk] = STATION_SCENES.map(s => station(s.id, s.scenario));
  const [table, sink, sofa, deskFront] = FRONT_SCENES.map(front);
  const extra = (id: string) => EXTRA_SPOTS.find(s => s.id === id)!;
  return [living!, kitchen!, extra("fridge_close"), meal!, table!, sink!, sofa!,
    extra("bed_sw_door_out"), extra("bed_sw_door_in"), desk!, deskFront!, extra("living_tv_side")];
}

/** 걷는 길 장면: 진행 방향을 본다. 집 자료의 자리를 바라보는 점은 그 자리 값을 읽는다. */
function walkingSpots(map: StationMap): Station[] {
  const at = (id: string) => map.stations.find(s => s.id === id)!.position;
  return [
    { id: "path_living_kitchen", scenario: [1], name: "거실과 주방 입구 사이", stand: [9.4,6], look: at("kitchen_entry") },
    { id: "path_table_sink", scenario: [1], name: "식탁과 싱크대 사이", stand: [8.3,3], look: [6.52,0.69] },
    // 계획의 [8.5,5]·[7.2,5]는 가운데 욕실 안이라 평면도 1cm 격자에서 가장 가까운 걸을 수 있는 자리를 쓴다
    { id: "path_sink_living", scenario: [1,2], name: "주방에서 거실 대기 자리로 가는 길", stand: [9.04,5], look: at("living_standby") },
    { id: "path_living_bed_sw", scenario: [2], name: "거실과 침실 1 문 사이", stand: [8.3,7.4], look: [6.24,7.8] },
    { id: "path_bed_sw_kitchen", scenario: [2], name: "침실 1 문과 주방 사이", stand: [7.2,6.25], look: [6.7,2.5] },
  ];
}

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

export function homeShotViews(home: Home, scene: Scene, holdout = false) {
  const catalog = loadCatalog(home.catalogDir);
  const size = (type: string) => catalog.get(type)?.footprint;
  validateStations(scene.stations, scene, size);
  const stations = homeSpots(scene.stations);
  const { floor, walkable } = walkingGeometry(scene, size);
  const walk = walkingMap(floor, scene, size);
  const paths = walkingSpots(scene.stations);
  for (const point of paths) {
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
  const entryShot = shot({ ...living, id: "living_entry", scenario: [1], look: entry.point }, "C");
  const all = [
    ...views, { ...entryShot, look_name: "주방과 거실 사이 통로" },
    ...paths.flatMap(point => (["C","L30","R30"] as const).map(view => shot(point, view))),
  ];
  if (!holdout) return all;
  return all.map((ref,i) => {
    const [x,h,z] = ref.position;
    const room = walk.room([x,z]);
    const offsets = [[0.08,0.06],[-0.06,0.08],[-0.08,-0.06],[0.06,-0.08]];
    const stand = offsets.map((_,j) => offsets[(j+i)%offsets.length]!)
      .map(([dx,dz]): Vec2 => [x+dx!,z+dz!]).find(p => room && walkable(room,p));
    if (!stand) throw new Error(ref.id + ": 평가 카메라를 놓을 수 없습니다.");
    return { ...ref, position: [stand[0],h+0.03,stand[1]] as [number,number,number],
      yaw_deg: (ref.yaw_deg + (i%2 ? -4 : 4) + 360)%360, pitch_deg: ref.pitch_deg + (i%2 ? 2 : -2) };
  });
}
