// twin-studio 카탈로그 type/attrs ↔ Matter 기기 매핑 (docs/plan.md "기기 매핑" 표).
// 표(데이터)는 TYPE_RULES·KIND_PROFILES에 있고, 함수들은 그 표를 해석만 한다.
//
// Matter 요약(summary) 키와 값:
//   onOff: boolean               OnOff.onOff
//   level: 0~100 (%)             LevelControl.currentLevel(1~254)을 %로
//   systemMode: "off"|"cool"|"heat"|"auto"|"dry"|"fan"   Thermostat.systemMode
//   setpointC: number (°C)       Thermostat.occupiedCooling/HeatingSetpoint(0.01°C)
//   fanMode: "off"|"low"|"medium"|"high"|"auto"          FanControl.fanMode
//   operationalState: "stopped"|"running"|"paused"|"error"(+ 로봇청소기 "docked")
//   runMode: "idle"|"cleaning"   RvcRunMode.currentMode
//   openPercent: 0~100 (100 = 활짝 열림)  WindowCovering lift(0 = 열림)를 뒤집은 값
//   lockState: "locked"|"unlocked"        DoorLock.lockState
//   valveState: "open"|"closed"           ValveConfigurationAndControl.currentState
//   stateValue: boolean (true = 닫힘/접촉) BooleanState.stateValue (문 센서)

import type { Capability, ClimateMode, Command, DeviceKind, DeviceSpec, DeviceState, FanSpeed } from "../hub/types.js";

export type MatterSummary = Record<string, unknown>;
export type FanMode = "off" | FanSpeed;

/** Matter 쪽 동작 한 개. cluster는 matter.js behavior id(camelCase). */
export type MatterOp =
  | { cluster: string; command: string; args?: Record<string, unknown> }
  | { cluster: string; attribute: string; value: unknown };

/** 요약 ↔ Matter 클러스터 상태. matter.js endpoint state 모양({ onOff: { onOff: true }, ... }). */
export type MatterClusters = Record<string, Record<string, unknown>>;

type Model = "onoff" | "fan" | "operation" | "rvc" | "covering" | "lock" | "contact" | "valve" | "thermostat" | "status";

interface Control {
  attrs: string[];   // 제어 attr 이름 후보(첫 번째가 기본)
  active: unknown;   // 켜짐/동작/열림/잠김에 해당하는 twin 값
  inactive: unknown;
}

export interface KindProfile {
  model: Model;
  matterDeviceType: string; // matter.js 기기 export 이름. Matter 기기가 아니면 "none"
  capabilities: Capability[];
  control?: Control;
  sensors: string[];        // 이 종류가 기본으로 가진 센서 attr
  defaults?: MatterSummary; // 제어값 외 Matter 요약 기본값
  fanOn?: FanMode;          // on 명령 때 fanMode
  levelTurnsOn?: boolean;   // level > 0이면 켜고 0이면 끈다(조명)
  setpoint?: { min: number; max: number };
  modes?: ClimateMode[];
}

const POWER: Control = { attrs: ["power"], active: "on", inactive: "off" };
const RUNNING: Control = { attrs: ["running"], active: true, inactive: false };

