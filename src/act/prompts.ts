// 실제 폰의 답 단추와 말로 하는 답. 단계 명령 글은 src/act/labels.ts STEP_COMMAND에 있다.
// npm run lint가 이 파일도 검사한다(60자 아래, 화살표·괄호 없음).
import { matchChoice } from "./tasks.js";

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

/** 내용물 질문의 답 하나: 맞으면 그 값. */
export interface ContentsChoice extends ActionChoice { value: "empty" | "has_contents" }
const OK = "알겠어요";
/** 받는 빈 컵 답 문장(띄어쓰기 없이). 말 전체가 이 문장이어야 한다(앞의 응·네·어, 끝의 요는 된다). */
const EMPTY_SAID = ["비었어", "비어있어", "다비었어", "텅비었어", "다마셨어", "다먹었어", "없어", "물없어", "하나도없어", "안남았어", "남은거없어", "남은게없어", "컵비었어"];
/** 받는 남음 답 문장. 앞에 「아니」「아뇨」가 붙어도 된다. */
const HAS_SAID = ["남았어", "남아있어", "아직있어", "조금있어", "좀있어", "있어", "물있어", "반쯤남았어", "조금남았어", "좀남았어", "아직남았어", "많이남았어", "안비었어", "안비어있어", "아직안마셨어", "덜마셨어"];
/** 내용물 질문(「컵 비었어요?」, src/act/track/contents.ts)의 말 답. 단추는 없다(폰은 말로만 묻고 말로만 받는다). 모두 말 전체가 답일 때만(whole) 맞는다:
 *  부분 일치면 「시간 없어」「비어 있지 않아」를 빈 컵으로 읽는다. */
export const CONTENTS_CHOICES: readonly ContentsChoice[] = [
  { id: "empty", value: "empty", label: "비었어요", words: EMPTY_SAID, reply: OK, whole: true },
  { id: "has", value: "has_contents", label: "남았어요", words: [...HAS_SAID, ...HAS_SAID.map((w) => `아니${w}`), ...HAS_SAID.map((w) => `아뇨${w}`)], reply: OK, whole: true },
  { id: "yes", value: "empty", label: "네", words: ["네", "응", "예", "맞아"], reply: OK, whole: true },
  { id: "no", value: "has_contents", label: "아니요", words: ["아니", "아니요", "아뇨"], reply: OK, whole: true },
];

/** 폰에서 들은 말 → 내용물 답(없으면 null). */
export const contentsAnswer = (text: string): ContentsChoice | null => matchChoice(text, CONTENTS_CHOICES) as ContentsChoice | null;

/** 실제 폰 질문의 답 묶음 전부: 물어보기 답 묶음(ASK_CHOICES), 승인, 시간 초과 다시 묻기, 내용물. 새 질문 답 묶음은 여기에 더한다.
 *  tests/voice-answers.test.ts가 답마다 그 글자로 말하면 그 답인지 본다(실제 폰 질문은 말로 답할 수 있다). */
export const QUESTION_CHOICES: Readonly<Record<string, readonly ActionChoice[]>> = { ...ASK_CHOICES, approve: APPROVE, again: AGAIN, contents: CONTENTS_CHOICES };
