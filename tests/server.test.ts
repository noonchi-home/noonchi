import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { Agent } from "../src/agent/agent.js";
import { MemoryHub } from "../src/hub/memory.js";
import type { DeviceHub } from "../src/hub/types.js";
import { createApp, type TwinHomeApp } from "../src/server/app.js";
import { createHub } from "../src/server/hubFactory.js";
import { fetchRetry } from "../src/server/net.js";
import { ROOMS, homeDevices, makeHome, twin } from "./helpers/home.js";
import { HOME_SCRIPT, startFakeLlm, type FakeLlm } from "./helpers/llm.js";

type Msg = Record<string, any>;

// 에이전트는 실제 OpenAI 공급자, 모델 자리는 가짜 OpenAI 호환 서버
let llm: FakeLlm;
beforeAll(async () => { llm = await startFakeLlm(HOME_SCRIPT); });
afterAll(async () => { await llm?.close(); });
const cleanups: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  while (cleanups.length) await cleanups.pop()!();
});

async function start(opts: { twinDir?: string; webDir?: string; agent?: boolean; scene?: () => unknown } = {}) {
  const home = makeHome();
  const agent = opts.agent === false ? undefined : new Agent({ hub: home.hub, policy: home.policy, rooms: ROOMS, provider: llm.provider() });
  const app: TwinHomeApp = createApp({ hub: home.hub, policy: home.policy, agent, rooms: ROOMS, twinDir: opts.twinDir, webDir: opts.webDir, scene: opts.scene, log: () => {} });
  const { url } = await app.listen(0, "127.0.0.1");
  cleanups.push(() => app.close());
  return { ...home, app, url };
}

async function api(url: string, path: string, init: { method?: string; body?: unknown; raw?: string; headers?: Record<string, string> } = {}) {
  const res = await fetchRetry(url + path, {
    method: init.method ?? (init.body !== undefined || init.raw !== undefined ? "POST" : "GET"),
    headers: { "content-type": "application/json", ...init.headers },
    body: init.raw ?? (init.body !== undefined ? JSON.stringify(init.body) : undefined),
  });
  const text = await res.text();
  let json: any;
  try {
    json = JSON.parse(text);
  } catch {
    json = undefined;
  }
  return { status: res.status, json, text, headers: res.headers };
}

/** WebSocket을 열고 메시지를 모은다. waitFor(pred)로 조건을 만족하는 메시지를 기다린다. */
async function listen(url: string) {
  const ws = new WebSocket(url.replace(/^http/, "ws") + "/events");
  const messages: Msg[] = [];
  const waiters: { pred: (m: Msg) => boolean; resolve: (m: Msg) => void }[] = [];
  ws.on("message", (data) => {
    const m = JSON.parse(String(data)) as Msg;
    messages.push(m);
    for (const w of [...waiters]) if (w.pred(m)) {
      waiters.splice(waiters.indexOf(w), 1);
      w.resolve(m);
    }
  });
  await new Promise<void>((resolve, reject) => {
    ws.once("open", () => resolve());
    ws.once("error", reject);
  });
  cleanups.push(() => ws.close());
  const waitFor = (pred: (m: Msg) => boolean, ms = 3000) =>
    new Promise<Msg>((resolve, reject) => {
      const found = messages.find(pred);
      if (found) return resolve(found);
      const timer = setTimeout(() => reject(new Error("WS 메시지를 기다리다 시간 초과")), ms);
      waiters.push({ pred, resolve: (m) => { clearTimeout(timer); resolve(m); } });
    });
  return { ws, messages, waitFor };
}