export const KIND_PROFILES: Record<DeviceKind, KindProfile> = {
  light: { model: "onoff", matterDeviceType: "DimmableLightDevice", capabilities: ["onoff", "level"], control: POWER, sensors: [], defaults: { level: 100 }, levelTurnsOn: true },
  plug: { model: "onoff", matterDeviceType: "OnOffPlugInUnitDevice", capabilities: ["onoff"], control: POWER, sensors: [] },
  tv: { model: "onoff", matterDeviceType: "BasicVideoPlayerDevice", capabilities: ["onoff"], control: POWER, sensors: [] },
  speaker: { model: "onoff", matterDeviceType: "SpeakerDevice", capabilities: ["onoff", "level"], control: POWER, sensors: [], defaults: { level: 50 } },
  aircon: {
    model: "onoff", matterDeviceType: "RoomAirConditionerDevice", capabilities: ["onoff", "climate", "fan"], control: POWER, sensors: [],
    defaults: { systemMode: "cool", setpointC: 24, fanMode: "auto" }, setpoint: { min: 18, max: 30 }, modes: ["cool", "heat", "auto", "dry", "fan"],
  },
  purifier: { model: "fan", matterDeviceType: "AirPurifierDevice", capabilities: ["onoff", "fan"], control: POWER, sensors: [], fanOn: "auto" },
  fan: { model: "fan", matterDeviceType: "FanDevice", capabilities: ["onoff", "fan"], control: POWER, sensors: [], fanOn: "high" },
  hood: { model: "fan", matterDeviceType: "ExtractorHoodDevice", capabilities: ["onoff", "fan"], control: POWER, sensors: [], fanOn: "high" },
  cooktop: { model: "onoff", matterDeviceType: "CooktopDevice", capabilities: ["onoff"], control: POWER, sensors: [] },
  microwave: { model: "operation", matterDeviceType: "MicrowaveOvenDevice", capabilities: ["operation"], control: POWER, sensors: [] },
  dishwasher: { model: "operation", matterDeviceType: "DishwasherDevice", capabilities: ["operation"], control: RUNNING, sensors: ["door"] },
  washer: { model: "operation", matterDeviceType: "LaundryWasherDevice", capabilities: ["operation"], control: RUNNING, sensors: ["door"] },
  dryer: { model: "operation", matterDeviceType: "LaundryDryerDevice", capabilities: ["operation"], control: RUNNING, sensors: [] },
  fridge: { model: "contact", matterDeviceType: "RefrigeratorDevice", capabilities: [], sensors: ["door"] },
  vacuum: { model: "rvc", matterDeviceType: "RoboticVacuumCleanerDevice", capabilities: ["operation"], control: RUNNING, sensors: [] },
  covering: { model: "covering", matterDeviceType: "WindowCoveringDevice", capabilities: ["covering"], control: { attrs: ["curtain", "blind"], active: "open", inactive: "closed" }, sensors: [] },
  lock: { model: "lock", matterDeviceType: "DoorLockDevice", capabilities: ["lock"], control: { attrs: ["lock"], active: "locked", inactive: "unlocked" }, sensors: ["door"] },
  contact: { model: "contact", matterDeviceType: "ContactSensorDevice", capabilities: [], sensors: ["door"] },
  valve: { model: "valve", matterDeviceType: "WaterValveDevice", capabilities: ["valve"], control: { attrs: ["faucet", "water"], active: "on", inactive: "off" }, sensors: [] },
  thermostat: {
    model: "thermostat", matterDeviceType: "ThermostatDevice", capabilities: ["onoff", "climate"], control: { attrs: ["heating"], active: "on", inactive: "off" }, sensors: [],
    defaults: { setpointC: 22 }, setpoint: { min: 10, max: 30 }, modes: ["heat", "auto"],
  },
  status: { model: "status", matterDeviceType: "none", capabilities: [], sensors: ["charging"] },
};

export interface TypeRule {
  types?: string[];
  prefixes?: string[];
  kind?: DeviceKind;
  matterDeviceType?: string;    // 종류 기본값 덮어쓰기
  capabilities?: Capability[];  // 종류 기본값 덮어쓰기
  twinOnly?: boolean;           // Matter 기기 아님, twin 전용(기기 목록에서 뺀다)
}

/** twin type → 종류. 위에서부터 처음 맞는 규칙을 쓴다. */
export const TYPE_RULES: TypeRule[] = [
  { types: ["ceiling_light", "ceiling_panel", "pendant_lamp", "floor_lamp", "bedside_lamp", "desk_lamp"], kind: "light" },
  { types: ["downlight"], kind: "light", matterDeviceType: "OnOffLightDevice", capabilities: ["onoff"] },
  { types: ["tv"], kind: "tv" },
  { types: ["speaker"], kind: "speaker" },
  { types: ["monitor", "kettle", "rice_cooker"], kind: "plug" },
  { types: ["stand_ac", "wall_ac"], kind: "aircon" },
  { types: ["air_purifier"], kind: "purifier" },
  { types: ["humidifier", "vent_fan"], kind: "fan" },
  { types: ["range_hood"], kind: "hood" },
  { types: ["induction_counter"], kind: "cooktop" },
  { types: ["microwave"], kind: "microwave" },
  { types: ["dishwasher"], kind: "dishwasher" },
  { types: ["washer"], kind: "washer" },
  { types: ["dryer"], kind: "dryer" },
  { types: ["fridge", "kimchi_fridge"], kind: "fridge" },
  { types: ["robot_vacuum"], kind: "vacuum" },
  { prefixes: ["curtain_", "blind_"], kind: "covering" },
  { types: ["door_main"], kind: "lock" },
  { prefixes: ["door_room_", "door_bath_", "door_glass_", "door_fire_", "sliding_door_"], kind: "contact" },
  { types: ["sink_counter", "utility_sink", "shower_booth"], kind: "valve" },
  { types: ["boiler"], kind: "thermostat" },
  { types: ["robot_dock", "vacuum_dock", "stick_vacuum"], kind: "status" },
  { types: ["wall_pad", "robot"], twinOnly: true },
];

