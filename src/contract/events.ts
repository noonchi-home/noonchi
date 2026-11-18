// 서버↔화면 메시지 계약(WebSocket /events, /api 응답). 순수 타입만 둔다: ui/가 이 파일을 그대로 가져다 쓴다.
// 바꾸면 ui/src/lib/messages.ts의 parseMessage와 화면 테스트를 같이 고친다.
import type { PendingGoal } from "./goal.js";
import type { HabitFsm } from "./habit.js";
import type { Command, DeviceSpec, DeviceState } from "./devices.js";
import type { LayoutMessage } from "./layout.js";
import type { PhoneChoice } from "./phone.js";
import type { PlanView } from "./plan.js";
import type { ControlMode } from "./setup.js";
import type { CameraView, Mask, SceneObservation } from "./observe.js";
import type { DetLabel } from "../world/vocab.js";
import type { VlmMissing, WorldChangeKind, WorldView, YoloMissing } from "./world.js";
import type { Prediction, FsmStep } from "./pam.js";
import type { ServiceKind } from "./service.js";

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

/** 승인 대기 하나: 위험 목록 가전 명령(command), 또는 외부 연락(service, src/contract/service.ts).
 *  외부 연락은 deviceId가 빈 글이고 deviceLabel은 고장 난 가전 이름(없으면 빈 글), reason은 승인 질문(「AS센터에 전화할까요?」)이다. */
