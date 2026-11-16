// @vitest-environment node
// 트윈 오른쪽 위 날짜·시간 칩 글(clock.ts): 서버 기록 시간대(HISTORY_TZ_MINUTES, /api/health tz_minutes)로 「11월 17일 (화) 01:30」 꼴. 분이 바뀔 때만 다시 그린다.
import { describe, expect, it } from "vitest";
import { clockText, untilNextMinute } from "../../src/dashboard/clock";

describe("날짜·시간 칩 글", () => {
  // 2026-11-16 16:30:59 UTC = 서울(540분) 2026-11-17 01:30:59 화요일
  const AT = Date.UTC(2026, 10, 16, 16, 30, 59);

  it("기록 시간대(분)로 「월 일 (요일) 시:분」을 쓴다. 시·분은 두 자리 24시간이다", () => {
    expect(clockText(AT, 540)).toBe("11월 17일 (화) 01:30");
    expect(clockText(AT, 0)).toBe("11월 16일 (월) 16:30");
    expect(clockText(Date.UTC(2026, 0, 4, 23, 5), -300)).toBe("1월 4일 (일) 18:05");
  });

  it("다음 분이 바뀔 때까지 남은 ms: 분 첫 순간이면 1분 뒤", () => {
    expect(untilNextMinute(AT)).toBe(1000);
    expect(untilNextMinute(Date.UTC(2026, 10, 16, 16, 31, 0))).toBe(60_000);
    expect(untilNextMinute(Date.UTC(2026, 10, 16, 16, 31, 0) + 250)).toBe(59_750);
  });
});