/** 에이전트가 못 바꾸는 attr(사람·세계 시뮬레이션이 바꾼다). */
export const SENSOR_ATTRS = ["door", "charging"];

/** attr 기본값(꺼짐·닫힘·잠금·멈춤). 카탈로그 states.default나 placement state가 없을 때 쓴다. */
export const ATTR_DEFAULTS: Record<string, unknown> = {
  power: "off", running: false, door: "closed", lock: "locked", curtain: "open", blind: "open",
  faucet: "off", water: "off", heating: "off", charging: "off", screen: "off", mode: "sleep",
};

export const KIND_LABELS: Record<DeviceKind, string> = {
  light: "조명", plug: "플러그", tv: "TV", speaker: "스피커", aircon: "에어컨", purifier: "공기청정기",
  fan: "팬", hood: "후드", cooktop: "인덕션", microwave: "전자레인지", dishwasher: "식기세척기",
  washer: "세탁기", dryer: "건조기", fridge: "냉장고", vacuum: "로봇청소기", covering: "커튼·블라인드",
  lock: "도어록", contact: "문 센서", valve: "수전", thermostat: "보일러", status: "상태 표시",
};

// Matter 1.4 열거형 값
export const MATTER_ENUMS = {
  fanMode: { off: 0, low: 1, medium: 2, high: 3, on: 4, auto: 5, smart: 6 },
  systemMode: { off: 0, auto: 1, cool: 3, heat: 4, emergencyHeat: 5, precooling: 6, fan: 7, dry: 8, sleep: 9 },
  lockState: { notFullyLocked: 0, locked: 1, unlocked: 2, unlatched: 3 },
  operationalState: { stopped: 0, running: 1, paused: 2, error: 3 },
  rvcOperationalState: { stopped: 0, running: 1, paused: 2, error: 3, seekingCharger: 64, charging: 65, docked: 66 },
  /** 브리지가 RvcRunMode.supportedModes에 이 번호로 등록한다. */
  rvcRunMode: { idle: 0, cleaning: 1 },
  valveState: { closed: 0, open: 1, transitioning: 2 },
} as const;

type EnumMap = Record<string, number>;

export function encodeEnum(map: EnumMap, key: unknown): number | undefined {
  return typeof key === "string" && key in map ? map[key] : undefined;
}

export function decodeEnum(map: EnumMap, value: unknown): string | undefined {
  for (const [k, v] of Object.entries(map)) if (v === value) return k;
  return undefined;
}

/** 0~100% → LevelControl currentLevel(1~254). */
export function levelFromPercent(percent: number): number {
  return Math.min(254, Math.max(1, Math.round(percent * 2.54)));
}

export function percentFromLevel(level: number): number {
  return Math.min(100, Math.max(0, Math.round(level / 2.54)));
}

/** 열림 % → WindowCovering liftPercent100ths(0 = 활짝 열림, 10000 = 닫힘). */
export function liftFromOpenPercent(openPercent: number): number {
  return Math.round((100 - openPercent) * 100);
}

export function openPercentFromLift(lift100ths: number): number {
  return 100 - Math.round(lift100ths / 100);
}

// ── 종류 판정 ──────────────────────────────────────────────

export function findTypeRule(twinType: string): TypeRule | undefined {
  return TYPE_RULES.find((r) => r.types?.includes(twinType) || r.prefixes?.some((p) => twinType.startsWith(p)));
}

export interface DeviceDescription {
  kind: DeviceKind;
  matterDeviceType: string;
  capabilities: Capability[];
  sensors: string[];
}

