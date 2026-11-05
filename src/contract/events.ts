// 서버↔화면 메시지 계약(WebSocket /events, /api 응답). 순수 타입만 둔다: ui/가 이 파일을 그대로 가져다 쓴다.
// 바꾸면 ui/src/lib/messages.ts의 parseMessage와 화면 테스트를 같이 고친다.
import type { Command, DeviceSpec, DeviceState } from "../hub/types.js";

// 좌표

export type Vec3 = [number, number, number];
export type Plan2 = [number, number];

// 에이전트

export interface AgentAction {
  tool: string;
  args: Record<string, unknown>;
  ok: boolean;
  message?: string;
  error?: string;
  deviceId?: string;
  deviceLabel?: string;
  needsConfirmation?: boolean;
  /** 생각: 모델이 이 도구를 부른 이유(모델의 설명, 판단 근거 아님). */
  reason?: string;
  /** 관찰: 도구 결과를 줄인 한 줄(observe.ts). */
  observation?: string;
  at: string;
}

export interface PendingView {
  token: string;
  deviceId: string;
  deviceLabel: string;
  command: Command;
  reason: string;
  expiresAt: string;
}

export type AgentEvent =
  | { event: "action"; sessionId: string; action: AgentAction }
  | { event: "reply"; sessionId: string; message: string; reply: string; actions: AgentAction[]; pendingConfirmations: PendingView[] }
  | { event: "pending"; sessionId: string; pending: PendingView }
  | { event: "confirmed"; sessionId?: string; token: string; ok: boolean; reply: string; deviceId?: string }
  | { event: "cancelled"; sessionId?: string; token: string };

// 판단·행동(컵 시나리오)

export interface ActionChoice { id: string; label: string }

export interface ActionPlan {
  id: string;
  task: string;
  kind: "ask_person_to_clear" | "ask_user" | "unsupported";
  dry_run: true;
  /** 실제 로봇·기기라면 했을 일(기록용). */
  would: string;
  /** 대시보드 추론 과정에 보일 글. */
  dashboard: string;
  /** 폰에 띄울 부탁·질문과 버튼. 없으면 기록만. */
  prompt: { text: string; choices: ActionChoice[] } | null;
  /** cup_gone: 컵이 안 보이게 되는지 본다. none: 답만 기록. */
  check: "cup_gone" | "none";
}

export type BrainState = "watching" | "in_use" | "away_check" | "requesting" | "deciding" | "confirming" | "acting" | "done";
export type BrainStage = "use" | "away" | "request" | "answer" | "decide" | "confirm" | "act" | "result" | "wait" | "cancel" | "stale" | "error";
export type ActionOutcome = "cleared" | "declined" | "answered" | "unconfirmed" | "unsupported" | "withdrawn";

export type BrainEvent =
  | { type: "brain"; stage: BrainStage; state: BrainState; text: string; at_ms: number; evidence_age_ms: number | null; generation: number }
  | { type: "request"; id: string; text: string; active: boolean; at_ms: number }
  | { type: "action"; id: string; task: string; plan: ActionPlan; active: boolean; at_ms: number }
  | { type: "result"; id: string; task: string; outcome: ActionOutcome; text: string; at_ms: number };

// 기기

/** GET /api/devices 한 항목: spec + 현재 상태. */
export interface DeviceView extends DeviceSpec {
  state: DeviceState;
}

// 초점

/** 초점 대상(트윈 좌표). */
export interface FocusTarget {
  id: string;
  label: string;
  position: Vec3;
}

export interface Focus {
  targets: FocusTarget[];
  at: string;
  ttl_ms: number;
}

// 클로이드의 눈

export interface EyePose {
  position: Plan2;
  height_m: number;
  yaw_deg: number;
  pitch_deg: number;
}

/** estimated: 맞추기 전 추정(창가 고정 위치 + 폰 방향). 사진의 measured_pose에는 쓰지 않는다. */
export type EyeEvent = EyePose & { tracking: "ok" | "limited"; at: string; estimated?: true };

export interface PhotoRecord {
  id: string;
  at: string;
  url: string;
  width: number;
  height: number;
  measured_pose: EyeEvent | null;
  pose_note?: "not_aligned";
}

/** /events로 화면이 받는 메시지 전체. 서버의 send·broadcast와 같은 모양이다(src/server/app.ts·home.ts, src/brain/live.ts, src/phone/feed.ts). */
export type ServerMessage =
  | { type: "hello"; devices: number; provider: string | null; hub: string; home: string | null }
  | { type: "state"; state: DeviceState }
  | ({ type: "agent" } & AgentEvent)
  | { type: "brain"; event: BrainEvent }
  | { type: "photo"; photo: PhotoRecord }
  | { type: "focus"; focus: Focus }
  | { type: "eye"; eye: EyeEvent };
