// 신호 출처(SignalHub): 「신호 없음」 기기는 엔진·화면에 상태를 「모름」으로 보이고, 숨은 세계(안쪽 허브)는 계속 시뮬레이션한다.
import { afterEach, describe, expect, it } from "vitest";
import { Policy } from "../src/agent/policy.js";
import { observe } from "../src/agent/observe.js";
import { TOOLS, deviceViews, localBackend } from "../src/agent/tools.js";
import { MemoryHub } from "../src/hub/memory.js";
import { SignalHub, isUnknown } from "../src/hub/signals.js";
import type { DeviceSpec, DeviceState } from "../src/hub/types.js";
import { describeDevice } from "../src/model/mapping.js";
import { ThinqClient, thinqConfig } from "../src/thinq/client.js";
import { ThinqLink } from "../src/thinq/link.js";
import { FAKE_AC, FAKE_FRIDGE, startFakeThinq, type FakeThinq } from "./helpers/thinq.js";

function spec(id: string, label: string, twinType: string, twinAttrs: Record<string, unknown[]>): DeviceSpec {
  return { id, label, room: "r", roomLabel: "방", twinType, twinAttrs, ...describeDevice(twinType, twinAttrs)! };
}

const tv = spec("tv_living", "거실 TV", "tv", { power: ["off", "on"] });
const washer = spec("washer_1", "세탁기", "washer", { running: [false, true], door: ["closed", "open"] });

function setup(sources: ConstructorParameters<typeof SignalHub>[1] = {}) {
  const world = new MemoryHub([tv, washer]);
  const hub = new SignalHub(world, sources);
  const seen: DeviceState[] = [];
  hub.subscribe((s) => seen.push(s));
  return { world, hub, seen };
}

