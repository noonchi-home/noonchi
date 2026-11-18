// 습관 FSM 그림 자료(src/brain/habit.ts habitView): 판단이 PAM에 보낸 기억(판본)을 화면 글로 옮긴 것. 대시보드 {type:"habit"}이 싣고, 메시지 상자 FSM 카드가 그린다.
// 모양은 상태 목록과 전이 목록(from·to·trigger·action)이다. 사람 상태 FSM(PAM이 상태·전이·행동을 함께 답함)도 같은 모양으로 싣는다.
// 지금 상태는 판단 기록의 fsm.state(src/brain/decision.ts fsmNow), 목표는 {type:"goal"}이 따로 싣는다.

export interface HabitFsm {
  /** 기억 판본(기록 DB memory version). 판본이 바뀔 때만 다시 보낸다. */
  version: number;
  /** 기억의 처음 상태 id(판단 전 지금 상태). */
  initial: string;
  /** 상태: id, 화면 이름, seed 기억에 없는 상태인가. 기억 차례 그대로. */
  states: { id: string; name: string; learned: boolean }[];
  /** 전이: 어디서, 어디로(같으면 제자리), 조건(짧은 화면 글), 그때 로봇이 하는 행동(없으면 null), seed 기억에 없는 전이인가. */
  transitions: { from: string; to: string; trigger: string; action: string | null; learned: boolean }[];
}