/** twin type + attrs → 기기 설명. 상태 없는 것·twin 전용·모르는 종류는 null. */
export function describeDevice(twinType: string, twinAttrs: Record<string, unknown[]>): DeviceDescription | null {
  const rule = findTypeRule(twinType);
  if (!rule || rule.twinOnly || !rule.kind) return null;
  const attrNames = Object.keys(twinAttrs);
  if (attrNames.length === 0) return null;
  const profile = KIND_PROFILES[rule.kind];
  return {
    kind: rule.kind,
    matterDeviceType: rule.matterDeviceType ?? profile.matterDeviceType,
    capabilities: [...(rule.capabilities ?? profile.capabilities)],
    sensors: attrNames.filter((a) => SENSOR_ATTRS.includes(a)),
  };
}

export function defaultTwinValue(attr: string, values: unknown[]): unknown {
  const preferred = ATTR_DEFAULTS[attr];
  if (preferred !== undefined && (values.length === 0 || values.includes(preferred))) return preferred;
  return values[0];
}

// ── 요약 계산 ──────────────────────────────────────────────

/** 종류 이름 또는 기기 spec(능력·attrs까지 반영). */
export type DeviceTarget = DeviceKind | (Pick<DeviceSpec, "kind"> & Partial<Pick<DeviceSpec, "capabilities" | "twinAttrs">>);
export type AttrNames = string[] | Record<string, unknown[]>;

interface Resolved {
  kind: DeviceKind;
  profile: KindProfile;
  caps: Capability[];
  attrNames?: string[];
}

function resolve(target: DeviceTarget, attrs?: AttrNames): Resolved {
  const kind = typeof target === "string" ? target : target.kind;
  const profile = KIND_PROFILES[kind];
  const caps = (typeof target === "string" ? undefined : target.capabilities) ?? profile.capabilities;
  const source = attrs ?? (typeof target === "string" ? undefined : target.twinAttrs);
  const attrNames = source === undefined ? undefined : Array.isArray(source) ? source : Object.keys(source);
  return { kind, profile, caps, attrNames };
}

function controlAttr(r: Resolved): string | undefined {
  const c = r.profile.control;
  if (!c) return undefined;
  if (!r.attrNames) return c.attrs[0];
  return c.attrs.find((a) => r.attrNames!.includes(a));
}

function hasDoorSensor(r: Resolved): boolean {
  return r.attrNames ? r.attrNames.includes("door") : r.profile.sensors.includes("door");
}

/** 모델별로 "켜짐/동작/열림/잠김"을 나타내는 요약 키. */
const MODEL_KEY: Partial<Record<Model, string>> = {
  onoff: "onOff", fan: "fanMode", operation: "operationalState", rvc: "operationalState",
  covering: "openPercent", lock: "lockState", valve: "valveState", thermostat: "systemMode",
};

function isActive(model: Model, m: MatterSummary): boolean {
  switch (model) {
    case "onoff": return m.onOff === true;
    case "fan": return typeof m.fanMode === "string" && m.fanMode !== "off";
    case "operation":
    case "rvc": return m.operationalState === "running";
    case "covering": return Number(m.openPercent) > 0;
    case "lock": return m.lockState === "locked";
    case "valve": return m.valveState === "open";
    case "thermostat": return m.systemMode !== "off";
    default: return false;
  }
}

/** Matter 요약 → twin 상태(제어 attr + 문 센서). 요약에 없는 값은 건드리지 않는다. */
export function twinFromMatter(target: DeviceTarget, matter: MatterSummary, attrs?: AttrNames): Record<string, unknown> {
  const r = resolve(target, attrs);
  const twin: Record<string, unknown> = {};
  const attr = controlAttr(r);
  const key = MODEL_KEY[r.profile.model];
  if (attr && key && matter[key] !== undefined) {
    twin[attr] = isActive(r.profile.model, matter) ? r.profile.control!.active : r.profile.control!.inactive;
  }
  if (hasDoorSensor(r) && typeof matter.stateValue === "boolean") twin.door = matter.stateValue ? "closed" : "open";
  return twin;
}

