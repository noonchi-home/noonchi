// TV 중계(src/devices/relay): 지훈 님 tvrelay HTTP를 가짜 서버로 띄워 읽기·명령·「모름」·끊김·409·401과 신호 출처 허브(relay)를 본다.
// 원본: noonchi-home/experiment jihoon/2026-11-24_lg-tv-infrared-relay(code/noonchi-relay/feat-tv-relay.diff)의 시험을 지금 main에 맞춰 옮겼다.
import { createServer, type IncomingMessage, type Server } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { MemoryHub } from "../src/devices/hub/memory.js";
import { SignalHub } from "../src/devices/hub/signals.js";
import { describeDevice } from "../src/devices/mapping.js";
import { RelayClient, relayConfig, type RelayConfig } from "../src/devices/relay/client.js";
import { RelayLink } from "../src/devices/relay/link.js";
import { HOUSEHOLD_KINDS } from "../src/devices/kinds.js";
import { listenRetry } from "../src/shared/net.js";
import type { DeviceSpec, DeviceState } from "../src/contract/devices.js";

const TOKEN = "relay_token_for_tests_only_8f3a";

interface FakeRelay {
  url: string;
  power: "on" | "off" | "unknown";
  /** 다음 명령의 답(없으면 power를 바꾸고 done). */
  reply: { status: number; body: Record<string, unknown> } | null;
  /** 다음 읽기의 답(없으면 power). */
  stateReply: { status: number; body: unknown } | null;
  requests: { method: string; path: string; auth?: string; body?: unknown }[];
  close(): Promise<void>;
}

async function startFakeRelay(): Promise<FakeRelay> {
  const fake: Partial<FakeRelay> = { power: "off", reply: null, stateReply: null, requests: [] };
  const read = (req: IncomingMessage) => new Promise<string>((ok) => {
    let s = "";
    req.on("data", (c) => (s += c));
    req.on("end", () => ok(s));
  });
  const server: Server = createServer(async (req, res) => {
    const raw = await read(req);
    const body = raw ? JSON.parse(raw) : undefined;
    fake.requests!.push({ method: req.method!, path: req.url!, auth: req.headers.authorization, body });
    const send = (status: number, obj: unknown) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(obj));
    };
    // 틀린 토큰이면 받은 머리를 그대로 되돌려 주는 중계: 클라이언트가 이 글을 어디에도 옮기지 않아야 한다
    if (req.headers.authorization !== `Bearer ${TOKEN}`) return send(401, { error: `bad token: ${req.headers.authorization}` });
    if (req.method === "GET" && req.url === "/api/devices/tv") {
      if (fake.stateReply) {
        const r = fake.stateReply;
        fake.stateReply = null;
        return send(r.status, r.body);
      }
      return send(200, { power: fake.power, since: "2026-11-23T10:00:00", online: true, ir: true });
    }
    if (req.method === "POST" && req.url === "/api/devices/tv/command") {
      if (fake.reply) {
        const r = fake.reply;
        fake.reply = null;
        return send(r.status, r.body);
      }
      fake.power = body.type;
      return send(200, { ok: true, outcome: "done", power: fake.power });
    }
    send(404, { error: "none" });
  });
  fake.url = `http://127.0.0.1:${(await listenRetry(server, 0, "127.0.0.1")).port}`;
  fake.close = () => new Promise((ok) => server.close(() => ok()));
  return fake as FakeRelay;
}

function spec(id: string, label: string, twinType: string, twinAttrs: Record<string, unknown[]>): DeviceSpec {
  return { id, label, room: "r", roomLabel: "거실", twinType, twinAttrs, ...describeDevice(twinType, twinAttrs)! };
}
const tv = spec("tv_living", "거실 TV", "tv", { power: ["off", "on"] });

let fake: FakeRelay | undefined;
let link: RelayLink | undefined;
afterEach(async () => {
  link?.stop();
  link = undefined;
  await fake?.close();
  fake = undefined;
});

function config(url: string, extra: Record<string, string> = {}): RelayConfig {
  const c = relayConfig({ TV_RELAY_URL: url, TV_RELAY_TOKEN: TOKEN, TV_RELAY_DEVICE: "tv_living", TV_RELAY_COMMAND_TIMEOUT_MS: "2000", ...extra });
  if (!c.ok) throw new Error(c.error);
  return c.config;
}

