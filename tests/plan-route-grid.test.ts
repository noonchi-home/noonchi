// 물건을 피하는 계획 길(대시보드 다시 짜기 의견 3b): 한양목련 실제 장면에서 거실 대기 자리 → 식탁 → 싱크대 컵 치우기 계획.
// 계획 길은 이동 가능 점 격자(src/layout/walk-grid.ts)를 따라 x·z 축과 나란하게 꺾이고, 욕실·가구 상자 + 0.18m를 지나지 않고, 가구 앞자리에서 끝난다.
import { describe, expect, it } from "vitest";
import type { DecisionRecord } from "../src/contract/events.js";
import type { SceneObject, Vec2 } from "../src/contract/layout.js";
import type { WorldObject, WorldView } from "../src/contract/world.js";
import { PlanDraft } from "../src/agent/planTools.js";
import { loadCatalog } from "../src/layout/catalog.js";
import { insidePolygon } from "../src/layout/floor.js";
import { resolveHome } from "../src/layout/homes.js";
import { floorPlanFrom, roomAt } from "../src/layout/route.js";
import { loadScene } from "../src/layout/scene.js";
import { DEFAULT_TWIN_DIR } from "../src/layout/twin-files.js";
import { WALK_THROUGH_TYPES } from "../src/layout/walk-guide.js";
import { gridRoute, moveStop, walkWay } from "../src/layout/walk-grid.js";
import { assemblePlan } from "../src/agent/planShape.js";
import { cupSteps, planContext } from "./helpers/planner.js";

const home = resolveHome(DEFAULT_TWIN_DIR, "mokryeon_180b");
const scene = loadScene(home)!;
const catalog = loadCatalog(home.catalogDir);
const footprint = (type: string) => catalog.get(type)?.footprint;
const objects = scene.objects as SceneObject[];
const table = objects.find((o) => o.type === "dining_table")!;
const sink = objects.find((o) => o.type === "sink_counter")!;
const front = (id: string) => scene.stations.surface_fronts.find((f) => f.surface_id === id)!.position;
const standby = scene.stations.stations.find((s) => s.id === "living_standby")!.position;
const bath = (scene.plan.rooms as { id: string; polygon: Vec2[] }[]).find((r) => r.id === "bath_center")!.polygon;

const PERSON: WorldView["person"] = { visible: false, since_ms: 0, last_seen_ms: null, count: 0, room: null, room_label: null, position: null, near: [], holding: [], position_ms: null, answered_ms: null, facts: {} };
const cup: WorldObject = {
  id: "cup_1", cls: "cup", position: [table.plan.position[0], 0.75, table.plan.position[1]], surface: table.id, surface_label: "식탁", room: table.room!, error_m: 0.1, status: "present",
  first_seen_ms: 0, last_seen_ms: 9_000, last_in_view_ms: 9_000, facts: {}, answered_ms: null, devices: [], closer_hold: false, followed_by: null,
};
const world: WorldView = { at_ms: 0, objects: [cup], person: PERSON, fixtures: [], devices: [], eye: null, frame_ms: 9_000, vlm_missing: 0, yolo_missing: 0 };
const decision: DecisionRecord = {
  id: "pam-1", seq: 1, atMs: 8_000, textSent: "t", finalTime: "x", status: "valid", prediction: { observation: "관찰", reasoning: "이유", task_index: 0 }, action: "컵 치우기", memoryVersion: 1,
  world: { objects: [], person_visible: false, vlm_missing: 0, yolo_missing: 0 },
};

/** 가구 상자 + margin(평면 다각형, 기본 0.18m). */
function box(o: SceneObject, margin = 0.18): Vec2[] {
  const dims = o.footprint ?? footprint(o.type)!;
  const yaw = o.rotation?.[1] ?? ((90 - o.plan.facing_deg) * Math.PI) / 180;
  const [hw, hd] = [(dims[0] * (o.scale?.[0] ?? 1)) / 2 + margin, (dims[1] * (o.scale?.[2] ?? 1)) / 2 + margin];
  const [c, s] = [Math.cos(yaw), Math.sin(yaw)];
  return ([[-hw, -hd], [hw, -hd], [hw, hd], [-hw, hd]] as Vec2[]).map(([u, v]) => [o.plan.position[0] + u * c + v * s, o.plan.position[1] - u * s + v * c] as Vec2);
}
/** 선분 위 2cm마다 점이 다각형 안에 드는가. */
const crosses = (a: Vec2, b: Vec2, poly: Vec2[]) => {
  const n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 0.02));
  for (let k = 1; k < n; k++) if (insidePolygon([a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n], poly)) return true;
  return false;
};

