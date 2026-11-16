// 외부 연락 통로(전화 에이전트): 사용자가 승인한 연락 하나를 CALL_SERVICE_URL에 JSON 하나로 POST한다(요청 모양 docs/reference.md 「외부 연락」).
// 주소가 없으면 통로를 만들지 않는다(callServiceFrom이 null): 에이전트는 승인돼도 부르지 않고 「연결 없음」으로 남긴다. http(s) 주소가 아니면 시작하지 않는다.
// 2xx면 보냄, 2xx가 아닌 답과 보내기 전에 닿지 못한 것(연결 거부·주소 못 찾음·TLS 실패)은 실패다.
// 보낸 뒤 답이 없거나(제한 시간 10초) 연결이 끊기면 접수했는지 모르므로 확인 불가(unknown)다: 에이전트가 다시 승인된 같은 요청을 같은 id로 보낸다.
// 연결 단계 EFAULT만 다시 보낸다(fetchRetry). 같은 요청을 스스로 다시 보내지 않는다.
import type { ServiceCall, ServiceContact, ServiceKind } from "../contract/service.js";
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
  to: ServiceContact;
  home: CallServiceHome | null;
  device: { id: string; label: string; kind: string } | null;
  problem: string | null;
  error_code: string | null;
  person: string | null;
  /** 사용자가 승인한 때(ISO). */
  approved_at: string;
}

/** 보낸 결과. unknown: 보낸 뒤 답이 없거나 끊겨 접수했는지 모른다. */
export type CallServiceSent = { ok: true; status: number } | { ok: false; status?: number; error: string; unknown?: true };

/** 요청이 나가기 전에 멈춘 연결 오류(접수되지 않은 것이 확실하다). 그 밖의 오류·제한 시간은 확인 불가다. */
const NOT_SENT = /^(ECONNREFUSED|ENOTFOUND|EAI_AGAIN|EHOSTUNREACH|ENETUNREACH|EADDRNOTAVAIL|UND_ERR_CONNECT_TIMEOUT|CERT_|ERR_TLS_|DEPTH_ZERO_SELF_SIGNED_CERT|SELF_SIGNED_CERT_IN_CHAIN|UNABLE_TO_)/;

function notSent(e: unknown): boolean {
  type Cause = { code?: unknown; syscall?: unknown; errors?: Cause[] };
  const c = (e as { cause?: Cause })?.cause;
  // 주소가 여럿이면(localhost) 연결 시도마다 오류가 묶여 온다(AggregateError): 모두 나가기 전 오류일 때만
  const causes = c?.errors?.length ? c.errors : c ? [c] : [];
  return causes.length > 0 && causes.every((x) => {
    const code = typeof x?.code === "string" ? x.code : "";
    return NOT_SENT.test(code) || (code === "EFAULT" && x.syscall === "connect");
  });
}

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
      if (notSent(e)) return { ok: false, error: `전화 서비스에 닿지 못함: ${(e as Error).message}` };
      return { ok: false, unknown: true, error: `전화 서비스 답 없음: ${(e as Error).message}` };
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
