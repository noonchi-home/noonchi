// redis.ts — Redis Streams 통로(node-redis). QoS 동작은 MemoryBus와 같다(tests/helpers/bus-contract.ts).
// 켜질 때: 디스크 저장 끔 확인(assertNoPersistence), 다른 기동의 열쇠 지움(keepOthers면 두기), 기동 표시 열쇠(noonchi:<boot>:alive)를 둔다.
// 1초마다 기동 표시 열쇠를 본다. 없거나 NOGROUP이 나면 Redis가 다시 켜져 이번 기동의 메시지·그룹을 잃은 것이다:
//   onLost(꼭 넘김)를 한 번 부르고, 읽기를 멈추고, 그 뒤 publish·subscribe를 거절한다(되살려 잇지 않는다. 띄우는 곳이 이 기동을 멈춘다).
// 읽기 루프(RELIABLE·STATE 스냅숏·SENSOR)는 연결 오류가 나면 그 루프 전체를 처음부터 다시 시도한다(잠깐 끊긴 것은 이어진다).
// SENSOR: XADD MAXLEN = depth(정확히). latest는 깨어날 때마다 XREVRANGE COUNT 1로 가장 새 것, all은 커서로 차례로 다
//   (준비 때 가장 새 seq가 기준, seq 건너뜀을 센다).
// STATE: INCR 카운터 + MULTI(HSET 값 + XADD 알림{key, n} MAXLEN ~ 64). 받는 쪽은 n이 건너뛰면 HGETALL로 다시 읽는다.
// RELIABLE: XADD(자르지 않음), 그룹 = 노드 이름 = 소비자 이름(준비 때 $부터). 먼저 내 몫으로 남은 것(id 0)을 차례대로, 다 비면 새것(>)을 읽는다.
//   한 메시지를 "ack"까지 다시 준다(RETRY_MS 간격, 그동안 뒤 메시지를 읽지 않는다). 이 구독에서 MAX_DELIVERIES번 실패하면 /bus/dead에 남기고 XACK.
//   /bus/dead 자체의 실패는 다시 보내지 않고 log만 남긴다. ack 뒤 모든 그룹이 넘긴 앞부분을 XTRIM MINID로 자른다.
//   읽기·XACK가 실패하면 내 몫(id 0)부터 다시 읽는다(같은 메시지를 다시 받을 수 있다: 받는 쪽은 한 번만 쓰기로 막는다).
// 연결마다 error 리스너를 단다(프로세스가 죽지 않는다). 막고 읽기(BLOCK)는 구독마다 따로 연결(duplicate)을 쓴다.
import { createClient, type RedisClientType } from "redis";
import { deadBody, gapCounter, MAX_DELIVERIES, RETRY_MS, type Bus, type Deliver, type Subscription } from "./bus.js";
import { decode, encode, type Envelope } from "./header.js";
import { TOPICS, type NodeName, type TopicName } from "./topics.js";

const BLOCK_MS = 1000;
const STATE_NOTE = 64;
const WATCH_MS = 1000;
const LOST = "Redis가 다시 켜져 이번 기동의 메시지를 잃었어요. 서버를 새 기동으로 다시 띄워요";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const nextId = (id: string) => { const [ms, seq] = id.split("-"); return `${ms}-${Number(seq) + 1}`; };
const cmpId = (a: string, b: string) => { const [am, as] = a.split("-").map(Number); const [bm, bs] = b.split("-").map(Number); return am! - bm! || as! - bs!; };

/** Redis 디스크 저장(AOF·RDB)이 꺼져 있는지 본다. 켜져 있으면 바꿀 설정을 말하며 실패. */
export async function assertNoPersistence(get: (name: string) => Promise<string>): Promise<void> {
  const appendonly = await get("appendonly");
  const save = await get("save");
  if (appendonly !== "no" || save !== "") {
    throw new Error(`Redis 디스크 저장이 켜져 있어요(appendonly=${appendonly}, save=${JSON.stringify(save)}). redis-server를 --appendonly no --save ""로 띄우세요(compose.yaml·compose.dev.yaml redis command)`);
  }
}

export class RedisBus implements Bus {
  readonly #closers = new Set<() => Promise<void>>();
  #watch: ReturnType<typeof setInterval> | null = null;
  #lost = false;

  private constructor(private readonly client: RedisClientType, private readonly prefix: string, private readonly log: (s: string) => void, private readonly onLost: (e: Error) => void) {}

