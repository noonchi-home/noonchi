// 서버 시작에서 TV 중계 잇기: TV_RELAY_URL·TV_RELAY_TOKEN·TV_RELAY_DEVICE를 주면 실제 모드에서 그 TV를 relay 출처로 짝짓고,
// 첫 읽기로 상태를 받고, 리모컨으로 켠 것도 읽고, 기기 명령이 중계로 간다. 시험 모드에서는 트윈 그대로다.
// 지훈 님 tvrelay는 띄우지 않고 가짜 중계 HTTP 서버로 돈다. 실제 twin-studio 집(oneroom, TV tv_1)으로 돈다.
import { createServer, type Server } from "node:http";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { fetchRetry, listenRetry } from "../src/shared/net.js";
import { startServer, type RunningServer, type StartServerOptions } from "../src/server/start.js";
import { fakeBoard } from "../src/devices/hub/ir-fake.js";
import { openWebSocket } from "./helpers/ws.js";

const TOKEN = "relay_token_for_tests_only_5c1e";
let srv: RunningServer | undefined;
let relay: Server | undefined;
const dirs: string[] = [];
afterEach(async () => {
  await srv?.close();
  srv = undefined;
  await new Promise<void>((ok) => (relay ? relay.close(() => ok()) : ok()));
  relay = undefined;
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

/** 가짜 tvrelay. leak이면 모든 답의 error에 받은 토큰을 섞어 돌려준다(서버가 옮기지 않아야 한다). */
async function fakeRelay(opts: { leak?: boolean } = {}) {
  const state = { power: "on" as "on" | "off", commands: [] as string[], busy: false, gets: 0 };
  const noise = (auth: string | undefined) => (opts.leak ? { error: `relay saw ${auth}` } : {});
  relay = createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      res.setHeader("content-type", "application/json");
      const auth = req.headers.authorization;
      if (auth !== `Bearer ${TOKEN}`) return res.writeHead(401).end(JSON.stringify({ error: "token" }));
      if (req.method === "GET" && req.url === "/api/devices/tv") state.gets++;
      if (req.method === "GET" && req.url === "/api/devices/tv") return res.end(JSON.stringify({ power: state.power, online: true, ...noise(auth) }));
      if (req.method === "POST" && req.url === "/api/devices/tv/command") {
        if (state.busy) return res.writeHead(409).end(JSON.stringify({ ok: false, outcome: "not_sent", power: state.power, ...noise(auth) }));
        const { type } = JSON.parse(raw) as { type: "on" | "off" };
        state.commands.push(type);
        state.power = type;
        return res.end(JSON.stringify({ ok: true, outcome: "done", power: type }));
      }
      res.writeHead(404).end("{}");
    });
  });
  return { url: `http://127.0.0.1:${(await listenRetry(relay, 0, "127.0.0.1")).port}`, state };
}

const runtime = () => {
  const dir = mkdtempSync(join(tmpdir(), "relay-server-"));
  dirs.push(dir);
  return dir;
};

async function start(extra: Record<string, string>, logs: string[] = [], dir = runtime(), persistSetup = false) {
  srv = await startServer({ env: { HUB: "memory", PORT: "0", HOME_ID: "oneroom", RUNTIME_DIR: dir, ...extra }, log: (l) => logs.push(l), persistSetup });
  return srv;
}

/** npm start처럼 RUNTIME_DIR에 저장한 설정(고른 집·모드)이 있는 폴더. */
const savedRuntime = (setup: { home: string; mode: "test" | "live" }) => {
  const dir = runtime();
  writeFileSync(join(dir, "setup.json"), JSON.stringify({ version: 1, done: true, ...setup }));
  return dir;
};

