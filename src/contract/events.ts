// 서버↔화면 메시지 계약(WebSocket /events, /api 응답). 순수 타입만 둔다: ui/가 이 파일을 그대로 가져다 쓴다.
// 바꾸면 ui/src/lib/messages.ts의 parseMessage와 화면 테스트를 같이 고친다.
import type { Command, DeviceSpec, DeviceState } from "../hub/types.js";
import type { LayoutMessage } from "./layout.js";
import type { PhoneChoice } from "./phone.js";
import type { PlanView } from "./plan.js";
import type { ControlMode } from "./setup.js";
import type { DetLabel } from "../world/vocab.js";
import type { VlmMissing, WorldChangeKind, WorldView, YoloMissing } from "./world.js";

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
  /** 실제 폰 답 단추(src/act/prompts.ts APPROVE): 승인·거절. */
  choices: PhoneChoice[];
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

// 판단·행동

/** 실행 흐름 단계(판단 → 계획 → 실행 중 → 결과 확인 → 완료·실패). */
export type ExecState = "decided" | "planned" | "running" | "verifying" | "done" | "failed";

/** 판단에 쓴 World State 요약(판단 기록 화면이 펼쳐 보인다). */
export interface DecisionWorld {
  objects: {
    id: string; cls: string; status: string; surface: string | null; surface_label: string | null; error_m: number | null;
    facts: Record<string, { value: string; certainty: "confirmed" | "inferred" }>;
  }[];
  person_visible: boolean;
  vlm_missing: number;
  yolo_missing: number;
}

/** YOLO 상자 하나(대시보드 폰 칸에 그린다). label은 낱말 표 감지 종류, box는 엔진 프레임 픽셀 [x, y, w, h]. */
export interface BoxView { label: DetLabel; score: number; box: [number, number, number, number] }

/** 관찰 흐름·판단이 대시보드로 보내는 기록(/events {type:"brain", event}). 엔진 프레임 하나는 observe 기록으로 반드시 남는다:
 *  YOLO 결과(yolo) 또는 yolo_missing, VLM 답(vlm) 또는 vlm_missing.
 *  YOLO 결과에만 상자(boxes, 감지 없음이면 [])와 엔진 프레임 크기(frame)가 있다. 분석 없음·VLM 답에는 없다.
 *  가까이 보기(frame_id 「e3.c1」)의 기록은 잘라 본 자리(closer, 원본 엔진 프레임 픽셀)를 싣고, 그 상자도 원본 엔진 프레임 픽셀이다. */
export type BrainLog =
  | {
    type: "observe"; at_ms: number; frame_id: string; captured_at_ms: number; yolo: string | null; yolo_missing?: YoloMissing; vlm: string | null; vlm_missing?: VlmMissing;
    boxes?: BoxView[]; frame?: { width: number; height: number }; closer?: [number, number, number, number];
  }
  | { type: "world_change"; at_ms: number; kind: WorldChangeKind; text: string }
  | {
    type: "decision"; at_ms: number; id: string; seq: number; text_sent: string; status: "valid" | "failed";
    prediction: { observation: string; reasoning: string; task_index: number } | null; action: string | null; error?: string; memory_version: number; world: DecisionWorld;
  }
  | { type: "execution"; at_ms: number; plan_id: string; state: ExecState; text: string }
  | { type: "link"; at_ms: number; target: "pam"; up: boolean; text: string }
  | { type: "trigger"; at_ms: number; paused: boolean; text: string }
  | { type: "reflection"; at_ms: number; day: string; ok: boolean; version: number | null; applies_day: string | null; text: string }
  /** 관찰 모드가 고른 것 하나(src/act/look.ts): 까닭(A 멈춘 단계·B 판단 전 보기), 대상 id, 고른 도구와 모델이 댄 까닭, 기록 글, 결과(가까이 보기 결과·부탁을 보냈는가, 기다리기는 null).
   *  A면 그 계획·단계 id가 있다. */
  | {
    type: "look"; at_ms: number; trigger: LookTrigger; target: string | null; tool: LookTool; reason: string; text: string; result: LookResult | null;
    plan_id?: string; step_id?: string;
  };

// 관찰 모드(src/agent/observer.ts)

/** 관찰 모드가 고르는 도구: look_closer 마지막 사진을 잘라 다시 보기, ask_person 사람에게 가까이 비춰 달라고 부탁, wait 기다리기. */
export type LookTool = "look_closer" | "ask_person" | "wait";
/** 관찰 모드를 부른 까닭: stalled 집기·놓기 단계가 안 끝남(A), unknown_fact 판단 전 볼 면을 모름(B). */
export type LookTrigger = "stalled" | "unknown_fact";