export interface PendingView {
  token: string;
  deviceId: string;
  deviceLabel: string;
  /** 가전 명령 대기만 있다. */
  command?: Command;
  /** 외부 연락 대기만 있다. */
  service?: ServiceKind;
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
 *  기록 DB·실행 기록에 넣지 않는다. mask는 엔진 프레임 픽셀 자리의 0/1 그림(src/shared/mask.ts), frame은 엔진 프레임 크기. 감지 없음이면 shapes가 빈 목록이다. */
export interface SeenEvent {
  type: "seen"; at_ms: number; frame_id: string; captured_at_ms: number;
  frame: { width: number; height: number };
  shapes: { label: DetLabel; score: number; mask: Mask }[];
}

/** 생각 말풍선 메시지 하나(src/brain/thought.ts): 판단(decision)마다 작은 모델이 쓴 짧은 문장. id는 메시지마다 다르다(판단 id@시각:차례). */
export interface ThoughtMessage { id: string; text: string; at_ms: number; decision: string }
/** 생각 말풍선 메시지(/events {type:"thought", messages}): 판단 기록 뒤에 따로 오는 새 메시지(오래된 것부터). 대시보드는 카톡처럼 차례로 쌓는다.
 *  접속 때는 최근 메시지를 replay로 다시 보낸다. 기록 DB에는 메시지마다 thought 줄로 남는다(판단 줄에는 PAM 원래 생각). PAM 원래 생각은 대시보드로 보내지 않는다. */
export interface ThoughtEvent { type: "thought"; messages: ThoughtMessage[] }

/** 관찰 흐름·판단이 대시보드로 보내는 기록(/events {type:"brain", event}). VLM 프레임(VLM_FRAME_MS마다 한 장) 하나는 observe 기록으로 반드시 남는다:
 *  YOLO 결과(yolo) 또는 yolo_missing, VLM 답(vlm) 또는 vlm_missing. 그 사이 빠른 프레임은 observe 기록 없이 SeenEvent만 낸다.
 *  상자는 싣지 않는다: 물체 모양은 SeenEvent의 마스크로만 간다.
 *  가까이 보기(frame_id 「e3.c1」)의 기록은 잘라 본 자리(closer, 원본 엔진 프레임 픽셀)를 싣는다. */
/** 사용자 답(실제 폰 「완료」·질문 답·말 답) 한 줄: 반성 피드백. 실행 추적 쪽이 /act/log로 내고 기록 노드가 기록 DB feedback 줄로 쓴다. */
export interface FeedbackLog { type: "feedback"; at_ms: number; subject: string; text: string; data: { choice: string; via: "button" | "voice" } }

export type BrainLog =
  | {
    type: "observe"; at_ms: number; frame_id: string; captured_at_ms: number; yolo: string | null; yolo_missing?: YoloMissing; vlm: string | null; vlm_missing?: VlmMissing;
    closer?: [number, number, number, number];
    /** 장면 VLM 답 원문(물건·사실)과 그 사진의 카메라·크기: 기록 DB에 남겨 실제 판을 같은 답 순서·같은 자리로 다시 돌린다. */
    scene?: SceneObservation;
    view?: CameraView;
    size?: [number, number];
    /** 그 사진의 YOLO 감지(번호·종류·상자·신뢰도, 엔진 프레임 픽셀). */
    dets?: { id: string; class: string; box: [number, number, number, number]; score: number }[];
  }
  /** at_ms는 기록 시각(처리 시각), observed_ms는 그 변화의 근거(촬영) 시각(통로로 온 변화만 싣는다). */
  | { type: "world_change"; at_ms: number; kind: WorldChangeKind; text: string; observed_ms?: number }
  | {
    type: "decision"; at_ms: number; id: string; seq: number; text_sent: string; status: "valid" | "failed";
    /** 이번 판단의 PAM LLM 사용량(답을 받았을 때만, 틀린 답·잘린 답이어도). 예전 기록에는 없다. */
    usage?: PamUsage;
    prediction: Prediction | null; action: string | null;
    /** PAM 답의 사람 상태와 일어난 화살표(src/brain/decision.ts fsmStep). 실패·list 기억·말 부탁이면 null. 예전 기록에는 없거나 옛 모양이다. */
    fsm?: FsmStep | null;
    /** 판단이 버린 늦은 답(풀린 화살표를 다시 낸 답, src/brain/decide.ts): 행동 없이 기록만 한다. */
    late?: true;
    /** 고른 행동이 어느 모드로 하는 행동인가(TaskSpec.coach, src/act/tasks.ts): 코치 행동이면 coach, 아니면 noonchi. 대기·실패는 null.
     *  대시보드 메시지 상자 머리(「코치 모드」·「눈치 모드」, 대기면 없음)가 이 값만 쓴다. 예전 기록에는 없다. */
    assist?: "noonchi" | "coach" | null;
    /** 말 부탁(말 요청 에이전트 request_task·묻기 답)으로 만든 판단: PAM을 부르지 않았다. via answer는 묻기 답에서 온 부탁. 예전 기록·PAM 판단에는 없다. */
    source?: "speech"; via?: "answer";
    error?: string; memory_version: number; world: DecisionWorld;
  }
  /** reason: 그 실행 기록의 까닭(계획 검사에서 버린 계획이면 첫 틀린 단계와 이유). 없으면 칸이 없다. */
  | { type: "execution"; at_ms: number; plan_id: string; state: ExecState; text: string; reason?: string }
  | { type: "link"; at_ms: number; target: "pam"; up: boolean; text: string }
  | { type: "trigger"; at_ms: number; paused: boolean; text: string }
  | {
    type: "reflection"; at_ms: number; day: string; ok: boolean; version: number | null; applies_day: string | null; text: string;
    /** 이번 반성의 PAM LLM 사용량(답을 받았을 때만). 예전 기록에는 없다. */
    usage?: PamUsage;
    /** 이번 반성이 새로 더한 화살표, 새 로봇 판본에서 seed에 없는 화살표(둘 다 코치 행동 빼고), 반성 뒤 검사가 뺀 후보(src/brain/history/habits.ts). 성공한 fsm 반성에만 있다. */
    learned?: { from: string; to: string; on: string; when: string | null; action: string }[];
    active?: { from: string; to: string; on: string; when: string | null; action: string }[];
    dropped?: { from: string; to: string; on: string; action: string; kept: boolean; reason: "habit" | "chance" | "too_few" | "coach" | "unchanged" | "settings"; seen?: number; fired?: number; p?: number; conditions?: string[] }[];
    /** 반성이 낸 기억을 쓰지 않은 까닭(코드 검사·뜻 검사를 두 번 다 지나지 못함). fsm 반성에서 통과했으면 null. 예전 기록에는 없다. */
    rejected?: string | null;
    /** 채택 검사 결과(후보마다 n·k·못 봄·비율·p0·p·통과, src/brain/pam/adopt.ts). 검사한 후보가 있을 때만. */
    checks?: { state: string; action: string; on: string; when: string | null; n: number; k: number; unknown: number; rate: number; base_rate: number; p0: number; p_value: number; passed: boolean }[];
  }
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
 *  aborted 감지를 합치기 전에 요청이 끊김(자르기 전·합치기 바로 전에 보고 넣지 않음), closed 관찰 흐름이 닫힘, error 자르기·감지 오류,
 *  world_timeout 집 상태 노드가 VLM 합치기 뒤 찾은 물건 id 답(/world/closer)을 기한 안에 주지 않음. */
export type CloserMiss = CloserWait | "no_view" | "out_of_view" | "no_detector" | "aborted" | "closed" | "error" | "world_timeout";
/** VLM에 보낸 가까이 본 사진의 감지 하나: 맞추거나 만든 World State 물건 id(없으면 null), 종류, 신뢰도(소수 둘째 자리), 그 감지에 대한 VLM 답 값.
 *  맞는 물건이 없는 물건 감지는 서로 다른 원본 프레임 3장에서 같은 자리로 보였거나, 1장 이상 보이고 이 VLM 답이 그 감지에 사실을 하나 이상 답하고 가림(not_visible)은 답하지 않았을 때
 *  새 물건이 되고 그 id가 실린다. 그 밖에는 null이다. */
/** 가까이 보기에서 찾은 것 하나. via "vlm"이면 YOLO 감지가 아니라 VLM 답의 물건 상자로 찾은 것이다(score 0). */
export interface CloserFound { id: string | null; cls: DetLabel; score: number; facts: string[]; via?: "vlm" }
/** 가까이 본 사진의 VLM 답: ok 넣음, VlmMissing 답 없음, 감지를 합친 뒤 넣지 않음 둘(aborted·no_fresh_frames, 아래 CloserResult).
 *  no_fresh_frames는 CloserWait와 같은 자원 사정이라 실행 추적 Stall.settle(false)다. */
export type CloserVlm = "ok" | VlmMissing | "aborted" | "no_fresh_frames";
/** 가까이 보기 결과. ok면 감지를 World State에 합친 것. VLM에 보낸 장은 물건 감지(사람·가전 설비·잘라 본 경계에 닿은 상자 아님)가 있는 가장 새 장이고,
 *  없으면 가장 새 장이다. frame_id는 그 장의 기록 id, captured_at_ms는 그 장 촬영 시각, crop은 그 장에서 잘라 본 자리, found는 그 장의 감지, frames는 잘라 본 장 수.
 *  vlm은 VLM 답을 넣었으면 ok, 없으면 그 까닭이다. aborted는 감지를 합친 뒤 요청이 끊김(합친 변화로 그 단계가 끝남 등)이라 VLM을 보내지 않거나
 *  그 요청을 끊고 답을 넣지 않은 것이다. no_fresh_frames는 VLM 답이 왔을 때 쓴 가장 새 프레임이 지금보다 끊김 범위(closerStaleMs) 넘게 앞서 찍혀(폰 끊김)
 *  답을 넣지 않은 것이다. 둘 다 found의 facts·summary는 비고 VLM 기록(observe)을 내지 않는다.
 *  VLM 답이 없거나 넣지 않으면 3장이 안 된 새 물건은 만들지 않는다. */
/** 위에서 본 장(src/observe/pipeline.ts topLook)을 넣지 않은 까닭: moved 컵이 사라지거나 옮김 표시가 붙거나 0.1m 넘게 옮겨짐(그 뒤 장도 넣지 않음),
 *  vlm_missing VLM 답 없음, not_visible d1에 가림 답, no_contents 내용물 값이 비어 있음·내용물 있음 하나로 모이지 않음(없음·안이 안 보임 섞임·서로 다름),
 *  no_vessel 그 자리에 그릇 감지 없음,
 *  crowded 같은 종류 다른 물건이 0.1m 안(어느 컵인지 모름). */
export type TopDrop = "moved" | "vlm_missing" | "not_visible" | "no_contents" | "no_vessel" | "crowded";
/** 위에서 본 장 하나: 그 장의 기록 id, 넣었는가, 넣지 않았으면 그 까닭. */
export interface TopFrame { frame_id: string; kept: boolean; why?: TopDrop }
export type CloserResult =
  | { ok: true; frame_id: string; captured_at_ms: number; crop: [number, number, number, number]; frames: number; found: CloserFound[]; summary: string | null; vlm: CloserVlm; top?: TopFrame[] }
  | { ok: false; why: CloserMiss };
/** 관찰 모드가 고른 도구의 결과: look_closer는 가까이 보기 결과, ask_person은 실제 폰에 부탁을 보냈는가. */
export type LookResult = CloserResult | { sent: boolean };

// 기기

/** GET /api/devices 한 항목: spec + 현재 상태. */
export interface DeviceView extends DeviceSpec {
  state: DeviceState;
}

// 서버 상태

/** PAM LLM 한 번의 사용량: 응답 모델 이름, 입력·출력·캐시 토큰, 비용(달러, 가격표 src/infer/cost.ts에 없는 모델이면 null). */
export interface PamUsage { model: string; prompt: number; completion: number; cached: number; cost_usd: number | null }

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
  /** 기록 시간대(분, HISTORY_TZ_MINUTES). 대시보드 날짜·시간 칩이 이 시간대로 쓴다. 기록 DB가 없으면 없다. */
  tz_minutes?: number;
  brain: boolean;
  /** 운영 모드: test 시험(트윈만), live 실제(짝지은 가전은 ThinQ). */
  mode: ControlMode;
  /** 준비 상태: 추론 모드, 모델 주소 응답, 기록 DB. 모델 주소가 답하지 않아도 health는 200이고 ready.ok가 false다. */
  ready: ReadyView;
}

