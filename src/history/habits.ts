// 반성 뒤 검사 두 자리(src/history/reflect.ts runReflection이 저장 전에 부른다).
// 1) coachGuard: 코치 규칙(행동이 코치 행동인 규칙)은 seed 그대로 지킨다. 기억 모양 검사다(행동을 고르지 않는다).
// 2) HabitFilter: 습관 거르기 자리(박석준). 이 저장소는 모든 규칙을 그대로 두는 기본값(keepAll)만 둔다.
//    거르기 뒤에 coachGuard를 한 번 더 돌려 거르기가 코치 규칙을 다시 넣거나 지울 수 없게 한다.
import { TASKS } from "../act/tasks.js";
import type { FsmMemory } from "../brain/decision.js";
import type { HistoryRow } from "../contract/history.js";

/** 거르기 입력: 반성한 날, 그날 쓴 기억, 반성이 낸 기억(coachGuard 뒤), 지난 windowDays일 기록(world·device·decision·execution·feedback, 시각 순), 기록 시간대(분). */
export interface HabitInput {
  day: string; windowDays: number; offsetMinutes: number;
  previous: FsmMemory; proposed: FsmMemory; rows: HistoryRow[];
}
/** 규칙 하나의 결과. seen: 그 트리거를 본 횟수, fired: 그때 그 행동이 나온 횟수, p: 우연일 확률, conditions: 붙인 조건(요일·평일 주말·30분 시간대·날씨·실내 온도·함께 있는 사람, 둘까지). */
export interface HabitRuleNote {
  state: string; trigger: string; action: string; kept: boolean;
  reason: "habit" | "chance" | "too_few" | "coach" | "unchanged";
  seen?: number; fired?: number; p?: number; conditions?: string[];
}
export interface HabitOutput { memory: FsmMemory; notes: HabitRuleNote[] }
export type HabitFilter = (i: HabitInput) => HabitOutput | Promise<HabitOutput>;

/** 규칙 한 줄(상태·트리거·행동). */
export interface RuleLine { state: string; trigger: string; action: string }

const isCoach = (action: string) => TASKS[action]?.coach === true;
const keyOf = (r: RuleLine) => JSON.stringify([r.state, r.trigger, r.action]);
const linesOf = (m: FsmMemory): RuleLine[] => m.states.flatMap((s) => s.rules.map((r) => ({ state: s.id, trigger: r.trigger, action: r.action })));

/** proposed에만 있는 규칙(상태·트리거·행동). */
export function learnedRules(previous: FsmMemory, proposed: FsmMemory): RuleLine[] {
  const had = new Set(linesOf(previous).map(keyOf));
  return linesOf(proposed).filter((r) => !had.has(keyOf(r)));
}

/**
 * 코치 규칙을 seed 그대로 지킨다.
 * 1) proposed의 모든 상태에서 행동이 코치 행동인 규칙을 뺀다. seed 코치 규칙과 상태·트리거가 같은 것은 notes에 reason "unchanged", 다른 것은 kept false·reason "coach".
 * 2) seed의 코치 규칙마다: 같은 id 상태가 proposed에 있으면 그 상태 rules 끝에 되돌리고, 없으면 seed 상태(description·rules는 seed 코치 규칙만, next는 proposed에 있는 상태 id로 가는 것만)를 states 끝에 더한다.
 * initial_state는 바꾸지 않는다. 결과 모양 검사(validateMemory)는 부르는 쪽이 한다.
 */
export function coachGuard(seed: FsmMemory, proposed: FsmMemory): HabitOutput {
  const seedCoach = linesOf(seed).filter((r) => isCoach(r.action));
  const notes: HabitRuleNote[] = [];
  const states = proposed.states.map((s) => ({
    ...s,
    rules: s.rules.filter((r) => {
      if (!isCoach(r.action)) return true;
      const same = seedCoach.some((c) => c.state === s.id && c.trigger === r.trigger && c.action === r.action);
      notes.push({ state: s.id, trigger: r.trigger, action: r.action, kept: same, reason: same ? "unchanged" : "coach" });
      return false;
    }),
    next: [...s.next],
  }));
  const ids = new Set(states.map((s) => s.id));
  const added: typeof states = [];
  for (const c of seedCoach) {
    const rule = { trigger: c.trigger, action: c.action };
    const here = states.find((s) => s.id === c.state) ?? added.find((s) => s.id === c.state);
    if (here) {
      here.rules.push(rule);
      continue;
    }
    const from = seed.states.find((s) => s.id === c.state)!;
    added.push({ id: from.id, description: from.description, rules: [rule], next: from.next.filter((n) => ids.has(n.to)) });
  }
  return { memory: { initial_state: proposed.initial_state, states: [...states, ...added] }, notes };
}

/** 기본 거르기: proposed 그대로, 새 규칙마다 kept true·reason habit. */
export const keepAll: HabitFilter = (i) => ({ memory: i.proposed, notes: learnedRules(i.previous, i.proposed).map((r) => ({ ...r, kept: true, reason: "habit" })) });
