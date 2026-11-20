import { Navigation } from "../src/act/robot/navigation.js";
import { describe, expect, it } from "vitest";
import { walkingMap } from "../src/layout/walk-guide.js";
import { loadScene } from "../src/layout/scene.js";
import { resolveHome } from "../src/layout/homes.js";
import { DEFAULT_TWIN_DIR } from "../src/layout/twin-files.js";
import { loadCatalog } from "../src/layout/catalog.js";
import { floorPlanFrom } from "../src/layout/floor.js";
import type { SceneJson } from "../src/contract/layout.js";

export const rooms = [
  {
    id: "A",
    polygon: [
      [0, 0],
      [4, 0],
      [4, 4],
      [0, 4],
    ],
  },
  {
    id: "B",
    floor_z: 0.05,
    polygon: [
      [4, 0],
      [8, 0],
      [8, 4],
      [4, 4],
    ],
  },
];
export const fixture = {
  plan: {
    rooms,
    doors: [{ id: "p", position: [4, 2], connects: ["A", "B"], width: 1 }],
    robot: { reachable_rooms: ["A", "B"] },
  },
  objects: [],
} as unknown as SceneJson;
describe("walking map", () => {
  it("routes through the opening and ends at the configured floor height", () => {
    const map = walkingMap(floorPlanFrom(fixture), fixture);
    const path = map.plan([1, 2], [7, 2], 0.32, true);
    expect(path?.remaining).toEqual([
      { kind: "portal", id: "p", from_room: "A", to_room: "B", position: [4, 0.05, 2] },
      { kind: "stand", room: "B", position: [7, 0.05, 2] },
    ]);
    expect(map.plan([-1, 0], [7, 2], 0.32, true)).toBeNull();
  });
  it("rebuilds a stale plan leg and rejects a short fallback that would end on the doorway",()=>{
    const map=walkingMap(floorPlanFrom(fixture),fixture);
    const g=map.plan([3.95,2],[7,2],0.32,true,[[7,3],[7.1,2.4]]);
    expect(g?.remaining[0]).toMatchObject({kind:"portal",id:"p"});
    expect(g?.remaining.at(-1)).toMatchObject({position:[7,0.05,2]});
    expect(map.plan([1,2],[4.1,2],0.5,false)).toBeNull();
    expect(map.plan([6,2],[7,2],0.5,false)?.remaining).toEqual([{kind:"stand",room:"B",position:[6.45,0.05,2]}]);
    const disconnected={...fixture,plan:{...fixture.plan,doors:[]}};
    expect(walkingMap(floorPlanFrom(disconnected),disconnected).plan([1,2],[7,2],0.3,true)).toBeNull();
  });
  it("detours inside a room around a cabinet, checking every remaining segment", () => {
    const scene = {
      ...fixture,
      objects: [
        {
          id: "cab",
          room: "A",
          type: "cabinet",
          mount: "floor",
          plan: { position: [2, 2], elevation: 0, facing_deg: 90 },
          footprint: [0.7, 1.2],
        },
      ],
    } as SceneJson;
    const map = walkingMap(floorPlanFrom(scene), scene);
    const start: [number, number] = [0.6, 2],
      goal: [number, number] = [3.4, 2];
    expect(map.clear(start, goal, "A")).toBe(false);
    const path = map.plan(start, goal, 0.3, true)!;
    expect(path.remaining.some((p) => p.kind === "via")).toBe(true);
    let before = start;
    for (const p of path.remaining) {
      const to: [number, number] = [p.position[0], p.position[2]];
      expect(map.clear(before, to, "A")).toBe(true);
      before = to;
    }
  });
  it("does not treat the wall beside a door as part of the opening", () => {
    const scene = {
      ...fixture,
      plan: { ...fixture.plan, walls: [{ id: "blocking", a: [3.78, 1.5], b: [3.78, 2.5], thickness: 0.06 }] },
    } as SceneJson;
    expect(
      walkingMap(floorPlanFrom(scene), scene).clear([3.72, 2], [4, 2], "A", [floorPlanFrom(scene).portals[0]!])
    ).toBe(false);
  });
  it("guides from the table through the kitchen opening to the basin even when furniture blocks the grid", () => {
    const scene = loadScene(resolveHome(DEFAULT_TWIN_DIR, "mokryeon_180b"))!;
    const fronts = scene.stations.surface_fronts;
    const sink = fronts.find((f) => f.surface_id === "sink_counter_kitchen")!;
    const table = fronts.find((f) => f.surface_id.startsWith("dining_table"))!;
    const catalog = loadCatalog(resolveHome(DEFAULT_TWIN_DIR, "mokryeon_180b").catalogDir);
    const map = walkingMap(floorPlanFrom(scene), scene, (type) => catalog.get(type)?.footprint);
    const nav = new Navigation();
    let t = 0;
    const sample = (p: [number,number]) => {
      t += 500;
      nav.pose({position:p,quality:"usable",pose_gen:1,observed_ms:t});
      return nav.read("carry",map,sink.position,sink.near_m,true,t);
    };
    // Stage 8 also starts here in recordings made with the original table front.
    const from: [number,number] = [9.96,5.15];
    sample(from);
    expect(sample(from).guide?.remaining[0]).toMatchObject({kind:"portal",to_room:"kitchen"});
    for (const p of [[9.6,4.6],[9.4,4.1],[9.1,3.6],[8.9,3.206],[8.6,3.206]] as [number,number][]) sample(p);
    expect(sample([8.45,3.206]).guide?.remaining[0]).toMatchObject({kind:"stand",position:[6.52,0,0.693]});
    expect(map.plan(table.position,sink.position,sink.near_m,true)).not.toBeNull();
    const path = map.plan([9.1, 2.75], sink.position, sink.near_m, true);
    expect(path?.remaining.some((p) => p.kind === "portal")).toBe(true);
    expect(path?.remaining.at(-1)?.position).toEqual([6.52, 0, 0.693]);
  });
});
