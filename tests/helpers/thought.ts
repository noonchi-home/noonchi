// 생각 말풍선 메시지 시험의 모델 자리: VLM 주소 자리에 붙는 가짜 OpenAI 호환 서버(scripts/fake-openai.ts)의 reply로 쓴다.
// 생각 요청(스키마 thought_messages)이면 정한 답(answer)을 내고, 붙잡아 두었으면(hold) 놓을 때(release)까지 기다렸다 낸다. 다른 요청은 null(다른 답에 맡김).
// 기본 답(chatAnswer)은 작은 모델처럼 군다: 행동 판단이면 본 것 → 근거와 할 일을, 대기면 지켜본다는 말을, 이미 올린 메시지에 있는 말은 빼고 낸다.

/** 컵 치우기 판단의 메시지 흐름: 무엇을 봤는지 → 결정적인 근거(습관)와 그래서 할 일. */
export const CUP_MESSAGES = ["사람이 컵을 두고 자리를 떠났어요", "치우는 습관이라 컵을 치울게요"];
/** 대기 판단의 메시지. */
export const WAIT_MESSAGE = "지금은 더 지켜볼게요";

/** 생각 말풍선 요청인가. */
export const isThought = (body: any): boolean => body?.response_format?.json_schema?.name === "thought_messages";

/** 생각 요청의 사용자 글: 관찰·생각·판단과 이미 올린 메시지. */
export function thoughtAsk(body: any): { decision: string; recent: string[]; text: string } {
  const text = String(body?.messages?.[1]?.content ?? "");
  const decision = /판단: ([^\n]*)/.exec(text)?.[1] ?? "";
  const recent = text.split("\n").filter((l) => l.startsWith("- ")).map((l) => l.slice(2));
  return { decision, recent, text };
}

/** 기본 답: 행동 판단은 CUP_MESSAGES, 대기는 WAIT_MESSAGE에서 이미 올린 것을 뺀 것. */
export function chatAnswer(body: any): string {
  const { decision, recent } = thoughtAsk(body);
  const want = decision === "대기" ? [WAIT_MESSAGE] : CUP_MESSAGES;
  return JSON.stringify({ messages: want.filter((m) => !recent.includes(m)) });
}

export interface ThoughtReplies {
  /** startFakeOpenAI의 reply 자리. 다른 reply와 합칠 때는 이것을 먼저 부르고 null이면 그쪽으로 넘긴다. */
  reply(body: any): string | null | Promise<string>;
  /** 받은 생각 요청 본문(받은 차례). */
  bodies: any[];
  /** 지금부터 온 생각 요청의 답을 붙잡아 둔다. */
  hold(): void;
  /** 붙잡아 둔 답을 모두 낸다. */
  release(): void;
}

export function thoughtReplies(answer: (body: any) => string = chatAnswer): ThoughtReplies {
  let gate: Promise<void> | null = null;
  let open = () => {};
  const out: ThoughtReplies = {
    bodies: [],
    reply: (body) => {
      if (!isThought(body)) return null;
      out.bodies.push(body);
      return gate ? gate.then(() => answer(body)) : answer(body);
    },
    hold: () => { gate = new Promise((ok) => { open = ok; }); },
    release: () => { open(); gate = null; },
  };
  return out;
}
