// 서버↔화면 메시지 계약(WebSocket /events, /api 응답). 순수 타입만 둔다: ui/가 이 파일을 그대로 가져다 쓴다.
// 바꾸면 ui/src/lib/messages.ts의 parseMessage와 화면 테스트를 같이 고친다.
import type { Command, DeviceSpec, DeviceState } from "../hub/types.js";
import type { LayoutMessage } from "./layout.js";
import type { PhoneChoice } from "./phone.js";
import type { PlanView } from "./plan.js";
import type { ControlMode } from "./setup.js";
import type { Mask } from "../brain/seg.js";
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
    /** 그때까지 가까이 보기가 면 값을 바꾼 횟수(World State closer_rev, 없으면 칸이 없다). */
    closer_rev?: Record<string, number>;
  }[];
  person_visible: boolean;
  vlm_missing: number;
  yolo_missing: number;
}

/** 감지가 끝난 엔진 프레임 하나의 물체 모양(/events {type:"seen", …}). 빠른 프레임마다(기본 100ms) 대시보드로만 가는 가벼운 사건이고
 *  기록 DB·실행 기록에 넣지 않는다. mask는 엔진 프레임 픽셀 자리의 0/1 그림(src/brain/seg.ts), frame은 엔진 프레임 크기. 감지 없음이면 shapes가 빈 목록이다. */
export interface SeenEvent {
  type: "seen"; at_ms: number; frame_id: string; captured_at_ms: number;
  frame: { width: number; height: number };
  shapes: { label: DetLabel; score: number; mask: Mask }[];
}

/** 관찰 흐름·판단이 대시보드로 보내는 기록(/events {type:"brain", event}). VLM 프레임(VLM_FRAME_MS마다 한 장) 하나는 observe 기록으로 반드시 남는다:
 *  YOLO 결과(yolo) 또는 yolo_missing, VLM 답(vlm) 또는 vlm_missing. 그 사이 빠른 프레임은 observe 기록 없이 SeenEvent만 낸다.
 *  상자는 싣지 않는다: 물체 모양은 SeenEvent의 마스크로만 간다.
 *  가까이 보기(frame_id 「e3.c1」)의 기록은 잘라 본 자리(closer, 원본 엔진 프레임 픽셀)를 싣는다. */