const api = async (path: string, body?: unknown) => {
  const r = await fetchRetry(`${srv!.url}${path}`, body === undefined ? {} : { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  return { status: r.status, text: await r.text() };
};
const json = (r: { text: string }) => JSON.parse(r.text) as Record<string, any>;
const live = () => api("/api/setup/mode", { mode: "live", confirm: true });

/** 시작하면 안 되는 설정의 오류 글. 그래도 떴으면 닫고 실패로 본다. */
async function refusal(extra: Record<string, string>, dir = runtime(), persistSetup = false, ir: Pick<StartServerOptions, "irPort" | "irPorts"> = {}): Promise<string> {
  const message = await startServer({ env: { HUB: "memory", PORT: "0", HOME_ID: "oneroom", RUNTIME_DIR: dir, ...extra }, log: () => {}, persistSetup, ...ir }).then(
    async (s) => { await s.close(); return null; },
    (e: Error) => e.message,
  );
  if (message === null) throw new Error(`서버가 ${JSON.stringify(extra)}로 시작했다`);
  return message;
}

const PNP = "USB\\VID_1A86&PID_7523\\6&34F2BBB7&0&2";
/** oneroom tv_1에 전원(toggle) 단추가 있는 remotes.json. */
const tvRemote = (dir: string) => {
  mkdirSync(join(dir, "homes", "oneroom"), { recursive: true });
  writeFileSync(join(dir, "homes", "oneroom", "remotes.json"), JSON.stringify({ version: 1, port: { name: "COM7", pnp: PNP }, remotes: [{ id: "r_0000000a", label: "TV", device: "tv_1", buttons: [
    { id: "b_00000008", label: "전원", role: "toggle", signal: { kind: "nec", address: 4, command: 8 }, learned_at: "2026-11-27T10:00:00.000Z" },
  ] }] }));
};
/** 실제 포트를 열지 않게 가짜 보드와 고정 포트 목록. */
const fakeIr = (): Pick<StartServerOptions, "irPort" | "irPorts"> => ({ irPort: fakeBoard().port, irPorts: async () => [{ name: "COM7", label: "USB-SERIAL CH340", pnp: PNP, usb: true }] });

describe("서버 시작: TV 중계", () => {
  it("실제 모드에서 TV를 relay로 짝지어 상태를 읽고, 명령은 중계로 보내고, 리모컨으로 켠 것도 비춘다", async () => {
    const fake = await fakeRelay();
    await start({ TV_RELAY_URL: fake.url, TV_RELAY_TOKEN: TOKEN, TV_RELAY_DEVICE: "tv_1", TV_RELAY_POLL_MS: "50" });
    // 시험 모드: 트윈 그대로, 실제 모드는 고를 수 있다(이 집에 중계 TV가 있음)
    expect(srv!.signals.source("tv_1")).toEqual({ kind: "virtual" });
    expect(json(await api("/api/setup"))).toMatchObject({ mode: "test", ir: { ready: true }, thinq: { ready: false } });
    expect((await live()).status).toBe(200);
    expect(srv!.signals.source("tv_1")).toEqual({ kind: "relay", deviceId: "tv" });
    await expect.poll(() => srv!.signals.get("tv_1")?.readback?.source).toBe("relay");
    expect(srv!.signals.get("tv_1")?.twin.power).toBe("on");
    const off = await api("/api/devices/tv_1/command", { command: { type: "off" } });
    expect(off.status).toBe(200);
    expect(json(off)).toMatchObject({ ok: true, outcome: "done", execution: { route: "relay", target: "tv" }, state: { twin: { power: "off" } } });
    expect(fake.state.commands).toEqual(["off"]);
    fake.state.power = "on"; // 사람이 리모컨으로 켰다
    await expect.poll(() => srv!.signals.get("tv_1")?.twin.power).toBe("on");
    // 중계가 앞 명령 중(409)이면 보내지 않은 실패
    fake.state.busy = true;
    const busy = await api("/api/devices/tv_1/command", { command: { type: "off" } });
    expect(json(busy)).toMatchObject({ ok: false, outcome: "not_sent" });
    fake.state.busy = false;
    // 시험 모드로 돌아가면 다시 트윈
    expect((await api("/api/setup/mode", { mode: "test" })).status).toBe(200);
    expect(srv!.signals.source("tv_1")).toEqual({ kind: "virtual" });
  });

  it("중계가 끊기면 명령은 실패이고 서버는 그대로 돈다", async () => {
    const fake = await fakeRelay();
    await start({ TV_RELAY_URL: fake.url, TV_RELAY_TOKEN: TOKEN, TV_RELAY_DEVICE: "tv_1", TV_RELAY_POLL_MS: "0" });
    await live();
    await expect.poll(() => srv!.signals.get("tv_1")?.readback?.source).toBe("relay");
    await new Promise<void>((ok) => relay!.close(() => ok()));
    relay = undefined;
    const r = await api("/api/devices/tv_1/command", { command: { type: "off" } });
    expect(json(r)).toMatchObject({ ok: false, outcome: "failed" });
    expect(json(await api("/api/health")).ok).toBe(true);
  });

  it("설정이 없으면 TV는 트윈 그대로이고 실제 모드는 고를 수 없다", async () => {
    await start({});
    expect(srv!.signals.source("tv_1")).toEqual({ kind: "virtual" });
    expect(json(await api("/api/setup"))).toMatchObject({ ir: { ready: false }, thinq: { ready: false } });
    expect((await live()).status).toBe(400);
  });

  it("주소가 있는데 토큰·기기가 없거나, 주소 없이 토큰·기기만 있거나, 와이파이 http 주소면 시작하지 않는다", async () => {
    expect(await refusal({ TV_RELAY_URL: "http://127.0.0.1:9" })).toMatch(/TV_RELAY_TOKEN/);
    expect(await refusal({ TV_RELAY_TOKEN: TOKEN, TV_RELAY_DEVICE: "tv_1" })).toMatch(/TV_RELAY_URL/);
    expect(await refusal({ TV_RELAY_URL: "http://127.0.0.1:9", TV_RELAY_TOKEN: TOKEN })).toMatch(/TV_RELAY_DEVICE/);
    const lan = await refusal({ TV_RELAY_URL: "http://192.168.0.5:8530", TV_RELAY_TOKEN: TOKEN, TV_RELAY_DEVICE: "tv_1" });
    expect(lan).toMatch(/https.*Tailscale/);
    expect(lan).not.toContain(TOKEN);
  });

  it("같은 TV에 리모컨 전원 단추(remotes.json)와 중계가 둘 다 있으면 시작하지 않고 하나를 고르라고 한다", async () => {
    const dir = runtime();
    tvRemote(dir);
    const message = await refusal({ TV_RELAY_URL: "http://127.0.0.1:9", TV_RELAY_TOKEN: TOKEN, TV_RELAY_DEVICE: "tv_1" }, dir, false, fakeIr());
    expect(message).toMatch(/tv_1.*remotes\.json.*TV_RELAY/);
    expect(message).not.toContain(TOKEN);
  });

  it("저장한 집에서도 같은 TV의 리모컨 전원 단추와 중계가 겹치면 다른 집으로 넘어가지 않고 시작하지 않는다", async () => {
    const dir = savedRuntime({ home: "oneroom", mode: "test" });
    tvRemote(dir);
    const message = await refusal({ TV_RELAY_URL: "http://127.0.0.1:9", TV_RELAY_TOKEN: TOKEN, TV_RELAY_DEVICE: "tv_1", HOME_ID: "mokryeon_180b" }, dir, true, fakeIr());
    expect(message).toMatch(/tv_1.*remotes\.json.*TV_RELAY/);
  });

  it("중계 TV에는 설정 API가 리모컨 전원 단추(켜기·끄기·전원·LG 전원 묶음)를 받지 않고, 그 밖 단추는 배우며, 다시 켜도 시작한다", async () => {
    const dir = runtime();
    const env = { TV_RELAY_URL: "http://127.0.0.1:9", TV_RELAY_TOKEN: TOKEN, TV_RELAY_DEVICE: "tv_1", TV_RELAY_POLL_MS: "0" };
    srv = await startServer({ env: { HUB: "memory", PORT: "0", HOME_ID: "oneroom", RUNTIME_DIR: dir, ...env }, log: () => {}, ...fakeIr() });
    const remote = json(await api("/api/setup/ir/remote", { home: "oneroom", label: "TV", device: "tv_1" })).remotes[0].id as string;
    expect((await api("/api/setup/ir/port", { home: "oneroom", port: "COM7" })).status).toBe(200);
    await expect.poll(async () => json(await api("/api/setup/ir?home=oneroom")).port.state).toBe("connected");
    const refused = "이 TV는 TV 중계로 켜고 꺼요. 전원 단추는 넣을 수 없어요.";
    for (const role of ["on", "off", "toggle"]) {
      const r = await api("/api/setup/ir/learn", { home: "oneroom", remote, label: "전원", role });
      expect([role, r.status, json(r).error]).toEqual([role, 409, refused]);
    }
    const preset = await api("/api/setup/ir/preset", { home: "oneroom", remote, preset: "lg_tv_power" });
    expect([preset.status, json(preset).error]).toEqual([409, refused]);
    const other = await api("/api/setup/ir/learn", { home: "oneroom", remote, label: "음량 올림", role: null });
    expect([other.status, json(other).learning?.state]).toEqual([200, "waiting"]);
    await api("/api/setup/ir/learn/cancel", { home: "oneroom" });
    await srv.close();
    srv = undefined;
    srv = await startServer({ env: { HUB: "memory", PORT: "0", HOME_ID: "oneroom", RUNTIME_DIR: dir, ...env }, log: () => {}, ...fakeIr() });
    expect(json(await api("/api/setup/ir?home=oneroom")).remotes.map((r: { device: string; buttons: unknown[] }) => [r.device, r.buttons])).toEqual([["tv_1", []]]);
  });

  it("전원 단추가 있는 리모컨은 중계 TV로 옮기지 못하고, 전원 단추를 지우면 옮기며, 다시 켜도 시작한다", async () => {
    const dir = runtime();
    const at = "2026-11-27T10:00:00.000Z";
    mkdirSync(join(dir, "homes", "oneroom"), { recursive: true });
    writeFileSync(join(dir, "homes", "oneroom", "remotes.json"), JSON.stringify({ version: 1, port: null, remotes: [{ id: "r_000000ac", label: "에어컨", device: "ac_1", buttons: [
      { id: "b_000000a1", label: "켜기", role: "on", signal: { kind: "nec", address: 4, command: 1 }, learned_at: at },
      { id: "b_000000a2", label: "바람 세기", role: null, signal: { kind: "nec", address: 4, command: 2 }, learned_at: at },
    ] }] }));
    const env = { TV_RELAY_URL: "http://127.0.0.1:9", TV_RELAY_TOKEN: TOKEN, TV_RELAY_DEVICE: "tv_1", TV_RELAY_POLL_MS: "0" };
    srv = await startServer({ env: { HUB: "memory", PORT: "0", HOME_ID: "oneroom", RUNTIME_DIR: dir, ...env }, log: () => {}, ...fakeIr() });
    const move = { home: "oneroom", id: "r_000000ac", label: "TV", device: "tv_1" };
    const refused = await api("/api/setup/ir/remote", move);
    expect([refused.status, json(refused).error]).toEqual([409, "이 TV는 TV 중계로 켜고 꺼요. 전원 단추는 넣을 수 없어요."]);
    expect(json(await api("/api/setup/ir?home=oneroom")).remotes.map((r: { device: string }) => r.device)).toEqual(["ac_1"]);
    expect((await api("/api/setup/ir/button/delete", { home: "oneroom", remote: "r_000000ac", button: "b_000000a1" })).status).toBe(200);
    expect((await api("/api/setup/ir/remote", move)).status).toBe(200);
    await srv.close();
    srv = undefined;
    srv = await startServer({ env: { HUB: "memory", PORT: "0", HOME_ID: "oneroom", RUNTIME_DIR: dir, ...env }, log: () => {}, ...fakeIr() });
    expect(json(await api("/api/setup/ir?home=oneroom")).remotes.map((r: { device: string; buttons: { label: string }[] }) => [r.device, r.buttons.map((b) => b.label)]))
      .toEqual([["tv_1", ["바람 세기"]]]);
  });

  it("저장한 실제 모드는 중계 TV가 있는 집이면 그대로, 없는 집이면(리모컨·ThinQ도 없음) 시험 모드로 띄운다", async () => {
    const fake = await fakeRelay();
    await start({ TV_RELAY_URL: fake.url, TV_RELAY_TOKEN: TOKEN, TV_RELAY_DEVICE: "tv_1", TV_RELAY_POLL_MS: "0" }, [], savedRuntime({ home: "oneroom", mode: "live" }), true);
    expect(json(await api("/api/setup"))).toMatchObject({ mode: "live", ir: { ready: true } });
    expect(srv!.signals.source("tv_1")).toEqual({ kind: "relay", deviceId: "tv" });
    await srv!.close();
    srv = undefined;
    const logs: string[] = [];
    await start({ TV_RELAY_URL: fake.url, TV_RELAY_TOKEN: TOKEN, TV_RELAY_DEVICE: "tv_living", TV_RELAY_POLL_MS: "0" }, logs, savedRuntime({ home: "oneroom", mode: "live" }), true);
    expect(json(await api("/api/setup"))).toMatchObject({ mode: "test", ir: { ready: false } });
    expect(logs.some((l) => l.includes("시험 모드로 띄웁니다"))).toBe(true);
  });

  it("설정을 다시 저장해도 같은 중계 연결을 그대로 쓴다(새로 만들어 다시 읽지 않는다)", async () => {
    const fake = await fakeRelay();
    await start({ TV_RELAY_URL: fake.url, TV_RELAY_TOKEN: TOKEN, TV_RELAY_DEVICE: "tv_1", TV_RELAY_POLL_MS: "0" });
    await live();
    await expect.poll(() => srv!.signals.get("tv_1")?.readback?.source).toBe("relay");
    const gets = fake.state.gets;
    expect((await api("/api/setup/devices", { home: "oneroom", sources: {} })).status).toBe(200);
    expect((await api("/api/setup/devices", { home: "oneroom", sources: {} })).status).toBe(200);
    await new Promise((r) => setTimeout(r, 200));
    expect(fake.state.gets).toBe(gets);
    expect(srv!.signals.get("tv_1")?.readback?.source).toBe("relay");
  });

  it("TV_RELAY_DEVICE가 집에 없으면 경고하고 짝짓지 않는다", async () => {
    const fake = await fakeRelay();
    const logs: string[] = [];
    await start({ TV_RELAY_URL: fake.url, TV_RELAY_TOKEN: TOKEN, TV_RELAY_POLL_MS: "0", TV_RELAY_DEVICE: "tv_nowhere" }, logs);
    expect(logs.some((l) => l.includes("tv_nowhere"))).toBe(true);
    expect(json(await api("/api/setup")).ir).toEqual({ ready: false });
    expect(srv!.signals.source("tv_1")).toEqual({ kind: "virtual" });
  });

  it("토큰은 로그·/api 응답·대시보드 이벤트 어디에도 나오지 않는다(중계가 토큰을 섞어 돌려줘도)", async () => {
    const fake = await fakeRelay({ leak: true });
    const logs: string[] = [];
    await start({ TV_RELAY_URL: fake.url, TV_RELAY_TOKEN: TOKEN, TV_RELAY_DEVICE: "tv_1", TV_RELAY_POLL_MS: "50" }, logs);
    const events: string[] = [];
    const ws = await openWebSocket(`${srv!.url.replace(/^http/, "ws")}/events`);
    ws.on("message", (d) => events.push(String(d)));
    const seen = [await live()];
    await expect.poll(() => srv!.signals.get("tv_1")?.readback?.source).toBe("relay");
    seen.push(await api("/api/devices/tv_1/command", { command: { type: "off" } }));
    fake.state.busy = true;
    seen.push(await api("/api/devices/tv_1/command", { command: { type: "on" } }));
    fake.state.busy = false;
    for (const path of ["/api/setup", "/api/health", "/api/devices", "/api/devices/tv_1", "/api/history"]) seen.push(await api(path));
    ws.close();
    const everything = [...seen.map((r) => r.text), ...events, ...logs].join("\n");
    expect(fake.state.commands).toEqual(["off"]);
    expect(everything).toContain("tv_1");
    expect(everything).not.toContain(TOKEN);
  });
});
