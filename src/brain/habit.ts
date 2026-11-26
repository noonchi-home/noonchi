// 습관 FSM 그림 자료(대시보드 시간 줄 사람 줄의 상태 이름): 판단이 PAM에 보낸 사람 상태 FSM 기억(판본)을 화면 글로 옮긴다. 화살표를 실행하거나 상태를 넘기지 않는다.
// 모양은 상태 목록과 전이 목록(from·to·trigger·action): 행동 화살표는 조건(ruleIf, 메시지 상자 허락 문장과 같은 글)과 그 행동, 행동 없는 화살표는 상태 넘김(NEXT_ON, 없으면 끝 마침표만 뗀 글).
// to "*"는 다른 어느 상태로든이다. 상태 이름은 FSM_STATE_TEXT(없으면 설명 첫 마디). learned: seed 기억(CUP_FSM_MEMORY)에 없는 상태·화살표(edgeLearned와 같은 뜻).
import type { HabitFsm } from "../contract/habit.js";
import { FSM_STATE_TEXT, NEXT_ON, ruleIf } from "../world/labels.js";
import { CUP_FSM_MEMORY, edgeLearned, seedTrigger, squash, type FsmMemory } from "./decision.js";
import { ctxText } from "./ctx.js";

/** 글 끝 마침표를 뗀다. */
const bare = (t: string) => t.trim().replace(/[.。]+$/, "");

export function habitView(memory: FsmMemory, version: number): HabitFsm {
  const seed = CUP_FSM_MEMORY.states;
  return {
    version,
    initial: memory.initial_state,
    states: memory.states.map((s) => ({
      id: s.id, name: FSM_STATE_TEXT[s.id] ?? bare(s.description.split(/[.。]/)[0] ?? s.description), learned: !seed.some((x) => x.id === s.id),
    })),
    transitions: memory.states.flatMap((s) => s.next.map((e) => {
      if (e.action) {
        // 행동 화살표: 배운 화살표라도 seed와 같은 트리거(묻기 자리를 바꾼 컵 치우기)면 사용자가 정한 짧은 꼴
        const learned = edgeLearned(s.id, e);
        const short = !learned || seedTrigger(s.id, e.on, e.when ?? null);
        const rule = ruleIf({ trigger: e.when ? `${e.on} ${e.when}` : e.on, action: e.action, learned: !short });
        // 요일·시각 맥락이 있는 화살표는 조건 글 앞에 맥락 글을 붙이고 ctx 칸에도 싣는다(맥락이 없으면 예전 모양 그대로)
        return { from: s.id, to: e.to, trigger: e.ctx ? `${ctxText(e.ctx)} · ${rule}` : rule, action: e.action as string | null, learned, ...(e.ctx ? { ctx: ctxText(e.ctx) } : {}) };
      }
      // 상태 넘김: 행동 없이 다른 상태로
      const learned = !seed.find((x) => x.id === s.id)?.next.some((x) => !x.action && x.to === e.to && squash(x.on) === squash(e.on));
      return { from: s.id, to: e.to, trigger: NEXT_ON[e.on] ?? bare(e.on), action: null, learned };
    })),
  };
}
