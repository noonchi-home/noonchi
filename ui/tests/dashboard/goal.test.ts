// 미리 세운 목표(순수 함수, ui/src/dashboard/goal.ts): 목표는 사람 FSM과 따로 된 상태 머신(세움 → 준비됨 → 시작 → 끝/버림)이다.
// 메시지 상자에는 목표 칩을 두지 않고(문장 「컵을 두고 자리를 뜨면 컵을 치울게요」가 목표를 말한다), 목표가 선 동안 트윈의 치울 컵 위에 작은 빨간 고리를 둔다(2026-11-18 사용자 결정).
import { describe, expect, it } from "vitest";
import type { PendingGoal } from "../../../src/contract/goal.ts";
import type { ServerMessage } from "../../../src/contract/events.ts";
import { EMPTY_DASH, reduceDash } from "../../src/dashboard/data";
import { goalOf } from "../../src/dashboard/goal";
import { PLAN } from "./fixtures";

const GOAL: PendingGoal = {
  id: "goal-1", action: "컵 치우기", state: "left_cup", trigger: "t", object: "cup_1", cls: "cup", status: "armed", prep: "waiting",
  reason: null, text: "컵을 두고 자리를 뜨면 컵을 치울게요", armed_ms: 1, ready_ms: null, gone_ms: null, fired_ms: null, ended_ms: null, plan: null,
};
const feed = (ms: ServerMessage[]) => ms.reduce((s, m) => reduceDash(s, m, 0), EMPTY_DASH);
const at = (goal: PendingGoal, ...more: ServerMessage[]) => goalOf(feed([{ type: "goal", goal }, ...more]));

describe("미리 세운 목표(goalOf)", () => {
  it("목표가 없으면 없다", () => {
    expect(goalOf(EMPTY_DASH)).toBeNull();
  });

  it("세움(미리 만드는 중) → 준비됨(계획 준비) → 시작(사람이 떠남·준비한 계획을 씀) → 끝(그 계획이 끝남). 대상 물건과 행동을 싣는다", () => {
    expect(at(GOAL)).toEqual({ stage: "set", action: "컵 치우기", object: "cup_1", standing: true });
    expect(at({ ...GOAL, prep: "planning" })!.stage).toBe("set");
    expect(at({ ...GOAL, prep: "ready" })!.stage).toBe("ready");
    expect(at({ ...GOAL, status: "fired", prep: "ready" })!.stage).toBe("started");
    expect(at({ ...GOAL, status: "used", prep: "ready" })!.stage).toBe("started");
    expect(at({ ...GOAL, status: "used", prep: "ready" }, { type: "plan", plan: PLAN })!.stage).toBe("started");
    expect(at({ ...GOAL, status: "used", prep: "ready" }, { type: "plan", plan: { ...PLAN, status: "done" } })!.stage).toBe("done");
  });

  it("목표가 선 동안(세움·준비됨·시작)만 standing이고, 끝·버림이면 아니다(트윈 고리가 사라진다)", () => {
    expect(at({ ...GOAL, prep: "ready" })!.standing).toBe(true);
    expect(at({ ...GOAL, status: "fired", prep: "ready" })!.standing).toBe(true);
    expect(at({ ...GOAL, status: "dropped", reason: "back" })).toMatchObject({ stage: "dropped", standing: false });
    expect(at({ ...GOAL, status: "used", prep: "ready" }, { type: "plan", plan: { ...PLAN, status: "done" } })!.standing).toBe(false);
    expect(at({ ...GOAL, prep: "failed" })).toMatchObject({ stage: "set", standing: true });
  });

  it("hello면 없다", () => {
    expect(goalOf(feed([{ type: "goal", goal: GOAL }, { type: "hello", devices: 0, provider: null, hub: "memory", home: null }]))).toBeNull();
  });
});