/** twin 상태 → Matter 요약(초기값). */
export function matterFromTwin(target: DeviceTarget, twin: Record<string, unknown>, attrs?: AttrNames): MatterSummary {
  const r = resolve(target, attrs);
  const { profile } = r;
  const attr = controlAttr(r);
  const active = attr !== undefined && twin[attr] === profile.control!.active;
  const defaults = { ...profile.defaults };
  if (!r.caps.includes("level")) delete defaults.level;
  let m: MatterSummary;
  switch (profile.model) {
    case "onoff": m = { onOff: active, ...defaults }; break;
    case "fan": m = { fanMode: active ? profile.fanOn : "off" }; break;
    case "operation": m = { operationalState: active ? "running" : "stopped" }; break;
    case "rvc": m = active ? { runMode: "cleaning", operationalState: "running" } : { runMode: "idle", operationalState: "docked" }; break;
    case "covering": m = { openPercent: active ? 100 : 0 }; break;
    case "lock": m = { lockState: active ? "locked" : "unlocked" }; break;
    case "valve": m = { valveState: active ? "open" : "closed" }; break;
    case "thermostat": m = { systemMode: active ? "heat" : "off", ...defaults }; break;
    default: m = {};
  }
  if (hasDoorSensor(r) && profile.model !== "status") m.stateValue = twin.door !== "open";
  return m;
}

// ── 명령 ──────────────────────────────────────────────────

/** 켜기/끄기 별칭: onoff가 없는 동작형은 start/stop, 밸브는 valve open/close. */
export function normalizeCommand(spec: Pick<DeviceSpec, "capabilities">, cmd: Command): Command {
  if ((cmd.type === "on" || cmd.type === "off") && !spec.capabilities.includes("onoff")) {
    if (spec.capabilities.includes("operation")) return { type: cmd.type === "on" ? "start" : "stop" };
    if (spec.capabilities.includes("valve")) return { type: "valve", open: cmd.type === "on" };
  }
  return cmd;
}

const MODE_LABELS: Record<ClimateMode, string> = { cool: "냉방(cool)", heat: "난방(heat)", auto: "자동(auto)", dry: "제습(dry)", fan: "송풍(fan)" };
const FAN_SPEEDS: FanSpeed[] = ["low", "medium", "high", "auto"];

function inRange(v: unknown, min: number, max: number): boolean {
  return typeof v === "number" && Number.isFinite(v) && v >= min && v <= max;
}

/** 명령을 실행할 수 없으면 한국어 이유, 가능하면 null. 정책(승인)은 따로 본다. */
export function checkCommand(
  spec: Pick<DeviceSpec, "kind" | "label" | "capabilities" | "sensors">,
  cmd: Command,
  state?: Pick<DeviceState, "twin" | "matter">,
): string | null {
  const name = spec.label;
  const caps = spec.capabilities;
  if (caps.length === 0) {
    return spec.sensors.length > 0
      ? `${name}: 센서 기기라 제어할 수 없습니다(${spec.sensors.join(", ")}).`
      : `${name}: 제어할 수 있는 기능이 없습니다.`;
  }
  const c = normalizeCommand(spec, cmd);
  const unsupported = `${name}: 지원하지 않는 명령입니다(${c.type}).`;
  const profile = KIND_PROFILES[spec.kind];
  switch (c.type) {
    case "on":
    case "off":
      return caps.includes("onoff") ? null : unsupported;
    case "level":
      if (!caps.includes("level")) return unsupported;
      return inRange(c.percent, 0, 100) ? null : `${name}: 값은 0~100 사이여야 합니다(받은 값: ${String(c.percent)}).`;
    case "climate": {
      const wantsClimate = c.mode !== undefined || c.setpointC !== undefined;
      const wantsFan = c.fan !== undefined;
      if (!wantsClimate && !wantsFan) return `${name}: 바꿀 설정(mode, setpointC, fan)이 없습니다.`;
      if (wantsClimate && !caps.includes("climate")) return unsupported;
      if (wantsFan && !caps.includes("fan")) return unsupported;
      if (c.mode !== undefined && profile.modes && !profile.modes.includes(c.mode)) {
        return `${name}: 지원하지 않는 모드입니다(${c.mode}). 가능한 모드: ${profile.modes.map((m) => MODE_LABELS[m]).join(", ")}.`;
      }
      if (c.setpointC !== undefined && profile.setpoint && !inRange(c.setpointC, profile.setpoint.min, profile.setpoint.max)) {
        return `${name}: 설정 온도는 ${profile.setpoint.min}~${profile.setpoint.max}°C 사이여야 합니다(받은 값: ${String(c.setpointC)}).`;
      }
      if (c.fan !== undefined && !FAN_SPEEDS.includes(c.fan)) return `${name}: 바람 세기는 ${FAN_SPEEDS.join(", ")} 중 하나여야 합니다.`;
      return null;
    }
    case "covering":
      if (!caps.includes("covering")) return unsupported;
      return inRange(c.openPercent, 0, 100) ? null : `${name}: 열림 정도는 0~100 사이여야 합니다(받은 값: ${String(c.openPercent)}).`;
    case "lock":
    case "unlock":
      return caps.includes("lock") ? null : unsupported;
    case "start":
      if (!caps.includes("operation")) return unsupported;
      if (spec.sensors.includes("door") && state?.twin.door === "open") return `${name}: 문이 열려 있어 시작할 수 없습니다.`;
      return null;
    case "stop":
      return caps.includes("operation") ? null : unsupported;
    case "pause":
      if (!caps.includes("operation")) return unsupported;
      if (state && state.matter.operationalState !== "running") return `${name}: 동작 중이 아니라 일시정지할 수 없습니다.`;
      return null;
    case "valve":
      if (!caps.includes("valve")) return unsupported;
      return typeof c.open === "boolean" ? null : `${name}: open은 true/false여야 합니다.`;
    default:
      return `${name}: 알 수 없는 명령입니다(${(c as { type?: unknown }).type as string}).`;
  }
}

