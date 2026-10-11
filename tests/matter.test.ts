// Matter 계층(matter.js 브리지 + 컨트롤러) 테스트.
// local: 같은 프로세스에서 브리지 엔드포인트를 behavior API로 직접 다룬다(네트워크 없음).
// network: 컨트롤러가 브리지를 실제로 커미셔닝하고(UDP, 임시 포트·저장 폴더) 명령·구독한다.

import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { DeviceSpec, DeviceState } from "../src/hub/types.js";
import { formatPairingInfo } from "../src/matter/bridge.js";
import { DEVICE_TYPE_INFO, endpointTypeFor, SUPPORTED_DEVICE_TYPES } from "../src/matter/deviceTypes.js";
import { createMatterHub, isNetworkUnavailable, MatterHub, matterHubOptionsFromEnv } from "../src/matter/matterHub.js";
import { KIND_PROFILES, describeDevice } from "../src/model/mapping.js";
import { loadTwin } from "../src/model/devices.js";

const POWER = { power: ["off", "on"] };
const RUNNING_DOOR = { running: [true, false], door: ["closed", "open"] };

function spec(id: string, label: string, twinType: string, twinAttrs: Record<string, unknown[]>): DeviceSpec {
  const d = describeDevice(twinType, twinAttrs);
  if (!d) throw new Error(`매핑 없음: ${twinType}`);
  return { id, label, room: "living_room", roomLabel: "거실", twinType, twinAttrs, ...d };
}

/** 모든 종류(DeviceKind)를 하나 이상 담은 기기 목록. */
const DEVICES: DeviceSpec[] = [
  spec("light_living", "거실 천장등", "ceiling_light", POWER),
  spec("downlight_hall", "복도 다운라이트", "downlight", POWER),
  spec("kettle", "전기포트", "kettle", POWER),
  spec("tv_living", "거실 TV", "tv", POWER),
  spec("speaker", "거실 스피커", "speaker", POWER),
  spec("ac_living", "스탠드 에어컨", "stand_ac", POWER),
  spec("purifier", "공기청정기", "air_purifier", POWER),
  spec("humidifier", "가습기", "humidifier", POWER),
  spec("hood", "레인지 후드", "range_hood", POWER),
  spec("cooktop", "인덕션", "induction_counter", POWER),
  spec("microwave", "전자레인지", "microwave", POWER),
  spec("dishwasher", "식기세척기", "dishwasher", RUNNING_DOOR),
  spec("washer", "세탁기", "washer", RUNNING_DOOR),
  spec("dryer", "건조기", "dryer", { running: [true, false] }),
  spec("fridge", "냉장고", "fridge", { door: ["closed", "open"] }),
  spec("vacuum", "로봇청소기", "robot_vacuum", { running: [true, false] }),
  spec("curtain", "거실 커튼", "curtain_290", { curtain: ["open", "closed"] }),
  spec("blind", "작은방 블라인드", "blind_175", { blind: ["open", "closed"] }),
  spec("door_main", "현관문", "door_main", { door: ["closed", "open"], lock: ["locked", "unlocked"] }),
  spec("door_bed2", "작은방 문", "door_room_r", { door: ["closed", "open"] }),
  spec("faucet", "주방 수전", "sink_counter", { faucet: ["off", "on"] }),
  spec("boiler", "보일러", "boiler", { heating: ["off", "on"] }),
  spec("dock", "로봇청소기 충전대", "vacuum_dock", { charging: ["off", "on"] }),
];

const tempDirs: string[] = [];
function tempDir(prefix: string): string {
  const d = mkdtempSync(join(tmpdir(), `twin-home-${prefix}-`));
  tempDirs.push(d);
  return d;
}

afterAll(() => {
  for (const d of tempDirs) {
    try {
      rmSync(d, { recursive: true, force: true });
    } catch {
      // Windows에서 잠금이 늦게 풀리면 남을 수 있다(임시 폴더라 무시)
    }
  }
});

