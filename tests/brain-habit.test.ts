// 습관 FSM 그림 자료(src/brain/habit.ts habitView): 대시보드 FSM 카드가 그리는 상태·규칙·상태 넘김과 그 화면 글.
// 이름은 FSM_STATE_TEXT(없으면 설명 첫 마디), 규칙 조건은 ruleIf(메시지 상자 문장과 같은 글), 상태 넘김 글은 NEXT_ON(없으면 글 그대로), seed에 없는 것은 learned.
import { describe, expect, it } from "vitest";
import { CUP_FSM_MEMORY, type FsmMemory } from "../src/brain/decision.js";
import { habitView } from "../src/brain/habit.js";
import { LEARNED_FSM_MEMORY } from "../scripts/learned-memory.js";
import { publishHabit } from "../src/server/home/act.js";
import type { HabitFsm } from "../src/contract/habit.js";
import { FSM_STATE_TEXT, NEXT_ON, RULE_IF } from "../src/world/labels.js";

describe("습관 FSM 그림 자료(habitView)", () => {
  // 그림 자료는 상태 목록과 전이 목록(from·to·trigger·action)이다: 사람 상태 FSM의 화살표를 그대로 옮긴다
  it("seed 기억: 상태마다 화면 이름, 행동 화살표는 조건 RULE_IF와 행동, 행동 없는 화살표는 짧은 글 NEXT_ON. seed라 learned가 없다", () => {
    const h = habitView(CUP_FSM_MEMORY, 3);
    expect(h.version).toBe(3);
    expect(h.initial).toBe("away");
    expect(h.states).toEqual(CUP_FSM_MEMORY.states.map((s) => ({ id: s.id, name: FSM_STATE_TEXT[s.id], learned: false })));
    expect(h.transitions).toContainEqual({ from: "drinking", to: "drinking", trigger: RULE_IF["컵에 물 채워 주기"], action: "컵에 물 채워 주기", learned: false });
    expect(h.transitions).toContainEqual({ from: "watching_tv", to: "watching_tv", trigger: RULE_IF["에어컨 켜기"], action: "에어컨 켜기", learned: false });
    expect(h.transitions).toContainEqual({ from: "away", to: "drinking", trigger: "돌아와 먹거나 마심", action: null, learned: false });
    expect(h.transitions).toContainEqual({ from: "cooking", to: "drinking", trigger: "요리를 마치고 먹음", action: null, learned: false });
    expect(h.transitions).toHaveLength(CUP_FSM_MEMORY.states.reduce((n, s) => n + s.next.length, 0));
    expect(Object.keys(h).sort()).toEqual(["initial", "states", "transitions", "version"]);
  });

  it("배운 뒤 기억: 묻기 자리를 바꾼 컵 치우기는 배운 화살표이고 조건은 사용자가 정한 짧은 꼴(RULE_IF), 도착은 다른 어느 상태로든(*)", () => {
    expect(habitView(LEARNED_FSM_MEMORY, 2).transitions).toContainEqual({ from: "drinking", to: "*", trigger: RULE_IF["컵 치우기"], action: "컵 치우기", learned: true });
  });

  it("seed 기억의 행동 없는 화살표 글은 모두 NEXT_ON에 짧은 글이 있다(화살표·괄호 없이 12자 안)", () => {
    for (const s of CUP_FSM_MEMORY.states) for (const n of s.next.filter((e) => !e.action)) {
      expect(NEXT_ON[n.on], n.on).toBeTruthy();
      expect([...NEXT_ON[n.on]!].length, n.on).toBeLessThanOrEqual(12);
      expect(NEXT_ON[n.on], n.on).not.toMatch(/[→()]/);
    }
  });

  it("반성으로 배운 상태·화살표: 이름은 설명 첫 마디, 새 트리거의 조건은 줄이지 않고, 넘김 글은 끝 마침표만 뗀 글, 배운 것은 learned", () => {
    const memory: FsmMemory = {
      ...CUP_FSM_MEMORY,
      states: [
        ...CUP_FSM_MEMORY.states.map((s) => (s.id === "drinking" ? { ...s, next: [...s.next, { to: "reading", on: "사용자가 책을 펴고 읽기 시작한다." }] } : s)),
        { id: "reading", description: "사용자가 소파에서 책을 읽는 중이다. 조용히 둔다.", activity: ["reading"], next: [{ to: "*", on: "사용자가 책을 덮고 일어난다.", action: "컵 치우기" }] },
      ],
    };
    const h = habitView(memory, 9);
    expect(h.states.at(-1)).toEqual({ id: "reading", name: "사용자가 소파에서 책을 읽는 중이다", learned: true });
    expect(h.transitions).toContainEqual({ from: "reading", to: "*", trigger: "사용자가 책을 덮고 일어난다면", action: "컵 치우기", learned: true });
    expect(h.transitions).toContainEqual({ from: "drinking", to: "reading", trigger: "사용자가 책을 펴고 읽기 시작한다", action: null, learned: true });
  });
});

describe("습관 FSM 그림 보내기(publishHabit)", () => {
  it("판본이 바뀔 때만 대시보드로 {type:\"habit\"}을 보내고 마지막 것을 둔다(같은 판본은 다시 보내지 않는다)", () => {
    const sent: unknown[] = [];
    const core = { app: { broadcast: (m: unknown) => sent.push(m) }, habit: null as HabitFsm | null };
    const a = habitView(CUP_FSM_MEMORY, 1);
    publishHabit(core, a);
    publishHabit(core, habitView(CUP_FSM_MEMORY, 1));
    const b = habitView(CUP_FSM_MEMORY, 2);
    publishHabit(core, b);
    expect(sent).toEqual([{ type: "habit", habit: a }, { type: "habit", habit: b }]);
    expect(core.habit).toEqual(b);
  });
});
