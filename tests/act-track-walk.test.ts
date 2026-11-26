// 실행 추적의 폰 안내 목적지(TrackCore.walk): 계획 선(src/agent/planShape.ts)과 같은 이동 목적지에서 끝나고, 비전 글은 실제로 가는 자리를 말한다.
import { expect, it } from "vitest";
import type { SceneJson } from "../src/contract/layout.js";
import type { StationMap } from "../src/contract/stations.js";
import { TrackCore, type TrackConfig } from "../src/act/track/core.js";
import type { TrackerOptions } from "../src/act/track/tracker.js";
import { loadCatalog } from "../src/layout/catalog.js";
import { floorPlanFrom } from "../src/layout/floor.js";
import { resolveHome } from "../src/layout/homes.js";
import { loadScene } from "../src/layout/scene.js";
import { DEFAULT_TWIN_DIR } from "../src/layout/twin-files.js";
import { walkingMap } from "../src/layout/walk-guide.js";

const home = resolveHome(DEFAULT_TWIN_DIR, "mokryeon_180b");
const scene = loadScene(home)!;
const catalog = loadCatalog(home.catalogDir);
const floor = floorPlanFrom(scene);
const fridge = { id: "fridge_bbc363a3", label: "냉장고", position: [5.92, 0, 2.46] as [number, number, number] };

/** stations로 걷기 지도와 실행 추적 안쪽 객체를 만들고, 폰을 거실 대기 자리(6.98, 6.38)에 세운다. */
function standingCore(stations: StationMap = scene.stations) {
  const s = { ...scene, stations } as SceneJson;
  const map = walkingMap(floor, s, (type) => catalog.get(type)?.footprint);
  const clock = { t: 0, now() { return this.t; } };
  const options = {
    layout: { walking: () => map, floor: () => floor },
    stations: { map: () => stations, rev: () => 1, target: () => null, result: () => {} },
    state: { view: () => ({ devices: [], fixtures: [] }) },
    appliances: {},
  } as unknown as TrackerOptions;
  const core = new TrackCore(options, clock, {} as TrackConfig);
  for (const t of [100, 200]) core.navigation.pose({ position: [6.98, 6.38], quality: "usable", pose_gen: 1, observed_ms: t });
  clock.t = 200;
  return core;
}

it("guides a go step to an object with no furniture front (the fridge) to the kitchen standby spot, where the plan line ends, and names that spot", () => {
  const nav = standingCore().walk("go-fridge", fridge);
  // 냉장고는 가구 앞자리가 없다: 주방 대기 자리 kitchen_entry (8.15, 2.9), 이름 「주방 입구」, 폰에서 곧은 거리 3.67m
  expect(nav?.guide?.remaining.at(-1)).toMatchObject({ kind: "stand", room: "kitchen", position: [8.15, 0, 2.9] });
  expect(nav?.vision).toBe("주방 입구까지 3.7m");
});

it("says 「설 자리까지」 when the room has no standby spot and the guide goes to the nearest grid point", () => {
  const stations = { ...scene.stations, stations: scene.stations.stations.filter((s) => s.id !== "kitchen_entry") };
  expect(standingCore(stations).walk("go-fridge", fridge)?.vision).toMatch(/^설 자리까지 \d+\.\dm$/);
});

it("keeps 「… 앞까지」 for a furniture front spot", () => {
  const nav = standingCore().walk("go-sink", { id: "sink_counter_kitchen", label: "싱크대", position: [5.86, 0.9, 0.693] });
  expect(nav?.vision).toMatch(/ 앞까지 \d+\.\dm$/);
  expect(nav?.vision).not.toMatch(/^주방 입구|^설 자리/);
});
