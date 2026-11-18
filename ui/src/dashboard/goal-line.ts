// 목표 한 줄(순수 함수): 미리 세운 목표(goal 메시지, src/act/track/goal.ts)는 사람 FSM과 따로 된 상태 머신이다: 세움 → 준비됨 → 시작 → 끝/버림.
// FSM 카드에 그리지 않고 「목표 · 컵 치우기 · 준비됨」 한 줄로 보인다(2026-11-18 사용자 결정).
import type { DashData } from "./data";
import { isOpen } from "./data";
import { WORDS } from "./words";

/** 목표 단계: set 세움(미리 만드는 중·못 만듦), ready 준비됨, started 시작(사람이 떠남·준비한 계획을 씀), done 끝(그 계획이 끝남), dropped 버림. */
export type GoalStage = "set" | "ready" | "started" | "done" | "dropped";
export interface GoalLine { stage: GoalStage; text: string }

export function goalLineOf(s: DashData): GoalLine | null {
  const g = s.goal;
  if (!g) return null;
  // 준비한 계획을 쓴 뒤 그 행동 계획이 닫혔으면 끝
  const p = s.plan;
  const finished = g.status === "used" && p !== null && p.goal === g.action && !isOpen(p);
  const stage: GoalStage = g.status === "dropped" ? "dropped" : finished ? "done" : g.status === "used" || g.status === "fired" ? "started" : g.prep === "ready" ? "ready" : "set";
  return { stage, text: `${WORDS.goal.head} · ${g.action} · ${WORDS.goal.stage[stage]}` };
}
