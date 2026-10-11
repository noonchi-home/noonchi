import { describe, expect, it } from "vitest";
import type { Capability, DeviceKind, DeviceSpec, DeviceState } from "../src/hub/types.js";
import {
  applyCommandToMatter,
  applySensorToMatter,
  checkCommand,
  clustersFromSummary,
  describeDevice,
  defaultTwinValue,
  levelFromPercent,
  matterFromCommand,
  matterFromTwin,
  normalizeCommand,
  percentFromLevel,
  summaryFromClusters,
  twinFromMatter,
} from "../src/model/mapping.js";

const POWER = { power: ["off", "on"] };

function spec(id: string, twinType: string, twinAttrs: Record<string, unknown[]>): DeviceSpec {
  const d = describeDevice(twinType, twinAttrs);
  if (!d) throw new Error(`매핑 없음: ${twinType}`);
  return { id, label: id, room: "r", roomLabel: "방", twinType, twinAttrs, ...d };
}

function state(s: DeviceSpec, twin: Record<string, unknown>): DeviceState {
  return { id: s.id, online: true, twin, matter: matterFromTwin(s.kind, twin, s.twinAttrs), updatedAt: "" };
}

describe("describeDevice: plan 매핑 표", () => {
  const rows: [string, Record<string, unknown[]>, DeviceKind, string, Capability[]][] = [
    ["ceiling_light", POWER, "light", "DimmableLightDevice", ["onoff", "level"]],
    ["ceiling_panel", POWER, "light", "DimmableLightDevice", ["onoff", "level"]],
    ["pendant_lamp", POWER, "light", "DimmableLightDevice", ["onoff", "level"]],
    ["floor_lamp", POWER, "light", "DimmableLightDevice", ["onoff", "level"]],
    ["bedside_lamp", POWER, "light", "DimmableLightDevice", ["onoff", "level"]],
    ["desk_lamp", POWER, "light", "DimmableLightDevice", ["onoff", "level"]],
    ["downlight", POWER, "light", "OnOffLightDevice", ["onoff"]],
    ["tv", POWER, "tv", "BasicVideoPlayerDevice", ["onoff"]],
    ["speaker", POWER, "speaker", "SpeakerDevice", ["onoff", "level"]],
    ["monitor", POWER, "plug", "OnOffPlugInUnitDevice", ["onoff"]],
    ["kettle", POWER, "plug", "OnOffPlugInUnitDevice", ["onoff"]],
    ["rice_cooker", POWER, "plug", "OnOffPlugInUnitDevice", ["onoff"]],
    ["stand_ac", POWER, "aircon", "RoomAirConditionerDevice", ["onoff", "climate", "fan"]],
    ["wall_ac", POWER, "aircon", "RoomAirConditionerDevice", ["onoff", "climate", "fan"]],
    ["air_purifier", POWER, "purifier", "AirPurifierDevice", ["onoff", "fan"]],
    ["humidifier", POWER, "fan", "FanDevice", ["onoff", "fan"]],
    ["vent_fan", POWER, "fan", "FanDevice", ["onoff", "fan"]],
    ["range_hood", POWER, "hood", "ExtractorHoodDevice", ["onoff", "fan"]],
    ["induction_counter", POWER, "cooktop", "CooktopDevice", ["onoff"]],
    ["microwave", POWER, "microwave", "MicrowaveOvenDevice", ["operation"]],
    ["dishwasher", { running: [true, false], door: ["closed", "open"] }, "dishwasher", "DishwasherDevice", ["operation"]],
    ["washer", { running: [true, false], door: ["closed", "open"] }, "washer", "LaundryWasherDevice", ["operation"]],
    ["dryer", { running: [true, false] }, "dryer", "LaundryDryerDevice", ["operation"]],
    ["fridge", { door: ["closed", "open"] }, "fridge", "RefrigeratorDevice", []],
    ["robot_vacuum", { running: [true, false] }, "vacuum", "RoboticVacuumCleanerDevice", ["operation"]],
    ["curtain_290", { curtain: ["open", "closed"] }, "covering", "WindowCoveringDevice", ["covering"]],
    ["curtain_250", { curtain: ["open", "closed"] }, "covering", "WindowCoveringDevice", ["covering"]],
    ["blind_175", { blind: ["open", "closed"] }, "covering", "WindowCoveringDevice", ["covering"]],
    ["door_main", { door: ["closed", "open"], lock: ["locked", "unlocked"] }, "lock", "DoorLockDevice", ["lock"]],
    ["door_room_l", { door: ["closed", "open"] }, "contact", "ContactSensorDevice", []],
    ["door_bath_r", { door: ["closed", "open"] }, "contact", "ContactSensorDevice", []],
    ["door_glass_l", { door: ["closed", "open"] }, "contact", "ContactSensorDevice", []],
    ["door_fire_r", { door: ["closed", "open"] }, "contact", "ContactSensorDevice", []],
    ["sliding_door_95", { door: ["closed", "open"] }, "contact", "ContactSensorDevice", []],
    ["sink_counter", { faucet: ["off", "on"] }, "valve", "WaterValveDevice", ["valve"]],
    ["utility_sink", { faucet: ["off", "on"] }, "valve", "WaterValveDevice", ["valve"]],
    ["shower_booth", { water: ["off", "on"] }, "valve", "WaterValveDevice", ["valve"]],
    ["boiler", { heating: ["off", "on"] }, "thermostat", "ThermostatDevice", ["onoff", "climate"]],
    ["robot_dock", { charging: ["off", "on"] }, "status", "none", []],
    ["vacuum_dock", { charging: ["off", "on"] }, "status", "none", []],
    ["stick_vacuum", { charging: ["off", "on"] }, "status", "none", []],
  ];

  it.each(rows)("%s → %s", (type, attrs, kind, matterDeviceType, capabilities) => {
    const d = describeDevice(type, attrs);
    expect(d).not.toBeNull();
    expect(d!.kind).toBe(kind);
    expect(d!.matterDeviceType).toBe(matterDeviceType);
    expect([...d!.capabilities].sort()).toEqual([...capabilities].sort());
  });

  it("센서 attr: 문·충전은 센서다", () => {
    expect(describeDevice("door_main", { door: ["closed", "open"], lock: ["locked", "unlocked"] })!.sensors).toEqual(["door"]);
    expect(describeDevice("washer", { running: [true, false], door: ["closed", "open"] })!.sensors).toEqual(["door"]);
    expect(describeDevice("fridge", { door: ["closed", "open"] })!.sensors).toEqual(["door"]);
    expect(describeDevice("door_room_r", { door: ["closed", "open"] })!.sensors).toEqual(["door"]);
    expect(describeDevice("vacuum_dock", { charging: ["off", "on"] })!.sensors).toEqual(["charging"]);
    expect(describeDevice("tv", POWER)!.sensors).toEqual([]);
  });

  it("twin 전용·모르는 종류는 null", () => {
    expect(describeDevice("wall_pad", { screen: ["off", "on"] })).toBeNull();
    expect(describeDevice("robot", { mode: ["sleep", "active"] })).toBeNull();
    expect(describeDevice("sofa", {})).toBeNull();
    expect(describeDevice("mystery_box", { power: ["off", "on"] })).toBeNull();
  });
});

