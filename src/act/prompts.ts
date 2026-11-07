// 행동마다 폰에 보이고 소리로 읽는 부탁·질문 글과 버튼. 로봇이 없어 집기·옮기기는 사람에게 부탁한다. would는 로봇이라면 했을 일.
// npm run lint가 이 파일도 검사한다(60자 아래, 화살표·괄호 없음).

/** 버튼 하나. words: 폰에서 말로 답할 때 이 선택지로 보는 말(버튼 글도 같이 본다). reply: 말로 답하면 폰이 읽어 줄 글. */
export interface ActionChoice { id: string; label: string; words: string[]; reply: string }
export interface ActionPrompt { text: string; choices: ActionChoice[]; would: string }

export type TaskName = "컵 치우기" | "사용자에게 물어보기";

export const PROMPTS: Record<TaskName, ActionPrompt> = {
  "컵 치우기": {
    text: "식탁 위 컵을 치워 주세요",
    choices: [
      { id: "done", label: "치웠어요", words: ["치웠", "다 했"], reply: "고마워요. 컵이 안 보이는지 확인할게요" },
      { id: "later", label: "나중에", words: ["나중", "이따"], reply: "알겠어요. 다음에 다시 볼게요" },
    ],
    would: "로봇이 식탁의 컵을 싱크대로 옮긴다",
  },
  "사용자에게 물어보기": {
    text: "컵을 치울까요?",
    choices: [
      { id: "clear", label: "치워 주세요", words: ["치워"], reply: "알겠어요. 치울게요" },
      { id: "keep", label: "그대로 둬요", words: ["그대로", "둬"], reply: "알겠어요. 그대로 둘게요" },
    ],
    would: "사용자에게 컵을 치울지 묻는다",
  },
};
