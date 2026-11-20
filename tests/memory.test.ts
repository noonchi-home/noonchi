import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { MemoryHub } from "../src/devices/hub/memory.js";
import type { DeviceSpec, DeviceState } from "../src/contract/devices.js";
import { loadTwin, resolveTwinStudioDir } from "../src/layout/twin-files.js";
import { describeDevice } from "../src/devices/mapping.js";

const POWER = { power: ["off", "on"] };

function spec(id: string, label: string, twinType: string, twinAttrs: Record<string, unknown[]>): DeviceSpec {
  const d = describeDevice(twinType, twinAttrs)!;
  return { id, label, room: "living_room", roomLabel: "거실", twinType, twinAttrs, ...d };
}

const DEVICES: DeviceSpec[] = [
  spec("tv", "거실 TV", "tv", POWER),
  spec("light", "거실 천장등", "ceiling_light", POWER),
  spec("ac", "스탠드 에어컨", "stand_ac", POWER),
  spec("mw", "전자레인지", "microwave", POWER),
  spec("dw", "식기세척기", "dishwasher", { running: [true, false], door: ["closed", "open"] }),
  spec("door_bed2", "작은방 문", "door_room_r", { door: ["closed", "open"] }),
  spec("door_main", "현관문", "door_main", { door: ["closed", "open"], lock: ["locked", "unlocked"] }),
  spec("curtain", "거실 커튼", "curtain_290", { curtain: ["open", "closed"] }),
  spec("dock", "로봇청소기 충전대", "vacuum_dock", { charging: ["off", "on"] }),
  spec("vac", "로봇청소기", "robot_vacuum", { running: [true, false] }),
];

let tick = 0;
function makeHub(initial: Record<string, Record<string, unknown>> = {}) {
  tick = 0;
  return new MemoryHub(DEVICES, initial, { now: () => new Date(Date.UTC(2026, 9, 11, 0, 0, tick++)) });
}