// 가까이 보기(src/observe/pipeline.ts closer)

/** 자원 사정이라 못 본 것(시도로 세지 않고 다음에 다시 부른다, 실행 추적 Stall.settle(false)): no_fresh_frames 새 사진(가장 새 프레임 가까이 찍힌 서로 다른 프레임 3장)이
 *  모자라거나 가장 새 프레임이 지금보다 너무 앞서 찍힘(폰 끊김, 감지가 끝난 뒤에도 다시 봄), vlm_busy 다른 가까이 보기가 돌거나 VLM 가까이 보기 자리가 참. */
export type CloserWait = "no_fresh_frames" | "vlm_busy";
/** 가까이 보기를 못 한 까닭: CloserWait, no_view 카메라를 맞추기 전, out_of_view 대상이 가장 새 사진 밖, no_detector 감지기 없음,
 *  aborted 요청이 끊김(자르기 전·합치기 바로 전·VLM 답을 넣기 바로 전에 보고 넣지 않음, VLM 요청도 끊음), closed 관찰 흐름이 닫힘, error 자르기·감지 오류. */
export type CloserMiss = CloserWait | "no_view" | "out_of_view" | "no_detector" | "aborted" | "closed" | "error";
/** 가까이 본 가장 새 사진의 감지 하나: 맞춘 World State 물건 id(없으면 null), 종류, 신뢰도(소수 둘째 자리), 그 감지에 대한 VLM 답 값. */
export interface CloserFound { id: string | null; cls: DetLabel; score: number; facts: string[] }
/** 가까이 보기 결과. ok면 합치고 VLM 답까지 받은 것(frame_id는 가장 새 장의 기록 id, crop은 그 장에서 잘라 본 자리, frames는 쓴 장 수, vlm은 VLM 답이 없으면 그 까닭). */
export type CloserResult =
  | { ok: true; frame_id: string; captured_at_ms: number; crop: [number, number, number, number]; frames: number; found: CloserFound[]; summary: string | null; vlm: "ok" | VlmMissing }
  | { ok: false; why: CloserMiss };
/** 관찰 모드가 고른 도구의 결과: look_closer는 가까이 보기 결과, ask_person은 실제 폰에 부탁을 보냈는가. */
export type LookResult = CloserResult | { sent: boolean };

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
  /** VLM·PAM 서비스·PAM LLM·에이전트·기록 DB가 모두 준비됐는가. */
  ok: boolean;
  /** 추론 모드: mock(외부 AI API) · live(같은 서버 vLLM). 두 모드는 같은 코드 경로다. */
  inference_mode: "mock" | "live";
  vlm: { base_url: string; model: string; key: boolean; reachable: boolean };
  /** PAM 서비스(PAM_URL)와 그 서비스가 부르는 LLM. 서비스가 답하지 않으면 llm은 null. */
  pam: { url: string; reachable: boolean; llm: { base_url: string; model: string; reachable: boolean } | null };
  /** 폰 대화 에이전트(상용 LLM). 키가 있고 주소가 답해야 준비됨이다. 키가 없어도 다른 공급자로 바꾸지 않는다. */
  agent: { provider: "openai" | "anthropic"; base_url: string; model: string; key: boolean; reachable: boolean };
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

/** /events로 화면이 받는 메시지 전체. 서버의 send·broadcast와 같은 모양이다(src/server/app.ts·home.ts, src/observe/pipeline.ts, src/phone/feed.ts). */
export type ServerMessage =
  | { type: "hello"; devices: number; provider: string | null; hub: string; home: string | null }
  | { type: "state"; state: DeviceState }
  | ({ type: "agent" } & AgentEvent)
  /** replay: 접속 때 다시 보낸 마지막 판단·상자 있는 observe(새 관찰이 아님). 확인 목록은 건너뛴다. */
  | { type: "brain"; event: BrainLog; replay?: true }
  | { type: "photo"; photo: PhotoRecord }
  | { type: "focus"; focus: Focus }
  | { type: "eye"; eye: EyeEvent }
  /** 클로이드 지금 계획(src/contract/plan.ts). null이면 계획을 지운다. */
  | { type: "plan"; plan: PlanView | null }
  /** World State(src/contract/world.ts). 바뀔 때마다, 그리고 접속 때 한 번. */
  | { type: "world"; world: WorldView }
  /** 실행 중 배치 보정(src/contract/layout.ts). 바뀔 때마다, 그리고 접속 때 맞추기 메시지. */
  | LayoutMessage
  /** 대시보드 말풍선 카드 한 문장(src/act/say.ts). 바뀔 때마다, 그리고 접속 때 한 번. null이면 글 없음. */
  | { type: "say"; text: string | null };
