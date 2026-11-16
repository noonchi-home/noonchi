// 외부 연락 통로(전화 에이전트): 사용자가 승인한 연락 하나를 CALL_SERVICE_URL에 JSON 하나로 POST한다(요청 모양 docs/reference.md 「외부 연락」).
// 주소가 없으면 통로를 만들지 않는다(callServiceFrom이 null): 에이전트는 승인돼도 부르지 않고 「연결 없음」으로 남긴다. http(s) 주소가 아니면 시작하지 않는다.
// 2xx면 보냄, 그 밖의 HTTP 상태·연결 오류·제한 시간(10초)은 실패다. 연결 단계 EFAULT만 다시 보낸다(fetchRetry). 같은 요청을 스스로 다시 보내지 않는다.
import type { ServiceCall, ServiceKind } from "../contract/service.js";
import { fetchRetry } from "../shared/net.js";

/** 요청 하나 제한 시간. */
export const CALL_SERVICE_TIMEOUT_MS = 10_000;

/** 집(요청의 home): 이 서버가 띄운 집 id와 이름. */
export interface CallServiceHome { id: string; name: string }

/** 전화 서비스가 받는 본문(판본 1). 없는 값은 null이다. */
export interface CallServiceBody {
  version: 1;
  /** 연락 id(연락마다 새 값). */
  id: string;
  kind: ServiceKind;
  to: string;
  home: CallServiceHome | null;
  device: { id: string; label: string; kind: string } | null;
  problem: string | null;
  error_code: string | null;
  person: string | null;
  /** 사용자가 승인한 때(ISO). */
  approved_at: string;
}

export type CallServiceSent = { ok: true; status: number } | { ok: false; status?: number; error: string };

export function callServiceBody(call: ServiceCall, meta: { id: string; approvedAt: string }, home: CallServiceHome | null): CallServiceBody {
  return {
    version: 1, id: meta.id, kind: call.kind, to: call.to, home, device: call.device, problem: call.problem, error_code: call.errorCode, person: call.person,
    approved_at: meta.approvedAt,
  };
}

export class CallServiceClient {
  constructor(readonly url: string, private readonly opts: { home?: CallServiceHome | null; fetchImpl?: typeof fetch; timeoutMs?: number } = {}) {}

  async send(call: ServiceCall, meta: { id: string; approvedAt: string }): Promise<CallServiceSent> {
    try {
      const res = await fetchRetry(this.url, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify(callServiceBody(call, meta, this.opts.home ?? null)),
        signal: AbortSignal.timeout(this.opts.timeoutMs ?? CALL_SERVICE_TIMEOUT_MS),
      }, { fetchImpl: this.opts.fetchImpl });
      await res.body?.cancel();
      return res.ok ? { ok: true, status: res.status } : { ok: false, status: res.status, error: `전화 서비스 HTTP ${res.status}` };
    } catch (e) {
      return { ok: false, error: `전화 서비스에 닿지 못함: ${(e as Error).message}` };
    }
  }
}

/** CALL_SERVICE_URL로 통로를 만든다. 비었으면 null, http(s) 주소가 아니면 던진다(시작하지 않는다). */
export function callServiceFrom(env: Record<string, string | undefined>, home: CallServiceHome | null = null): CallServiceClient | null {
  const raw = env.CALL_SERVICE_URL?.trim();
  if (!raw) return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`CALL_SERVICE_URL=${raw}: http(s) 주소여야 합니다`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error(`CALL_SERVICE_URL=${raw}: http(s) 주소여야 합니다`);
  return new CallServiceClient(raw, { home });
}
