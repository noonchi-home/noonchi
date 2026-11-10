// 계획 방송의 서버 연결: /events 접속 스냅숏, GET/POST /api/plan, 단계 상태, 에이전트 기기 행동 → 계획, 맞춘 눈 → 로봇 자리.

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { Agent } from "../src/agent/agent.js";
import type { PlanView } from "../src/contract/plan.js";
import { PlanHub } from "../src/plan/hub.js";
import { canSendPlan, createApp, isLoopback } from "../src/server/app.js";
import { fetchRetry } from "../src/server/net.js";
import { startServer, type RunningServer } from "../src/server/start.js";
import { smallFloor } from "./helpers/floor.js";
import { ROOMS, makeHome } from "./helpers/home.js";
import { CATALOG, scene } from "./helpers/layout.js";
import { HOME_SCRIPT, startFakeLlm, type FakeLlm } from "./helpers/llm.js";
import { openWebSocket } from "./helpers/ws.js";
import { alignOnServer } from "./helpers/align.js";

type Msg = Record<string, any>;
// 에이전트는 실제 OpenAI 공급자, 모델 자리는 가짜 OpenAI 호환 서버
let llm: FakeLlm;
beforeAll(async () => { llm = await startFakeLlm({ ...HOME_SCRIPT, "TV 켜줘": [[["turn_on", { device_id: "tv_1" }]], "TV를 켰어요."] }); });
afterAll(async () => { await llm?.close(); });
const cleanups: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  while (cleanups.length) await cleanups.pop()!();
});

async function listen(url: string) {
  const messages: Msg[] = [];
  const ws = await openWebSocket(`${url.replace(/^http/, "ws")}/events`, { setup: (s) => s.on("message", (d) => messages.push(JSON.parse(String(d)))) });
  cleanups.push(() => ws.close());
  const waitFor = async (pred: (m: Msg) => boolean, ms = 4000) => {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      const m = messages.find(pred);
      if (m) return m;
      await new Promise((r) => setTimeout(r, 20));
    }
    throw new Error(`시간 초과: ${JSON.stringify(messages.slice(-4))}`);
  };
  return { ws, messages, waitFor };
}

