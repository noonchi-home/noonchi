// twin-home 공용 계약(docs/plan.md "인터페이스"). 바꾸려면 plan.md를 먼저 고친다.

/** 가전 종류는 등록부(src/devices/kinds.ts KINDS)의 키다. 등록부 한 곳에서 내고, 계약은 타입으로만 읽는다. */
import type { DeviceKind } from "../devices/kinds.js";

/** 기기가 받는 명령 묶음(트윈 수준). Matter에서 어떻게 실현하는지는 src/devices/mapping.ts가 정한다. */
export type Capability = "onoff" | "level" | "climate" | "fan" | "covering" | "lock" | "operation" | "valve";

/** 허브가 준 명세는 얼린 사본이다(src/devices/hub/memory.ts). */
export interface DeviceSpec {
  readonly id: string;
  readonly label: string;          // 한국어 이름(예: "거실 TV")
  readonly room: string;           // floorplan 방 id
  readonly roomLabel: string;      // 한국어 방 이름
  readonly twinType: string;       // twin-studio 카탈로그 type
  readonly kind: DeviceKind;
  readonly matterDeviceType: string; // matter.js 기기 export 이름(예: "DimmableLightDevice"), Matter 기기가 아니면 "none"
  readonly capabilities: readonly Capability[];
  readonly sensors: readonly string[];      // twin attr 이름(에이전트가 못 바꾸는 값)
  readonly twinAttrs: Readonly<Record<string, readonly unknown[]>>; // 카탈로그 attrs 그대로: 상태 이름 → 가능한 값
}

/** 허브가 준 상태는 얼린 사본이다(src/devices/hub/memory.ts): 고치려면 새 값을 만든다. */
export interface DeviceState {
  readonly id: string;
  readonly online: boolean;
  readonly twin: Readonly<Record<string, unknown>>;   // twin-studio state 값 (scene.json states와 같은 키/값)
  readonly matter: Readonly<Record<string, unknown>>; // 보기 좋은 Matter 속성 요약 (onOff, level, lockState, fanMode, operationalState, setpointC...)
  readonly updatedAt: string;
  /** "none"이면 신호 없는 기기라 상태를 모른다(twin·matter가 비어 있음, src/devices/hub/signals.ts). */
  readonly signal?: "none";
  /** 실제 가전에서 읽은 값이면 그 출처(ThinQ·TV 중계)·출처 쪽 기기 id·읽은 시각(src/devices/thinq/link.ts, src/devices/relay/link.ts). */
  readonly readback?: Readback;
  /** 카메라(World State)가 본 상태(src/devices/hub/signals.ts observe). */
  readonly vision?: VisionSeen;
}

export interface Readback {
  source: "thinq" | "relay";
  deviceId: string;
  at: string;
}

/** 카메라로 본 가전 상태. */
export interface VisionSeen {
  /** 본 트윈 속성 값(door: "open"). */
  readonly twin: Readonly<Record<string, unknown>>;
  /** 마지막으로 본 촬영 시각(ISO). */
  readonly at: string;
  /** true: 실제 출처(ThinQ 읽기·명령 받은 가상 기기)가 없어 이 값이 기기 상태다. false: 실제 상태가 이겨 보임 기록만이다. */
  readonly applied: boolean;
  /** 속성마다 그 값의 근거: 근거 사진의 촬영 시각(seenAt, epoch ms)과 VLM이 직접 답했는가(explicit). World State 가전 이력에 남는다. */
  readonly evidence?: Readonly<Record<string, SightEvidence>>;
}

/** 카메라로 본 값 하나의 근거. */
export interface SightEvidence { readonly seenAt: number; readonly explicit: boolean }

/** 카메라로 본 상태를 넘긴 결과. applied 기기 상태가 됨, seen 실제 상태와 같거나 이미 알린 다름, mismatch 실제 상태와 처음 다름(real은 다른 속성의 실제 값), ignored 모르는 기기·속성·값. */
export type VisionResult = { kind: "applied" } | { kind: "seen" } | { kind: "mismatch"; real: Record<string, unknown> } | { kind: "ignored" };

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
  /** 실제 가전(ThinQ·TV 중계)으로 보낸 명령의 결과. done: 다시 읽어 같음, unverified: 받았지만 확인 안 됨(ok: true), failed: 거부, not_sent: 보내지 않음. */
  outcome?: "done" | "unverified" | "failed" | "not_sent";
  /** 실제 가전 실행 기록(실행 id·경로·출처 쪽 기기 id). */
  execution?: { id: string; route: "thinq" | "relay"; target: string };
}

/** Correlated hub readback for one TV in the current home boot. */
export interface PowerStamp { power:"on"|"off"|null; generation:number; command_id:string|null }

export interface DeviceHub {
  start(): Promise<void>;
  stop(): Promise<void>;
  list(): DeviceSpec[];
  get(id: string): DeviceState | undefined;
  states(): DeviceState[];
  command(id: string, cmd: Command, commandId?:string): Promise<CommandResult>; // 정책 검사는 상위(policy)에서
  setSensor(id: string, attr: string, value: unknown): Promise<CommandResult>;
  subscribe(cb: (s: DeviceState) => void): () => void;
}

/** 방 목록(GET /api/rooms). floorplan rooms의 id·label. */
export interface RoomSpec {
  id: string;
  label: string;
}
