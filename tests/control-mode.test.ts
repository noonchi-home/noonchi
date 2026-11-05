// 운영 모드(시험 · 실제): 설정 API, /api/health의 mode, 실제 모드에서 짝지은 에어컨·냉장고를 ThinQ로 다루기.
// 실제 ThinQ는 부르지 않는다. 가짜 ThinQ 서버(tests/helpers/thinq.ts)와 HUB=memory, mock 에이전트, 실제 twin-studio 집(oneroom)으로 돈다.

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { fetchRetry } from "../src/server/net.js";
import { startServer, type RunningServer } from "../src/server/start.js";
import { FAKE_AC, FAKE_FRIDGE, startFakeThinq, type FakeThinq } from "./helpers/thinq.js";

type Msg = Record<string, any>;
const TOKEN = "thinq_pat_for_tests_only_9012";
let srv: RunningServer | undefined;
let fake: FakeThinq | undefined;
const dirs: string[] = [];
afterEach(async () => {
  await srv?.close();
  srv = undefined;
  await fake?.close();
  fake = undefined;
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

const runtime = () => {
  const dir = mkdtempSync(join(tmpdir(), "control-mode-"));
  dirs.push(dir);
  return dir;
};

async function start(opts: { token?: boolean; runtimeDir?: string; persist?: boolean; logs?: string[] } = {}) {
  fake ??= await startFakeThinq();
  const env: Record<string, string> = {
    HUB: "memory", PORT: "0", AGENT_PROVIDER: "mock", HOME_ID: "oneroom", RUNTIME_DIR: opts.runtimeDir ?? runtime(),
    THINQ_BASE_URL: fake.url, THINQ_POLL_MS: "0", THINQ_READBACK_MS: "0,10",
  };
  if (opts.token !== false) env.THINQ_TOKEN = TOKEN;
  srv = await startServer({ env, log: (l) => opts.logs?.push(l), persistSetup: opts.persist ?? false });
  return srv;
}

const get = async (path: string) => {
  const r = await fetchRetry(`${srv!.url}${path}`);
  return { status: r.status, json: (await r.json()) as Msg };
};
const post = async (path: string, body: unknown = {}) => {
  const r = await fetchRetry(`${srv!.url}${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  return { status: r.status, json: (await r.json()) as Msg };
};
const home = () => srv!.twin.home.id;
const goLive = () => post("/api/setup/mode", { mode: "live", confirm: true });
const pair = (pairs: Record<string, string | null>) => post("/api/setup/pairs", { home: home(), pairs });
const setpoint = (c: number) => post("/api/devices/ac_1/command", { command: { type: "climate", setpointC: c } });
/** 실제 모드로 바꾸고 에어컨·냉장고를 짝지은 뒤 첫 읽기를 기다린다. */
async function livePaired() {
  expect((await goLive()).status).toBe(200);
  expect((await pair({ ac_1: FAKE_AC, fridge_1: FAKE_FRIDGE })).status).toBe(200);
  await waitFor(async () => (await get("/api/devices/ac_1")).json.state.readback !== undefined);
}
async function waitFor(pred: () => Promise<boolean>, ms = 3000) {
  const end = Date.now() + ms;
  while (!(await pred())) {
    if (Date.now() > end) throw new Error("기다리다 시간 초과");
    await new Promise((r) => setTimeout(r, 20));
  }
}

describe("시험 모드(기본)", () => {
  it("기본은 시험 모드: health·설정에 mode test, ThinQ를 한 번도 부르지 않는다", async () => {
    await start();
    expect((await get("/api/health")).json.mode).toBe("test");
    const setup = (await get("/api/setup")).json;
    expect(setup).toMatchObject({ mode: "test", thinq: { ready: true }, pairs: {} });
    expect(setup.devices.find((d: Msg) => d.id === "ac_1")).toMatchObject({ pairable: true, source: { kind: "virtual" } });
    expect(setup.devices.find((d: Msg) => d.id === "fridge_1").pairable).toBe(true);
    expect(setup.devices.filter((d: Msg) => d.pairable).map((d: Msg) => d.kind).sort()).toEqual(["aircon", "fridge"]);
    expect(srv!.mode).toBe("test");
    expect(fake!.requests).toEqual([]);
  });

  it("짝을 저장해 둬도 시험 모드 명령은 트윈에서 실행되고 ThinQ 요청은 0", async () => {
    await start();
    expect((await pair({ ac_1: FAKE_AC })).status).toBe(200);
    expect((await get("/api/setup")).json.pairs).toEqual({ ac_1: FAKE_AC });
    const r = await setpoint(26);
    expect(r.status).toBe(200);
    expect(r.json.state.matter.setpointC).toBe(26);
    expect(r.json.outcome).toBeUndefined();
    expect(fake!.requests).toEqual([]);
  });

  it("시험 모드에서 ThinQ 기기 목록은 409이고 ThinQ를 부르지 않는다", async () => {
    await start();
    expect((await get("/api/setup/thinq")).status).toBe(409);
    expect(fake!.requests).toEqual([]);
  });
});

describe("실제 모드로 바꾸기", () => {
  it("화면 확인(confirm: true)이 없으면 400, 모드 그대로", async () => {
    await start();
    const r = await post("/api/setup/mode", { mode: "live" });
    expect(r.status).toBe(400);
    expect((await get("/api/health")).json.mode).toBe("test");
    expect((await post("/api/setup/mode", { mode: "auto" })).status).toBe(400);
  });

  it("토큰이 없으면 400, 설정에 thinq.ready false, 모드 그대로", async () => {
    await start({ token: false });
    expect((await get("/api/setup")).json.thinq).toEqual({ ready: false });
    const r = await goLive();
    expect(r.status).toBe(400);
    expect(r.json.error).toMatch(/토큰/);
    expect((await get("/api/health")).json.mode).toBe("test");
  });

  it("바꾸면 health가 live, ThinQ 기기 목록을 받고, 응답·로그에 토큰이 없다", async () => {
    const logs: string[] = [];
    await start({ logs });
    const r = await goLive();
    expect(r.status).toBe(200);
    expect(r.json.mode).toBe("live");
    expect((await get("/api/health")).json.mode).toBe("live");
    const list = await get("/api/setup/thinq");
    expect(list.status).toBe(200);
    expect(list.json.devices.map((d: Msg) => d.id)).toEqual([FAKE_AC, FAKE_FRIDGE]);
    expect(JSON.stringify(list.json)).not.toContain(TOKEN);
    expect(logs.join("\n")).not.toContain(TOKEN);
  });
});

describe("짝짓기", () => {
  it("에어컨·냉장고만, 없는 기기·다른 집·ThinQ 목록에 없는 기기·종류가 다른 기기는 400·409", async () => {
    await start();
    await goLive();
    await get("/api/setup/thinq");
    expect((await pair({ light_room: FAKE_AC })).status).toBe(400);
    expect((await pair({ nope: FAKE_AC })).status).toBe(400);
    expect((await post("/api/setup/pairs", { home: "apartment", pairs: { ac_1: FAKE_AC } })).status).toBe(409);
    expect((await pair({ ac_1: "thinq-unknown" })).status).toBe(400);
    expect((await pair({ ac_1: FAKE_FRIDGE })).status).toBe(400);
    expect((await pair({ ac_1: FAKE_AC })).json.pairs).toEqual({ ac_1: FAKE_AC });
    expect((await pair({ ac_1: null })).json.pairs).toEqual({});
  });
});

describe("실제 모드 명령", () => {
  it("에어컨 온도: 다시 읽어 같으면 완료(200), 트윈과 기기 목록에 실제 값", async () => {
    await start();
    await livePaired();
    const r = await setpoint(26);
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ ok: true, outcome: "done", state: { matter: { setpointC: 26 }, readback: { source: "thinq", deviceId: FAKE_AC } } });
    expect(fake!.controls().map((q) => q.body)).toEqual([{ temperatureInUnits: { targetTemperature: 26, unit: "C" } }]);
    const view = (await get("/api/devices")).json.find((d: Msg) => d.id === "ac_1");
    expect(view.state.matter.setpointC).toBe(26);
  });

  it("받았지만 다시 읽은 값이 다르면 확인 안 됨(202)", async () => {
    await start();
    await livePaired();
    fake!.behavior[FAKE_AC] = "ignore";
    const r = await setpoint(26);
    expect(r.status).toBe(202);
    expect(r.json).toMatchObject({ ok: true, outcome: "unverified" });
    expect(r.json.state.matter.setpointC).toBe(24);
  });

  it("거부하면 실패(400)", async () => {
    await start();
    await livePaired();
    fake!.behavior[FAKE_AC] = "reject";
    const r = await setpoint(26);
    expect(r.status).toBe(400);
    expect(r.json).toMatchObject({ ok: false, outcome: "failed" });
  });

  it("범위를 넘는 온도는 정책이 막아 ThinQ에 보내지 않는다", async () => {
    await start();
    await livePaired();
    expect((await setpoint(40)).status).toBe(400);
    expect(fake!.controls()).toHaveLength(0);
  });

  it("냉장고 문이 열린 것을 읽으면 트윈 냉장고 문도 열린다, 문 값은 바꿀 수 없다", async () => {
    await start();
    fake = fake ?? await startFakeThinq();
    fake.states[FAKE_FRIDGE] = { doorStatus: [{ locationName: "MAIN", doorState: "OPEN" }] };
    await livePaired();
    await waitFor(async () => (await get("/api/devices/fridge_1")).json.state.twin.door === "open");
    expect((await post("/api/sensors/fridge_1", { attr: "door", value: "closed" })).status).toBe(400);
  });

  it("짝 없는 기기는 실제 모드에서도 트윈 그대로", async () => {
    await start();
    await livePaired();
    const before = fake!.requests.length;
    const r = await post("/api/devices/light_room/command", { command: { type: "on" } });
    expect(r.status).toBe(200);
    expect(fake!.requests.length).toBe(before);
  });

  it("시험 모드로 돌아가면 그 뒤 명령은 트윈에서, ThinQ 요청은 늘지 않는다", async () => {
    await start();
    await livePaired();
    expect((await post("/api/setup/mode", { mode: "test" })).status).toBe(200);
    expect((await get("/api/health")).json.mode).toBe("test");
    const before = fake!.requests.length;
    const r = await setpoint(27);
    expect(r.status).toBe(200);
    expect(r.json.outcome).toBeUndefined();
    await new Promise((res) => setTimeout(res, 50));
    expect(fake!.requests.length).toBe(before);
  });
});

describe("저장(npm start 방식)", () => {
  it("모드·짝이 다시 켜도 그대로, 켜자마자 짝지은 기기를 읽는다", async () => {
    const dir = runtime();
    await start({ runtimeDir: dir, persist: true });
    await livePaired();
    await srv!.close();
    srv = undefined;
    fake!.requests.length = 0;
    await start({ runtimeDir: dir, persist: true });
    expect((await get("/api/health")).json.mode).toBe("live");
    expect((await get("/api/setup")).json.pairs).toEqual({ ac_1: FAKE_AC, fridge_1: FAKE_FRIDGE });
    await waitFor(async () => (await get("/api/devices/ac_1")).json.state.readback !== undefined);
    expect(fake!.requests.some((q) => q.path === `devices/${FAKE_AC}/state`)).toBe(true);
  });

  it("저장한 모드가 실제인데 토큰이 없으면 시험 모드로 뜨고 ThinQ를 부르지 않는다", async () => {
    const dir = runtime();
    await start({ runtimeDir: dir, persist: true });
    await livePaired();
    await srv!.close();
    srv = undefined;
    fake!.requests.length = 0;
    const logs: string[] = [];
    await start({ runtimeDir: dir, persist: true, token: false, logs });
    expect((await get("/api/health")).json.mode).toBe("test");
    expect(logs.join("\n")).toMatch(/시험 모드/);
    await setpoint(26);
    expect(fake!.requests).toEqual([]);
  });
});
