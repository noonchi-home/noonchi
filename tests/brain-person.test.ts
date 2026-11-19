// 사람 상태 FSM의 지금 상태(src/brain/person.ts): 판단과 판단 사이에는 World State 사람 하는 일로 정한다(목표 세우기가 쓴다). 판단 때 상태는 PAM 답(state)이 정한다.
import { describe, expect, it } from "vitest";
import { CUP_FSM_MEMORY, fsmStep } from "../src/brain/decision.js";
import { PersonLane, stateOfWorld } from "../src/brain/person.js";
import type { DecisionRecord, PersonMessage } from "../src/contract/events.js";
import type { WorldPerson, WorldView } from "../src/contract/world.js";
import { STATE_TEXT } from "../src/world/labels.js";
import { LEARNED_FSM_MEMORY } from "../scripts/learned-memory.js";

const person = (o: Partial<WorldPerson>): Pick<WorldView, "person"> => ({ person: { visible: true, since_ms: 0, last_seen_ms: 1, count: 1, position: null, position_ms: null, room: null, room_label: null, near: [], holding: [], facts: {}, answered_ms: null, ...o } });
const act = (v: string, at = 5) => ({ activity: { value: v, at_ms: at, since_ms: at, certainty: "confirmed" as const } });

describe("World State 하는 일 → 사람 상태", () => {
  it("마시는 중이면 drinking, TV 보는 중이면 watching_tv, 안 보이면 away, 기억에 없는 활동은 임시 상태, 이번 등장 전 사실·다른 일은 null", () => {
    expect(stateOfWorld(CUP_FSM_MEMORY, person({ facts: act("drinking") }))).toBe("drinking");
    expect(stateOfWorld(CUP_FSM_MEMORY, person({ facts: act("watching_tv") }))).toBe("watching_tv");
    expect(stateOfWorld(CUP_FSM_MEMORY, person({ visible: false }))).toBe("away");
    expect(stateOfWorld(CUP_FSM_MEMORY, person({ since_ms: 10, facts: act("drinking", 5) }))).toBeNull();
    expect(stateOfWorld(CUP_FSM_MEMORY, person({ facts: act("reading") }))).toBe("~reading");
    expect(stateOfWorld(CUP_FSM_MEMORY, person({ facts: act("other") }))).toBeNull();
  });
});

/** 판단 기록 하나: PAM 답의 사람 상태·화살표(fsm은 배운 뒤 기억으로 fsmStep). */
const decisionWith = (o: { id: string; at_ms: number; late?: true; fsm: { state: string; from: string | null; next_index: number } }): DecisionRecord => {
  const prediction = { observation: "o", reasoning: "r", task_index: -1, ...o.fsm };
  return {
    id: o.id, seq: 1, atMs: o.at_ms, textSent: "t", finalTime: "x", status: "valid", prediction, action: null, memoryVersion: 1,
    world: { objects: [], person_visible: false, vlm_missing: 0, yolo_missing: 0 }, fsm: fsmStep(LEARNED_FSM_MEMORY, prediction), ...(o.late ? { late: o.late } : {}),
  };
};

describe("시간 줄 사람 줄 자료", () => {
  const seen = (): PersonMessage[] => [];
  it("사람 상태가 바뀔 때만 person 메시지를 내고, 판단(PAM 답)과 World State 하는 일 둘 다에서 받는다. 늦은 답은 쓰지 않는다", () => {
    const out = seen();
    const lane = new PersonLane({ emit: (m) => out.push(m), memory: () => LEARNED_FSM_MEMORY });
    expect(lane.last()).toBeNull();
    lane.onWorld(person({ facts: act("drinking") }), 1_000);
    lane.onWorld(person({ facts: act("drinking") }), 2_000);
    lane.onDecision(decisionWith({ id: "pam-1", at_ms: 3_000, fsm: { state: "away", from: "drinking", next_index: 0 } }));
    lane.onDecision(decisionWith({ id: "pam-2", at_ms: 4_000, late: true, fsm: { state: "drinking", from: null, next_index: -1 } }));
    lane.onWorld(person({ facts: act("reading") }), 5_000);
    expect(out.map((m) => [m.state, m.name, m.since_ms, m.source, m.decision_id])).toEqual([
      ["drinking", "먹거나 마시는 중", 1_000, "world", null],
      ["away", "자리에 없음", 3_000, "decision", "pam-1"],
      ["~reading", STATE_TEXT.reading, 5_000, "world", null],
    ]);
    expect(out.every((m) => m.type === "person")).toBe(true);
    expect(lane.last()).toMatchObject({ state: "~reading" });
  });
  // Codex(1b07d3e2 P2): 새 World State가 「자리에 없음」을 보낸 뒤 그 전 관찰의 PAM 답이 오면 사람 줄이 과거 drinking으로 돌아가고 since_ms가 거꾸로 쌓였다
  it("더 새 관찰(World State 하는 일·판단)을 받은 뒤 온 그보다 앞선 관찰의 판단은 쓰지 않는다: 사람 줄은 과거 상태로 돌아가지 않고 since_ms는 앞으로만 간다", () => {
    const out = seen();
    const lane = new PersonLane({ emit: (m) => out.push(m), memory: () => LEARNED_FSM_MEMORY });
    lane.onDecision(decisionWith({ id: "pam-1", at_ms: 1_000, fsm: { state: "drinking", from: "away", next_index: 0 } }));
    lane.onWorld(person({ visible: false }), 3_000);
    lane.onDecision(decisionWith({ id: "pam-2", at_ms: 2_000, fsm: { state: "drinking", from: null, next_index: -1 } }));   // 3초 전 관찰의 답이 늦게 옴
    lane.onWorld(person({ facts: act("drinking", 5_000) }), 5_000);
    lane.onWorld(person({ facts: act("drinking", 5_000) }), 6_000);
    lane.onDecision(decisionWith({ id: "pam-3", at_ms: 5_500, fsm: { state: "away", from: "drinking", next_index: 0 } }));   // 6초에 본 마시는 중보다 앞선 관찰
    expect(out.map((m) => [m.state, m.since_ms, m.source, m.decision_id])).toEqual([
      ["drinking", 1_000, "decision", "pam-1"],
      ["away", 3_000, "world", null],
      ["drinking", 5_000, "world", null],
    ]);
  });
  it("기억이 없거나(list·판단 전) World State로 상태를 정할 수 없으면 내지 않는다", () => {
    const out = seen();
    const lane = new PersonLane({ emit: (m) => out.push(m), memory: () => null });
    lane.onWorld(person({ facts: act("drinking") }), 1_000);
    const known = new PersonLane({ emit: (m) => out.push(m), memory: () => CUP_FSM_MEMORY });
    known.onWorld(person({ facts: act("other") }), 1_000);
    expect(out).toEqual([]);
  });
});
