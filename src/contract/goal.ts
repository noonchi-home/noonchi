// 미리 세운 목표(src/goal/watch.ts)의 바깥 모양: 노드 통로 /brain/goal(STATE, 최신 보기)·/brain/goal_changes(RELIABLE, 전환마다)와
// 대시보드 {type:"goal"}이 같은 것을 싣는다.
import type { PlanView } from "./plan.js";

/** 관찰 단계: armed 세움(사람이 아직 씀) · fired 사람이 떠나 판단을 바로 부름 · used 떠난 뒤 판단이 같은 행동을 골라 미리 만든 계획을 씀 · dropped 버림. */
export type GoalStatus = "armed" | "checking" | "fired" | "used" | "dropped";
/** 미리 만들기: waiting 아직(대상이 면 위에 놓이길 기다림) · planning 계획 모드가 만드는 중 · ready 준비됨 · failed 못 만듦(다시 부르지 않는다). */
export type GoalPrep = "waiting" | "planning" | "ready" | "failed";
/** 버린 까닭: took 들고 나감, back 다시 나타남, moved 물건이 사라지거나 다른 면으로 옮겨지거나 치워짐, replaced 다른 판단·계획이 맡음, safety 안전 알림,
 *  mode 지금 행동 목록에 없음(코치 모드), dock 충전 자리 복귀 중, expired 세워 둘 수 있는 시간이 지남, pam 사람이 떠난 뒤 PAM이 그 행동을 고르지 않음,
 *  stale 미리 만든 계획이 없거나 지금 World State 검사를 못 넘음, stop 사용자가 「그만」이라고 함. */
export type GoalDrop = "took" | "back" | "moved" | "replaced" | "safety" | "mode" | "dock" | "expired" | "pam" | "stale" | "stop";

export interface PendingGoal {
  /** goal-<번호>(실행 추적 안에서 하나씩, 세대다). */
  id: string;
  action: string;
  /** 세운 때의 사람 상태 id와 그 상태에서 나가는 화살표의 사건(on) 글. */
  state: string;
  trigger: string;
  /** 대상 World State 물건 id(지금 따라가는 id, 아직 모르면 null)와 종류. */
  object: string | null;
  cls: string;
  status: GoalStatus;
  prep: GoalPrep;
  reason: GoalDrop | null;
  /** 메시지 상자 줄(클로이드 말, 사실로만). 행동 말 표에 없으면 null. */
  text: string | null;
  meal?: { zone: string; surface: string; activity: string };
  checking_ms?: number;
  check_until_ms?: number;
  departure_rev?: number;
  confirmed_ms?: number;
  armed_ms: number;
  ready_ms: number | null;
  /** 사람이 떠난 때(World State 사람 since_ms)와 그것을 본 때. */
  gone_ms: number | null;
  fired_ms: number | null;
  /** 미리 만든 계획 보기(없으면 null). */
  plan: PlanView | null;
  /** 까닭 글(계획 검사의 첫 틀린 단계와 이유 등): 미리 만들기 실패(prep failed)와 준비한 계획을 버리고 계획 모드로 넘어갈 때(dropped). 없으면 칸이 없다. */
  error?: string;
}

/** /brain/goal·/brain/goal_changes 몸. */
export interface BrainGoalMsg { goal: PendingGoal }
