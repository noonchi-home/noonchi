// 추론 모드(INFERENCE_MODE=mock|live)는 미리 정한 VLM 주소·모델 이름만 고른다. 코드 경로는 두 모드가 같다.
// VLM_BASE_URL·VLM_MODEL·VLM_API_KEY·VLM_EXTRA_BODY·PAM_URL을 따로 주면 그 값을 쓴다(시험의 가짜 서버도 이 자리에 붙는다).
// PAM LLM 주소는 PAM 서비스(services/pam/noonchi_pam/settings.py)가 같은 INFERENCE_MODE로 고른다.
export type InferenceMode = "mock" | "live";
export interface ModelEndpoint { baseUrl: string; model: string; apiKey: string; extraBody: Record<string, unknown> }
export interface Endpoints { mode: InferenceMode; vlm: ModelEndpoint; pamUrl: string }
type Env = Record<string, string | undefined>;

// live 모델 이름 vlm은 compose vllm-vlm의 --served-model-name이다(Hugging Face 모델은 compose VLM_LIVE_MODEL).
export const VLM_PRESETS: Record<InferenceMode, { baseUrl: string; model: string; keyEnv: string; extraBody: Record<string, unknown> }> = {
  mock: { baseUrl: "https://api.openai.com/v1", model: "gpt-5.4-mini", keyEnv: "OPENAI_API_KEY", extraBody: { reasoning_effort: "none" } },
  live: { baseUrl: "http://vllm-vlm:8000/v1", model: "vlm", keyEnv: "VLLM_API_KEY", extraBody: {} },
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
  return {
    mode: raw,
    vlm: {
      baseUrl: (v("VLM_BASE_URL") ?? p.baseUrl).replace(/\/+$/, ""), model: v("VLM_MODEL") ?? p.model,
      apiKey: v("VLM_API_KEY") ?? v(p.keyEnv) ?? "", extraBody: extra ? extraBodyOf(extra) : { ...p.extraBody },
    },
    pamUrl: (v("PAM_URL") ?? DEFAULT_PAM_URL).replace(/\/+$/, ""),
  };
}
