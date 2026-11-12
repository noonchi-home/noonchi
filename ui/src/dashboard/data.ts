// 대시보드 자료(순수 리듀서): /events 메시지 → 지금 계획·맞춘 눈·마지막 유효 판단·말풍선 카드 말. 물체 모양(seen)은 초당 10번 와서 여기 넣지 않는다(masks.ts 저장소). 화면 값(단계 번호·마스코트 방향·FSM 카드)도 여기서 고른다.
// hello는 처음으로 돌린다(접속 스냅숏이 뒤따른다). 같은 계획의 옛 번호, 맞추기 전 추정 눈, 실패한 판단은 버린다.
import type { BrainLog, EyeEvent, ServerMessage } from "../../../src/contract/events.ts";
import type { PlanStep, PlanView } from "../../../src/contract/plan.ts";
import type { Facing } from "./Mascot";
import { WORDS } from "./words";

type Decision = Extract<BrainLog, { type: "decision" }>;

export interface DashData {
  plan: PlanView | null;
  /** 맞춘 폰 눈(추정은 넣지 않는다). */
  eye: EyeEvent | null;
  /** 마지막 유효 판단. */
  decision: Decision | null;
  say: string | null;
}

export const EMPTY_DASH: DashData = { plan: null, eye: null, decision: null, say: null };

export function reduceDash(s: DashData, m: ServerMessage, now: number): DashData {
  switch (m.type) {
    case "hello":
      return EMPTY_DASH;
    case "plan": {
      const p = m.plan;
      // 같은 계획은 지금 것과 같거나 작은 번호를 버린다(계획 계약)
      if (p && s.plan && p.id === s.plan.id && p.revision <= s.plan.revision) return s;
      return { ...s, plan: p };
    }
    case "eye":
      return m.eye.estimated ? s : { ...s, eye: m.eye };
    case "say":
      return { ...s, say: m.text };
    case "brain": {
      const e = m.event;
      if (e.type === "decision") return e.status === "valid" ? { ...s, decision: e } : s;
      return s;
    }
    default:
      return s;
  }
}

/** 열린 계획: 예정·진행 중. */
export const isOpen = (p: PlanView | null): p is PlanView => p !== null && (p.status === "planned" || p.status === "running");

/** 0 지켜보기(열린 계획 없음), n = 진행 중 단계 번호(1부터). 진행 중이 없으면 처음 예정 단계, 그것도 없으면 0. */
export function stepIndex(p: PlanView | null): number {
  if (!isOpen(p)) return 0;
  const active = p.steps.findIndex((s) => s.status === "active");
  const i = active >= 0 ? active : p.steps.findIndex((s) => s.status === "pending");
  return i + 1;
}

export function currentStep(p: PlanView | null): PlanStep | null {
  const n = stepIndex(p);
  return n > 0 ? p!.steps[n - 1]! : null;
}

/** 마스코트가 보는 쪽: 열린 계획이 있으면 트윈, 아니면 대시보드 폰 칸 영상. */
export const facingOf = (p: PlanView | null): Facing => (isOpen(p) ? "twin" : "video");

/** FSM 카드: 마지막 유효 판단의 관찰 한 문장(없으면 null)과 도출한 행동(없으면 대기). */
export function fsmOf(s: DashData): { observation: string | null; action: string } {
  return { observation: s.decision?.prediction?.observation ?? null, action: s.decision?.action ?? WORDS.wait };
}