describe("물건을 피하는 계획 길(한양목련 거실 대기 자리 → 식탁 → 싱크대)", () => {
  const base = floorPlanFrom(scene);
  const floor = { ...base, robot: { ...base.robot, position: standby, room: roomAt(base, standby) } };
  const plan = () => {
    const r = new PlanDraft({ ...planContext({ decision, world, floor }), way: walkWay(scene, footprint) }).submit({ steps: cupSteps({ table: table.id, sink: sink.id, cup: cup.id }) });
    if (!r.ok) throw new Error(r.error);
    return r.plan.view;
  };

  it("모든 구간이 x 또는 z 축과 나란하고, 욕실 2와 식탁 상자 + 0.18m를 지나지 않고, 이동 끝 점이 식탁 앞자리·싱크대 앞자리다", () => {
    const view = plan();
    const legs = view.legs.map((l) => view.path.slice(0, l.end + 1));
    expect(view.legs).toHaveLength(2);
    expect(view.path[0]).toEqual(standby);
    expect(legs[0]!.at(-1)).toEqual(front(table.id));
    expect(view.path.at(-1)).toEqual(front(sink.id));
    for (let i = 1; i < view.path.length; i++) {
      const [a, b] = [view.path[i - 1]!, view.path[i]!];
      expect(Math.abs(a[0] - b[0]) < 1e-9 || Math.abs(a[1] - b[1]) < 1e-9, `${a} → ${b}`).toBe(true);
      expect(crosses(a, b, bath), `${a} → ${b} 욕실 2`).toBe(false);
      expect(crosses(a, b, box(table)), `${a} → ${b} 식탁`).toBe(false);
    }
  });
});

describe("가구·벽 여유 안 자리에서 나가는 첫 연결선(검토 R0)", () => {
  const way = walkWay(scene, footprint);
  /** 걷기 장애물인 바닥 가구의 실제 상자(여유 없이). */
  const bodies = objects
    .filter((o) => o.mount === "floor" && o.room && (o.plan.elevation ?? 0) < 1.8 && !WALK_THROUGH_TYPES.has(o.type) && (o.footprint ?? footprint(o.type)))
    .map((o) => [o.id, box(o, 0)] as const);

  it.each([
    ["책상 여유 안", [5.7, 11.6], "desk_small_ce7e768b"],
    ["벽 여유 안", [7.0, 11.95], "stand_ac_dc22b8f3"],
  ] as const)("%s %j에서 거실 대기 자리까지: x·z 축과 나란하고, 옆 가구(%s)를 비롯한 어떤 가구 실제 상자도 지나지 않는다", (_, start, near) => {
    expect(bodies.map(([id]) => id)).toContain(near);
    const path = gridRoute(way.grid, way.geometry, [...start], standby, { square: true })!;
    expect(path[0]).toEqual(start);
    expect(path.at(-1)).toEqual(standby);
    for (let i = 1; i < path.length; i++) {
      const [a, b] = [path[i - 1]!, path[i]!];
      expect(Math.abs(a[0] - b[0]) < 1e-9 || Math.abs(a[1] - b[1]) < 1e-9, `${a} → ${b}`).toBe(true);
      for (const [id, body] of bodies) expect(crosses(a, b, body), `${a} → ${b} ${id}`).toBe(false);
    }
  });
});

