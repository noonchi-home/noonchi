// 실제 폰의 답 단추와 말로 하는 답. 단계 명령 글은 src/plan/labels.ts STEP_COMMAND에 있다.
// npm run lint가 이 파일도 검사한다(60자 아래, 화살표·괄호 없음).

/** 답 하나. words: 폰에서 말로 답할 때 이 답으로 보는 말(단추 글도 같이 본다). reply: 말로 답하면 폰이 읽어 줄 글(빈 글이면 읽지 않는다).
 *  whole: 말 전체가 그 말일 때만 맞춘다(앞의 응·이제, 끝의 요·해·해 줘는 된다). 실제 폰이 늘 들어서 주변 말에 걸리면 안 되는 답에 쓴다. */
export interface ActionChoice { id: string; label: string; words: string[]; reply: string; whole?: boolean }
export interface ActionPrompt { text: string; choices: ActionChoice[] }

/** 질문 단계 보기(컵 치우기에서 「사용자에게 물어보기」): 실제 폰 위에 질문, 아래 엄지 자리에 답 단추. 실제 질문은 에이전트가 계획에 쓴다. */
export const ASK_PROMPT: ActionPrompt = {
  text: "컵을 치울까요?",
  choices: [
    { id: "clear", label: "치워 주세요", words: ["치워"], reply: "알겠어요. 치울게요" },
    { id: "keep", label: "그대로 둬요", words: ["그대로", "둬"], reply: "알겠어요. 그대로 둘게요" },
  ],
};

/** 질문 단계(ask)의 답 묶음: 모델은 묶음 이름만 고르고 답 단추·답 말은 이 글이다. clear_keep은 컵 치우기 질문(ASK_PROMPT)의 답이다. */
export const ASK_CHOICES: Record<"clear_keep" | "yes_no", ActionChoice[]> = {
  clear_keep: ASK_PROMPT.choices,
  yes_no: [
    { id: "yes", label: "네", words: ["네", "응"], reply: "알겠어요", whole: true },
    { id: "no", label: "아니요", words: ["아니요", "아니"], reply: "알겠어요", whole: true },
  ],
};

/** 단계 명령 아래 「완료」 단추: 비전이 못 알아볼 때 사람이 지금 단계를 넘긴다. 말로 해도 같다. 다음 명령을 읽으므로 읽어 줄 글이 없다. */
export const STEP_DONE: ActionChoice = { id: "done", label: "완료", words: ["완료", "다 했어", "다 했습니다"], reply: "", whole: true };

/** 승인 답(src/agent/approval.ts): 처음 하는 계획과 위험 목록 가전 명령 모두 승인·거절 둘. 승인은 다음 명령을 읽으므로 읽어 줄 글이 없다.
 *  둘 다 주변 말에 걸리지 않게 말 전체일 때만 맞춘다. 응·네는 늘 듣는 폰에 맞장구로 자주 들려 승인 말에 넣지 않는다. */
export const APPROVE: ActionChoice[] = [
  { id: "approve", label: "승인", words: ["승인", "좋아"], reply: "", whole: true },
  { id: "reject", label: "거절", words: ["거절", "아니", "하지 마", "취소"], reply: "알겠어요. 하지 않을게요", whole: true },
];

/** 말로 「그만」이면 지금 계획을 그만둔다. 단추는 없다. */
export const STOP: ActionChoice = { id: "stop", label: "그만", words: ["그만해", "그만둬", "그만하자"], reply: "", whole: true };

/** 단계가 시간 안에 끝나지 않아 다시 묻는 답(시간 초과 ask): 계속이면 그 단계를 다시 시작하고, 그만이면 계획을 그만둔다. */
export const AGAIN: ActionChoice[] = [
  { id: "continue", label: "계속", words: ["계속", "계속해"], reply: "", whole: true },
  { id: "stop", label: "그만", words: ["그만"], reply: "알겠어요. 그만할게요", whole: true },
];
