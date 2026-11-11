// 호출 비용 어림(USD/백만 토큰). 표에 없는 모델(같은 서버 vLLM)은 0.
const PRICES: Record<string, { input: number; cached: number; output: number }> = {
  "gpt-5.4-mini": { input: 0.75, cached: 0.075, output: 4.5 },
  "gpt-5.4-mini-2026-03-17": { input: 0.75, cached: 0.075, output: 4.5 },
  "gpt-5.4-nano": { input: 0.2, cached: 0.02, output: 1.25 },
  "gpt-5.4-nano-2026-03-17": { input: 0.2, cached: 0.02, output: 1.25 },
};

/** 가격표에 있는 모델인가. 없으면 estimateCostUsd는 0이지만 비용은 모름이다(관찰 모드 비용 null). */
export function hasPrice(model: string): boolean {
  return Object.hasOwn(PRICES, model);
}

export function estimateCostUsd(model: string, u: { prompt: number; completion: number; cached: number }): number {
  const p = PRICES[model];
  return p ? ((u.prompt - u.cached) * p.input + u.cached * p.cached + u.completion * p.output) / 1_000_000 : 0;
}
