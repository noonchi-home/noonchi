// 가전 종류 등록부: 하나뿐인 원본. 가전 종류마다 이름·찾기 말·Matter 연결(프로필)·트윈 type·승인·위험 가전 이름·손 조작·카메라 낱말·ThinQ·사건·상태 글을 여기에만 둔다.
// 흩어진 곳(src/model/mapping.ts KIND_PROFILES·KIND_LABELS·TYPE_RULES, src/agent/search.ts KIND_SYNONYMS, src/agent/policy.ts CONFIRM_RULES·RISKY_ON_NAMES,
// src/plan/labels.ts CAUTION_LINE, src/agent/planTools.ts DEVICE_ACTS, src/thinq/appliance.ts PAIRABLE_KINDS, src/world/sight.ts·state.ts·relations.ts)은 여기서 파생해 읽는다.
// 새 종류는 여기 한 줄 + 집 파일(twin/data/homes/<집>/added_devices.json) 한 줄(docs/reference.md 「새 종류 추가하는 법」). 등록부 밖 종류별 표는 tests/kinds-registry.test.ts가 막는다.
// 런타임 import 없음(type import만). ui 타입 검사가 src/hub/types.ts를 거쳐 읽으므로 Dockerfile ui 단계가 이 파일과 src/world/vocab.ts를 COPY한다.
import type { Capability, ClimateMode, CommandType, FanSpeed } from "../hub/types.js";
import type { ThinqAdapter } from "../thinq/appliance.js";
import type { DeviceLongKey, DeviceStateKey, FixtureClass, SightRule } from "../world/vocab.js";

/** Matter 쪽 모델: 켜짐·동작·열림·잠김을 어떤 요약 키로 나타내는가(src/model/mapping.ts가 해석한다). */
export type Model = "onoff" | "fan" | "operation" | "rvc" | "covering" | "lock" | "contact" | "valve" | "thermostat" | "status";

export interface Control {
  /** 제어 attr 이름 후보(첫 번째가 기본). */
  attrs: readonly string[];
  /** 켜짐/동작/열림/잠김에 해당하는 twin 값. */
  active: unknown;
  inactive: unknown;
}

/** Matter 연결. */
export interface KindProfile {
  model: Model;
  /** matter.js 기기 export 이름. Matter 기기가 아니면 "none". */
  matterDeviceType: string;
  capabilities: readonly Capability[];
  control?: Control;
  /** 이 종류가 기본으로 가진 센서 attr. */
  sensors: readonly string[];
  /** 제어값 외 Matter 요약 기본값. */
  defaults?: Readonly<Record<string, unknown>>;
  /** on 명령 때 fanMode. */
  fanOn?: "off" | FanSpeed;
  /** level > 0이면 켜고 0이면 끈다(조명). */
  levelTurnsOn?: true;
  setpoint?: { min: number; max: number };
  modes?: readonly ClimateMode[];
}

/** 사람이 손으로 하는 동작. */
export type HandAct = "켜기" | "끄기" | "열기" | "닫기";

/** 트윈 type → 이 종류(위에서 처음 맞는 것). Matter 기기 종류·기능을 덮어쓸 수 있다. */
export interface TwinTypeRule {
  types?: readonly string[];
  prefixes?: readonly string[];
  matterDeviceType?: string;
  capabilities?: readonly Capability[];
}

export interface KindEntry {
  /** 화면·에이전트 이름. */
  label: string;
  /** 찾기 말(소문자, 띄어쓰기 없음). */
  synonyms: readonly string[];
  profile: KindProfile;
  twinTypes: readonly TwinTypeRule[];
  /** 그 명령 하나를 늘 승인(잠금 해제처럼 정규화해도 이름이 하나뿐인 명령)과 까닭 글. 위험 켜기 종류(riskyOn)에는 쓰지 않는다(src/model/kinds-check.ts). */
  confirm?: { command: CommandType; reason: (label: string) => string };
  /** 위험 가전: 부르는 이름(별명·흔한 오타·영어 포함, 이름 기본 거부)과 켜기 전 안전 문구. 끄기 말고 상태를 바꾸는 명령은 모두 승인을 묻는다(src/agent/policy.ts needsConfirm). */
  riskyOn?: { names: readonly string[]; caution: string };
  /** 위험 켜기 종류(riskyOn)의 승인 까닭 글. */
  riskyReason?: (label: string) => string;
  /** 사람이 손으로 하는 동작. */
  hand?: readonly HandAct[];
  /** 다 되면 스스로 멈춤(Task 12가 더한다). */
  selfStop?: true;
  /** 카메라 설비 종류와 맞추는 규칙(같은 방의 이 종류 가전에 넘긴다). */
  camera?: { fixture: FixtureClass; sight: readonly SightRule[] };
  /** ThinQ 짝짓기: ThinQ deviceType과 읽기·제어·반영을 맡는 어댑터(src/thinq/appliance.ts THINQ_ADAPTERS). */
  thinq?: { type: RegExp; adapter: ThinqAdapter };
  /** 오래 이어지면 나는 사건(src/world/vocab.ts DEVICE_LONG). */
  longEvents?: readonly DeviceLongKey[];
  /** 이 종류에서 바꿔 쓰는 상태 글·사건 글. */
  stateText?: Partial<Record<DeviceStateKey, { label?: string; became?: string }>>;
}

