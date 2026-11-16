// 도면 설비(twin-studio drawn_fixtures.json)가 서버가 읽는 장면에 plan_drawing 물건으로 들어간다.
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { SceneJson, SceneObject } from "../src/layout/editor.js";
import { DEFAULT_TWIN_DIR } from "../src/layout/twin-files.js";
import { withDrawn, type DrawnFixture } from "../src/layout/drawn.js";
import { resolveHome } from "../src/layout/homes.js";
import { loadScene } from "../src/layout/scene.js";
import { fetchRetry } from "../src/shared/net.js";
import { startServer } from "../src/server/start.js";

const home = resolveHome(DEFAULT_TWIN_DIR, "mokryeon_180b");
const file = JSON.parse(readFileSync(join(home.dataDir, "drawn_fixtures.json"), "utf8")) as { items: DrawnFixture[] };
const objects = (s: SceneJson) => s.objects as SceneObject[];
const raw = (scenePath: string) => JSON.parse(readFileSync(scenePath, "utf8").replace(/^﻿/, "")) as SceneJson;

describe("도면 설비를 서버 장면에 넣기", () => {
  it("한양목련 장면에 도면 설비 11개가 plan_drawing으로 들어간다", () => {
    const drawn = objects(loadScene(home)!).filter((o) => (o.provenance as { origin?: string } | undefined)?.origin === "plan_drawing");
    expect(file.items).toHaveLength(11);
    expect(drawn.map((o) => o.id).sort()).toEqual(file.items.map((f) => f.id).sort());
  });
  it("싱크대는 도면 자리·크기 그대로이고 옮길 수 없으며 기기가 아니다", () => {
    const sink = objects(loadScene(home)!).find((o) => o.id === "sink_counter_kitchen")!;
    expect(sink).toMatchObject({
      type: "sink_counter", room: "kitchen", name: "주방·식당 싱크대", asset: null, interactive: false, attrs: {}, mount: "floor",
      plan: { position: [5.853, 0.761], facing_deg: 0 }, position: [5.853, 0, 0.761], footprint: [2.278, 0.65], height: 0.9, anchors: { basin: [5.86, 1.38] },
    });
  });
  it("방향은 구운 GLB drawn_<id> 노드와 같다: −(facing + 90)°", () => {
    const rot = (id: string) => objects(loadScene(home)!).find((o) => o.id === id)!.rotation[1];
    expect(rot("sink_counter_kitchen")).toBeCloseTo(-Math.PI / 2, 6); // facing 0
    expect(rot("tub_bath_center")).toBeCloseTo(Math.PI / 2, 6); // facing 180
    expect(Math.abs(rot("toilet_bath_west"))).toBeCloseTo(Math.PI, 6); // facing 90
  });
  it("구운 GLB의 drawn_<id> 노드와 자리·방향이 같다", () => {
    const glb = readFileSync(join(home.outDir, "bake", "mokryeon_180b_baked.glb"));
    type Node = { name: string; translation?: number[]; rotation?: number[] };
    const nodes = (JSON.parse(glb.subarray(20, 20 + glb.readUInt32LE(12)).toString("utf8")) as { nodes: Node[] }).nodes;
    const scene = objects(loadScene(home)!);
    for (const f of file.items) {
      const n = nodes.find((x) => x.name === `drawn_${f.id}`)!;
      const o = scene.find((x) => x.id === f.id)!;
      expect(n.translation![0], f.id).toBeCloseTo(o.position[0], 4);
      expect(n.translation![2], f.id).toBeCloseTo(o.position[2], 4);
      expect(Math.cos(2 * Math.atan2(n.rotation![1]!, n.rotation![3]!) - o.rotation[1]), f.id).toBeCloseTo(1, 4);
    }
  });
  it("scene.json에 같은 id가 있으면 더하지 않는다", () => {
    const once = withDrawn(raw(home.scenePath), file.items);
    expect(withDrawn(once, file.items).objects).toHaveLength(once.objects.length);
  });
  it("한양목련으로 띄운 서버(시험 모드)의 GET /api/scene에 도면 설비 11개와 싱크대가 있다", async () => {
    const runtime = mkdtempSync(join(tmpdir(), "rt-scene-"));
    const srv = await startServer({ env: {
      HUB: "memory", PORT: "0", HOME_ID: "mokryeon_180b", RUNTIME_DIR: runtime, REFLECT_AT: "off",
      VLM_BASE_URL: "http://127.0.0.1:9/v1", PAM_URL: "http://127.0.0.1:9", OPENAI_BASE_URL: "http://127.0.0.1:9/v1",
    }, log: () => {} });
    try {
      expect(srv.mode).toBe("test");
      const r = await fetchRetry(`${srv.url}/api/scene`);
      expect(r.status).toBe(200);
      const scene = objects(((await r.json()) as { scene: SceneJson }).scene);
      const drawn = scene.filter((o) => (o.provenance as { origin?: string } | undefined)?.origin === "plan_drawing");
      expect(drawn.map((o) => o.id).sort()).toEqual(file.items.map((f) => f.id).sort());
      expect(drawn).toHaveLength(11);
      expect(scene.find((o) => o.id === "sink_counter_kitchen")).toMatchObject({ type: "sink_counter", room: "kitchen" });
    } finally {
      await srv.close();
      rmSync(runtime, { recursive: true, force: true });
    }
  });
  it("도면 설비 파일이 없는 집은 scene.json 그대로다", () => {
    const apt = resolveHome(DEFAULT_TWIN_DIR, "apartment");
    expect(loadScene(apt)!.objects).toHaveLength(raw(apt.scenePath).objects.length);
  });
});
