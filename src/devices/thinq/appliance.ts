// ThinQ 상태 ↔ 트윈. 자원·속성 이름은 LG 공식 SDK(thinqconnect/devices/air_conditioner.py, refrigerator.py)를 따른다.
//   에어컨: operation.airConOperationMode, airConJobMode.currentJobMode, temperatureInUnits[unit C].targetTemperature, airFlow.windStrength
//   냉장고: doorStatus[locationName MAIN].doorState(문 닫기 명령은 없다)
// 실제 가전 값과 다를 수 있는 부분은 docs/reference.md 「운영 모드」의 「실제 연결 때 확인할 것」.
// 읽기·제어·트윈 반영은 가전 종류 이름이 아니라 어댑터(THINQ_ADAPTERS)로 가른다. 가전 종류는 등록부 thinq.adapter로 어댑터를 고른다(src/devices/kinds.ts).

import type { ClimateMode, Command, CommandType, DeviceState, FanSpeed } from "../../contract/devices.js";
import type { DeviceKind } from "../kinds.js";
import { KINDS, KIND_ORDER, kindEntry } from "../kinds.js";
import type { ThinqAdapter } from "../types.js";

/** 설정에서 ThinQ 기기와 짝지을 수 있는 트윈 기기 종류(등록부 thinq). */
export const PAIRABLE_KINDS: DeviceKind[] = KIND_ORDER.filter((k) => KINDS[k].thinq);

/** 트윈 기기 종류와 ThinQ deviceType이 맞는가(등록부 thinq.type). */
export function fitsKind(kind: DeviceKind, thinqType: string): boolean {
  return KINDS[kind]?.thinq?.type.test(thinqType) ?? false;
}

/** ThinQ에서 읽은 값(트윈 말로). 모르는 값은 비운다. */
export interface Reading {
  power?: "on" | "off";
  mode?: ClimateMode;
  setpointC?: number;
  fan?: FanSpeed;
  currentC?: number;
  door?: "open" | "closed";
}

export interface ThinqStep {
  /** 로그·답에 쓰는 한 단계 이름. */
  name: string;
  /** POST devices/{id}/control 본문. */
  body: Record<string, unknown>;
  /** 다시 읽은 값이 이 단계의 목표와 같은가. */
  done(r: Reading): boolean;
}

const JOB: Record<ClimateMode, string> = { cool: "COOL", heat: "HEAT", auto: "AUTO", dry: "AIR_DRY", fan: "FAN" };
const WIND: Record<FanSpeed, string> = { low: "LOW", medium: "MID", high: "HIGH", auto: "AUTO" };
const MODE_NAME: Record<ClimateMode, string> = { cool: "냉방", heat: "난방", auto: "자동", dry: "제습", fan: "송풍" };
const WIND_NAME: Record<FanSpeed, string> = { low: "약하게", medium: "중간", high: "세게", auto: "자동" };

const reverse = <K extends string>(m: Record<K, string>) => Object.fromEntries(Object.entries(m).map(([k, v]) => [v, k])) as Record<string, K>;
const JOB_BACK = reverse(JOB);
const WIND_BACK = reverse(WIND);

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj | undefined => (v && typeof v === "object" && !Array.isArray(v) ? v as Obj : undefined);
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : undefined);

/** 섭씨 온도 항목: temperatureInUnits(배열이면 unit C 항목) → temperature(unit이 C이거나 없을 때). */
function celsius(raw: Obj): Obj | undefined {
  const inUnits = raw.temperatureInUnits;
  if (Array.isArray(inUnits)) return inUnits.map(obj).find((e) => e?.unit === "C");
  const one = obj(inUnits) ?? obj(raw.temperature);
  return one && (one.unit === undefined || one.unit === "C") ? one : undefined;
}

/** doorStatus: 배열이면 MAIN 항목(없으면 첫 항목), 객체면 그대로. */
function mainDoor(raw: Obj): Obj | undefined {
  const s = raw.doorStatus;
  if (Array.isArray(s)) {
    const list = s.map(obj).filter((e): e is Obj => !!e);
    return list.find((e) => e.locationName === "MAIN") ?? list[0];
  }
  return obj(s);
}

function clean(r: Reading): Reading {
  return Object.fromEntries(Object.entries(r).filter(([, v]) => v !== undefined)) as Reading;
}


const powerStep = (on: boolean): ThinqStep => ({
  name: on ? "전원 켜기" : "전원 끄기",
  body: { operation: { airConOperationMode: on ? "POWER_ON" : "POWER_OFF" } },
  done: (r) => r.power === (on ? "on" : "off"),
});