const POWER: Control = { attrs: ["power"], active: "on", inactive: "off" };
const RUNNING: Control = { attrs: ["running"], active: true, inactive: false };

/** 순서가 곧 TYPE_RULES 순서·에이전트 도구 enum 순서다. */
const ENTRIES = {
  light: {
    label: "조명", synonyms: ["불", "조명", "등", "전등", "전구", "램프", "라이트"],
    profile: { model: "onoff", matterDeviceType: "DimmableLightDevice", capabilities: ["onoff", "level"], control: POWER, sensors: [], defaults: { level: 100 }, levelTurnsOn: true },
    twinTypes: [
      { types: ["ceiling_light", "ceiling_panel", "pendant_lamp", "floor_lamp", "bedside_lamp", "desk_lamp"] },
      { types: ["downlight"], matterDeviceType: "OnOffLightDevice", capabilities: ["onoff"] },
    ],
  },
  plug: {
    label: "플러그", synonyms: ["플러그", "콘센트"],
    profile: { model: "onoff", matterDeviceType: "OnOffPlugInUnitDevice", capabilities: ["onoff"], control: POWER, sensors: [] },
    twinTypes: [{ types: ["monitor", "kettle", "rice_cooker"] }],
  },
  tv: {
    label: "TV", synonyms: ["tv", "티비", "텔레비전", "테레비"],
    profile: { model: "onoff", matterDeviceType: "BasicVideoPlayerDevice", capabilities: ["onoff"], control: POWER, sensors: [] },
    twinTypes: [{ types: ["tv"] }],
    camera: { fixture: "tv", sight: [{ facet: "screen", attr: "power", values: { screen_on: "on", screen_off: "off" } }] },
  },
  speaker: {
    label: "스피커", synonyms: ["스피커"],
    profile: { model: "onoff", matterDeviceType: "SpeakerDevice", capabilities: ["onoff", "level"], control: POWER, sensors: [], defaults: { level: 50 } },
    twinTypes: [{ types: ["speaker"] }],
  },
  aircon: {
    label: "에어컨", synonyms: ["에어컨", "에어콘", "냉방기"],
    profile: {
      model: "onoff", matterDeviceType: "RoomAirConditionerDevice", capabilities: ["onoff", "climate", "fan"], control: POWER, sensors: [],
      defaults: { systemMode: "cool", setpointC: 24, fanMode: "auto" }, setpoint: { min: 18, max: 30 }, modes: ["cool", "heat", "auto", "dry", "fan"],
    },
    twinTypes: [{ types: ["stand_ac", "wall_ac"] }],
    thinq: { type: /AIR_CONDITIONER/i, adapter: "air_conditioner" },
  },
  purifier: {
    label: "공기청정기", synonyms: ["공기청정기", "청정기"],
    profile: { model: "fan", matterDeviceType: "AirPurifierDevice", capabilities: ["onoff", "fan"], control: POWER, sensors: [], fanOn: "auto" },
    twinTypes: [{ types: ["air_purifier"] }],
  },
  fan: {
    label: "팬", synonyms: ["팬", "환풍기", "선풍기", "가습기"],
    profile: { model: "fan", matterDeviceType: "FanDevice", capabilities: ["onoff", "fan"], control: POWER, sensors: [], fanOn: "high" },
    twinTypes: [{ types: ["humidifier", "vent_fan"] }],
  },
  hood: {
    label: "후드", synonyms: ["후드", "레인지후드"],
    profile: { model: "fan", matterDeviceType: "ExtractorHoodDevice", capabilities: ["onoff", "fan"], control: POWER, sensors: [], fanOn: "high" },
    twinTypes: [{ types: ["range_hood"] }],
  },
  cooktop: {
    label: "인덕션", synonyms: ["인덕션", "쿡탑", "가스레인지", "화구"],
    profile: { model: "onoff", matterDeviceType: "CooktopDevice", capabilities: ["onoff"], control: POWER, sensors: [] },
    twinTypes: [{ types: ["induction_counter"] }],
    riskyOn: {
      // 세 글자 이상인 이름은 띄어 써도 찾는다. 「레인지」만 쓰면 전자레인지로 본다(가스레인지·전기레인지는 긴 이름이 먼저 맞는다)
      names: ["인덕션", "인덕선", "인덕숀", "전기레인지", "전기렌지", "가스레인지", "가스렌지", "하이라이트", "가스불", "화구", "버너", "쿡탑", "쿡톱", "induction", "cooktop"],
      caution: "냄비와 상판이 뜨거워져요.",
    },
    riskyReason: (l) => `${l} 켜기는 화재 위험이 있어 사용자 승인이 필요합니다.`,
    hand: ["켜기", "끄기"],
  },
  microwave: {
    label: "전자레인지", synonyms: ["전자레인지", "전자렌지"],
    profile: { model: "operation", matterDeviceType: "MicrowaveOvenDevice", capabilities: ["operation"], control: POWER, sensors: [] },
    twinTypes: [{ types: ["microwave"] }],
    riskyOn: { names: ["전자레인지", "전자렌지", "레인지", "microwave"], caution: "그릇이 뜨거워져요." },
    riskyReason: (l) => `${l} 시작은 사용자 승인이 필요합니다.`,
    hand: ["열기", "닫기", "켜기", "끄기"],
    camera: {
      fixture: "microwave",
      sight: [
        { facet: "use", attr: "power", values: { in_use: "on" }, absent: "off" },
        { facet: "open", attr: "door", values: { open: "open", closed: "closed" } },
      ],
    },
  },
  dishwasher: {
    label: "식기세척기", synonyms: ["식기세척기", "식세기"],
    profile: { model: "operation", matterDeviceType: "DishwasherDevice", capabilities: ["operation"], control: RUNNING, sensors: ["door"] },
    twinTypes: [{ types: ["dishwasher"] }],
    // 식기세척기 멈춤은 출처 규칙대로 이용 가능(docs/provenance.md)
    stateText: { running: { became: "세척 시작" }, stopped: { label: "이용 가능", became: "세척 멈춤" } },
  },
  washer: {
    label: "세탁기", synonyms: ["세탁기"],
    profile: { model: "operation", matterDeviceType: "LaundryWasherDevice", capabilities: ["operation"], control: RUNNING, sensors: ["door"] },
    twinTypes: [{ types: ["washer"] }],
    stateText: { running: { became: "세탁 시작" }, stopped: { became: "세탁 멈춤" } },
  },
  dryer: {
    label: "건조기", synonyms: ["건조기"],
    profile: { model: "operation", matterDeviceType: "LaundryDryerDevice", capabilities: ["operation"], control: RUNNING, sensors: [] },
    twinTypes: [{ types: ["dryer"] }],
    stateText: { running: { became: "건조 시작" }, stopped: { became: "건조 멈춤" } },
  },
  fridge: {
    label: "냉장고", synonyms: ["냉장고"],
    profile: { model: "contact", matterDeviceType: "RefrigeratorDevice", capabilities: [], sensors: ["door"] },
    twinTypes: [{ types: ["fridge", "kimchi_fridge", "freezer"] }],
    hand: ["열기", "닫기"],
    camera: { fixture: "refrigerator", sight: [{ facet: "open", attr: "door", values: { open: "open", closed: "closed" } }] },
    thinq: { type: /REFRIGERATOR/i, adapter: "refrigerator" },
    longEvents: ["door_open_long"],
  },
  vacuum: {
    label: "로봇청소기", synonyms: ["로봇청소기", "청소기", "로청"],
    profile: { model: "rvc", matterDeviceType: "RoboticVacuumCleanerDevice", capabilities: ["operation"], control: RUNNING, sensors: [] },
    twinTypes: [{ types: ["robot_vacuum"] }],
    stateText: { running: { became: "청소 시작" }, stopped: { became: "청소 멈춤" } },
  },
  covering: {
    label: "커튼·블라인드", synonyms: ["커튼", "블라인드"],
    profile: { model: "covering", matterDeviceType: "WindowCoveringDevice", capabilities: ["covering"], control: { attrs: ["curtain", "blind"], active: "open", inactive: "closed" }, sensors: [] },
    twinTypes: [{ prefixes: ["curtain_", "blind_"] }],
  },
  lock: {
    label: "도어록", synonyms: ["현관문", "도어락", "도어록", "문", "현관"],
    profile: { model: "lock", matterDeviceType: "DoorLockDevice", capabilities: ["lock"], control: { attrs: ["lock"], active: "locked", inactive: "unlocked" }, sensors: ["door"] },
    twinTypes: [{ types: ["door_main"] }],
    confirm: { command: "unlock", reason: (l) => `${l} 잠금 해제는 사용자 승인이 필요합니다.` },
    longEvents: ["door_open_long"],
  },
  contact: {
    label: "문 센서", synonyms: ["문"],
    profile: { model: "contact", matterDeviceType: "ContactSensorDevice", capabilities: [], sensors: ["door"] },
    twinTypes: [{ prefixes: ["door_room_", "door_bath_", "door_glass_", "door_fire_", "sliding_door_"] }],
  },
  valve: {
    label: "수전", synonyms: ["물", "수도", "수전", "샤워", "싱크"],
    profile: { model: "valve", matterDeviceType: "WaterValveDevice", capabilities: ["valve"], control: { attrs: ["faucet", "water"], active: "on", inactive: "off" }, sensors: [] },
    twinTypes: [{ types: ["sink_counter", "utility_sink", "shower_booth"] }],
    camera: { fixture: "sink", sight: [{ facet: "use", attr: "faucet", values: { water_running: "on" }, absent: "off" }] },
  },
  thermostat: {
    label: "보일러", synonyms: ["보일러", "난방"],
    profile: {
      model: "thermostat", matterDeviceType: "ThermostatDevice", capabilities: ["onoff", "climate"], control: { attrs: ["heating"], active: "on", inactive: "off" }, sensors: [],
      defaults: { setpointC: 22 }, setpoint: { min: 10, max: 30 }, modes: ["heat", "auto"],
    },
    twinTypes: [{ types: ["boiler"] }],
  },
  status: {
    label: "상태 표시", synonyms: ["충전대"],
    profile: { model: "status", matterDeviceType: "none", capabilities: [], sensors: ["charging"] },
    twinTypes: [{ types: ["robot_dock", "vacuum_dock", "stick_vacuum"] }],
  },
} satisfies Record<string, KindEntry>;

