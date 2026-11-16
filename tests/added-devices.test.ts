// 시연용으로 더하는 가전(twin/data/homes/<집>/added_devices.json): 장면을 읽을 때 더하고(src/model/scene.ts loadScene), 기기·평면도·/api/scene이 같은 물건을 쓴다.
// 구운 장면에는 없으니 배치 편집기가 연결 때 add로 보낸다(src/layout/editor.ts unbaked).
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { SceneJson } from "../src/contract/layout.js";
import { LayoutEditor } from "../src/layout/editor.js";
import { loadLayout } from "../src/layout/load.js";
import { DEFAULT_TWIN_DIR, loadTwin } from "../src/model/devices.js";
import { resolveHome } from "../src/model/homes.js";
import { loadScene } from "../src/model/scene.js";
import { loadCatalog } from "../src/layout/catalog.js";
import { floorPlanFrom } from "../src/plan/route.js";
import { twinLandmarks } from "../src/phone/sync/landmarks.js";
import { fetchRetry } from "../src/shared/net.js";
import { startServer } from "../src/server/start.js";
import { openWebSocket } from "./helpers/ws.js";

const home = resolveHome(DEFAULT_TWIN_DIR, "mokryeon_180b");
const ID = "microwave_kitchen";
const ids = (s: SceneJson) => (s.objects as { id: string }[]).map((o) => o.id);

