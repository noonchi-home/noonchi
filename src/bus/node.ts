// node.ts — 노드 실행기(ROS 2 single-threaded executor처럼). prepare()로 모든 구독을 만들고, 띄우는 곳이 모든 노드를 준비한 뒤 start()로 배달·타이머를 켠다.
// 메시지 콜백과 타이머 콜백을 한 줄에서 하나씩 처리한다(같은 노드의 콜백은 겹치지 않는다). 받은 메시지는 먼저 낡은 것을 버리고(Freshness.check),
// 콜백이 성공해야 ack·확정(commit)한다. 실패하면 "retry"로 돌려 같은 메시지를 다시 받는다. SENSOR latest는 줄에 마지막 하나만 둔다.
// 콜백이 ctx.defer()를 부르면 줄은 비우되 ack·확정은 돌려받은 settle(ok)를 부를 때까지 미룬다(상태를 기다리는 변화, withState).
// 콜백 밖에서 도는 긴 일(LLM)은 spawn()으로 띄워 노드 수명 신호를 받고, 결과는 post()로 줄에 넣는다.
// stop(): 닫힘 → 타이머 멈춤 → 줄에 남은 일 버림 → 돌던 콜백·spawn한 일에 취소 신호 → 둘 다 기다림 → 구독 끊기 → 미룬 메시지는 ack하지 않음.
// 닫힌 뒤 publish·spawn은 거절하고 post는 버린다. 줄은 늘 다음 차례에 돌기 시작한다(첫 일이 동기로 던져도 줄이 멈추지 않는다).
// 발행은 publishTimeoutMs(기본 5초) 안에 끝나야 하고, 끝내기(노드 수명 신호)가 기다리는 발행을 끊는다(통로가 끊겨 답하지 않아도 멈추지 않는다).
import { randomUUID } from "node:crypto";
import type { Bus, Outcome, Subscription } from "./bus.js";
import { realClock, type Clock } from "./clock.js";
import { Freshness } from "./fresh.js";
import type { Envelope } from "./header.js";
import { TOPICS, type Body, type NodeName, type TopicName } from "./topics.js";

type Settle = (ok: boolean) => void;

/** 발행 한 번의 시간 제한 기본값(ms). */
export const PUBLISH_TIMEOUT_MS = 5000;
/** settled가 새 일이 없는지 보는 간격(ms). 통로로 오는 중인 메시지가 닿을 시간이다. */
const SETTLE_GAP_MS = 50;

/** p를 기다리되 신호가 끊기거나 ms가 지나면 실패한다. */
function bounded<T>(p: Promise<T>, signal: AbortSignal, ms: number, what: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const done = (f: () => void) => { clearTimeout(timer); signal.removeEventListener("abort", onAbort); f(); };
    const onAbort = () => done(() => reject(signal.reason ?? new Error(`${what}을 멈췄어요`)));
    if (signal.aborted) return onAbort();
    timer = setTimeout(() => done(() => reject(new Error(`${what}이 ${ms}ms 안에 끝나지 않았어요`))), ms);
    signal.addEventListener("abort", onAbort, { once: true });
    p.then((v) => done(() => resolve(v)), (e: unknown) => done(() => reject(e)));
  });
}
type Ctx<N extends TopicName> = { e: Envelope<N>; signal: AbortSignal; defer: () => Settle };
type RunCtx = { signal: AbortSignal; defer: () => Settle };
type Job = { run: (c: RunCtx) => Promise<void> | void; done?: Settle; latest?: TopicName };
type Sub = { topic: TopicName; mode?: "latest" | "all"; cb: (body: never, ctx: Ctx<TopicName>) => void | Promise<void> };