async function setup() {
  fake = await startFakeRelay();
  const world = new MemoryHub([tv]);
  const logs: string[] = [];
  const updates: string[] = [];
  link = new RelayLink({ client: new RelayClient(config(fake.url)), world, pairs: { tv_living: "tv" }, log: (l) => logs.push(l), pollMs: 0 });
  link.onUpdate((id) => updates.push(id));
  return { world, logs, updates, link, fake };
}

describe("relayConfig", () => {
  it("주소가 없으면 쓰지 않고, 주소가 있는데 토큰·기기가 없거나 주소가 틀리면 까닭을 준다", () => {
    expect(relayConfig({})).toMatchObject({ ok: false, off: true });
    expect(relayConfig({ TV_RELAY_URL: "http://100.64.0.2:8530" })).toMatchObject({ ok: false, off: false, error: expect.stringContaining("TV_RELAY_TOKEN") });
    expect(relayConfig({ TV_RELAY_URL: "ftp://x", TV_RELAY_TOKEN: "t" })).toMatchObject({ ok: false, off: false });
    expect(relayConfig({ TV_RELAY_URL: "http://127.0.0.1:8530", TV_RELAY_TOKEN: "t" })).toMatchObject({ ok: false, off: false, error: expect.stringContaining("TV_RELAY_DEVICE") });
    const c = relayConfig({ TV_RELAY_URL: "http://100.64.0.2:8530/", TV_RELAY_TOKEN: "t", TV_RELAY_DEVICE: "tv_living" });
    expect(c).toMatchObject({ ok: true, config: { baseUrl: "http://100.64.0.2:8530", target: "tv", deviceId: "tv_living" } });
  });

  it("https이거나 루프백·Tailscale(100.64.0.0/10)·*.ts.net 주소만 받는다(와이파이 http는 거절)", () => {
    const at = (url: string) => relayConfig({ TV_RELAY_URL: url, TV_RELAY_TOKEN: "t", TV_RELAY_DEVICE: "tv_living" });
    for (const url of ["https://relay.example.com", "https://192.168.0.5:8530", "http://127.0.0.1:8530", "http://localhost:8530", "http://[::1]:8530",
      "http://100.64.0.1:8530", "http://100.127.255.254:8530", "http://jihoon-mac.tail1234.ts.net:8530"]) expect(at(url), url).toMatchObject({ ok: true });
    for (const url of ["http://192.168.0.5:8530", "http://10.0.0.5:8530", "http://100.128.0.1:8530", "http://100.63.255.255:8530",
      "http://relay.example.com:8530", "http://ts.net.example.com:8530"]) {
      const r = at(url);
      expect(r, url).toMatchObject({ ok: false, off: false });
      expect(!r.ok && r.error, url).toMatch(/https.*Tailscale/);
    }
  });

  it("주소에 아이디·비밀번호를 넣으면 거절하고, 오류 글에 그 값을 옮기지 않는다", () => {
    const r = relayConfig({ TV_RELAY_URL: "https://me:secret-pass@relay.example.com", TV_RELAY_TOKEN: "t", TV_RELAY_DEVICE: "tv_living" });
    expect(r).toMatchObject({ ok: false, off: false });
    expect(JSON.stringify(r)).not.toContain("secret-pass");
  });
});

describe("RelayLink 읽기", () => {
  it("처음 읽기로 트윈이 실제 값이 되고, 출처·기기 이름·시각을 남긴다", async () => {
    const { world, updates, link, fake } = await setup();
    fake.power = "on";
    expect(link.readback("tv_living")).toBeUndefined();
    await link.start();
    expect(world.get("tv_living")!.matter.onOff).toBe(true);
    expect(link.readback("tv_living")).toEqual({ source: "relay", deviceId: "tv", at: expect.stringMatching(/^\d{4}-/) });
    expect(updates).toEqual(["tv_living"]);
    expect(fake.requests[0]).toMatchObject({ method: "GET", auth: `Bearer ${TOKEN}` });
  });

  it("리모컨으로 켜면 다음 읽기에서 트윈 TV도 켜진다(시나리오 6단계)", async () => {
    const { world, link, fake } = await setup();
    await link.start();
    expect(world.get("tv_living")!.matter.onOff).toBe(false);
    fake.power = "on";
    await link.refresh("tv_living");
    expect(world.get("tv_living")!.matter.onOff).toBe(true);
  });

  it("중계가 모른다고 하면 읽은 값을 지운다(모름)", async () => {
    const { link, fake, updates } = await setup();
    await link.start();
    fake.power = "unknown";
    expect(await link.refresh("tv_living")).toMatchObject({ power: "unknown" });
    expect(link.readback("tv_living")).toBeUndefined();
    expect(updates).toEqual(["tv_living", "tv_living"]);
  });

  it("중계가 꺼져 있으면 읽기 실패를 한 번만 경고한다", async () => {
    const world = new MemoryHub([tv]);
    const logs: string[] = [];
    link = new RelayLink({ client: new RelayClient(config("http://127.0.0.1:9")), world, pairs: { tv_living: "tv" }, log: (l) => logs.push(l), pollMs: 0 });
    await link.start();
    await link.refresh("tv_living");
    expect(logs.filter((l) => l.includes("읽지 못했어요"))).toHaveLength(1);
    expect(link.readback("tv_living")).toBeUndefined();
  });
});

