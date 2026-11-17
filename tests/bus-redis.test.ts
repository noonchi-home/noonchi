// 실제 Redis 통로: REDIS_URL이 있을 때만 돈다(이 PC는 compose.dev.yaml의 noonchi-redis, CI·다른 PC는 건너뜀).
// 시험마다 다른 기동 값을 쓰고(다른 시험의 열쇠는 지우지 않는다) 다른 시험·개발 서버와 섞이지 않게 한다.
import { performance } from "node:perf_hooks";
import { createClient } from "redis";
import { describe, expect, it } from "vitest";
import { BusNode, type Bus, type Envelope, type TopicName } from "../src/bus/index.js";
import { RedisBus } from "../src/bus/redis.js";
import { busContract } from "./helpers/bus-contract.js";

const url = process.env.REDIS_URL?.trim();
let n = 0;
const boot = () => `test-${process.pid}-${Date.now()}-${++n}`;
const failOnLost = (e: Error) => { throw e; };
const until = async (f: () => boolean | Promise<boolean>, ms = 5000) => { const t0 = Date.now(); while (!(await f())) { if (Date.now() - t0 > ms) throw new Error("기다림 초과"); await new Promise((r) => setTimeout(r, 50)); } };
const admin = async (cmd: string[]) => { const c = createClient({ url: url! }); await c.connect(); try { return await c.sendCommand(cmd); } finally { await c.quit(); } };
/** Redis가 그 명령을 부른 수(INFO commandstats). */
const calls = async (cmd: string) => Number(new RegExp(`cmdstat_${cmd}:calls=(\\d+)`).exec(String(await admin(["INFO", "commandstats"])))?.[1] ?? 0);
const p50 = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]!;

/** 발행 부르기 → 받는 노드 콜백까지(ms), 하나씩 n번(앞 20번은 데우기). scripts/bus-latency.ts와 같은 잼. */
async function hop(bus: Bus, b: string, topic: "/world/changes" | "/world/state", body: (rev: number) => Record<string, unknown>, n: number): Promise<number[]> {
  const epoch = { boot: b, home: "h#1" };
  const pub = new BusNode({ name: "world", bus, epoch, log: () => {} });
  const sub = new BusNode({ name: "act", bus, epoch, log: () => {} });
  let resolve: (() => void) | null = null;
  sub.on(topic, () => { resolve?.(); });
  await pub.prepare();
  await sub.prepare();
  pub.start();
  sub.start();
  const out: number[] = [];
  await new Promise((r) => setTimeout(r, 50));   // STATE 시작 스냅숏(앞 판의 값)이 첫 잼에 끼지 않게
  for (let i = 1; i <= n + 20; i++) {
    const got = new Promise<void>((r) => { resolve = r; });
    const t0 = performance.now();
    await pub.publish(topic, body(i) as never);
    await got;
    if (i > 20) out.push(performance.now() - t0);
  }
  await pub.stop();
  await sub.stop();
  return out;
}

/** Redis 맨 전달 p50(ms): 통로 없이 bytes 크기 값을 XADD하고, 막고 읽던 다른 연결의 XREAD가 깨어나기까지. 통로가 이것보다 얼마나 더하는지 본다. */
async function bare(b: string, bytes: number, n: number): Promise<number> {
  const key = `noonchi:${b}:bare`;
  const w = createClient({ url: url! });
  await w.connect();
  const r = w.duplicate();
  await r.connect();
  const value = "x".repeat(bytes);
  let last = "0-0";
  const out: number[] = [];
  for (let i = 0; i < n + 20; i++) {
    const read = r.xRead({ key, id: last }, { COUNT: 100, BLOCK: 1000 });
    await new Promise((res) => setTimeout(res, 1));
    const t0 = performance.now();
    const added = w.xAdd(key, "*", { m: value }, { TRIM: { strategy: "MAXLEN", strategyModifier: "~", threshold: 64 } });
    const got = await read;
    if (i >= 20) out.push(performance.now() - t0);
    await added;
    last = got![0]!.messages.at(-1)!.id;
  }
  await w.del(key);
  await w.close();
  await r.close();
  return p50(out);
}