describe("defaultTwinValue", () => {
  it("꺼짐·닫힘·잠금·멈춤이 기본값", () => {
    expect(defaultTwinValue("power", ["off", "on"])).toBe("off");
    expect(defaultTwinValue("running", [true, false])).toBe(false);
    expect(defaultTwinValue("door", ["closed", "open"])).toBe("closed");
    expect(defaultTwinValue("lock", ["locked", "unlocked"])).toBe("locked");
    expect(defaultTwinValue("curtain", ["open", "closed"])).toBe("open");
    expect(defaultTwinValue("charging", ["off", "on"])).toBe("off");
    expect(defaultTwinValue("unknown", ["a", "b"])).toBe("a");
  });
});

describe("twin ↔ Matter 요약", () => {
  it("조명: power ↔ onOff", () => {
    const m = matterFromTwin("light", { power: "on" });
    expect(m).toMatchObject({ onOff: true, level: 100 });
    expect(twinFromMatter("light", { onOff: false, level: 40 })).toEqual({ power: "off" });
  });

  it("공기청정기·환풍기·후드: power on ↔ fanMode ≠ off", () => {
    expect(matterFromTwin("purifier", { power: "off" })).toMatchObject({ fanMode: "off" });
    expect(matterFromTwin("purifier", { power: "on" })).toMatchObject({ fanMode: "auto" });
    expect(twinFromMatter("fan", { fanMode: "low" })).toEqual({ power: "on" });
    expect(twinFromMatter("hood", { fanMode: "off" })).toEqual({ power: "off" });
  });

  it("에어컨: 기본 냉방 24도, 바람 자동", () => {
    expect(matterFromTwin("aircon", { power: "off" })).toEqual({ onOff: false, systemMode: "cool", setpointC: 24, fanMode: "auto" });
  });

  it("세탁기: running(불리언) ↔ operationalState, 문 센서 ↔ stateValue", () => {
    const attrs = { running: [true, false], door: ["closed", "open"] };
    const m = matterFromTwin("washer", { running: false, door: "open" }, attrs);
    expect(m).toEqual({ operationalState: "stopped", stateValue: false });
    expect(twinFromMatter("washer", { operationalState: "running", stateValue: true }, attrs)).toEqual({ running: true, door: "closed" });
    expect(twinFromMatter("washer", { operationalState: "paused", stateValue: true }, attrs)).toEqual({ running: false, door: "closed" });
  });

  it("전자레인지: power on ↔ Running", () => {
    expect(matterFromTwin("microwave", { power: "off" })).toEqual({ operationalState: "stopped" });
    expect(twinFromMatter("microwave", { operationalState: "running" })).toEqual({ power: "on" });
  });

  it("로봇청소기: running ↔ 청소 모드", () => {
    expect(matterFromTwin("vacuum", { running: false })).toEqual({ runMode: "idle", operationalState: "docked" });
    expect(matterFromTwin("vacuum", { running: true })).toEqual({ runMode: "cleaning", operationalState: "running" });
    expect(twinFromMatter("vacuum", { runMode: "cleaning", operationalState: "running" })).toEqual({ running: true });
  });

  it("커튼·블라인드: open ↔ 100%, closed ↔ 0%, attr 이름은 기기 attrs를 따른다", () => {
    expect(matterFromTwin("covering", { curtain: "closed" }, { curtain: ["open", "closed"] })).toEqual({ openPercent: 0 });
    expect(matterFromTwin("covering", { blind: "open" }, { blind: ["open", "closed"] })).toEqual({ openPercent: 100 });
    expect(twinFromMatter("covering", { openPercent: 0 }, ["blind"])).toEqual({ blind: "closed" });
    expect(twinFromMatter("covering", { openPercent: 30 }, ["curtain"])).toEqual({ curtain: "open" });
    expect(twinFromMatter("covering", { openPercent: 100 })).toEqual({ curtain: "open" });
  });

  it("도어록: lock ↔ lockState, door ↔ stateValue(true = 닫힘)", () => {
    const attrs = { door: ["closed", "open"], lock: ["locked", "unlocked"] };
    expect(matterFromTwin("lock", { lock: "locked", door: "closed" }, attrs)).toEqual({ lockState: "locked", stateValue: true });
    expect(twinFromMatter("lock", { lockState: "unlocked", stateValue: false }, attrs)).toEqual({ lock: "unlocked", door: "open" });
  });

  it("방문(접촉 센서)·냉장고: door만", () => {
    expect(matterFromTwin("contact", { door: "open" })).toEqual({ stateValue: false });
    expect(twinFromMatter("fridge", { stateValue: true })).toEqual({ door: "closed" });
  });

  it("수전·샤워: faucet/water ↔ valveState", () => {
    expect(matterFromTwin("valve", { faucet: "on" }, { faucet: ["off", "on"] })).toEqual({ valveState: "open" });
    expect(twinFromMatter("valve", { valveState: "closed" }, { water: ["off", "on"] })).toEqual({ water: "off" });
  });

  it("보일러: heating on ↔ systemMode heat", () => {
    expect(matterFromTwin("thermostat", { heating: "on" })).toEqual({ systemMode: "heat", setpointC: 22 });
    expect(twinFromMatter("thermostat", { systemMode: "off", setpointC: 22 })).toEqual({ heating: "off" });
  });

  it("충전 표시(status)는 Matter 기기가 아니다", () => {
    expect(matterFromTwin("status", { charging: "on" })).toEqual({});
    expect(twinFromMatter("status", {})).toEqual({});
  });
});