function localHub(devices = DEVICES, initial: Record<string, Record<string, unknown>> = {}) {
  return new MatterHub(devices, { transport: "local", storageDir: tempDir("local"), initial, log: () => {} });
}

/** 브리지 쪽(실제 Matter 엔드포인트) 상태. */
function bridgeState(hub: MatterHub, id: string): Record<string, Record<string, unknown>> {
  const ep = hub.bridgeEndpoint(id);
  if (!ep) throw new Error(`브리지 엔드포인트 없음: ${id}`);
  return ep.state as unknown as Record<string, Record<string, unknown>>;
}

describe("deviceTypes", () => {
  it("매핑 표의 모든 matter.js 기기 종류에 엔드포인트 타입이 있다", () => {
    const names = new Set(Object.values(KIND_PROFILES).map((p) => p.matterDeviceType).filter((n) => n !== "none"));
    names.add("OnOffLightDevice"); // 다운라이트(규칙 덮어쓰기)
    for (const name of names) expect(SUPPORTED_DEVICE_TYPES).toContain(name);
    for (const d of DEVICES) {
      const type = endpointTypeFor(d);
      if (d.matterDeviceType === "none") expect(type).toBeUndefined();
      else expect(type?.deviceType, d.id).toBe(DEVICE_TYPE_INFO[d.matterDeviceType]!.deviceType);
    }
  });

  it("문 센서가 있는 기기는 BooleanState를 더 붙인다(대체 기록)", () => {
    expect(DEVICE_TYPE_INFO.DishwasherDevice!.deviceType).toBe(0x75);
    const dw = endpointTypeFor(DEVICES.find((d) => d.id === "dishwasher")!)!;
    const dryer = endpointTypeFor(DEVICES.find((d) => d.id === "dryer")!)!;
    expect(Object.keys(dw.behaviors)).toContain("booleanState");
    expect(Object.keys(dryer.behaviors)).not.toContain("booleanState");
    expect(Object.keys(dw.behaviors)).toContain("bridgedDeviceBasicInformation");
  });
});