describe.skipIf(!url)("RedisBus", () => {
  busContract("RedisBus", () => RedisBus.connect(url!, { boot: boot(), keepOthers: true, log: () => {}, onLost: failOnLost }), { length: (b, t) => (b as RedisBus).length(t) });

  it("기동 표시 열쇠가 사라지면(Redis가 다시 켜짐) onLost를 부르고, 그 뒤 발행·구독을 거절한다", async () => {
    const b = boot();
    let lost: Error | null = null;
    const bus = await RedisBus.connect(url!, { boot: b, keepOthers: true, log: () => {}, onLost: (e) => { lost = e; } });
    await admin(["DEL", `noonchi:${b}:alive`]);
    await until(() => lost !== null, 3000);
    expect((lost as Error | null)?.message).toMatch(/Redis가 다시 켜져 이번 기동의 메시지를 잃었어요/);
    const msg = { topic: "/world/changes", key: "_", header: { stamp: 1, node: "world", inst: "i1", seq: 1, boot: b, home: "h#1" }, body: { rev: 1 } } as Envelope<TopicName>;
    await expect(bus.publish(msg)).rejects.toThrow(/잃었어요/);
    await expect(bus.subscribe("/world/changes", "act", async () => "ack")).rejects.toThrow(/잃었어요/);
    await bus.close();
  });

  it("연결이 잠깐 끊겨도 STATE·SENSOR·RELIABLE 구독이 이어진다", async () => {
    const b = boot();
    const bus = await RedisBus.connect(url!, { boot: b, keepOthers: true, log: () => {}, onLost: failOnLost });
    const h = (node: string, seq: number) => ({ stamp: seq, node, inst: "i1", seq, boot: b, home: "h#1" });
    const got: string[] = [];
    const subs = await Promise.all([
      bus.subscribe("/device/state", "world", async (m) => { got.push(`state ${m.body.on}`); return "ack"; }),
      bus.subscribe("/phone/pose", "world", async (m) => { got.push(`pose ${m.body.observed_ms}`); return "ack"; }),
      bus.subscribe("/world/changes", "act", async (m) => { got.push(`changes ${m.body.rev}`); return "ack"; }),
    ]);
    for (const s of subs) s.start();
    await admin(["CLIENT", "KILL", "TYPE", "normal", "SKIPME", "yes"]);
    await new Promise((r) => setTimeout(r, 500));
    await bus.publish({ topic: "/device/state", key: "a", header: h("devices", 1), body: { id: "a", on: 2 } } as never);
    await bus.publish({ topic: "/phone/pose", key: "_", header: h("phone", 1), body: { observed_ms: 7 } } as never);
    await bus.publish({ topic: "/world/changes", key: "_", header: h("world", 1), body: { rev: 3 } } as never);
    await until(() => ["state 2", "pose 7", "changes 3"].every((x) => got.includes(x)), 10_000);
    await bus.close();
  });

  it("dead 발행이 실패해도 실패한 일을 다시 하지 않고 dead만 다시 보낸다", async () => {
    const b = boot();
    const bus = await RedisBus.connect(url!, { boot: b, keepOthers: true, log: () => {}, onLost: failOnLost });
    await admin(["SET", `noonchi:${b}:/bus/dead`, "막음"]);
    let tries = 0;
    const s = await bus.subscribe("/world/changes", "act", async () => { tries++; return "retry"; });
    s.start();
    await bus.publish({ topic: "/world/changes", key: "_", header: { stamp: 1, node: "world", inst: "i1", seq: 1, boot: b, home: "h#1" }, body: { rev: 1 } } as never);
    await new Promise((r) => setTimeout(r, 1500));
    expect(tries).toBe(3);
    await admin(["DEL", `noonchi:${b}:/bus/dead`]);
    let left = 1;
    const t0 = Date.now();
    while (left > 0 && Date.now() - t0 < 5000) { left = await bus.length("/world/changes"); await new Promise((r) => setTimeout(r, 50)); }
    expect(left).toBe(0);
    expect(tries).toBe(3);
    expect(await bus.length("/bus/dead")).toBe(1);
    await bus.close();
  });

  it("시작하다 실패하면(디스크 저장이 켜짐) 만든 연결을 닫는다", async () => {
    const count = async () => String(await admin(["CLIENT", "LIST"])).trim().split("\n").length;
    const before = await count();
    await admin(["CONFIG", "SET", "appendonly", "yes"]);
    try {
      await expect(RedisBus.connect(url!, { boot: boot(), keepOthers: true, log: () => {}, onLost: failOnLost })).rejects.toThrow(/디스크 저장이 켜져/);
    } finally {
      await admin(["CONFIG", "SET", "appendonly", "no"]);
    }
    let after = await count();
    const t0 = Date.now();
    while (after > before && Date.now() - t0 < 3000) { await new Promise((r) => setTimeout(r, 100)); after = await count(); }
    expect(after).toBe(before);
  });

  it("RELIABLE: 메시지 100개를 받는 동안 XTRIM을 메시지마다 부르지 않고, 다 받은 뒤에는 잘린다", async () => {
    const b = boot();
    const bus = await RedisBus.connect(url!, { boot: b, keepOthers: true, log: () => {}, onLost: failOnLost });
    const got: number[] = [];
    const s = await bus.subscribe("/world/changes", "act", async (m) => { got.push(m.body.rev as number); return "ack"; });
    s.start();
    const before = await calls("xtrim");
    for (let i = 1; i <= 100; i++) await bus.publish({ topic: "/world/changes", key: "_", header: { stamp: i, node: "world", inst: "i1", seq: i, boot: b, home: "h#1" }, body: { rev: i } } as never);
    await until(() => got.length === 100, 10_000);
    await until(async () => (await bus.length("/world/changes")) === 0, 3000);
    expect(got).toEqual(Array.from({ length: 100 }, (_, k) => k + 1));
    expect((await calls("xtrim")) - before).toBeLessThanOrEqual(10);
    await bus.close();
  });

  it("STATE: 받는 쪽은 알림에 실린 값을 쓰고 HGET을 부르지 않는다", async () => {
    const b = boot();
    const bus = await RedisBus.connect(url!, { boot: b, keepOthers: true, log: () => {}, onLost: failOnLost });
    const got: number[] = [];
    const s = await bus.subscribe("/device/state", "world", async (m) => { got.push(m.body.on as number); return "ack"; });
    s.start();
    await new Promise((r) => setTimeout(r, 100));
    const before = await calls("hget");
    for (let i = 1; i <= 20; i++) {
      await bus.publish({ topic: "/device/state", key: "a", header: { stamp: i, node: "devices", inst: "i1", seq: i, boot: b, home: "h#1" }, body: { id: "a", on: i } } as never);
      await until(() => got.includes(i));
    }
    expect((await calls("hget")) - before).toBe(0);
    await bus.close();
  });

  it("RELIABLE·STATE 한 번 지나기 p50은 같은 크기 Redis 맨 전달 p50보다 왕복 하나만큼 늘지 않는다(묶음 2 지연 예산: 한도 1ms와 PING 왕복의 0.8배 가운데 큰 값, 번갈아 잰 다섯 판의 중앙값)", async () => {
    const b = boot();
    const change = (rev: number) => ({ rev, changes: [{ kind: "appeared", at_ms: rev, subject: "cup_1", text: "컵 cup_1 보임", meaningful: true }] });
    const state = (rev: number) => ({ rev, view: { at_ms: rev, objects: [], pad: "x".repeat(18_340) } });
    const size = (body: Record<string, unknown>) => Buffer.byteLength(JSON.stringify({ key: "_", header: { stamp: 1, node: "world", inst: "i1", seq: 1, boot: b, home: "h#1" }, body }));
    const bus = await RedisBus.connect(url!, { boot: b, keepOthers: true, log: () => {}, onLost: failOnLost });
    const c = createClient({ url: url! });
    await c.connect();
    const ping: number[] = [];
    const runs = { reliable: { floor: [] as number[], hop: [] as number[] }, state: { floor: [] as number[], hop: [] as number[] } };
    for (let r = 0; r < 5; r++) {
      const pings: number[] = [];
      for (let i = 0; i < 60; i++) { const t0 = performance.now(); await c.ping(); pings.push(performance.now() - t0); }
      ping.push(p50(pings));
      // 판마다 rev를 새로 올린다: STATE 스냅숏으로 받은 앞 판의 값보다 새 값이어야 낡은 것으로 버려지지 않는다
      runs.reliable.floor.push(await bare(b, size(change(1)), 60));
      runs.reliable.hop.push(p50(await hop(bus, b, "/world/changes", (i) => change(r * 1000 + i), 60)));
      runs.state.floor.push(await bare(b, size(state(1)), 60));
      runs.state.hop.push(p50(await hop(bus, b, "/world/state", (i) => state(r * 1000 + i), 60)));
    }
    await c.close();
    await bus.close();
    // 왕복을 하나 더하면 PING 하나만큼 는다. 바쁜 PC에서는 18KB JSON 처리 몫도 커지므로 한도를 PING에 맞춘다(AWS처럼 PING이 짧으면 1ms)
    const margin = Math.max(1, 0.8 * p50(ping));
    const each = (xs: number[]) => xs.map((x) => x.toFixed(2)).join(" ");
    for (const k of ["reliable", "state"] as const) {
      const got = p50(runs[k].hop);
      const floor = p50(runs[k].floor);
      expect(got, `${k} p50 ${got.toFixed(2)}ms(판마다 ${each(runs[k].hop)}), 맨 전달 ${floor.toFixed(2)}ms(판마다 ${each(runs[k].floor)}), PING ${each(ping)}`).toBeLessThanOrEqual(floor + margin);
    }
  }, 60_000);

  it("RELIABLE: 그룹이 없어져 XACK가 0을 돌려주면 기동을 잃었다고 바로 알리고, 그 묶음의 남은 메시지를 주지 않는다", async () => {
    const b = boot();
    let lost: Error | null = null;
    const bus = await RedisBus.connect(url!, { boot: b, keepOthers: true, log: () => {}, onLost: (e) => { lost ??= e; } });
    const got: number[] = [];
    const s = await bus.subscribe("/world/changes", "act", async (m) => {
      got.push(m.body.rev as number);
      if (m.body.rev === 1) await admin(["XGROUP", "DESTROY", `noonchi:${b}:/world/changes`, "act"]);
      await new Promise((r) => setTimeout(r, 50));
      return "ack";
    });
    for (let i = 1; i <= 3; i++) await bus.publish({ topic: "/world/changes", key: "_", header: { stamp: i, node: "world", inst: "i1", seq: i, boot: b, home: "h#1" }, body: { rev: i } } as never);
    s.start();
    await until(() => lost !== null, 3000);
    await new Promise((r) => setTimeout(r, 300));
    expect((lost as Error | null)?.message).toMatch(/잃었어요/);
    expect(got).not.toContain(3);
    await bus.close();
  });

  it("RELIABLE: XACK가 실패하면 바로 남기고 그 묶음의 남은 메시지를 주지 않으며, 내 몫부터 차례대로 다시 받는다", async () => {
    const b = boot();
    const key = `noonchi:${b}:/world/changes`;
    const logs: string[] = [];
    const bus = await RedisBus.connect(url!, { boot: b, keepOthers: true, log: (s) => logs.push(s), onLost: failOnLost });
    const got: number[] = [];
    let broke = false;
    let logsAtTwo: string[] | null = null;
    const s = await bus.subscribe("/world/changes", "act", async (m) => {
      got.push(m.body.rev as number);
      if (m.body.rev === 1 && !broke) {
        broke = true;   // 스트림을 잠시 치우고 같은 열쇠에 글을 둔다: 그 XACK는 WRONGTYPE으로 실패한다
        await admin(["RENAME", key, `${key}:away`]);
        await admin(["SET", key, "막음"]);
      }
      await new Promise((r) => setTimeout(r, 50));
      if (m.body.rev === 2) logsAtTwo ??= [...logs];
      return "ack";
    });
    for (let i = 1; i <= 3; i++) await bus.publish({ topic: "/world/changes", key: "_", header: { stamp: i, node: "world", inst: "i1", seq: i, boot: b, home: "h#1" }, body: { rev: i } } as never);
    s.start();
    await until(() => logsAtTwo !== null, 3000);
    await new Promise((r) => setTimeout(r, 300));
    await admin(["DEL", key]);
    await admin(["RENAME", `${key}:away`, key]);
    await until(() => got.filter((x) => x === 3).length === 1, 5000);
    expect(logsAtTwo!.some((l) => l.includes("ack 실패"))).toBe(true);
    expect(got).toEqual([1, 2, 1, 2, 3]);
    await bus.close();
  });

  it("Redis가 답하지 않아도 close()는 끝난다", async () => {
    const bus = await RedisBus.connect(url!, { boot: boot(), keepOthers: true, log: () => {}, onLost: () => {} });
    const s = await bus.subscribe("/world/changes", "act", async () => "ack");
    s.start();
    const c = createClient({ url: url! });
    await c.connect();
    await c.sendCommand(["CLIENT", "PAUSE", "2500", "ALL"]);
    c.destroy();
    const t0 = Date.now();
    await bus.close();
    expect(Date.now() - t0).toBeLessThan(2000);
    await new Promise((r) => setTimeout(r, 2600));
  });
});
