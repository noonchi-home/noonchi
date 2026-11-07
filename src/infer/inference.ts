// 두 모드가 함께 쓰는 추론 묶음. 모드는 주소만 고른다. VLM 호출 제한 시간은 동시 요청 풀과 같은 VLM_TIMEOUT_MS다.
import { loadEndpoints, vlmTimeoutMs, type Endpoints } from "./endpoints.js";
import { VlmClient } from "./vlm.js";

export function createInference(env: Record<string, string | undefined>): { endpoints: Endpoints; vlm: VlmClient } {
  const endpoints = loadEndpoints(env);
  return { endpoints, vlm: new VlmClient(endpoints.vlm, { timeoutMs: vlmTimeoutMs(env) }) };
}