describe("normalizeCommand: 켜기/끄기 별칭", () => {
  it("동작형 기기는 on/off → start/stop", () => {
    const mw = spec("mw", "microwave", POWER);
    expect(normalizeCommand(mw, { type: "on" })).toEqual({ type: "start" });
    expect(normalizeCommand(mw, { type: "off" })).toEqual({ type: "stop" });
  });
  it("밸브는 on/off → valve open", () => {
    const sink = spec("sink", "sink_counter", { faucet: ["off", "on"] });
    expect(normalizeCommand(sink, { type: "on" })).toEqual({ type: "valve", open: true });
    expect(normalizeCommand(sink, { type: "off" })).toEqual({ type: "valve", open: false });
  });
  it("onoff 기기는 그대로", () => {
    const tv = spec("tv", "tv", POWER);
    expect(normalizeCommand(tv, { type: "on" })).toEqual({ type: "on" });
  });
});

describe("checkCommand: 지원·범위·센서 검사", () => {
  const tv = spec("tv", "tv", POWER);
  const light = spec("light", "ceiling_light", POWER);
  const ac = spec("ac", "stand_ac", POWER);
  const boiler = spec("boiler", "boiler", { heating: ["off", "on"] });
  const door = spec("door_bed2", "door_room_r", { door: ["closed", "open"] });
  const dw = spec("dw", "dishwasher", { running: [true, false], door: ["closed", "open"] });

  it("지원하는 명령은 null", () => {
    expect(checkCommand(tv, { type: "on" })).toBeNull();
    expect(checkCommand(light, { type: "level", percent: 30 })).toBeNull();
    expect(checkCommand(ac, { type: "climate", mode: "cool", setpointC: 22, fan: "high" })).toBeNull();
    expect(checkCommand(boiler, { type: "climate", setpointC: 23 })).toBeNull();
  });
  it("지원하지 않는 명령은 한국어 오류", () => {
    expect(checkCommand(tv, { type: "level", percent: 30 })).toMatch(/지원하지 않는/);
    expect(checkCommand(tv, { type: "unlock" })).toMatch(/지원하지 않는/);
  });
  it("센서 기기는 제어할 수 없다", () => {
    expect(checkCommand(door, { type: "on" })).toMatch(/센서/);
  });
  it("범위 검사", () => {
    expect(checkCommand(light, { type: "level", percent: 150 })).toMatch(/0~100/);
    expect(checkCommand(ac, { type: "climate", setpointC: 40 })).toMatch(/18~30/);
    expect(checkCommand(boiler, { type: "climate", mode: "cool" })).toMatch(/난방/);
    expect(checkCommand(ac, { type: "climate" })).toMatch(/설정/);
  });
  it("문이 열린 식기세척기는 시작할 수 없다", () => {
    expect(checkCommand(dw, { type: "start" }, state(dw, { running: false, door: "open" }))).toMatch(/문이 열려/);
    expect(checkCommand(dw, { type: "start" }, state(dw, { running: false, door: "closed" }))).toBeNull();
  });
  it("동작 중이 아니면 일시정지할 수 없다", () => {
    expect(checkCommand(dw, { type: "pause" }, state(dw, { running: false, door: "closed" }))).toMatch(/일시정지/);
    expect(checkCommand(dw, { type: "pause" }, state(dw, { running: true, door: "closed" }))).toBeNull();
  });
});

