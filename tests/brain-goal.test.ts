// 미리 세울 목표 고르기(src/brain/goal.ts): 습관 FSM의 지금 상태와 한 걸음 뒤 상태에서, 사람이 쓰는 종류에 손대는 「떠난 뒤 하는 일」(afterUse) 규칙 하나를 고른다.
import { describe, expect, it } from "vitest";
import { goalAhead } from "../src/brain/goal.js";
import { CUP_FSM_MEMORY, type FsmMemory } from "../src/brain/decision.js";
import { TASKS, tasksFor } from "../src/act/tasks.js";

const NOONCHI = tasksFor("noonchi");
const LEFT_CUP = CUP_FSM_MEMORY.states.find((s) => s.id === "left_cup")!;
const pick = (state: string | null | undefined, o: { cls?: string; tasks?: readonly string[]; memory?: FsmMemory } = {}) =>
  goalAhead({ memory: o.memory ?? CUP_FSM_MEMORY, kind: "fsm", state, tasks: o.tasks ?? NOONCHI, cls: o.cls ?? "cup" });

describe("미리 세울 목표 고르기(습관 FSM 한 걸음 앞)", () => {
  it("마시는 중(drinking)에 컵을 쓰면 한 걸음 뒤 left_cup의 「컵 치우기」를 고르고, next 글은 컵을 두고 떠나는 글이다", () => {
    expect(pick("drinking")).toEqual({ state: "left_cup", trigger: LEFT_CUP.rules[0]!.trigger, action: "컵 치우기", on: "사용자가 컵을 두고 자리를 떠나 보이지 않는다." });
  });

  it("판단 전(undefined)이면 처음 상태(drinking)에서 보고, 앞 판에 치워 left_cup에 머물러 있으면 그 상태의 규칙으로 고른다", () => {
    expect(pick(undefined)?.action).toBe("컵 치우기");
    expect(pick("left_cup")).toMatchObject({ state: "left_cup", action: "컵 치우기", on: null });
  });

  it("afterUse 행동만 고른다: TV 보는 중 한 걸음 뒤의 「컵에 콜라 따라 주기」는 컵에 손대는 행동이어도 사람이 있는 동안 하는 일이라 빠진다", () => {
    expect(TASKS["컵 치우기"]!.afterUse).toBe(true);
    expect(TASKS["컵에 콜라 따라 주기"]!.afterUse).toBeUndefined();
    expect(TASKS["컵에 물 채워 주기"]!.afterUse).toBeUndefined();
    expect(pick("watching_tv")?.action).toBe("컵 치우기");
  });

  it("세우지 않는 때: 쓰는 종류가 다름(병), 지금 행동 목록에 없음(코치 모드), list 기억, 한 걸음 안에 없음(cooking)", () => {
    expect(pick("drinking", { cls: "bottle" })).toBeNull();
    expect(pick("drinking", { tasks: tasksFor("coach") })).toBeNull();
    expect(goalAhead({ memory: { rules: [{ trigger: "t", action: "컵 치우기" }] }, kind: "list", state: undefined, tasks: NOONCHI, cls: "cup" })).toBeNull();
    expect(pick("cooking")).toBeNull();
  });

  it("지금 상태를 정할 수 없으면(null) 모든 상태를 보고, 반성이 같은 행동 규칙을 다른 상태에 더해도 행동이 하나라 고르며 한 걸음 뒤 상태의 규칙을 먼저 본다", () => {
    expect(pick(null)?.action).toBe("컵 치우기");
    const learned: FsmMemory = { ...CUP_FSM_MEMORY, states: CUP_FSM_MEMORY.states.map((s) => (s.id === "drinking" ? { ...s, rules: [...s.rules, { trigger: "배운 트리거", action: "컵 치우기" }] } : s)) };
    expect(pick("drinking", { memory: learned })).toMatchObject({ state: "left_cup", action: "컵 치우기" });
  });
});
