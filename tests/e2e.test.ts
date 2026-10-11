// 끝에서 끝까지: npm start와 같은 시작 경로(startServer)로 서버를 띄운다(HUB 기본값 = matter).
//   twin-studio 실제 기기 → MatterHub(브리지 엔드포인트) → REST·WS → mock 에이전트 → MCP stdio 서버.
// 확인은 브리지 쪽 Matter 속성(실제 Matter 기기 상태)으로 한다.
//   local:   네트워크 없이(빠름)
//   network: 서버가 브리지를 실제로 커미셔닝(UDP, 임시 포트·저장 폴더). 이 PC에서 안 되면 원인을 남기고 건너뛴다.
//   대체:    커미셔닝 제한 시간을 넘기면 local로 대신 뜨는지

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runScenarios } from "../scripts/scenarios.js";
import type { MatterHub } from "../src/matter/matterHub.js";
import { resolveTwinStudioDir } from "../src/model/devices.js";
import { startServer, type RunningServer } from "../src/server/start.js";
import { api, listenEvents, mcpClient, type Msg } from "./helpers/live.js";

const REPO = fileURLToPath(new URL("..", import.meta.url));
const STUDIO = resolveTwinStudioDir(process.env.TWIN_STUDIO_DIR, REPO);

const temps: string[] = [];
function tempDir(prefix: string): string {
  const d = mkdtempSync(join(tmpdir(), `twin-home-${prefix}-`));
  temps.push(d);
  return d;
}
afterAll(() => {
  for (const d of temps) {
    try {
      rmSync(d, { recursive: true, force: true });
    } catch {
      // Windows에서 sqlite 잠금이 늦게 풀리면 남을 수 있다(임시 폴더)
    }
  }
});

function env(extra: Record<string, string>): Record<string, string> {
  return { PORT: "0", AGENT_PROVIDER: "mock", TWIN_STUDIO_DIR: STUDIO, MATTER_STORAGE_DIR: tempDir("e2e"), ...extra };
}

/** 브리지 쪽 Matter 클러스터 상태(컨트롤러를 거치지 않은 기기 자체의 값). */
function bridge(srv: RunningServer, id: string): Record<string, Record<string, any>> {
  const ep = (srv.hub as MatterHub).bridgeEndpoint(id);
  if (!ep) throw new Error(`브리지 엔드포인트 없음: ${id}`);
  return ep.state as unknown as Record<string, Record<string, any>>;
}

const LOCKED = 1;
const UNLOCKED = 2;

