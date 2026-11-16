// /api/health의 준비 상태: 추론 모드, VLM 주소 응답(GET {base}/models, 30초 캐시), PAM 서비스(GET {url}/health, 매번)와 그 LLM 응답,
// 에이전트 키와 주소 응답(openai GET {base}/models, anthropic GET {base}/v1/models, 30초 캐시), 기록 DB.
import type { AgentEndpoint } from "../agent/providers/index.js";
import type { ReadyView } from "../contract/events.js";
import type { Endpoints } from "../infer/endpoints.js";
import { ReachCache, reachable } from "../infer/reach.js";
import type { HistoryDb } from "../history/db.js";
import { fetchRetry } from "../shared/net.js";

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
  const { vlm, pamUrl, mode } = o.endpoints;
  const { agent } = o;
  return async () => {
    const auth: Record<string, string> = vlm.apiKey ? { authorization: `Bearer ${vlm.apiKey}` } : {};
    const pamHealth = async (): Promise<{ reachable: boolean; llm: ReadyView["pam"]["llm"] }> => {
      try {
        const r = await fetchRetry(`${pamUrl}/health`, { signal: AbortSignal.timeout(2000) }, { fetchImpl: o.fetchImpl });
        if (!r.ok) return { reachable: false, llm: null };
        const b = (await r.json()) as { llm?: { base_url: string; model: string; reachable: boolean } };
        return { reachable: true, llm: b.llm ?? null };
      } catch { return { reachable: false, llm: null }; }
    };
    const [vlmOk, pam, agentOk] = await Promise.all([
      cache.check(`vlm:${vlm.baseUrl}`, () => reachable(`${vlm.baseUrl}/models`, { headers: auth, fetchImpl: o.fetchImpl })),
      pamHealth(),
      cache.check(`agent:${agent.provider}:${agent.baseUrl}`, agentProbe(agent, o.fetchImpl)),
    ]);
    const db = o.db.ok();
    const agentKey = agent.apiKey !== "";
    return {
      ok: vlmOk && pam.reachable && (pam.llm?.reachable ?? false) && agentKey && agentOk && db, inference_mode: mode,
      vlm: { base_url: vlm.baseUrl, model: vlm.model, key: vlm.apiKey !== "", reachable: vlmOk },
      pam: { url: pamUrl, reachable: pam.reachable, llm: pam.llm },
      agent: { provider: agent.provider, base_url: agent.baseUrl, model: agent.model, key: agentKey, reachable: agentOk }, db,
    };
  };
}