async function api(url: string, path: string, body?: unknown) {
  const res = await fetchRetry(url + path, { method: body === undefined ? "GET" : "POST", headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: res.status, json: (await res.json()) as Msg };
}

async function start(withPlan = true) {
  const home = makeHome();
  const agent = new Agent({ hub: home.hub, policy: home.policy, rooms: ROOMS, provider: llm.provider() });
  const ref: { broadcast?: (m: unknown) => void } = {};
  const plan = withPlan ? new PlanHub(smallFloor(), (m) => ref.broadcast?.(m), () => "2026-11-06T00:00:00Z") : undefined;
  const app = createApp({ hub: home.hub, policy: home.policy, agent, rooms: ROOMS, log: () => {}, plan });
  ref.broadcast = (m) => app.broadcast(m);
  const { url } = await app.listen(0, "127.0.0.1");
  cleanups.push(() => app.close());
  return { url, plan };
}

/** docs/plan-contract.md의 { plan } 예시. */
const docPlan = (): PlanView => {
  const md = readFileSync(new URL("../docs/plan-contract.md", import.meta.url), "utf8");
  return JSON.parse(/```json\r?\n([\s\S]*?)```/.exec(md)![1]!).plan as PlanView;
};

describe("/api/plan", () => {
  it("접속하면 지금 계획(없으면 null)을 먼저 보낸다", async () => {
    const { url } = await start();
    const dash = await listen(url);
    expect(await dash.waitFor((m) => m.type === "plan")).toEqual({ type: "plan", plan: null });
    expect(await api(url, "/api/plan")).toEqual({ status: 200, json: { ok: true, plan: null } });
  });

  it("계약 문서 예시를 받으면 방송하고, 다시 접속하면 그 계획부터 받는다", async () => {
    const { url } = await start();
    const dash = await listen(url);
    await dash.waitFor((m) => m.type === "plan");
    const r = await api(url, "/api/plan", { plan: docPlan() });
    expect(r).toMatchObject({ status: 200, json: { ok: true, plan: { id: "cup-1", revision: 1 } } });
    expect((await dash.waitFor((m) => m.type === "plan" && m.plan)).plan).toMatchObject({ id: "cup-1", source: "planner", steps: [{ status: "active" }, {}, {}, {}] });
    expect((await api(url, "/api/plan")).json.plan).toMatchObject({ id: "cup-1" });
    const again = await listen(url);
    expect(await again.waitFor((m) => m.type === "plan")).toMatchObject({ plan: { id: "cup-1" } });
  });

  it("단계 상태만 바꾸면 서버가 번호를 올린다. 없는 단계는 404", async () => {
    const { url } = await start();
    await api(url, "/api/plan", { plan: docPlan() });
    const r = await api(url, `/api/plan/cup-1/steps/${encodeURIComponent("cup-1:1")}`, { status: "done" });
    expect(r).toMatchObject({ status: 200, json: { ok: true, plan: { revision: 2, status: "running", steps: [{ status: "done" }, {}, {}, {}] } } });
    expect((await api(url, "/api/plan/cup-1/steps/nope", { status: "done" })).status).toBe(404);
    expect((await api(url, "/api/plan/cup-1/steps/cup-1:2", { status: "half" })).status).toBe(400);
  });

  it("모양이 틀리거나 화면 글 규칙을 어긴 계획은 400", async () => {
    const { url } = await start();
    const bad = (patch: (p: PlanView) => void) => { const p = docPlan(); patch(p); return api(url, "/api/plan", { plan: p }); };
    expect((await bad((p) => { p.judgment = "컵 확인 → 치우기"; })).status).toBe(400);
    expect((await bad((p) => { p.steps[0]!.label = "식탁으로 가기(복도 지나서)"; })).status).toBe(400);
    expect((await bad((p) => { p.goal = "가".repeat(61); })).status).toBe(400);
    expect((await bad((p) => { p.robot.position = null; })).status).toBe(400);
    expect((await bad((p) => { p.legs[1]!.end = 99; })).status).toBe(400);
    expect((await api(url, "/api/plan", {})).status).toBe(400);
    expect((await api(url, "/api/plan")).json.plan).toBeNull();
  });

  it("에이전트가 기기를 켜면 계획이 따라 나간다", async () => {
    const { url } = await start();
    const dash = await listen(url);
    await api(url, "/api/agent/chat", { message: "거실 TV 켜줘", sessionId: "s1" });
    expect((await dash.waitFor((m) => m.type === "plan" && m.plan)).plan).toMatchObject({ source: "agent", goal: "거실 TV 켜기", status: "done", steps: [{ kind: "device", target: { deviceId: "tv_living" } }] });
  });

  it("계획 보관이 없는 앱: GET은 null, 보내기는 404", async () => {
    const { url } = await start(false);
    expect((await api(url, "/api/plan")).json).toEqual({ ok: true, plan: null });
    expect((await api(url, "/api/plan", { plan: docPlan() })).status).toBe(404);
  });

  it("같은 PC 주소만 계획을 보낼 수 있다", () => {
    expect(["127.0.0.1", "::1", "::ffff:127.0.0.1"].map(isLoopback)).toEqual([true, true, true]);
    expect(["192.168.0.5", "::ffff:10.0.0.2", undefined].map(isLoopback)).toEqual([false, false, false]);
  });

  it("PLAN_TOKEN을 정하면 그 토큰을 붙인 요청은 다른 주소(compose 포트 전달)에서도 계획을 보낼 수 있다", () => {
    expect(canSendPlan("172.18.0.1", "Bearer t0k-1", "t0k-1")).toBe(true);
    expect(canSendPlan("::ffff:172.18.0.1", "Bearer t0k-1", "t0k-1")).toBe(true);
    expect(canSendPlan("172.18.0.1", "Bearer nope", "t0k-1")).toBe(false);
    expect(canSendPlan("172.18.0.1", undefined, "t0k-1")).toBe(false);
    expect(canSendPlan("172.18.0.1", "Bearer t0k-1", undefined)).toBe(false);
    expect(canSendPlan("127.0.0.1", undefined, "t0k-1")).toBe(true);
    expect(canSendPlan("127.0.0.1", undefined, undefined)).toBe(true);
  });

  it("PLAN_TOKEN을 정한 서버는 토큰을 붙인 계획을 받는다", async () => {
    const home = makeHome();
    const plan = new PlanHub(smallFloor(), () => {}, () => "2026-11-06T00:00:00Z");
    const app = createApp({ hub: home.hub, policy: home.policy, rooms: ROOMS, log: () => {}, plan, planToken: "t0k-1" });
    const { url } = await app.listen(0, "127.0.0.1");
    cleanups.push(() => app.close());
    const r = await fetchRetry(`${url}/api/plan`, { method: "POST", headers: { "content-type": "application/json", authorization: "Bearer t0k-1" }, body: JSON.stringify({ plan: docPlan() }) });
    expect(r.status).toBe(200);
  });
});

function studioFixture(): { studio: string; runtime: string } {
  const studio = mkdtempSync(join(tmpdir(), "twin-home-plan-studio-"));
  const runtime = mkdtempSync(join(tmpdir(), "twin-home-plan-runtime-"));
  cleanups.push(() => rmSync(studio, { recursive: true, force: true }), () => rmSync(runtime, { recursive: true, force: true }));
  const w = (path: string, data: unknown) => {
    mkdirSync(join(path, ".."), { recursive: true });
    writeFileSync(path, JSON.stringify(data), "utf8");
  };
  const s = scene();
  const objects = s.objects as Msg[];
  objects.find((o) => o.id === "tv_1")!.attrs = { power: ["off", "on"] };
  objects.push({ ...structuredClone(objects.find((o) => o.id === "fridge_1")!), id: "dock", name: "로봇 충전대", type: "robot_dock", attrs: {},
    plan: { position: [1, 3], facing_deg: 270, elevation: 0 }, position: [1, 0, 3] });
  w(join(studio, "homes.json"), { default: "oneroom", homes: [{ id: "oneroom", name: "원룸", data: "data/homes/oneroom", out: "homes/oneroom" }] });
  w(join(studio, "homes", "oneroom", "scene.json"), s);
  for (const t of CATALOG.values()) w(join(studio, "data", "catalog", `${t.type}.json`), t);
  return { studio, runtime };
}

describe("startServer: 집의 계획 보관", () => {
  let srv: RunningServer | undefined;
  afterEach(async () => {
    await srv?.close();
    srv = undefined;
  });

  it("맞춘 폰 눈 자리가 기기 계획의 로봇 자리가 된다", async () => {
    const { studio, runtime } = studioFixture();
    srv = await startServer({
      env: { HUB: "memory", PORT: "0", ...llm.env, TWIN_STUDIO_DIR: studio, HOME_ID: "oneroom", RUNTIME_DIR: runtime, PHONE_PORT: "0", PHONE_HOST: "127.0.0.1" },
      log: () => {},
    });
    const dash = await listen(srv.url);
    expect(await dash.waitFor((m) => m.type === "plan")).toEqual({ type: "plan", plan: null });
    const phoneUrl = new URL(srv.phoneUrls[0]!);
    const phone = await openWebSocket(`ws://${phoneUrl.host}/phone/events`);
    cleanups.push(() => phone.close());
    const phoneBox: Msg[] = [];
    phone.on("message", (d) => phoneBox.push(JSON.parse(String(d))));
    await alignOnServer(srv.url, (t) => phone.send(t), join(studio, "homes", "oneroom", "scene.json"), [2, 2]);
    const t0 = Date.now();
    while (!phoneBox.some((m) => m.type === "status" && m.aligned) && Date.now() - t0 < 4000) await new Promise((r) => setTimeout(r, 20));
    phone.send(JSON.stringify({ type: "pose", position: [3, 1.4, 2], orientation: [0, 0, 0, 1], hit: [3, 0, 3] }));
    const eye = await dash.waitFor((m) => m.type === "eye" && !m.eye.estimated);

    await api(srv.url, "/api/agent/chat", { message: "TV 켜줘", sessionId: "s1" });
    const plan = (await dash.waitFor((m) => m.type === "plan" && m.plan)).plan as PlanView;
    expect(plan).toMatchObject({ source: "agent", goal: "TV 켜기", robot: { room: "room" } });
    expect(plan.robot.position).toEqual(eye.eye.position);
    expect((await api(srv.url, "/api/plan")).json.plan).toMatchObject({ id: plan.id });
  });
});
