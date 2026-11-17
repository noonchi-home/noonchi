// 추론 모드(INFERENCE_MODE=openai|vllm)는 미리 정한 VLM·PAM LLM 주소·모델 이름·키 자리·제공자 칸만 고른다. 코드 경로는 두 모드가 같다.
// openai: 개발(OpenAI API, OPENAI_API_KEY). vllm: AWS 같은 서버 vLLM(VLLM_API_KEY). 시험은 주소를 가짜 서버로 준다.
// VLM_BASE_URL·VLM_MODEL·VLM_API_KEY·VLM_EXTRA_BODY·PAM_LLM_BASE_URL·PAM_LLM_MODEL·PAM_LLM_API_KEY를 따로 주면 그 값을 쓴다(시험의 가짜 서버도 이 자리에 붙는다).
// VLM_CLOSER_MODEL은 가까이 보기 VLM 모델 이름만 바꾼다(같은 주소·키·요청 칸, 비우면 VLM 모델과 같음).
// PAM LLM 전송 값(max_tokens·시간 제한·문맥 길이)은 src/brain/pam/settings.ts.
export const INFERENCE_MODES = ["openai", "vllm"] as const;
export type InferenceMode = (typeof INFERENCE_MODES)[number];
export interface ModelEndpoint { baseUrl: string; model: string; apiKey: string; extraBody: Record<string, unknown> }
/** VLM 주소. closerModel은 가까이 보기 VLM 모델 이름이고 주소·키·요청 칸은 같다. */
export interface VlmEndpoint extends ModelEndpoint { closerModel: string }
export interface Endpoints { mode: InferenceMode; vlm: VlmEndpoint; pam: PamEndpoint }
type Env = Record<string, string | undefined>;

// vllm 모델 이름 vlm은 compose vllm-vlm의 --served-model-name이다(Hugging Face 모델은 compose VLM_LIVE_MODEL).
export const VLM_PRESETS: Record<InferenceMode, { baseUrl: string; model: string; keyEnv: string; extraBody: Record<string, unknown> }> = {
  openai: { baseUrl: "https://api.openai.com/v1", model: "gpt-5.4-mini", keyEnv: "OPENAI_API_KEY", extraBody: { reasoning_effort: "none" } },
  vllm: { baseUrl: "http://vllm-vlm:8000/v1", model: "vlm", keyEnv: "VLLM_API_KEY", extraBody: {} },
};

/** PAM LLM 생각 켜기·끄기 칸 모양: OpenAI reasoning_effort, vLLM chat_template_kwargs.enable_thinking. */
export type PamThinking = "openai" | "chat_template";
export interface PamEndpoint extends ModelEndpoint { thinking: PamThinking }

// vllm 모델 이름 pam은 compose vllm-pam의 --served-model-name이다. openai는 VLM과 같은 OpenAI 모델·키다.
export const PAM_PRESETS: Record<InferenceMode, { baseUrl: string; model: string; keyEnv: string; thinking: PamThinking; extraBody: Record<string, unknown> }> = {
  openai: { baseUrl: "https://api.openai.com/v1", model: "gpt-5.4-mini", keyEnv: "OPENAI_API_KEY", thinking: "openai", extraBody: {} },
  vllm: { baseUrl: "http://vllm-pam:8000/v1", model: "pam", keyEnv: "VLLM_API_KEY", thinking: "chat_template", extraBody: {} },
};

/** 예전 이름(2026-11-17 전): mock → openai, live → vllm. 예전 이름이면 시작을 막고 새 이름을 알린다. */
const OLD_MODES: Record<string, InferenceMode> = { mock: "openai", live: "vllm" };

function modeOf(env: Env): InferenceMode {
  const raw = env.INFERENCE_MODE?.trim() || "openai";
  if ((INFERENCE_MODES as readonly string[]).includes(raw)) return raw as InferenceMode;
  const now = Object.hasOwn(OLD_MODES, raw) ? `(예전 이름 ${raw} → ${OLD_MODES[raw]})` : "";
  throw new Error(`INFERENCE_MODE=${raw}: openai 또는 vllm이어야 합니다${now}`);
}

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
  const mode = modeOf(env);
  const v = (k: string) => env[k]?.trim() || undefined;
  const p = VLM_PRESETS[mode];
  const pp = PAM_PRESETS[mode];
  const extra = v("VLM_EXTRA_BODY");
  const model = v("VLM_MODEL") ?? p.model;
  return {
    mode,
    vlm: {
      baseUrl: (v("VLM_BASE_URL") ?? p.baseUrl).replace(/\/+$/, ""), model,
      apiKey: v("VLM_API_KEY") ?? v(p.keyEnv) ?? "", extraBody: extra ? extraBodyOf(extra) : { ...p.extraBody },
      closerModel: v("VLM_CLOSER_MODEL") ?? model,
    },
    pam: {
      baseUrl: (v("PAM_LLM_BASE_URL") ?? pp.baseUrl).replace(/\/+$/, ""), model: v("PAM_LLM_MODEL") ?? pp.model,
      apiKey: v("PAM_LLM_API_KEY") ?? v(pp.keyEnv) ?? "", thinking: pp.thinking, extraBody: structuredClone(pp.extraBody),
    },
  };
}