describe("MatterHub local transport", () => {
  let hub: MatterHub;

  beforeAll(async () => {
    hub = localHub(DEVICES, { light_living: { power: "on" }, curtain: { curtain: "closed" } });
    await hub.start();
  }, 60_000);

  afterAll(async () => {
    await hub?.stop();
  }, 30_000);

  it("모든 기기 종류가 브리지 엔드포인트로 뜬다(상태 기기는 twin 전용)", () => {
    expect(hub.list().map((d) => d.id)).toEqual(DEVICES.map((d) => d.id));
    expect(hub.states()).toHaveLength(DEVICES.length);
    for (const d of DEVICES) {
      const ep = hub.bridgeEndpoint(d.id);
      if (d.matterDeviceType === "none") {
        expect(ep, d.id).toBeUndefined();
        continue;
      }
      expect(ep, d.id).toBeDefined();
      const info = bridgeState(hub, d.id).bridgedDeviceBasicInformation!;
      expect(info.nodeLabel).toBe(d.label);
      expect(info.uniqueId).toBe(d.id);
      expect(info.reachable).toBe(true);
      expect(hub.get(d.id)!.online).toBe(true);
    }
    expect(hub.info.transport).toBe("local");
    expect(hub.info.pairing?.manualPairingCode).toMatch(/^\d{11}$/);
    expect(hub.info.pairing?.qrPairingCode).toMatch(/^MT:/);
  });

  it("초기 twin 상태가 Matter 속성으로 들어간다", () => {
    expect(hub.get("light_living")).toMatchObject({ twin: { power: "on" }, matter: { onOff: true, level: 100 } });
    expect(bridgeState(hub, "light_living").onOff!.onOff).toBe(true);
    expect(hub.get("tv_living")).toMatchObject({ twin: { power: "off" }, matter: { onOff: false } });
    expect(hub.get("curtain")).toMatchObject({ twin: { curtain: "closed" }, matter: { openPercent: 0 } });
    expect(bridgeState(hub, "curtain").windowCovering!.currentPositionLiftPercent100ths).toBe(10000);
    expect(hub.get("door_main")).toMatchObject({ twin: { lock: "locked", door: "closed" }, matter: { lockState: "locked", stateValue: true } });
    expect(hub.get("vacuum")).toMatchObject({ twin: { running: false }, matter: { runMode: "idle", operationalState: "docked" } });
    expect(hub.get("ac_living")).toMatchObject({ twin: { power: "off" }, matter: { onOff: false, systemMode: "cool", setpointC: 24, fanMode: "auto" } });
    expect(hub.get("boiler")).toMatchObject({ twin: { heating: "off" }, matter: { systemMode: "off", setpointC: 22 } });
    expect(hub.get("dock")).toMatchObject({ twin: { charging: "off" }, matter: {} });
  });

  it("조명 켜기/끄기가 Matter OnOff를 거쳐 돌아온다", async () => {
    const off = await hub.command("light_living", { type: "off" });
    expect(off).toMatchObject({ ok: true, state: { twin: { power: "off" }, matter: { onOff: false } } });
    expect(bridgeState(hub, "light_living").onOff!.onOff).toBe(false);
    const on = await hub.command("light_living", { type: "on" });
    expect(on).toMatchObject({ ok: true, state: { twin: { power: "on" }, matter: { onOff: true } } });
    expect(bridgeState(hub, "light_living").onOff!.onOff).toBe(true);
    const dim = await hub.command("light_living", { type: "level", percent: 50 });
    expect(dim.state?.matter.level).toBe(50);
    expect(bridgeState(hub, "light_living").levelControl!.currentLevel).toBe(127);
  });

  it("에어컨 설정 온도·모드·바람이 Thermostat·FanControl에 쓰인다", async () => {
    const r = await hub.command("ac_living", { type: "climate", mode: "cool", setpointC: 22, fan: "high" });
    expect(r).toMatchObject({ ok: true, state: { twin: { power: "on" }, matter: { onOff: true, systemMode: "cool", setpointC: 22, fanMode: "high" } } });
    const s = bridgeState(hub, "ac_living");
    expect(s.thermostat!.occupiedCoolingSetpoint).toBe(2200);
    expect(s.thermostat!.systemMode).toBe(3);
    expect(s.fanControl!.fanMode).toBe(3);
    const heat = await hub.command("ac_living", { type: "climate", mode: "heat", setpointC: 28 });
    expect(heat.state?.matter).toMatchObject({ systemMode: "heat", setpointC: 28 });
    expect(bridgeState(hub, "ac_living").thermostat!.occupiedHeatingSetpoint).toBe(2800);
    const off = await hub.command("ac_living", { type: "off" });
    expect(off.state?.twin.power).toBe("off");
  });

  it("커튼 열림 %가 WindowCovering lift로 간다", async () => {
    const r = await hub.command("curtain", { type: "covering", openPercent: 30 });
    expect(r).toMatchObject({ ok: true, state: { twin: { curtain: "open" }, matter: { openPercent: 30 } } });
    expect(bridgeState(hub, "curtain").windowCovering!.currentPositionLiftPercent100ths).toBe(7000);
    const closed = await hub.command("curtain", { type: "covering", openPercent: 0 });
    expect(closed.state?.twin.curtain).toBe("closed");
    const blind = await hub.command("blind", { type: "covering", openPercent: 100 });
    expect(blind.state?.twin.blind).toBe("open");
  });

  it("현관 잠금 해제/잠금이 DoorLock 명령으로 된다(PIN 없이)", async () => {
    const un = await hub.command("door_main", { type: "unlock" });
    expect(un).toMatchObject({ ok: true, state: { twin: { lock: "unlocked" }, matter: { lockState: "unlocked" } } });
    expect(bridgeState(hub, "door_main").doorLock!.lockState).toBe(2);
    const lock = await hub.command("door_main", { type: "lock" });
    expect(lock.state?.twin.lock).toBe("locked");
    expect(bridgeState(hub, "door_main").doorLock!.lockState).toBe(1);
  });

  it("식기세척기 시작 → OperationalState Running → twin running true", async () => {
    const r = await hub.command("dishwasher", { type: "start" });
    expect(r).toMatchObject({ ok: true, state: { twin: { running: true }, matter: { operationalState: "running" } } });
    expect(bridgeState(hub, "dishwasher").operationalState!.operationalState).toBe(1);
    const pause = await hub.command("dishwasher", { type: "pause" });
    expect(pause.state?.matter.operationalState).toBe("paused");
    const resume = await hub.command("dishwasher", { type: "start" });
    expect(resume.state?.matter.operationalState).toBe("running");
    const stop = await hub.command("dishwasher", { type: "stop" });
    expect(stop.state?.twin.running).toBe(false);
  });

  it("문 센서는 setSensor로 BooleanState를 바꾼다(에이전트 명령은 거부)", async () => {
    const r = await hub.setSensor("door_bed2", "door", "open");
    expect(r).toMatchObject({ ok: true, state: { twin: { door: "open" }, matter: { stateValue: false } } });
    expect(bridgeState(hub, "door_bed2").booleanState!.stateValue).toBe(false);
    const back = await hub.setSensor("door_bed2", "door", "closed");
    expect(back.state?.twin.door).toBe("closed");
    const cmd = await hub.command("door_bed2", { type: "on" });
    expect(cmd.ok).toBe(false);
    expect(cmd.error).toContain("센서");
    const bad = await hub.setSensor("door_bed2", "power", "on");
    expect(bad.ok).toBe(false);
    expect(bad.error).toContain("센서 값이 아닙니다");
  });

  it("문이 열린 세탁기는 시작하지 않고, 냉장고 문은 센서다", async () => {
    await hub.setSensor("washer", "door", "open");
    expect(bridgeState(hub, "washer").booleanState!.stateValue).toBe(false);
    const r = await hub.command("washer", { type: "start" });
    expect(r.ok).toBe(false);
    expect(r.error).toContain("문이 열려");
    await hub.setSensor("washer", "door", "closed");
    expect((await hub.command("washer", { type: "start" })).state?.twin.running).toBe(true);
    const fridge = await hub.setSensor("fridge", "door", "open");
    expect(fridge.state?.twin.door).toBe("open");
    expect(bridgeState(hub, "fridge").booleanState!.stateValue).toBe(false);
  });

  it("제어형 기기 종류가 모두 명령을 받는다", async () => {
    const cases: [string, Parameters<MatterHub["command"]>[1], Record<string, unknown>][] = [
      ["downlight_hall", { type: "on" }, { power: "on" }],
      ["kettle", { type: "on" }, { power: "on" }],
      ["tv_living", { type: "on" }, { power: "on" }],
      ["speaker", { type: "on" }, { power: "on" }],
      ["purifier", { type: "on" }, { power: "on" }],
      ["humidifier", { type: "on" }, { power: "on" }],
      ["hood", { type: "on" }, { power: "on" }],
      ["cooktop", { type: "on" }, { power: "on" }],
      ["microwave", { type: "on" }, { power: "on" }],
      ["dryer", { type: "start" }, { running: true }],
      ["vacuum", { type: "start" }, { running: true }],
      ["faucet", { type: "on" }, { faucet: "on" }],
      ["boiler", { type: "on" }, { heating: "on" }],
    ];
    for (const [id, cmd, twin] of cases) {
      const r = await hub.command(id, cmd);
      expect(r.error, id).toBeUndefined();
      expect(r.ok, id).toBe(true);
      expect(r.state?.twin, id).toMatchObject(twin);
      expect(hub.get(id)!.twin, id).toMatchObject(twin);
    }
    expect(bridgeState(hub, "tv_living").onOff!.onOff).toBe(true);
    expect(bridgeState(hub, "purifier").fanControl!.fanMode).toBe(5);
    expect(bridgeState(hub, "microwave").operationalState!.operationalState).toBe(1);
    expect(bridgeState(hub, "vacuum").rvcRunMode!.currentMode).toBe(1);
    expect(bridgeState(hub, "vacuum").rvcOperationalState!.operationalState).toBe(1);
    expect(bridgeState(hub, "faucet").valveConfigurationAndControl!.currentState).toBe(1);
    expect(bridgeState(hub, "boiler").thermostat!.systemMode).toBe(4);

    const vol = await hub.command("speaker", { type: "level", percent: 30 });
    expect(vol.state?.matter.level).toBe(30);
    const stopVac = await hub.command("vacuum", { type: "stop" });
    expect(stopVac.state).toMatchObject({ twin: { running: false }, matter: { runMode: "idle", operationalState: "docked" } });
    const boilerTemp = await hub.command("boiler", { type: "climate", setpointC: 25 });
    expect(boilerTemp.state?.matter).toMatchObject({ systemMode: "heat", setpointC: 25 });
    const fanHigh = await hub.command("purifier", { type: "climate", fan: "low" });
    expect(fanHigh.state?.matter.fanMode).toBe("low");
    const valveOff = await hub.command("faucet", { type: "off" });
    expect(valveOff.state?.twin.faucet).toBe("off");
  });

  it("에어컨·보일러의 모든 모드, 일시정지·재개가 Matter 값으로 간다", async () => {
    for (const mode of ["auto", "dry", "fan", "cool"] as const) {
      const r = await hub.command("ac_living", { type: "climate", mode });
      expect(r.error, mode).toBeUndefined();
      expect(r.state?.matter.systemMode, mode).toBe(mode);
    }
    expect(bridgeState(hub, "ac_living").thermostat!.systemMode).toBe(3);
    const boilerAuto = await hub.command("boiler", { type: "climate", mode: "auto" });
    expect(boilerAuto.error).toBeUndefined();
    expect(boilerAuto.state).toMatchObject({ twin: { heating: "on" }, matter: { systemMode: "auto" } });
    const boilerOff = await hub.command("boiler", { type: "off" });
    expect(boilerOff.state).toMatchObject({ twin: { heating: "off" }, matter: { systemMode: "off" } });

    await hub.command("microwave", { type: "start" });
    expect((await hub.command("microwave", { type: "pause" })).state?.matter.operationalState).toBe("paused");
    expect((await hub.command("microwave", { type: "off" })).state?.twin.power).toBe("off");

    await hub.command("vacuum", { type: "start" });
    const paused = await hub.command("vacuum", { type: "pause" });
    expect(paused.state?.matter.operationalState).toBe("paused");
    expect(bridgeState(hub, "vacuum").rvcOperationalState!.operationalState).toBe(2);
    const resumed = await hub.command("vacuum", { type: "start" });
    expect(resumed.state).toMatchObject({ twin: { running: true }, matter: { operationalState: "running", runMode: "cleaning" } });
    expect((await hub.command("vacuum", { type: "stop" })).state?.matter.operationalState).toBe("docked");
  });

  it("충전 상태(Matter 기기 아님)는 twin에서만 바뀐다", async () => {
    const r = await hub.setSensor("dock", "charging", "on");
    expect(r).toMatchObject({ ok: true, state: { twin: { charging: "on" } } });
    expect(hub.get("dock")!.twin.charging).toBe("on");
  });

  it("없는 기기·지원하지 않는 명령은 한국어 오류", async () => {
    expect(await hub.command("nope", { type: "on" })).toMatchObject({ ok: false, error: "기기를 찾을 수 없습니다: nope" });
    const r = await hub.command("tv_living", { type: "lock" });
    expect(r.ok).toBe(false);
    expect(r.error).toContain("지원하지 않는 명령");
  });

  it("구독자는 명령과 브리지 쪽 직접 변경(실제 컨트롤러 흉내) 모두를 받는다", async () => {
    const events: DeviceState[] = [];
    const unsubscribe = hub.subscribe((s) => events.push(s));
    await hub.command("tv_living", { type: "off" });
    expect(events.some((e) => e.id === "tv_living" && e.twin.power === "off")).toBe(true);

    // 다른 Matter 컨트롤러가 브리지에 직접 쓴 것처럼 엔드포인트 상태를 바꾼다
    await hub.bridgeEndpoint("kettle")!.setStateOf("onOff", { onOff: false });
    await waitFor(() => events.some((e) => e.id === "kettle" && e.twin.power === "off"));
    expect(hub.get("kettle")!.twin.power).toBe("off");

    unsubscribe();
    const before = events.length;
    await hub.command("tv_living", { type: "on" });
    await new Promise((r) => setTimeout(r, 50));
    expect(events.length).toBe(before);
  });
});

