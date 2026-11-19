// 실제 폰 질문은 말로 답할 수 있다(단추는 보조). 질문 답 묶음(src/act/prompts.ts QUESTION_CHOICES)마다 답 하나하나를 그 글자(label)로 말하면
// 그 답으로 맞아야 한다(src/act/tasks.ts matchChoice, 실행 추적 onHeard와 같은 길). 2026-11-17 전 matchChoice는 「네」 한 마디를 앞말로 지워
// yes_no 질문에 말로 답할 수 없었다: 그 실수에서 이 시험이 실패한다.
import { describe, expect, it } from "vitest";
import { ASK_CHOICES, QUESTION_CHOICES } from "../src/act/prompts.js";
import { matchChoice } from "../src/act/tasks.js";

describe("실제 폰 질문은 말로 답할 수 있다", () => {
  it.each(Object.entries(QUESTION_CHOICES))("%s: 답마다 그 글자로 말하면 그 답이다", (_, choices) => {
    for (const c of choices) expect(matchChoice(c.label, choices)?.id, c.label).toBe(c.id);
  });
  it("묶음에는 지금 쓰는 질문 답이 다 있다(물어보기 답 묶음·승인·다시 묻기·남은 음료 질문)", () => {
    expect(Object.keys(QUESTION_CHOICES).sort()).toEqual(["again", "approve", "clear_keep", "leftover", "yes_no"]);
    // 2026-11-20 사용자 고른 답: 컵 안에 음료가 남았으면 버려도 될지 묻는다(치워 주세요·그대로 둬요, 말로도)
    expect(QUESTION_CHOICES.leftover!.map((c) => c.label)).toEqual(["치워 주세요", "그대로 둬요"]);
    expect(matchChoice("치워 주세요", QUESTION_CHOICES.leftover!)?.id).toBe("clear");
    expect(matchChoice("그대로 둬요", QUESTION_CHOICES.leftover!)?.id).toBe("keep");
    expect(QUESTION_CHOICES.yes_no).toBe(ASK_CHOICES.yes_no);
  });
  it("「응」「네」만으로는 승인이 아니다(승인 말에 없음)", () => {
    expect(matchChoice("응", QUESTION_CHOICES.approve!)).toBeNull();
    expect(matchChoice("네", QUESTION_CHOICES.approve!)).toBeNull();
    expect(matchChoice("응 승인", QUESTION_CHOICES.approve!)?.id).toBe("approve");
  });
});
