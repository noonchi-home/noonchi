// /api/health의 준비 상태: 추론 모드, VLM 주소 응답(GET {base}/models, 30초 캐시), PAM 서비스(GET {url}/health, 매번)와 그 LLM 응답, 기록 DB.
import type { ReadyView } from "../contract/events.js";
import type { Endpoints } from "../infer/endpoints.js";
import { ReachCache, reachable } from "../infer/reach.js";
import type { HistoryDb } from "../history/db.js";
import { fetchRetry } from "./net.js";

export function makeReady(o: { endpoints: Endpoints; db: HistoryDb; cache?: ReachCache; fetchImpl?: typeof fetch }): () => Promise<ReadyView> {
  const cache = o.cache ?? new ReachCache();
  const { vlm, pamUrl, mode } = o.endpoints;
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
    const [vlmOk, pam] = await Promise.all([
      cache.check(`vlm:${vlm.baseUrl}`, () => reachable(`${vlm.baseUrl}/models`, { headers: auth, fetchImpl: o.fetchImpl })),
      pamHealth(),
    ]);
    const db = o.db.ok();
    return {
      ok: vlmOk && pam.reachable && (pam.llm?.reachable ?? false) && db, inference_mode: mode,
      vlm: { base_url: vlm.baseUrl, model: vlm.model, key: vlm.apiKey !== "", reachable: vlmOk },
      pam: { url: pamUrl, reachable: pam.reachable, llm: pam.llm }, db,
    };
  };
}
