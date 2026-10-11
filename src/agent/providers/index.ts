// 공급자 선택: AGENT_PROVIDER > ANTHROPIC_API_KEY > OPENAI_API_KEY > mock(키가 없으면 경고).
// 키는 로그·결과에 넣지 않는다.

import type { LlmProvider } from "../agent.js";
import { AnthropicProvider, type Effort } from "./anthropic.js";
import { MockProvider } from "./mock.js";
import { OpenAIProvider } from "./openai.js";

export type ProviderName = "openai" | "anthropic" | "mock";
type Env = Record<string, string | undefined>;

const EFFORTS: Effort[] = ["low", "medium", "high", "xhigh", "max"];

export function resolveProviderName(env: Env): { name: ProviderName; warning?: string } {
  const want = env.AGENT_PROVIDER?.trim().toLowerCase();
  if (want === "openai" || want === "anthropic" || want === "mock") return { name: want };
  const bad = want ? `AGENT_PROVIDER=${want}는 모르는 값입니다(openai|anthropic|mock). ` : "";
  if (env.ANTHROPIC_API_KEY?.trim()) return bad ? { name: "anthropic", warning: bad + "anthropic을 씁니다." } : { name: "anthropic" };
  if (env.OPENAI_API_KEY?.trim()) return bad ? { name: "openai", warning: bad + "openai를 씁니다." } : { name: "openai" };
  return { name: "mock", warning: `${bad}ANTHROPIC_API_KEY·OPENAI_API_KEY 키가 없어 mock(규칙 기반) 에이전트를 씁니다.` };
}

export function createProvider(env: Env = process.env): { provider: LlmProvider; warning?: string } {
  const { name, warning } = resolveProviderName(env);
  if (name === "anthropic") {
    const key = env.ANTHROPIC_API_KEY?.trim();
    if (!key) return { provider: new MockProvider(), warning: "AGENT_PROVIDER=anthropic인데 ANTHROPIC_API_KEY가 없어 mock을 씁니다." };
    const effort = EFFORTS.find((e) => e === env.ANTHROPIC_EFFORT?.trim());
    const fallbacks = env.ANTHROPIC_FALLBACKS?.trim().toLowerCase() !== "off";
    return { provider: new AnthropicProvider({ apiKey: key, model: env.ANTHROPIC_MODEL?.trim() || undefined, effort, fallbacks }), warning };
  }
  if (name === "openai") {
    const key = env.OPENAI_API_KEY?.trim();
    if (!key) return { provider: new MockProvider(), warning: "AGENT_PROVIDER=openai인데 OPENAI_API_KEY가 없어 mock을 씁니다." };
    return { provider: new OpenAIProvider({ apiKey: key, model: env.OPENAI_MODEL?.trim() || undefined, baseURL: env.OPENAI_BASE_URL?.trim() || undefined }), warning };
  }
  return { provider: new MockProvider(), warning };
}
