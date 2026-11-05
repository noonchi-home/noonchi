// ThinQ 연결(src/thinq/link.ts): 짝지은 기기를 읽어 트윈에 비추고, 명령은 지금 상태 읽기 → 보내기 → 다시 읽기로 끝낸다.
// 받았지만 다시 읽은 값이 다르면 「확인 안 됨」, 거부면 실패, 못 읽으면 보내지 않는다. 기기마다 한 번에 한 단계.
import { afterEach, describe, expect, it } from "vitest";
import { MemoryHub } from "../src/hub/memory.js";
import { ThinqClient, thinqConfig } from "../src/thinq/client.js";
import { ThinqLink } from "../src/thinq/link.js";
import { homeDevices } from "./helpers/home.js";
import { FAKE_AC, FAKE_FRIDGE, startFakeThinq, type FakeThinq } from "./helpers/thinq.js";

const TOKEN = "thinq_pat_for_tests_only_5678";
let fake: FakeThinq | undefined;
let link: ThinqLink | undefined;
afterEach(async () => {
  link?.stop();
  link = undefined;
  await fake?.close();
  fake = undefined;
});

async function setup(opts: { env?: Record<string, string>; pollMs?: number; readbackMs?: number[] } = {}) {
  fake = await startFakeThinq();
  const cfg = thinqConfig({ THINQ_TOKEN: TOKEN, THINQ_BASE_URL: fake.url, ...opts.env });
  if (!cfg.ok) throw new Error(cfg.error);
  const world = MemoryHub.fromTwin({ devices: homeDevices(), initial: {} });
  const logs: string[] = [];
  const updates: string[] = [];
  link = new ThinqLink({
    client: new ThinqClient(cfg.config), world, pairs: { ac_living: FAKE_AC, fridge_1: FAKE_FRIDGE },
    log: (l) => logs.push(l), pollMs: opts.pollMs ?? 0, readbackMs: opts.readbackMs ?? [0, 5],
  });
  link.onUpdate((id) => updates.push(id));
  return { world, logs, updates, link, fake };
}

const setpoint = (world: MemoryHub) => world.get("ac_living")!.matter.setpointC;
const tempC = (f: FakeThinq) => (f.states[FAKE_AC]!.temperatureInUnits as { unit: string; targetTemperature: number }[]).find((e) => e.unit === "C")!;

describe("ThinqLink 읽기", () => {
  it("처음 읽기로 트윈이 실제 값이 되고, 출처·ThinQ id·시각을 남긴다", async () => {
    const { world, updates, link, fake } = await setup();
    expect(link.readback("ac_living")).toBeUndefined();
    await link.start();
    expect(world.get("ac_living")!.matter).toMatchObject({ onOff: true, setpointC: 24, systemMode: "cool", fanMode: "auto" });
    expect(link.readback("ac_living")).toEqual({ source: "thinq", deviceId: FAKE_AC, at: expect.stringMatching(/^\d{4}-\d\d-\d\dT/) });
    expect(world.get("fridge_1")!.twin.door).toBe("closed");
    expect(updates.sort()).toEqual(["ac_living", "fridge_1"]);
    expect(fake.requests.every((r) => r.method === "GET")).toBe(true);
    expect(link.handles("ac_living")).toBe(true);
    expect(link.handles("tv_living")).toBe(false);
  });

  it("냉장고 문이 열리면 다음 읽기에서 트윈 문도 열린다", async () => {
    const { world, link, fake } = await setup();
    await link.start();
    fake.states[FAKE_FRIDGE] = { doorStatus: [{ locationName: "MAIN", doorState: "OPEN" }] };
    expect(await link.refresh("fridge_1")).toEqual({ door: "open" });
    expect(world.get("fridge_1")!.twin.door).toBe("open");
  });

  it("주기 읽기는 stop() 뒤 멈춘다", async () => {
    const { link, fake } = await setup({ pollMs: 15 });
    await link.start();
    await new Promise((r) => setTimeout(r, 80));
    const reads = fake.requests.length;
    expect(reads).toBeGreaterThan(2);
    link.stop();
    await new Promise((r) => setTimeout(r, 60));
    expect(fake.requests.length).toBeLessThanOrEqual(reads + 2);
  });
});

