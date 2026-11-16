// 주소가 답하는지 본다(2xx). 결과는 ttlMs 동안 둔다. 모델을 부르지 않는다: VLM은 GET {base}/models, PAM은 GET {url}/health.
// 연결 단계의 EFAULT(이 PC Windows의 일시 오류)는 fetchRetry가 다시 보낸다.
import { fetchRetry } from "../shared/net.js";

export async function reachable(url: string, opts: { headers?: Record<string, string>; timeoutMs?: number; fetchImpl?: typeof fetch } = {}): Promise<boolean> {
  try {
    const r = await fetchRetry(url, { headers: opts.headers, signal: AbortSignal.timeout(opts.timeoutMs ?? 2000) }, { fetchImpl: opts.fetchImpl });
    await r.body?.cancel();
    return r.ok;
  } catch {
    return false;
  }
}

export class ReachCache {
  private readonly seen = new Map<string, { at: number; value: Promise<boolean> }>();
  constructor(private readonly ttlMs = 30_000, private readonly now: () => number = () => Date.now()) {}
  check(key: string, probe: () => Promise<boolean>): Promise<boolean> {
    const hit = this.seen.get(key);
    if (hit && this.now() - hit.at < this.ttlMs) return hit.value;
    const value = probe();
    this.seen.set(key, { at: this.now(), value });
    return value;
  }
}
