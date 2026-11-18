// 사람 상태 FSM의 지금 상태를 World State로 본다(판단과 판단 사이, 목표 세우기가 쓴다). 판단 때 상태는 PAM 답(state)이 정한다.
// 시간 줄 사람 줄 자료(PersonLane): 판단의 PAM 답 상태와 판단 사이 World State 하는 일로 지금 사람 상태를 갖고, 바뀔 때만 대시보드로 보낸다.
import type { DecisionRecord, PersonMessage } from "../contract/events.js";
import type { WorldView } from "../contract/world.js";
import { FSM_STATE_TEXT, STATE_TEXT } from "../world/labels.js";
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

/** 사람 상태 화면 이름: FSM 상태 이름(FSM_STATE_TEXT), 임시 상태는 그 하는 일 이름(STATE_TEXT), 그 밖은 id. */
const nameOf = (state: string) => (state.startsWith(TEMP_STATE) ? STATE_TEXT[state.substring(TEMP_STATE.length)] : FSM_STATE_TEXT[state]) ?? state;

/** 시간 줄 사람 줄 자료: 판단 기록의 fsm.state(PAM 답)와 판단 사이 World State 하는 일(stateOfWorld)로 지금 사람 상태를 갖고, 바뀔 때만 emit한다.
 *  늦은 답(late)은 쓰지 않는다. memory는 판단이 쓰는 그날 기억(fsm이 아니거나 판단 전이면 null: World State로는 정하지 않는다). */
export class PersonLane {
  private now: PersonMessage | null = null;

  constructor(private readonly o: { emit: (m: PersonMessage) => void; memory: () => FsmMemory | null }) {}

  onDecision(r: DecisionRecord): void {
    if (r.late || r.status !== "valid" || !r.fsm) return;
    this.set(r.fsm.state, r.atMs, "decision", r.id);
  }

  onWorld(w: Pick<WorldView, "person">, atMs: number): void {
    const memory = this.o.memory();
    const state = memory ? stateOfWorld(memory, w) : null;
    if (state !== null) this.set(state, atMs, "world", null);
  }

  /** 마지막으로 낸 것(새로 붙은 대시보드에 처음 보낸다). 없으면 null. */
  last(): PersonMessage | null {
    return this.now;
  }

  private set(state: string, atMs: number, source: PersonMessage["source"], decision: string | null): void {
    if (this.now?.state === state) return;
    this.now = { type: "person", state, name: nameOf(state), since_ms: atMs, source, decision_id: decision };
    this.o.emit(this.now);
  }
}
