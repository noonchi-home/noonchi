import type { Body, BusNode } from "../bus/index.js";

type Progress = Body<"/phone/progress">;
type Result = Body<"/act/progress_result">;

export const PROGRESS_MS = 2500;

/** 호출 전에 기다릴 자리를 만들고, 집이 닫히거나 기한이 지나면 지난 답으로 끝낸다. */
export class ProgressReplies {
  private readonly waiting = new Map<string, (r: Result) => void>();
  private closed = false;

  wait(req: string): Promise<Result> {
    if (this.closed) return Promise.resolve({ req, status: "stale" });
    return new Promise((resolve) => {
      const timer = setTimeout(() => this.receive({ req, status: "stale" }), PROGRESS_MS);
      this.waiting.set(req, (result) => { clearTimeout(timer); resolve(result); });
    });
  }

  receive(result: Result): void {
    const done = this.waiting.get(result.req);
    this.waiting.delete(result.req);
    done?.(result);
  }

  close(): void {
    this.closed = true;
    for (const req of this.waiting.keys()) this.receive({ req, status: "stale" });
  }
}

/** 답 방송이 실패해 다시 배달되어도 단추·말을 실행 추적에 두 번 넣지 않는다. 기한이 지난 답은 실행하지 않는다. */
export function progressRoutes(node: BusNode, handle: (progress: Progress) => Result, now: () => number): void {
  const replies = new Map<string, { expires: number; result: Result }>();
  node.on("/phone/progress", async (p) => {
    const t = now();
    for (const [key, entry] of replies) if (entry.expires <= t) replies.delete(key);
    let result = replies.get(p.req)?.result;
    if (!result) {
      result = t >= p.expires_ms ? { req: p.req, status: "stale" } : handle(p);
      if (t < p.expires_ms) replies.set(p.req, { expires: p.expires_ms, result });
    }
    await node.publish("/act/progress_result", result);
  });
}
