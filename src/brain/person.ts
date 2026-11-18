// 사람 상태 FSM의 지금 상태를 World State로 본다(판단과 판단 사이, 목표 세우기가 쓴다). 판단 때 상태는 PAM 답(state)이 정한다.
import type { WorldView } from "../contract/world.js";
import { AWAY_STATE, TEMP_STATE, isTempState, type FsmMemory } from "./decision.js";

/** 사람이 안 보이면 away(기억에 있으면), 보이면 이번 등장 뒤 하는 일 사실이 activity에 든 상태, 기억에 없는 활동이면 임시 상태(~<값>), 그 밖은 null. */
export function stateOfWorld(memory: FsmMemory, world: Pick<WorldView, "person">): string | null {
  const p = world.person;
  if (!p.visible) return memory.states.some((s) => s.id === AWAY_STATE) ? AWAY_STATE : null;
  const f = p.facts.activity;
  if (!f || f.at_ms < (p.since_ms ?? Number.NEGATIVE_INFINITY)) return null;
  const owner = memory.states.find((s) => s.activity.includes(f.value));
  if (owner) return owner.id;
  // 기억에 없는 활동: 임시 상태(그날 기록으로 남아 반성이 배울 거리)
  return isTempState(memory, `${TEMP_STATE}${f.value}`) ? `${TEMP_STATE}${f.value}` : null;
}
