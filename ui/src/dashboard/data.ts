// 대시보드 자료(순수 리듀서): /events 메시지 → 지금 계획·맞춘 눈·마지막 유효 판단·쌓인 생각 메시지·말풍선 카드 말. 물체 모양(seen)은 초당 10번 와서 여기 넣지 않는다(masks.ts 저장소). 화면 값(단계 번호·마스코트 방향·생각 말풍선)도 여기서 고른다.
// hello는 처음으로 돌린다(접속 스냅숏이 뒤따른다). 같은 계획의 옛 번호, 맞추기 전 추정 눈, 실패한 판단은 버린다.
import type { BrainLog, EyeEvent, ServerMessage, ThoughtMessage } from "../../../src/contract/events.ts";
import type { PlanStep, PlanView } from "../../../src/contract/plan.ts";
import { FSM_STATE_TEXT } from "../../../src/world/labels.ts";
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
  /** 판단에서 본 행동마다 그 모드(판단 기록 assist): 진행 중 계획의 행동으로 메시지 상자 머리를 정한다. */
  modes: Record<string, "noonchi" | "coach">;
  /** 메시지 상자에 넣은 말의 수(말 줄 id의 차례). */
  says: number;
  /** 지금 유효한 안전 알림 말(say safety)과 그 줄 id. 안전 아닌 말이나 빈 말이 오면 null. 메시지 상자는 그동안 한 줄을 늘 이 알림에 준다. */
  safety: { id: string; text: string } | null;
  /** 메시지 상자 줄: 새로 온 생각 메시지(반성 메시지 포함)와 바뀐 말풍선 카드 말을 받은 차례로(시계가 다른 기기여도 차례가 맞다). 최근 THOUGHT_KEPT개. */
  talk: { id: string; text: string }[];
}

export const EMPTY_DASH: DashData = { plan: null, eye: null, decision: null, thoughts: [], reflection: null, say: null, modes: {}, says: 0, safety: null, talk: [] };

/** 메시지 상자 줄 더하기: 같은 id는 한 번만, 받은 차례로 최근 THOUGHT_KEPT개. */
function addTalk(list: DashData["talk"], more: { id: string; text: string }[]): DashData["talk"] {
  const fresh = more.filter((m, i) => !list.some((x) => x.id === m.id) && !more.slice(0, i).some((x) => x.id === m.id));
  return fresh.length ? [...list, ...fresh].slice(-THOUGHT_KEPT) : list;
}

/** 메시지 상자에 보이는 줄 수(최근 것): 지난 줄 둘과 최신 줄 하나. */
export const TALK_SHOWN = 3;
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
    case "say": {
      const safe = !!m.safety && !!m.text;
      if (m.text === s.say && safe === !!s.safety) return s;
      // 줄 id는 받은 말의 차례(같은 메시지 묶음을 다시 넣어도 같은 id라 메시지 상자가 굴러갈 줄을 가른다)
      const id = `say#${s.says}`;
      const changed = m.text !== s.say;
      const talk = changed && m.text ? addTalk(s.talk, [{ id, text: m.text }]) : s.talk;
      const safety = safe ? (changed ? { id, text: m.text! } : s.safety ?? { id, text: m.text! }) : null;
      return { ...s, say: m.text, safety, talk, says: changed && m.text ? s.says + 1 : s.says };
    }
    case "thought": {
      const thoughts = addThoughts(s.thoughts, m.messages);
      if (thoughts === s.thoughts) return s;
      const fresh = thoughts.filter((t) => !s.thoughts.some((x) => x.id === t.id));
      return { ...s, thoughts, talk: addTalk(s.talk, fresh.map((t) => ({ id: t.id, text: t.text }))) };
    }
    case "brain": {
      const e = m.event;
      if (e.type === "decision") {
        // 동시에 나간 판단의 늦은 응답(seq가 더 작음)은 쓰지 않는다
        if (e.status !== "valid" || (s.decision && e.seq < s.decision.seq)) return s;
        return { ...s, decision: e, modes: e.action && e.assist ? { ...s.modes, [e.action]: e.assist } : s.modes };
      }
      if (e.type === "reflection") {
        if (!e.ok) return s;
        const more = reflectionThoughts(e);
        return { ...s, reflection: e, thoughts: addThoughts(s.thoughts, more), talk: addTalk(s.talk, more.map((t) => ({ id: t.id, text: t.text }))) };
      }
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

/** 메시지 상자 알약 셋(FSM 구조): 지금 상태 이름, 맞은 규칙의 트리거, 그 행동. */
export interface Pills { state: string; trigger: string; action: string }
/** 메시지 상자에 보이는 것: 최근 줄(오래된 것부터 TALK_SHOWN개, 다듬은 생각 메시지와 말풍선 카드 말을 받은 차례로)과 마지막 판단의 알약 셋(FSM을 모르면 null).
 *  PAM의 원래 생각(reasoning)은 싣지 않는다. */
export interface Talk { lines: { id: string; text: string }[]; fsm: Pills | null }

/**
 * 메시지 상자: 다듬은 생각 메시지(반성 메시지 포함)와 말풍선 카드 말을 받은 차례로 섞은 최근 TALK_SHOWN줄과 마지막 유효 판단의 알약 셋. 둘 다 없으면 null.
 * 알약은 서버가 판단 기록에 실은 지금 FSM(src/brain/decision.ts fsmNow)이다: 상태는 기억 상태 이름(FSM_STATE_TEXT, 없으면 상태 id), 트리거는 맞은 규칙의 트리거
 * (대기면 「대기」, 규칙 없이 고른 행동이면 「규칙 없음」, 그 행동 규칙이 여럿이면 「규칙 여럿」), 액션은 고른 행동(대기면 「대기」). 판단의 FSM을 모르면(list 기억·판단 전) 알약이 없다.
 */
export function talkOf(s: DashData): Talk | null {
  // 안전 알림이 유효한 동안 최신 줄은 늘 그 알림이고, 지난 줄은 그 밖의 가장 새 줄이다
  const safety = s.safety;
  const lines = safety ? [...s.talk.filter((l) => l.id !== safety.id).slice(-(TALK_SHOWN - 1)), safety] : s.talk.slice(-TALK_SHOWN);
  const d = s.decision;
  const f = d?.fsm;
  const fsm = d && f ? {
    state: f.state ? FSM_STATE_TEXT[f.state] ?? f.state : WORDS.unknown,
    trigger: f.trigger ?? (d.action ? (f.matched ? WORDS.manyRules : WORDS.noRule) : WORDS.idle),
    action: d.action ?? WORDS.idle,
  } : null;
  return lines.length || fsm ? { lines, fsm } : null;
}

/** 지금 행동의 모드(마스코트 머리 위 모드 말풍선): 실행 추적이 받아들인 행동이 어느 모드로 하는 행동인가(서버 판단 기록·계획 스냅숏 assist, 행동 목록 TaskSpec.coach).
 *  진행 중 계획이 있으면 그 계획의 행동, 없으면 가장 새 판단의 행동이다. 대기·판단 전이면 null(말풍선은 눈치 모드). 설정의 돕는 방식(자동 등)은 쓰지 않는다. */
export function modeNow(s: DashData): "noonchi" | "coach" | null {
  const open = isOpen(s.plan) ? s.plan : null;
  const d = s.decision;
  return open ? open.assist ?? s.modes[open.goal] ?? null : d?.action ? d.assist ?? null : null;
}
