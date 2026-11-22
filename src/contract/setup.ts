// 설정 화면 ↔ 서버 계약(GET /api/setup, /api/setup/*). 순수 타입만 둔다: ui/가 이 파일을 그대로 가져다 쓴다.
import type { RoomSpec } from "./devices.js";
import type { StationMap } from "./stations.js";

export interface SetupStationsView {
  ok: true;
  home: string;
  map: StationMap;
}
import type { DeviceKind } from "../devices/kinds.js";

/** test: 시험 모드(트윈에서만, ThinQ를 부르지 않음, 기본). live: 실제 모드(짝지은 기기는 ThinQ로 실제 가전). */
export type ControlMode = "test" | "live";


/** ThinQ 기기 목록 한 줄(GET /api/setup/thinq). */
export interface ThinqDeviceView {
  id: string;
  /** ThinQ deviceType(예: DEVICE_AIR_CONDITIONER). */
  type: string;
  /** ThinQ 앱에서 붙인 이름(alias). */
  name: string;
  model: string;
  /** 짝지을 수 있는 트윈 기기 종류(에어컨·냉장고). 맞는 종류가 없으면 null. */
  kind: DeviceKind | null;
}

/** 설정 2단계 기기 한 줄. source는 저장한 출처(가상·신호 없음), pairable은 ThinQ와 짝지을 수 있는 종류(에어컨·냉장고). */
export interface SetupDeviceView {
  id: string;
  label: string;
  room: string;
  roomLabel: string;
  kind: DeviceKind;
  kindLabel: string;
  source: { kind: "virtual" | "none" };
  pairable: boolean;
}

/** GET /api/setup 과 설정 쓰기 응답. */
export interface SetupView {
  ok: true;
  persist: boolean;
  done: boolean;
  switching: boolean;
  error: string | null;
  home: { id: string; name: string } | null;
  homes: { id: string; name: string }[];
  rooms: RoomSpec[];
  devices: SetupDeviceView[];
  devices_saved: boolean;
  /** 4단계: start는 시작 위치를 쓸 수 있다(집 scene.json이 있음), layout은 배치 보정을 쓸 수 있다. */
  position: { start: boolean; layout: boolean; phone_urls: string[] };
  mode: ControlMode;
  /** ready: ThinQ 토큰이 있어 실제 모드로 바꿀 수 있다. */
  thinq: { ready: boolean };
  /** This home has a configured IR TV. Connection and power are reported by the hub. */
  ir?: { ready: boolean };
  /** 트윈 기기 id → ThinQ 기기 id(실제 모드에서만 쓴다). */
  pairs: Record<string, string>;
}

/** GET /api/setup/thinq. */
export interface ThinqDevicesView {
  ok: true;
  devices: ThinqDeviceView[];
}
