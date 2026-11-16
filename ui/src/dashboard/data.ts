// 대시보드 자료(순수 리듀서): /events 메시지 → 지금 계획·맞춘 눈·마지막 유효 판단·쌓인 생각 메시지·말풍선 카드 말. 물체 모양(seen)은 초당 10번 와서 여기 넣지 않는다(masks.ts 저장소). 화면 값(단계 번호·마스코트 방향·생각 말풍선)도 여기서 고른다.
// hello는 처음으로 돌린다(접속 스냅숏이 뒤따른다). 같은 계획의 옛 번호, 맞추기 전 추정 눈, 실패한 판단은 버린다.
import type { BrainLog, EyeEvent, ServerMessage, ThoughtMessage } from "../../../src/contract/events.ts";
import type { PlanStep, PlanView } from "../../../src/contract/plan.ts";
import { FSM_STATE_TEXT } from "../../../src/world/labels.ts";
import type { Facing } from "./Mascot";
import { WORDS } from "./words";

type Decision = Extract<BrainLog, { type: "decision" }>;
type Reflection = Extract<BrainLog, { type: "reflection" }>;

export interface DashData {
  plan: PlanView | null;
  /** 맞춘 폰 눈(추정은 넣지 않는다). */
  eye: EyeEvent | null;
  /** 마지막 유효 판단. */
  decision: Decision | null;
  /** 쌓인 생각 메시지(src/brain/thought.ts의 thought, 반성 메시지 포함). 시각 차례로 최근 THOUGHT_KEPT개. */
  thoughts: ThoughtMessage[];
  /** 마지막 성공한 반성(접속 때 다시 받은 오늘 것 포함). */
  reflection: Reflection | null;
  say: string | null;
}

export const EMPTY_DASH: DashData = { plan: null, eye: null, decision: null, thoughts: [], reflection: null, say: null };

/** 생각 말풍선에 보이는 메시지 수(최근 것). */
export const THOUGHT_SHOWN = 3;
/** 자료에 두는 메시지 수. */
const THOUGHT_KEPT = 6;

/** 메시지 더하기: 같은 id는 한 번만, 시각 차례(같으면 온 차례)로 최근 THOUGHT_KEPT개. */
function addThoughts(list: ThoughtMessage[], more: ThoughtMessage[]): ThoughtMessage[] {
  const fresh = more.filter((m, i) => !list.some((x) => x.id === m.id) && !more.slice(0, i).some((x) => x.id === m.id));
  if (!fresh.length) return list;
  return [...list, ...fresh].map((m, i) => [m, i] as const).sort((a, b) => a[0].at_ms - b[0].at_ms || a[1] - b[1]).map(([m]) => m).slice(-THOUGHT_KEPT);
}

/** 반성 규칙의 트리거 글 → 메시지 한 줄(끝 마침표를 뗀다). */
const sentence = (t: string) => t.trim().replace(/[.。]+$/, "");

/** 성공한 반성의 메시지 둘: 새로 배운(없으면 쓰고 있는) 첫 규칙의 상황 → 「새로 배운 습관이에요」·「전에 배운 습관이에요」. 규칙이 없으면 없다. */
function reflectionThoughts(r: Reflection): ThoughtMessage[] {
  const rule = r.learned?.[0] ?? r.active?.[0];
  if (!rule) return [];
  const id = `reflection@${r.at_ms}`;
  return [
    { id: `${id}:0`, text: sentence(rule.trigger), at_ms: r.at_ms, decision: "" },
    { id: `${id}:1`, text: r.learned?.[0] ? WORDS.newHabit : WORDS.oldHabit, at_ms: r.at_ms, decision: "" },
  ];
}

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
    case "thought": {
      const thoughts = addThoughts(s.thoughts, m.messages);
      return thoughts === s.thoughts ? s : { ...s, thoughts };
    }
    case "brain": {
      const e = m.event;
      if (e.type === "decision") return e.status === "valid" ? { ...s, decision: e } : s;
      if (e.type === "reflection") return e.ok ? { ...s, reflection: e, thoughts: addThoughts(s.thoughts, reflectionThoughts(e)) } : s;
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

/** 마스코트가 보는 쪽: 열린 계획이 있으면 트윈(왼쪽), 아니면 그림 그대로(오른쪽). */
export const facingOf = (p: PlanView | null): Facing => (isOpen(p) ? "twin" : "video");

/** 생각 말풍선에 보이는 것: 최근 메시지(오래된 것부터 THOUGHT_SHOWN개), 칩 값(FSM 상태 이름표, 배운 규칙이 있는 행동인가(습관), 고른 행동의 종류(눈치·코치), 고른 행동 이름).
 *  대기면 상태·행동이 null이라 칩이 없다. PAM의 원래 생각(reasoning)은 싣지 않는다. */
export interface Thought { messages: { id: string; text: string }[]; state: string | null; habit: boolean; assist: "noonchi" | "coach"; action: string | null }

/**
 * 생각 말풍선: 쌓인 메시지의 최근 THOUGHT_SHOWN개와 칩 값. 메시지가 하나도 없으면 null(말풍선을 숨긴다). 대기여도 메시지가 있으면 보인다.
 * 칩은 마지막 유효 판단보다 새 반성이면 그 반성의 첫 규칙(습관), 아니면 행동을 고른 판단의 상태·습관·종류·행동, 대기·판단 없음이면 없다.
 * 상태는 서버가 붙인 FSM 상태 id(decision.fsm.state)의 화면 이름표(src/world/labels.ts FSM_STATE_TEXT), 이름표가 없으면 그 트리거이고, fsm.state가 없으면 null이다.
 * 습관은 서버가 붙인 learned, 종류는 서버가 붙인 assist(예전 기록에 없으면 눈치)를 그대로 보인다.
 */
export function thoughtOf(s: DashData): Thought | null {
  if (!s.thoughts.length) return null;
  const messages = s.thoughts.slice(-THOUGHT_SHOWN).map((m) => ({ id: m.id, text: m.text }));
  const d = s.decision;
  // 마지막 유효 판단보다 새 반성이면 그 반성의 첫 규칙: 새로 배운 규칙이 있으면 「습관 · 새로 배움」, 없고 쓰는 습관이 있으면 「습관 · 배운 규칙」. 둘 다 비면 판단 그대로
  const r = s.reflection;
  if (r && (!d || r.at_ms > d.at_ms)) {
    const learned = r.learned?.[0];
    const active = r.active?.[0];
    if (learned) return { messages, state: WORDS.learnedNow, habit: true, assist: "noonchi", action: learned.action };
    if (active) return { messages, state: null, habit: true, assist: "noonchi", action: active.action };
  }
  if (!d?.action || !d.prediction) return { messages, state: null, habit: false, assist: "noonchi", action: null };
  const fsm = d.fsm;
  const state = fsm?.state ? FSM_STATE_TEXT[fsm.state] ?? fsm.trigger ?? null : null;
  return { messages, state, habit: fsm?.learned ?? false, assist: d.assist ?? "noonchi", action: d.action };
}
