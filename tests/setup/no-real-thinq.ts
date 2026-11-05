// 루트 시험 안전장치(vitest.config.ts setupFiles): 실제 LG ThinQ 서버(*.lgthinq.com)로 가는 fetch를 막는다.
// 시험은 가짜 ThinQ 서버(tests/helpers/thinq.ts, 127.0.0.1)만 부른다.

const REAL_THINQ = /(^|\.)lgthinq\.com$/i;

function urlOf(input: Parameters<typeof fetch>[0]): URL {
  if (typeof input === "string" || input instanceof URL) return new URL(input);
  return new URL(input.url);
}

export function guardFetch(inner: typeof fetch): typeof fetch {
  const guarded = (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    const host = urlOf(input).hostname;
    if (REAL_THINQ.test(host)) throw new Error(`시험에서 실제 ThinQ(${host})를 부르려 했어요. THINQ_BASE_URL을 가짜 서버로 주세요.`);
    return inner(input, init);
  }) as typeof fetch & { noRealThinq?: true };
  guarded.noRealThinq = true;
  return guarded;
}

globalThis.fetch = guardFetch(globalThis.fetch);
