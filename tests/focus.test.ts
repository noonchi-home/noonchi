// 초점(클로이드가 지금 다루는 물건)과 HOME_ID로 고른 집에서의 폰 말·배치 보정 통합.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { AgentAction } from "../src/agent/agent.js";
import { focusFromActions } from "../src/layout/focus.js";
import { fetchRetry } from "../src/server/net.js";
import { startServer, type RunningServer } from "../src/server/start.js";
import { CATALOG, scene } from "./helpers/layout.js";
import { openWebSocket } from "./helpers/ws.js";

type Msg = Record<string, any>;
const cleanups: (() => Promise<void> | void)[] = [];
let srv: RunningServer | undefined;
afterEach(async () => {
  await srv?.close();
  srv = undefined;
  while (cleanups.length) await cleanups.pop()!();
});

const act = (tool: string, deviceId: string | undefined, ok = true, extra: Partial<AgentAction> = {}): AgentAction =>
  ({ tool, args: {}, ok, deviceId, at: "2026-10-24T12:00:00.000Z", ...extra });

describe("focusFromActions", () => {
  it("성공했거나 승인을 기다리는 대상만, 순서대로 한 번씩", () => {
    const where: Record<string, [number, number, number]> = { tv_1: [1, 0.9, 3.7], door_main: [3, 1, 5] };
    const locate = (id: string) => (where[id] ? { id, label: id, position: where[id]! } : undefined);
    const targets = focusFromActions([
      act("find_devices", undefined),
      act("turn_on", "tv_1"),
      act("turn_on", "tv_1"),
      act("unlock", "door_main", false, { needsConfirmation: true }),
      act("turn_on", "lamp_1", false),
      act("remove_object", "gone_1"),
    ], locate);
    expect(targets.map((t) => t.id)).toEqual(["tv_1", "door_main"]);
  });
});

function studioFixture(): { studio: string; runtime: string } {
  const studio = mkdtempSync(join(tmpdir(), "twin-home-focus-studio-"));
  const runtime = mkdtempSync(join(tmpdir(), "twin-home-focus-runtime-"));
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
  w(join(studio, "homes.json"), {
    default: "apartment",
    homes: [{ id: "apartment", name: "아파트", data: "data/apartment", out: "apartment" }, { id: "oneroom", name: "원룸", data: "data/homes/oneroom", out: "homes/oneroom" }],
  });
  w(join(studio, "homes", "oneroom", "scene.json"), s);
  for (const t of CATALOG.values()) w(join(studio, "data", "catalog", `${t.type}.json`), t);
  return { studio, runtime };
}

