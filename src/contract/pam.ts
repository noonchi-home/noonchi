// PamClient(src/brain/pam/) 입력 모양(pam-predict/3·pam-reflect/2, 타입만). 사진 칸이 없다. 형식 설명은 docs/pam-interface.md.
export type PamPredictContract = "pam-predict/3";
export type PamReflectContract = "pam-reflect/2";

export interface PamPredictRequest {
  contract: PamPredictContract;
  /** 마지막 관찰 시각(시간대 있는 ISO). */
  final_time: string;
  /** World State 관찰 텍스트: 시각이 붙은 줄 + [지속] 사실 + [눈] 위치. */
  observation_text: string;
  memory_kind: "list" | "fsm";
  memory: unknown;
  tasks: string[];
  /** 직전 판단의 사람 상태 id(처음이면 null). */
  last_state: string | null;
}

export interface PamReflectRequest {
  contract: PamReflectContract;
  /** 반성하는 날(YYYY-MM-DD). */
  day: string;
  memory_kind: "list" | "fsm";
  memory: unknown;
  /** 하루 관찰 텍스트. */
  observation_text: string;
  /** 하루 행동 요약. */
  action_summary: string;
  feedback: string | null;
}

/** PAM 판단 답. fsm 기억이면 state(지금 사람 상태)·from(일어난 화살표가 나간 상태, 없으면 null)·next_index(그 상태 next 번호, 없으면 -1)가 늘 있고
 *  task_index는 서버가 그 화살표 행동으로 만든 값이다(답에는 task_index 칸이 없다). list 기억이면 task_index가 답이다. */
export interface Prediction { observation: string; reasoning: string; task_index: number; state?: string; from?: string | null; next_index?: number }

/** 고른 행동의 FSM 자리(행동 단위). PAM 답에는 어느 규칙이 불렸는지가 없어 기억에서 그 행동의 규칙을 모아 본다.
 *  state: 그 행동의 규칙이 모두 한 상태에 있으면 그 상태 id, 여러 상태에 흩어졌으면 null.
 *  trigger: 그 행동의 규칙이 하나면 그 트리거, 둘 이상이면 null.
 *  learned: 그 행동의 규칙 가운데 seed 기억(CUP_FSM_MEMORY)에 없는 트리거·행동 쌍이 하나라도 있다. */
export interface FsmRuleAt { state: string | null; trigger: string | null; learned: boolean }
/** 판단 때 지금 FSM(대시보드 메시지 상자 알약 상태·트리거·액션, src/brain/decision.ts fsmNow): 규칙대로 고른 행동이면 그 규칙의 상태(여러 상태면 null)·트리거,
 *  대기·규칙 없는 행동이면 직전 상태(지금 기억에 없거나 처음이면 기억의 처음 상태)에 트리거 없음. matched: 고른 행동의 규칙이 기억에 있다. */
export interface FsmAt extends FsmRuleAt { matched: boolean }
