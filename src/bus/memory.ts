// memory.ts — 한 프로세스 안 통로. QoS 동작은 RedisBus와 같다(tests/helpers/bus-contract.ts).
// SENSOR: 토픽마다 정확히 마지막 depth개. latest는 깨어날 때 가장 새 것 하나, all은 같은 기록을 커서로 차례로 읽는다
//   (준비 때 가장 새 seq가 기준, 잘려 건너뛴 수를 센다). 상한 밖으로 쌓아 두지 않는다.
// STATE: 열쇠마다 마지막 하나. 바뀐 열쇠만 표시해 두고 읽을 때 그 열쇠의 지금 값을 준다. 시작할 때 모든 열쇠를 먼저 준다.
// RELIABLE: 토픽 기록 + 그룹마다 다음 차례·처리 중 하나·전달 횟수. 처리 중인 것이 ack되거나 dead가 될 때까지 뒤 메시지를 주지 않는다.
// 배달은 늘 다음 차례(setImmediate, 다시 주기는 RETRY_MS 뒤)에 한다: publish 안에서 콜백을 부르지 않는다. quiet()는 예약된 배달이 없는지 본다.
// 받는 쪽이 거절(reject)하면 "retry"로 본다. 다시 주기는 시계(clock, 기본 실제 시계)로 RETRY_MS가 지난 뒤에만 한다(그 사이 새 메시지가 와도 앞당기지 않는다).
// 재생은 가상 시계를 넘겨 다시 주기도 가상 시각으로 돈다(장벽은 다시 주기를 기다리지 않고, 시계를 당길 때 돈다).
// close() 뒤에는 발행·구독을 거절하고 예약된 배달도 돌리지 않는다.
import { CLOSED, deadBody, gapCounter, MAX_DELIVERIES, RETRY_MS, stateSnapshot, type Bus, type Deliver, type ReadMode, type Subscription } from "./bus.js";
import { decode, encode, type Envelope } from "./header.js";
import { realClock, type Clock } from "./clock.js";
import { TOPICS, type NodeName, type TopicName } from "./topics.js";

type Raw = { id: number; raw: string };
interface Group { name: NodeName; next: number; pending: Raw | null; tries: number; retryAt: number; deliver: Deliver<TopicName> | null; busy: boolean; started: boolean }

export class MemoryBus implements Bus {
  #id = 0;
  #scheduled = 0;
  #closed = false;
  readonly #log = new Map<string, Raw[]>();
  readonly #state = new Map<string, Map<string, string>>();
  readonly #wake = new Map<string, Set<(key: string) => void>>();
  readonly #groups = new Map<string, Map<string, Group>>();

  readonly #warn: (s: string) => void;
  readonly #clock: Clock;

  constructor(o: { warn?: (s: string) => void; clock?: Clock } = {}) {
    this.#warn = o.warn ?? ((s) => console.error(s));
    this.#clock = o.clock ?? realClock;
  }

