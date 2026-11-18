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

/** 판단 기록 fsm(사람 상태 FSM, pam-predict/3): PAM 답의 지금 사람 상태(state)와 일어난 화살표(출발 from·번호 next_index와 그 화살표의 to·on·when·action).
 *  화살표 없음이면 next_index -1이고 from·to·on·when·action이 null. learned: seed에 같은 출발·사건·행동 화살표가 없다(묻기 자리를 바꾼 배운 컵 치우기도 true). */
export interface FsmStep { state: string; from: string | null; next_index: number; to: string | null; on: string | null; when: string | null; action: string | null; learned: boolean }
