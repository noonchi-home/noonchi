// @vitest-environment node
// 원뿔 그릴 자리 보정: 방 밖·벽 속 점은 방 안으로, 벽 가까운 점은 벽 반 두께 + 표시 반지름(원뿔 꼭짓점 공 0.11 m) 밖으로 옮긴다. 방 한가운데 점은 그대로다.
// 두 자리 사이 길은 계획 선·폰 안내와 같은 이동 가능 점 격자 길이다: 문을 지나고 길 위 모든 점이 방 안이며, 멀면 x·z 축과 나란하게 꺾이고 가구 상자 + 0.18m를 지나지 않는다.
// 격자가 없는 방(로봇이 못 가는 욕실)은 길이 없다(원뿔은 바로 옮겨 간다).
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { Plan2 } from "../../../src/contract/events.ts";
import type { SceneObject, Vec2 } from "../../../src/contract/layout.ts";
import { loadCatalog } from "../../../src/layout/catalog.ts";
import { insidePolygon } from "../../../src/layout/floor.ts";
import { resolveHome } from "../../../src/layout/homes.ts";
import { floorPlanFrom, roomAt } from "../../../src/layout/route.ts";
import { loadScene, withFootprints } from "../../../src/layout/scene.ts";
import { CONE } from "../../src/twin/3d/eye";
import { walkGuide } from "../../src/twin/3d/walk";

