// PAM 관찰 텍스트: 시각이 붙은 줄(오래된 것부터) + [지속] 오래 이어진 사실 + [눈] 클로이드 눈 위치.
import { describe, expect, it } from "vitest";
import { buildPamText, clock, collapseLines } from "../src/world/text.js";

const T = (h: number, m: number, s: number) => Date.UTC(2026, 10, 7, h - 9, m, s);
describe("PAM 관찰 텍스트", () => {
  it("시각이 붙은 줄을 오래된 것부터, 오래 이어진 사실과 눈 위치를 뒤에 둔다", () => {
    const text = buildPamText({ offsetMinutes: 540, lines: [{ atMs: T(21, 0, 4), text: "사람 안 보임" }, { atMs: T(21, 0, 0), text: "사람 보임" }],
      facts: ["컵(cup_1) 식탁 위: 21:00:00부터 8초째"], eye: "클로이드 눈: 거실, 식탁 쪽" });
    expect(text).toBe("21:00:00 사람 보임\n21:00:04 사람 안 보임\n[지속] 컵(cup_1) 식탁 위: 21:00:00부터 8초째\n[눈] 클로이드 눈: 거실, 식탁 쪽");
  });

  it("줄이 많으면 최근 maxLines줄만 둔다", () => {
    const lines = Array.from({ length: 50 }, (_, i) => ({ atMs: T(21, 0, i), text: `줄${i}` }));
    expect(buildPamText({ offsetMinutes: 540, lines, facts: [], maxLines: 3 }).split("\n")).toEqual(["21:00:47 줄47", "21:00:48 줄48", "21:00:49 줄49"]);
  });

  it("이어진 같은 줄은 시각 범위와 횟수로 묶는다", () => {
    const lines = [0, 1, 2].map((s) => ({ atMs: T(21, 0, s), text: "요청이 몰려 VLM 분석 없음" })).concat([{ atMs: T(21, 0, 3), text: "사람 보임" }]);
    expect(collapseLines(lines, 540)).toEqual(["21:00:00~21:00:02 요청이 몰려 VLM 분석 없음 3번", "21:00:03 사람 보임"]);
  });

  it("떨어진 같은 줄은 묶지 않고, 빈 입력은 빈 글이다", () => {
    const lines = [{ atMs: T(21, 0, 0), text: "a" }, { atMs: T(21, 0, 1), text: "b" }, { atMs: T(21, 0, 2), text: "a" }];
    expect(collapseLines(lines, 540)).toEqual(["21:00:00 a", "21:00:01 b", "21:00:02 a"]);
    expect(buildPamText({ offsetMinutes: 540, lines: [], facts: [] })).toBe("");
  });

  it("시각은 그 시간대(분)의 시:분:초", () => {
    expect(clock(T(23, 59, 59), 540)).toBe("23:59:59");
    expect(clock(Date.UTC(2026, 10, 7, 0, 0, 5), 0)).toBe("00:00:05");
  });
});
