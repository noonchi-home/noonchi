// 대시보드 자료(순수 리듀서): /events 메시지 → 지금 계획·맞춘 눈·마지막 유효 판단·쌓인 생각 메시지·말풍선 카드 말. 물체 모양(seen)은 초당 10번 와서 여기 넣지 않는다(masks.ts 저장소). 화면 값(단계 번호·마스코트 방향·생각 말풍선)도 여기서 고른다.
// hello는 처음으로 돌린다(접속 스냅숏이 뒤따른다). 같은 계획의 옛 번호, 맞추기 전 추정 눈, 실패한 판단은 버린다.
import type { BrainLog, EyeEvent, ServerMessage, ThoughtMessage } from "../../../src/contract/events.ts";
import type { RobotMessage } from "../../../src/contract/machines.ts";
import type { PendingGoal } from "../../../src/contract/goal.ts";
import type { HabitFsm } from "../../../src/contract/habit.ts";
import type { PlanStep, PlanView } from "../../../src/contract/plan.ts";
import { TRACE_KEPT, type TraceRow } from "../../../src/contract/trace.ts";
import { WORDS } from "./words";

type Decision = Extract<BrainLog, { type: "decision" }>;
type Reflection = Extract<BrainLog, { type: "reflection" }>;

export interface DashData {
  traceEpoch: string | null;
  trace: TraceRow[];
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
  /** 서버가 정한 지금 행동 모드(mode 메시지, src/act/mode.ts). 받기 전이면 null. */
  mode: "noonchi" | "coach" | null;
  /** 메시지 상자에 넣은 말의 수(말 줄 id의 차례). */
  says: number;
  /** 지금 유효한 안전 알림 말(say safety)과 그 줄 id. 안전 아닌 말이나 빈 말이 오면 null. 메시지 상자는 그동안 한 줄을 늘 이 알림에 준다. */
  safety: { id: string; text: string } | null;
  /** 메시지 상자 줄: 새로 온 생각 메시지(반성 메시지 포함)와 바뀐 말풍선 카드 말을 받은 차례로(시계가 다른 기기여도 차례가 맞다). 최근 THOUGHT_KEPT개. */
  talk: { id: string; text: string }[];
  /** 마지막으로 받은 미리 세운 목표(goal 메시지, src/act/track/goal.ts). 트윈 목표 고리·미리 그린 길과 시간 줄 반응 간격(사람이 떠난 때)이 쓴다. 받기 전이면 null. */
  goal: PendingGoal | null;
  /** 마지막으로 받은 습관 FSM 그림 자료(habit 메시지, src/brain/habit.ts). 시간 줄 사람 줄의 상태 이름이 쓴다. 받기 전이면 null. */
  habit: HabitFsm | null;
  /** 사람 상태가 바뀐 때들(오래된 것부터 최근 PEOPLE_KEPT개). 시간 줄 사람 줄이 쓴다. 서버 사람 상태(person 메시지: 판단 PAM 답과 판단 사이 World State 하는 일,
   *  이름은 서버가 붙임)를 받으면 그것만 쓰고, 받기 전에는 유효한 판단의 fsm.state와 그 판단 시각으로 잇는다. 상태를 모르는 판단(null)은 더하지 않는다. */
  people: PersonAt[];
  robots: RobotMessage[];
  /** person 메시지를 받았는가(그 뒤로는 판단 상태로 사람 줄을 잇지 않는다). */
  personFed: boolean;
  /** 최근 계획(id마다 마지막 판본, 받은 차례로 최근 PLANS_KEPT개). 시간 줄 로봇 줄이 단계 시각(started_ms·ended_ms)을 쓴다. */
  plans: PlanView[];
}

/** 사람 상태 하나: 상태 id와 그 상태가 된 때(서버 시각), 서버가 붙인 이름(person 메시지만, 판단에서 온 것은 습관 그림 이름을 쓴다). */
export interface PersonAt { state: string; at_ms: number; name?: string }
const PEOPLE_KEPT = 8;
const ROBOTS_KEPT = 64;
const PLANS_KEPT = 4;

export const EMPTY_DASH: DashData = {
  traceEpoch: null, trace: [],
  plan: null, eye: null, decision: null, thoughts: [], reflection: null, say: null, mode: null, says: 0, safety: null, talk: [], goal: null, habit: null, people: [], robots: [], personFed: false, plans: [],
};

/** 서버 시각순으로 최근 전이를 보존한다. 같은 시각의 다른 전이는 첫 수신 순서를 유지한다. */
function addTransition<T>(
  list: T[], event: T, limit: number,
  timeOf: (event: T) => number, sameState: (a: T, b: T) => boolean,
): T[] {
  const at = timeOf(event);
  if (list.some(known => timeOf(known) === at && sameState(known, event))) return list;
  if (list.length === limit && list.every(known => timeOf(known) > at)) return list;
  return [...list, event].sort((a, b) => timeOf(a) - timeOf(b)).slice(-limit);
}

/** 유효한 판단 하나로 사람 상태 줄을 잇는다: 상태(서버 fsmNow)를 모르면(null) 그대로, 마지막과 같으면 그대로. */
function peopleNext(list: PersonAt[], d: Decision): PersonAt[] {
  const st = d.fsm?.state ?? null;
  if (st === null || list.at(-1)?.state === st) return list;
  return [...list, { state: st, at_ms: d.at_ms }].slice(-PEOPLE_KEPT);
}