describe("ThinqLink 명령", () => {
  it("온도: 지금 상태 읽기 → 보냄 → 다시 읽어 같으면 완료, 트윈에 비춘다", async () => {
    const { world, link, fake } = await setup();
    await link.start();
    fake.requests.length = 0;
    const r = await link.command("ac_living", { type: "climate", setpointC: 26 });
    expect(r).toMatchObject({ ok: true, outcome: "done", execution: { route: "thinq", target: FAKE_AC } });
    expect(setpoint(world)).toBe(26);
    expect(r.state?.matter.setpointC).toBe(26);
    expect(fake.requests.map((q) => `${q.method} ${q.path}`)).toEqual([
      `GET devices/${FAKE_AC}/state`, `POST devices/${FAKE_AC}/control`, `GET devices/${FAKE_AC}/state`,
    ]);
    expect(fake.controls()[0]!.body).toEqual({ temperatureInUnits: { targetTemperature: 26, unit: "C" } });
  });

  it("받기만 하고 바뀌지 않으면 확인 안 됨, 트윈은 다시 읽은 값", async () => {
    const { world, link, fake } = await setup();
    fake.behavior[FAKE_AC] = "ignore";
    const r = await link.command("ac_living", { type: "climate", setpointC: 26 });
    expect(r).toMatchObject({ ok: true, outcome: "unverified" });
    expect(setpoint(world)).toBe(24);
    expect(fake.controls()).toHaveLength(1);
  });

  it("거부하면 실패, 트윈은 그대로", async () => {
    const { world, link, fake } = await setup();
    fake.behavior[FAKE_AC] = "reject";
    const r = await link.command("ac_living", { type: "climate", setpointC: 26 });
    expect(r).toMatchObject({ ok: false, outcome: "failed" });
    expect(r.error).toMatch(/거부/);
    expect(setpoint(world)).toBe(24);
  });

  it("지금 상태를 못 읽으면 보내지 않는다", async () => {
    const { link, fake } = await setup();
    fake.behavior[FAKE_AC] = "fail-read";
    const r = await link.command("ac_living", { type: "climate", setpointC: 26 });
    expect(r).toMatchObject({ ok: false, outcome: "not_sent" });
    expect(r.error).toMatch(/지금 상태를 읽지 못해/);
    expect(fake.controls()).toHaveLength(0);
  });

  it("이미 목표 값이면 보내지 않고 완료", async () => {
    const { link, fake } = await setup();
    const r = await link.command("ac_living", { type: "climate", setpointC: 24 });
    expect(r).toMatchObject({ ok: true, outcome: "done" });
    expect(fake.controls()).toHaveLength(0);
  });

  it("꺼진 에어컨에 온도: 켜기를 보내 확인한 뒤 온도를 보낸다", async () => {
    const { world, link, fake } = await setup();
    fake.states[FAKE_AC]!.operation = { airConOperationMode: "POWER_OFF" };
    const r = await link.command("ac_living", { type: "climate", setpointC: 26 });
    expect(r).toMatchObject({ ok: true, outcome: "done" });
    expect(fake.controls().map((q) => q.body)).toEqual([
      { operation: { airConOperationMode: "POWER_ON" } },
      { temperatureInUnits: { targetTemperature: 26, unit: "C" } },
    ]);
    expect(world.get("ac_living")!.matter).toMatchObject({ onOff: true, setpointC: 26 });
  });

  it("켜기가 확인되지 않으면 온도는 보내지 않는다", async () => {
    const { link, fake } = await setup();
    fake.states[FAKE_AC]!.operation = { airConOperationMode: "POWER_OFF" };
    fake.behavior[FAKE_AC] = "ignore";
    const r = await link.command("ac_living", { type: "climate", setpointC: 26 });
    expect(r.outcome).toBe("unverified");
    expect(fake.controls()).toHaveLength(1);
  });

  it("같은 기기에 겹친 명령은 거절한다(한 번에 한 단계)", async () => {
    const { world, link, fake } = await setup();
    fake.controlDelayMs = 40;
    const first = link.command("ac_living", { type: "climate", setpointC: 26 });
    await new Promise((r) => setTimeout(r, 10));
    const second = await link.command("ac_living", { type: "climate", setpointC: 27 });
    expect(second).toMatchObject({ ok: false, outcome: "not_sent" });
    expect(second.error).toMatch(/앞 명령/);
    expect(await first).toMatchObject({ ok: true, outcome: "done" });
    expect(fake.controls()).toHaveLength(1);
    expect(setpoint(world)).toBe(26);
    // 끝난 뒤에는 다시 받는다
    expect(await link.command("ac_living", { type: "climate", setpointC: 27 })).toMatchObject({ ok: true, outcome: "done" });
  });

  it("응답이 없어도 다시 읽어 같으면 완료", async () => {
    const { link, fake } = await setup({ env: { THINQ_TIMEOUT_MS: "30" }, readbackMs: [150] });
    fake.controlDelayMs = 80;
    const r = await link.command("ac_living", { type: "climate", setpointC: 26 });
    expect(r).toMatchObject({ ok: true, outcome: "done" });
    expect(tempC(fake).targetTemperature).toBe(26);
  });

  it("ThinQ로 보낼 수 없는 명령·짝 없는 기기는 보내지 않는다", async () => {
    const { link, fake } = await setup();
    expect(await link.command("fridge_1", { type: "on" })).toMatchObject({ ok: false, outcome: "not_sent" });
    expect((await link.command("tv_living", { type: "on" })).ok).toBe(false);
    expect(fake.controls()).toHaveLength(0);
  });

  it("로그에 토큰이 없다", async () => {
    const { link, logs, fake } = await setup();
    fake.behavior[FAKE_AC] = "reject";
    fake.rejectMessage = `bad ${TOKEN}`;
    await link.command("ac_living", { type: "climate", setpointC: 26 });
    fake.behavior[FAKE_AC] = "fail-read";
    await link.refresh("ac_living");
    expect(logs.length).toBeGreaterThan(0);
    expect(logs.join("\n")).not.toContain(TOKEN);
  });
});