/** 명령을 Matter 요약에 적용한 새 요약(입력은 바꾸지 않는다). 검사는 checkCommand에서 먼저 한다. */
export function applyCommandToMatter(target: DeviceTarget, matter: MatterSummary, cmd: Command): MatterSummary {
  const { profile } = resolve(target);
  const m: MatterSummary = { ...matter };
  const model = profile.model;
  switch (cmd.type) {
    case "on":
    case "off": {
      const on = cmd.type === "on";
      if (model === "onoff") m.onOff = on;
      else if (model === "fan") m.fanMode = on ? profile.fanOn : "off";
      else if (model === "thermostat") m.systemMode = on ? (m.systemMode && m.systemMode !== "off" ? m.systemMode : "heat") : "off";
      else if (model === "operation" || model === "rvc") return applyCommandToMatter(target, matter, { type: on ? "start" : "stop" });
      else if (model === "valve") m.valveState = on ? "open" : "closed";
      break;
    }
    case "level":
      m.level = cmd.percent;
      if (profile.levelTurnsOn) m.onOff = cmd.percent > 0;
      break;
    case "climate":
      if (model === "onoff") {
        m.onOff = true;
        if (cmd.mode !== undefined) m.systemMode = cmd.mode;
        if (cmd.setpointC !== undefined) m.setpointC = cmd.setpointC;
        if (cmd.fan !== undefined) m.fanMode = cmd.fan;
      } else if (model === "fan") {
        if (cmd.fan !== undefined) m.fanMode = cmd.fan;
      } else if (model === "thermostat") {
        if (cmd.mode !== undefined) m.systemMode = cmd.mode === "auto" ? "auto" : "heat";
        else if (!m.systemMode || m.systemMode === "off") m.systemMode = "heat";
        if (cmd.setpointC !== undefined) m.setpointC = cmd.setpointC;
      }
      break;
    case "covering":
      m.openPercent = cmd.openPercent;
      break;
    case "lock":
      m.lockState = "locked";
      break;
    case "unlock":
      m.lockState = "unlocked";
      break;
    case "start":
      if (model === "rvc") Object.assign(m, { runMode: "cleaning", operationalState: "running" });
      else m.operationalState = "running";
      break;
    case "stop":
      if (model === "rvc") Object.assign(m, { runMode: "idle", operationalState: "docked" });
      else m.operationalState = "stopped";
      break;
    case "pause":
      m.operationalState = "paused";
      break;
    case "valve":
      m.valveState = cmd.open ? "open" : "closed";
      break;
  }
  return m;
}

/** 센서 attr 변경을 Matter 요약에 반영(문 → BooleanState). */
export function applySensorToMatter(target: DeviceTarget, matter: MatterSummary, attr: string, value: unknown): MatterSummary {
  const { profile } = resolve(target);
  const m: MatterSummary = { ...matter };
  if (attr === "door" && profile.model !== "status") m.stateValue = value !== "open";
  return m;
}

const LEVEL_ARGS = { transitionTime: 0, optionsMask: {}, optionsOverride: {} };

function heatingSetpoint(kind: DeviceKind, systemMode: unknown): boolean {
  return kind === "thermostat" || systemMode === "heat";
}