export class BusNode {
  readonly name: NodeName;
  /** 이 노드 객체의 인스턴스 id(머리 inst). 노드를 다시 만들면 바뀌고 seq는 1부터다. */
  readonly inst = randomUUID().slice(0, 8);
  readonly #bus: Bus;
  readonly #epoch: { boot: string; home: string };
  readonly #clock: Clock;
  readonly #log: (s: string) => void;
  readonly #publishMs: number;
  readonly #fresh: Freshness;
  readonly #seq = new Map<TopicName, number>();
  readonly #subs: Sub[] = [];
  readonly #timers: [number, () => void | Promise<void>][] = [];
  readonly #queue: Job[] = [];
  readonly #handles: { topic: TopicName; h: Subscription }[] = [];
  readonly #stopTimers: (() => void)[] = [];
  readonly #parked = new Set<Settle>();
  readonly #tasks = new Set<Promise<void>>();
  readonly #life = new AbortController();
  #running: Promise<void> | null = null;
  /** prepare가 구독을 만든 #subs 수. */
  #prepared = 0;
  /** 줄에서 돌린 일 수(settled가 새 일이 왔는지 본다). */
  #handled = 0;
  #current: AbortController | null = null;
  #closed = false;
  #idle: (() => void)[] = [];

  constructor(o: { name: NodeName; bus: Bus; epoch: { boot: string; home: string }; clock?: Clock; log?: (s: string) => void; publishTimeoutMs?: number }) {
    this.name = o.name;
    this.#bus = o.bus;
    this.#epoch = o.epoch;
    this.#clock = o.clock ?? realClock;
    this.#log = o.log ?? ((s) => console.error(s));
    this.#publishMs = o.publishTimeoutMs ?? PUBLISH_TIMEOUT_MS;
    this.#fresh = new Freshness(() => this.#epoch);
  }

  on<N extends TopicName>(topic: N, cb: (body: Body<N>, ctx: Ctx<N>) => void | Promise<void>, o: { mode?: "latest" | "all" } = {}): void {
    this.#subs.push({ topic, mode: o.mode, cb: cb as never });
  }

  /** 변화(rev)는 그 판본 이상의 상태를 가진 뒤에 처리한다. 상태가 아직 없으면 변화를 내려놓고(defer) 줄을 비운다.
   *  onState는 상태가 올 때마다(같은 판본을 다시 내도) 내려놓은 변화보다 먼저 부른다(같은 노드가 상태를 두 번 구독하면 낡은 메시지 거르기가 둘째를 버린다).
   *  내려놓은 변화는 상태가 오면 그 콜백 안에서 처리하고 그때 ack한다. RELIABLE은 ack 전에는 뒤 변화를 주지 않으므로 내려놓은 변화는 하나다. */
  withState<C extends TopicName, S extends TopicName>(changes: C, state: S, cb: (change: Body<C>, latest: Body<S>, ctx: Ctx<C>) => void | Promise<void>, onState?: (latest: Body<S>, ctx: Ctx<S>) => void | Promise<void>): void {
    let latest: Body<S> | null = null;
    let parked: { c: Body<C>; ctx: Ctx<C>; settle: Settle } | null = null;
    const rev = (b: unknown) => Number((b as { rev?: number }).rev);
    const ready = (c: Body<C>) => latest !== null && rev(latest) >= rev(c);
    this.on(state, async (b, sctx) => {
      latest = b;
      await onState?.(b, sctx);
      if (!parked || !ready(parked.c)) return;
      const p = parked;
      parked = null;
      try {
        await cb(p.c, b, { ...p.ctx, signal: sctx.signal });
      } catch (err) {
        p.settle(false);
        throw err;
      }
      p.settle(true);
    });
    this.on(changes, async (c, ctx) => {
      if (ready(c)) return cb(c, latest!, ctx);
      parked = { c, ctx, settle: ctx.defer() };
    });
  }

  every(ms: number, cb: () => void | Promise<void>): void {
    this.#timers.push([ms, cb]);
  }

  async publish<N extends TopicName>(topic: N, body: Body<N>): Promise<void> {
    return this.send(this.envelope(topic, body));
  }

