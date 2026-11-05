// twin-home 공용 계약(docs/plan.md "인터페이스"). 바꾸려면 plan.md를 먼저 고친다.

export type DeviceKind =
  | "light" | "plug" | "tv" | "speaker" | "aircon" | "purifier" | "fan" | "hood" | "cooktop"
  | "microwave" | "dishwasher" | "washer" | "dryer" | "fridge" | "vacuum" | "covering" | "lock"
  | "contact" | "valve" | "thermostat" | "status";

/** 기기가 받는 명령 묶음(트윈 수준). Matter에서 어떻게 실현하는지는 model/mapping.ts가 정한다. */
export type Capability = "onoff" | "level" | "climate" | "fan" | "covering" | "lock" | "operation" | "valve";

export interface DeviceSpec {
  id: string;
  label: string;          // 한국어 이름(예: "거실 TV")
  room: string;           // floorplan 방 id
  roomLabel: string;      // 한국어 방 이름
  twinType: string;       // twin-studio 카탈로그 type
  kind: DeviceKind;
  matterDeviceType: string; // matter.js 기기 export 이름(예: "DimmableLightDevice"), Matter 기기가 아니면 "none"
  capabilities: Capability[];
  sensors: string[];      // twin attr 이름(에이전트가 못 바꾸는 값)
  twinAttrs: Record<string, unknown[]>; // 카탈로그 attrs 그대로: 상태 이름 → 가능한 값
}

export interface DeviceState {
  id: string;
  online: boolean;
  twin: Record<string, unknown>;   // twin-studio state 값 (scene.json states와 같은 키/값)
  matter: Record<string, unknown>; // 보기 좋은 Matter 속성 요약 (onOff, level, lockState, fanMode, operationalState, setpointC...)
  updatedAt: string;
  /** "none"이면 신호 없는 기기라 상태를 모른다(twin·matter가 비어 있음, src/hub/signals.ts). */
  signal?: "none";
  /** 실제 가전(ThinQ)에서 읽은 값이면 그 출처·ThinQ 기기 id·읽은 시각(src/thinq/link.ts). */
  readback?: Readback;
}

export interface Readback {
  source: "thinq";
  deviceId: string;
  at: string;
}

export type Command =
  | { type: "on" }
  | { type: "off" }
  | { type: "level"; percent: number }
  | { type: "climate"; mode?: "cool" | "heat" | "auto" | "dry" | "fan"; setpointC?: number; fan?: "low" | "medium" | "high" | "auto" }
  | { type: "covering"; openPercent: number }
  | { type: "lock" }
  | { type: "unlock" }
  | { type: "start" }
  | { type: "stop" }
  | { type: "pause" }
  | { type: "valve"; open: boolean };

export type CommandType = Command["type"];
export type ClimateMode = NonNullable<Extract<Command, { type: "climate" }>["mode"]>;
export type FanSpeed = NonNullable<Extract<Command, { type: "climate" }>["fan"]>;

export interface CommandResult {
  ok: boolean;
  state?: DeviceState;
  error?: string;
  needsConfirmation?: { token: string; reason: string };
  /** ThinQ로 보낸 명령의 결과. done: 다시 읽어 같음, unverified: 받았지만 확인 안 됨(ok: true), failed: 거부, not_sent: 보내지 않음. */
  outcome?: "done" | "unverified" | "failed" | "not_sent";
  /** ThinQ 실행 기록(실행 id·경로·ThinQ 기기 id). */
  execution?: { id: string; route: "thinq"; target: string };
}

export interface DeviceHub {
  start(): Promise<void>;
  stop(): Promise<void>;
  list(): DeviceSpec[];
  get(id: string): DeviceState | undefined;
  states(): DeviceState[];
  command(id: string, cmd: Command): Promise<CommandResult>; // 정책 검사는 상위(policy)에서
  setSensor(id: string, attr: string, value: unknown): Promise<CommandResult>;
  subscribe(cb: (s: DeviceState) => void): () => void;
}

/** 방 목록(GET /api/rooms). floorplan rooms의 id·label. */
export interface RoomSpec {
  id: string;
  label: string;
}
