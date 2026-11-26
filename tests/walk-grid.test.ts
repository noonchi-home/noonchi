// 이동 가능 점 격자(대시보드 다시 짜기 의견 3a, src/layout/walk-grid.ts): 한양목련 실제 장면.
// 점은 트윈 원점 기준 step 배수 자리 가운데 걸을 수 있는 곳만, 이음은 x·z 축 4방향, 문은 개구부 가운데 점과 양쪽 문 앞 점으로 잇는다.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { SceneJson, SceneObject, Vec2 } from "../src/contract/layout.js";
import { walkGrid as browserWalkGrid, walkingGeometry as browserGeometry } from "../src/layout/browser.js";
import { loadCatalog } from "../src/layout/catalog.js";
import { resolveHome } from "../src/layout/homes.js";
import { loadScene } from "../src/layout/scene.js";
import { DEFAULT_TWIN_DIR } from "../src/layout/twin-files.js";
import { edgeDistance, walkingGeometry } from "../src/layout/walk-guide.js";
import { WALK_STEP, attach, gridParts, walkGrid } from "../src/layout/walk-grid.js";
import { startServer } from "../src/server/start.js";
import { fetchRetry } from "../src/shared/net.js";

const home = resolveHome(DEFAULT_TWIN_DIR, "mokryeon_180b");
const scene = loadScene(home)!;
const catalog = loadCatalog(home.catalogDir);
const footprint = (type: string) => catalog.get(type)?.footprint;
const geometry = walkingGeometry(scene, footprint);
const grid = walkGrid(geometry, WALK_STEP);
const onStep = (v: number, step: number) => Math.abs(v / step - Math.round(v / step)) < 1e-6;

/** 대기·관찰 자리, 가구 앞자리, 충전 자리. */
const targets: [string, Vec2][] = [
  ...scene.stations.stations.map((s): [string, Vec2] => [s.id, s.position]),
  ...scene.stations.surface_fronts.map((f): [string, Vec2] => [`front:${f.surface_id}`, f.position]),
  ["dock", [scene.dock![0], scene.dock![2]]],
];
/** 로봇이 갈 수 있는 두 방을 잇는 문(트인 경계 빼고). */
const reachable = new Set(geometry.floor.robot.reachable);
/** 평면도 문(문 점 position, 잇는 두 방 connects). */
const planDoors = (scene.plan.doors ?? []) as { id: string; position: Vec2; connects: string[] }[];
const doors = planDoors.filter((d) => d.connects.every((r) => reachable.has(r)));

/** 모든 자리가 한 덩어리에 붙고, 문마다 양쪽 문 앞 점이 그 덩어리에 있는가. 아니면 어긋난 것의 이름. */
function disconnected(step: number): string[] {
  const g = walkGrid(geometry, step);
  const parts = gridParts(g);
  const at = targets.map(([id, p]) => [id, attach(g, geometry, p)] as const);
  const root = at.find(([, i]) => i !== null)?.[1];
  const bad = at.filter(([, i]) => i === null || parts[i] !== parts[root!]).map(([id]) => id);
  for (const d of doors) {
    const entry = g.doors.find((x) => x.id === d.id);
    if (!entry || entry.sides.length !== 2 || entry.sides.some((i) => parts[i] !== parts[root!])) bad.push(`door:${d.id}`);
  }
  return bad;
}

