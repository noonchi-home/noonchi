// 신호 출처(SignalHub): 「신호 없음」 기기는 엔진·화면에 상태를 「모름」으로 보이고, 숨은 세계(안쪽 허브)는 계속 시뮬레이션한다.
import { describe, expect, it } from "vitest";
import { Policy } from "../src/agent/policy.js";
import { observe } from "../src/agent/observe.js";
import { TOOLS, deviceViews, localBackend } from "../src/agent/tools.js";
import { MemoryHub } from "../src/hub/memory.js";
import { SignalHub, isUnknown } from "../src/hub/signals.js";
import type { DeviceSpec, DeviceState } from "../src/hub/types.js";
import { describeDevice } from "../src/model/mapping.js";

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