/** 최근 계획 줄에 계획 하나를 넣는다: 같은 id는 그 자리를 바꾸고, 새 id는 뒤에 더한다. */
function plansNext(list: PlanView[], p: PlanView): PlanView[] {
  const i = list.findIndex((x) => x.id === p.id);
  return i >= 0 ? list.map((x, j) => (j === i ? p : x)) : [...list, p].slice(-PLANS_KEPT);
}

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

/** 반성 화살표의 조건(없으면 사건) 글 → 메시지 한 줄(끝 마침표를 뗀다). */
const sentence = (t: string) => t.trim().replace(/[.。]+$/, "");

/** 성공한 반성의 메시지 둘: 새로 배운(없으면 쓰고 있는) 첫 화살표의 상황 → 「새로 배운 습관이에요」·「전에 배운 습관이에요」. 화살표가 없으면 없다. */
function reflectionThoughts(r: Reflection): ThoughtMessage[] {
  const rule = r.learned?.[0] ?? r.active?.[0];
  // 예전 모양 반성 기록(규칙 trigger, 2026-11-18 전)은 화살표 글이 없어 줄을 만들지 않는다
  const said = rule ? rule.when ?? rule.on : undefined;
  if (typeof said !== "string") return [];
  const id = `reflection@${r.at_ms}`;
  return [
    { id: `${id}:0`, text: sentence(said), at_ms: r.at_ms, decision: "" },
    { id: `${id}:1`, text: r.learned?.[0] ? WORDS.newHabit : WORDS.oldHabit, at_ms: r.at_ms, decision: "" },
  ];
}

export function reduceDash(s: DashData, m: ServerMessage, now: number): DashData {
  switch (m.type) {
    case "hello":
      return { ...EMPTY_DASH, traceEpoch: m.trace_epoch ?? null };
    case "trace": {
      if (m.epoch !== s.traceEpoch) return s;
      const rows = new Map(s.trace.map(row => [row.id, row]));
      let changed = false;
      for (const row of m.rows) {
        const old = rows.get(row.id);
        if (old && (old.rev >= row.rev || (old.state !== "pending" && row.state === "pending"))) continue;
        if (old?.state === "pending" && row.state !== "pending") rows.delete(row.id);
        rows.set(row.id, row);
        changed = true;
      }
      if (!changed) return s;
      const stored = [...rows.values()];
      const omit = new Set(stored.filter(row => row.state !== "pending" && !row.retained).slice(0, Math.max(0, rows.size - TRACE_KEPT)).map(row => row.id));
      return { ...s, trace: stored.filter(row => !omit.has(row.id)).slice(-TRACE_KEPT) };
    }
    case "plan": {
      const p = m.plan;
      // 같은 계획은 지금 것과 같거나 작은 번호를 버린다(계획 계약)
      if (p && s.plan && p.id === s.plan.id && p.revision <= s.plan.revision) return s;
      return { ...s, plan: p, plans: p ? plansNext(s.plans, p) : s.plans };
    }
    case "eye":
      return m.eye.estimated ? s : { ...s, eye: m.eye };
    case "mode":
      return m.mode === s.mode ? s : { ...s, mode: m.mode };
    case "goal":
      return s.goal?.id === m.goal.id && s.goal.status === m.goal.status && s.goal.prep === m.goal.prep ? s : { ...s, goal: m.goal };
    case "habit":
      return s.habit?.version === m.habit.version ? s : { ...s, habit: m.habit };
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
    case "robot": {
      const robots = addTransition(s.robots, m, ROBOTS_KEPT, r => r.since_ms, (a, b) =>
        a.state === b.state && a.step?.plan_id === b.step?.plan_id &&
        a.step?.number === b.step?.number && a.step?.label === b.step?.label);
      return robots === s.robots ? s : { ...s, robots };
    }
    case "person": {
      const event: PersonAt = { state: m.state, at_ms: m.since_ms, name: m.name };
      const people = addTransition(s.people, event, PEOPLE_KEPT, p => p.at_ms, (a, b) => a.state === b.state && a.name === b.name);
      return people === s.people && s.personFed ? s : { ...s, people, personFed: true };
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
        return { ...s, decision: e, people: s.personFed ? s.people : peopleNext(s.people, e) };
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

/** 메시지 상자에 보이는 것: 최근 줄(오래된 것부터 TALK_SHOWN개, 다듬은 생각 메시지와 말풍선 카드 말을 받은 차례로). PAM의 원래 생각(reasoning)은 싣지 않는다.
 *  사람 상태·목표·계획 단계의 때는 상자 왼쪽 시간 줄 카드가 보인다(timeline.ts). */
export interface Talk {
  lines: { id: string; text: string }[];
}

/** 메시지 상자: 다듬은 생각 메시지(반성 메시지 포함)와 말풍선 카드 말을 받은 차례로 섞은 최근 TALK_SHOWN줄. 줄이 없으면 null. */
export function talkOf(s: DashData): Talk | null {
  // 안전 알림이 유효한 동안 최신 줄은 늘 그 알림이고, 지난 줄은 그 밖의 가장 새 줄이다
  const safety = s.safety;
  const lines = safety ? [...s.talk.filter((l) => l.id !== safety.id).slice(-(TALK_SHOWN - 1)), safety] : s.talk.slice(-TALK_SHOWN);
  return lines.length ? { lines } : null;
}

/** 지금 행동 모드(마스코트 머리 위 모드 말풍선): 서버가 한 곳에서 정해 보낸 mode 메시지 그대로(src/act/mode.ts). 받기 전이면 null(말풍선은 눈치 모드). */
export const modeNow = (s: DashData): "noonchi" | "coach" | null => s.mode;