describe("e2e: npm start 경로(HUB 기본 matter, local 전송)", () => {
  let srv: RunningServer;
  let events: Awaited<ReturnType<typeof listenEvents>>;
  const logs: string[] = [];

  beforeAll(async () => {
    srv = await startServer({ env: env({ MATTER_TRANSPORT: "local" }), log: (m) => logs.push(m) });
    events = await listenEvents(srv.url);
    await events.waitFor((m) => m.type === "hello");
  }, 120_000);

  afterAll(async () => {
    events?.close();
    await srv?.close();
  }, 30_000);

  it("HUB를 주지 않으면 Matter 허브로 뜨고 페어링 코드를 알린다", async () => {
    expect(srv.hubKind).toBe("matter");
    expect(srv.transport).toBe("local");
    expect(srv.warnings).toEqual([]);
    expect(srv.twin.devices.length).toBeGreaterThanOrEqual(50);
    expect(logs.join("\n")).toMatch(/수동 페어링 코드: \d{11}/);
    const health = await api(srv.url, "/api/health");
    expect(health.json).toMatchObject({ ok: true, hub: "matter", transport: "local", provider: "mock", devices: srv.twin.devices.length });
    const matter = await api(srv.url, "/api/matter");
    expect(matter.json).toMatchObject({ ok: true, transport: "local", pairing: { manualPairingCode: expect.stringMatching(/^\d{11}$/) } });
    expect(bridge(srv, "tv_living").bridgedDeviceBasicInformation!.nodeLabel).toBe("거실 TV");
  });

  it("데모 시나리오(REST 에이전트, mock)가 모두 통과하고 브리지의 Matter 속성이 바뀐다", async () => {
    const before = events.messages.length;
    const rows = await runScenarios({ url: srv.url, hub: srv.hub, devices: srv.twin.devices, sessionId: "e2e-demo" });
    for (const r of rows) expect(r.pass, `${r.no} "${r.say}" → ${r.reply}`).toBe(true);
    // 상태를 바꾸는 단계마다 WS state 이벤트가 나왔다(5a는 승인 대기라 바뀌는 것이 없다)
    for (const r of rows.filter((x) => x.no !== "5a")) expect(r.ws, `${r.no} WS 이벤트`).toBeGreaterThan(0);
    expect(rows.find((r) => r.no === "5a")!.ws).toBe(0);

    expect(bridge(srv, "light_living").onOff!.onOff).toBe(true);
    expect(bridge(srv, "lamp_living").onOff!.onOff).toBe(true);
    expect(bridge(srv, "tv_living").onOff!.onOff).toBe(false);
    const ac = bridge(srv, "ac_living");
    expect(ac.onOff!.onOff).toBe(true);
    expect([ac.thermostat!.occupiedCoolingSetpoint, ac.thermostat!.occupiedHeatingSetpoint]).toContain(2400);
    expect(bridge(srv, "curtain_master").windowCovering!.currentPositionLiftPercent100ths).toBe(10000); // 0=열림, 10000=닫힘
    expect(bridge(srv, "door_main").doorLock!.lockState).toBe(UNLOCKED);

    const changed = new Set(events.states(before).map((s) => s.id));
    for (const id of ["light_living", "lamp_living", "tv_living", "ac_living", "curtain_master", "door_main"]) expect(changed, id).toContain(id);
  }, 60_000);

  it("웹 화면 문장 '거실 불 켜고 TV 꺼줘': 두 기기가 Matter로 바뀌고 WS로 알린다", async () => {
    await api(srv.url, "/api/devices/tv_living/command", { command: { type: "on" } });
    await api(srv.url, "/api/devices/light_living/command", { command: { type: "off" } });
    expect(bridge(srv, "tv_living").onOff!.onOff).toBe(true);
    expect(bridge(srv, "light_living").onOff!.onOff).toBe(false);
    const before = events.messages.length;

    const r = await api(srv.url, "/api/agent/chat", { message: "거실 불 켜고 TV 꺼줘", sessionId: "e2e-web" });
    expect(r.status).toBe(200);
    expect(r.json.actions.map((a: Msg) => a.tool)).toEqual(expect.arrayContaining(["turn_on", "turn_off"]));
    expect(r.json.pendingConfirmations).toEqual([]);
    expect(bridge(srv, "light_living").onOff!.onOff).toBe(true);
    expect(bridge(srv, "tv_living").onOff!.onOff).toBe(false);

    await events.waitFor((m) => events.messages.indexOf(m) >= before && m.type === "state" && m.state.id === "tv_living" && m.state.matter.onOff === false);
    await events.waitFor((m) => events.messages.indexOf(m) >= before && m.type === "state" && m.state.id === "light_living" && m.state.twin.power === "on");
    await events.waitFor((m) => events.messages.indexOf(m) >= before && m.type === "agent" && m.event === "reply" && m.sessionId === "e2e-web");
  }, 30_000);

  it("MCP stdio 서버(SDK 클라이언트): list_devices·turn_on·lock·unlock→confirm_action이 Matter 속성을 바꾼다", async () => {
    const mcp = await mcpClient(srv.url);
    try {
      const { tools } = await mcp.client.listTools();
      expect(tools.map((t) => t.name)).toEqual(expect.arrayContaining(["list_devices", "turn_on", "unlock", "confirm_action"]));
      const list = await mcp.call("list_devices", { room: "주방" });
      expect(list.isError).toBeFalsy();
      expect((list.json.data as Msg[]).map((d) => d.id)).toContain("light_kitchen");

      expect(bridge(srv, "light_kitchen").onOff!.onOff).toBe(false);
      const on = await mcp.call("turn_on", { device_id: "light_kitchen" });
      expect(on.json).toMatchObject({ ok: true, state: { power: "on" } });
      expect(bridge(srv, "light_kitchen").onOff!.onOff).toBe(true);

      const lock = await mcp.call("lock", { device_id: "door_main" });
      expect(lock.json.ok).toBe(true);
      expect(bridge(srv, "door_main").doorLock!.lockState).toBe(LOCKED);
      const unlock = await mcp.call("unlock", { device_id: "door_main" });
      expect(unlock.json.needsConfirmation?.token).toBeTruthy();
      expect(bridge(srv, "door_main").doorLock!.lockState).toBe(LOCKED); // 승인 전에는 그대로
      const ok = await mcp.call("confirm_action", { token: unlock.json.needsConfirmation.token });
      expect(ok.json.ok).toBe(true);
      expect(bridge(srv, "door_main").doorLock!.lockState).toBe(UNLOCKED);
    } finally {
      await mcp.close();
    }
  }, 60_000);
});