  /** 다음 차례에 배달한다(예약 수를 센다: quiet). */
  #later(f: () => void): void {
    this.#scheduled++;
    setImmediate(() => { this.#scheduled--; if (!this.#closed) f(); });
  }

  /** 예약된 배달이 없다(재생·시험 장벽). 처리 중인 콜백은 노드 쪽(BusNode.busy)이 센다. */
  quiet(): boolean { return this.#scheduled === 0; }

  async publish<N extends TopicName>(e: Envelope<N>): Promise<void> {
    if (this.#closed) throw new Error(CLOSED);
    const raw = encode(e);
    decode(e.topic, raw);
    const q = TOPICS[e.topic].qos;
    if (q.kind === "state") (this.#state.get(e.topic) ?? this.#state.set(e.topic, new Map()).get(e.topic)!).set(e.key, raw);
    const log = this.#log.get(e.topic) ?? this.#log.set(e.topic, []).get(e.topic)!;
    log.push({ id: ++this.#id, raw });
    if (q.kind === "sensor" && log.length > q.depth) log.splice(0, log.length - q.depth);
    if (q.kind === "state" && log.length > 1) log.splice(0, log.length - 1);
    if (q.kind === "reliable") for (const g of this.#groups.get(e.topic)?.values() ?? []) this.#pump(e.topic, g);
    else for (const w of this.#wake.get(e.topic) ?? []) this.#later(() => w(e.key));
  }

  async subscribe<N extends TopicName>(topic: N, node: NodeName, deliver: Deliver<N>, o: { mode?: ReadMode } = {}): Promise<Subscription> {
    if (this.#closed) throw new Error(CLOSED);
    if (o.mode === "snapshot") {
      if (TOPICS[topic].qos.kind !== "state") throw new Error("현재 값은 STATE 토픽에서만 읽을 수 있어요");
      return stateSnapshot(topic, [...(this.#state.get(topic)?.values() ?? [])], deliver, () => !this.#closed);
    }
    const d = deliver as Deliver<TopicName>;
    const q = TOPICS[topic].qos;
    if (q.kind === "reliable") {
      const groups = this.#groups.get(topic) ?? this.#groups.set(topic, new Map()).get(topic)!;
      const g = groups.get(node) ?? groups.set(node, { name: node, next: this.#id + 1, pending: null, tries: 0, retryAt: 0, deliver: null, busy: false, started: false }).get(node)!;
      g.deliver = d;
      g.busy = false;
      g.tries = 0;
      return {
        start: () => { g.started = true; this.#pump(topic, g); },
        stop: async () => { g.deliver = null; g.started = false; g.busy = false; },
        lost: () => 0,
      };
    }
    const log = () => this.#log.get(topic) ?? [];
    const all = q.kind === "sensor" && o.mode === "all";
    const tail = log().at(-1);
    let cursor = tail?.id ?? 0;
    const gaps = gapCounter(all && tail ? decode(topic, tail.raw) : undefined);
    const dirty = new Set<string>();
    let started = false;
    let busy = false;
    const next = (): string | undefined => {
      if (q.kind === "state") {
        const key = dirty.values().next().value;
        if (key === undefined) return undefined;
        dirty.delete(key);
        return this.#state.get(topic)?.get(key);
      }
      const l = log();
      const r = all ? l.find((x) => x.id > cursor) : l.at(-1);
      if (!r || r.id <= cursor) return undefined;
      cursor = r.id;
      return r.raw;
    };
    const run = () => {
      if (!started || busy) return;
      const raw = next();
      if (raw === undefined) return;
      busy = true;
      const e = decode(topic, raw);
      if (all) gaps.see(e);
      void d(e).catch(() => "retry" as const).finally(() => { busy = false; this.#later(run); });
    };
    const wake = (key: string) => { if (q.kind === "state") dirty.add(key); run(); };
    const wakes = this.#wake.get(topic) ?? this.#wake.set(topic, new Set()).get(topic)!;
    wakes.add(wake);
    return {
      start: () => {
        if (q.kind === "state") for (const key of this.#state.get(topic)?.keys() ?? []) dirty.add(key);
        started = true;
        run();
      },
      stop: async () => { wakes.delete(wake); started = false; },
      lost: () => gaps.lost(),
    };
  }

  #pump(topic: TopicName, g: Group): void {
    if (!g.started || g.busy || !g.deliver || this.#clock.now() < g.retryAt) return;
    const item = g.pending ?? (this.#log.get(topic) ?? []).find((r) => r.id >= g.next);
    if (!item) return;
    if (g.pending !== item) g.tries = 0;
    g.pending = item;
    g.next = item.id + 1;
    g.busy = true;
    const deliver = g.deliver;
    this.#later(() => {
      void deliver(decode(topic, item.raw)).catch(() => "retry" as const).then(async (out) => {
        if (g.deliver !== deliver) return;   // 끊긴 구독: 처리 중인 것을 그대로 둔다(다시 붙으면 다시 준다)
        g.tries++;
        if (out === "retry" && g.tries < MAX_DELIVERIES) {   // RETRY_MS 뒤 같은 메시지를 다시 준다. 뒤 메시지는 기다린다
          g.busy = false;
          g.retryAt = this.#clock.now() + RETRY_MS;
          this.#clock.after(RETRY_MS, () => { if (this.#closed) return; g.retryAt = 0; this.#pump(topic, g); });
          return;
        }
        if (out === "retry") await this.#dead(topic, g.name, item.raw, g.tries);
        g.pending = null;
        g.busy = false;
        this.#trim(topic);
        this.#pump(topic, g);
      }).catch((err: Error) => this.#warn(`[통로] ${topic} 배달 마무리 실패(${g.name}): ${err.message}`));
    });
  }

  async #dead(topic: TopicName, group: NodeName, raw: string, tries: number): Promise<void> {
    if (topic === "/bus/dead") return this.#warn(`[통로] /bus/dead 처리 실패(${group}, ${tries}번): 다시 보내지 않아요`);
    const e = decode(topic, raw);
    await this.publish({ topic: "/bus/dead", key: topic, header: { ...e.header, node: group }, body: deadBody(topic, group, raw, tries) } as never);
  }

  #trim(topic: TopicName): void {
    const log = this.#log.get(topic);
    const groups = [...(this.#groups.get(topic)?.values() ?? [])];
    if (!log || !groups.length) return;
    const keep = Math.min(...groups.map((g) => g.pending?.id ?? g.next));
    while (log.length && log[0]!.id < keep) log.shift();
  }

  /** 시험용: 토픽에 남은 메시지 수. */
  length(topic: string): number { return this.#log.get(topic)?.length ?? 0; }

  async close(): Promise<void> {
    this.#closed = true;
    this.#wake.clear();
    for (const groups of this.#groups.values()) for (const g of groups.values()) { g.deliver = null; g.started = false; }
  }
}
