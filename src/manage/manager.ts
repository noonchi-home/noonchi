import type { DecisionRecord } from "../contract/events.js";
import type { GoalIntent, HouseholdOffer, ManagerDirective, ManagerState } from "../contract/machines.js";
import { MachineLane, managerState } from "../machines/index.js";

export interface WorkContext {
  emergency: boolean;
  activeAction: string | null;
  /** 손에 든 일을 이어 가는 지금 계획·단계. 단계 경계를 넘으면 다른 값이다. */
  handling: string | null;
  docking: boolean;
  requested?: boolean;
  phoneBusy?: boolean;
}

type Order = Pick<DecisionRecord, "action" | "source">;

/** 한 집의 새 일과 현재 일 사이에서 순서를 정한다. 실제 명령과 승인은 로봇이 맡는다. */
export class TaskManager<T extends Order> {
  private waiting: { order: T; step: string | null } | null = null;
  private readonly lane = new MachineLane<ManagerState>();
  private readonly jobs = new Map<string,{offer:HouseholdOffer; granted:boolean}>();
  private readonly finished = new Map<string,number>();

  intent(input:GoalIntent): ManagerDirective[] {
    if (input.op === "withdraw") return this.removeDirective(input.id);
    if (!this.finished.has(input.id) && !this.jobs.has(input.id)) this.jobs.set(input.id,{offer:input,granted:false});
    return [];
  }

  private removeDirective(id:string): ManagerDirective[] {
    const job = this.jobs.get(id);
    if (!job) return [];
    this.finishDirective(id);
    return [{op:"revoke",id,rev:job.offer.rev}];
  }

  finishDirective(id:string) {
    const job=this.jobs.get(id);
    if (job) this.finished.set(id,job.offer.until_ms);
    this.jobs.delete(id);
  }

  interruptDirectives() { return [...this.jobs.keys()].flatMap(id=>this.removeDirective(id)); }

  directives(ctx:WorkContext, now:number): ManagerDirective[] {
    const directives:ManagerDirective[]=[];
    const occupied=new Set<string>();
    for (const [id,expiry] of this.finished) if (expiry<=now) this.finished.delete(id);
    for (const [id,job] of this.jobs) {
      const o=job.offer;
      const device=o.kind==="tv_on" || o.kind==="tv_off";
      const slot=device ? "device:"+o.target_id : o.kind;
      const blocked=ctx.emergency || ctx.requested || this.hasPending() ||
        (!device && (!!ctx.activeAction || ctx.docking || (slot==="visit" && ctx.phoneBusy)));
      if (now>=o.until_ms || (blocked && job.granted)) directives.push(...this.removeDirective(id));
      else if (!blocked && !occupied.has(slot)) {
        occupied.add(slot);
        if (!job.granted) { job.granted=true; directives.push({...o,op:"grant"}); }
      }
    }
    return directives;
  }

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
