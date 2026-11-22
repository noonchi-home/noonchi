// 낮 판단의 맥락 걸러내기(src/brain/ctx.ts contextView): PAM에는 지금 요일·시각에 맞는 화살표만 맥락 칸 없이 보인다.
import { describe, expect, it } from "vitest";
import { CUP_FSM_MEMORY, validateMemory, type FsmMemory } from "../src/brain/decision.js";
import { ctxNow, contextView } from "../src/brain/ctx.js";

const LEAVE_ON = "사용자가 먹거나 마시기를 끝내고 다른 일로 넘어간다.";
const SAT = { dow: 5 }, SUN = { dow: 6 };
const drink = (m: FsmMemory) => m.states.find((s) => s.id === "drinking")!;
/** seed(마시는 중에서 떠나면 묻기) + 토요일에는 컵 치우기 + 일요일 저녁(18~21시)에는 컵 치우기. */
const withCtx = (): FsmMemory => {
  const m = structuredClone(CUP_FSM_MEMORY) as FsmMemory;
  drink(m).next.push({ to: "*", on: LEAVE_ON, action: "컵 치우기", ctx: SAT }, { to: "*", on: LEAVE_ON, action: "컵 치우기", ctx: { dow: 6, slot: 6 } });
  return m;
};

describe("낮 판단 맥락 걸러내기(contextView)", () => {
  it("맥락 화살표가 하나도 없는 기억은 같은 객체를 돌려준다", () => {
    expect(contextView(CUP_FSM_MEMORY, { dow: 5, slot: 6 })).toBe(CUP_FSM_MEMORY);
  });
  it("맞는 맥락 화살표가 있으면 같은 사건·조건의 맥락 없는 화살표(묻기)를 빼고 맥락 칸을 뗀다", () => {
    const view = contextView(withCtx(), { dow: 5, slot: 2 });          // 토요일 6~9시
    const next = drink(view).next;
    expect(next.filter((e) => e.on === LEAVE_ON)).toEqual([{ to: "*", on: LEAVE_ON, action: "컵 치우기" }]);
    expect(next.some((e) => "ctx" in e)).toBe(false);
    expect(next).toHaveLength(drink(CUP_FSM_MEMORY).next.length);       // 묻기 하나가 컵 치우기로 바뀐 것과 같다
    expect(validateMemory(view, "fsm")).toBe(view);
  });
  it("맞는 맥락이 없으면 맥락 화살표만 빠지고 묻기는 그대로다", () => {
    for (const now of [{ dow: 4, slot: 6 }, { dow: 6, slot: 2 }, { dow: 0, slot: 0 }]) {         // 금요일, 일요일 낮, 월요일 새벽
      const view = contextView(withCtx(), now);
      expect(drink(view).next).toEqual(drink(CUP_FSM_MEMORY).next);
    }
  });
  it("요일과 시각 둘 다 맞아야 하는 맥락: 일요일 저녁에만", () => {
    const sundayEvening = contextView(withCtx(), { dow: 6, slot: 6 });
    expect(drink(sundayEvening).next.find((e) => e.on === LEAVE_ON)).toEqual({ to: "*", on: LEAVE_ON, action: "컵 치우기" });
    const sundayMorning = contextView(withCtx(), { dow: 6, slot: 2 });
    expect(drink(sundayMorning).next.find((e) => e.on === LEAVE_ON)!.action).toBe("사용자에게 물어보기");
  });
  it("겹쳐서 둘 다 맞고 행동이 같으면 첫 화살표만 남긴다", () => {
    const m = structuredClone(CUP_FSM_MEMORY) as FsmMemory;
    drink(m).next.push({ to: "*", on: LEAVE_ON, action: "컵 치우기", ctx: SAT }, { to: "*", on: LEAVE_ON, action: "컵 치우기", ctx: { slot: 2 } });
    expect(drink(contextView(m, { dow: 5, slot: 2 })).next.filter((e) => e.on === LEAVE_ON)).toHaveLength(1);
  });
  it("원래 기억은 바꾸지 않는다", () => {
    const m = withCtx(); const before = structuredClone(m);
    contextView(m, { dow: 5, slot: 2 });
    expect(m).toEqual(before);
  });
  it("지금 요일·시각 칸: 서울 시간대(+540분)의 토요일 저녁 19시", () => {
    // 2026-11-21은 토요일. UTC 10:00은 서울 19:00
    expect(ctxNow(Date.parse("2026-11-21T10:00:00Z"), 540)).toEqual({ dow: 5, slot: 6 });
    expect(ctxNow(Date.parse("2026-11-21T14:59:59Z"), 540)).toEqual({ dow: 5, slot: 7 });   // 23:59:59
    expect(ctxNow(Date.parse("2026-11-21T15:00:00Z"), 540)).toEqual({ dow: 6, slot: 0 });   // 일요일 0시: 날짜가 넘어간다
    expect(ctxNow(Date.parse("2026-11-21T20:00:00Z"), -300)).toEqual({ dow: 5, slot: 5 });   // 뉴욕(-5시간) 15:00
  });
});