describe("처음·끝 연결선도 같은 길이면 덜 꺾이는 쪽(검토 R2)", () => {
  const way = walkWay(scene, footprint);
  const entry = scene.stations.stations.find((s) => s.id === "kitchen_entry")!.position;
  const route = (from: Vec2, to: Vec2) => gridRoute(way.grid, way.geometry, from, to, { square: true });

  it("거실 대기 자리 → 식탁 앞자리: 대기 자리에서 z로 먼저 붙어 꺾임 3번", () => {
    expect(standby).toEqual([6.98, 6.38]);
    expect(front(table.id)).toEqual([9.96, 5.15]);
    expect(route(standby, front(table.id))).toEqual([[6.98, 6.38], [6.98, 6.3], [9.6, 6.3], [9.6, 5.15], [9.96, 5.15]]);
  });

  it("주방 입구 → 싱크대 앞자리: 주방 입구에서 z로 곧게 내려간다", () => {
    expect(entry).toEqual([8.15, 2.9]);
    expect(route(entry, front(sink.id))).toEqual([[8.15, 2.9], [8.15, 2.4], [6.9, 2.4], [6.9, 0.693], [6.52, 0.693]]);
  });

  it("식탁 앞자리 → 싱크대 앞자리: 6cm 갔다 5cm 꺾는 Z자 없이 z로 먼저 붙어 꺾임 5번", () => {
    const path = route(front(table.id), front(sink.id))!;
    expect(path.slice(0, 3)).toEqual([[9.96, 5.15], [9.96, 5.1], [9.3, 5.1]]);
    expect(path.at(-1)).toEqual(front(sink.id));
    expect(path).toHaveLength(7);
  });
});

describe("갈 수 없는 방(격자 점이 없는 방) 물건의 목적지는 그 방으로 들어가는 문의 갈 수 있는 쪽 격자 점(검토 R1·R4)", () => {
  const way = walkWay(scene, footprint);
  const at = (id: string) => objects.find((o) => o.id === id)!;

  // 북쪽 발코니 문 door_balcony_north [8.465625, 1.4625](주방 벽 kitchen_balcony)의 주방 쪽 가장 가까운 격자 점은 [8.1, 1.5],
  // 욕실 3 문 door_bath_east [14.34375, 7.81875](침실 bed_se 벽)의 침실 쪽 가장 가까운 격자 점은 [14.4, 8.1]이다
  it.each([
    ["kimchi_fridge_bce0bf96", "balcony_north", [8.1, 1.5], "kitchen"],
    ["washer_d559f0ae", "balcony_north", [8.1, 1.5], "kitchen"],
    ["dryer_7aa61816", "balcony_north", [8.1, 1.5], "kitchen"],
    ["freezer_0c022ae2", "balcony_north", [8.1, 1.5], "kitchen"],
    ["toilet_bath_east", "bath_east", [14.4, 8.1], "bed_se"],
  ] as const)("%s(%s) → %j(%s)", (id, room, stop, side) => {
    expect(at(id).room).toBe(room);
    const got = moveStop(way, id, room, at(id).plan.position);
    expect(got).toEqual(stop);
    expect(roomAt(way.geometry.floor, got!)).toBe(side);
  });

  it("갈 수 있는 방으로 난 문이 없는 방(현관 앞 vestibule)은 목적지가 없다(계획은 방 길로 잇는다)", () => {
    const cabinet = at("storage_cabinet_141e4df4");
    expect(cabinet.room).toBe("vestibule");
    expect(moveStop(way, cabinet.id, "vestibule", cabinet.plan.position)).toBeNull();
  });

  it("거실 대기 자리에서 세탁기 → 건조기 계획: 두 이동 모두 주방 쪽 발코니 문 앞 [8.1, 1.5]에서 끝나고, 길이 다른 방 벽 앞에서 끝나지 않는다", () => {
    const base = floorPlanFrom(scene);
    const floor = { ...base, robot: { ...base.robot, position: standby, room: roomAt(base, standby) } };
    const [washer, dryer] = [at("washer_d559f0ae"), at("dryer_7aa61816")];
    const view = assemblePlan(floor, { id: "laundry", goal: "세탁물 건조기로 옮기기", judgment: "", source: "agent", dryRun: true, nowIso: "2026-11-26T00:00:00.000Z" }, [
      { kind: "move", label: "세탁기로 가기", target: { objectId: washer.id, room: "balcony_north" }, to: washer.plan.position },
      { kind: "act", label: "세탁물 꺼내기", target: { objectId: washer.id } },
      { kind: "move", label: "건조기로 가기", target: { objectId: dryer.id, room: "balcony_north" }, to: dryer.plan.position },
    ], way);
    expect(view.legs).toHaveLength(2);
    for (const leg of view.legs) expect(view.path[leg.end]).toEqual([8.1, 1.5]);
    for (const p of view.path) expect(["living", "kitchen"]).toContain(roomAt(floor, p));
  });
});
