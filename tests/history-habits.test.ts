// 반성 뒤 검사(src/history/habits.ts): 코치 규칙은 seed 그대로 지키고(coachGuard), 습관 거르기 자리(HabitFilter)의 기본은 모두 남기기(keepAll)다.
import { describe, expect, it } from "vitest";
import { CUP_FSM_MEMORY, validateMemory, type FsmMemory } from "../src/brain/decision.js";
import { coachGuard, keepAll, learnedRules } from "../src/history/habits.js";

const RAMEN = "라면 끓이기 알려 주기";
const SEED_COOK = CUP_FSM_MEMORY.states.find((s) => s.id === "cooking")!;
const SEED_RULE = SEED_COOK.rules[0]!;
const AIRCON = { trigger: "사용자가 TV를 보러 소파에 앉는다.", action: "에어컨 켜기" };
const clone = (): FsmMemory => structuredClone(CUP_FSM_MEMORY);
const state = (m: FsmMemory, id: string) => m.states.find((s) => s.id === id);

describe("코치 규칙 지키기(coachGuard)", () => {
  it("반성이 라면 끓이기 알려 주기 습관 규칙(저녁 19시마다)을 drinking에 더하면 그 규칙은 빠지고 notes에 kept false·reason coach로 남는다", () => {
    const proposed = clone();
    const habit = { trigger: "저녁 19시마다 사용자가 식탁에 앉는다.", action: RAMEN };
    state(proposed, "drinking")!.rules.push(habit);
    const r = coachGuard(CUP_FSM_MEMORY, proposed);
    expect(state(r.memory, "drinking")!.rules).toEqual(state(CUP_FSM_MEMORY, "drinking")!.rules);
    expect(r.notes).toContainEqual({ state: "drinking", ...habit, kept: false, reason: "coach" });
    expect(r.memory).toEqual(CUP_FSM_MEMORY);
  });

  it("반성이 seed 요리 규칙 트리거를 다듬으면 seed 트리거로 돌아간다. seed와 같은 코치 규칙은 reason unchanged다", () => {
    const proposed = clone();
    state(proposed, "cooking")!.rules[0] = { trigger: `${SEED_RULE.trigger.replace(/\.$/, "")} 또는 라면 봉지를 든다.`, action: RAMEN };
    const r = coachGuard(CUP_FSM_MEMORY, proposed);
    expect(state(r.memory, "cooking")!.rules).toEqual([SEED_RULE]);
    expect(r.notes.filter((n) => n.reason === "coach")).toEqual([{ state: "cooking", trigger: state(proposed, "cooking")!.rules[0]!.trigger, action: RAMEN, kept: false, reason: "coach" }]);
    expect(coachGuard(CUP_FSM_MEMORY, clone()).notes).toEqual([{ state: "cooking", ...SEED_RULE, kept: true, reason: "unchanged" }]);
  });

  it("반성이 cooking 상태를 지우면 seed cooking 상태가 그 코치 규칙과 함께 끝에 돌아오고, next는 있는 상태로 가는 것만 남는다. initial_state는 그대로다", () => {
    const proposed: FsmMemory = {
      initial_state: "watching_tv",
      states: clone().states.filter((s) => s.id !== "cooking" && s.id !== "drinking").map((s) => ({ ...s, next: s.next.filter((n) => n.to !== "cooking" && n.to !== "drinking") })),
    };
    const r = coachGuard(CUP_FSM_MEMORY, proposed);
    expect(r.memory.initial_state).toBe("watching_tv");
    expect(r.memory.states.at(-1)).toEqual({ id: "cooking", description: SEED_COOK.description, rules: [SEED_RULE], next: [] });
    expect(validateMemory(r.memory, "fsm")).toBe(r.memory);
  });

  it("반성이 cooking을 kitchen으로 이름을 바꾸고 요리 규칙을 옮기면 kitchen의 요리 규칙은 빠지고 seed cooking이 돌아온다", () => {
    const proposed = clone();
    for (const s of proposed.states) {
      if (s.id === "cooking") s.id = "kitchen";
      for (const n of s.next) if (n.to === "cooking") n.to = "kitchen";
    }
    const r = coachGuard(CUP_FSM_MEMORY, proposed);
    expect(state(r.memory, "kitchen")!.rules).toEqual([]);
    expect(state(r.memory, "cooking")).toEqual({ id: "cooking", description: SEED_COOK.description, rules: [SEED_RULE], next: SEED_COOK.next });
    expect(r.notes).toContainEqual({ state: "kitchen", ...SEED_RULE, kept: false, reason: "coach" });
  });

  it("에어컨 습관 규칙은 그대로 남고 learnedRules에 있다", () => {
    const proposed = clone();
    state(proposed, "watching_tv")!.rules.push(AIRCON);
    const r = coachGuard(CUP_FSM_MEMORY, proposed);
    expect(state(r.memory, "watching_tv")!.rules).toContainEqual(AIRCON);
    expect(learnedRules(CUP_FSM_MEMORY, r.memory)).toEqual([{ state: "watching_tv", ...AIRCON }]);
  });
});

describe("습관 거르기 기본(keepAll)", () => {
  it("proposed를 그대로 두고 새 규칙마다 kept true·reason habit이다", async () => {
    const proposed = clone();
    state(proposed, "watching_tv")!.rules.push(AIRCON);
    const out = await keepAll({ day: "2026-11-07", windowDays: 30, offsetMinutes: 540, previous: CUP_FSM_MEMORY, proposed, rows: [] });
    expect(out.memory).toBe(proposed);
    expect(out.notes).toEqual([{ state: "watching_tv", ...AIRCON, kept: true, reason: "habit" }]);
  });
});