describe("REST 읽기", () => {
  it("GET /api/health, /api/rooms, /api/devices", async () => {
    const { url, devices } = await start();
    const h = await api(url, "/api/health");
    expect(h.json).toMatchObject({ ok: true, devices: devices.length, provider: "openai", model: "gpt-5.5" });
    const rooms = await api(url, "/api/rooms");
    expect(rooms.status).toBe(200);
    expect(rooms.json.find((r: Msg) => r.id === "living_room")).toMatchObject({ label: "거실" });
    expect(rooms.json.find((r: Msg) => r.id === "living_room").deviceCount).toBeGreaterThan(5);
    const list = await api(url, "/api/devices");
    expect(list.json).toHaveLength(devices.length);
    expect(list.json[0]).toHaveProperty("state.twin");
    expect(list.json[0]).toHaveProperty("kind");
    const lights = await api(url, "/api/devices?room=living_room&kind=light");
    expect(lights.json.map((d: Msg) => d.id).sort()).toEqual(["lamp_living", "light_living"]);
  });

  it("GET /api/devices/:id, 없는 기기는 404 한국어 오류", async () => {
    const { url } = await start();
    const tv = await api(url, "/api/devices/tv_living");
    expect(tv.json).toMatchObject({ id: "tv_living", label: "거실 TV", state: { twin: { power: "off" } } });
    const nope = await api(url, "/api/devices/nope");
    expect(nope.status).toBe(404);
    expect(nope.json.error).toContain("기기를 찾을 수 없습니다");
    const route = await api(url, "/api/nothing");
    expect(route.status).toBe(404);
  });

  it("GET /api/scene: 서버 장면(scene.json + 도면 설비), 장면이 없으면 404", async () => {
    const { url } = await start({ scene: () => ({ plan: {}, objects: [{ id: "a" }] }) });
    const r = await api(url, "/api/scene");
    expect(r.status).toBe(200);
    expect(r.json).toEqual({ ok: true, scene: { plan: {}, objects: [{ id: "a" }] } });
    const none = await start();
    const missing = await api(none.url, "/api/scene");
    expect(missing.status).toBe(404);
    expect(missing.json.error).toContain("집 장면이 없어요");
  });
});

describe("REST 명령 + WS 이벤트", () => {
  it("명령하면 200과 WS state 이벤트", async () => {
    const { url, hub } = await start();
    const { waitFor } = await listen(url);
    const r = await api(url, "/api/devices/tv_living/command", { body: { command: { type: "on" } } });
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ ok: true, state: { twin: { power: "on" } } });
    const ev = await waitFor((m) => m.type === "state" && m.state.id === "tv_living" && m.state.twin.power === "on");
    expect(ev.state.matter.onOff).toBe(true);
    expect(twin(hub, "tv_living").power).toBe("on");
    // 문자열 줄임 형식
    const off = await api(url, "/api/devices/tv_living/command", { body: { command: "off" } });
    expect(off.json.state.twin.power).toBe("off");
  });

  it("WS에 붙으면 hello와 모든 기기 상태를 먼저 보낸다", async () => {
    const { url, devices } = await start();
    const { waitFor, messages } = await listen(url);
    await waitFor((m) => m.type === "hello");
    await waitFor((m) => m.type === "state" && m.state.id === devices[devices.length - 1]!.id);
    expect(messages.filter((m) => m.type === "state")).toHaveLength(devices.length);
  });

  it("승인이 필요한 명령은 409 needsConfirmation, 토큰을 주면 실행", async () => {
    const { url, hub } = await start();
    const r1 = await api(url, "/api/devices/door_main/command", { body: { command: { type: "unlock" } } });
    expect(r1.status).toBe(409);
    expect(r1.json.needsConfirmation.token).toBeTruthy();
    expect(r1.json.needsConfirmation.reason).toContain("승인");
    expect(twin(hub, "door_main").lock).toBe("locked");
    const r2 = await api(url, "/api/devices/door_main/command", { body: { command: { type: "unlock" }, confirmToken: r1.json.needsConfirmation.token } });
    expect(r2.status).toBe(200);
    expect(twin(hub, "door_main").lock).toBe("unlocked");
  });

  it("잘못된 명령·JSON·센서 기기는 400 한국어 오류, 없는 기기는 404", async () => {
    const { url } = await start();
    const bad = await api(url, "/api/devices/tv_living/command", { body: { command: { type: "fly" } } });
    expect(bad.status).toBe(400);
    expect(bad.json.error).toMatch(/명령/);
    const json = await api(url, "/api/devices/tv_living/command", { raw: "{not json" });
    expect(json.status).toBe(400);
    expect(json.json.error).toContain("JSON");
    const sensor = await api(url, "/api/devices/door_bed2/command", { body: { command: { type: "on" } } });
    expect(sensor.status).toBe(400);
    expect(sensor.json.error).toContain("센서");
    const nope = await api(url, "/api/devices/nope/command", { body: { command: { type: "on" } } });
    expect(nope.status).toBe(404);
  });

  it("POST /api/sensors/:id: 센서 값 바꾸기 + WS 이벤트, 센서 아닌 값은 400", async () => {
    const { url, hub } = await start();
    const { waitFor } = await listen(url);
    const r = await api(url, "/api/sensors/door_bed2", { body: { attr: "door", value: "open" } });
    expect(r.status).toBe(200);
    expect(twin(hub, "door_bed2").door).toBe("open");
    await waitFor((m) => m.type === "state" && m.state.id === "door_bed2" && m.state.twin.door === "open");
    const bad = await api(url, "/api/sensors/tv_living", { body: { attr: "power", value: "on" } });
    expect(bad.status).toBe(400);
    expect(bad.json.error).toContain("센서");
  });
});

