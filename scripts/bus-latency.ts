// 노드 통로 한 번 지나기의 지연을 잰다(stage-queue 묶음 2 지연 예산). 무거운 일이라 npm run heavy로 돌린다.
// 쓰는 법: npx tsx scripts/bus-latency.ts [--n 500] [--bytes 6000]   (REDIS_URL이 있으면 RedisBus도 잰다)
// 잰 것: 발행 부르기 → 받는 노드 콜백까지(p50·p95·최대, ms). /world/changes(RELIABLE, 작은 몸)·/world/state(STATE, 집 상태 크기 몸).
//   Redis가 있으면 PING 왕복도. 봉투 하나의 JSON 만들기·읽기·zod 검사 시간도 따로.
import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import { createClient } from "redis";
import { BusNode, MemoryBus, decode, encode, type Bus, type Envelope, type TopicName } from "../src/bus/index.js";
import { RedisBus } from "../src/bus/redis.js";

const arg = (name: string, def: number) => { const i = process.argv.indexOf(`--${name}`); return i >= 0 ? Number(process.argv[i + 1]) : def; };
const N = arg("n", 500);
const BYTES = arg("bytes", 6000);
const EPOCH = { boot: `bench-${randomUUID().slice(0, 8)}`, home: "h#1" };
const pct = (xs: number[], p: number) => { const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))]!; };
const show = (name: string, xs: number[]) => console.log(`${name.padEnd(36)} p50 ${pct(xs, 50).toFixed(3)}ms  p95 ${pct(xs, 95).toFixed(3)}ms  최대 ${Math.max(...xs).toFixed(3)}ms  (${xs.length}번)`);

/** 집 상태 크기의 몸: rev와 bytes만큼의 view. */
const stateBody = (rev: number) => ({ rev, view: { at_ms: rev, objects: [], pad: "x".repeat(Math.max(0, BYTES - 60)) } });
const changeBody = (rev: number) => ({ rev, changes: [{ kind: "appeared", at_ms: rev, subject: "cup_1", text: "컵 cup_1 보임", meaningful: true }] });

async function hop(bus: Bus, topic: "/world/changes" | "/world/state", body: (rev: number) => Record<string, unknown>): Promise<number[]> {
  const pub = new BusNode({ name: "world", bus, epoch: EPOCH, log: () => {} });
  const sub = new BusNode({ name: "act", bus, epoch: EPOCH, log: () => {} });
  let resolve: (() => void) | null = null;
  sub.on(topic, () => { resolve?.(); });
  await pub.prepare();
  await sub.prepare();
  pub.start();
  sub.start();
  const out: number[] = [];
  for (let i = 1; i <= N + 20; i++) {
    const got = new Promise<void>((r) => { resolve = r; });
    const t0 = performance.now();
    await pub.publish(topic, body(i) as never);
    await got;
    if (i > 20) out.push(performance.now() - t0);   // 처음 20번은 데우기
  }
  await pub.stop();
  await sub.stop();
  return out;
}

function codec(): number[] {
  const e = { topic: "/world/state", key: "_", header: { stamp: 1, node: "world", inst: "i1", seq: 1, ...EPOCH }, body: stateBody(1) } as Envelope<TopicName>;
  const out: number[] = [];
  for (let i = 0; i < N; i++) {
    const t0 = performance.now();
    decode("/world/state", encode(e));
    out.push(performance.now() - t0);
  }
  return out;
}

async function main(): Promise<void> {
  console.log(`몸 크기: /world/state ${Buffer.byteLength(JSON.stringify(stateBody(1)))}바이트, /world/changes ${Buffer.byteLength(JSON.stringify(changeBody(1)))}바이트`);
  show("봉투 만들기·읽기·검사(/world/state)", codec());
  const mem = new MemoryBus({ warn: () => {} });
  show("MemoryBus /world/changes 한 번 지나기", await hop(mem, "/world/changes", changeBody));
  show("MemoryBus /world/state 한 번 지나기", await hop(mem, "/world/state", stateBody));
  await mem.close();
  const url = process.env.REDIS_URL?.trim();
  if (!url) return console.log("REDIS_URL이 없어 RedisBus는 재지 않았어요");
  const c = createClient({ url });
  await c.connect();
  const ping: number[] = [];
  for (let i = 0; i < N; i++) { const t0 = performance.now(); await c.ping(); ping.push(performance.now() - t0); }
  await c.close();
  show("Redis PING 왕복", ping);
  const redis = await RedisBus.connect(url, { boot: EPOCH.boot, keepOthers: true, log: () => {}, onLost: (e) => { throw e; } });
  show("RedisBus /world/changes 한 번 지나기", await hop(redis, "/world/changes", changeBody));
  show("RedisBus /world/state 한 번 지나기", await hop(redis, "/world/state", stateBody));
  await redis.close();
}

main().then(() => process.exit(0), (e: unknown) => { console.error(e); process.exit(1); });