describe("MatterHub 옵션", () => {
  it("환경 변수에서 옵션을 읽는다", () => {
    expect(
      matterHubOptionsFromEnv({ MATTER_TRANSPORT: "local", MATTER_PORT: "6000", MATTER_STORAGE_DIR: "x", MATTER_DISCOVERY: "mdns", MATTER_PASSCODE: "abc" }),
    ).toEqual({ transport: "local", port: 6000, storageDir: "x", discovery: "mdns" });
    expect(matterHubOptionsFromEnv({ MATTER_TRANSPORT: "wifi" })).toEqual({});
  });

  it("createMatterHub(twin, opts)는 서버 hubFactory가 쓰는 진입점이고 undefined 옵션은 기본값을 지우지 않는다", () => {
    const hub = createMatterHub({ devices: DEVICES.slice(0, 2), initial: { light_living: { power: "on" } } }, { transport: "local", storageDir: undefined, port: undefined });
    expect(hub).toBeInstanceOf(MatterHub);
    expect(hub.info).toMatchObject({ transport: "local", port: 5540, commissioning: "none" });
    expect(hub.info.storageDir).toMatch(/\.matter$/);
    expect(hub.get("light_living")!.twin.power).toBe("on");
  });
});

describe("MatterHub 저장소 상태", () => {
  it("재시작하면 기본은 twin 초기 상태로 맞추고, keepState면 마지막 Matter 상태를 이어받는다", async () => {
    const storageDir = tempDir("persist");
    const devices = DEVICES.filter((d) => ["light_living", "door_main"].includes(d.id));
    const first = new MatterHub(devices, { transport: "local", storageDir, log: () => {} });
    await first.start();
    await first.command("light_living", { type: "on" });
    await first.command("door_main", { type: "unlock" });
    await first.stop();

    const reset = new MatterHub(devices, { transport: "local", storageDir, log: () => {} });
    await reset.start();
    expect(reset.get("light_living")!.twin.power).toBe("off");
    expect(reset.get("door_main")!.twin.lock).toBe("locked");
    expect(bridgeState(reset, "light_living").onOff!.onOff).toBe(false);
    await reset.command("light_living", { type: "on" });
    await reset.stop();

    const kept = new MatterHub(devices, { transport: "local", storageDir, keepState: true, log: () => {} });
    await kept.start();
    try {
      expect(kept.get("light_living")!.twin.power).toBe("on");
      expect(bridgeState(kept, "light_living").onOff!.onOff).toBe(true);
    } finally {
      await kept.stop();
    }
  }, 60_000);

  it("저장소 드라이버: 기본은 sqlite(파일 하나), file도 고를 수 있다", async () => {
    const devices = DEVICES.filter((d) => d.id === "light_living");
    const sqliteDir = tempDir("sqlite");
    const a = new MatterHub(devices, { transport: "local", storageDir: sqliteDir, log: () => {} });
    await a.start();
    await a.stop();
    expect(existsSync(join(sqliteDir, "twin-home-bridge", "storage.db"))).toBe(true);

    const fileDir = tempDir("file");
    const b = new MatterHub(devices, { transport: "local", storageDir: fileDir, storageDriver: "file", log: () => {} });
    await b.start();
    await b.stop();
    expect(existsSync(join(fileDir, "twin-home-bridge", "storage.db"))).toBe(false);
    expect(readdirSync(join(fileDir, "twin-home-bridge")).length).toBeGreaterThan(5);
  }, 60_000);

  it("start 전 상태는 twin 초기값에서 계산하고, 명령은 한국어 오류로 거부한다", async () => {
    const hub = localHub(DEVICES.filter((d) => d.id === "light_living"), { light_living: { power: "on" } });
    expect(hub.get("light_living")).toMatchObject({ twin: { power: "on" }, matter: { onOff: true } });
    const r = await hub.command("light_living", { type: "off" });
    expect(r.ok).toBe(false);
    expect(r.error).toContain("준비되지 않았습니다");
  });
});