describe("에이전트 REST", () => {
  it("POST /api/agent/chat → reply·actions + WS agent 이벤트", async () => {
    const { url, hub } = await start();
    const { waitFor } = await listen(url);
    const r = await api(url, "/api/agent/chat", { body: { message: "거실 TV 켜줘", sessionId: "t1" } });
    expect(r.status).toBe(200);
    expect(r.json.sessionId).toBe("t1");
    expect(r.json.reply).toBe("거실 TV를 켰어요.");
    expect(r.json.actions.some((a: Msg) => a.tool === "turn_on")).toBe(true);
    expect(r.json.pendingConfirmations).toEqual([]);
    expect(twin(hub, "tv_living").power).toBe("on");
    await waitFor((m) => m.type === "agent" && m.event === "reply" && m.sessionId === "t1");
    await waitFor((m) => m.type === "agent" && m.event === "action");
  });

  it("현관문 열어줘 → 승인 대기 → POST /api/agent/confirm → 열림", async () => {
    const { url, hub } = await start();
    const r = await api(url, "/api/agent/chat", { body: { message: "현관문 열어줘", sessionId: "t2" } });
    expect(r.json.pendingConfirmations).toHaveLength(1);
    expect(twin(hub, "door_main").lock).toBe("locked");
    const pend = await api(url, "/api/agent/pending?sessionId=t2");
    expect(pend.json).toHaveLength(1);
    const c = await api(url, "/api/agent/confirm", { body: { token: r.json.pendingConfirmations[0].token } });
    expect(c.status).toBe(200);
    expect(c.json.ok).toBe(true);
    expect(twin(hub, "door_main").lock).toBe("unlocked");
    const again = await api(url, "/api/agent/confirm", { body: { token: r.json.pendingConfirmations[0].token } });
    expect(again.status).toBe(400);
    expect(again.json.error).toContain("만료");
  });

  it("승인 취소, 빈 메시지는 400", async () => {
    const { url, policy } = await start();
    const r = await api(url, "/api/agent/chat", { body: { message: "현관문 열어줘", sessionId: "t3" } });
    const c = await api(url, "/api/agent/cancel", { body: { token: r.json.pendingConfirmations[0].token } });
    expect(c.json.ok).toBe(true);
    expect(policy.pending()).toEqual([]);
    const empty = await api(url, "/api/agent/chat", { body: { message: "  " } });
    expect(empty.status).toBe(400);
  });

  it("에이전트 없이 띄우면 chat은 503, confirm은 정책으로 처리", async () => {
    const { url, hub } = await start({ agent: false });
    const chat = await api(url, "/api/agent/chat", { body: { message: "안녕" } });
    expect(chat.status).toBe(503);
    const r1 = await api(url, "/api/devices/door_main/command", { body: { command: { type: "unlock" } } });
    const c = await api(url, "/api/agent/confirm", { body: { token: r1.json.needsConfirmation.token } });
    expect(c.json.ok).toBe(true);
    expect(twin(hub, "door_main").lock).toBe("unlocked");
  });
});

