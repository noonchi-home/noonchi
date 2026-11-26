// 실행 추적의 폰 안내 목적지(TrackCore.walk): 계획 선(src/agent/planShape.ts)과 같은 이동 목적지에서 끝난다.
import { expect, it } from "vitest";
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
const map = walkingMap(floor, scene, (type) => catalog.get(type)?.footprint);

it("guides a go step to an object with no furniture front (the fridge) to the kitchen standby spot, where the plan line ends", () => {
  const clock = { t: 0, now() { return this.t; } };
  const options = {
    layout: { walking: () => map, floor: () => floor },
    stations: { map: () => scene.stations, rev: () => 1, target: () => null, result: () => {} },
    state: { view: () => ({ devices: [], fixtures: [] }) },
    appliances: {},
  } as unknown as TrackerOptions;
  const core = new TrackCore(options, clock, {} as TrackConfig);
  // 거실 대기 자리(6.98, 6.38)에 선 폰
  for (const t of [100, 200]) core.navigation.pose({ position: [6.98, 6.38], quality: "usable", pose_gen: 1, observed_ms: t });
  clock.t = 200;
  const nav = core.walk("go-fridge", { id: "fridge_bbc363a3", label: "냉장고", position: [5.92, 0, 2.46] });
  // 냉장고는 가구 앞자리가 없다: 주방 대기 자리 kitchen_entry (8.15, 2.9)
  expect(nav?.guide?.remaining.at(-1)).toMatchObject({ kind: "stand", room: "kitchen", position: [8.15, 0, 2.9] });
});
