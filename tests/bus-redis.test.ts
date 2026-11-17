// 실제 Redis 통로: REDIS_URL이 있을 때만 돈다(이 PC는 compose.dev.yaml의 noonchi-redis, CI·다른 PC는 건너뜀).
// 시험마다 다른 기동 값을 쓰고(다른 시험의 열쇠는 지우지 않는다) 다른 시험·개발 서버와 섞이지 않게 한다.
import { createClient } from "redis";
import { describe, expect, it } from "vitest";
import type { Envelope, TopicName } from "../src/bus/index.js";
import { RedisBus } from "../src/bus/redis.js";
import { busContract } from "./helpers/bus-contract.js";

const url = process.env.REDIS_URL?.trim();
let n = 0;
const boot = () => `test-${process.pid}-${Date.now()}-${++n}`;
const failOnLost = (e: Error) => { throw e; };
const until = async (f: () => boolean, ms = 5000) => { const t0 = Date.now(); while (!f()) { if (Date.now() - t0 > ms) throw new Error("기다림 초과"); await new Promise((r) => setTimeout(r, 50)); } };
const admin = async (cmd: string[]) => { const c = createClient({ url: url! }); await c.connect(); try { return await c.sendCommand(cmd); } finally { await c.quit(); } };

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
});