/** 명령 → Matter 클러스터 동작 목록(브리지/컨트롤러가 그대로 실행). matter는 현재 요약(선택). */
export function matterFromCommand(target: DeviceTarget, cmd: Command, matter: MatterSummary = {}): MatterOp[] {
  const { kind, profile } = resolve(target);
  const model = profile.model;
  const E = MATTER_ENUMS;
  switch (cmd.type) {
    case "on":
    case "off": {
      const on = cmd.type === "on";
      if (model === "onoff") return [{ cluster: "onOff", command: cmd.type }];
      if (model === "fan") return [{ cluster: "fanControl", attribute: "fanMode", value: encodeEnum(E.fanMode, on ? profile.fanOn : "off") }];
      if (model === "thermostat") return [{ cluster: "thermostat", attribute: "systemMode", value: on ? E.systemMode.heat : E.systemMode.off }];
      if (model === "operation" || model === "rvc") return matterFromCommand(target, { type: on ? "start" : "stop" }, matter);
      if (model === "valve") return matterFromCommand(target, { type: "valve", open: on }, matter);
      return [];
    }
    case "level":
      return [{
        cluster: "levelControl",
        command: profile.levelTurnsOn ? "moveToLevelWithOnOff" : "moveToLevel",
        args: { level: levelFromPercent(cmd.percent), ...LEVEL_ARGS },
      }];
    case "climate": {
      const ops: MatterOp[] = [];
      if (model === "onoff") {
        ops.push({ cluster: "onOff", command: "on" });
        if (cmd.mode !== undefined) ops.push({ cluster: "thermostat", attribute: "systemMode", value: encodeEnum(E.systemMode, cmd.mode) });
        if (cmd.setpointC !== undefined) {
          const heat = heatingSetpoint(kind, cmd.mode ?? matter.systemMode);
          ops.push({ cluster: "thermostat", attribute: heat ? "occupiedHeatingSetpoint" : "occupiedCoolingSetpoint", value: Math.round(cmd.setpointC * 100) });
        }
        if (cmd.fan !== undefined) ops.push({ cluster: "fanControl", attribute: "fanMode", value: encodeEnum(E.fanMode, cmd.fan) });
      } else if (model === "fan") {
        if (cmd.fan !== undefined) ops.push({ cluster: "fanControl", attribute: "fanMode", value: encodeEnum(E.fanMode, cmd.fan) });
      } else if (model === "thermostat") {
        const mode = cmd.mode ?? (matter.systemMode === "auto" ? "auto" : "heat");
        ops.push({ cluster: "thermostat", attribute: "systemMode", value: mode === "auto" ? E.systemMode.auto : E.systemMode.heat });
        if (cmd.setpointC !== undefined) ops.push({ cluster: "thermostat", attribute: "occupiedHeatingSetpoint", value: Math.round(cmd.setpointC * 100) });
      }
      return ops;
    }
    case "covering":
      return [{ cluster: "windowCovering", command: "goToLiftPercentage", args: { liftPercent100thsValue: liftFromOpenPercent(cmd.openPercent) } }];
    case "lock":
      return [{ cluster: "doorLock", command: "lockDoor", args: {} }];
    case "unlock":
      return [{ cluster: "doorLock", command: "unlockDoor", args: {} }];
    case "start":
      if (model === "rvc") {
        return matter.operationalState === "paused"
          ? [{ cluster: "rvcOperationalState", command: "resume" }]
          : [{ cluster: "rvcRunMode", command: "changeToMode", args: { newMode: E.rvcRunMode.cleaning } }];
      }
      return [{ cluster: "operationalState", command: matter.operationalState === "paused" ? "resume" : "start" }];
    case "stop":
      if (model === "rvc") {
        return [
          { cluster: "rvcRunMode", command: "changeToMode", args: { newMode: E.rvcRunMode.idle } },
          { cluster: "rvcOperationalState", command: "goHome" },
        ];
      }
      return [{ cluster: "operationalState", command: "stop" }];
    case "pause":
      return [{ cluster: model === "rvc" ? "rvcOperationalState" : "operationalState", command: "pause" }];
    case "valve":
      return cmd.open
        ? [{ cluster: "valveConfigurationAndControl", command: "open", args: {} }]
        : [{ cluster: "valveConfigurationAndControl", command: "close" }];
  }
  return [];
}

// ── 요약 ↔ Matter 클러스터 상태 ───────────────────────────────

