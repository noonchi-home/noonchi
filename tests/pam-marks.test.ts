// 덩어리 기록·시각 찾기 답 검사(src/brain/pam/marks.ts): 석준 님 pam/contracts.py validate_chunks·validate_marks 경우를 그대로(오류 글도 같다).
import { describe, expect, it } from "vitest";
import { validateChunks, validateMarks } from "../src/brain/pam/marks.js";

describe("덩어리·시각 찾기 답 검사(석준 님 validate_chunks·validate_marks)", () => {
  it("덩어리는 시각 순서로 겹치지 않고 기록 줄의 시각만, 시각 찾기는 물은 것을 꼭 한 번씩 답한다", () => {
    expect(() => validateChunks({ chunks: [{ start: "07:00:02", end: "07:00:00", text: "x" }] })).toThrow(/end must not come before start/);
    expect(() => validateChunks({ chunks: [{ start: "07:00:01", end: "07:00:03", text: "x" }] }, ["07:00:00", "07:00:10", 2])).toThrow(/not the time of a line/);
    expect(() => validateMarks({ candidates: [], actions: [], unseen: [] }, [["drinking", "c"]], [])).toThrow(/answer every asked candidate exactly once/);
  });
  it("겹친 덩어리·빈 덩어리·틀린 시각 꼴·물은 행동 빠짐·안 보인 구간 거꾸로는 거절하고, 맞는 답은 그대로 받는다", () => {
    expect(() => validateChunks({ chunks: [] })).toThrow(/at least one chunk is required/);
    expect(() => validateChunks({ chunks: [{ start: "07:00:00", end: "07:00:04", text: "a" }, { start: "07:00:04", end: "07:00:08", text: "b" }] })).toThrow(/without overlapping/);
    expect(() => validateChunks({ chunks: [{ start: "7:00", end: "07:00:04", text: "a" }] })).toThrow(/expected a time as HH:MM:SS/);
    // 이 저장소 기록은 줄 사이가 고르지 않아 줄 시각 목록으로도 받는다
    const lines = ["07:00:00", "07:00:03", "07:01:30"];
    expect(validateChunks({ chunks: [{ start: "07:00:00", end: "07:00:03", text: "a" }, { start: "07:01:30", end: "07:01:30", text: "b" }] }, lines).chunks).toHaveLength(2);
    expect(() => validateChunks({ chunks: [{ start: "07:00:01", end: "07:00:03", text: "a" }] }, lines)).toThrow(/not the time of a line/);
    const ok = { candidates: [{ state: "drinking", candidate: "c", times: ["07:00:03"] }], actions: [{ action: "컵 치우기", times: [] }], unseen: [{ start: "07:00:03", end: "07:01:30" }] };
    expect(validateMarks(ok, [["drinking", "c"]], ["컵 치우기"], lines)).toEqual(ok);
    expect(() => validateMarks({ ...ok, actions: [] }, [["drinking", "c"]], ["컵 치우기"], lines)).toThrow(/answer every asked action exactly once/);
    expect(() => validateMarks({ ...ok, unseen: [{ start: "07:01:30", end: "07:00:03" }] }, [["drinking", "c"]], ["컵 치우기"], lines)).toThrow(/end must not come before start/);
    expect(() => validateMarks({ ...ok, extra: 1 }, [["drinking", "c"]], ["컵 치우기"])).toThrow(/incorrect fields/);
  });
});