describe("이동 가능 점 격자(한양목련)", () => {
  it("격자 점은 트윈 원점 기준 step 배수 자리다. 문 점은 문 개구부 가운데와 그 점에서 벽에 수직인 선 위다", () => {
    expect(grid.step).toBe(WALK_STEP);
    expect(grid.lattice).toBeGreaterThan(100);
    for (const p of grid.points.slice(0, grid.lattice)) expect(onStep(p[0], WALK_STEP) && onStep(p[1], WALK_STEP), String(p)).toBe(true);
    expect(grid.doors.flatMap((d) => [d.center, ...d.sides]).every((i) => i >= 0 && i < grid.points.length)).toBe(true);
    for (const d of grid.doors) {
      const door = planDoors.find((x) => x.id === d.id)!;
      expect(grid.points[d.center]).toEqual(door.position);
      for (const s of d.sides) {
        const p = grid.points[s]!;
        expect(p[0] === door.position[0] || p[1] === door.position[1], `${d.id} ${p}`).toBe(true);
      }
    }
    // 이음은 x·z 축과 나란하다
    for (const [a, b] of grid.edges) {
      const [p, q] = [grid.points[a]!, grid.points[b]!];
      expect(p[0] === q[0] || p[1] === q[1], `${p} → ${q}`).toBe(true);
    }
  });

  it("가구 상자 + 0.18m 안과 벽 여유(0.18m + 벽 두께 절반) 안에 점이 없다(문 개구부 가운데 점만 문 벽 위). 식탁 의자는 장애물이 아니라 그 자리에도 점이 있다", () => {
    const floorObjects = (scene.objects as SceneObject[]).filter((o) => o.mount === "floor" && o.room && (o.plan.elevation ?? 0) < 1.8);
    const box = (o: SceneObject, extra: number) => {
      const dims = o.footprint ?? footprint(o.type)!;
      const yaw = o.rotation?.[1] ?? ((90 - o.plan.facing_deg) * Math.PI) / 180;
      return { id: o.id, p: o.plan.position, cos: Math.cos(yaw), sin: Math.sin(yaw), w: (dims[0] * (o.scale?.[0] ?? 1)) / 2 + extra, d: (dims[1] * (o.scale?.[2] ?? 1)) / 2 + extra };
    };
    const inside = (p: Vec2, b: ReturnType<typeof box>) => {
      const dx = p[0] - b.p[0], dz = p[1] - b.p[1];
      return Math.abs(dx * b.cos - dz * b.sin) < b.w && Math.abs(dx * b.sin + dz * b.cos) < b.d;
    };
    const chairs = floorObjects.filter((o) => o.type === "dining_chair").map((o) => box(o, 0.18));
    expect(chairs.length).toBe(4);
    expect(grid.points.some((p) => chairs.some((b) => inside(p, b)))).toBe(true);
    const boxes = floorObjects
      .filter((o) => o.type !== "dining_chair")
      .flatMap((o) => (o.footprint ?? footprint(o.type) ? [box(o, 0.18)] : []));
    expect(boxes.length).toBeGreaterThan(10);
    const centers = new Set(grid.doors.map((d) => d.center));
    grid.points.forEach((p, i) => {
      if (centers.has(i)) return;
      for (const b of boxes) expect(inside(p, b), `${p} 가 ${b.id} 상자 안`).toBe(false);
      for (const w of geometry.walls) expect(edgeDistance(p, w.a, w.b), `${p} 가 벽 ${w.id} 가까이`).toBeGreaterThanOrEqual(0.18 + w.thickness / 2);
    });
  });

  it("대기·관찰 자리, 가구 앞자리(주방 입구·싱크대 앞 포함), 충전 자리, 갈 수 있는 방 사이 문 양쪽이 모두 한 덩어리다", () => {
    expect(targets.length).toBeGreaterThanOrEqual(13);
    expect(targets.map(([id]) => id)).toEqual(expect.arrayContaining(["kitchen_entry", "front:sink_counter_kitchen", "dock"]));
    expect(doors.length).toBeGreaterThan(3);
    expect(disconnected(WALK_STEP)).toEqual([]);
  });

  it("WALK_STEP은 0.30·0.25·0.20m 가운데 끊기는 자리·문이 가장 적은 값들 중 가장 큰 값이다", () => {
    const steps = [0.3, 0.25, 0.2];
    const cut = new Map(steps.map((s) => [s, disconnected(s).length]));
    const fewest = Math.min(...cut.values());
    expect(WALK_STEP).toBe(Math.max(...steps.filter((s) => cut.get(s) === fewest)));
  });

  it("/api/scene의 바닥 물건에 카탈로그 footprint가 실려, 브라우저가 같은 격자를 만든다", async () => {
    const runtime = mkdtempSync(join(tmpdir(), "rt-walk-grid-"));
    const srv = await startServer({ env: {
      HUB: "memory", PORT: "0", HOME_ID: "mokryeon_180b", RUNTIME_DIR: runtime, REFLECT_AT: "off",
      VLM_BASE_URL: "http://127.0.0.1:9/v1", PAM_LLM_BASE_URL: "http://127.0.0.1:9/v1", OPENAI_BASE_URL: "http://127.0.0.1:9/v1",
    }, log: () => {} });
    try {
      const served = ((await (await fetchRetry(`${srv.url}/api/scene`)).json()) as { scene: SceneJson }).scene;
      const floor = (served.objects as SceneObject[]).filter((o) => o.mount === "floor" && catalog.get(o.type)?.footprint);
      expect(floor.length).toBeGreaterThan(10);
      for (const o of floor) expect(o.footprint, o.id).toEqual(catalog.get(o.type)!.footprint);
      const inBrowser = browserWalkGrid(browserGeometry(served), WALK_STEP);
      expect(inBrowser.points).toEqual(grid.points);
      expect(inBrowser.edges).toEqual(grid.edges);
    } finally {
      await srv.close();
      rmSync(runtime, { recursive: true, force: true });
    }
  }, 60_000);

  it("배치를 고친 뒤 /api/scene은 고친 배치를 주어, 브라우저 격자가 서버 걷기 격자(고친 배치)와 같다(검토 R3)", async () => {
    const runtime = mkdtempSync(join(tmpdir(), "rt-walk-grid-"));
    const srv = await startServer({ env: {
      HUB: "memory", PORT: "0", HOME_ID: "mokryeon_180b", RUNTIME_DIR: runtime, REFLECT_AT: "off",
      VLM_BASE_URL: "http://127.0.0.1:9/v1", PAM_LLM_BASE_URL: "http://127.0.0.1:9/v1", OPENAI_BASE_URL: "http://127.0.0.1:9/v1",
    }, log: () => {} });
    try {
      const sofaAt = (s: SceneJson) => (s.objects as SceneObject[]).find((o) => o.id === "sofa_a848b595")!.plan.position;
      const before = ((await (await fetchRetry(`${srv.url}/api/scene`)).json()) as { scene: SceneJson }).scene;
      const moved = srv.layout!.move("sofa_a848b595", { dx: 0.6, dy: 0 }).object.plan.position;
      expect(moved).not.toEqual(sofaAt(before));
      const after = ((await (await fetchRetry(`${srv.url}/api/scene`)).json()) as { scene: SceneJson }).scene;
      expect(sofaAt(after)).toEqual(moved);
      const onServer = walkGrid(walkingGeometry({ ...scene, objects: srv.layout!.objects() }, footprint), WALK_STEP);
      expect(onServer.points).not.toEqual(grid.points);
      const inBrowser = browserWalkGrid(browserGeometry(after), WALK_STEP);
      expect(inBrowser.points).toEqual(onServer.points);
      expect(inBrowser.edges).toEqual(onServer.edges);
    } finally {
      await srv.close();
      rmSync(runtime, { recursive: true, force: true });
    }
  }, 60_000);

  it("배치 편집으로 뺀 구운 물건(edits.json remove: 탁자·가전 stand_ac·키 큰 옷장)은 /api/scene에 없고, 트윈 3D가 읽는 구운 장면 /api/scene/baked에는 그대로 있다(검토 R12)", async () => {
    const removed = ["coffee_table_38536572", "stand_ac_dc22b8f3", "wardrobe_0358a8fe"];
    const runtime = mkdtempSync(join(tmpdir(), "rt-walk-grid-"));
    mkdirSync(join(runtime, "homes", "mokryeon_180b"), { recursive: true });
    writeFileSync(join(runtime, "homes", "mokryeon_180b", "edits.json"), JSON.stringify({ home: "mokryeon_180b", edits: removed.map((id) => ({ op: "remove", id })) }));
    const srv = await startServer({ env: {
      HUB: "memory", PORT: "0", HOME_ID: "mokryeon_180b", RUNTIME_DIR: runtime, REFLECT_AT: "off",
      VLM_BASE_URL: "http://127.0.0.1:9/v1", PAM_LLM_BASE_URL: "http://127.0.0.1:9/v1", OPENAI_BASE_URL: "http://127.0.0.1:9/v1",
    }, log: () => {} });
    try {
      const get = async (path: string) => {
        const r = await fetchRetry(`${srv.url}${path}`);
        expect(r.status, path).toBe(200);
        return ((await r.json()) as { scene: SceneJson }).scene.objects as SceneObject[];
      };
      const ids = (list: SceneObject[]) => list.map((o) => o.id);
      for (const id of removed) expect(ids(await get("/api/scene"))).not.toContain(id);
      const baked = await get("/api/scene/baked");
      expect(ids(baked)).toEqual(ids(scene.objects as SceneObject[]));
      expect(baked.find((o) => o.id === removed[0])!.footprint).toEqual(catalog.get("coffee_table")!.footprint);
    } finally {
      await srv.close();
      rmSync(runtime, { recursive: true, force: true });
    }
  }, 60_000);
});
