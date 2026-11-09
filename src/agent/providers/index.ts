// 공급자 선택: AGENT_PROVIDER(openai|anthropic) > ANTHROPIC_API_KEY가 있으면 anthropic > openai.
// 키가 없어도 다른 공급자로 바꾸지 않는다: 고른 공급자로 뜨고, 부르면 키가 없다고 실패하고, /api/health ready.agent가 준비 안 됨이다(src/server/ready.ts).
// 시험·키 없는 컨테이너 확인은 같은 OpenAI 공급자를 OPENAI_BASE_URL로 가짜 OpenAI 호환 서버(scripts/fake-openai.ts)에 붙인다.
// 키는 로그·결과에 넣지 않는다.

import type { LlmProvider } from "../agent.js";
import { AnthropicProvider, type Effort } from "./anthropic.js";
import { OpenAIProvider } from "./openai.js";

export type ProviderName = "openai" | "anthropic";
type Env = Record<string, string | undefined>;

const EFFORTS: Effort[] = ["low", "medium", "high", "xhigh", "max"];

/** 공급자마다 기본 주소·모델과 키·주소·모델 설정 이름. anthropic 주소는 고정이다. */
export const AGENT_DEFAULTS: Record<ProviderName, { baseUrl: string; model: string; keyEnv: string; modelEnv: string; baseEnv?: string }> = {
  openai: { baseUrl: "https://api.openai.com/v1", model: "gpt-5.5", keyEnv: "OPENAI_API_KEY", modelEnv: "OPENAI_MODEL", baseEnv: "OPENAI_BASE_URL" },
  anthropic: { baseUrl: "https://api.anthropic.com", model: "claude-opus-5-5", keyEnv: "ANTHROPIC_API_KEY", modelEnv: "ANTHROPIC_MODEL" },
};

/** 에이전트가 부르는 공급자·주소·모델·키. 키가 없으면 apiKey는 빈 글이다. */
export interface AgentEndpoint { provider: ProviderName; baseUrl: string; model: string; apiKey: string }

export function resolveProviderName(env: Env): { name: ProviderName; warning?: string } {
  const want = env.AGENT_PROVIDER?.trim().toLowerCase();
  if (want === "openai" || want === "anthropic") return { name: want };
  const name: ProviderName = env.ANTHROPIC_API_KEY?.trim() ? "anthropic" : "openai";
  return want ? { name, warning: `AGENT_PROVIDER=${want}는 모르는 값입니다(openai|anthropic). ${name === "anthropic" ? "anthropic을" : "openai를"} 씁니다.` } : { name };
}

/** 공급자와 주소·모델·키. 키가 없으면 경고를 낸다(공급자는 그대로). */
export function agentEndpoint(env: Env): AgentEndpoint & { warning?: string } {
  const { name, warning } = resolveProviderName(env);
  const d = AGENT_DEFAULTS[name];
  const v = (k: string | undefined) => (k ? env[k]?.trim() || undefined : undefined);
  const apiKey = v(d.keyEnv) ?? "";
  const missing = apiKey ? undefined : `${d.keyEnv}가 없어 에이전트(${name})가 준비되지 않았습니다. 폰 대화가 실패합니다.`;
  return {
    provider: name, baseUrl: (v(d.baseEnv) ?? d.baseUrl).replace(/\/+$/, ""), model: v(d.modelEnv) ?? d.model, apiKey,
    warning: [warning, missing].filter(Boolean).join(" ") || undefined,
  };
}

export function createProvider(env: Env = process.env): { provider: LlmProvider; warning?: string } {
  const { warning, provider: name, baseUrl, model, apiKey } = agentEndpoint(env);
  if (name === "anthropic") {
    const effort = EFFORTS.find((e) => e === env.ANTHROPIC_EFFORT?.trim());
    const fallbacks = env.ANTHROPIC_FALLBACKS?.trim().toLowerCase() !== "off";
    return { provider: new AnthropicProvider({ apiKey, model, baseURL: baseUrl, effort, fallbacks }), warning };
  }
  return { provider: new OpenAIProvider({ apiKey, model, baseURL: baseUrl }), warning };
}
