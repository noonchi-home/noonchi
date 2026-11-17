// PAM LLM 전송 값: 모드가 고른 주소·모델·키·제공자 칸(src/infer/endpoints.ts) + max_tokens·시간 제한(config/transport.json, 모든 갈래가 같음) + 문맥 길이.
// PAM_LLM_TIMEOUT_S(기본 120초)는 LLM 한 번 전체 제한이다. PAM_MAX_MODEL_LEN(기본 32768)은 compose vllm-pam의 --max-model-len과 같은 값이고 반성 출력보다 커야 한다.
import { join } from "node:path";
import { loadEndpoints, type PamEndpoint } from "../../infer/endpoints.js";
import { PAM_DIR, readStrictJson } from "./paper.js";

type Env = Record<string, string | undefined>;
export interface PamSettings extends PamEndpoint { timeoutMs: number; maxTokens: { predictor: number; reflector: number }; maxModelLen: number }

const TRANSPORT = readStrictJson(join(PAM_DIR, "config", "transport.json")) as { timeout_seconds: number; max_tokens: { predictor: number; reflector: number } };

/** PAM_MAX_MODEL_LEN 기본값(문맥 길이). */
const DEFAULT_MAX_MODEL_LEN = 32768;

export function pamSettings(env: Env): PamSettings {
  const pam = loadEndpoints(env).pam;
  const get = (k: string) => env[k]?.trim() || undefined;
  const rawLen = get("PAM_MAX_MODEL_LEN") ?? String(DEFAULT_MAX_MODEL_LEN);
  const lenFix = `. 지우면 기본값 ${DEFAULT_MAX_MODEL_LEN}을 써요`;
  if (!/^[+-]?\d+$/.test(rawLen)) throw new Error(`PAM_MAX_MODEL_LEN=${rawLen}: 정수여야 합니다${lenFix}`);
  const maxModelLen = Number(rawLen);
  const maxTokens = { ...TRANSPORT.max_tokens };
  if (maxModelLen <= Math.max(maxTokens.predictor, maxTokens.reflector)) throw new Error(`PAM_MAX_MODEL_LEN=${maxModelLen}: 반성 출력 ${maxTokens.reflector}보다 커야 합니다${lenFix}`);
  const rawTimeout = get("PAM_LLM_TIMEOUT_S");
  const timeoutS = rawTimeout === undefined ? TRANSPORT.timeout_seconds : Number(rawTimeout);
  if (!(timeoutS > 0)) throw new Error(`PAM_LLM_TIMEOUT_S=${rawTimeout}: 0보다 큰 초여야 합니다. 지우면 기본값 ${TRANSPORT.timeout_seconds}초를 써요`);
  return { ...pam, timeoutMs: timeoutS * 1000, maxTokens, maxModelLen };
}