  /** 낼 봉투를 만든다(seq를 하나 쓴다). 실패한 발행은 같은 봉투를 다시 send해 받는 쪽이 같은 메시지(msgId)로 보게 한다. */
  envelope<N extends TopicName>(topic: N, body: Body<N>): Envelope<N> {
    if (this.#closed) throw new Error(`닫힌 노드(${this.name})는 ${topic}을 보낼 수 없어요`);
    const t = TOPICS[topic];
    if (!(t.from as readonly NodeName[]).includes(this.name)) throw new Error(`${this.name}는 ${topic}을 보낼 수 없어요(보내는 노드: ${t.from.join(", ")})`);
    t.body.parse(body);
    const seq = (this.#seq.get(topic) ?? 0) + 1;
    this.#seq.set(topic, seq);
    const key = (t.key as (b: Body<N>) => string)(body);
    return { topic, key, header: { stamp: this.#clock.now(), node: this.name, inst: this.inst, seq, ...this.#epoch }, body } as Envelope<N>;
  }

  /** 만든 봉투를 낸다(다시 내기 포함, 시간 제한·끝내기 신호는 publish와 같다). */
  async send<N extends TopicName>(e: Envelope<N>): Promise<void> {
    if (this.#closed) throw new Error(`닫힌 노드(${this.name})는 ${e.topic}을 보낼 수 없어요`);
    await bounded(this.#bus.publish(e), this.#life.signal, this.#publishMs, `${e.topic} 발행`);
  }

  /** 콜백 밖에서 도는 긴 일(LLM 호출 등). 노드 수명 신호를 받고, stop()이 그 신호를 끊고 끝나길 기다린다. */
  spawn<T>(fn: (signal: AbortSignal) => Promise<T>): Promise<T> {
    if (this.#closed) return Promise.reject(new Error(`닫힌 노드(${this.name})는 새 일을 띄울 수 없어요`));
    const p = fn(this.#life.signal);
    const t = p.then(() => {}, () => {});
    this.#tasks.add(t);
    void t.then(() => this.#tasks.delete(t));
    return p;
  }

  /** 줄에 일 하나를 넣는다(spawn한 일의 결과를 노드 상태에 넣을 때). 닫힌 뒤에는 버린다. */
  post(fn: (signal: AbortSignal) => void | Promise<void>): void {
    this.#push({ run: ({ signal }) => fn(signal) });
  }

  /** 구독·그룹·커서를 만든다(배달은 start 뒤). 다시 부르면 그 뒤 더한 구독만 만든다(재생은 받은 노드를 다시 준비한다). */
  async prepare(): Promise<void> {
    while (this.#prepared < this.#subs.length) {
      const s = this.#subs[this.#prepared]!;
      this.#handles.push({ topic: s.topic, h: await this.#bus.subscribe(s.topic, this.name, (e) => this.#enqueue(e, s), { mode: s.mode }) });
      this.#prepared++;   // 구독이 된 뒤에 센다: 실패하면 다음 prepare가 그 구독부터 다시 만든다
    }
  }

  /** 배달·타이머를 켠다. 띄우는 곳은 모든 노드의 prepare를 마친 뒤 부른다. */
  start(): void {
    for (const { h } of this.#handles) h.start();
    for (const [ms, cb] of this.#timers) this.#stopTimers.push(this.#clock.every(ms, () => this.#push({ run: () => cb() })));
  }

  async stop(): Promise<void> {
    this.#closed = true;
    for (const s of this.#stopTimers) s();
    for (const j of this.#queue.splice(0)) j.done?.(false);
    const why = new Error(`${this.name} 노드를 끝냄`);
    this.#current?.abort(why);
    this.#life.abort(why);
    await this.#running;
    await Promise.all([...this.#tasks]);
    for (const { h } of this.#handles) await h.stop();
    for (const settle of [...this.#parked]) settle(false);
  }

  /** 닫기 전 비우기: 한 간격(SETTLE_GAP_MS) 동안 새로 처리한 일이 없고 줄이 비고 more()가 참일 때까지 기다린다
   *  (메시지 사이 잠깐 빈 틈을 다 비었다고 보지 않는다: 통로로 오는 중인 메시지도 받는다).
   *  ms쯤(간격 돌림 수로 센다: 시험 시계가 멈춰 있어도 걸리지 않는다) 지나면 기다리지 않고 false. 타이머는 노드 시계의 after를 쓴다. */
  async settled(ms: number, more: () => boolean = () => true): Promise<boolean> {
    for (let round = 0; round * SETTLE_GAP_MS < ms; round++) {
      await this.idle();
      const seen = this.#handled;
      await new Promise<void>((r) => { this.#clock.after(SETTLE_GAP_MS, r); });
      if (!this.busy() && more() && this.#handled === seen) return true;
    }
    return false;
  }

  /** 시험·재생 장벽: 줄이 빌 때까지 기다린다. */
  idle(): Promise<void> {
    return this.busy() ? new Promise((r) => this.#idle.push(r)) : Promise.resolve();
  }

  /** 끝낸 노드인가(그 뒤 발행·spawn은 거절, post는 버린다). */
  get closed(): boolean { return this.#closed; }

  /** 줄에 일이 있거나 도는 중이다. 내려놓은 메시지와 spawn한 일은 세지 않는다. */
  busy(): boolean { return this.#running !== null || this.#queue.length > 0; }

  /** 그 토픽 구독의 놓친 수(SENSOR all). */
  lost(topic: TopicName): number { return this.#handles.filter((x) => x.topic === topic).reduce((n, x) => n + x.h.lost(), 0); }

  #enqueue(e: Envelope<TopicName>, s: Sub): Promise<Outcome> {
    return new Promise<Outcome>((resolve) => {
      if (this.#closed) return resolve("retry");
      if (!this.#fresh.check(e)) return resolve("ack");
      const latest = TOPICS[e.topic].qos.kind === "sensor" && s.mode !== "all" ? e.topic : undefined;
      this.#push({
        latest,
        run: async ({ signal, defer }) => {
          let deferred = false;
          await s.cb(e.body as never, {
            e, signal,
            defer: () => {
              deferred = true;
              const settle = defer();
              return (ok) => { if (ok) this.#fresh.commit(e); settle(ok); };
            },
          });
          if (!deferred) this.#fresh.commit(e);
        },
        done: (ok) => resolve(ok ? "ack" : "retry"),
      });
    });
  }

  #push(job: Job): void {
    if (this.#closed) return job.done?.(false);
    if (job.latest) {
      const old = this.#queue.findIndex((j) => j.latest === job.latest);
      if (old >= 0) this.#queue.splice(old, 1)[0]!.done?.(true);
    }
    this.#queue.push(job);
    if (!this.#running) this.#running = this.#drain();
  }

  async #drain(): Promise<void> {
    await null;   // 늘 다음 차례에 시작한다: 첫 일이 동기로 던져 줄이 바로 비어도 #running이 끝난 Promise로 남지 않는다
    while (this.#queue.length && !this.#closed) {
      const job = this.#queue.shift()!;
      this.#handled++;
      const ac = new AbortController();
      this.#current = ac;
      let taken: Settle | null = null;
      const defer = (): Settle => {
        const done = job.done;
        job.done = undefined;
        let settled = false;
        const settle: Settle = (ok) => {
          if (settled) return;
          settled = true;
          this.#parked.delete(settle);
          done?.(ok && !this.#closed);
        };
        this.#parked.add(settle);
        taken = settle;
        return settle;
      };
      let ok = true;
      try {
        await job.run({ signal: AbortSignal.any([ac.signal, this.#life.signal]), defer });
      } catch (err) {
        ok = false;
        this.#log(`[${this.name}] 콜백 실패: ${(err as Error).message}`);
        (taken as Settle | null)?.(false);
      }
      this.#current = null;
      job.done?.(ok && !this.#closed);
    }
    this.#running = null;
    for (const r of this.#idle.splice(0)) r();
  }
}