describe("정적 파일·CORS", () => {
  it("웹 화면(/, /setup/, /assets/*)과 경로 탈출 차단", async () => {
    const webDir = mkdtempSync(join(tmpdir(), "web-"));
    cleanups.push(() => rmSync(webDir, { recursive: true, force: true }));
    mkdirSync(join(webDir, "assets"));
    mkdirSync(join(webDir, "setup"));
    writeFileSync(join(webDir, "index.html"), "<title>twin-home</title>");
    writeFileSync(join(webDir, "setup", "index.html"), "<title>설정</title>");
    writeFileSync(join(webDir, "assets", "app.js"), "export {};");
    const { url } = await start({ webDir });
    const index = await api(url, "/");
    expect(index.status).toBe(200);
    expect(index.headers.get("content-type")).toContain("text/html");
    expect(index.text).toContain("twin-home");
    expect((await api(url, "/setup/")).text).toContain("설정");
    const js = await api(url, "/assets/app.js");
    expect(js.headers.get("content-type")).toContain("javascript");
    expect((await api(url, "/assets/none.js")).status).toBe(404);
    const escape = await api(url, "/..%2Fpackage.json");
    expect(escape.status).toBe(404);
  });

  it("기본 화면 폴더는 ui/dist", async () => {
    const { DEFAULT_WEB_DIR } = await import("../src/server/app.js");
    expect(DEFAULT_WEB_DIR.replace(/\\/g, "/")).toMatch(/\/ui\/dist\/$/);
  });

  it("화면을 빌드하지 않았으면 /와 /setup/은 빌드하라는 503", async () => {
    const webDir = join(mkdtempSync(join(tmpdir(), "web-")), "missing");
    cleanups.push(() => rmSync(join(webDir, ".."), { recursive: true, force: true }));
    const { url } = await start({ webDir });
    for (const path of ["/", "/setup/"]) {
      const r = await api(url, path);
      expect(r.status).toBe(503);
      expect(r.json).toEqual({ ok: false, error: "화면이 아직 빌드되지 않았어요. npm run ui:build" });
    }
    expect((await api(url, "/api/health")).status).toBe(200);
  });

  it("/twin/은 twinDir이 있을 때만 붙는다", async () => {
    const dir = mkdtempSync(join(tmpdir(), "twin-"));
    cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
    writeFileSync(join(dir, "scene.json"), '{"objects":[]}');
    const { url } = await start({ twinDir: dir });
    const r = await api(url, "/twin/scene.json");
    expect(r.status).toBe(200);
    expect(r.json).toEqual({ objects: [] });
    const { url: url2 } = await start({ twinDir: join(dir, "missing") });
    expect((await api(url2, "/twin/scene.json")).status).toBe(404);
  });

  it("/twin/viewer/·/twin/lib/는 집 폴더와 다른 폴더(뷰어·라이브러리)에서 나온다", async () => {
    const root = mkdtempSync(join(tmpdir(), "twin-"));
    cleanups.push(() => rmSync(root, { recursive: true, force: true }));
    const out = join(root, "homes", "oneroom");
    const viewer = join(root, "apartment", "viewer");
    const lib = join(root, "library");
    for (const d of [out, viewer, join(lib, "assets", "appliances")]) mkdirSync(d, { recursive: true });
    writeFileSync(join(out, "scene.json"), '{"home":"oneroom"}');
    writeFileSync(join(viewer, "index.html"), "<title>viewer</title>");
    writeFileSync(join(lib, "assets", "appliances", "tv.glb"), "glTF");
    const home = makeHome();
    const app = createApp({
      hub: home.hub, policy: home.policy, rooms: ROOMS, twinDir: out, viewerDir: viewer, libraryDir: lib, log: () => {},
      home: { id: "oneroom", name: "원룸" }, homes: [{ id: "apartment", name: "아파트" }, { id: "oneroom", name: "원룸" }],
    });
    const { url } = await app.listen(0, "127.0.0.1");
    cleanups.push(() => app.close());
    expect((await api(url, "/twin/scene.json")).json).toEqual({ home: "oneroom" });
    const page = await api(url, "/twin/viewer/");
    expect(page.status).toBe(200);
    expect(page.text).toContain("viewer");
    const glb = await api(url, "/twin/lib/assets/appliances/tv.glb");
    expect(glb.status).toBe(200);
    expect(glb.headers.get("content-type")).toBe("model/gltf-binary");
    expect((await api(url, "/twin/lib/../scene.json")).status).toBe(200); // URL이 /twin/scene.json으로 정규화된다
    const health = await api(url, "/api/health");
    expect(health.json.home).toEqual({ id: "oneroom", name: "원룸" });
    expect(health.json.phone_urls).toEqual([]);
    const homes = await api(url, "/api/homes");
    expect(homes.json).toEqual({ current: "oneroom", homes: [{ id: "apartment", name: "아파트" }, { id: "oneroom", name: "원룸" }] });
  });

  it("health에 폰 주소(와이파이)를 담는다: 폰 서버가 뜬 뒤 정해져도 그때 값", async () => {
    const home = makeHome();
    let urls: string[] = [];
    const app = createApp({ hub: home.hub, policy: home.policy, rooms: ROOMS, log: () => {}, phoneUrls: () => urls });
    const { url } = await app.listen(0, "127.0.0.1");
    cleanups.push(() => app.close());
    urls = ["http://192.168.0.5:8210/phone/"];
    expect((await api(url, "/api/health")).json.phone_urls).toEqual(["http://192.168.0.5:8210/phone/"]);
  });

  it("CORS는 localhost 출처만 허용한다", async () => {
    const { url } = await start();
    const ok = await api(url, "/api/health", { headers: { origin: "http://localhost:5173" } });
    expect(ok.headers.get("access-control-allow-origin")).toBe("http://localhost:5173");
    const evil = await api(url, "/api/health", { headers: { origin: "http://evil.example" } });
    expect(evil.headers.get("access-control-allow-origin")).toBeNull();
    const pre = await fetch(url + "/api/devices/tv_living/command", { method: "OPTIONS", headers: { origin: "http://127.0.0.1:8000", "access-control-request-method": "POST" } });
    expect(pre.status).toBe(204);
    expect(pre.headers.get("access-control-allow-methods")).toContain("POST");
  });
});