describe("e2e: network 전송(서버가 브리지를 실제로 커미셔닝)", () => {
  it("커미셔닝 → 에이전트 요청이 Matter 네트워크로 가고 구독으로 WS까지 온다 → 다른 컨트롤러용 페어링 창", async (ctx) => {
    const port = 20000 + Math.floor(Math.random() * 20000);
    const logs: string[] = [];
    const srv = await startServer({ env: env({ MATTER_TRANSPORT: "network", MATTER_PORT: String(port), MATTER_COMMISSION_TIMEOUT_MS: "60000" }), log: (m) => logs.push(m) });
    try {
      if (srv.transport !== "network") ctx.skip(`이 PC에서 network 커미셔닝 불가 → ${srv.warnings.join(" / ")}`);
      const info = (srv.hub as MatterHub).info;
      expect(info).toMatchObject({ transport: "network", commissioning: "new", subscribed: true });
      expect(logs.join("\n")).toMatch(/커미셔닝 완료/);

      const events = await listenEvents(srv.url);
      try {
        await events.waitFor((m) => m.type === "hello");
        const before = events.messages.length;
        const tv = await api(srv.url, "/api/agent/chat", { message: "거실 TV 켜줘", sessionId: "e2e-net" });
        expect(tv.json.actions).toContainEqual(expect.objectContaining({ tool: "turn_on", ok: true }));
        expect(bridge(srv, "tv_living").onOff!.onOff).toBe(true);
        const both = await api(srv.url, "/api/agent/chat", { message: "거실 불 켜고 TV 꺼줘", sessionId: "e2e-net" });
        expect(both.status).toBe(200);
        expect(bridge(srv, "tv_living").onOff!.onOff).toBe(false);
        expect(bridge(srv, "light_living").onOff!.onOff).toBe(true);
        await events.waitFor((m) => events.messages.indexOf(m) >= before && m.type === "state" && m.state.id === "light_living" && m.state.matter.onOff === true);

        // 브리지 쪽(기기)에서 직접 바뀐 값도 컨트롤러 구독 → 허브 → WS로 온다(실제 기기의 버튼을 누른 것과 같음)
        await (srv.hub as MatterHub).bridgeEndpoint("lamp_living")!.setStateOf("onOff", { onOff: true });
        await events.waitFor((m) => m.type === "state" && m.state.id === "lamp_living" && m.state.twin.power === "on", 10_000);

        const unlock = await api(srv.url, "/api/agent/chat", { message: "현관문 열어줘", sessionId: "e2e-net" });
        expect(unlock.json.pendingConfirmations).toHaveLength(1);
        expect(bridge(srv, "door_main").doorLock!.lockState).toBe(LOCKED);
        const confirmed = await api(srv.url, "/api/agent/confirm", { token: unlock.json.pendingConfirmations[0].token });
        expect(confirmed.json.ok).toBe(true);
        expect(bridge(srv, "door_main").doorLock!.lockState).toBe(UNLOCKED);
      } finally {
        events.close();
      }

      const mcp = await mcpClient(srv.url);
      try {
        const r = await mcp.call("turn_on", { device_id: "light_kitchen" });
        expect(r.json.ok).toBe(true);
        expect(bridge(srv, "light_kitchen").onOff!.onOff).toBe(true);
      } finally {
        await mcp.close();
      }

      const win = await api(srv.url, "/api/matter/commissioning-window", { timeoutSeconds: 180 });
      expect(win.status).toBe(200);
      expect(win.json.pairing.manualPairingCode).toMatch(/^\d{11}$/);
      const root = (srv.hub as MatterHub).bridgeNode!.state as unknown as { administratorCommissioning: { windowStatus: number } };
      expect(root.administratorCommissioning.windowStatus).not.toBe(0);
    } finally {
      await srv.close();
    }
  }, 180_000);

  it("커미셔닝이 제한 시간 안에 안 되면 local 전송으로 대신 뜬다(경고 한 줄)", async () => {
    const logs: string[] = [];
    const srv = await startServer({
      env: env({ MATTER_TRANSPORT: "network", MATTER_PORT: String(20000 + Math.floor(Math.random() * 20000)), MATTER_COMMISSION_TIMEOUT_MS: "1" }),
      log: (m) => logs.push(m),
    });
    try {
      expect(srv.hubKind).toBe("matter");
      expect(srv.transport).toBe("local");
      expect(srv.warnings).toHaveLength(1);
      expect(logs.join("\n")).toMatch(/\[경고\] Matter network 전송을 시작하지 못했습니다\(.*\)\. local 전송으로 바꿉니다/);
      expect((await api(srv.url, "/api/health")).json.transport).toBe("local");
      const r = await api(srv.url, "/api/agent/chat", { message: "거실 TV 켜줘", sessionId: "e2e-fallback" });
      expect(r.json.actions).toContainEqual(expect.objectContaining({ tool: "turn_on", ok: true }));
      expect(bridge(srv, "tv_living").onOff!.onOff).toBe(true);
    } finally {
      await srv.close();
    }
  }, 120_000);
});