/** 요약 → matter.js endpoint state 모양(브리지 초기 상태·쓰기용). 요약에 있는 값만 만든다. */
export function clustersFromSummary(target: DeviceTarget, s: MatterSummary): MatterClusters {
  const { kind, profile } = resolve(target);
  const E = MATTER_ENUMS;
  const c: MatterClusters = {};
  const put = (cluster: string, values: Record<string, unknown>) => { c[cluster] = { ...c[cluster], ...values }; };
  if (typeof s.onOff === "boolean") put("onOff", { onOff: s.onOff });
  if (typeof s.level === "number") put("levelControl", { currentLevel: levelFromPercent(s.level) });
  if (s.systemMode !== undefined) put("thermostat", { systemMode: encodeEnum(E.systemMode, s.systemMode) });
  if (typeof s.setpointC === "number") {
    const attr = heatingSetpoint(kind, s.systemMode) ? "occupiedHeatingSetpoint" : "occupiedCoolingSetpoint";
    put("thermostat", { [attr]: Math.round(s.setpointC * 100) });
  }
  if (s.fanMode !== undefined) put("fanControl", { fanMode: encodeEnum(E.fanMode, s.fanMode) });
  if (s.operationalState !== undefined) {
    if (profile.model === "rvc") put("rvcOperationalState", { operationalState: encodeEnum(E.rvcOperationalState, s.operationalState) });
    else put("operationalState", { operationalState: encodeEnum(E.operationalState, s.operationalState) });
  }
  if (s.runMode !== undefined) put("rvcRunMode", { currentMode: encodeEnum(E.rvcRunMode, s.runMode) });
  if (typeof s.openPercent === "number") {
    const lift = liftFromOpenPercent(s.openPercent);
    put("windowCovering", { currentPositionLiftPercent100ths: lift, targetPositionLiftPercent100ths: lift });
  }
  if (s.lockState !== undefined) put("doorLock", { lockState: encodeEnum(E.lockState, s.lockState) });
  if (s.valveState !== undefined) put("valveConfigurationAndControl", { currentState: encodeEnum(E.valveState, s.valveState) });
  if (typeof s.stateValue === "boolean") put("booleanState", { stateValue: s.stateValue });
  return c;
}

/** matter.js endpoint state(또는 구독으로 받은 속성) → 요약. 있는 클러스터만 읽는다. */
export function summaryFromClusters(target: DeviceTarget, c: MatterClusters): MatterSummary {
  const { kind, profile } = resolve(target);
  const E = MATTER_ENUMS;
  const s: MatterSummary = {};
  if (typeof c.onOff?.onOff === "boolean") s.onOff = c.onOff.onOff;
  if (typeof c.levelControl?.currentLevel === "number") s.level = percentFromLevel(c.levelControl.currentLevel);
  const t = c.thermostat;
  if (t) {
    if (t.systemMode !== undefined) s.systemMode = decodeEnum(E.systemMode, t.systemMode);
    const heat = heatingSetpoint(kind, s.systemMode);
    const raw = heat ? t.occupiedHeatingSetpoint : t.occupiedCoolingSetpoint;
    if (typeof raw === "number") s.setpointC = raw / 100;
  }
  if (c.fanControl?.fanMode !== undefined) s.fanMode = decodeEnum(E.fanMode, c.fanControl.fanMode);
  if (profile.model === "rvc") {
    if (c.rvcRunMode?.currentMode !== undefined) s.runMode = decodeEnum(E.rvcRunMode, c.rvcRunMode.currentMode);
    if (c.rvcOperationalState?.operationalState !== undefined) s.operationalState = decodeEnum(E.rvcOperationalState, c.rvcOperationalState.operationalState);
  } else if (c.operationalState?.operationalState !== undefined) {
    s.operationalState = decodeEnum(E.operationalState, c.operationalState.operationalState);
  }
  const lift = c.windowCovering?.currentPositionLiftPercent100ths;
  if (typeof lift === "number") s.openPercent = openPercentFromLift(lift);
  if (c.doorLock?.lockState !== undefined) s.lockState = decodeEnum(E.lockState, c.doorLock.lockState);
  if (c.valveConfigurationAndControl?.currentState !== undefined) s.valveState = decodeEnum(E.valveState, c.valveConfigurationAndControl.currentState);
  if (typeof c.booleanState?.stateValue === "boolean") s.stateValue = c.booleanState.stateValue;
  return s;
}
