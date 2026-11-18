// 목표 한 줄(순수 함수, ui/src/dashboard/goal-line.ts): 미리 세운 목표는 사람 FSM과 따로 된 상태 머신(세움 → 준비됨 → 시작 → 끝/버림)이고,
// FSM 카드에 그리지 않고 「목표 · 컵 치우기 · 준비됨」 한 줄로 보인다(2026-11-18 사용자 결정).
import { describe, expect, it } from "vitest";
import type { PendingGoal } from "../../../src/contract/goal.ts";
import type { ServerMessage } from "../../../src/contract/events.ts";
import { EMPTY_DASH, reduceDash } from "../../src/dashboard/data";
import { goalLineOf } from "../../src/dashboard/goal-line";
import { PLAN } from "./fixtures";

const GOAL: PendingGoal = {
  id: "goal-1", action: "컵 치우기", state: "left_cup", trigger: "t", object: "cup_1", cls: "cup", status: "armed", prep: "waiting",
  reason: null, text: "컵을 두고 자리를 뜨면 컵을 치울게요", armed_ms: 1, ready_ms: null, gone_ms: null, fired_ms: null, plan: null,
};
const feed = (ms: ServerMessage[]) => ms.reduce((s, m) => reduceDash(s, m, 0), EMPTY_DASH);
const at = (goal: PendingGoal, ...more: ServerMessage[]) => goalLineOf(feed([{ type: "goal", goal }, ...more]));

describe("목표 한 줄(goalLineOf)", () => {
  it("목표가 없으면 없다", () => {
    expect(goalLineOf(EMPTY_DASH)).toBeNull();
  });

  it("세움(미리 만드는 중) → 준비됨(계획 준비) → 시작(사람이 떠남·준비한 계획을 씀) → 끝(그 계획이 끝남)", () => {
    expect(at(GOAL)).toEqual({ stage: "set", text: "목표 · 컵 치우기 · 세움" });
    expect(at({ ...GOAL, prep: "planning" })!.stage).toBe("set");
    expect(at({ ...GOAL, prep: "ready" })).toEqual({ stage: "ready", text: "목표 · 컵 치우기 · 준비됨" });
    expect(at({ ...GOAL, status: "fired", prep: "ready" })).toEqual({ stage: "started", text: "목표 · 컵 치우기 · 시작" });
    expect(at({ ...GOAL, status: "used", prep: "ready" })!.stage).toBe("started");
    expect(at({ ...GOAL, status: "used", prep: "ready" }, { type: "plan", plan: PLAN })!.stage).toBe("started");
    expect(at({ ...GOAL, status: "used", prep: "ready" }, { type: "plan", plan: { ...PLAN, status: "done" } })).toEqual({ stage: "done", text: "목표 · 컵 치우기 · 끝" });
  });

  it("버리면 「버림」이다(미리 만들기 실패는 세움 그대로)", () => {
    expect(at({ ...GOAL, status: "dropped", reason: "back" })).toEqual({ stage: "dropped", text: "목표 · 컵 치우기 · 버림" });
    expect(at({ ...GOAL, prep: "failed" })!.stage).toBe("set");
  });

  it("hello면 없다", () => {
    expect(goalLineOf(feed([{ type: "goal", goal: GOAL }, { type: "hello", devices: 0, provider: null, hub: "memory", home: null }]))).toBeNull();
  });
});