describe("MatterHub local transport (twin-studio 실제 데이터)", () => {
  it("실제 기기 목록 전부가 브리지에 뜨고 거실 TV·조명을 켤 수 있다", async () => {
    let twin;
    try {
      twin = loadTwin();
    } catch {
      return; // twin-studio가 없는 환경
    }
    const hub = new MatterHub(twin.devices, { transport: "local", storageDir: tempDir("real"), initial: twin.initial, log: () => {} });
    await hub.start();
    try {
      expect(hub.states()).toHaveLength(twin.devices.length);
      const matterDevices = twin.devices.filter((d) => d.matterDeviceType !== "none");
      for (const d of matterDevices) expect(hub.bridgeEndpoint(d.id), d.id).toBeDefined();
      expect((await hub.command("tv_living", { type: "on" })).state?.twin.power).toBe("on");
      const light = twin.devices.find((d) => d.kind === "light" && d.room === "living_room");
      if (light) expect((await hub.command(light.id, { type: "on" })).state?.twin.power).toBe("on");
    } finally {
      await hub.stop();
    }
  }, 60_000);
});

describe("MatterHub network transport", () => {
  it("커미셔닝 시간 초과는 MatterNetworkError(isNetworkUnavailable)로 알리고 노드를 정리한다", async () => {
    const hub = new MatterHub(DEVICES.filter((d) => d.id === "light_living"), {
      transport: "network",
      storageDir: tempDir("timeout"),
      port: 20000 + Math.floor(Math.random() * 20000),
      commissionTimeoutMs: 1,
      log: () => {},
    });
    const error = await hub.start().then(() => undefined, (e: unknown) => e);
    expect(isNetworkUnavailable(error)).toBe(true);
    expect((error as Error).message).toContain("커미셔닝");
    expect(hub.bridgeNode).toBeUndefined();
    await new Promise((r) => setTimeout(r, 500)); // 늦게 끝난 커미셔닝이 처리되지 않은 거부로 남지 않는지
  }, 60_000);

  it("브리지를 실제로 커미셔닝하고 조명을 켜면 구독으로 돌아온다(재시작 시 커미셔닝 재사용)", async (ctx) => {
    const storageDir = tempDir("net");
    const port = 20000 + Math.floor(Math.random() * 20000);
    const devices = DEVICES.filter((d) => ["light_living", "tv_living", "dishwasher", "door_main", "dock"].includes(d.id));
    const opts = { transport: "network" as const, storageDir, port, log: () => {}, commissionTimeoutMs: 60_000 };

    const sigintBefore = process.listenerCount("SIGINT");
    const hub = new MatterHub(devices, opts);
    try {
      await hub.start();
    } catch (e) {
      await hub.stop();
      if (isNetworkUnavailable(e)) ctx.skip(`이 PC에서 Matter 네트워크 커미셔닝을 할 수 없음: ${(e as Error).message}`);
      throw e;
    }
    try {
      expect(hub.info.commissioning).toBe("new");
      expect(hub.info.subscribed).toBe(true); // start()는 컨트롤러 구독이 서고 나서 끝난다
      // 종료 신호는 앱(server/main.ts)이 처리한다. matter.js가 SIGINT를 따로 잡아 노드를 닫지 않는다
      expect(process.listenerCount("SIGINT")).toBe(sigintBefore);
      expect(hub.info.pairing?.manualPairingCode).toMatch(/^\d{11}$/);

      const events: DeviceState[] = [];
      hub.subscribe((s) => events.push(s));
      const on = await hub.command("light_living", { type: "on" });
      expect(on).toMatchObject({ ok: true, state: { twin: { power: "on" }, matter: { onOff: true } } });
      expect(bridgeState(hub, "light_living").onOff!.onOff).toBe(true);

      // 브리지 쪽에서 바뀐 값이 컨트롤러 구독으로 돌아온다
      await hub.bridgeEndpoint("light_living")!.setStateOf("onOff", { onOff: false });
      await waitFor(() => hub.get("light_living")!.twin.power === "off", 10_000);
      expect(events.some((e) => e.id === "light_living" && e.twin.power === "off")).toBe(true);

      const start = await hub.command("dishwasher", { type: "start" });
      expect(start.state?.twin.running).toBe(true);
      const unlock = await hub.command("door_main", { type: "unlock" });
      expect(unlock.state?.twin.lock).toBe("unlocked");
      const sensor = await hub.setSensor("door_main", "door", "open");
      expect(sensor.state).toMatchObject({ twin: { door: "open" }, matter: { stateValue: false } });

      // 실제 컨트롤러(Home Assistant 등)를 더 붙일 수 있게 커미셔닝 창을 연다(multi-admin)
      const root = () => hub.bridgeNode!.state as unknown as { administratorCommissioning: { windowStatus: number } };
      expect(root().administratorCommissioning.windowStatus).toBe(0);
      const pairing = await hub.openCommissioningWindow();
      expect(pairing.commissioned).toBe(true);
      expect(root().administratorCommissioning.windowStatus).not.toBe(0);
    } finally {
      await hub.stop();
    }

    // 같은 저장 폴더로 다시 띄우면 커미셔닝을 다시 하지 않는다
    const again = new MatterHub(devices, opts);
    await again.start();
    try {
      expect(again.info.commissioning).toBe("reused");
      expect(again.info.subscribed).toBe(true);
      const tv = await again.command("tv_living", { type: "on" });
      expect(tv).toMatchObject({ ok: true, state: { twin: { power: "on" } } });
      expect(bridgeState(again, "tv_living").onOff!.onOff).toBe(true);
    } finally {
      await again.stop();
    }

    // 컨트롤러 저장소만 잃으면 브리지 쪽에서 커미셔닝 창을 다시 열고 새로 커미셔닝한다
    rmSync(join(storageDir, "twin-home-controller"), { recursive: true, force: true });
    const orphan = new MatterHub(devices, opts);
    await orphan.start();
    try {
      expect(orphan.info.commissioning).toBe("new");
      expect(orphan.info.pairing?.fabrics).toBe(2); // 옛 패브릭 + 새 패브릭
      expect((await orphan.command("light_living", { type: "on" })).state?.twin.power).toBe("on");
    } finally {
      await orphan.stop();
    }
  }, 180_000);
});

