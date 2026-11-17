// 차례대로 보내기(src/bus/outbox.ts): 노드가 낸 메시지를 낸 차례대로 하나씩 보내고, 실패하면 같은 봉투(같은 메시지 id)로 RETRY_MS 뒤 다시 보낸다.
// 앞 것이 나가야 뒤 것을 보낸다. drain은 다 보내거나 기한이 지날 때까지 기다리고(닫기 전 비우기), 노드를 끝내면 남은 것을 버린다.
import { describe, expect, it } from "vitest";
import { BusNode, MemoryBus, Outbox, RETRY_MS, VirtualClock, msgId, type Envelope, type TopicName } from "../src/bus/index.js";
import { settle } from "../src/record/replay.js";

const EPOCH = { boot: "b1", home: "h#1" };

/** 정한 토픽의 다음 발행 n번을 실패시키는 통로. */
class FlakyBus extends MemoryBus {
  readonly failing = new Map<TopicName, number>();
  fail(topic: TopicName, n = 1): void { this.failing.set(topic, n); }
  override async publish<N extends TopicName>(e: Envelope<N>): Promise<void> {
    const n = this.failing.get(e.topic) ?? 0;
    if (n > 0) {
      this.failing.set(e.topic, n - 1);
      throw new Error(`${e.topic} 발행 실패`);
    }
    return super.publish(e);
  }
}

async function rig() {
  const clock = new VirtualClock(1000);
  const bus = new FlakyBus({ warn: () => {}, clock });
  const act = new BusNode({ name: "act", bus, epoch: EPOCH, clock, log: () => {} });
  const world = new BusNode({ name: "world", bus, epoch: EPOCH, clock, log: () => {} });
  const got: { kind: string; id: string; msg: string }[] = [];
  world.on("/world/input", (b, { e }) => { got.push({ kind: b.kind, id: b.id ?? "", msg: msgId(e.header) }); });
  await world.prepare();
  act.start();
  world.start();
  const out = new Outbox(act, { clock, log: () => {} });
  const flush = () => settle(bus, [act, world]);
  return { clock, bus, act, world, got, out, flush };
}

describe("차례대로 보내기", () => {
  it("실패하면 같은 봉투로 RETRY_MS 뒤 다시 보내고, 그동안 뒤 것을 붙잡아 차례를 지킨다", async () => {
    const r = await rig();
    r.bus.fail("/world/input");
    r.out.push("/world/input", { kind: "guard", id: "cup_1", on: true, at_ms: 1 });
    r.out.push("/world/input", { kind: "contents", id: "cup_1", on: true, at_ms: 2 });
    await r.flush();
    expect(r.got).toEqual([]);
    expect(r.out.size).toBe(2);
    await r.clock.advanceTo(1000 + RETRY_MS, r.flush);
    await r.flush();
    expect(r.got.map((g) => g.kind)).toEqual(["guard", "contents"]);
    expect(r.out.size).toBe(0);
  });

  it("drain은 다 보낼 때까지 기다리고(true), 기한이 지나면 멈춘다(false). 노드를 끝내면 남은 것을 버린다", async () => {
    const r = await rig();
    r.out.push("/world/input", { kind: "guard", id: "cup_1", on: true, at_ms: 1 });
    expect(await r.out.drain(500)).toBe(true);
    r.bus.fail("/world/input", 100);
    r.out.push("/world/input", { kind: "guard", id: "cup_2", on: true, at_ms: 2 });
    const drained = r.out.drain(150);
    await r.clock.advanceTo(1000 + 150, r.flush);
    expect(await drained).toBe(false);
    await r.act.stop();
    await r.clock.advanceTo(2000, r.flush);
    expect(r.out.size).toBe(0);
    expect(r.got.map((g) => g.id)).toEqual(["cup_1"]);
  });
});
