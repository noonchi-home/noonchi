// 실제 폰의 답 단추와 말로 하는 답. 단계 명령 글은 src/plan/labels.ts STEP_COMMAND에 있다.
// npm run lint가 이 파일도 검사한다(60자 아래, 화살표·괄호 없음).

/** 답 하나. words: 폰에서 말로 답할 때 이 답으로 보는 말(단추 글도 같이 본다). reply: 말로 답하면 폰이 읽어 줄 글(빈 글이면 읽지 않는다).
 *  whole: 말 전체가 그 말일 때만 맞춘다(앞의 응·이제, 끝의 요는 된다). 실제 폰이 늘 들어서 주변 말에 걸리면 안 되는 답에 쓴다. */
export interface ActionChoice { id: string; label: string; words: string[]; reply: string; whole?: boolean }
export interface ActionPrompt { text: string; choices: ActionChoice[] }

export type TaskName = "컵 치우기" | "사용자에게 물어보기";

/** 사용자에게 물어보기: 실제 폰 위에 질문, 아래 엄지 자리에 답 단추. */
export const ASK_PROMPT: ActionPrompt = {
  text: "컵을 치울까요?",
  choices: [
    { id: "clear", label: "치워 주세요", words: ["치워"], reply: "알겠어요. 치울게요" },
    { id: "keep", label: "그대로 둬요", words: ["그대로", "둬"], reply: "알겠어요. 그대로 둘게요" },
  ],
};

/** 단계 명령 아래 「완료」 단추: 비전이 못 알아볼 때 사람이 지금 단계를 넘긴다. 말로 해도 같다. 다음 명령을 읽으므로 읽어 줄 글이 없다. */
export const STEP_DONE: ActionChoice = { id: "done", label: "완료", words: ["완료", "다 했어", "다 했습니다"], reply: "", whole: true };

/** 승인 답(src/agent/approval.ts): 처음 하는 계획·「하지 마」를 기억한 가전 명령은 셋, 위험 목록 가전 명령은 이번만·하지 마 둘.
 *  이번만·앞으로도는 다음 명령을 읽으므로 읽어 줄 글이 없다. 하지 마는 주변 말에 걸리지 않게 말 전체일 때만 맞춘다. */
export const APPROVE: ActionChoice[] = [
  { id: "once", label: "이번만", words: ["이번만", "이번에만"], reply: "" },
  { id: "always", label: "앞으로도", words: ["앞으로도", "앞으로", "항상", "계속"], reply: "" },
  { id: "never", label: "하지 마", words: ["하지 마", "하지마", "안 돼", "싫어"], reply: "알겠어요. 하지 않을게요", whole: true },
];

/** 말로 「그만」이면 지금 계획을 그만둔다. 단추는 없다. */
export const STOP: ActionChoice = { id: "stop", label: "그만", words: ["그만해", "그만둬", "그만하자"], reply: "", whole: true };
