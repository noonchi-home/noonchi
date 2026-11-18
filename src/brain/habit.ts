// 습관 FSM 그림 자료(대시보드 FSM 카드): 판단이 PAM에 보낸 fsm 기억(판본)을 화면 글로 옮긴다. 규칙을 실행하거나 상태를 넘기지 않는다.
// 모양은 상태 목록과 전이 목록(from·to·trigger·action): 규칙은 제자리 전이(조건 ruleIf, 메시지 상자 허락 문장과 같은 글)와 그 행동, 상태 넘김은 행동 없는 전이(NEXT_ON, 없으면 끝 마침표만 뗀 글).
// 상태 이름은 FSM_STATE_TEXT(없으면 설명 첫 마디). learned: seed 기억(CUP_FSM_MEMORY)에 없는 상태 id·트리거·행동 쌍·넘김(fsmRuleOf와 같은 뜻).
import type { HabitFsm } from "../contract/habit.js";
import { FSM_STATE_TEXT, NEXT_ON, ruleIf } from "../world/labels.js";
import { CUP_FSM_MEMORY, type FsmMemory } from "./decision.js";

/** 글 끝 마침표를 뗀다. */
const bare = (t: string) => t.trim().replace(/[.。]+$/, "");

export function habitView(memory: FsmMemory, version: number): HabitFsm {
  const seed = CUP_FSM_MEMORY.states;
  const seedRules = seed.flatMap((s) => s.rules);
  const seedNext = seed.flatMap((s) => s.next.map((n) => ({ from: s.id, ...n })));
  return {
    version,
    initial: memory.initial_state,
    states: memory.states.map((s) => ({
      id: s.id, name: FSM_STATE_TEXT[s.id] ?? bare(s.description.split(/[.。]/)[0] ?? s.description), learned: !seed.some((x) => x.id === s.id),
    })),
    transitions: memory.states.flatMap((s) => [
      // 규칙: 그 상태에 머무는 동안 조건이 되면 하는 행동(제자리 전이)
      ...s.rules.map((r) => {
        const learned = !seedRules.some((x) => x.trigger === r.trigger && x.action === r.action);
        return { from: s.id, to: s.id, trigger: ruleIf({ ...r, learned }), action: r.action as string | null, learned };
      }),
      // 상태 넘김: 행동 없이 다른 상태로
      ...s.next.map((n) => ({
        from: s.id, to: n.to, trigger: NEXT_ON[n.on] ?? bare(n.on), action: null,
        learned: !seedNext.some((x) => x.from === s.id && x.to === n.to && x.on === n.on),
      })),
    ]),
  };
}
