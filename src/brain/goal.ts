// 미리 세울 목표 고르기(2026-11-18 사용자 결정): 사람이 손대는 행동의 대상을 쓰는 것을 보면, 습관 FSM을 한 걸음 앞서 읽어 사람이 떠난 뒤 할 일을 고른다.
// FSM이 무엇·언제를 정하고, 행동 목록(src/act/tasks.ts)의 afterUse 칸은 「사람이 대상을 다 쓰고 떠난 뒤 하는 일」인지만 적는다. 규칙을 실행하거나 상태를 넘기지 않는다.
// - 지금 상태(판단이 마지막으로 맞은 규칙의 상태, src/brain/decide.ts fsmState)와 그 상태에서 next 한 번으로 가는 상태의 규칙을 본다(한 걸음 뒤 상태를 먼저).
//   지금 상태를 정할 수 없으면(null) 모든 상태를 본다. 아직 없음(undefined)·지금 기억에 없는 상태는 기억의 처음 상태다(fsmNow와 같다).
// - 맞는 규칙: 지금 행동 목록에 있고, afterUse이고, 그 행동이 손대는 종류(touchTarget)가 사람이 쓰는 종류다.
// - 맞는 행동이 하나일 때만 고른다(둘 이상이면 어느 것이 먼저 올지 FSM으로 정할 수 없어 세우지 않는다).
import { taskOf, touchTarget } from "../act/tasks.js";
import type { PamMemory } from "./decision.js";

/** 고른 목표: 규칙이 있는 상태·그 트리거·행동, 지금 상태에서 그 상태로 가는 next 글(지금 상태 자기 규칙이거나 모든 상태를 봤으면 null). */
export interface GoalPick { state: string; trigger: string; action: string; on: string | null }

export function goalAhead(i: { memory: PamMemory; kind: "list" | "fsm"; state: string | null | undefined; tasks: readonly string[]; cls: string }): GoalPick | null {
  if (i.kind !== "fsm" || !("states" in i.memory)) return null;
  const m = i.memory;
  const byId = (id: string | undefined) => (id === undefined ? undefined : m.states.find((s) => s.id === id));
  const here = i.state === null ? null : byId(i.state) ?? byId(m.initial_state) ?? null;
  const near: { s: (typeof m.states)[number]; on: string | null }[] = here
    ? [...here.next.flatMap((n) => { const s = byId(n.to); return s && s.id !== here.id ? [{ s, on: n.on }] : []; }), { s: here, on: null }]
    : m.states.map((s) => ({ s, on: null }));
  const fits = (action: string) => i.tasks.includes(action) && taskOf(action)?.afterUse === true && touchTarget(action) === i.cls;
  const hits: GoalPick[] = near.flatMap(({ s, on }) => s.rules.filter((r) => fits(r.action)).map((r) => ({ state: s.id, trigger: r.trigger, action: r.action, on })));
  return new Set(hits.map((h) => h.action)).size === 1 ? hits[0]! : null;
}