describe("MemoryHub 초기 상태", () => {
  it("모든 기기의 twin·matter 요약이 맞물린다", () => {
    const hub = makeHub({ light: { power: "on" } });
    expect(hub.list().map((d) => d.id)).toEqual(DEVICES.map((d) => d.id));
    expect(hub.states()).toHaveLength(DEVICES.length);
    expect(hub.get("tv")).toMatchObject({ id: "tv", online: true, twin: { power: "off" }, matter: { onOff: false } });
    expect(hub.get("light")).toMatchObject({ twin: { power: "on" }, matter: { onOff: true, level: 100 } });
    expect(hub.get("door_main")).toMatchObject({ twin: { lock: "locked", door: "closed" }, matter: { lockState: "locked", stateValue: true } });
    expect(hub.get("dock")).toMatchObject({ twin: { charging: "off" }, matter: {} });
    expect(hub.get("tv")!.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(hub.get("nope")).toBeUndefined();
  });

  it("돌려준 값은 얼린 것이라 고칠 수 없고 허브 상태는 그대로다", () => {
    const hub = makeHub();
    const s = hub.get("tv")!;
    // 타입 검사도 막는다(src/contract/devices.ts readonly): 아래 쓰기는 컴파일 오류이고, 실행해도 TypeError다.
    // @ts-expect-error 허브 상태는 읽기 전용
    expect(() => { s.twin.power = "on"; }).toThrow(TypeError);
    // @ts-expect-error 기기 명세는 읽기 전용
    expect(() => { hub.list()[0]!.label = "바뀜"; }).toThrow(TypeError);
    // @ts-expect-error 허브 상태는 읽기 전용
    expect(() => { hub.states()[0]!.matter.onOff = true; }).toThrow(TypeError);
    expect(hub.get("tv")!.twin.power).toBe("off");
    expect(hub.list()[0]!.label).toBe("거실 TV");
  });

  it("겉만 얼린 초기값을 받아도 안쪽 값을 나누지 않고 모두 얼린다", () => {
    const inner = { level: 3 };
    const hub = makeHub({ dock: { charging: Object.freeze({ inner }) } });
    const charging = () => hub.get("dock")!.twin.charging as { inner: { level: number } };
    expect(charging().inner.level).toBe(3);
    expect(() => { charging().inner.level = 9; }).toThrow(TypeError);
    inner.level = 7;
    expect(charging().inner.level).toBe(3);
  });

  it("상태가 바뀌기 전까지는 읽을 때마다 복사하지 않고 같은 값을 준다", async () => {
    const hub = makeHub();
    expect(hub.get("tv")).toBe(hub.get("tv"));
    expect(hub.list()[0]).toBe(hub.list()[0]);
    const before = hub.get("tv")!;
    const r = await hub.command("tv", { type: "on" });
    expect(r.state).toBe(hub.get("tv"));
    expect(hub.get("tv")).not.toBe(before);
    expect(before.twin.power).toBe("off");
  });
});

describe("MemoryHub.command", () => {
  it("TV 켜기: twin power on, matter onOff true", async () => {
    const hub = makeHub();
    const before = hub.get("tv")!.updatedAt;
    const r = await hub.command("tv", { type: "on" });
    expect(r.ok).toBe(true);
    expect(r.state).toMatchObject({ twin: { power: "on" }, matter: { onOff: true } });
    expect(hub.get("tv")!.twin.power).toBe("on");
    expect(hub.get("tv")!.updatedAt > before).toBe(true);
  });

  it("조명 밝기 30%는 켜고 level 30", async () => {
    const hub = makeHub();
    const r = await hub.command("light", { type: "level", percent: 30 });
    expect(r.state).toMatchObject({ twin: { power: "on" }, matter: { onOff: true, level: 30 } });
  });

  it("에어컨 climate", async () => {
    const hub = makeHub();
    const r = await hub.command("ac", { type: "climate", mode: "cool", setpointC: 22, fan: "high" });
    expect(r.state).toMatchObject({ twin: { power: "on" }, matter: { onOff: true, systemMode: "cool", setpointC: 22, fanMode: "high" } });
  });

  it("전자레인지 on은 start로 바뀐다", async () => {
    const hub = makeHub();
    const r = await hub.command("mw", { type: "on" });
    expect(r.state).toMatchObject({ twin: { power: "on" }, matter: { operationalState: "running" } });
    await hub.command("mw", { type: "off" });
    expect(hub.get("mw")!.twin.power).toBe("off");
  });

  it("식기세척기: running은 불리언, 문이 열려 있으면 시작 거부", async () => {
    const hub = makeHub();
    expect((await hub.command("dw", { type: "start" })).state!.twin).toEqual({ running: true, door: "closed" });
    await hub.command("dw", { type: "stop" });
    await hub.setSensor("dw", "door", "open");
    const r = await hub.command("dw", { type: "start" });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/문이 열려/);
    expect(hub.get("dw")!.twin.running).toBe(false);
  });

  it("현관문 잠금 해제(정책은 상위에서)", async () => {
    const hub = makeHub();
    const r = await hub.command("door_main", { type: "unlock" });
    expect(r.state).toMatchObject({ twin: { lock: "unlocked", door: "closed" }, matter: { lockState: "unlocked" } });
  });

  it("커튼 0%는 closed", async () => {
    const hub = makeHub();
    const r = await hub.command("curtain", { type: "covering", openPercent: 0 });
    expect(r.state).toMatchObject({ twin: { curtain: "closed" }, matter: { openPercent: 0 } });
  });

  it("로봇청소기 start/stop", async () => {
    const hub = makeHub();
    expect((await hub.command("vac", { type: "start" })).state!.twin).toEqual({ running: true });
    expect((await hub.command("vac", { type: "stop" })).state!.matter).toEqual({ runMode: "idle", operationalState: "docked" });
  });

  it("지원하지 않는 명령은 거부하고 상태·이벤트가 없다", async () => {
    const hub = makeHub();
    const events: DeviceState[] = [];
    hub.subscribe((s) => events.push(s));
    const r = await hub.command("tv", { type: "level", percent: 50 });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/지원하지 않는/);
    expect(hub.get("tv")!.twin.power).toBe("off");
    expect(events).toEqual([]);
  });

  it("센서 기기에 명령하면 거부", async () => {
    const hub = makeHub();
    const r = await hub.command("door_bed2", { type: "on" });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/센서/);
  });

  it("범위를 벗어난 값은 거부", async () => {
    const hub = makeHub();
    expect((await hub.command("light", { type: "level", percent: -5 })).error).toMatch(/0~100/);
  });

  it("없는 기기", async () => {
    const hub = makeHub();
    const r = await hub.command("ghost", { type: "on" });
    expect(r).toMatchObject({ ok: false });
    expect(r.error).toMatch(/찾을 수 없습니다/);
  });
});