const SCENE = JSON.parse(readFileSync(fileURLToPath(new URL("../../../twin/apartment/scene.json", import.meta.url)), "utf8")) as {
  plan: { walls: { a: Plan2 | null; b: Plan2 | null; thickness: number | null }[] };
};
/** 선분 벽(기둥 같은 덩어리 solid는 a·b가 없다). */
const WALLS = SCENE.plan.walls.filter((w): w is { a: Plan2; b: Plan2; thickness: number } => !!w.a && !!w.b);
const FP = floorPlanFrom(SCENE);
const guide = walkGuide(SCENE, CONE.apex);
const KEEP = (w: { thickness: number }) => w.thickness / 2 + CONE.apex;
const toWall = (p: Plan2, w: { a: Plan2; b: Plan2 }) => {
  const dx = w.b[0] - w.a[0], dy = w.b[1] - w.a[1];
  const t = Math.min(1, Math.max(0, ((p[0] - w.a[0]) * dx + (p[1] - w.a[1]) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(p[0] - (w.a[0] + dx * t), p[1] - (w.a[1] + dy * t));
};
const clear = (p: Plan2) => WALLS.every((w) => toWall(p, w) >= KEEP(w) - 1e-6);
/** 꺾은선을 5 cm마다 찍은 점. */
const samples = (pts: Plan2[]) => pts.slice(1).flatMap((b, i) => {
  const a = pts[i]!;
  const n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 0.05));
  return Array.from({ length: n - 1 }, (_, k): Plan2 => [a[0] + ((b[0] - a[0]) * (k + 1)) / n, a[1] + ((b[1] - a[1]) * (k + 1)) / n]);
});

describe("원뿔 그릴 자리 보정", () => {
  it("방 한가운데 점은 그대로다", () => {
    expect(guide.stand([5, 9])).toEqual([5, 9]);
    expect(guide.stand([7, 2.5])).toEqual([7, 2.5]);
  });

  it("벽 속·집 밖 점은 방 안, 벽에서 떨어진 자리로 옮긴다", () => {
    // 거실·침실 사이 벽 위, 거실·작은방 사이 벽 속, 집 밖, 집 모서리 밖
    for (const p of [[7.2, 9], [3.25, 8], [5, 12.5], [-1, 12]] as Plan2[]) {
      const q = guide.stand(p);
      expect(roomAt(FP, q), `${p}`).not.toBeNull();
      expect(clear(q), `${p} → ${q}`).toBe(true);
      expect(Math.hypot(q[0] - p[0], q[1] - p[1]), `${p}`).toBeLessThan(2.5);
    }
  });

  it("벽에 붙은 점은 벽 반 두께 + 꼭짓점 공 반지름(0.11 m)만큼 떨어뜨리고 같은 방에 둔다", () => {
    const q = guide.stand([7.15, 9]);
    expect(roomAt(FP, q)).toBe("living_room");
    expect(CONE.apex).toBe(0.11);
    expect(q[0]).toBeCloseTo(7.2 - 0.06 - 0.11, 6);
    expect(q[1]).toBeCloseTo(9, 6);
  });

  it("트인 경계(복도·거실) 위 점은 벽이 없어 밀지 않는다", () => {
    const q = guide.stand([5.2, 6.85]);
    expect(q).toEqual([5.2, 6.85]);
  });

  it("거실에서 침실로: 곧은 선은 벽을 지나지만 길은 문을 지나고 모든 점이 방 안이다", () => {
    const from: Plan2 = [6.5, 9], to: Plan2 = [8.5, 9];
    expect(samples([from, to]).some((p) => WALLS.some((w) => toWall(p, w) < 0.03))).toBe(true);
    const path = guide.path(from, to)!;
    expect(path[0]).toEqual(from);
    expect(path.at(-1)).toEqual(to);
    // 안방 문(7.78, 6.8)을 지난다
    expect(samples([...path]).concat(path).some((p) => Math.hypot(p[0] - 7.78, p[1] - 6.8) < 0.03)).toBe(true);
    const doors = (SCENE as unknown as { plan: { doors: { position: Plan2 }[] } }).plan.doors.map((d) => d.position);
    for (const p of samples(path)) {
      // 문 자리(방 테두리 위)는 어느 쪽 방으로도 본다
      const near = path.some((q) => Math.hypot(q[0] - p[0], q[1] - p[1]) < 0.06) || doors.some((d) => Math.hypot(d[0] - p[0], d[1] - p[1]) < 0.06);
      expect(near || roomAt(FP, p) !== null, `${p}`).toBe(true);
      const wall = WALLS.find((w) => toWall(p, w) < 0.03);
      const atDoor = doors.some((d) => Math.hypot(d[0] - p[0], d[1] - p[1]) < 0.5);
      expect(!wall || atDoor, `${p} 벽 ${JSON.stringify(wall)}`).toBe(true);
    }
  });

  it("격자가 없는 욕실(로봇이 못 가는 방)은 길이 없다", () => {
    expect(guide.path([5, 6], [1, 6])).toBeNull();
  });

  it("한양목련 거실 대기 자리 → 식탁 앞자리: 모든 구간이 x 또는 z 축과 나란하고, 욕실 2와 식탁 상자 + 0.18m를 지나지 않고, 식탁 앞자리에서 끝난다", () => {
    const home = resolveHome(resolve(dirname(fileURLToPath(import.meta.url)), "../../../twin"), "mokryeon_180b");
    const catalog = loadCatalog(home.catalogDir);
    const footprint = (type: string) => catalog.get(type)?.footprint;
    // 대시보드가 받는 /api/scene 장면(바닥 물건에 카탈로그 footprint)
    const scene = withFootprints(loadScene(home)!, footprint);
    const objects = scene.objects as SceneObject[];
    const table = objects.find((o) => o.type === "dining_table")!;
    const front = scene.stations.surface_fronts.find((f) => f.surface_id === table.id)!.position as Plan2;
    const from = scene.stations.stations.find((s) => s.id === "living_standby")!.position as Plan2;
    const bath = (scene.plan.rooms as { id: string; polygon: Vec2[] }[]).find((r) => r.id === "bath_center")!.polygon;
    const dims = table.footprint!;
    const yaw = table.rotation?.[1] ?? ((90 - table.plan.facing_deg) * Math.PI) / 180;
    const [hw, hd] = [dims[0] / 2 + 0.18, dims[1] / 2 + 0.18];
    const [c, s] = [Math.cos(yaw), Math.sin(yaw)];
    const box = ([[-hw, -hd], [hw, -hd], [hw, hd], [-hw, hd]] as Vec2[]).map(([u, v]) => [table.plan.position[0] + u * c + v * s, table.plan.position[1] - u * s + v * c] as Vec2);
    const path = walkGuide(scene, CONE.apex).path(from, front)!;
    expect(path[0]).toEqual(from);
    expect(path.at(-1)).toEqual(front);
    for (let i = 1; i < path.length; i++) {
      const [a, b] = [path[i - 1]!, path[i]!];
      expect(Math.abs(a[0] - b[0]) < 1e-9 || Math.abs(a[1] - b[1]) < 1e-9, `${a} → ${b}`).toBe(true);
    }
    for (const p of samples(path)) {
      expect(insidePolygon(p, bath), `${p} 욕실 2`).toBe(false);
      expect(insidePolygon(p, box), `${p} 식탁`).toBe(false);
    }
  });

  it("한양목련 책상 여유 안 [5.7, 11.6] → 거실 대기 자리: 첫 연결선이 책상 실제 상자를 지나지 않는다(검토 R0)", () => {
    const home = resolveHome(resolve(dirname(fileURLToPath(import.meta.url)), "../../../twin"), "mokryeon_180b");
    const catalog = loadCatalog(home.catalogDir);
    const scene = withFootprints(loadScene(home)!, (type: string) => catalog.get(type)?.footprint);
    const desk = (scene.objects as SceneObject[]).find((o) => o.id === "desk_small_ce7e768b")!;
    const to = scene.stations.stations.find((s) => s.id === "living_standby")!.position as Plan2;
    const dims = desk.footprint!;
    const yaw = desk.rotation?.[1] ?? ((90 - desk.plan.facing_deg) * Math.PI) / 180;
    const [hw, hd] = [dims[0] / 2, dims[1] / 2];
    const [c, s] = [Math.cos(yaw), Math.sin(yaw)];
    const body = ([[-hw, -hd], [hw, -hd], [hw, hd], [-hw, hd]] as Vec2[]).map(([u, v]) => [desk.plan.position[0] + u * c + v * s, desk.plan.position[1] - u * s + v * c] as Vec2);
    const path = walkGuide(scene, CONE.apex).path([5.7, 11.6], to)!;
    expect(path[0]).toEqual([5.7, 11.6]);
    expect(path.at(-1)).toEqual(to);
    for (const p of samples(path)) expect(insidePolygon(p, body), `${p} 책상`).toBe(false);
  });

  it("방이 없는 장면이면 자리를 바꾸지 않고 길도 없다", () => {
    const g = walkGuide({ plan: {}, objects: [] }, CONE.apex);
    expect(g.stand([3, 4])).toEqual([3, 4]);
    expect(g.path([0, 0], [1, 1])).toBeNull();
  });
});
