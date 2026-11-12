// 설정 흐름 서버: 집 바꾸기(실행 묶음을 닫고 새로 만듦), 기기 신호 출처, 저장한 선택으로 다시 켜기.
// 실제 twin-studio 데이터(oneroom·apartment)와 HUB=memory, 가짜 OpenAI 호환 서버에 붙인 에이전트로 돈다.

import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { request, type IncomingMessage } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type WebSocket from "ws";
import { MemoryHub } from "../src/hub/memory.js";
import { fetchRetry } from "../src/server/net.js";
import { startServer, type RunningServer } from "../src/server/start.js";
import { HOME_SCRIPT, startFakeLlm, type FakeLlm } from "./helpers/llm.js";
import { openWebSocket } from "./helpers/ws.js";
import { readVideo } from "./helpers/video.js";
import { encodeFramePacket } from "../src/phone/packet.js";

type Msg = Record<string, any>;
let llm: FakeLlm;
beforeAll(async () => { llm = await startFakeLlm({ ...HOME_SCRIPT, "전자레인지 시작해줘": [[["start", { device_id: "microwave_1" }]], "시작할까요?"] }); });
afterAll(async () => { await llm?.close(); });
let srv: RunningServer | undefined;
const sockets: WebSocket[] = [];
const dirs: string[] = [];
afterEach(async () => {
  for (const ws of sockets.splice(0)) ws.terminate();
  await srv?.close();
  srv = undefined;
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

const runtime = () => {
  const dir = mkdtempSync(join(tmpdir(), "setup-server-"));
  dirs.push(dir);
  return dir;
};
/** 빌드한 화면 대신 쓰는 화면 폴더(대시보드·설정 입구). */
const web = () => {
  const dir = runtime();
  mkdirSync(join(dir, "setup"));
  writeFileSync(join(dir, "index.html"), "<title>대시보드</title>");
  writeFileSync(join(dir, "setup", "index.html"), "<title>설정</title>");
  return dir;
};
const env = (runtimeDir: string, extra: Record<string, string> = {}) => ({
  HUB: "memory", PORT: "0", ...llm.env, HOME_ID: "oneroom", RUNTIME_DIR: runtimeDir, ...extra,
});
const get = async (path: string) => {
  const r = await fetchRetry(`${srv!.url}${path}`);
  return { status: r.status, json: (await r.json()) as Msg };
};
const post = async (path: string, body: unknown = {}, headers: Record<string, string> = {}) => {
  const r = await fetchRetry(`${srv!.url}${path}`, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
  return { status: r.status, json: (await r.json()) as Msg };
};

/** 열기 전부터 받은 메시지를 모아 두고 조건에 맞는 것을 기다린다. */
async function events() {
  const got: Msg[] = [];
  const waiters: { pred: (m: Msg) => boolean; resolve: (m: Msg) => void }[] = [];
  const ws = await openWebSocket(`${srv!.url.replace(/^http/, "ws")}/events`, {
    setup: (s) => s.on("message", (data) => {
      const m = JSON.parse(String(data)) as Msg;
      got.push(m);
      for (const w of waiters.splice(0)) if (w.pred(m)) w.resolve(m); else waiters.push(w);
    }),
  });
  sockets.push(ws);
  const closed = new Promise<void>((r) => ws.once("close", () => r()));
  return {
    got, closed,
    waitFor: (pred: (m: Msg) => boolean, ms = 5000) => {
      const hit = got.find(pred);
      if (hit) return Promise.resolve(hit);
      return new Promise<Msg>((resolve, reject) => {
        waiters.push({ pred, resolve });
        setTimeout(() => reject(new Error("메시지를 기다리다 시간 초과")), ms);
      });
    },
  };
}

describe("설정 흐름 서버", () => {
  it("저장 없이 뜨면 HOME_ID 집, 설정은 끝냄(테스트·데모 방식)", async () => {
    srv = await startServer({ env: env(runtime()), log: () => {} });
    const r = await get("/api/setup");
    expect(r.json).toMatchObject({ ok: true, persist: false, done: true, switching: false, home: { id: "oneroom" } });
    expect(r.json.homes.map((h: Msg) => h.id)).toEqual(expect.arrayContaining(["apartment", "oneroom"]));
    expect(r.json.devices.length).toBe(srv.twin.devices.length);
    expect(r.json.devices[0]).toMatchObject({ source: { kind: "virtual" } });
    expect(r.json.devices_saved).toBe(false);
  });

  it("POST /api/setup/assist가 돕는 방식을 바꾸고 GET /api/setup에 보인다. 틀린 값은 400이고, 운영 모드를 바꿔도 그대로다", async () => {
    srv = await startServer({ env: env(runtime()), log: () => {} });
    expect((await get("/api/setup")).json).toMatchObject({ assist: "noonchi", mode: "test" });
    expect(srv.assist).toBe("noonchi");
    const r = await post("/api/setup/assist", { assist: "coach" });
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ ok: true, assist: "coach", mode: "test" });
    expect((await get("/api/setup")).json.assist).toBe("coach");
    expect(srv.assist).toBe("coach");
    for (const bad of [{ assist: "teacher" }, { assist: null }, {}]) expect((await post("/api/setup/assist", bad)).status).toBe(400);
    expect((await get("/api/setup")).json.assist).toBe("coach");
    expect((await post("/api/setup/mode", { mode: "test" })).json).toMatchObject({ mode: "test", assist: "coach" });
    expect((await post("/api/setup/assist", { assist: "noonchi" })).json.assist).toBe("noonchi");
  });

  it("집을 바꾸면 허브·에이전트·트윈이 새 집으로, 다시 붙은 WS hello도 새 집", async () => {
    srv = await startServer({ env: env(runtime(), { PHONE_PORT: "0", PHONE_HOST: "127.0.0.1" }), log: () => {} });
    const phoneUrls = srv.phoneUrls;
    const before = srv.twin.devices.length;
    const ev = await events();
    expect((await ev.waitFor((m) => m.type === "hello")).home).toBe("oneroom");
    const r = await post("/api/setup/home", { home: "apartment" });
    expect(r.status).toBe(200);
    expect(r.json.home.id).toBe("apartment");
    await ev.closed;
    expect(srv.twin.home.id).toBe("apartment");
    expect(srv.twin.devices.length).not.toBe(before);
    expect(srv.hub.list().length).toBe(srv.twin.devices.length);
    const health = await get("/api/health");
    expect(health.json.home.id).toBe("apartment");
    expect(health.json.devices).toBe(srv.twin.devices.length);
    expect(srv.phoneUrls).toEqual(phoneUrls);
    const ev2 = await events();
    expect((await ev2.waitFor((m) => m.type === "hello")).home).toBe("apartment");
    const chat = await post("/api/agent/chat", { message: "거실 TV 켜줘", sessionId: "s1" });
    expect(chat.status).toBe(200);
  });

  it("집을 바꾸면 눈 영상 스트림이 끝나고, 다시 붙은 폰의 영상이 새 스트림으로 나온다", async () => {
    srv = await startServer({ env: env(runtime(), { PHONE_PORT: "0", PHONE_HOST: "127.0.0.1" }), log: () => {} });
    const phoneBase = srv.phoneUrls[0]!.replace(/\/phone\/$/, "");
    const sendVideo = async () => {
      const phone = await openWebSocket(`${phoneBase.replace(/^http/, "ws")}/phone/events`, { options: { origin: phoneBase } });
      sockets.push(phone);
      phone.send(encodeFramePacket({ kind: "video_config", codec: "avc1.42E01F", width: 592, height: 1280 }, Buffer.from([1, 0x42])));
      phone.send(encodeFramePacket({ kind: "video", key: true, ts: 0, width: 592, height: 1280 }, Buffer.alloc(500, 0x65)));
      return phone;
    };
    const phone1 = await sendVideo();
    const v1 = await readVideo(`${srv.url}/api/eye/video`);
    await v1.waitFor((m) => m.header.type === "chunk");
    const phoneClosed = new Promise((r) => phone1.once("close", r));
    expect((await post("/api/setup/home", { home: "apartment" })).status).toBe(200);
    await v1.ended;
    await phoneClosed;
    await sendVideo();
    const v2 = await readVideo(`${srv.url}/api/eye/video`);
    const [first, second] = await v2.waitFor(() => true, 2);
    expect([first!.header.type, second!.header]).toEqual(["config", { type: "chunk", key: true, ts: 0 }]);
    expect((await get("/api/eye/stats")).json.display).toMatchObject({ codec: "avc1.42E01F", viewers: 1 });
    v2.close();
  });

  it("없는 집은 400, 지금 집을 그대로 둔다", async () => {
    srv = await startServer({ env: env(runtime()), log: () => {} });
    const bad = await post("/api/setup/home", { home: "nowhere" });
    expect(bad.status).toBe(400);
    expect(bad.json.error).toMatch(/없는 집/);
    expect((await get("/api/health")).json.home.id).toBe("oneroom");
    expect((await post("/api/setup/home", {})).status).toBe(400);
  });

  it("집을 바꾸는 동안: 다른 API 503, 겹친 바꾸기 409, 설정 화면 파일은 나온다", async () => {
    // 허브 시작을 붙잡아 바꾸는 중인 상태를 만든다(HUB=matter 자리에 늦게 시작하는 MemoryHub)
    let gate: Promise<void> = Promise.resolve();
    const importer = async () => ({
      createMatterHub: (twin: Parameters<typeof MemoryHub.fromTwin>[0]) => {
        const hub = MemoryHub.fromTwin(twin);
        const start = hub.start.bind(hub);
        hub.start = async () => { await gate; await start(); };
        return hub;
      },
    });
    srv = await startServer({ env: env(runtime(), { HUB: "matter", MATTER_TRANSPORT: "local" }), log: () => {}, importer, webDir: web() });
    let open!: () => void;
    gate = new Promise((r) => { open = r; });
    const switching = srv.switchHome("apartment");
    const during = await get("/api/devices");
    const second = await post("/api/setup/home", { home: "oneroom" });
    const page = await fetchRetry(`${srv.url}/setup/`);
    const view = (await get("/api/setup")).json;
    open();
    await switching;
    expect(during.status).toBe(503);
    expect(during.json.error).toMatch(/바꾸는 중/);
    expect(second.status).toBe(409);
    expect(page.status).toBe(200);
    expect(await page.text()).toContain("설정");
    expect(view).toMatchObject({ switching: true, home: null });
    expect(srv.twin.home.id).toBe("apartment");
    expect((await get("/api/devices")).status).toBe(200);
  });

  it("신호 없음으로 바꾸면 REST·WS가 모름으로 보이고, 모르는 기기·값은 400", async () => {
    srv = await startServer({ env: env(runtime()), log: () => {} });
    const id = srv.twin.devices.find((d) => d.capabilities.includes("onoff"))!.id;
    const ev = await events();
    await ev.waitFor((m) => m.type === "hello");
    const r = await post("/api/setup/devices", { home: srv.twin.home.id, sources: { [id]: "none" } });
    expect(r.status).toBe(200);
    expect(r.json.devices.find((d: Msg) => d.id === id).source).toEqual({ kind: "none" });
    expect(r.json.devices_saved).toBe(true);
    const msg = await ev.waitFor((m) => m.type === "state" && m.state.id === id && m.state.signal === "none");
    expect(msg.state.twin).toEqual({});
    const devices = (await get("/api/devices")).json as unknown as Msg[];
    expect(devices.find((d) => d.id === id)!.state).toMatchObject({ signal: "none", twin: {} });
    const cmd = await post(`/api/devices/${id}/command`, { command: "on" });
    expect(cmd.status).toBe(200);
    expect(cmd.json.state.signal).toBe("none");
    expect(srv.hub.get(id)!.twin.power).toBe("on");
    expect((await post("/api/setup/devices", { home: srv.twin.home.id, sources: { nope: "none" } })).status).toBe(400);
    expect((await post("/api/setup/devices", { home: srv.twin.home.id, sources: { [id]: "thinq" } })).status).toBe(400);
    expect((await post("/api/setup/devices", { home: srv.twin.home.id, sources: { [id]: "virtual" } })).json.devices.find((d: Msg) => d.id === id).source).toEqual({ kind: "virtual" });
    // 다른 탭이 본 집과 지금 집이 다르면 409
    const stale = await post("/api/setup/devices", { home: "apartment", sources: { [id]: "none" } });
    expect(stale.status).toBe(409);
    expect((await post("/api/setup/done", { home: "apartment" })).status).toBe(409);
    expect((await post("/api/setup/done", {})).status).toBe(400);
  });

  it("집을 바꾸면 이전 집 배치 편집기는 닫히고, 다른 집을 적은 시작 위치·배치 쓰기는 409", async () => {
    srv = await startServer({ env: env(runtime()), log: () => {} });
    const oldLayout = srv.layout!;
    const movable = oldLayout.objects().find((o) => o.type === "fridge" || o.type === "sofa") ?? oldLayout.objects()[0]!;
    await srv.switchHome("apartment");
    expect(() => oldLayout.move(movable.id, { dx: 0.1, dy: 0 })).toThrow(/집을 바꿔서/);
    expect(() => oldLayout.save()).toThrow(/집을 바꿔서/);
    expect((await post("/api/layout/save", { home: "oneroom" })).status).toBe(409);
    expect((await post("/api/phone/start-pose/clear", { home: "oneroom" })).status).toBe(409);
    expect((await post("/api/layout/save", { home: "apartment" })).status).toBe(200);
  });

  it("본문을 기다리던 시작 위치 저장이 집을 바꾼 뒤 도착하면 쓰지 않는다", async () => {
    const dir = runtime();
    srv = await startServer({ env: env(dir), log: () => {} });
    const url = new URL(`${srv.url}/api/phone/start-pose`);
    const req = request({ host: url.hostname, port: url.port, path: url.pathname, method: "POST", headers: { "content-type": "application/json" } });
    const response = new Promise<IncomingMessage>((r) => req.on("response", r));
    req.flushHeaders();
    await new Promise((r) => setTimeout(r, 100));
    await srv.switchHome("apartment");
    req.end(JSON.stringify({ home: "oneroom", position: [0.5, 0.5], yaw_deg: 0 }));
    const res = await response;
    res.resume();
    expect(res.statusCode).toBe(503);
    expect(existsSync(join(dir, "homes", "oneroom", "phone-start.json"))).toBe(false);
  });

  it("신호 없는 기기는 승인 뒤 실행해도 결과를 모른다고 답한다", async () => {
    srv = await startServer({ env: env(runtime(), { HOME_ID: "apartment" }), log: () => {} });
    await post("/api/setup/devices", { home: "apartment", sources: { microwave_1: "none" } });
    const chat = await post("/api/agent/chat", { message: "전자레인지 시작해줘", sessionId: "s-mw" });
    const token = chat.json.pendingConfirmations?.[0]?.token;
    expect(token).toBeTruthy();
    const ok = await post("/api/agent/confirm", { token });
    expect(ok.json.reply).toMatch(/보냈어요.*확인하지 못했어요/);
  });

  it("집을 바꾸는 중에 서버를 끄면 새로 만든 허브도 닫는다", async () => {
    let gate: Promise<void> = Promise.resolve();
    const hubs: { home: number; stopped: boolean }[] = [];
    const importer = async () => ({
      createMatterHub: (twin: Parameters<typeof MemoryHub.fromTwin>[0]) => {
        const hub = MemoryHub.fromTwin(twin);
        const rec = { home: twin.devices.length, stopped: false };
        hubs.push(rec);
        const start = hub.start.bind(hub);
        const stop = hub.stop.bind(hub);
        hub.start = async () => { await gate; await start(); };
        hub.stop = async () => { rec.stopped = true; await stop(); };
        return hub;
      },
    });
    srv = await startServer({ env: env(runtime(), { HUB: "matter", MATTER_TRANSPORT: "local" }), log: () => {}, importer });
    let open!: () => void;
    gate = new Promise((r) => { open = r; });
    const switching = srv.switchHome("apartment").catch(() => {});
    const closing = srv.close();
    open();
    await closing;
    await switching;
    srv = undefined;
    expect(hubs.length).toBe(2);
    expect(hubs.every((h) => h.stopped)).toBe(true);
  });

  it("다른 출처의 설정 쓰기는 403", async () => {
    srv = await startServer({ env: env(runtime()), log: () => {} });
    const r = await post("/api/setup/done", { home: "oneroom" }, { origin: "https://evil.example" });
    expect(r.status).toBe(403);
  });

  it("npm start 방식(persistSetup): 저장 없으면 HOME_ID·안 끝냄, 저장한 집·출처·끝냄은 다시 켜도 그대로", async () => {
    const dir = runtime();
    srv = await startServer({ env: env(dir), log: () => {}, persistSetup: true });
    expect((await get("/api/setup")).json).toMatchObject({ persist: true, done: false, home: { id: "oneroom" } });
    await post("/api/setup/home", { home: "apartment" });
    const id = srv.twin.devices[0]!.id;
    await post("/api/setup/devices", { home: srv.twin.home.id, sources: { [id]: "none" } });
    await post("/api/setup/done", { home: "apartment" });
    await srv.close();
    srv = await startServer({ env: env(dir), log: () => {}, persistSetup: true });
    const v = (await get("/api/setup")).json;
    expect(v).toMatchObject({ done: true, home: { id: "apartment" }, devices_saved: true });
    expect(v.devices.find((d: Msg) => d.id === id).source).toEqual({ kind: "none" });
    expect(srv.signals.get(id)!.signal).toBe("none");
  });

  it("설정을 안 끝냈으면 /는 /setup/으로 보내고, 끝내면 대시보드를 내준다", async () => {
    srv = await startServer({ env: env(runtime()), log: () => {}, persistSetup: true, webDir: web() });
    const first = await fetchRetry(`${srv.url}/`, { redirect: "manual" });
    expect(first.status).toBe(302);
    expect(first.headers.get("location")).toBe("/setup/");
    const setup = await fetchRetry(`${srv.url}/setup/`);
    expect(await setup.text()).toContain("설정");
    expect((await post("/api/setup/done", { home: "oneroom" })).status).toBe(200);
    const after = await fetchRetry(`${srv.url}/`, { redirect: "manual" });
    expect(after.status).toBe(200);
    expect(await after.text()).toContain("대시보드");
  });
});
