// 두 모드가 함께 쓰는 추론 묶음. 모드는 주소만 고른다. VLM 호출 제한 시간은 동시 요청 풀과 같은 VLM_TIMEOUT_MS다.
// 가까이 보기 VLM(closerVlm)은 같은 주소에 모델 이름만 closerModel(VLM_CLOSER_MODEL)로 바꿔 보낸다. 같은 이름이면 vlm 그대로다.
import { loadEndpoints, vlmTimeoutMs, type Endpoints } from "./endpoints.js";
import { VlmClient } from "./vlm.js";

export function createInference(env: Record<string, string | undefined>): { endpoints: Endpoints; vlm: VlmClient; closerVlm: VlmClient } {
  const endpoints = loadEndpoints(env);
  const { closerModel, ...ep } = endpoints.vlm;
  const opts = { timeoutMs: vlmTimeoutMs(env) };
  const vlm = new VlmClient(ep, opts);
  return {
    endpoints, vlm, closerVlm: closerModel === ep.model ? vlm : new VlmClient({ ...ep, model: closerModel }, opts),
  };
}
