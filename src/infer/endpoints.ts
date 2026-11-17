// 추론 모드(INFERENCE_MODE=mock|live)는 미리 정한 VLM 주소·모델 이름만 고른다. 코드 경로는 두 모드가 같다.
// VLM_BASE_URL·VLM_MODEL·VLM_API_KEY·VLM_EXTRA_BODY·PAM_URL을 따로 주면 그 값을 쓴다(시험의 가짜 서버도 이 자리에 붙는다).
// VLM_CLOSER_MODEL은 가까이 보기 VLM 모델 이름만 바꾼다(같은 주소·키·요청 칸, 비우면 VLM 모델과 같음).
// THOUGHT_MODEL은 생각 말풍선 두 줄(src/brain/thought.ts)을 쓰는 작은 모델 이름만 바꾼다(같은 주소·키·요청 칸, 비우면 모드의 thoughtModel).
// PAM LLM 주소·모델·키·제공자 칸도 여기서 고른다(PAM_LLM_PROVIDER·PAM_LLM_BASE_URL·PAM_LLM_MODEL·PAM_LLM_API_KEY). 전송 값은 src/brain/pam/settings.ts.
export type InferenceMode = "mock" | "live";
export interface ModelEndpoint { baseUrl: string; model: string; apiKey: string; extraBody: Record<string, unknown> }
/** VLM 주소. closerModel은 가까이 보기 VLM 모델 이름, thoughtModel은 생각 말풍선 두 줄 모델 이름이고 주소·키·요청 칸은 같다. */
export interface VlmEndpoint extends ModelEndpoint { closerModel: string; thoughtModel: string }
export interface Endpoints { mode: InferenceMode; vlm: VlmEndpoint; pam: PamEndpoint; pamUrl: string }
type Env = Record<string, string | undefined>;

// live 모델 이름 vlm은 compose vllm-vlm의 --served-model-name이다(Hugging Face 모델은 compose VLM_LIVE_MODEL). 생각 말풍선 모델도 live는 같은 vLLM이다.
export const VLM_PRESETS: Record<InferenceMode, { baseUrl: string; model: string; thoughtModel: string; keyEnv: string; extraBody: Record<string, unknown> }> = {
  mock: { baseUrl: "https://api.openai.com/v1", model: "gpt-5.4-mini", thoughtModel: "gpt-5.4-nano", keyEnv: "OPENAI_API_KEY", extraBody: { reasoning_effort: "none" } },
  live: { baseUrl: "http://vllm-vlm:8000/v1", model: "vlm", thoughtModel: "vlm", keyEnv: "VLLM_API_KEY", extraBody: {} },
};

/** PAM LLM 생각 켜기·끄기 칸 모양: OpenRouter reasoning.enabled, vLLM chat_template_kwargs.enable_thinking, OpenAI reasoning_effort. */
export type PamThinking = "openrouter" | "chat_template" | "openai";
export interface PamEndpoint extends ModelEndpoint { thinking: PamThinking }
interface PamPreset { baseUrl: string; model: string; keyEnv: string; thinking: PamThinking; extraBody: Record<string, unknown> }

// mock 값은 src/brain/pam/config/openrouter.json과 같다(tests/pam-llm.test.ts). live 모델 이름 pam은 compose vllm-pam의 --served-model-name이다.
export const PAM_PRESETS: Record<InferenceMode, PamPreset> = {
  mock: { baseUrl: "https://openrouter.ai/api/v1", model: "qwen/qwen3.5-27b", keyEnv: "OPENROUTER_API_KEY", thinking: "openrouter",
    extraBody: { provider: { order: ["alibaba"], allow_fallbacks: false, require_parameters: true }, plugins: [{ id: "context-compression", enabled: false }] } },
  live: { baseUrl: "http://vllm-pam:8000/v1", model: "pam", keyEnv: "VLLM_API_KEY", thinking: "chat_template", extraBody: {} },
};
/** mock에서 OpenRouter 대신 쓰는 PAM LLM 공급자(PAM_LLM_PROVIDER). VLM과 같은 OpenAI 모델·키다. */
export const PAM_PROVIDERS: Record<string, PamPreset> = {
  openai: { baseUrl: "https://api.openai.com/v1", model: "gpt-5.4-mini", keyEnv: "OPENAI_API_KEY", thinking: "openai", extraBody: {} },
};

/** PAM 서비스 기본 주소(이 PC). compose 안에서는 PAM_URL=http://pam:8300. */
export const DEFAULT_PAM_URL = "http://127.0.0.1:8300";

/** VLM 한 장 분석 제한 시간(VLM_TIMEOUT_MS, 기본 20000). 동시 요청 풀과 OpenAI 호환 호출이 같은 값을 쓴다. */
export function vlmTimeoutMs(env: Env): number {
  const v = Number(env.VLM_TIMEOUT_MS);
  return env.VLM_TIMEOUT_MS?.trim() && Number.isFinite(v) && v >= 1000 ? Math.floor(v) : 20_000;
}

function extraBodyOf(raw: string): Record<string, unknown> {
  let v: unknown;
  try {
    v = JSON.parse(raw);
  } catch {
    throw new Error(`VLM_EXTRA_BODY=${raw}: JSON 객체여야 합니다`);
  }
  if (!v || typeof v !== "object" || Array.isArray(v)) throw new Error(`VLM_EXTRA_BODY=${raw}: JSON 객체여야 합니다`);
  return v as Record<string, unknown>;
}

export function loadEndpoints(env: Env): Endpoints {
  const raw = env.INFERENCE_MODE?.trim() || "mock";
  if (raw !== "mock" && raw !== "live") throw new Error(`INFERENCE_MODE=${raw}: mock 또는 live여야 합니다`);
  const p = VLM_PRESETS[raw];
  const v = (k: string) => env[k]?.trim() || undefined;
  const extra = v("VLM_EXTRA_BODY");
  const model = v("VLM_MODEL") ?? p.model;
  const provider = v("PAM_LLM_PROVIDER");
  if (provider && (raw !== "mock" || !Object.hasOwn(PAM_PROVIDERS, provider))) {
    throw new Error(`PAM_LLM_PROVIDER=${provider}: mock에서 ${Object.keys(PAM_PROVIDERS).join(", ")}만 됩니다`);
  }
  const pp = provider ? PAM_PROVIDERS[provider]! : PAM_PRESETS[raw];
  return {
    mode: raw,
    vlm: {
      baseUrl: (v("VLM_BASE_URL") ?? p.baseUrl).replace(/\/+$/, ""), model,
      apiKey: v("VLM_API_KEY") ?? v(p.keyEnv) ?? "", extraBody: extra ? extraBodyOf(extra) : { ...p.extraBody },
      closerModel: v("VLM_CLOSER_MODEL") ?? model,
      thoughtModel: v("THOUGHT_MODEL") ?? p.thoughtModel,
    },
    pam: {
      baseUrl: (v("PAM_LLM_BASE_URL") ?? pp.baseUrl).replace(/\/+$/, ""), model: v("PAM_LLM_MODEL") ?? pp.model,
      apiKey: v("PAM_LLM_API_KEY") ?? v(pp.keyEnv) ?? "", thinking: pp.thinking, extraBody: structuredClone(pp.extraBody),
    },
    pamUrl: (v("PAM_URL") ?? DEFAULT_PAM_URL).replace(/\/+$/, ""),
  };
}