export type BrainLog =
  | {
    type: "observe"; at_ms: number; frame_id: string; captured_at_ms: number; yolo: string | null; yolo_missing?: YoloMissing; vlm: string | null; vlm_missing?: VlmMissing;
    closer?: [number, number, number, number];
  }
  | { type: "world_change"; at_ms: number; kind: WorldChangeKind; text: string }
  | {
    type: "decision"; at_ms: number; id: string; seq: number; text_sent: string; status: "valid" | "failed";
    prediction: { observation: string; reasoning: string; task_index: number } | null; action: string | null;
    /** 고른 행동을 FSM 기억 규칙에서 찾은 자리: 상태 id와 트리거. 대기·실패, 같은 행동이 여러 규칙에 있거나 못 찾으면 null. 예전 기록에는 없다. */
    fsm?: { state: string; trigger: string } | null;
    error?: string; memory_version: number; world: DecisionWorld;
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

/** 관찰 모드가 고르는 도구: look_closer 마지막 사진을 잘라 다시 보기, ask_person 사람에게 가까이 비춰 달라고 부탁, wait 기다리기,
 *  tell_person 지금 할 일을 한 줄로 다시 알리기(코치 계획), pass_on 들은 말을 말 요청 에이전트로 넘기기(코치 계획 중 들은 말). */
export type LookTool = "look_closer" | "ask_person" | "wait" | "tell_person" | "pass_on";
/** 관찰 모드를 부른 까닭: stalled 집기·놓기 단계가 안 끝남(A), unknown_fact 판단 전 볼 면을 모름(B),
 *  off_track 코치 계획 중 다른 행동을 봄, heard 코치 계획 중 명령의 답이 아닌 말을 들음. */
export type LookTrigger = "stalled" | "unknown_fact" | "off_track" | "heard";

// 가까이 보기(src/observe/pipeline.ts closer)

/** 자원 사정이라 못 본 것(시도로 세지 않고 다음에 다시 부른다, 실행 추적 Stall.settle(false)): no_fresh_frames 새 사진(가장 새 프레임 가까이 찍힌 최근 5장 중 서로 다른 프레임 3장)이
 *  모자라거나 가장 새 프레임이 지금보다 너무 앞서 찍힘(폰 끊김, 감지가 끝난 뒤에도 다시 봄. VLM 답이 왔을 때 낡았으면 결과 vlm no_fresh_frames), vlm_busy 다른 가까이 보기가 돌거나 VLM 가까이 보기 자리가 참. */
export type CloserWait = "no_fresh_frames" | "vlm_busy";
/** 가까이 보기를 못 한 까닭: CloserWait, no_view 카메라를 맞추기 전, out_of_view 대상이 가장 새 사진 밖, no_detector 감지기 없음,
 *  aborted 감지를 합치기 전에 요청이 끊김(자르기 전·합치기 바로 전에 보고 넣지 않음), closed 관찰 흐름이 닫힘, error 자르기·감지 오류. */
export type CloserMiss = CloserWait | "no_view" | "out_of_view" | "no_detector" | "aborted" | "closed" | "error";
/** VLM에 보낸 가까이 본 사진의 감지 하나: 맞추거나 만든 World State 물건 id(없으면 null), 종류, 신뢰도(소수 둘째 자리), 그 감지에 대한 VLM 답 값.
 *  맞는 물건이 없는 물건 감지는 서로 다른 원본 프레임 3장에서 같은 자리로 보였거나, 1장 이상 보이고 이 VLM 답이 그 감지에 사실을 하나 이상 답하고 가림(not_visible)은 답하지 않았을 때
 *  새 물건이 되고 그 id가 실린다. 그 밖에는 null이다. */
export interface CloserFound { id: string | null; cls: DetLabel; score: number; facts: string[] }
/** 가까이 본 사진의 VLM 답: ok 넣음, VlmMissing 답 없음, 감지를 합친 뒤 넣지 않음 둘(aborted·no_fresh_frames, 아래 CloserResult).
 *  no_fresh_frames는 CloserWait와 같은 자원 사정이라 실행 추적 Stall.settle(false)다. */
export type CloserVlm = "ok" | VlmMissing | "aborted" | "no_fresh_frames";
/** 가까이 보기 결과. ok면 감지를 World State에 합친 것. VLM에 보낸 장은 물건 감지(사람·가전 설비·잘라 본 경계에 닿은 상자 아님)가 있는 가장 새 장이고,
 *  없으면 가장 새 장이다. frame_id는 그 장의 기록 id, captured_at_ms는 그 장 촬영 시각, crop은 그 장에서 잘라 본 자리, found는 그 장의 감지, frames는 잘라 본 장 수.
 *  vlm은 VLM 답을 넣었으면 ok, 없으면 그 까닭이다. aborted는 감지를 합친 뒤 요청이 끊김(합친 변화로 그 단계가 끝남 등)이라 VLM을 보내지 않거나
 *  그 요청을 끊고 답을 넣지 않은 것이다. no_fresh_frames는 VLM 답이 왔을 때 쓴 가장 새 프레임이 지금보다 끊김 범위(closerStaleMs) 넘게 앞서 찍혀(폰 끊김)
 *  답을 넣지 않은 것이다. 둘 다 found의 facts·summary는 비고 VLM 기록(observe)을 내지 않는다.
 *  VLM 답이 없거나 넣지 않으면 3장이 안 된 새 물건은 만들지 않는다. */
export type CloserResult =
  | { ok: true; frame_id: string; captured_at_ms: number; crop: [number, number, number, number]; frames: number; found: CloserFound[]; summary: string | null; vlm: CloserVlm }
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
  /** replay: 접속 때 다시 보낸 마지막 판단(새 관찰이 아님). 확인 목록은 건너뛴다. */
  | { type: "brain"; event: BrainLog; replay?: true }
  /** 감지가 끝난 엔진 프레임의 물체 모양. replay: 접속 때 다시 보낸 마지막 것. */
  | (SeenEvent & { replay?: true })
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
