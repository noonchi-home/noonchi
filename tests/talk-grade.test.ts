// 실제 폰 명령의 소리 등급을 정하는 하나뿐인 자리(src/act/talk-grade.ts).
import { describe, expect, it } from "vitest";
import { talkGrade } from "../src/act/talk-grade.js";

const DONE = [{ id: "done", label: "완료" }];
const APPROVE = [{ id: "approve", label: "승인" }, { id: "reject", label: "거절" }];

describe("talkGrade", () => {
  it("닫힌 계획의 끄기 안내·부탁(off: 단계)과 계획 안 끄는 단계는 safety, 답 단추가 「완료」 말고 있으면 question, 그 밖은 없다", () => {
    expect(talkGrade({ step: "off:plan:pam-1:induction_1:1", choices: DONE }, false)).toBe("safety");
    expect(talkGrade({ step: "off:plan:pam-1:microwave_1:2", choices: [] }, false)).toBe("safety");
    expect(talkGrade({ step: "plan:pam-1:12", choices: DONE }, true)).toBe("safety");
    expect(talkGrade({ step: "plan:pam-1:7", choices: [] }, true)).toBe("safety");
    expect(talkGrade({ step: "plan:pam-1:7:hand", choices: APPROVE }, false)).toBe("question");
    expect(talkGrade({ step: "plan:pam-1:3", choices: [{ id: "yes", label: "네" }, { id: "no", label: "아니요" }] }, false)).toBe("question");
    expect(talkGrade({ step: "plan:pam-1:4", choices: [] }, false)).toBeUndefined();
    expect(talkGrade({ step: "plan:pam-1:1", choices: DONE }, false)).toBeUndefined();
  });
});