describe("applyCommandToMatter", () => {
  it("조명 밝기: 0보다 크면 켜지고 0이면 꺼진다", () => {
    expect(applyCommandToMatter("light", { onOff: false, level: 100 }, { type: "level", percent: 30 })).toEqual({ onOff: true, level: 30 });
    expect(applyCommandToMatter("light", { onOff: true, level: 30 }, { type: "level", percent: 0 })).toMatchObject({ onOff: false });
  });
  it("스피커 음량은 전원을 바꾸지 않는다", () => {
    expect(applyCommandToMatter("speaker", { onOff: false, level: 50 }, { type: "level", percent: 20 })).toEqual({ onOff: false, level: 20 });
  });
  it("에어컨 climate는 켜고 모드·온도·바람을 바꾼다", () => {
    const m = applyCommandToMatter("aircon", matterFromTwin("aircon", { power: "off" }), { type: "climate", mode: "heat", setpointC: 26, fan: "high" });
    expect(m).toEqual({ onOff: true, systemMode: "heat", setpointC: 26, fanMode: "high" });
  });
  it("팬 종류 on은 기본 바람 세기", () => {
    expect(applyCommandToMatter("purifier", { fanMode: "off" }, { type: "on" })).toEqual({ fanMode: "auto" });
    expect(applyCommandToMatter("fan", { fanMode: "off" }, { type: "on" })).toEqual({ fanMode: "high" });
    expect(applyCommandToMatter("hood", { fanMode: "high" }, { type: "off" })).toEqual({ fanMode: "off" });
    expect(applyCommandToMatter("purifier", { fanMode: "off" }, { type: "climate", fan: "low" })).toEqual({ fanMode: "low" });
  });
  it("커튼·도어록·밸브·보일러", () => {
    expect(applyCommandToMatter("covering", { openPercent: 100 }, { type: "covering", openPercent: 40 })).toEqual({ openPercent: 40 });
    expect(applyCommandToMatter("lock", { lockState: "locked", stateValue: true }, { type: "unlock" })).toEqual({ lockState: "unlocked", stateValue: true });
    expect(applyCommandToMatter("valve", { valveState: "closed" }, { type: "valve", open: true })).toEqual({ valveState: "open" });
    expect(applyCommandToMatter("thermostat", { systemMode: "heat", setpointC: 22 }, { type: "off" })).toEqual({ systemMode: "off", setpointC: 22 });
    expect(applyCommandToMatter("thermostat", { systemMode: "off", setpointC: 22 }, { type: "climate", setpointC: 24 })).toEqual({ systemMode: "heat", setpointC: 24 });
  });
  it("동작형: start/pause/stop", () => {
    let m = applyCommandToMatter("washer", { operationalState: "stopped", stateValue: true }, { type: "start" });
    expect(m).toEqual({ operationalState: "running", stateValue: true });
    m = applyCommandToMatter("washer", m, { type: "pause" });
    expect(m.operationalState).toBe("paused");
    m = applyCommandToMatter("washer", m, { type: "stop" });
    expect(m.operationalState).toBe("stopped");
  });
  it("로봇청소기: start → 청소, stop → 도킹", () => {
    const m = applyCommandToMatter("vacuum", { runMode: "idle", operationalState: "docked" }, { type: "start" });
    expect(m).toEqual({ runMode: "cleaning", operationalState: "running" });
    expect(applyCommandToMatter("vacuum", m, { type: "stop" })).toEqual({ runMode: "idle", operationalState: "docked" });
  });
  it("입력 객체를 바꾸지 않는다", () => {
    const before = { onOff: false, level: 100 };
    applyCommandToMatter("light", before, { type: "on" });
    expect(before).toEqual({ onOff: false, level: 100 });
  });
});

