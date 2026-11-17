// /api/health의 준비 상태: 추론 모드, VLM·PAM LLM 주소 응답(GET {base}/models, 30초 캐시),
// 에이전트 키와 주소 응답(openai GET {base}/models, anthropic GET {base}/v1/models, 30초 캐시), 기록 DB.
import type { AgentEndpoint } from "../agent/index.js";
import type { ReadyView } from "../contract/events.js";
import type { Endpoints } from "../infer/endpoints.js";
import { ReachCache, reachable } from "../infer/reach.js";
import type { HistoryDb } from "../brain/index.js";

/** 에이전트 주소가 답하는지(모델은 부르지 않는다). */
function agentProbe(a: AgentEndpoint, fetchImpl?: typeof fetch): () => Promise<boolean> {
  if (a.provider === "anthropic") {
    const headers: Record<string, string> = { "anthropic-version": "2023-06-01", ...(a.apiKey ? { "x-api-key": a.apiKey } : {}) };
    return () => reachable(`${a.baseUrl}/v1/models`, { headers, fetchImpl });
  }
  return () => reachable(`${a.baseUrl}/models`, { headers: a.apiKey ? { authorization: `Bearer ${a.apiKey}` } : {}, fetchImpl });
}

export function makeReady(o: { endpoints: Endpoints; agent: AgentEndpoint; db: HistoryDb; cache?: ReachCache; fetchImpl?: typeof fetch }): () => Promise<ReadyView> {
  const cache = o.cache ?? new ReachCache();
  const { vlm, pam, mode } = o.endpoints;
  const { agent } = o;
  const bearer = (key: string): Record<string, string> => (key ? { authorization: `Bearer ${key}` } : {});
  return async () => {
    const [vlmOk, pamOk, agentOk] = await Promise.all([
      cache.check(`vlm:${vlm.baseUrl}`, () => reachable(`${vlm.baseUrl}/models`, { headers: bearer(vlm.apiKey), fetchImpl: o.fetchImpl })),
      // 막힌 주소(OpenRouter)는 부르지 않고 준비 안 됨이다
      pam.blocked ? Promise.resolve(false) : cache.check(`pam:${pam.baseUrl}`, () => reachable(`${pam.baseUrl}/models`, { headers: bearer(pam.apiKey), fetchImpl: o.fetchImpl })),
      cache.check(`agent:${agent.provider}:${agent.baseUrl}`, agentProbe(agent, o.fetchImpl)),
    ]);
    const db = o.db.ok();
    const agentKey = agent.apiKey !== "";
    return {
      ok: vlmOk && pamOk && agentKey && agentOk && db, inference_mode: mode,
      vlm: { base_url: vlm.baseUrl, model: vlm.model, key: vlm.apiKey !== "", reachable: vlmOk },
      pam: { base_url: pam.baseUrl, model: pam.model, key: pam.apiKey !== "", reachable: pamOk, ...(pam.blocked ? { reason: pam.blocked } : {}) },
      agent: { provider: agent.provider, base_url: agent.baseUrl, model: agent.model, key: agentKey, reachable: agentOk }, db,
    };
  };
}
