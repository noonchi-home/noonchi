import { describe, expect, it } from "vitest";
import { ctxKey, ctxMatches, ctxOverlap, ctxSize, ctxText, dowOfDay, slotOf } from "../src/brain/ctx.js";

describe("규칙 맥락 보조 함수(요일·3시간 칸)", () => {
  it("요일은 날짜 글에서 월요일 0 … 일요일 6", () => {
    expect(dowOfDay("2026-10-12")).toBe(0);   // 월
    expect(dowOfDay("2026-10-18")).toBe(6);   // 일
    expect(dowOfDay("2026-11-21")).toBe(5);   // 토
    expect(dowOfDay("2026-11-22")).toBe(6);   // 일
    expect(dowOfDay("2028-02-29")).toBe(1);   // 윤일(화)
  });
  it("시각 칸은 자정부터 초를 3시간으로 나눈 0~7, 하루 끝도 마지막 칸", () => {
    expect([0, 10799, 10800, 6 * 3600, 20 * 3600 + 30 * 60, 21 * 3600, 86399, 86400].map(slotOf)).toEqual([0, 0, 1, 2, 6, 7, 7, 7]);
    expect(slotOf(-5)).toBe(0);
  });
  it("맞음: 맥락에 없는 칸은 상관없고 둘 다 있으면 둘 다 맞아야 한다", () => {
    expect(ctxMatches({ dow: 5 }, 5, 6)).toBe(true);
    expect(ctxMatches({ dow: 5 }, 6, 6)).toBe(false);
    expect(ctxMatches({ slot: 6 }, 0, 6)).toBe(true);
    expect(ctxMatches({ slot: 6 }, 0, 7)).toBe(false);
    expect(ctxMatches({ dow: 5, slot: 6 }, 5, 6)).toBe(true);
    expect(ctxMatches({ dow: 5, slot: 6 }, 5, 7)).toBe(false);
    expect(ctxMatches({ dow: 5, slot: 6 }, 4, 6)).toBe(false);
  });
  it("겹침: 한 칸이라도 둘 다 정해져 있고 다르면 겹치지 않는다", () => {
    expect(ctxOverlap({ dow: 5 }, { dow: 6 })).toBe(false);
    expect(ctxOverlap({ slot: 2 }, { slot: 6 })).toBe(false);
    expect(ctxOverlap({ dow: 5 }, { slot: 6 })).toBe(true);           // 토요일 18~21시에 둘 다 맞는다
    expect(ctxOverlap({ dow: 5, slot: 6 }, { dow: 5, slot: 7 })).toBe(false);
    expect(ctxOverlap({ dow: 5, slot: 6 }, { dow: 6, slot: 6 })).toBe(false);
    expect(ctxOverlap({ dow: 5 }, { dow: 5, slot: 6 })).toBe(true);
    expect(ctxOverlap({ dow: 5 }, { dow: 5 })).toBe(true);
  });
  it("글과 열쇠", () => {
    expect([{ dow: 5 }, { slot: 6 }, { dow: 5, slot: 6 }, { dow: 0, slot: 0 }].map(ctxText)).toEqual(["토요일", "18~21시", "토요일 18~21시", "월요일 0~3시"]);
    expect([{ dow: 5 }, { dow: 5, slot: 6 }, {}].map(ctxSize)).toEqual([1, 2, 0]);
    expect([ctxKey(undefined), ctxKey(null), ctxKey({}), ctxKey({ dow: 5 }), ctxKey({ dow: 5, slot: 6 })]).toEqual([null, null, null, "[5,null]", "[5,6]"]);
  });
});