describe("시연용으로 더하는 가전(added_devices.json)", () => {
  it("한양목련 기기 목록에 microwave_kitchen(전자레인지, 주방, 속성 power)이 있다", () => {
    const d = loadTwin(DEFAULT_TWIN_DIR, { home: "mokryeon_180b" }).devices.find((x) => x.id === ID);
    expect(d).toMatchObject({ id: ID, kind: "microwave", label: "주방 전자레인지", room: "kitchen" });
    expect(Object.keys(d!.twinAttrs)).toEqual(["power"]);
  });

  it("장면·평면도에 같은 물건이 하나 있고 더한 id 목록에 있다. 자리는 주방 동쪽 조리대(counter_kitchen_e) 윗면이다", () => {
    const scene = loadScene(home)!;
    expect(ids(scene).filter((x) => x === ID)).toHaveLength(1);
    expect(scene.added).toEqual([ID]);
    const o = (scene.objects as { id: string; plan: { position: number[]; elevation: number }; position: number[] }[]).find((x) => x.id === ID)!;
    const counter = JSON.parse(readFileSync(join(home.dataDir, "drawn_fixtures.json"), "utf8")).items.find((f: { id: string }) => f.id === "counter_kitchen_e");
    expect(o.plan.position).toEqual(counter.position);
    expect(o.plan.elevation).toBe(counter.height);
    expect(o.position).toEqual([counter.position[0], counter.height, counter.position[1]]);
    expect(floorPlanFrom(scene).objects.get(ID)).toMatchObject({ type: "microwave", room: "kitchen" });
  });

  it("새 편집기의 syncMessages()에 microwave_kitchen add가 있고, reset() 뒤에도 남는다", () => {
    const runtime = mkdtempSync(join(tmpdir(), "rt-added-"));
    try {
      const { editor } = loadLayout(home, { runtimeDir: runtime, log: () => {} })!;
      expect(editor.syncMessages()).toContainEqual(expect.objectContaining({ type: "layout", op: "add", object: expect.objectContaining({ id: ID, type: "microwave" }) }));
      editor.reset();
      expect(editor.objects().some((o) => o.id === ID)).toBe(true);
      expect(editor.syncMessages().filter((m) => m.op === "add").map((m) => (m as { object: { id: string } }).object.id)).toEqual([ID]);
    } finally {
      rmSync(runtime, { recursive: true, force: true });
    }
  });

  it("한양목련으로 띄운 서버의 /api/scene에 같은 물건이 있고, 대시보드 연결 때 그 add 메시지가 간다", async () => {
    const runtime = mkdtempSync(join(tmpdir(), "rt-added-"));
    const srv = await startServer({ env: {
      HUB: "memory", PORT: "0", HOME_ID: "mokryeon_180b", RUNTIME_DIR: runtime, REFLECT_AT: "off",
      VLM_BASE_URL: "http://127.0.0.1:9/v1", PAM_URL: "http://127.0.0.1:9", OPENAI_BASE_URL: "http://127.0.0.1:9/v1",
    }, log: () => {} });
    const box: Record<string, any>[] = [];
    try {
      const r = await fetchRetry(`${srv.url}/api/scene`);
      expect(ids(((await r.json()) as { scene: SceneJson }).scene).filter((x) => x === ID)).toHaveLength(1);
      const ws = await openWebSocket(`${srv.url.replace(/^http/, "ws")}/events`, { setup: (w) => w.on("message", (d) => box.push(JSON.parse(String(d)))) });
      try {
        const end = Date.now() + 3000;
        while (!box.some((m) => m.type === "layout" && m.op === "add") && Date.now() < end) await new Promise((ok) => setTimeout(ok, 20));
        expect(box.filter((m) => m.type === "layout" && m.op === "add").map((m) => m.object.id)).toEqual([ID]);
      } finally {
        ws.close();
      }
    } finally {
      await srv.close();
      rmSync(runtime, { recursive: true, force: true });
    }
  });

  it("더한 가전은 기본으로 AR 기준점이 아니다(landmark false). 항목에 landmark: true를 적었을 때만 기준점이 된다", () => {
    const catalog = loadCatalog("twin/data/catalog");
    const scene = loadScene(home)!;
    expect((scene.objects as { id: string; landmark?: boolean }[]).find((o) => o.id === ID)!.landmark).toBe(false);
    expect(twinLandmarks(scene.objects as never, catalog).some((l) => l.id === ID)).toBe(false);
    const dir = mkdtempSync(join(tmpdir(), "added-landmark-"));
    try {
      const data = join(dir, "data");
      mkdirSync(data);
      const room = { id: "kitchen", label: "주방", polygon: [[0, 0], [4, 0], [4, 4], [0, 4]] };
      writeFileSync(join(dir, "scene.json"), JSON.stringify({ plan: { rooms: [room] }, objects: [] }));
      const item = { id: ID, type: "microwave", label: "주방 전자레인지", room: "kitchen", position: [2, 2], facing_deg: 90, elevation: 0.9 };
      writeFileSync(join(data, "added_devices.json"), JSON.stringify({ source: "시험", items: [{ ...item, landmark: true }] }));
      const marked = loadScene({ scenePath: join(dir, "scene.json"), dataDir: data })!;
      expect(twinLandmarks(marked.objects as never, catalog)).toEqual([expect.objectContaining({ cls: "microwave", id: ID, center: [2, 2], baseM: 0.9 })]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("파일이 없는 집은 그대로이고 더한 id 목록이 없다", () => {
    const apt = resolveHome(DEFAULT_TWIN_DIR, "apartment");
    const scene = loadScene(apt)!;
    expect(scene.added).toBeUndefined();
    const raw = JSON.parse(readFileSync(apt.scenePath, "utf8").replace(/^﻿/, "")) as SceneJson;
    expect(scene.objects).toHaveLength(raw.objects.length);
  });

  it("같은 id가 scene.json에 있으면 하나만 두고 더한 id가 아니라 add 메시지도 없다", () => {
    const dir = mkdtempSync(join(tmpdir(), "added-same-"));
    try {
      const data = join(dir, "data");
      mkdirSync(data);
      const room = { id: "kitchen", label: "주방", polygon: [[0, 0], [4, 0], [4, 4], [0, 4]] };
      const existing = {
        id: ID, name: "전자레인지", type: "microwave", asset: null, category: "appliances", mount: "surface", room: "kitchen",
        plan: { position: [1, 1], facing_deg: 90, elevation: 0.9, on: null, surface: null, wall: null }, position: [1, 0.9, 1], rotation: [0, 0, 0], scale: [1, 1, 1],
        interactive: true, attrs: { power: ["off", "on"] }, states: {}, state: {},
      };
      writeFileSync(join(dir, "scene.json"), JSON.stringify({ plan: { rooms: [room] }, objects: [existing] }));
      writeFileSync(join(data, "added_devices.json"), JSON.stringify({ source: "시험", items: [{ id: ID, type: "microwave", label: "주방 전자레인지", room: "kitchen", position: [2, 2], facing_deg: 90, elevation: 0.9 }] }));
      const scene = loadScene({ scenePath: join(dir, "scene.json"), dataDir: data })!;
      expect(ids(scene)).toEqual([ID]);
      expect(scene.added ?? []).toEqual([]);
      const editor = new LayoutEditor({ homeId: "t", scene, catalog: new Map(), savePath: join(dir, "edits.json"), unbaked: scene.added });
      expect(editor.syncMessages()).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