describe("허브 선택(HUB=memory|matter)", () => {
  const data = { devices: homeDevices(), initial: {}, rooms: ROOMS };

  it("memory는 MemoryHub", async () => {
    const r = await createHub("memory", data);
    expect(r.hub).toBeInstanceOf(MemoryHub);
    expect(r.kind).toBe("memory");
  });

  it("matter 모듈이 없으면 경고와 함께 MemoryHub로 대신한다", async () => {
    const err = Object.assign(new Error("Cannot find module"), { code: "ERR_MODULE_NOT_FOUND" });
    const r = await createHub("matter", data, { importer: async () => { throw err; } });
    expect(r.hub).toBeInstanceOf(MemoryHub);
    expect(r.kind).toBe("memory");
    expect(r.warning).toContain("MemoryHub");
  });

  it("matter 모듈의 createMatterHub를 쓴다", async () => {
    const fake = new MemoryHub(homeDevices()) as DeviceHub;
    let got: unknown;
    const r = await createHub("matter", data, { importer: async () => ({ createMatterHub: (twinData: unknown, o: unknown) => { got = o; return fake; } }), transport: "local" });
    expect(r.hub).toBe(fake);
    expect(r.kind).toBe("matter");
    expect(got).toMatchObject({ transport: "local" });
  });

  it("모르는 HUB 값은 오류", async () => {
    await expect(createHub("zigbee", data)).rejects.toThrow(/HUB/);
  });
});

describe("Matter 정보·페어링 API", () => {
  /** MatterHub처럼 info·openCommissioningWindow를 가진 가짜 허브. */
  class FakeMatter extends MemoryHub {
    opened: number[] = [];
    window = false;
    constructor(readonly transport: "network" | "local") {
      super(homeDevices());
    }
    get info() {
      return {
        transport: this.transport, commissioning: this.transport === "network" ? "reused" : "none", storageDir: "x", port: 5540,
        pairing: { manualPairingCode: "12345678901", qrPairingCode: "MT:ABC", passcode: 20261011, discriminator: 3011, port: 5540, commissioned: this.window || this.transport === "network", fabrics: 1 },
      };
    }
    async openCommissioningWindow(timeoutSeconds = 900) {
      if (this.transport !== "network") throw new Error("Matter 컨트롤러가 브리지에 연결되어 있지 않습니다(network 전송으로 시작해야 합니다).");
      this.opened.push(timeoutSeconds);
      this.window = true;
      return this.info.pairing;
    }
  }

  async function startWith(hub: DeviceHub) {
    const app = createApp({ hub, rooms: ROOMS, hubKind: "matter", log: () => {} });
    const { url } = await app.listen(0, "127.0.0.1");
    cleanups.push(() => app.close());
    return url;
  }

  it("GET /api/matter: 전송·커미셔닝·페어링 코드, health에 transport", async () => {
    const url = await startWith(new FakeMatter("network"));
    const r = await api(url, "/api/matter");
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ ok: true, transport: "network", commissioning: "reused", pairing: { manualPairingCode: "12345678901", qrPairingCode: "MT:ABC" } });
    expect(r.json.storageDir).toBeUndefined(); // 로컬 경로는 내보내지 않는다
    expect((await api(url, "/api/health")).json).toMatchObject({ hub: "matter", transport: "network" });
  });

  it("POST /api/matter/commissioning-window: 다른 컨트롤러용 페어링 창을 연다", async () => {
    const hub = new FakeMatter("network");
    const url = await startWith(hub);
    const r = await api(url, "/api/matter/commissioning-window", { body: { timeoutSeconds: 300 } });
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ ok: true, timeoutSeconds: 300, pairing: { manualPairingCode: "12345678901" } });
    expect(r.json.reply).toMatch(/페어링/);
    expect(hub.opened).toEqual([300]);
    const dflt = await api(url, "/api/matter/commissioning-window", { body: {} });
    expect(dflt.json.timeoutSeconds).toBe(900);
    const bad = await api(url, "/api/matter/commissioning-window", { body: { timeoutSeconds: 5 } });
    expect(bad.status).toBe(400);
    expect(bad.json.error).toMatch(/180/);
  });

  it("local 전송이면 400 한국어 오류, MemoryHub면 /api/matter가 404", async () => {
    const url = await startWith(new FakeMatter("local"));
    const r = await api(url, "/api/matter/commissioning-window", { body: {} });
    expect(r.status).toBe(400);
    expect(r.json.error).toContain("network");
    const mem = await start();
    const m = await api(mem.url, "/api/matter");
    expect(m.status).toBe(404);
    expect(m.json.error).toMatch(/Matter 허브가 아닙니다/);
  });

  it("다른 출처의 페어링 창 열기 요청은 403", async () => {
    const url = await startWith(new FakeMatter("network"));
    const r = await api(url, "/api/matter/commissioning-window", { body: {}, headers: { origin: "http://evil.example" } });
    expect(r.status).toBe(403);
  });
});