describe("MemoryHub.setSensor", () => {
  it("방문 열림: twin door open, matter stateValue false", async () => {
    const hub = makeHub();
    const r = await hub.setSensor("door_bed2", "door", "open");
    expect(r.ok).toBe(true);
    expect(r.state).toMatchObject({ twin: { door: "open" }, matter: { stateValue: false } });
  });

  it("도어록 문 센서는 잠금 상태를 바꾸지 않는다", async () => {
    const hub = makeHub();
    const r = await hub.setSensor("door_main", "door", "open");
    expect(r.state).toMatchObject({ twin: { door: "open", lock: "locked" }, matter: { lockState: "locked", stateValue: false } });
  });

  it("충전 표시(status)는 twin만 바뀐다", async () => {
    const hub = makeHub();
    const r = await hub.setSensor("dock", "charging", "on");
    expect(r.state).toMatchObject({ twin: { charging: "on" }, matter: {} });
  });

  it("센서가 아닌 attr·목록에 없는 값·없는 기기는 거부", async () => {
    const hub = makeHub();
    expect((await hub.setSensor("tv", "power", "on")).error).toMatch(/센서/);
    expect(hub.get("tv")!.twin.power).toBe("off");
    expect((await hub.setSensor("door_bed2", "door", "ajar")).error).toMatch(/closed\/open/);
    expect((await hub.setSensor("ghost", "door", "open")).error).toMatch(/찾을 수 없습니다/);
  });
});

describe("MemoryHub.subscribe", () => {
  it("바뀔 때마다 상태를 받고, 해지하면 멈춘다", async () => {
    const hub = makeHub();
    const events: DeviceState[] = [];
    const off = hub.subscribe((s) => events.push(s));
    await hub.command("tv", { type: "on" });
    await hub.setSensor("door_bed2", "door", "open");
    off();
    await hub.command("tv", { type: "off" });
    expect(events.map((e) => [e.id, e.twin])).toEqual([
      ["tv", { power: "on" }],
      ["door_bed2", { door: "open" }],
    ]);
  });

  it("구독자 하나가 던져도 나머지는 받는다", async () => {
    const hub = makeHub();
    const got: string[] = [];
    hub.subscribe(() => { throw new Error("boom"); });
    hub.subscribe((s) => got.push(s.id));
    const r = await hub.command("tv", { type: "on" });
    expect(r.ok).toBe(true);
    expect(got).toEqual(["tv"]);
  });

  it("start/stop은 성공한다", async () => {
    const hub = makeHub();
    await expect(hub.start()).resolves.toBeUndefined();
    await expect(hub.stop()).resolves.toBeUndefined();
  });
});

describe("MemoryHub.fromTwin (실제 twin-studio 데이터)", () => {
  it("모든 기기를 올리고 거실 TV를 켤 수 있다", async () => {
    const studio = resolveTwinStudioDir(process.env.TWIN_STUDIO_DIR, fileURLToPath(new URL("..", import.meta.url)));
    const twin = loadTwin(studio, { source: "catalog" });
    const hub = MemoryHub.fromTwin(twin);
    expect(hub.states()).toHaveLength(twin.devices.length);
    for (const s of hub.states()) expect(s.twin).toEqual(twin.initial[s.id]);
    const r = await hub.command("tv_living", { type: "on" });
    expect(r.state!.twin.power).toBe("on");
  });
});
