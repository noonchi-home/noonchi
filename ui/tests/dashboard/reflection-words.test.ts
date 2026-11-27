// @vitest-environment node
// 하루 마치기·밤 반성 화면 글(ui/src/dashboard/reflection-words.ts): 채택 검사 글은 사용자가 정한 꼴, 상태는 짧은 이름, 「PAM」은 없다.
import { describe, expect, it } from "vitest";
import { pText, RW } from "../../src/dashboard/reflection-words";

/** 함수마다 인자 종류를 맞춘 보기 값. */
const SAMPLE: Record<string, unknown[]> = {
  skipped: [1], dayLine: ["11월 27일 (금)", "밤 반성 중"], maybe: ["컵 치우기"], followCount: [1, 3], unseenCount: [1],
  checkLine: [1, 0.75, 0.0001, 0.001, true], chance: [0.01], from: ["11월 28일"],
  tagChunk: ["08:10", "08:24", "마시는 중"], tagChunkTime: ["08:10", "08:24"], tagDid: ["14:41", "컵 치우기", "직접 함"], tagCandidate: ["컵 치우기"],
  tagFollowed: ["11월 26일", "1분 10초"], tagAnsweredNo: ["11월 25일"], tagUnseen: ["11월 24일"], tagNotFollowed: ["11월 23일"],
  tagAdopted: [true, "컵 치우기"], tagFrom: ["11월 28일", "컵 치우기"],
};
/** RW 안의 글(함수는 보기 값으로 부른 결과). 보기 값이 없는 함수가 있으면 실패한다. */
const texts = (v: unknown, key = ""): string[] => {
  if (typeof v === "string") return [v];
  if (typeof v === "function") {
    if (!SAMPLE[key]) throw new Error(`보기 값 없음: ${key}`);
    return [String((v as (...a: unknown[]) => unknown)(...SAMPLE[key]!))];
  }
  return v && typeof v === "object" ? Object.entries(v).flatMap(([k, x]) => texts(x, k)) : [];
};

describe("밤 반성 화면 글", () => {
  it("채택 검사 글은 따라온 비율·우연일 확률과 기준을 함께 쓴다", () => {
    expect(RW.checkLine(1, 0.75, 0.0001, 0.001, true)).toBe("100% (75% 이상) · 우연일 확률 0.0001 (0.001 미만) · 통과");
    expect(RW.checkLine(1 / 3, 0.75, 0.0297, 0.001, false)).toBe("33% (75% 이상) · 우연일 확률 0.03 (0.001 미만) · 통과 못 함");
    expect(pText(0.00001)).toBe("0.0001 미만");
    expect(RW.followCount(1, 3)).toBe("뒤따름 1 / 3");
    expect(RW.skipped(1)).toBe("다음 날로 넘김");
    expect(RW.skipped(2)).toBe("2일 넘김");
  });

  it("사람 상태는 짧은 이름이다", () => {
    expect(RW.stateName).toEqual({ drinking: "마시는 중", watching_tv: "TV 보는 중", cooking: "요리 중", away: "자리에 없음", studying: "공부 중" });
  });

  it("화면 글에 「PAM」이 없다", () => {
    const all = texts(RW);
    expect(all.length).toBeGreaterThan(40);
    expect(all.filter((t) => t.includes("PAM"))).toEqual([]);
  });
});