/** 에어컨: 트윈 명령 → ThinQ 단계(한 번에 하나씩 보낸다). ThinQ로 보낼 수 없으면 null. 냉난방 설정은 켜기를 먼저 한다. */
function airConditionerSteps(cmd: Command): ThinqStep[] | null {
  if (cmd.type === "on" || cmd.type === "off") return [powerStep(cmd.type === "on")];
  if (cmd.type !== "climate") return null;
  const steps: ThinqStep[] = [powerStep(true)];
  const { mode, setpointC, fan } = cmd;
  if (mode !== undefined) steps.push({ name: `모드 ${MODE_NAME[mode]}`, body: { airConJobMode: { currentJobMode: JOB[mode] } }, done: (r) => r.mode === mode });
  if (setpointC !== undefined) {
    steps.push({ name: `설정 온도 ${setpointC}도`, body: { temperatureInUnits: { targetTemperature: setpointC, unit: "C" } }, done: (r) => r.setpointC === setpointC });
  }
  if (fan !== undefined) steps.push({ name: `바람 ${WIND_NAME[fan]}`, body: { airFlow: { windStrength: WIND[fan] } }, done: (r) => r.fan === fan });
  return steps;
}

type World = Pick<DeviceState, "twin" | "matter">;
type Mirror = { commands: Command[]; sensors: [string, unknown][] };

/** 에어컨이 읽은 값을 트윈에 비추는 명령. 달라진 것만. climate 명령은 에어컨을 켜므로 전원은 맨 뒤에 맞춘다. */
function airConditionerMirror(r: Reading, world: World): Mirror {
  const commands: Command[] = [];
  const m = world.matter;
  const climate: Extract<Command, { type: "climate" }> = { type: "climate" };
  if (r.mode !== undefined && r.mode !== m.systemMode) climate.mode = r.mode;
  if (r.setpointC !== undefined && r.setpointC !== m.setpointC) climate.setpointC = r.setpointC;
  if (r.fan !== undefined && r.fan !== m.fanMode) climate.fan = r.fan;
  const changed = Object.keys(climate).length > 1;
  if (changed) commands.push(climate);
  const onNow = changed ? true : m.onOff === true;
  const want = r.power === undefined ? m.onOff === true : r.power === "on";
  if (want !== onNow) commands.push({ type: want ? "on" : "off" });
  return { commands, sensors: [] };
}

export interface ThinqAdapterSpec {
  read: (raw: Record<string, unknown>) => Reading;
  /** 받는 명령 종류(정규화한 이름). 빈 목록이면 읽기만. */
  commands: readonly CommandType[];
  steps: (cmd: Command) => ThinqStep[] | null;
  /** 읽은 값을 트윈(안쪽 허브)에 비추는 명령·센서 값. 달라진 것만. */
  mirror: (r: Reading, world: World) => Mirror;
}

export const THINQ_ADAPTERS: Record<ThinqAdapter, ThinqAdapterSpec> = {
  air_conditioner: {
    read: (raw) => {
      const op = obj(raw.operation)?.airConOperationMode;
      const t = celsius(raw);
      return clean({
        power: op === "POWER_ON" ? "on" : op === "POWER_OFF" ? "off" : undefined,
        mode: JOB_BACK[String(obj(raw.airConJobMode)?.currentJobMode)],
        setpointC: num(t?.targetTemperature),
        currentC: num(t?.currentTemperature),
        fan: WIND_BACK[String(obj(raw.airFlow)?.windStrength)],
      });
    },
    commands: ["on", "off", "climate"],
    steps: airConditionerSteps,
    mirror: airConditionerMirror,
  },
  refrigerator: {
    read: (raw) => {
      const d = mainDoor(raw)?.doorState;
      return clean({ door: d === "OPEN" ? "open" : d === "CLOSE" ? "closed" : undefined });
    },
    commands: [],
    steps: () => null,
    mirror: (r, world) => ({ commands: [], sensors: r.door !== undefined && r.door !== world.twin.door ? [["door", r.door]] : [] }),
  },
};

/** 그 가전 종류를 맡는 ThinQ 어댑터(등록부 thinq.adapter). 없으면 null. */
export const thinqAdapterOf = (kind: string): ThinqAdapter | null => kindEntry(kind)?.thinq?.adapter ?? null;

/** ThinQ에서 읽은 원본 값 → 트윈 말. */
export const readAppliance = (adapter: ThinqAdapter, raw: Record<string, unknown>): Reading => THINQ_ADAPTERS[adapter].read(raw);
/** 트윈 명령 → ThinQ 단계. ThinQ로 보낼 수 없으면 null. */
export const thinqSteps = (adapter: ThinqAdapter, cmd: Command): ThinqStep[] | null => THINQ_ADAPTERS[adapter].steps(cmd);
/** 읽은 값을 트윈(안쪽 허브)에 비추는 명령·센서 값. */
export const mirrorPlan = (adapter: ThinqAdapter, r: Reading, world: World): Mirror => THINQ_ADAPTERS[adapter].mirror(r, world);