describe("listen 오류·Windows EFAULT", () => {
  it("포트가 이미 쓰이면 listen()이 EADDRINUSE로 거부한다(WebSocketServer가 오류를 삼키거나 던지지 않는다)", async () => {
    const first = await start();
    const port = Number(new URL(first.url).port);
    const home = makeHome();
    const app2 = createApp({ hub: home.hub, rooms: ROOMS, log: () => {} });
    cleanups.push(() => app2.close());
    await expect(app2.listen(port, "127.0.0.1")).rejects.toMatchObject({ code: "EADDRINUSE" });
  });

  it("Windows에서 가끔 나는 listen EFAULT(일시적 Winsock 오류)는 잠깐 뒤 다시 시도한다", async () => {
    const home = makeHome();
    const app = createApp({ hub: home.hub, rooms: ROOMS, log: () => {} });
    cleanups.push(() => app.close());
    const server = app.server as unknown as { listen: (...a: unknown[]) => unknown; emit: (e: string, x: unknown) => void };
    const real = server.listen.bind(server);
    let calls = 0;
    server.listen = (...args: unknown[]) => {
      calls += 1;
      if (calls === 1) {
        process.nextTick(() => server.emit("error", Object.assign(new Error("listen EFAULT: bad address in system call argument 127.0.0.1"), { code: "EFAULT" })));
        return server;
      }
      return real(...args);
    };
    const { url } = await app.listen(0, "127.0.0.1");
    // 첫 시도는 가짜 EFAULT. 이 PC에서는 진짜 EFAULT가 이어서 날 수도 있어(IPv4 bind의 몇 %) 2번 이상이면 된다
    expect(calls).toBeGreaterThanOrEqual(2);
    expect((await api(url, "/api/health")).json.ok).toBe(true);
  });

  it("fetchRetry: connect EFAULT는 다시 보내고(요청이 나가지 않았으므로 POST도 안전), 다른 오류는 바로 던진다", async () => {
    const efault = () => new TypeError("fetch failed", { cause: Object.assign(new Error("connect EFAULT 127.0.0.1:1"), { code: "EFAULT", syscall: "connect" }) });
    let calls = 0;
    const flaky = (async () => {
      calls += 1;
      if (calls === 1) throw efault();
      return new Response("{}", { status: 200 });
    }) as unknown as typeof fetch;
    const res = await fetchRetry("http://127.0.0.1:1/x", { method: "POST", body: "{}" }, { fetchImpl: flaky });
    expect(res.status).toBe(200);
    expect(calls).toBe(2);

    let refused = 0;
    const down = (async () => {
      refused += 1;
      throw new TypeError("fetch failed", { cause: Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED", syscall: "connect" }) });
    }) as unknown as typeof fetch;
    await expect(fetchRetry("http://127.0.0.1:1/x", {}, { fetchImpl: down })).rejects.toThrow("fetch failed");
    expect(refused).toBe(1);

    let always = 0;
    const broken = (async () => {
      always += 1;
      throw efault();
    }) as unknown as typeof fetch;
    await expect(fetchRetry("http://127.0.0.1:1/x", {}, { fetchImpl: broken, attempts: 3 })).rejects.toThrow("fetch failed");
    expect(always).toBe(3);
  });
});
