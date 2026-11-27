// 적외선 리모컨 등록 계약. 허브(src/server/ir-setup.ts)와 Android 앱(apps/android/ir-remotes.ts)이 같이 쓴다.
// 두 작업 가지가 이 파일을 똑같이 만든다. 바꿀 때는 control이 계획(plans/2026-11-27-ir-remote-registration.md)부터 고친다.

/** 단추 뜻. on·off·toggle은 전원 단추(turn_on·turn_off가 쓴다), null은 그 밖 단추(press_remote가 쓴다). */
export type RemoteRole = "on" | "off" | "toggle" | null;
export const REMOTE_ROLES = ["on", "off", "toggle"] as const;

/** 수신기가 해석한 신호(IRremote 방식 이름·주소·명령). */
export interface IrDecoded { protocol: string; address: number; command: number }

/** 저장한 신호. nec: NEC 주소·명령. raw: 켜짐·꺼짐 길이(50 µs 칸, 값 1~255, 4~750칸)와 반송파 kHz. */
export type IrSignal =
  | { kind: "nec"; address: number; command: number }
  | { kind: "raw"; khz: number; ticks: number[]; decoded: IrDecoded | null };

/** none 고른 포트 없음 · connecting 여는 중 · connected 답 받음 · wrong_firmware 다른 펌웨어 · silent 답 없음 · missing 그 USB 장치 없음 · busy 다른 프로그램이 씀 · lost 연결 끊김. */
export type IrPortState = "none" | "connecting" | "connected" | "wrong_firmware" | "silent" | "missing" | "busy" | "lost";

export interface IrButtonView { id: string; label: string; role: RemoteRole; signal: IrSignal["kind"] }
export interface IrRemoteView {
  id: string; label: string; device: string; deviceLabel: string; roomLabel: string; deviceKind: string; buttons: IrButtonView[];
}

export type IrLearnState = "waiting" | "saved" | "timeout" | "duplicate" | "overflow" | "lost" | "cancelled";
export interface IrLearnView {
  remote: string;
  label: string;
  role: RemoteRole;
  state: IrLearnState;
  /** 같은 신호를 받은 횟수(0·1). 두 번째에 저장한다. */
  presses: number;
  /** waiting일 때 남은 시간(ms). 끝난 뒤 0. */
  left_ms: number;
  /** saved: 저장한 단추 id. */
  button?: string;
  /** duplicate: 같은 신호를 가진 단추 이름. */
  duplicate_of?: string;
}

/** 리모컨을 달 수 있는 트윈 가전(위험 켜기 종류·도어록·이미 리모컨이 있는 가전은 뺀다). */
export interface IrDeviceChoice { id: string; label: string; roomLabel: string; kind: string }

/** GET /api/setup/ir?home=<id> 와 바꾸기 API 대부분의 답. */
export interface IrView {
  ok: true;
  home: string;
  mode: "test" | "live";
  port: { name: string | null; state: IrPortState };
  remotes: IrRemoteView[];
  learning: IrLearnView | null;
  devices: IrDeviceChoice[];
}

/** ir_bridge 쓸 수 있음 · other 다른 펌웨어 · silent 답 없음 · in_use 다른 프로그램이 씀. 허브가 연 포트는 그 연결 상태로 적는다. */
export type IrFirmware = "ir_bridge" | "other" | "silent" | "in_use";
export interface IrPortChoice { name: string; label: string; firmware: IrFirmware }
/** GET /api/setup/ir/ports (USB 직렬 포트만. 블루투스 직렬 포트는 열지 않는다). */
export interface IrPortsView { ok: true; ports: IrPortChoice[] }
/** POST /api/setup/ir/test. */
export interface IrTestView { ok: true; sent: true }

export const IR_PRESETS = ["lg_tv_power"] as const;
export type IrPreset = (typeof IR_PRESETS)[number];

export const IR_LABEL_MAX = 20;
export const IR_LEARN_MS = 30_000;

export const IR_PATHS = {
  view: "/api/setup/ir",
  ports: "/api/setup/ir/ports",
  port: "/api/setup/ir/port",
  remote: "/api/setup/ir/remote",
  remoteDelete: "/api/setup/ir/remote/delete",
  learn: "/api/setup/ir/learn",
  learnCancel: "/api/setup/ir/learn/cancel",
  buttonDelete: "/api/setup/ir/button/delete",
  test: "/api/setup/ir/test",
  preset: "/api/setup/ir/preset",
} as const;

export interface IrPortBody { home: string; port: string }
export interface IrRemoteBody { home: string; id?: string; label: string; device: string }
export interface IrRemoteDeleteBody { home: string; id: string }
export interface IrLearnBody { home: string; remote: string; label: string; role: RemoteRole }
export interface IrHomeBody { home: string }
export interface IrButtonBody { home: string; remote: string; button: string }
export interface IrTestBody { home: string; remote: string; button: string; confirm: true }
export interface IrPresetBody { home: string; remote: string; preset: IrPreset }

/** 허브가 내는 리모컨 사건(트레이스가 받는다). sent: 허브가 단추 신호를 보냄 · pressed: 사람이 등록한 단추를 누름. */
export interface RemoteEvent {
  kind: "sent" | "pressed"; device: string; remote: string; button: string; role: RemoteRole; at_ms: number; command_id: string | null;
}
