import type { DecisionRecord } from "../contract/events.js";
import type { ManagerState } from "../contract/machines.js";
import { MachineLane, managerState } from "../machines/index.js";

export interface WorkContext {
  emergency: boolean;
  activeAction: string | null;
  /** 손에 든 일을 이어 가는 지금 계획·단계. 단계 경계를 넘으면 다른 값이다. */
  handling: string | null;
  docking: boolean;
  requested?: boolean;
}

type Order = Pick<DecisionRecord, "action" | "source">;

/** 한 집의 새 일과 현재 일 사이에서 순서를 정한다. 실제 명령과 승인은 로봇이 맡는다. */
export class TaskManager<T extends Order> {
  private waiting: { order: T; step: string | null } | null = null;
  private readonly lane = new MachineLane<ManagerState>();

  offer(order: T, spoken: boolean, ctx: WorkContext, resumed = false) {
    if (order.source === "speech" && (ctx.emergency || (!resumed && ctx.handling && ctx.activeAction !== order.action))) {
      this.waiting = { order, step: ctx.handling };
      return "defer";
    }
    if (order.source === "speech") this.cancel();
    if (!spoken && !ctx.emergency && (this.waiting || ctx.requested) && ctx.activeAction !== order.action) return "request";
    if (ctx.docking && !spoken && !ctx.emergency) return "dock";
    if (ctx.handling && !spoken && !ctx.emergency && ctx.activeAction !== order.action) return "hands";
    return "take";
  }

  take(ctx: WorkContext): T | null {
    const wait = this.waiting;
    if (!wait || ctx.emergency || (wait.step !== null && ctx.handling === wait.step)) return null;
    this.waiting = null;
    return wait.order;
  }

  hasPending(): boolean { return this.waiting !== null; }

  cancel(): boolean {
    const had = this.waiting !== null;
    this.waiting = null;
    return had;
  }

  transition(facts: Parameters<typeof managerState>[0], now: number) {
    return this.lane.change(managerState({ ...facts, requested: facts.requested || this.waiting !== null }), now);
  }
}
