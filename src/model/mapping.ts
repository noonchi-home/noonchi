// twin-studio 카탈로그 type/attrs ↔ Matter 기기 매핑 (docs/plan.md "기기 매핑" 표).
// 종류별 표(TYPE_RULES·KIND_PROFILES·KIND_LABELS)는 가전 종류 등록부(src/model/kinds.ts)에서 파생하고, 함수들은 그 표를 해석만 한다.
// 제어 명령은 종류 이름이 아니라 프로필(profile.model)로 가른다.
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
import { KINDS, KIND_ORDER, mapEntries, type KindProfile, type Model } from "./kinds.js";

export type { KindProfile } from "./kinds.js";

export type MatterSummary = Record<string, unknown>;
export type FanMode = "off" | FanSpeed;

/** Matter 쪽 동작 한 개. cluster는 matter.js behavior id(camelCase). */
export type MatterOp =
  | { cluster: string; command: string; args?: Record<string, unknown> }
  | { cluster: string; attribute: string; value: unknown };

/** 요약 ↔ Matter 클러스터 상태. matter.js endpoint state 모양({ onOff: { onOff: true }, ... }). */
export type MatterClusters = Record<string, Record<string, unknown>>;

/** 종류 → Matter 연결(등록부 profile). */
export const KIND_PROFILES: Record<DeviceKind, KindProfile> = mapEntries(KINDS, (e) => e.profile);

export interface TypeRule {
  types?: readonly string[];
  prefixes?: readonly string[];
  kind?: DeviceKind;
  matterDeviceType?: string;            // 종류 기본값 덮어쓰기
  capabilities?: readonly Capability[]; // 종류 기본값 덮어쓰기
  twinOnly?: boolean;                   // Matter 기기 아님, twin 전용(기기 목록에서 뺀다)
}

/** twin type → 종류(등록부 twinTypes, 등록부 순서). 위에서부터 처음 맞는 규칙을 쓴다. 종류 없는 twin 전용 줄은 여기 둔다. */
export const TYPE_RULES: TypeRule[] = [
  ...KIND_ORDER.flatMap((k) => KINDS[k].twinTypes.map((t): TypeRule => ({ ...t, kind: k }))),
  { types: ["wall_pad", "robot"], twinOnly: true },
];

/** 에이전트가 못 바꾸는 attr(사람·세계 시뮬레이션이 바꾼다). */
export const SENSOR_ATTRS = ["door", "charging"];

/** 센서 attr의 값 목록(카탈로그가 없는 종류의 기본 attrs, src/model/scene.ts). */
export const SENSOR_VALUES: Readonly<Record<string, readonly unknown[]>> = { door: ["closed", "open"], charging: ["off", "on"] };

/** 카탈로그가 없는 트윈 type의 attrs: 등록부 프로필의 제어 attr(첫 이름, [꺼짐, 켜짐])과 센서 attr. 종류를 모르면 빈 attrs. */
export function profileAttrs(twinType: string): Record<string, unknown[]> {
  const kind = findTypeRule(twinType)?.kind;
  if (!kind) return {};
  const p = KIND_PROFILES[kind];
  const attrs: Record<string, unknown[]> = {};
  if (p.control) attrs[p.control.attrs[0]!] = [p.control.inactive, p.control.active];
  for (const s of p.sensors) attrs[s] = [...(SENSOR_VALUES[s] ?? ["off", "on"])];
  return attrs;
}

/** attr 기본값(꺼짐·닫힘·잠금·멈춤). 카탈로그 states.default나 placement state가 없을 때 쓴다. */
export const ATTR_DEFAULTS: Record<string, unknown> = {
  power: "off", running: false, door: "closed", lock: "locked", curtain: "open", blind: "open",
  faucet: "off", water: "off", heating: "off", charging: "off", screen: "off", mode: "sleep",
};

/** 종류 이름(등록부 label). */
export const KIND_LABELS: Record<DeviceKind, string> = mapEntries(KINDS, (e) => e.label);

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