describe("applySensorToMatter", () => {
  it("문 센서 → stateValue", () => {
    expect(applySensorToMatter("fridge", { stateValue: true }, "door", "open")).toEqual({ stateValue: false });
    expect(applySensorToMatter("lock", { lockState: "locked", stateValue: false }, "door", "closed")).toEqual({ lockState: "locked", stateValue: true });
  });
  it("충전 표시는 Matter 요약을 바꾸지 않는다", () => {
    expect(applySensorToMatter("status", {}, "charging", "on")).toEqual({});
  });
});

describe("matterFromCommand: Matter 클러스터 동작", () => {
  it("OnOff", () => {
    expect(matterFromCommand("light", { type: "on" })).toEqual([{ cluster: "onOff", command: "on" }]);
    expect(matterFromCommand("tv", { type: "off" })).toEqual([{ cluster: "onOff", command: "off" }]);
  });
  it("LevelControl: 조명은 moveToLevelWithOnOff, 스피커는 moveToLevel", () => {
    expect(matterFromCommand("light", { type: "level", percent: 50 })).toEqual([
      { cluster: "levelControl", command: "moveToLevelWithOnOff", args: { level: 127, transitionTime: 0, optionsMask: {}, optionsOverride: {} } },
    ]);
    expect(matterFromCommand("speaker", { type: "level", percent: 100 })[0]).toMatchObject({ cluster: "levelControl", command: "moveToLevel", args: { level: 254 } });
  });
  it("WindowCovering: 열림 100% = lift 0", () => {
    expect(matterFromCommand("covering", { type: "covering", openPercent: 100 })).toEqual([
      { cluster: "windowCovering", command: "goToLiftPercentage", args: { liftPercent100thsValue: 0 } },
    ]);
    expect(matterFromCommand("covering", { type: "covering", openPercent: 25 })[0]).toMatchObject({ args: { liftPercent100thsValue: 7500 } });
  });
  it("DoorLock", () => {
    expect(matterFromCommand("lock", { type: "unlock" })).toEqual([{ cluster: "doorLock", command: "unlockDoor", args: {} }]);
    expect(matterFromCommand("lock", { type: "lock" })).toEqual([{ cluster: "doorLock", command: "lockDoor", args: {} }]);
  });
  it("FanControl: 공기청정기 켜기 = fanMode Auto(5)", () => {
    expect(matterFromCommand("purifier", { type: "on" })).toEqual([{ cluster: "fanControl", attribute: "fanMode", value: 5 }]);
    expect(matterFromCommand("fan", { type: "off" })).toEqual([{ cluster: "fanControl", attribute: "fanMode", value: 0 }]);
  });
  it("에어컨 climate: 켜기 + systemMode + 설정 온도(0.01°C) + fanMode", () => {
    expect(matterFromCommand("aircon", { type: "climate", mode: "cool", setpointC: 22, fan: "low" })).toEqual([
      { cluster: "onOff", command: "on" },
      { cluster: "thermostat", attribute: "systemMode", value: 3 },
      { cluster: "thermostat", attribute: "occupiedCoolingSetpoint", value: 2200 },
      { cluster: "fanControl", attribute: "fanMode", value: 1 },
    ]);
  });
  it("보일러: 켜기 = systemMode Heat(4), 설정 온도는 난방 설정값", () => {
    expect(matterFromCommand("thermostat", { type: "on" })).toEqual([{ cluster: "thermostat", attribute: "systemMode", value: 4 }]);
    expect(matterFromCommand("thermostat", { type: "climate", setpointC: 23 })).toEqual([
      { cluster: "thermostat", attribute: "systemMode", value: 4 },
      { cluster: "thermostat", attribute: "occupiedHeatingSetpoint", value: 2300 },
    ]);
  });
  it("OperationalState: 일시정지 상태에서 start는 resume", () => {
    expect(matterFromCommand("washer", { type: "start" }, { operationalState: "stopped" })).toEqual([{ cluster: "operationalState", command: "start" }]);
    expect(matterFromCommand("washer", { type: "start" }, { operationalState: "paused" })).toEqual([{ cluster: "operationalState", command: "resume" }]);
    expect(matterFromCommand("microwave", { type: "stop" })).toEqual([{ cluster: "operationalState", command: "stop" }]);
  });
  it("로봇청소기: RvcRunMode / RvcOperationalState", () => {
    expect(matterFromCommand("vacuum", { type: "start" })).toEqual([{ cluster: "rvcRunMode", command: "changeToMode", args: { newMode: 1 } }]);
    expect(matterFromCommand("vacuum", { type: "pause" })).toEqual([{ cluster: "rvcOperationalState", command: "pause" }]);
    expect(matterFromCommand("vacuum", { type: "stop" })).toEqual([
      { cluster: "rvcRunMode", command: "changeToMode", args: { newMode: 0 } },
      { cluster: "rvcOperationalState", command: "goHome" },
    ]);
  });
  it("Valve", () => {
    expect(matterFromCommand("valve", { type: "valve", open: true })).toEqual([{ cluster: "valveConfigurationAndControl", command: "open", args: {} }]);
    expect(matterFromCommand("valve", { type: "valve", open: false })).toEqual([{ cluster: "valveConfigurationAndControl", command: "close" }]);
  });
});

