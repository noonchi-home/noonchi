// 시연용으로 더하는 가전(twin/data/homes/<집>/added_devices.json): 장면을 읽을 때 더하고(src/layout/scene.ts loadScene), 기기·평면도·/api/scene이 같은 물건을 쓴다.
// 구운 장면에는 없으니 배치 편집기가 연결 때 add로 보낸다(src/layout/editor.ts unbaked).
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SceneJson } from "../src/contract/layout.js";
import { LayoutEditor } from "../src/layout/editor.js";
import { loadLayout } from "../src/layout/load.js";
import { DEFAULT_TWIN_DIR, loadTwin } from "../src/layout/twin-files.js";
import { resolveHome } from "../src/layout/homes.js";
import { loadScene } from "../src/layout/scene.js";
import { loadCatalog } from "../src/layout/catalog.js";
import { floorPlanFrom } from "../src/layout/route.js";
import { twinLandmarks } from "../src/phone/sync/landmarks.js";
import { fetchRetry } from "../src/shared/net.js";
import { startServer } from "../src/server/start.js";
import { needsConfirm } from "../src/agent/policy.js";
import type { Command } from "../src/contract/devices.js";
import { openWebSocket } from "./helpers/ws.js";
import type { MatterHub } from "../src/devices/matter/matterHub.js";
import type { RunningServer } from "../src/server/start.js";
import { api } from "./helpers/live.js";
import { startFakeLlm, toolOutputs, type FakeLlm } from "./helpers/llm.js";

