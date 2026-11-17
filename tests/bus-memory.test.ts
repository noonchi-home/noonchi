import { describe, expect, it } from "vitest";
import type { Envelope, TopicName } from "../src/bus/index.js";
import { MemoryBus } from "../src/bus/memory.js";
import { busContract } from "./helpers/bus-contract.js";

busContract("MemoryBus", async () => new MemoryBus(() => {}), { length: async (b, t) => (b as MemoryBus).length(t) });

const EPOCH = { boot: "b1", home: "h#1" };
const env = <N extends TopicName>(topic: N, body: Record<string, unknown>, seq: number, node = "world"): Envelope<N> =>
  ({ topic, key: "_", header: { stamp: seq, node, inst: "i1", seq, ...EPOCH }, body } as never);
const until = async (f: () => boolean, ms = 3000) => { const t0 = Date.now(); while (!f()) { if (Date.now() - t0 > ms) throw new Error("기다림 초과"); await new Promise((r) => setTimeout(r, 10)); } };

describe("MemoryBus", () => {
  it("닫은 뒤에는 예약된 배달이 돌지 않고, 발행·구독을 거절한다", async () => {
    const bus = new MemoryBus(() => {});
    const got: number[] = [];
    const s = await bus.subscribe("/phone/pose", "world", async (m) => { got.push(m.body.observed_ms as number); return "ack"; });
    s.start();
    await bus.publish(env("/phone/pose", { observed_ms: 1 }, 1, "phone"));
    await bus.close();
    await new Promise((r) => setTimeout(r, 50));
    expect(got).toEqual([]);
    await expect(bus.publish(env("/phone/pose", { observed_ms: 2 }, 2, "phone"))).rejects.toThrow(/닫힌 통로/);
    await expect(bus.subscribe("/phone/pose", "world", async () => "ack")).rejects.toThrow(/닫힌 통로/);
  });

  it("받는 쪽이 거절(reject)해도 다시 주기로 처리하고 줄이 멈추지 않는다", async () => {
    const bus = new MemoryBus(() => {});
    let calls = 0;
    const got: number[] = [];
    const s = await bus.subscribe("/world/changes", "act", async (m) => {
      calls++;
      if (calls === 1) throw new Error("받는 쪽 거절");
      got.push(m.body.rev as number);
      return "ack";
    });
    s.start();
    await bus.publish(env("/world/changes", { rev: 1 }, 1));
    await bus.publish(env("/world/changes", { rev: 2 }, 2));
    await until(() => got.length === 2);
    expect(got).toEqual([1, 2]);
    await bus.close();
  });
});