describe("Matter 클러스터 상태 ↔ 요약", () => {
  const samples: [DeviceKind, Record<string, unknown>][] = [
    ["light", { onOff: true, level: 60 }],
    ["light", { onOff: false, level: 100 }],
    ["tv", { onOff: true }],
    ["speaker", { onOff: true, level: 50 }],
    ["plug", { onOff: false }],
    ["aircon", { onOff: true, systemMode: "cool", setpointC: 23, fanMode: "high" }],
    ["aircon", { onOff: true, systemMode: "heat", setpointC: 26, fanMode: "auto" }],
    ["purifier", { fanMode: "auto" }],
    ["fan", { fanMode: "off" }],
    ["hood", { fanMode: "medium" }],
    ["cooktop", { onOff: true }],
    ["microwave", { operationalState: "running" }],
    ["dishwasher", { operationalState: "paused", stateValue: false }],
    ["washer", { operationalState: "stopped", stateValue: true }],
    ["dryer", { operationalState: "running" }],
    ["fridge", { stateValue: true }],
    ["vacuum", { runMode: "cleaning", operationalState: "running" }],
    ["vacuum", { runMode: "idle", operationalState: "docked" }],
    ["covering", { openPercent: 40 }],
    ["lock", { lockState: "unlocked", stateValue: false }],
    ["contact", { stateValue: false }],
    ["valve", { valveState: "open" }],
    ["thermostat", { systemMode: "heat", setpointC: 21 }],
  ];
  it.each(samples)("%s 왕복 %j", (kind, summary) => {
    const clusters = clustersFromSummary(kind, summary);
    expect(summaryFromClusters(kind, clusters)).toEqual(summary);
  });

  it("클러스터 값은 Matter 형식(열거형 숫자, 0.01°C, lift 100ths)", () => {
    expect(clustersFromSummary("aircon", { onOff: true, systemMode: "cool", setpointC: 23, fanMode: "high" })).toMatchObject({
      onOff: { onOff: true },
      thermostat: { systemMode: 3, occupiedCoolingSetpoint: 2300 },
      fanControl: { fanMode: 3 },
    });
    expect(clustersFromSummary("covering", { openPercent: 40 })).toEqual({
      windowCovering: { currentPositionLiftPercent100ths: 6000, targetPositionLiftPercent100ths: 6000 },
    });
    expect(clustersFromSummary("lock", { lockState: "locked", stateValue: true })).toEqual({
      doorLock: { lockState: 1 },
      booleanState: { stateValue: true },
    });
    expect(clustersFromSummary("light", { onOff: true, level: 100 })).toEqual({
      onOff: { onOff: true },
      levelControl: { currentLevel: 254 },
    });
  });
});

describe("밝기 변환", () => {
  it("percent ↔ Matter level(1~254)", () => {
    expect(levelFromPercent(100)).toBe(254);
    expect(levelFromPercent(50)).toBe(127);
    expect(levelFromPercent(0)).toBe(1);
    for (const p of [1, 10, 33, 50, 77, 99, 100]) expect(percentFromLevel(levelFromPercent(p))).toBe(p);
  });
});
