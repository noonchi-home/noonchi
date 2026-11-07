// noonchi ↔ PAM 서비스(services/pam/) 계약 타입. 사진 칸이 없다. 형식 설명은 docs/pam-interface.md.
export const PAM_PREDICT = "pam-predict/2";
export const PAM_REFLECT = "pam-reflect/2";

export interface PamPredictRequest {
  contract: typeof PAM_PREDICT;
  /** 마지막 관찰 시각(시간대 있는 ISO). */
  final_time: string;
  /** World State 관찰 텍스트: 시각이 붙은 줄 + [지속] 사실 + [눈] 위치. */
  observation_text: string;
  memory_kind: "list" | "fsm";
  memory: unknown;
  tasks: string[];
}

export interface PamPredictResponse {
  status: "valid" | "invalid";
  raw_response: string;
  prediction: { observation: string; reasoning: string; task_index: number } | null;
  selected_action: string | null;
  errors: string[];
}

export interface PamReflectRequest {
  contract: typeof PAM_REFLECT;
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

export interface PamReflectResponse {
  status: "valid" | "invalid";
  raw_response: string;
  memory: unknown | null;
  errors: string[];
}