async function waitFor(cond: () => boolean, timeoutMs = 3000): Promise<void> {
  const start = Date.now();
  while (!cond()) {
    if (Date.now() - start > timeoutMs) throw new Error("시간 초과");
    await new Promise((r) => setTimeout(r, 20));
  }
}

describe("formatPairingInfo", () => {
  const base = { manualPairingCode: "12345678901", qrPairingCode: "MT:ABC", passcode: 20261011, discriminator: 3011, port: 5540, fabrics: 0 };

  it("커미셔닝 전이면 이 코드로 바로 추가할 수 있다고 알린다", () => {
    const text = formatPairingInfo({ ...base, commissioned: false });
    expect(text).toContain("수동 페어링 코드: 12345678901");
    expect(text).toContain("이 코드로 추가할 수 있다");
    expect(text).not.toContain("commissioning-window");
  });

  it("이미 커미셔닝됐으면 다른 컨트롤러는 페어링 창을 먼저 열어야 한다고 알린다", () => {
    const text = formatPairingInfo({ ...base, commissioned: true, fabrics: 1 });
    expect(text).toContain("커미셔닝 됨(패브릭 1개)");
    expect(text).toContain("/api/matter/commissioning-window");
    expect(text).not.toContain("이 코드로 추가할 수 있다.");
  });
});
