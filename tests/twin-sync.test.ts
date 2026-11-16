// 3D 트윈 → twin-home: POST /api/devices/:id/twin {attr, value} (docs/plan.md "3D 트윈 연결")
import { afterEach, describe, expect, it } from "vitest";
import { Agent } from "../src/agent/agent.js";
import { createProvider } from "../src/agent/providers/index.js";
import { twinChange } from "../src/model/mapping.js";
import { createApp } from "../src/server/app.js";
import { fetchRetry } from "../src/shared/net.js";
import { ROOMS, homeDevices, makeHome, twin } from "./helpers/home.js";

type Msg = Record<string, any>;

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  while (cleanups.length) await cleanups.pop()!();
});

async function start() {
  const home = makeHome();
  const agent = new Agent({ hub: home.hub, policy: home.policy, rooms: ROOMS, provider: createProvider({}).provider }); // 모델은 부르지 않는다
  const app = createApp({ hub: home.hub, policy: home.policy, agent, rooms: ROOMS, log: () => {} });
  const { url } = await app.listen(0, "127.0.0.1");
  cleanups.push(() => app.close());
  return { ...home, url };
}

async function post(url: string, path: string, body: unknown, headers: Record<string, string> = {}) {
  const res = await fetchRetry(url + path, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
  return { status: res.status, json: (await res.json()) as Msg, headers: res.headers };
}

const spec = (id: string) => homeDevices().find((d) => d.id === id)!;

describe("twinChange: twin 상태 변경 → 명령 또는 센서", () => {
  it("제어 attr은 종류에 맞는 명령으로 바꾼다", () => {
    expect(twinChange(spec("tv_living"), "power", "on")).toEqual({ type: "command", command: { type: "on" }, value: "on" });
    expect(twinChange(spec("light_living"), "power", "off")).toMatchObject({ type: "command", command: { type: "off" } });
    expect(twinChange(spec("door_main"), "lock", "unlocked")).toMatchObject({ type: "command", command: { type: "unlock" } });
    expect(twinChange(spec("door_main"), "lock", "locked")).toMatchObject({ type: "command", command: { type: "lock" } });
    expect(twinChange(spec("curtain_living"), "curtain", "closed")).toMatchObject({ type: "command", command: { type: "covering", openPercent: 0 } });
    expect(twinChange(spec("curtain_living"), "curtain", "open")).toMatchObject({ type: "command", command: { type: "covering", openPercent: 100 } });
    // 동작형·밸브는 on/off를 보내고 정책·허브가 start/stop, valve로 정규화한다
    expect(twinChange(spec("washer_1"), "running", true)).toMatchObject({ type: "command", command: { type: "on" }, value: true });
    expect(twinChange(spec("washer_1"), "running", "false")).toMatchObject({ type: "command", command: { type: "off" }, value: false });
    expect(twinChange(spec("sink_1"), "faucet", "on")).toMatchObject({ type: "command", command: { type: "on" } });
    expect(twinChange(spec("boiler_1"), "heating", "on")).toMatchObject({ type: "command", command: { type: "on" } });
  });

  it("센서 attr은 센서 경로, 없는 attr·값은 오류", () => {
    expect(twinChange(spec("door_bed2"), "door", "open")).toEqual({ type: "sensor", value: "open" });
    expect(twinChange(spec("door_main"), "door", "open")).toEqual({ type: "sensor", value: "open" });
    expect(twinChange(spec("vacuum_dock_1"), "charging", "on")).toEqual({ type: "sensor", value: "on" });
    const noAttr = twinChange(spec("tv_living"), "screen", "on");
    expect(noAttr.type).toBe("invalid");
    const badValue = twinChange(spec("tv_living"), "power", "blink");
    expect(badValue).toMatchObject({ type: "invalid" });
    expect((badValue as { error: string }).error).toContain("on");
  });
});

describe("POST /api/devices/:id/twin", () => {
  it("제어 attr: 명령을 정책을 거쳐 실행하고 상태를 돌려준다", async () => {
    const { url, hub } = await start();
    const r = await post(url, "/api/devices/tv_living/twin", { attr: "power", value: "on" });
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ ok: true, via: "command", command: { type: "on" }, state: { twin: { power: "on" } } });
    expect(twin(hub, "tv_living").power).toBe("on");
    const c = await post(url, "/api/devices/curtain_living/twin", { attr: "curtain", value: "closed" });
    expect(c.json.state.matter.openPercent).toBe(0);
    expect(twin(hub, "curtain_living").curtain).toBe("closed");
    const w = await post(url, "/api/devices/washer_1/twin", { attr: "running", value: false });
    expect(w.status).toBe(200);
    expect(w.json.state.twin.running).toBe(false);
  });

  it("센서 attr: 센서 값을 바꾼다", async () => {
    const { url, hub } = await start();
    const r = await post(url, "/api/devices/door_bed2/twin", { attr: "door", value: "open" });
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ ok: true, via: "sensor", state: { twin: { door: "open" } } });
    expect(twin(hub, "door_bed2").door).toBe("open");
  });

  it("승인이 필요하면 409 needsConfirmation, /api/agent/confirm으로 실행", async () => {
    const { url, hub } = await start();
    const r = await post(url, "/api/devices/door_main/twin", { attr: "lock", value: "unlocked" });
    expect(r.status).toBe(409);
    expect(r.json.ok).toBe(false);
    expect(r.json.command).toEqual({ type: "unlock" });
    expect(r.json.needsConfirmation.reason).toContain("승인");
    expect(twin(hub, "door_main").lock).toBe("locked");
    const ok = await post(url, "/api/agent/confirm", { token: r.json.needsConfirmation.token });
    expect(ok.status).toBe(200);
    expect(twin(hub, "door_main").lock).toBe("unlocked");
    // 인덕션 켜기·전자레인지 시작도 승인 필요
    expect((await post(url, "/api/devices/induction_1/twin", { attr: "power", value: "on" })).status).toBe(409);
    expect((await post(url, "/api/devices/microwave_1/twin", { attr: "power", value: "on" })).status).toBe(409);
    expect(twin(hub, "microwave_1").power).toBe("off");
    // 끄기는 승인 없이
    expect((await post(url, "/api/devices/induction_1/twin", { attr: "power", value: "off" })).status).toBe(200);
  });

  it("confirmToken을 같이 보내면 바로 실행", async () => {
    const { url, hub } = await start();
    const r = await post(url, "/api/devices/door_main/twin", { attr: "lock", value: "unlocked" });
    const r2 = await post(url, "/api/devices/door_main/twin", { attr: "lock", value: "unlocked", confirmToken: r.json.needsConfirmation.token });
    expect(r2.status).toBe(200);
    expect(twin(hub, "door_main").lock).toBe("unlocked");
  });

  it("없는 attr·값·형식은 400, 없는 기기는 404", async () => {
    const { url } = await start();
    const a = await post(url, "/api/devices/tv_living/twin", { attr: "screen", value: "on" });
    expect(a.status).toBe(400);
    expect(a.json.error).toContain("screen");
    expect((await post(url, "/api/devices/tv_living/twin", { attr: "power", value: "blink" })).status).toBe(400);
    expect((await post(url, "/api/devices/tv_living/twin", { value: "on" })).status).toBe(400);
    expect((await post(url, "/api/devices/tv_living/twin", { attr: "power" })).status).toBe(400);
    expect((await post(url, "/api/devices/nope/twin", { attr: "power", value: "on" })).status).toBe(404);
  });

  it("뷰어 출처(127.0.0.1:8100)는 CORS 허용, 다른 출처는 403", async () => {
    const { url } = await start();
    const ok = await post(url, "/api/devices/tv_living/twin", { attr: "power", value: "on" }, { origin: "http://127.0.0.1:8100" });
    expect(ok.status).toBe(200);
    expect(ok.headers.get("access-control-allow-origin")).toBe("http://127.0.0.1:8100");
    const bad = await post(url, "/api/devices/tv_living/twin", { attr: "power", value: "off" }, { origin: "https://evil.example" });
    expect(bad.status).toBe(403);
  });
});