export type DeviceKind = keyof typeof ENTRIES;

/** 가전 종류 등록부. */
export const KINDS: Readonly<Record<DeviceKind, KindEntry>> = ENTRIES;

// ── 파생(쓰는 곳은 이것만 읽는다) ──

/** 등록부 순서. */
export const KIND_ORDER: readonly DeviceKind[] = Object.keys(KINDS) as DeviceKind[];

/** 등록부의 종류마다 값 하나(등록부 순서). */
export function mapEntries<V>(kinds: Readonly<Record<DeviceKind, KindEntry>>, fn: (entry: KindEntry, kind: DeviceKind) => V): Record<DeviceKind, V> {
  return Object.fromEntries((Object.keys(kinds) as DeviceKind[]).map((k) => [k, fn(kinds[k], k)])) as Record<DeviceKind, V>;
}

/** 이름 있는 종류의 항목. 모르는 이름이면 undefined. */
export function kindEntry(kind: string | null | undefined): KindEntry | undefined {
  return kind && Object.hasOwn(KINDS, kind) ? KINDS[kind as DeviceKind] : undefined;
}

export const kindLabel = (kind: DeviceKind): string => KINDS[kind].label;

/** 위험 가전 종류인가(riskyOn이 있는 종류). */
export const isRiskyKind = (kind: string | null | undefined): kind is DeviceKind => !!kindEntry(kind)?.riskyOn;

/** 카메라 설비 종류 → 그 설비로 맞추는 가전 종류(camera.fixture). 없으면 null. */
export function cameraKindOf(fixture: FixtureClass): DeviceKind | null {
  return KIND_ORDER.find((k) => KINDS[k].camera?.fixture === fixture) ?? null;
}
