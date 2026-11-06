// 루트 시험 안전장치(vitest.config.ts setupFiles): 실제 AI API(OpenAI·OpenRouter·Anthropic)로 가는 fetch를 보내기 전에 막는다.
// 모델 주소는 가짜 서버(scripts/fake-openai.ts)나 닿지 않는 로컬 주소로 준다.
const REAL_AI = /(^|\.)(api\.openai\.com|openrouter\.ai|api\.anthropic\.com)$/i;

export function blockRealAi(inner: typeof fetch): typeof fetch {
  const guarded = (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    const url = typeof input === "string" || input instanceof URL ? new URL(input) : new URL(input.url);
    if (REAL_AI.test(url.hostname)) throw new Error(`시험에서 실제 AI API(${url.hostname})를 부르려 했어요. 모델 주소를 가짜 서버로 주세요.`);
    return inner(input, init);
  }) as typeof fetch & { blocksRealAi: true };
  // 먼저 건 안전장치 표시(no-real-thinq.ts의 noRealThinq)를 그대로 둔다
  Object.assign(guarded, inner);
  guarded.blocksRealAi = true;
  return guarded;
}

globalThis.fetch = blockRealAi(globalThis.fetch);
