// 내용물 질문(「컵 비었어요?」)의 말 답: 폰은 소리로 묻고 사람은 말로 답한다(단추 없음). 말 전체가 받는 답 문장일 때만 받는다
// (앞의 응·네·어, 「아니」 뒤 남음 답, 끝의 요는 된다). 부분 일치로 「시간 없어」「비어 있지 않아」를 빈 컵으로 읽지 않는다.
import { describe, expect, it } from "vitest";
import { CONTENTS_CHOICES, contentsAnswer } from "../src/act/prompts.js";

const value = (t: string) => contentsAnswer(t)?.value ?? null;

describe("내용물 질문의 말 답", () => {
  it.each([
    "비었어", "비었어요", "다 마셨어", "다 마셨어요.", "없어", "물 없어요", "텅 비었어", "비어 있어", "하나도 없어", "안 남았어", "다 먹었어",
    "응", "네", "네 비었어요", "어 다 마셨어",
  ])("「%s」는 비어 있음", (t) => expect(value(t)).toBe("empty"));

  it.each([
    "남았어", "아직 있어", "조금 있어", "좀 남았어요", "있어", "반쯤 남았어", "안 비었어", "아직 안 마셨어", "덜 마셨어",
    "아니", "아니요", "아니 남았어", "아뇨 아직 있어요", "안 비어 있어",
  ])("「%s」는 내용물 있음", (t) => expect(value(t)).toBe("has_contents"));

  it.each([
    "", "TV 켜 줘", "라면 먹을래", "응 그래서 내일", "완료", "마셨어", "시간 없어", "비어 있지 않아", "다 마셨어? 아니", "아니 비었어",
    "물 마실래", "컵 어디 있어", "있어 봐", "없어진 줄 알았어", "그만해",
  ])("「%s」는 답이 아니다", (t) => expect(value(t)).toBeNull());

  it("답마다 읽어 줄 글이 있고(서버 글 규칙: 60자 아래, 괄호·화살표 없음) 모두 말 전체가 답일 때만 맞으며 답 id가 겹치지 않는다", () => {
    for (const c of CONTENTS_CHOICES) {
      expect(c.reply).toBe("알겠어요");
      expect(c.label.length).toBeLessThan(60);
      expect(c.label).not.toMatch(/[()→]/);
      expect(c.whole).toBe(true);
    }
    expect(new Set(CONTENTS_CHOICES.map((c) => c.id)).size).toBe(CONTENTS_CHOICES.length);
  });
});
