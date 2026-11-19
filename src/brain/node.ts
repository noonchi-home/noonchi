import { Outbox, realClock, type Body, type BusNode, type Clock } from "../bus/index.js";
import type { DecisionRecord } from "../contract/events.js";
import type { PlanAhead, PlanResult } from "../contract/plan-work.js";

const PLAN_TIMEOUT_MS = 46_000;
type Request = Body<"/brain/plan_request">;
export type MakePlan = (r: Request, signal: AbortSignal) => Promise<PlanResult>;
const failure = (error: string): PlanResult => ({ ok: false, error });

export function dailyMemory<T>(read: (day: string) => T) {
  let cached: { day: string; value: T } | null = null;
  return {
    get(day: string) {
      if (cached?.day !== day) cached = { day, value: read(day) };
      return cached.value;
    },
    invalidate() { cached = null; },
  };
}

/** 실행이 기다리는 계획 하나마다 취소와 답을 같은 요청 번호로 맞춘다. */
export class BrainPlans {
  private readonly pending = new Map<string, { decision: string; finish: (r: PlanResult) => void; abort: () => void }>();
  private sequence = 0;
  private closed = false;
  constructor(private readonly out: Outbox, private readonly clock: Clock = realClock) {}

  routes(node: BusNode): void {
    node.on("/brain/plan", (b) => {
      const job = this.pending.get(b.req);
      if (job?.decision === b.decision_id) job.finish(b.result);
    });
  }

  plan(d: DecisionRecord, signal: AbortSignal, ahead?: PlanAhead): Promise<PlanResult> {
    if (this.closed || signal.aborted) return Promise.resolve(failure("계획을 취소했어요."));
    const req = d.id + ":" + ++this.sequence;
    const until = this.clock.now() + PLAN_TIMEOUT_MS;
    return new Promise((resolve) => {
      const finish = (result: PlanResult) => {
        cancelTimer();
        signal.removeEventListener("abort", abort);
        this.pending.delete(req);
        resolve(result);
      };
      const abort = () => {
        this.out.push("/brain/cancel", { req, decision_id: d.id });
        finish(failure("계획을 취소했어요."));
      };
      const cancelTimer = this.clock.after(PLAN_TIMEOUT_MS, abort);
      this.pending.set(req, { decision: d.id, finish, abort });
      signal.addEventListener("abort", abort, { once: true });
      if (!this.out.push("/brain/plan_request", { req, decision: d, ahead, until })) finish(failure("계획 요청을 보낼 수 없어요."));
    });
  }

  close(): void {
    this.closed = true;
    for (const job of this.pending.values()) job.abort();
  }
}

/** 모델을 기다리는 동안에도 같은 뇌 노드가 취소와 새 관찰을 받을 수 있다. */
export function planningRoutes(node: BusNode, make: MakePlan, clock: Clock): void {
  const out = new Outbox(node, { clock, log: (s) => console.warn(s) });
  const running = new Map<string, AbortController>();
  // 취소와 요청은 다른 스트림이므로 취소가 먼저 올 수도 있다.
  const cancelled = new Map<string, number>();
  node.on("/brain/cancel", ({ req }) => {
    cancelled.set(req, clock.now() + PLAN_TIMEOUT_MS);
    running.get(req)?.abort();
  });
  node.every(PLAN_TIMEOUT_MS, () => {
    for (const [req, until] of cancelled) if (until <= clock.now()) cancelled.delete(req);
  });
  node.on("/brain/plan_request", (r) => {
    if (running.has(r.req) || cancelled.has(r.req) || r.until <= clock.now()) return;
    const local = new AbortController();
    running.set(r.req, local);
    void node.spawn(async (life) => {
      const signal = AbortSignal.any([life, local.signal]);
      const timer = clock.after(Math.max(0, r.until - clock.now()), () => local.abort());
      let result: PlanResult;
      try { result = await make(r, signal); }
      catch (e) { result = failure(e instanceof Error ? e.message : "계획을 만들지 못했어요."); }
      finally { timer(); running.delete(r.req); }
      node.post(() => {
        if (!signal.aborted && !cancelled.has(r.req) && r.until > clock.now())
          out.push("/brain/plan", { req: r.req, decision_id: r.decision.id, result });
      });
    });
  });
}
