// 미리 세울 목표 고르기(2026-11-18 사용자 결정): 사람이 손대는 행동의 대상을 쓰는 것을 보면, 사람 상태 FSM의 지금 상태에서 나가는 화살표의 행동을 읽어
// 사람이 떠난 뒤 할 일을 고른다. 화살표를 실행하거나 상태를 넘기지 않는다(읽기만).
// - 지금 상태(World State 하는 일로 정한 것이 먼저, 없으면 마지막 판단의 상태)에서 나가는 화살표만 본다. 자기 자신으로 가는 화살표(물 채우기)는 쓰는 중의 도움이라 목표가 아니다.
// - 맞는 화살표: 그 행동이 지금 행동 목록에 있고, afterUse이고, 손대는 종류(touchTarget)가 사람이 쓰는 종류다. 배우기 전(seed)의 떠날 때 묻기는 목표가 아니다.
// - 맞는 행동이 하나일 때만 고른다(둘 이상이면 어느 것이 먼저 올지 FSM으로 정할 수 없어 세우지 않는다).
import { taskOf, touchTarget } from "../act/tasks.js";
import type { FsmEdge, PamMemory } from "./decision.js";

/** 고른 목표: 지금 상태, 그 상태 next의 번호, 화살표 도착·사건·조건·행동. */
export interface GoalPick { state: string; index: number; to: string; on: string; when: string | null; action: string }

export function goalAhead(i: { memory: PamMemory; kind: "list" | "fsm"; state: string | null; tasks: readonly string[]; cls: string;
  allows?: (state: string, edge: FsmEdge) => boolean }): GoalPick | null {
  if (i.kind !== "fsm" || !("states" in i.memory) || i.state === null) return null;
  const here = i.memory.states.find((s) => s.id === i.state);
  if (!here) return null;
  const fits = (action: string | undefined): action is string => !!action && i.tasks.includes(action) && taskOf(action)?.afterUse === true && touchTarget(action) === i.cls;
  // 그 상태를 떠나는 화살표만(자기 자신으로 가는 화살표는 쓰는 중의 도움이라 목표가 아니다)
  const hits = here.next.map((e, index) => ({ e, index })).filter(({ e }) => e.to !== here.id && fits(e.action) && i.allows?.(here.id, e) !== false);
  if (hits.length !== 1) return null;
  const { e, index } = hits[0]!;
  return { state: here.id, index, to: e.to, on: e.on, when: e.when ?? null, action: e.action! };
}
