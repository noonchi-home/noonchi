import { describe, expect, it } from "vitest";
import { BusNode, MemoryBus, Outbox, realClock } from "../src/bus/index.js";
import { LookClient, lookRoutes } from "../src/observe/look-port.js";

describe("살펴보기 통로", () => {
  it("사진 없이 같은 자리와 시각으로 준비를 묻고 진행 중인 확인을 거두면 관찰도 멈춘다", async () => {
    const bus = new MemoryBus();
    const epoch = { boot: "boot", home: "home" };
    const act = new BusNode({ name: "act", epoch, bus });
    const perception = new BusNode({ name: "perception", epoch, bus });
    const out = new Outbox(act, { clock: realClock, log: () => {} });
    const client = new LookClient(out, realClock);
    let ready = false, started = 0, cancelled = 0;
    const spot = { id: "cup_1", label: "컵", position: [1, 1, 1] as [number, number, number] };
    lookRoutes(perception, () => ({
      topReady: (id, since) => ready && id === spot.id && since === 100, spotReady: () => false,
      topLook: async (_spot, _since, signal) => {
        started++;
        await new Promise<void>((r) => signal!.addEventListener("abort", () => { cancelled++; r(); }, { once: true }));
        return { ok: false, why: "aborted" };
      },
      closer: async () => ({ ok: false, why: "no_view" }),
    }), realClock);
    client.routes(act);
    try {
      await act.prepare(); await perception.prepare(); act.start(); perception.start();
      expect(client.topReady(spot.id, 100)).toBe(false);
      ready = true;
      await expect.poll(() => client.topReady(spot.id, 100)).toBe(true);
      expect(client.topReady("cup_2", 100)).toBe(false);
      const abort = new AbortController();
      const seeing = client.topLook(spot, 100, abort.signal);
      await expect.poll(() => started).toBe(1);
      abort.abort();
      expect(await seeing).toEqual({ ok: false, why: "aborted" });
      await expect.poll(() => cancelled).toBe(1);
      client.close();
      expect(await client.closer(spot)).toEqual({ ok: false, why: "closed" });
    } finally { client.close(); await perception.stop(); await act.stop(); await bus.close(); }
  });
});
