import { Navigation } from "../src/act/robot/navigation.js";
import { describe, expect, it } from "vitest";
import { walkingMap } from "../src/layout/walk-guide.js";
import { loadScene } from "../src/layout/scene.js";
import { resolveHome } from "../src/layout/homes.js";
import { DEFAULT_TWIN_DIR } from "../src/layout/twin-files.js";
import { loadCatalog } from "../src/layout/catalog.js";
import { floorPlanFrom } from "../src/layout/floor.js";
import type { SceneJson, Vec2 } from "../src/contract/layout.js";
import { WALK_STEP } from "../src/layout/walk-grid.js";

/** 폰 안내 경유점은 모두 이동 가능 점 격자 점이다: 트윈 원점 기준 WALK_STEP 배수 자리, 또는 문 앞 점(문 점과 x나 z가 같고 다른 축은 WALK_STEP 배수). */
const onStep = (v: number) => Math.abs(v / WALK_STEP - Math.round(v / WALK_STEP)) < 1e-6;
const onGrid = (scene: SceneJson) => {
  const doors = ((scene.plan.doors ?? []) as { position: Vec2 }[]).map((d) => d.position);
  return (p: { kind: string; position: number[] }) => {
    if (p.kind !== "via") return true;
    const [x, z] = [p.position[0]!, p.position[2]!];
    return (onStep(x) && onStep(z)) || doors.some((d) => (Math.abs(x - d[0]) < 1e-9 && onStep(z)) || (Math.abs(z - d[1]) < 1e-9 && onStep(x)));
  };
};

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
    expect(path?.remaining.filter((p) => p.kind !== "via")).toEqual([
      { kind: "portal", id: "p", from_room: "A", to_room: "B", position: [4, 0.05, 2] },
      { kind: "stand", room: "B", position: [7, 0.05, 2] },
    ]);
    expect(path?.remaining.every(onGrid(fixture))).toBe(true);
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
  it("guides from the table around the table corner and through the kitchen opening to the basin (dining chairs are not walking obstacles)", () => {
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
    const guide = sample(from).guide!.remaining;
    // 식탁 모서리(거실 격자 점)를 돌아 주방 트인 곳을 지나 싱크대 앞에 선다
    expect(guide[0]).toMatchObject({kind:"via",room:"living"});
    expect(guide.find((p) => p.kind === "portal")).toMatchObject({kind:"portal",to_room:"kitchen"});
    expect(guide.every(onGrid(scene))).toBe(true);
    // 안내 점을 따라 걸으면 마지막에는 싱크대 앞 설 자리만 남는다
    for (const p of guide.slice(0, -1)) { sample([p.position[0], p.position[2]]); sample([p.position[0], p.position[2]]); }
    expect(sample([6.9, 0.9]).guide?.remaining[0]).toMatchObject({kind:"stand",position:[6.52,0,0.693]});
    expect(map.plan(table.position,sink.position,sink.near_m,true)).not.toBeNull();
    const path = map.plan([9.1, 2.75], sink.position, sink.near_m, true);
    expect(path?.remaining.some((p) => p.kind === "portal")).toBe(true);
    expect(path?.remaining.at(-1)?.position).toEqual([6.52, 0, 0.693]);
  });
  it("phone guide waypoints are all walkable grid points (real home routes between standby, watch and furniture front spots)", () => {
    const home = resolveHome(DEFAULT_TWIN_DIR, "mokryeon_180b");
    const scene = loadScene(home)!;
    const catalog = loadCatalog(home.catalogDir);
    const map = walkingMap(floorPlanFrom(scene), scene, (type) => catalog.get(type)?.footprint);
    const spots: Vec2[] = [...scene.stations.stations.map((s) => s.position), ...scene.stations.surface_fronts.map((f) => f.position)];
    let vias = 0;
    for (const a of spots)
      for (const b of spots) {
        if (a === b) continue;
        const guide = map.plan(a, b, 0.3, true);
        if (!guide) continue;
        vias += guide.remaining.filter((p) => p.kind === "via").length;
        expect(guide.remaining.every(onGrid(scene)), `${a} → ${b}`).toBe(true);
      }
    expect(vias).toBeGreaterThan(50);
  });
  describe("real home doors", () => {
    const home = resolveHome(DEFAULT_TWIN_DIR, "mokryeon_180b");
    const scene = loadScene(home)!;
    const catalog = loadCatalog(home.catalogDir);
    const map = walkingMap(floorPlanFrom(scene), scene, (type) => catalog.get(type)?.footprint);
    const station = (id: string) => scene.stations.stations.find((s) => s.id === id)!.position as [number, number];
    const front = (surface: string) => scene.stations.surface_fronts.find((f) => f.surface_id.startsWith(surface))!.position as [number, number];
    /** 영상 모드 followGuide처럼 안내의 첫 점(문이면 다음 점 쪽 0.12m 너머)으로 0.08m씩 걷는다. 길을 잃은 읽기(distance null) 수를 센다. */
    function walk(from: [number, number], to: [number, number], near = 0.35, exact = true) {
      const nav = new Navigation();
      let t = 0, at = from, lost = 0;
      const pose = () => nav.pose({ position: at, quality: "usable", pose_gen: 1, observed_ms: (t += 100) });
      pose();
      pose();
      const seen: string[] = [];
      for (let n = 0; n < 3000; n++) {
        const r = nav.read("go", map, to, near, exact, t);
        if (r.arrived) return { arrived: true, lost, seen };
        if (!r.guide || r.distance === null) {
          lost++;
          pose();
          continue;
        }
        const [first, beyond] = r.guide.remaining;
        const key = first!.kind === "portal" ? first!.id : first!.kind;
        if (seen.at(-1) !== key) seen.push(key);
        let goal: [number, number] = [first!.position[0], first!.position[2]];
        if (first!.kind === "portal" && beyond) {
          const dx = beyond.position[0] - goal[0], dz = beyond.position[2] - goal[1], len = Math.hypot(dx, dz);
          goal = [goal[0] + (0.12 * dx) / len, goal[1] + (0.12 * dz) / len];
        }
        const d = Math.hypot(goal[0] - at[0], goal[1] - at[1]);
        at = d <= 0.08 ? goal : [at[0] + ((goal[0] - at[0]) * 0.08) / d, at[1] + ((goal[1] - at[1]) * 0.08) / d];
        pose();
      }
      return { arrived: false, lost, seen };
    }
    it.each([
      ["living standby", "desk", () => station("living_standby"), () => front("desk_small")],
      ["sink front", "desk", () => front("sink_counter"), () => front("desk_small")],
      ["desk front", "sink", () => front("desk_small"), () => front("sink_counter")],
    ])("walks the guide from %s to the %s front without losing it", (_a, _b, from, to) => {
      const out = walk(from(), to());
      expect(out).toMatchObject({ arrived: true, lost: 0 });
      expect(out.seen).toContain("door_bed_sw");
    });
    it("moves a stand point that falls inside furniture clearance to the nearest walkable point (fridge has no front)", () => {
      const fridge = floorPlanFrom(scene).objects.get("fridge_bbc363a3")!.position as [number, number];
      for (const from of [front("desk_small"), front("sink_counter"), station("living_standby")]) {
        const out = walk(from, fridge, 0.5, false);
        expect(out, JSON.stringify(from)).toMatchObject({ arrived: true, lost: 0 });
      }
    });
    it("approaches every door from a point on the current room's side when the straight line would cross a wall", () => {
      // 식탁 관찰 자리에서 침실 1 문까지 곧은 선은 벽을 지난다(거실 대기 자리는 문 앞으로 옮겨 곧게 보인다)
      const guide = map.plan(station("meal_watch"), front("desk_small"), 0.35, true)!;
      const door = guide.remaining.findIndex((p) => p.kind === "portal" && p.id === "door_bed_sw");
      const before = guide.remaining[door - 1]!;
      expect(before).toMatchObject({ kind: "via", room: "living" });
      expect(guide.remaining.some((p) => map.isBearing(p))).toBe(false);
      const gate = map.gate("door_bed_sw")!;
      expect(map.clear(station("meal_watch"), gate.point, "living", [gate])).toBe(false);
      expect(map.clear([before.position[0], before.position[2]], gate.point, "living", [gate])).toBe(true);
    });
  });
});
