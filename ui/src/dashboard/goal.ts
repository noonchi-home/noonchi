// 미리 세운 목표(순수 함수): 목표(goal 메시지, src/act/track/goal.ts)는 사람 FSM과 따로 된 상태 머신이다: 세움 → 준비됨 → 시작 → 끝/버림.
// 메시지 상자에는 목표 칩을 두지 않는다(문장 「컵을 두고 자리를 뜨면 컵을 치울게요」가 목표를 말한다). 목표가 선 동안 트윈의 치울 물건 위에 작은 빨간 고리를 둔다
// (plan-marks.ts goal, 2026-11-18 사용자 결정).
import type { DashData } from "./data";
import { isOpen } from "./data";

/** 목표 단계: set 세움(미리 만드는 중·못 만듦), ready 준비됨, started 시작(사람이 떠남·준비한 계획을 씀), done 끝(그 계획이 끝남), dropped 버림. */
export type GoalStage = "set" | "ready" | "started" | "done" | "dropped";
/** 지금 목표: 단계, 행동, 대상 World State 물건 id(모르면 null), 목표가 서 있는가(세움·준비됨·시작, 끝·버림이 아님). */
export interface GoalNow { stage: GoalStage; action: string; object: string | null; standing: boolean }

export function goalOf(s: DashData): GoalNow | null {
  const g = s.goal;
  if (!g) return null;
  // 준비한 계획을 쓴 뒤 그 행동 계획이 닫혔으면 끝
  const p = s.plan;
  const finished = g.status === "used" && p !== null && p.goal === g.action && !isOpen(p);
  const stage: GoalStage = g.status === "dropped" ? "dropped" : finished ? "done" : g.status === "used" || g.status === "fired" ? "started" : g.prep === "ready" ? "ready" : "set";
  return { stage, action: g.action, object: g.object, standing: stage !== "done" && stage !== "dropped" };
}