  static async connect(url: string, o: { boot: string; keepOthers?: boolean; log?: (s: string) => void; onLost: (e: Error) => void }): Promise<RedisBus> {
    const log = o.log ?? ((s) => console.error(s));
    const client = createClient({ url }) as RedisClientType;
    client.on("error", (e: Error) => log(`[통로] Redis 오류: ${e.message}`));
    await client.connect();
    await assertNoPersistence(async (name) => String(Object.values(await client.configGet(name))[0] ?? ""));
    const prefix = `noonchi:${o.boot}:`;
    if (!o.keepOthers) {
      for await (const keys of client.scanIterator({ MATCH: "noonchi:*", COUNT: 500 })) {
        const old = (Array.isArray(keys) ? keys : [keys]).filter((k) => !k.startsWith(prefix));
        if (old.length) await client.del(old);
      }
    }
    await client.set(`${prefix}alive`, "1");
    const bus = new RedisBus(client, prefix, log, o.onLost);
    bus.#watch = setInterval(() => void bus.#check(), WATCH_MS);
    bus.#watch.unref?.();
    return bus;
  }

  async #check(): Promise<void> {
    if ((await this.client.exists(`${this.prefix}alive`).catch(() => null)) === 0) this.#lose();
  }

  #lose(): void {
    if (this.#lost) return;
    this.#lost = true;
    this.onLost(new Error(LOST));
  }

  #k(topic: string): string { return `${this.prefix}${topic}`; }

  /** 스트림의 가장 새 항목(없으면 undefined). */
  async #newest(k: string) {
    return ((await this.client.xRevRange(k, "+", "-", { COUNT: 1 })) ?? [])[0];
  }

  #open(): void {
    if (this.#lost) throw new Error(LOST);
  }

  async publish<N extends TopicName>(e: Envelope<N>): Promise<void> {
    this.#open();
    const raw = encode(e);
    decode(e.topic, raw);
    const q = TOPICS[e.topic].qos;
    const k = this.#k(e.topic);
    if (q.kind === "sensor") await this.client.xAdd(k, "*", { m: raw }, { TRIM: { strategy: "MAXLEN", threshold: q.depth } });
    else if (q.kind === "state") {
      const n = await this.client.incr(`${k}:n`);
      await this.client.multi().hSet(`${k}:state`, e.key, raw).xAdd(k, "*", { key: e.key, n: String(n) }, { TRIM: { strategy: "MAXLEN", strategyModifier: "~", threshold: STATE_NOTE } }).exec();
    } else await this.client.xAdd(k, "*", { m: raw });
  }

  async subscribe<N extends TopicName>(topic: N, node: NodeName, deliver: Deliver<N>, o: { mode?: "latest" | "all" } = {}): Promise<Subscription> {
    this.#open();
    const k = this.#k(topic);
    const q = TOPICS[topic].qos;
    const conn = this.client.duplicate();
    conn.on("error", (e: Error) => this.log(`[통로] ${topic} 구독 연결 오류: ${e.message}`));
    await conn.connect();
    let on = true;
    let started = false;
    let loop: Promise<void> = Promise.resolve();
    const tailEntry = (await this.#newest(k));
    const tail = tailEntry?.id ?? "0-0";
    const all = q.kind === "sensor" && o.mode === "all";
    const gaps = gapCounter(all && tailEntry?.message.m ? decode(topic, tailEntry.message.m) : undefined);
    /** 읽기 한 걸음을 기동을 잃거나 끊을 때까지 되풀이한다. 오류면 onError(처음부터 다시 할 준비) 뒤 RETRY_MS 쉬고 다시. NOGROUP은 기동을 잃은 것이다. */
    const forever = (step: () => Promise<boolean | void>, onError: () => void = () => {}) => async () => {
      while (on && !this.#lost) {
        try {
          if ((await step()) === false) return;
        } catch (e) {
          if (String(e).includes("NOGROUP")) return this.#lose();
          onError();
          this.log(`[통로] ${topic} 읽기 실패, 처음부터 다시 해요: ${(e as Error).message}`);
          await sleep(RETRY_MS);
        }
      }
    };
    let run: () => Promise<void>;
    if (q.kind === "reliable") {
      try { await this.client.xGroupCreate(k, node, "$", { MKSTREAM: true }); } catch (e) { if (!String(e).includes("BUSYGROUP")) throw e; }
      /** 한 메시지를 ack나 dead까지. 끊긴 구독이면 false(ack하지 않고 둔다). */
      const handle = async (id: string, raw: string): Promise<boolean> => {
        for (let tries = 1; ; tries++) {
          const out = await deliver(decode(topic, raw)).catch(() => "retry" as const);
          if (!on) return false;
          if (out === "ack") break;
          if (tries >= MAX_DELIVERIES) { await this.#dead(topic, node, raw, tries); break; }
          await sleep(RETRY_MS);
          if (!on) return false;
        }
        await this.client.xAck(k, node, id);
        await this.#trim(k);
        return true;
      };
      let mineDone = false;
      run = forever(async () => {
        const r = await conn.xReadGroup(node, node, { key: k, id: mineDone ? ">" : "0" }, { COUNT: 16, ...(mineDone ? { BLOCK: BLOCK_MS } : {}) });
        const ms = (r ?? []).flatMap((s) => s.messages).filter((m) => m?.message?.m);
        if (!mineDone && !ms.length) { mineDone = true; return; }
        for (const m of ms) if (!(await handle(m.id, m.message.m!))) return false;
      }, () => { mineDone = false; });
    } else if (q.kind === "state") {
      let lastN = 0;
      let last = tail;
      let synced = false;
      /** 스냅숏: 카운터·알림 위치를 먼저 잡고 모든 열쇠의 지금 값을 준다. 그 뒤 알림을 이어 읽는다. */
      const snapshot = async () => {
        lastN = Number((await this.client.get(`${k}:n`)) ?? 0);
        last = (await this.#newest(k))?.id ?? "0-0";
        for (const raw of Object.values(await this.client.hGetAll(`${k}:state`))) if (on) await deliver(decode(topic, raw));
        synced = true;
      };
      run = forever(async () => {
        if (!synced) return snapshot();
        const r = await conn.xRead({ key: k, id: last }, { COUNT: 100, BLOCK: BLOCK_MS });
        const ms = r?.flatMap((s) => s.messages) ?? [];
        if (!ms.length) return;
        const ns = ms.map((m) => Number(m.message.n));
        if (ns[0] !== lastN + 1) { synced = false; return; }   // 알림이 건너뛰었다: 스냅숏부터 다시
        for (const m of ms) {
          const raw = await this.client.hGet(`${k}:state`, m.message.key!);
          if (raw && on) await deliver(decode(topic, raw));
          last = m.id;
          lastN = Number(m.message.n);
        }
      }, () => { synced = false; });
    } else {
      let last = tail;
      run = forever(async () => {
        const r = await conn.xRead({ key: k, id: last }, { COUNT: all ? 100 : 1, BLOCK: BLOCK_MS });
        const ms = r?.flatMap((s) => s.messages) ?? [];
        if (!ms.length) return;
        if (all) {
          for (const m of ms) {
            const e = decode(topic, m.message.m!);
            gaps.see(e);
            if (on) await deliver(e);
            last = m.id;
          }
          return;
        }
        const newest = (await this.#newest(k));
        if (!newest || cmpId(newest.id, last) <= 0) return;
        last = newest.id;
        if (on) await deliver(decode(topic, newest.message.m!));
      });
    }
    const stop = async () => {
      on = false;
      void loop.catch(() => {});
      await conn.disconnect().catch(() => {});
      this.#closers.delete(stop);
    };
    this.#closers.add(stop);
    return {
      start: () => { if (!started) { started = true; loop = run().catch((e: Error) => this.log(`[통로] ${topic} 읽기 멈춤: ${e.message}`)); } },
      stop,
      lost: () => gaps.lost(),
    };
  }

  async #dead(topic: TopicName, group: NodeName, raw: string, tries: number): Promise<void> {
    if (topic === "/bus/dead") return this.log(`[통로] /bus/dead 처리 실패(${group}, ${tries}번): 다시 보내지 않아요`);
    const e = decode(topic, raw);
    await this.publish({ topic: "/bus/dead", key: topic, header: { ...e.header, node: group }, body: deadBody(topic, group, raw, tries) } as never);
  }

  /** 모든 그룹이 넘긴(처리 중 없음) 앞부분을 자른다. */
  async #trim(k: string): Promise<void> {
    const groups = await this.client.xInfoGroups(k);
    if (!groups.length) return;
    const keep: string[] = [];
    for (const g of groups) {
      const p = await this.client.xPending(k, g.name);
      keep.push(p.pending > 0 && p.firstId ? p.firstId : nextId(g["last-delivered-id"]));
    }
    await this.client.xTrim(k, "MINID", keep.sort(cmpId)[0]!);
  }

  /** 시험용: 토픽에 남은 메시지 수. */
  async length(topic: string): Promise<number> { return this.client.xLen(this.#k(topic)); }

  async close(): Promise<void> {
    if (this.#watch) clearInterval(this.#watch);
    for (const c of [...this.#closers]) await c();
    await this.client.quit();
  }
}
