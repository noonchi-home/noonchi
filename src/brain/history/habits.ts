// 반성 뒤 검사(src/brain/history/reflect.ts runReflection이 저장 전에 부른다).
// 1) settingsGuard: 반성이 낸 후보 FSM에서 배우는 행동(컵 치우기·에어컨 켜기, src/act/tasks.ts LEARNED_ACTIONS)이 아닌 후보를 빼고 기록한다.
//    사용자가 정한 습관 화살표(물 채우기·콜라·에어컨·코치)는 로봇 FSM을 만들 때(src/brain/pam/adopt.ts adoptedFsm) seed에서 가져와 지킨다.
// 2) HabitFilter: 습관 거르기 자리. 로봇 FSM에 들 배운 화살표를 뺄 수만 있다(정한 습관 화살표는 바꾸지 못한다). 기본은 모두 두는 keepAll.
import { LEARNED_ACTIONS, TASKS } from "../../act/tasks.js";
import type { CandidateFsm, Ctx } from "../../contract/pam.js";
import type { FsmMemory } from "../decision.js";
import type { HistoryRow } from "../../contract/history.js";

/** 거르기 입력: 반성한 날, 그날 쓴 로봇 FSM, 새 로봇 FSM, 지난 windowDays일 기록(world·device·decision·execution·feedback, 시각 순), 기록 시간대(분). */
export interface HabitInput {
  day: string; windowDays: number; offsetMinutes: number;
  previous: FsmMemory; proposed: FsmMemory; rows: HistoryRow[];
}
/** 화살표(후보) 하나의 결과. seen: 그 트리거를 본 횟수, fired: 그때 그 행동이 나온 횟수, p: 우연일 확률, conditions: 붙인 조건(둘까지).
 *  reason settings: 사용자가 정한 습관 행동이라 배우지 않음, coach: 코치 행동이라 배우지 않음. */
export interface HabitRuleNote {
  from: string; to: string; on: string; action: string; kept: boolean;
  reason: "habit" | "chance" | "too_few" | "coach" | "unchanged" | "settings";
  seen?: number; fired?: number; p?: number; conditions?: string[];
}
export interface HabitOutput { memory: FsmMemory; notes: HabitRuleNote[] }
export type HabitFilter = (i: HabitInput) => HabitOutput | Promise<HabitOutput>;

/** 행동 있는 화살표 한 줄(출발·도착·사건·조건·행동, 있으면 요일·시각 맥락). */
export interface EdgeLine { from: string; to: string; on: string; when: string | null; action: string; ctx?: Ctx }

const isCoach = (action: string) => TASKS[action]?.coach === true;
/** 맥락이 없으면 예전과 같은 열쇠이고, 있으면 맥락이 달라야 다른 화살표다. */
export const edgeKey = (e: EdgeLine) => JSON.stringify([e.from, e.to, e.on, e.when, e.action, ...(e.ctx ? [e.ctx] : [])]);
const linesOf = (m: FsmMemory): EdgeLine[] => m.states.flatMap((s) => s.next.filter((e) => e.action).map((e) => ({ from: s.id, to: e.to, on: e.on, when: e.when ?? null, action: e.action!, ...(e.ctx ? { ctx: e.ctx } : {}) })));

/** proposed에만 있는 행동 화살표. */
export function learnedEdges(previous: FsmMemory, proposed: FsmMemory): EdgeLine[] {
  const had = new Set(linesOf(previous).map(edgeKey));
  return linesOf(proposed).filter((e) => !had.has(edgeKey(e)));
}

/** 배우지 않는 행동 후보를 빼고 기록한다(까닭은 코치 행동이면 coach, 그 밖은 settings). 사용자가 정한 습관 화살표는 adoptedFsm이 seed에서 가져온다. 받은 후보 FSM은 바꾸지 않는다. */
export function settingsGuard(c: CandidateFsm): { candidates: CandidateFsm; notes: HabitRuleNote[] } {
  const notes: HabitRuleNote[] = [];
  const states = c.states.map((s) => ({
    ...s, activity: [...s.activity], next: s.next.map((e) => ({ ...e })),
    rules: s.rules.filter((r) => {
      if (LEARNED_ACTIONS.includes(r.action)) return true;
      for (const x of r.candidates) notes.push({ from: s.id, to: r.to, on: x.on, action: r.action, kept: false, reason: isCoach(r.action) ? "coach" : "settings" });
      return false;
    }).map((r) => ({ ...r, candidates: r.candidates.map((x) => ({ ...x })) })),
  }));
  return { candidates: { initial_state: c.initial_state, states }, notes };
}

/** 기본 거르기: proposed 그대로, 새 화살표마다 kept true·reason habit. */
export const keepAll: HabitFilter = (i) => ({ memory: i.proposed, notes: learnedEdges(i.previous, i.proposed).map((e) => ({ from: e.from, to: e.to, on: e.on, action: e.action, kept: true, reason: "habit" })) });
