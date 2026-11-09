// 호출 비용 어림(USD/백만 토큰). 표에 없는 모델(같은 서버 vLLM)은 0.
const PRICES: Record<string, { input: number; cached: number; output: number }> = {
  "gpt-5.4-mini": { input: 0.75, cached: 0.075, output: 4.5 },
  "gpt-5.4-mini-2026-03-17": { input: 0.75, cached: 0.075, output: 4.5 },
};

export function estimateCostUsd(model: string, u: { prompt: number; completion: number; cached: number }): number {
  const p = PRICES[model];
  return p ? ((u.prompt - u.cached) * p.input + u.cached * p.cached + u.completion * p.output) / 1_000_000 : 0;
}
