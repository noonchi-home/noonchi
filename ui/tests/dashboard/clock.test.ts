// @vitest-environment node
// 시스템 날짜 글(clock.ts): 설정 창 날짜 줄 「11월 27일 (금)」.
import { describe, expect, it } from "vitest";
import { dayText } from "../../src/dashboard/clock";

describe("시스템 날짜 글", () => {
  it("YYYY-MM-DD를 「월 일 (요일)」로 쓴다(넘긴 날도 그 날짜 그대로)", () => {
    expect(dayText("2026-11-27")).toBe("11월 27일 (금)");
    expect(dayText("2026-11-28")).toBe("11월 28일 (토)");
    expect(dayText("2027-01-03")).toBe("1월 3일 (일)");
  });
});