describe("SignalHub", () => {
  it("기본(가상)은 안쪽 허브를 그대로 보인다", async () => {
    const { world, hub, seen } = setup();
    expect(hub.get("tv_living")).toEqual(world.get("tv_living"));
    const r = await hub.command("tv_living", { type: "on" });
    expect(r.ok).toBe(true);
    expect(r.state?.twin.power).toBe("on");
    expect(seen.map((s) => s.id)).toEqual(["tv_living"]);
    expect(hub.source("tv_living")).toEqual({ kind: "virtual" });
  });

  it("신호 없음: 읽기는 모름, 명령은 숨은 세계에서 실행되고 결과도 가린다", async () => {
    const { world, hub, seen } = setup({ tv_living: { kind: "none" } });
    const masked = hub.get("tv_living")!;
    expect(masked).toMatchObject({ id: "tv_living", twin: {}, matter: {}, signal: "none" });
    expect(isUnknown(masked)).toBe(true);
    expect(hub.states().find((s) => s.id === "tv_living")?.signal).toBe("none");
    const r = await hub.command("tv_living", { type: "on" });
    expect(r.ok).toBe(true);
    expect(r.state).toMatchObject({ twin: {}, signal: "none" });
    expect(world.get("tv_living")!.twin.power).toBe("on");
    expect(seen).toEqual([]);
    expect(hub.sources()).toEqual({ tv_living: { kind: "none" } });
  });

  it("출처를 바꾸면 바뀐 기기만 새 보기 상태를 한 번 보낸다", async () => {
    const { world, hub, seen } = setup();
    await world.command("tv_living", { type: "on" });
    seen.length = 0;
    hub.setSources({ tv_living: { kind: "none" } });
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ id: "tv_living", signal: "none" });
    hub.setSources({ tv_living: { kind: "none" } });
    expect(seen).toHaveLength(1);
    hub.setSources({});
    expect(seen).toHaveLength(2);
    expect(seen[1]!.twin.power).toBe("on");
    expect(seen[1]!.signal).toBeUndefined();
  });

  it("에이전트 도구는 모름 기기를 state 「모름」으로 보인다", async () => {
    const { hub } = setup({ tv_living: { kind: "none" } });
    const backend = localBackend(hub, new Policy());
    const views = deviceViews(hub);
    expect(views.find((d) => d.id === "tv_living")?.state.signal).toBe("none");
    const getState = TOOLS.find((t) => t.name === "get_state")!;
    const r = await getState.run(backend, { device_id: "tv_living" }) as { data: Record<string, unknown> };
    expect(r.data.state).toBe("모름");
    expect(r.data.signal).toBe("none");
    const list = TOOLS.find((t) => t.name === "list_devices")!;
    const l = await list.run(backend, {}) as { data: { id: string; state: unknown }[] };
    expect(l.data.find((d) => d.id === "tv_living")?.state).toBe("모름");
    expect(l.data.find((d) => d.id === "washer_1")?.state).toEqual({ running: false, door: "closed" });
    expect(observe("get_state", r as never)).toBe("거실 TV: 모름(신호 없음)");
    const on = await TOOLS.find((t) => t.name === "turn_on")!.run(backend, { device_id: "tv_living" });
    expect(on).toMatchObject({ ok: true, state: "모름" });
    expect(on.message).toMatch(/보냈어요.*확인하지 못했어요/);
  });

  it("정책은 모름 상태로 사전 검사하지 않고 숨은 세계의 판단을 따른다", async () => {
    const { world, hub } = setup({ washer_1: { kind: "none" } });
    const policy = new Policy();
    await world.command("washer_1", { type: "start" });
    const r = await policy.guard(hub, "washer_1", { type: "pause" });
    expect(r.ok).toBe(true);
    expect(world.get("washer_1")!.matter.operationalState).toBe("paused");
    await world.setSensor("washer_1", "door", "open");
    // 숨은 세계는 거절하지만(문 열림) 엔진은 결과를 알 수 없다: 보냄으로만 돌려주고 이유를 드러내지 않는다
    const sent = await policy.guard(hub, "washer_1", { type: "start" });
    expect(sent).toEqual({ ok: true, state: expect.objectContaining({ twin: {}, signal: "none" }) });
    expect(world.get("washer_1")!.matter.operationalState).toBe("paused");
  });

  it("stop() 뒤에 늦게 온 명령은 실행하지 않는다(집을 바꿈)", async () => {
    const { world, hub } = setup();
    await hub.stop();
    const r = await hub.command("tv_living", { type: "on" });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/집을 바꾸는 중/);
    expect(world.get("tv_living")!.twin.power).toBe("off");
  });
});

// ── ThinQ 출처(실제 모드에서 짝지은 기기) ─────────────────────────

const ac = spec("ac_living", "거실 에어컨", "stand_ac", { power: ["off", "on"] });
const fridge = spec("fridge_1", "냉장고", "fridge", { door: ["closed", "open"] });