describe("RelayLink 명령", () => {
  it("켜기: 중계가 확인하면 완료, 트윈에 비추고 실행 기록을 남긴다", async () => {
    const { world, link, fake } = await setup();
    await link.start();
    const r = await link.command("tv_living", { type: "on" });
    expect(r).toMatchObject({ ok: true, outcome: "done", execution: { route: "relay", target: "tv" } });
    expect(fake.requests.find((q) => q.method === "POST")?.body).toEqual({ type: "on" });
    expect(world.get("tv_living")!.matter.onOff).toBe(true);
  });

  it("쏘았지만 확인 못 하면 「확인 안 됨」(ok), 쏘지 못했거나 보내지 않았으면 실패", async () => {
    const { link, fake } = await setup();
    await link.start();
    fake.reply = { status: 200, body: { ok: true, outcome: "unverified", power: "off" } };
    expect(await link.command("tv_living", { type: "on" })).toMatchObject({ ok: true, outcome: "unverified" });
    fake.reply = { status: 200, body: { ok: false, outcome: "failed", error: "적외선을 쏘지 못했어요" } };
    expect(await link.command("tv_living", { type: "on" })).toMatchObject({ ok: false, outcome: "failed", error: expect.stringContaining("쏘지 못했") });
    fake.reply = { status: 200, body: { ok: false, outcome: "not_sent", error: "아두이노가 연결돼 있지 않아요" } };
    expect(await link.command("tv_living", { type: "on" })).toMatchObject({ ok: false, outcome: "not_sent", error: expect.stringContaining("아두이노") });
  });

  it("중계가 앞 명령 중(409)이라고 하면 보내지 않은 실패다", async () => {
    const { link, fake } = await setup();
    await link.start();
    fake.reply = { status: 409, body: { ok: false, outcome: "not_sent", error: "앞 명령을 처리하는 중이에요" } };
    expect(await link.command("tv_living", { type: "on" })).toMatchObject({ ok: false, outcome: "not_sent", error: expect.stringContaining("앞 명령") });
  });

  it("켜기·끄기 말고는 보내지 않고, 이쪽에서 앞 명령 중이면 거절한다", async () => {
    const { link, fake } = await setup();
    await link.start();
    expect(await link.command("tv_living", { type: "level", percent: 10 })).toMatchObject({ ok: false, outcome: "not_sent" });
    const first = link.command("tv_living", { type: "on" });
    expect(await link.command("tv_living", { type: "off" })).toMatchObject({ ok: false, outcome: "not_sent", error: expect.stringContaining("앞 명령") });
    await first;
    expect(fake.requests.filter((q) => q.method === "POST")).toHaveLength(1);
  });

  it("중계에 닿지 않으면 실패로 돌려준다", async () => {
    const world = new MemoryHub([tv]);
    link = new RelayLink({ client: new RelayClient(config("http://127.0.0.1:9")), world, pairs: { tv_living: "tv" }, pollMs: 0 });
    expect(await link.command("tv_living", { type: "on" })).toMatchObject({ ok: false, outcome: "failed", error: expect.stringContaining("응답이 없어") });
  });

  it("토큰이 틀리면(401) 실패이고, 중계가 되돌려 준 토큰은 오류 글·로그 어디에도 없다", async () => {
    fake = await startFakeRelay();
    const world = new MemoryHub([tv]);
    const logs: string[] = [];
    const wrong = "wrong_token_value_never_shown";
    const c = relayConfig({ TV_RELAY_URL: fake.url, TV_RELAY_TOKEN: wrong, TV_RELAY_DEVICE: "tv_living" });
    if (!c.ok) throw new Error(c.error);
    link = new RelayLink({ client: new RelayClient(c.config), world, pairs: { tv_living: "tv" }, log: (l) => logs.push(l), pollMs: 0 });
    await link.start();
    const r = await link.command("tv_living", { type: "on" });
    expect(r).toMatchObject({ ok: false, outcome: "failed", error: expect.stringContaining("401") });
    expect(fake.requests.at(-1)?.auth).toBe(`Bearer ${wrong}`);
    expect(JSON.stringify(r) + logs.join("\n")).not.toContain(wrong);
  });

  it("중계 답에 토큰이 섞여 와도 결과·로그에 옮기지 않는다", async () => {
    const { link, fake, logs } = await setup();
    await link.start();
    fake.reply = { status: 200, body: { ok: false, outcome: "failed", error: `relay saw ${TOKEN}` } };
    const r = await link.command("tv_living", { type: "on" });
    fake.stateReply = { status: 500, body: { error: `state ${TOKEN}` } };
    await link.refresh("tv_living");
    fake.stateReply = { status: 200, body: { weird: TOKEN } };
    await link.refresh("tv_living");
    expect(r).toMatchObject({ ok: false, outcome: "failed" });
    expect(JSON.stringify(r) + logs.join("\n")).not.toContain(TOKEN);
  });
});