async function listen(url: string) {
  const messages: Msg[] = [];
  const ws = await openWebSocket(url, { setup: (s) => s.on("message", (d) => messages.push(JSON.parse(String(d)))) });
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

describe("HOME_ID로 고른 집: 폰 말 → 배치 보정 → 초점", () => {
  it("폰이 '냉장고 위치 여기로 맞춰줘'라고 하면 조준점으로 옮기고, 대시보드에 layout·초점, 폰에 답·초점이 간다", async () => {
    const { studio, runtime } = studioFixture();
    srv = await startServer({
      env: { HUB: "memory", PORT: "0", AGENT_PROVIDER: "mock", TWIN_STUDIO_DIR: studio, HOME_ID: "oneroom", RUNTIME_DIR: runtime, PHONE_PORT: "0", PHONE_HOST: "127.0.0.1", FOCUS: "1" },
      log: () => {},
    });
    const health = (await (await fetchRetry(`${srv.url}/api/health`)).json()) as Msg;
    expect(health.home).toEqual({ id: "oneroom", name: "원룸" });
    expect(srv.layout).toBeDefined();

    const dash = await listen(`${srv.url.replace(/^http/, "ws")}/events`);
    const phoneUrl = new URL(srv.phoneUrls[0]!);
    const phone = await listen(`ws://${phoneUrl.host}/phone/events`);
    phone.ws.send(JSON.stringify({ type: "anchor", id: "dock", point: [1, 0, 3] }));
    phone.ws.send(JSON.stringify({ type: "anchor", id: "door_main", point: [3, 0, 5] }));
    await phone.waitFor((m) => m.type === "status" && m.aligned);
    phone.ws.send(JSON.stringify({ type: "pose", position: [3, 1.4, 2], orientation: [0, 0, 0, 1], hit: [3, 0, 3] }));
    await dash.waitFor((m) => m.type === "eye");

    phone.ws.send(JSON.stringify({ type: "say", text: "냉장고 위치 여기로 맞춰줘" }));
    const reply = await phone.waitFor((m) => m.type === "reply");
    expect(reply.text).toMatch(/냉장고.*옮겼어요/);
    expect(await dash.waitFor((m) => m.type === "layout" && m.op === "move")).toMatchObject({ id: "fridge_1", plan: { position: [3, 3] } });
    const agentReply = await dash.waitFor((m) => m.type === "agent" && m.event === "reply");
    expect(agentReply.sessionId).toBe("phone");
    const focus = await dash.waitFor((m) => m.type === "focus");
    expect(focus.focus.targets).toEqual([{ id: "fridge_1", label: "냉장고", position: [3, 0.925, 3] }]);
    expect(focus.focus.ttl_ms).toBeGreaterThan(0);
    const phoneFocus = await phone.waitFor((m) => m.type === "focus");
    expect(phoneFocus.targets[0]).toMatchObject({ id: "fridge_1" });
    phoneFocus.targets[0].ar.forEach((v: number, i: number) => expect(v).toBeCloseTo([3, 0.925, 3][i]!, 6));

    phone.ws.send(JSON.stringify({ type: "say", text: "배치 저장해" }));
    expect((await phone.waitFor((m) => m.type === "reply" && /저장/.test(m.text))).text).toMatch(/1건/);
    const saved = (await (await fetchRetry(`${srv.url}/api/layout`)).json()) as Msg;
    expect(saved).toMatchObject({ home: "oneroom", edits: 1, dirty: false, savePath: join(runtime, "homes", "oneroom", "edits.json") });
  });

  it("대시보드 채팅으로 기기를 켜도 그 기기에 초점이 간다", async () => {
    const { studio, runtime } = studioFixture();
    srv = await startServer({ env: { HUB: "memory", PORT: "0", AGENT_PROVIDER: "mock", TWIN_STUDIO_DIR: studio, HOME_ID: "oneroom", RUNTIME_DIR: runtime, FOCUS: "1" }, log: () => {} });
    const dash = await listen(`${srv.url.replace(/^http/, "ws")}/events`);
    const res = await fetchRetry(`${srv.url}/api/agent/chat`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ message: "TV 켜줘", sessionId: "s1" }) });
    expect(((await res.json()) as Msg).reply).toMatch(/켰어요/);
    const focus = await dash.waitFor((m) => m.type === "focus");
    expect(focus.focus.targets.map((t: Msg) => t.id)).toEqual(["tv_1"]);
  });

  it("FOCUS가 없으면(기본) 초점을 대시보드에도 폰에도 보내지 않는다", async () => {
    const { studio, runtime } = studioFixture();
    srv = await startServer({ env: { HUB: "memory", PORT: "0", AGENT_PROVIDER: "mock", TWIN_STUDIO_DIR: studio, HOME_ID: "oneroom", RUNTIME_DIR: runtime, PHONE_PORT: "0", PHONE_HOST: "127.0.0.1" }, log: () => {} });
    const dash = await listen(`${srv.url.replace(/^http/, "ws")}/events`);
    const phoneUrl = new URL(srv.phoneUrls[0]!);
    const phone = await listen(`ws://${phoneUrl.host}/phone/events`);
    phone.ws.send(JSON.stringify({ type: "anchor", id: "dock", point: [1, 0, 3] }));
    phone.ws.send(JSON.stringify({ type: "anchor", id: "door_main", point: [3, 0, 5] }));
    await phone.waitFor((m) => m.type === "status" && m.aligned);
    const res = await fetchRetry(`${srv.url}/api/agent/chat`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ message: "TV 켜줘", sessionId: "s1" }) });
    expect(((await res.json()) as Msg).reply).toMatch(/켰어요/);
    await dash.waitFor((m) => m.type === "agent" && m.event === "reply");
    await new Promise((r) => setTimeout(r, 400));
    expect(dash.messages.some((m) => m.type === "focus")).toBe(false);
    expect(phone.messages.some((m) => m.type === "focus")).toBe(false);
  });
});