const home = resolveHome(DEFAULT_TWIN_DIR, "mokryeon_180b");
const ID = "microwave_kitchen";
/** 습관 시연(11-16 회의: 아침에 일어나면 커튼 열기, 출근 가방을 메면 조명 끄기)용으로 더한 커튼·조명. */
const DEMO = ["curtain_living", "curtain_bed_sw", "light_living", "light_entrance"];
const ADDED = [ID, ...DEMO];
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
    expect(scene.added).toEqual(ADDED);
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
      expect(editor.syncMessages().filter((m) => m.op === "add").map((m) => (m as { object: { id: string } }).object.id)).toEqual(ADDED);
    } finally {
      rmSync(runtime, { recursive: true, force: true });
    }
  });

  it("한양목련으로 띄운 서버의 /api/scene에 같은 물건이 있고, 대시보드 연결 때 그 add 메시지가 간다", async () => {
    const runtime = mkdtempSync(join(tmpdir(), "rt-added-"));
    const srv = await startServer({ env: {
      HUB: "memory", PORT: "0", HOME_ID: "mokryeon_180b", RUNTIME_DIR: runtime, REFLECT_AT: "off",
      VLM_BASE_URL: "http://127.0.0.1:9/v1", PAM_LLM_BASE_URL: "http://127.0.0.1:9/v1", OPENAI_BASE_URL: "http://127.0.0.1:9/v1",
    }, log: () => {} });
    const box: Record<string, any>[] = [];
    try {
      const r = await fetchRetry(`${srv.url}/api/scene`);
      expect(ids(((await r.json()) as { scene: SceneJson }).scene).filter((x) => x === ID)).toHaveLength(1);
      const ws = await openWebSocket(`${srv.url.replace(/^http/, "ws")}/events`, { setup: (w) => w.on("message", (d) => box.push(JSON.parse(String(d)))) });
      try {
        const end = Date.now() + 3000;
        while (box.filter((m) => m.type === "layout" && m.op === "add").length < ADDED.length && Date.now() < end) await new Promise((ok) => setTimeout(ok, 20));
        expect(box.filter((m) => m.type === "layout" && m.op === "add").map((m) => m.object.id)).toEqual(ADDED);
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

type Plan = { ceiling_height: number; rooms: { id: string; polygon: [number, number][] }[]; walls: { id: string; thickness: number }[]; doors: { id: string; position: [number, number]; wall: string; width: number }[] };
type Placed = { id: string; type: string; room: string; asset: string | null; mount: string; plan: { position: [number, number]; facing_deg: number; elevation: number } };

describe("습관 시연용 커튼·조명(한양목련 added_devices.json)", () => {
  const plan = JSON.parse(readFileSync(join(home.dataDir, "floorplan.json"), "utf8")) as Plan;
  const placed = (id: string) => (loadScene(home)!.objects as unknown as Placed[]).find((o) => o.id === id)!;
  const door = (id: string) => plan.doors.find((d) => d.id === id)!;
  const wall = (id: string) => plan.walls.find((w) => w.id === id)!;
  const box = (id: string) => {
    const pts = plan.rooms.find((r) => r.id === id)!.polygon;
    const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
    return { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) };
  };

  it("기기 목록에 거실·침실 1 커튼(covering, 속성 curtain)과 거실·현관 조명(light, 속성 power)이 있다", () => {
    const devices = loadTwin(DEFAULT_TWIN_DIR, { home: "mokryeon_180b" }).devices;
    const pick = (id: string) => devices.find((d) => d.id === id);
    expect(pick("curtain_living")).toMatchObject({ kind: "covering", label: "거실 커튼", room: "living" });
    expect(pick("curtain_bed_sw")).toMatchObject({ kind: "covering", label: "침실 1 커튼", room: "bed_sw" });
    expect(pick("light_living")).toMatchObject({ kind: "light", label: "거실 조명", room: "living" });
    expect(pick("light_entrance")).toMatchObject({ kind: "light", label: "현관 조명", room: "entrance" });
    for (const id of ["curtain_living", "curtain_bed_sw"]) expect(Object.keys(pick(id)!.twinAttrs)).toEqual(["curtain"]);
    for (const id of ["light_living", "light_entrance"]) expect(Object.keys(pick(id)!.twinAttrs)).toEqual(["power"]);
  });

  it("커튼은 발코니 미닫이(거실 door_balcony_living 3.15m, 침실 1 door_balcony_sw 2.64m) 가운데, 경계벽 안쪽 면에 방 쪽을 보고 걸린다(아파트 트윈과 같이 바닥에서 0.02m)", () => {
    for (const [id, d] of [["curtain_living", "door_balcony_living"], ["curtain_bed_sw", "door_balcony_sw"]] as const) {
      const o = placed(id);
      const opening = door(d);
      expect(o.type).toBe("curtain_290");
      expect(o.mount).toBe("wall");
      expect(o.plan.position[0]).toBeCloseTo(opening.position[0], 6);
      expect(o.plan.position[1]).toBeCloseTo(opening.position[1] - wall(opening.wall).thickness / 2, 6);
      expect(o.plan.facing_deg).toBe(270);
      expect(o.plan.elevation).toBe(0.02);
      expect(o.asset).toBe("lib/assets/fixtures/curtain_290.glb");
    }
  });

  it("조명은 천장(도면 ceiling_height)에 단다: 거실 원형 천장등은 소파·TV가 있는 거실 사각형 가운데, 현관 다운라이트는 현관 가운데", () => {
    const living = { x0: 6.834375, x1: 11.784375, y0: 7.81875, y1: 12.234375 };
    const entrance = box("entrance");
    for (const [id, type, b] of [["light_living", "ceiling_light", living], ["light_entrance", "downlight", entrance]] as const) {
      const o = placed(id);
      expect(o.type).toBe(type);
      expect(o.mount).toBe("ceiling");
      expect(o.plan.position[0]).toBeCloseTo((b.x0 + b.x1) / 2, 6);
      expect(o.plan.position[1]).toBeCloseTo((b.y0 + b.y1) / 2, 6);
      expect(o.plan.elevation).toBe(plan.ceiling_height);
      expect(o.asset).toBe(`lib/assets/fixtures/${type}.glb`);
    }
    // 거실 사각형: 침실 1 오른쪽 벽(x)·침실 2 왼쪽 벽(x)·침실 1 위 벽(y)·발코니 경계벽(y)
    const walls = JSON.parse(readFileSync(join(home.dataDir, "floorplan.json"), "utf8")).walls as { id: string; a: [number, number] }[];
    const at = (id: string) => walls.find((w) => w.id === id)!.a;
    expect([at("bed_sw_right")[0], at("bed_se_left")[0], at("bed_sw_top")[1], at("front_boundary")[1]]).toEqual([living.x0, living.x1, living.y0, living.y1]);
  });

  it("위험 목록(승인을 묻는 가전 명령)에 넣지 않는다: 켜기·끄기·닫기·열기 모두 승인을 묻지 않는다", () => {
    const devices = loadTwin(DEFAULT_TWIN_DIR, { home: "mokryeon_180b" }).devices;
    for (const id of DEMO) {
      const d = devices.find((x) => x.id === id)!;
      const cmds: Command[] = d.kind === "light" ? [{ type: "on" }, { type: "off" }] : [{ type: "covering", openPercent: 0 }, { type: "covering", openPercent: 100 }];
      for (const c of cmds) expect(needsConfirm(d, c), `${id} ${JSON.stringify(c)}`).toBe(false);
    }
  });
});

describe("습관 시연용 커튼·조명: Matter 가상 가전·에이전트 도구(한양목련 서버, local 전송)", () => {
  let llm: FakeLlm;
  let srv: RunningServer;
  const temps: string[] = [];
  const say = (find: string, tool: string, args: Record<string, unknown>, done: string) => [[["find_devices", { query: find, reason: "기기를 찾으려고" }]], [[tool, { ...args, reason: "말한 대로" }]], done] as never;
  beforeAll(async () => {
    llm = await startFakeLlm({
      "거실 불 켜 줘": say("거실 불", "turn_on", { device_id: "light_living" }, "거실 불을 켰어요."),
      "거실 불 꺼 줘": say("거실 불", "turn_off", { device_id: "light_living" }, "거실 불을 껐어요."),
      "거실 커튼 닫아 줘": say("거실 커튼", "set_covering", { device_id: "curtain_living", open_percent: 0 }, "거실 커튼을 닫았어요."),
      "거실 커튼 열어 줘": say("거실 커튼", "set_covering", { device_id: "curtain_living", open_percent: 100 }, "거실 커튼을 열었어요."),
    });
    for (const p of ["matter", "rt"]) temps.push(mkdtempSync(join(tmpdir(), `added-demo-${p}-`)));
    srv = await startServer({ env: {
      PORT: "0", ...llm.env, HOME_ID: "mokryeon_180b", MATTER_TRANSPORT: "local", MATTER_STORAGE_DIR: temps[0]!, RUNTIME_DIR: temps[1]!, REFLECT_AT: "off",
      VLM_BASE_URL: "http://127.0.0.1:9/v1", PAM_LLM_BASE_URL: "http://127.0.0.1:9/v1",
    }, log: () => {} });
  }, 120_000);
  afterAll(async () => {
    await srv?.close();
    await llm?.close();
    for (const d of temps) rmSync(d, { recursive: true, force: true });
  }, 30_000);
  const bridge = (id: string) => (srv.hub as MatterHub).bridgeEndpoint(id)!.state as unknown as Record<string, Record<string, any>>;

  it("/api/scene·가전 목록에 넷이 있고 Matter 브리지에 가상 가전(조명 OnOff, 커튼 WindowCovering)으로 붙는다", async () => {
    const scene = (await api(srv.url, "/api/scene")).json.scene as SceneJson;
    for (const id of DEMO) expect(ids(scene), id).toContain(id);
    const listed = (await api(srv.url, "/api/devices")).json;
    const devIds = ((Array.isArray(listed) ? listed : listed.devices ?? listed.data) as { id: string }[]).map((d) => d.id);
    for (const id of DEMO) expect(devIds, id).toContain(id);
    expect(bridge("light_living").bridgedDeviceBasicInformation!.nodeLabel).toBe("거실 조명");
    expect(bridge("light_living").onOff!.onOff).toBe(false);
    expect(bridge("curtain_living").windowCovering!.currentPositionLiftPercent100ths).toBe(0); // 0=열림, 10000=닫힘
  });

  it("에이전트 도구: 「거실 불 켜 줘·꺼 줘」, 「거실 커튼 닫아 줘·열어 줘」가 찾기로 그 기기를 찾고 Matter 상태를 바꾼다. 승인을 묻지 않는다", async () => {
    /** 그 찾기 말에 find_devices가 돌려준 기기 id. */
    const found = (query: string) => llm.bodies().flatMap(toolOutputs).find((o) => o?.data?.query === query)?.data.devices.map((d: { id: string }) => d.id);
    const chat = async (message: string) => {
      const r = await api(srv.url, "/api/agent/chat", { message, sessionId: "added-demo" });
      expect(r.status, message).toBe(200);
      expect(r.json.pendingConfirmations, message).toEqual([]);
      return r.json;
    };
    await chat("거실 불 켜 줘");
    expect(bridge("light_living").onOff!.onOff).toBe(true);
    expect(found("거실 불"), "find_devices 「거실 불」").toEqual(["light_living"]);
    await chat("거실 불 꺼 줘");
    expect(bridge("light_living").onOff!.onOff).toBe(false);
    await chat("거실 커튼 닫아 줘");
    expect(bridge("curtain_living").windowCovering!.currentPositionLiftPercent100ths).toBe(10000);
    expect(found("거실 커튼"), "find_devices 「거실 커튼」").toEqual(["curtain_living"]);
    await chat("거실 커튼 열어 줘");
    expect(bridge("curtain_living").windowCovering!.currentPositionLiftPercent100ths).toBe(0);
  }, 60_000);

  it("현관 조명·침실 1 커튼도 가전 명령(REST)으로 켜기·끄기·닫기·열기가 Matter에 간다", async () => {
    await api(srv.url, "/api/devices/light_entrance/command", { command: { type: "on" } });
    expect(bridge("light_entrance").onOff!.onOff).toBe(true);
    await api(srv.url, "/api/devices/light_entrance/command", { command: { type: "off" } });
    expect(bridge("light_entrance").onOff!.onOff).toBe(false);
    await api(srv.url, "/api/devices/curtain_bed_sw/command", { command: { type: "covering", openPercent: 0 } });
    expect(bridge("curtain_bed_sw").windowCovering!.currentPositionLiftPercent100ths).toBe(10000);
    await api(srv.url, "/api/devices/curtain_bed_sw/command", { command: { type: "covering", openPercent: 100 } });
    expect(bridge("curtain_bed_sw").windowCovering!.currentPositionLiftPercent100ths).toBe(0);
  }, 30_000);
});