describe("SignalHub의 thinq 출처", () => {
  let fake: FakeThinq | undefined;
  let link: ThinqLink | undefined;
  afterEach(async () => {
    link?.stop();
    link = undefined;
    await fake?.close();
    fake = undefined;
  });

  async function thinqSetup(withLink = true) {
    fake = await startFakeThinq();
    const cfg = thinqConfig({ THINQ_TOKEN: "test-token", THINQ_BASE_URL: fake.url });
    if (!cfg.ok) throw new Error(cfg.error);
    const world = new MemoryHub([tv, ac, fridge]);
    const hub = new SignalHub(world, { ac_living: { kind: "thinq", deviceId: FAKE_AC }, fridge_1: { kind: "thinq", deviceId: FAKE_FRIDGE } });
    const seen: DeviceState[] = [];
    hub.subscribe((s) => seen.push(s));
    if (withLink) {
      link = new ThinqLink({ client: new ThinqClient(cfg.config), world, pairs: { ac_living: FAKE_AC, fridge_1: FAKE_FRIDGE }, pollMs: 0, readbackMs: [0, 5] });
      hub.setLink(link);
    }
    return { world, hub, seen, fake };
  }

  it("읽기 전에는 모름, 읽은 뒤에는 실제 값과 출처·시각", async () => {
    const { hub, seen } = await thinqSetup();
    expect(hub.get("ac_living")).toMatchObject({ signal: "none", twin: {} });
    seen.length = 0;
    await link!.start();
    const s = hub.get("ac_living")!;
    expect(s.signal).toBeUndefined();
    expect(s.twin.power).toBe("on");
    expect(s.matter.setpointC).toBe(24);
    expect(s.readback).toMatchObject({ source: "thinq", deviceId: FAKE_AC });
    // 읽은 기기마다 한 번씩 새 보기를 보낸다(트윈에 비춘 명령마다 보내지 않는다)
    expect(seen.map((x) => x.id).sort()).toEqual(["ac_living", "fridge_1"]);
    expect(seen.find((x) => x.id === "ac_living")!.readback).toBeDefined();
    expect(hub.source("ac_living")).toEqual({ kind: "thinq", deviceId: FAKE_AC });
    expect(hub.sources()).toMatchObject({ ac_living: { kind: "thinq", deviceId: FAKE_AC } });
  });

  it("명령은 ThinQ로 가고, 결과에 다시 읽은 값·출처·결과가 붙는다", async () => {
    const { hub, fake } = await thinqSetup();
    await link!.start();
    const r = await hub.command("ac_living", { type: "climate", setpointC: 26 });
    expect(r).toMatchObject({ ok: true, outcome: "done", state: { matter: { setpointC: 26 }, readback: { deviceId: FAKE_AC } } });
    expect(fake.controls()).toHaveLength(1);
  });

  it("연결이 없으면 thinq 기기 명령은 보내지 않고, 트윈도 그대로", async () => {
    const { world, hub } = await thinqSetup(false);
    const r = await hub.command("ac_living", { type: "on" });
    expect(r).toMatchObject({ ok: false, outcome: "not_sent" });
    expect(r.error).toMatch(/ThinQ 연결/);
    expect(world.get("ac_living")!.matter.onOff).toBe(false);
  });

  it("실제 가전 값(센서)은 바꿀 수 없다", async () => {
    const { world, hub } = await thinqSetup();
    const r = await hub.setSensor("fridge_1", "door", "open");
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/실제 가전/);
    expect(world.get("fridge_1")!.twin.door).toBe("closed");
  });

  it("안쪽 허브를 직접 바꾼 변화는 보내지 않는다(실제 값은 ThinQ 읽기로만)", async () => {
    const { world, hub, seen } = await thinqSetup();
    await link!.start();
    seen.length = 0;
    await world.command("ac_living", { type: "off" });
    expect(seen).toEqual([]);
    expect(hub.get("tv_living")).toEqual(world.get("tv_living"));
  });

  it("연결을 떼면 thinq 기기는 다시 모름, 출처를 virtual로 바꾸면 트윈 값", async () => {
    const { hub, seen } = await thinqSetup();
    await link!.start();
    seen.length = 0;
    hub.setLink(null);
    expect(hub.get("ac_living")!.signal).toBe("none");
    expect(seen.find((x) => x.id === "ac_living")?.signal).toBe("none");
    seen.length = 0;
    hub.setSources({});
    expect(hub.get("ac_living")!.twin.power).toBe("on");
    expect(seen.map((x) => x.id).sort()).toEqual(["ac_living", "fridge_1"]);
  });

  it("짝지은 ThinQ 기기가 바뀌면 그 기기를 다시 보낸다", async () => {
    const { hub, seen } = await thinqSetup(false);
    seen.length = 0;
    hub.setSources({ ac_living: { kind: "thinq", deviceId: "other" }, fridge_1: { kind: "thinq", deviceId: FAKE_FRIDGE } });
    expect(seen.map((x) => x.id)).toEqual(["ac_living"]);
  });
});
