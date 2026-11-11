// 관찰 모드 시험의 모델 자리: 가짜 OpenAI 호환 서버(scripts/fake-openai.ts)가 관찰 모드 요청(instructions OBSERVER_PROMPT)에 대본의 도구 호출을 낸다.
// 공급자는 서버와 같은 createProvider(OpenAI Responses API, OPENAI_BASE_URL, OPENAI_MODEL=gpt-5.4-mini)다.
// 대본은 입력 글(src/agent/observer.ts observerInput)과 몇 번째 차례인가(앞 도구 결과 묶음·다시 부탁한 말 수)를 받는다. 차례 셈은 계획 모드와 같다(planTurn).
import { startFakeOpenAI, type FakeResponse } from "../../scripts/fake-openai.js";
import type { LlmProvider } from "../../src/agent/agent.js";
import { OBSERVER_PROMPT } from "../../src/agent/observer.js";
import { createProvider } from "../../src/agent/providers/index.js";
import type { LlmTurn } from "./llm.js";
import { planTurn } from "./planner.js";

/** 관찰 모드 요청인가. */
export const isObserving = (body: any): boolean => body?.instructions === OBSERVER_PROMPT;

/** 입력 글·차례 → 그 차례(글이면 답 글, 목록이면 도구 호출). undefined면 글 답(도구 없음). */
export type ObserveScript = (input: string, round: number) => LlmTurn | undefined;

/** 가짜 OpenAI 서버의 respond: 관찰 모드 요청에 대본의 차례를 낸다. 관찰 모드가 아니면 null. */
export function observerRespond(script: ObserveScript): (body: any) => FakeResponse | null {
  return (body) => {
    if (!isObserving(body)) return null;
    const t = planTurn(body);
    const turn = t ? script(t.input, t.round) : undefined;
    if (turn === undefined) return { text: "기다릴게요." };
    return typeof turn === "string" ? { text: turn } : { calls: turn.map(([name, args]) => ({ name, args })) };
  };
}

export interface FakeObserver {
  url: string;
  env: { OPENAI_API_KEY: string; OPENAI_BASE_URL: string; OPENAI_MODEL: string };
  /** 지금 대본. 시험 중에 바꾼다. */
  script: ObserveScript;
  /** 이 주소 자리에 붙은 공급자(서버와 같은 createProvider). */
  provider(): LlmProvider;
  /** 관찰 모드 요청 본문(받은 순서, 답을 붙잡은 요청도 든다). */
  bodies(): any[];
  close(): Promise<void>;
}

/** 관찰 모드 대본을 내는 가짜 OpenAI 서버. reply는 VLM(chat completions) 답, gate는 관찰 모드 답을 붙잡아 둘 때(풀리면 답한다). */
export async function startFakeObserver(script: ObserveScript, o: { reply?: (body: any) => string | null; gate?: (body: any) => Promise<void> } = {}): Promise<FakeObserver> {
  const out = { script } as FakeObserver;
  const fake = await startFakeOpenAI({
    reply: o.reply,
    respond: async (body) => {
      if (!isObserving(body)) return null;
      await o.gate?.(body);
      return observerRespond(out.script)(body);
    },
  });
  const env = { OPENAI_API_KEY: "fake-key", OPENAI_BASE_URL: `${fake.url}/v1`, OPENAI_MODEL: "gpt-5.4-mini" };
  return Object.assign(out, {
    url: fake.url, env,
    provider: () => createProvider(env).provider,
    bodies: () => fake.requests.filter((r) => r.method === "POST" && r.path.endsWith("/responses") && isObserving(r.body)).map((r) => r.body),
    close: () => fake.close(),
  });
}
