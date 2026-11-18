// 사람 상태 FSM의 지금 상태(src/brain/person.ts): 판단과 판단 사이에는 World State 사람 하는 일로 정한다(목표 세우기가 쓴다). 판단 때 상태는 PAM 답(state)이 정한다.
import { describe, expect, it } from "vitest";
import { CUP_FSM_MEMORY } from "../src/brain/decision.js";
import { stateOfWorld } from "../src/brain/person.js";
import type { WorldPerson, WorldView } from "../src/contract/world.js";

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
