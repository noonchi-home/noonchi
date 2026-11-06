// 서버↔화면 메시지 계약(WebSocket /events, /api 응답). 순수 타입만 둔다: ui/가 이 파일을 그대로 가져다 쓴다.
// 바꾸면 ui/src/lib/messages.ts의 parseMessage와 화면 테스트를 같이 고친다.
import type { Command, DeviceSpec, DeviceState } from "../hub/types.js";
import type { PlanView } from "./plan.js";
import type { ControlMode } from "./setup.js";

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

/** POST /api/agent/chat 응답. */
export interface ChatResult {
  sessionId: string;
  reply: string;
  actions: AgentAction[];
  pendingConfirmations: PendingView[];
  provider: string;
}

/** POST /api/agent/confirm 응답. */
export interface ConfirmResult {
  ok: boolean;
  reply: string;
  error?: string;
  deviceId?: string;
  state?: DeviceState;
  action?: AgentAction;
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

export type Tri = "yes" | "no" | "unknown";

/** 판정(VLM) 기록 한 줄. */
export interface PerceptionLog {
  type: "perception";
  at_ms: number;
  evidence_age_ms: number;
  frames: number;
  summary: string;
  cost_usd: number;
  /** 요청 답 사진 한 장으로 본 판정. */
  answer?: true;
  error?: string;
}

/** 존재 판정(YOLO)이 바뀔 때만 내는 기록. */
export interface PresenceLog {
  type: "presence";
  at_ms: number;
  evidence_age_ms: number;
  person: Tri;
  cup: Tri;
  table: Tri;
  /** 창 안 가장 높은 점수(기록용). */
  scores: { person: number; cup: number };
  summary: string;
}

/** 컵 두뇌가 대시보드로 보내는 것 전부(src/brain/live.ts route). */
export type BrainLog = BrainEvent | PerceptionLog | PresenceLog;

// 기기

/** GET /api/devices 한 항목: spec + 현재 상태. */
export interface DeviceView extends DeviceSpec {
  state: DeviceState;
}

// 서버 상태

/** GET /api/health. */
export interface HealthView {
  ok: true;
  devices: number;
  hub: string;
  transport: string | null;
  provider: string | null;
  model: string | null;
  /** 이 집의 3D 트윈(twin-studio 뷰어)이 있는가. */
  twin: boolean;
  /** 폰 서버(클로이드의 눈)가 떠 있는가. */
  eye: boolean;
  home: { id: string; name: string } | null;
  /** 폰에서 열 주소들(와이파이·VPN 어댑터마다 하나). */
  phone_urls: string[];
  brain: boolean;
  /** 운영 모드: test 시험(트윈만), live 실제(짝지은 가전은 ThinQ). */
  mode: ControlMode;
  /** 준비 상태: 추론 모드, 모델 주소 응답, 기록 DB. 모델 주소가 답하지 않아도 health는 200이고 ready.ok가 false다. */
  ready: ReadyView;
}

/** 준비 상태(/api/health ready). 모델은 부르지 않고 주소가 답하는지만 본다. */
export interface ReadyView {
  /** VLM·PAM 서비스·PAM LLM·기록 DB가 모두 준비됐는가. */
  ok: boolean;
  /** 추론 모드: mock(외부 AI API) · live(같은 서버 vLLM). 두 모드는 같은 코드 경로다. */
  inference_mode: "mock" | "live";
  vlm: { base_url: string; model: string; key: boolean; reachable: boolean };
  /** PAM 서비스(PAM_URL)와 그 서비스가 부르는 LLM. 서비스가 답하지 않으면 llm은 null. */
  pam: { url: string; reachable: boolean; llm: { base_url: string; model: string; reachable: boolean } | null };
  /** 기록 DB(RUNTIME_DIR/noonchi.db)를 쓸 수 있는가. */
  db: boolean;
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
  | { type: "brain"; event: BrainLog }
  | { type: "photo"; photo: PhotoRecord }
  | { type: "focus"; focus: Focus }
  | { type: "eye"; eye: EyeEvent }
  /** 클로이드 지금 계획(src/contract/plan.ts). null이면 계획을 지운다. */
  | { type: "plan"; plan: PlanView | null };