/** 준비 상태(/api/health ready). 모델은 부르지 않고 주소가 답하는지만 본다. */
export interface ReadyView {
  /** VLM·PAM LLM·에이전트·기록 DB가 모두 준비됐는가. */
  ok: boolean;
  /** 추론 모드: openai(개발, OpenAI API) · vllm(AWS 같은 서버 vLLM). 두 모드는 같은 코드 경로다. */
  inference_mode: "openai" | "vllm";
  vlm: { base_url: string; model: string; key: boolean; reachable: boolean };
  /** PAM LLM(PAM_LLM_BASE_URL) 주소 응답. 판단·반성은 서버 안 함수(src/brain/pam/)가 이 주소를 부른다. */
  /** reason: 이 주소로는 PAM을 부르지 않는 까닭(OpenRouter 주소). 있으면 주소를 부르지 않고 준비 안 됨이다. */
  pam: { base_url: string; model: string; key: boolean; reachable: boolean; reason?: string };
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

/** 시간 줄 사람 줄 자료(src/brain/person.ts PersonLane): 사람 상태가 바뀔 때만 하나. state는 사람 상태 FSM 상태 id(임시 상태 ~<값>),
 *  name은 화면 이름(FSM_STATE_TEXT, 임시 상태는 STATE_TEXT), since_ms는 그 상태가 된 때(판단 시각이거나 World State를 받은 때),
 *  source는 정한 곳(판단의 PAM 답·판단 사이 World State 하는 일), decision_id는 판단 id(World State면 null). */
export interface PersonMessage { type: "person"; state: string; name: string; since_ms: number; source: "decision" | "world"; decision_id: string | null }

/** /events로 화면이 받는 메시지 전체. 서버의 send·broadcast와 같은 모양이다(src/server/app.ts·home/, src/observe/pipeline.ts, src/phone/feed.ts). */
export type ServerMessage =
  | { type: "hello"; devices: number; provider: string | null; hub: string; home: string | null }
  | { type: "state"; state: DeviceState }
  | ({ type: "agent" } & AgentEvent)
  /** replay: 접속 때 다시 보낸 마지막 판단(새 관찰이 아님). 확인 목록은 건너뛴다. */
  | { type: "brain"; event: BrainLog; replay?: true }
  /** 감지가 끝난 엔진 프레임의 물체 모양. replay: 접속 때 다시 보낸 마지막 것. */
  | (SeenEvent & { replay?: true })
  /** 생각 말풍선 두 줄. replay: 접속 때 다시 보낸 마지막 것(마지막 판단 다음). */
  | (ThoughtEvent & { replay?: true })
  | { type: "photo"; photo: PhotoRecord }
  | { type: "focus"; focus: Focus }
  | { type: "eye"; eye: EyeEvent }
  /** 클로이드 지금 계획(src/contract/plan.ts). null이면 계획을 지운다. */
  | { type: "plan"; plan: PlanView | null }
  /** World State(src/contract/world.ts). 바뀔 때마다, 그리고 접속 때 한 번. */
  | { type: "world"; world: WorldView }
  /** 실행 중 배치 보정(src/contract/layout.ts). 바뀔 때마다, 그리고 접속 때 맞추기 메시지. */
  | LayoutMessage
  /** 대시보드 말풍선 말 한 문장(src/act/say.ts). 바뀔 때마다, 그리고 접속 때 한 번. null이면 글 없음. safety: 안전 알림(쓰러짐 의심·다시 켜짐·꺼짐 기다림·끄기 안내)이다. */
  | { type: "say"; text: string | null; safety?: true }
  /** 지금 행동 모드(눈치·코치, src/act/mode.ts modeNow): 대시보드 마스코트 머리 위 모드 말풍선. 바뀔 때마다, 그리고 접속 때 한 번. */
  | { type: "mode"; mode: "noonchi" | "coach" }
  /** 미리 세운 목표(src/act/track/goal.ts): 바뀔 때마다, 그리고 접속 때 마지막 것. 대시보드는 세움·떠남인 동안 메시지 상자 알약으로 보인다. */
  | { type: "goal"; goal: PendingGoal }
  /** 습관 FSM 그림 자료(src/brain/habit.ts): 판단이 PAM에 보낸 기억 판본이 바뀔 때, 그리고 접속 때 마지막 것. 대시보드 메시지 상자 FSM 카드가 그린다. */
  | { type: "habit"; habit: HabitFsm }
  /** 시간 줄 사람 줄: 사람 상태가 바뀔 때, 그리고 접속 때 마지막 것. */
  | PersonMessage;

export interface DecisionRecord {
  id: string;
  seq: number;
  atMs: number;
  /** PAM에 보낸 관찰 텍스트. 들은 말 줄이 그대로 들어 있다: 그 순간 판단·계획에만 쓰고 기록하지 않는다(기록에는 판단 방송의 text_sent). */
  textSent: string;
  finalTime: string;
  status: "valid" | "failed";
  prediction: Prediction | null;
  /** 고른 행동(대기·실패면 null). */
  action: string | null;
  /** PAM 답의 사람 상태와 일어난 화살표(src/brain/decision.ts fsmStep). 실패·list 기억이면 null. */
  fsm?: FsmStep | null;
  /** 판단이 버린 늦은 답(풀린 화살표를 같은 번호 이하 요청이 다시 낸 답): action은 null이고 실행 추적은 「앞선 판단이라 쓰지 않음」으로 기록만 한다. */
  late?: true;
  error?: string;
  /** 이번 판단의 PAM LLM 사용량(답을 받았을 때만). */
  usage?: PamUsage;
  memoryVersion: number;
  /** 이 판단에 보낸 행동 목록(돕는 방식마다 다르다). 계획 전·실행 전 검사가 이 목록으로 본다. */
  tasks?: string[];
  world: DecisionWorld;
  /** 말 부탁(말 요청 에이전트 request_task·묻기 답)으로 만든 판단(src/act/track/start.ts request): seq는 0이고 PAM 판단 번호와 섞지 않는다. */
  source?: "speech";
  /** 묻기 답(「치워 주세요」)에서 온 말 부탁. */
  via?: "answer";
  /** 말 부탁을 받은 때까지 판단이 보낸 마지막 PAM 요청 번호(src/brain/decide.ts sentSeq): 이 번호 이하 요청의 PAM 판단은 이 부탁의 계획을 바꾸지 않는다. */
  afterSeq?: number;
}
