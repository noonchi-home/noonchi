// PamClient(src/brain/pam/) 입력 모양(pam-predict/2·pam-reflect/2, 타입만). 사진 칸이 없다. 형식 설명은 docs/pam-interface.md.
export type PamPredictContract = "pam-predict/2";
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

export interface Prediction { observation: string; reasoning: string; task_index: number }

/** 고른 행동의 FSM 규칙 자리(대시보드 생각 말풍선 「상태」 칩). */
/** 고른 행동의 FSM 자리(행동 단위). PAM 답에는 어느 규칙이 불렸는지가 없어 기억에서 그 행동의 규칙을 모아 본다.
 *  state: 그 행동의 규칙이 모두 한 상태에 있으면 그 상태 id, 여러 상태에 흩어졌으면 null.
 *  trigger: 그 행동의 규칙이 하나면 그 트리거, 둘 이상이면 null.
 *  learned: 그 행동의 규칙 가운데 seed 기억(CUP_FSM_MEMORY)에 없는 트리거·행동 쌍이 하나라도 있다. */
export interface FsmRuleAt { state: string | null; trigger: string | null; learned: boolean }
