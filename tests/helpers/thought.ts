// 생각 말풍선 두 줄 시험의 모델 자리: VLM 주소 자리에 붙는 가짜 OpenAI 호환 서버(scripts/fake-openai.ts)의 reply로 쓴다.
// 생각 요청(스키마 thought_lines)이면 정한 두 줄(answer)을 내고, 붙잡아 두었으면(hold) 놓을 때(release)까지 기다렸다 낸다. 다른 요청은 null(다른 답에 맡김).
export const LINES = { seen: "사람이 컵을 식탁에 두고 자리를 떠났어요", why: "컵을 두고 떠나면 치우는 습관대로 컵을 치울게요" };

/** 생각 말풍선 요청인가. */
export const isThought = (body: any): boolean => body?.response_format?.json_schema?.name === "thought_lines";

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

export function thoughtReplies(answer: (body: any) => string = () => JSON.stringify(LINES)): ThoughtReplies {
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