describe("SignalHub relay 출처", () => {
  it("읽기 전에는 모름, 읽은 뒤 실제 상태와 readback, 명령은 중계로", async () => {
    const { world, link, fake } = await setup();
    const hub = new SignalHub(world, { tv_living: { kind: "relay", deviceId: "tv" } });
    const seen: DeviceState[] = [];
    hub.subscribe((s) => seen.push(s));
    expect(hub.get("tv_living")!.signal).toBe("none");
    hub.setRelay(link);
    fake.power = "on";
    await link.start();
    expect(hub.get("tv_living")).toMatchObject({ twin: { power: "on" }, readback: { source: "relay", deviceId: "tv" } });
    expect(seen.at(-1)?.readback?.source).toBe("relay");
    const r = await hub.command("tv_living", { type: "off" });
    expect(r).toMatchObject({ ok: true, outcome: "done", state: { twin: { power: "off" } } });
    expect(fake.power).toBe("off");
    expect(await hub.setSensor("tv_living", "power", "on")).toMatchObject({ ok: false });
  });

  it("중계 연결이 없으면 보내지 않는다", async () => {
    const world = new MemoryHub([tv]);
    const hub = new SignalHub(world, { tv_living: { kind: "relay", deviceId: "tv" } });
    expect(await hub.command("tv_living", { type: "on" })).toMatchObject({ ok: false, outcome: "not_sent", error: expect.stringContaining("중계") });
  });

  it("devices 노드 규칙 그대로: 켜기 요청은 전원 의도를 내고, 확인된(done) 실행만 그 명령의 도장을 받는다", async () => {
    expect(tv.kind).toBe(HOUSEHOLD_KINDS.viewerPower);
    const { world, link, fake } = await setup();
    const hub = new SignalHub(world, { tv_living: { kind: "relay", deviceId: "tv" } });
    const intents: [string, string, string | null][] = [];
    hub.onPowerIntent = (id, power, commandId) => intents.push([id, power, commandId]);
    hub.subscribe(() => {});
    hub.setRelay(link);
    await link.start();
    expect(hub.powerStamp("tv_living")).toMatchObject({ power: "off" });
    expect(await hub.command("tv_living", { type: "on" }, "plan-1")).toMatchObject({ ok: true, outcome: "done" });
    expect(intents).toEqual([["tv_living", "on", "plan-1"]]);
    expect(hub.powerStamp("tv_living")).toMatchObject({ power: "on", command_id: "plan-1" });
    // 확인 못 한 실행은 그 명령의 결과로 도장을 찍지 않는다(실행 추적이 카메라 근거를 기다린다)
    fake.reply = { status: 200, body: { ok: true, outcome: "unverified", power: "on" } };
    expect(await hub.command("tv_living", { type: "off" }, "plan-2")).toMatchObject({ ok: true, outcome: "unverified" });
    expect(hub.powerStamp("tv_living")?.command_id).not.toBe("plan-2");
    // 리모컨으로 바뀐 전원은 명령 없는 변화로 세대가 바뀐다
    const before = hub.powerStamp("tv_living")!;
    fake.power = "off";
    await link.refresh("tv_living");
    expect(hub.powerStamp("tv_living")).toMatchObject({ power: "off", command_id: null, generation: before.generation + 1 });
  });
});