/** 집 전용 크기 변형(twin-studio import-labels가 붙이는 wall_ac_2 같은 _숫자)은 원래 종류 규칙을 쓴다. */
export function findTypeRule(twinType: string): TypeRule | undefined {
  const match = (t: string) => TYPE_RULES.find((r) => r.types?.includes(t) || r.prefixes?.some((p) => t.startsWith(p)));
  return match(twinType) ?? match(twinType.replace(/_\d+$/, ""));
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
  caps: readonly Capability[];
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

// ── 3D 트윈에서 바꾼 twin 상태 → 명령/센서 (POST /api/devices/:id/twin) ──

export type TwinChange =
  | { type: "command"; command: Command; value: unknown }
  | { type: "sensor"; value: unknown }
  | { type: "invalid"; error: string };

/**
 * twin attr 하나를 바꾸려는 요청을 허브 동작으로 바꾼다. 값은 카탈로그 값 목록에서 고른다(문자열 "true"도 true로).
 * 센서 attr → 센서, 제어 attr → 켜기/끄기·잠금/해제·커튼 열림(0/100%). on/off는 정책·허브가 start/stop·밸브로 정규화한다.
 */
export function twinChange(spec: Pick<DeviceSpec, "kind" | "label" | "sensors" | "twinAttrs">, attr: string, value: unknown): TwinChange {
  const values = spec.twinAttrs[attr];
  if (!values) return { type: "invalid", error: `${spec.label}: 상태 ${attr}이(가) 없습니다(있는 상태: ${Object.keys(spec.twinAttrs).join(", ")}).` };
  const v = values.find((x) => x === value) ?? values.find((x) => String(x) === String(value));
  if (v === undefined) return { type: "invalid", error: `${spec.label}.${attr}: 값 ${JSON.stringify(value)}은(는) 쓸 수 없습니다(가능한 값: ${values.map(String).join(", ")}).` };
  if (spec.sensors.includes(attr)) return { type: "sensor", value: v };
  const { control, model } = KIND_PROFILES[spec.kind];
  if (!control || !control.attrs.includes(attr)) return { type: "invalid", error: `${spec.label}: ${attr}은(는) 바꿀 수 없는 상태입니다.` };
  const active = v === control.active;
  let command: Command;
  if (model === "lock") command = { type: active ? "lock" : "unlock" };
  else if (model === "covering") command = { type: "covering", openPercent: active ? 100 : 0 };
  else command = { type: active ? "on" : "off" };
  return { type: "command", command, value: v };
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

function heatingSetpoint(model: Model, systemMode: unknown): boolean {
  return model === "thermostat" || systemMode === "heat";
}

/** 명령 → Matter 클러스터 동작 목록(브리지/컨트롤러가 그대로 실행). matter는 현재 요약(선택). */
export function matterFromCommand(target: DeviceTarget, cmd: Command, matter: MatterSummary = {}): MatterOp[] {
  const { profile } = resolve(target);
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
          const heat = heatingSetpoint(model, cmd.mode ?? matter.systemMode);
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
  const { profile } = resolve(target);
  const E = MATTER_ENUMS;
  const c: MatterClusters = {};
  const put = (cluster: string, values: Record<string, unknown>) => { c[cluster] = { ...c[cluster], ...values }; };
  if (typeof s.onOff === "boolean") put("onOff", { onOff: s.onOff });
  if (typeof s.level === "number") put("levelControl", { currentLevel: levelFromPercent(s.level) });
  if (s.systemMode !== undefined) put("thermostat", { systemMode: encodeEnum(E.systemMode, s.systemMode) });
  if (typeof s.setpointC === "number") {
    const attr = heatingSetpoint(profile.model, s.systemMode) ? "occupiedHeatingSetpoint" : "occupiedCoolingSetpoint";
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
  const { profile } = resolve(target);
  const E = MATTER_ENUMS;
  const s: MatterSummary = {};
  if (typeof c.onOff?.onOff === "boolean") s.onOff = c.onOff.onOff;
  if (typeof c.levelControl?.currentLevel === "number") s.level = percentFromLevel(c.levelControl.currentLevel);
  const t = c.thermostat;
  if (t) {
    if (t.systemMode !== undefined) s.systemMode = decodeEnum(E.systemMode, t.systemMode);
    const heat = heatingSetpoint(profile.model, s.systemMode);
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
