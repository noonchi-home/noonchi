// 격리 재생: 실제 통로가 아닌 새 MemoryBus·가상 시계에서, 허용 목록의 바깥 입력만 도착 차례·도착 시각대로 흘리고,
// 메시지마다 이어지는 발행이 다 끝날 때까지(처리 장벽) 기다린다.
import { describe, expect, it } from "vitest";
import { BusNode, RETRY_MS } from "../src/bus/index.js";
import { Bag, REPLAY_INPUTS, replay } from "../src/record/index.js";

const EPOCH = { boot: "b1", home: "h#1" };
const h = (seq: number, stamp: number) => ({ stamp, node: "perception" as const, inst: "i1", seq, ...EPOCH });

describe("격리 재생", () => {
  it("가전 명령·계획 같은 출력 토픽은 흘리지 않는다", () => {
    expect(REPLAY_INPUTS).not.toContain("/device/command");
    expect(REPLAY_INPUTS).not.toContain("/brain/plan");
    expect(REPLAY_INPUTS).toContain("/perception/analysis");
  });

  it("도착 차례대로 흘리고, 가상 시계는 발행 시각이 아니라 도착 시각까지 당긴다", async () => {
    const bag = Bag.open(":memory:");
    bag.write({ topic: "/perception/analysis", key: "f1", header: h(1, 2000), body: { frame_id: "f1", observed_ms: 1500 } } as never, 2100);
    bag.write({ topic: "/device/command", key: "c1", header: { ...h(1, 2500), node: "act" }, body: { command_id: "c1", deadline_ms: 9e15 } } as never, 2500);
    bag.write({ topic: "/perception/analysis", key: "f2", header: h(2, 2200), body: { frame_id: "f2", observed_ms: 2150 } } as never, 3050);
    const seen: [string, number][] = [];
    const r = await replay({
      bag, from: 0, to: 10_000,
      launch: async (bus, clock) => {
        const n = new BusNode({ name: "world", bus, epoch: EPOCH, clock, log: () => {} });
        n.on("/perception/analysis", async (b) => { await new Promise((ok) => setTimeout(ok, 20)); seen.push([String(b.frame_id), clock.now()]); });
        n.on("/device/command", (b) => { seen.push([`명령 ${String(b.command_id)}`, clock.now()]); });
        return [n];
      },
    });
    expect(r.sent).toBe(2);
    expect(seen).toEqual([["f1", 2100], ["f2", 3050]]);
  });

  it("처리에 실패한 메시지의 다시 주기도 가상 시계로 RETRY_MS 뒤에 온다(실제 시간을 기다리지 않는다)", async () => {
    const bag = Bag.open(":memory:");
    bag.write({ topic: "/perception/analysis", key: "f1", header: h(1, 1000), body: { frame_id: "f1", observed_ms: 1000 } } as never, 1000);
    bag.write({ topic: "/perception/analysis", key: "f2", header: h(2, 1500), body: { frame_id: "f2", observed_ms: 1500 } } as never, 1500);
    const seen: [string, number][] = [];
    let failed = false;
    await replay({
      bag, from: 0, to: 10_000,
      launch: async (bus, clock) => {
        const w = new BusNode({ name: "world", bus, epoch: EPOCH, clock, log: () => {} });
        w.on("/perception/analysis", (b) => {
          if (b.frame_id === "f1" && !failed) { failed = true; throw new Error("처음 한 번 실패"); }
          seen.push([String(b.frame_id), clock.now()]);
        });
        return [w];
      },
    });
    expect(seen).toEqual([["f1", 1000 + RETRY_MS], ["f2", 1500]]);
  });

  it("재생이 중간에 실패해도 노드를 끝내고 통로를 닫는다", async () => {
    const bag = Bag.open(":memory:");
    bag.write({ topic: "/perception/analysis", key: "f1", header: h(1, 1000), body: { frame_id: "f1", observed_ms: 1000 } } as never, 1000);
    let stopped = false;
    let seenBus: { publish: (e: never) => Promise<void> } | null = null;
    const broken = { prepare: async () => {}, start: () => {}, busy: () => false, idle: () => Promise.reject(new Error("장벽 실패")), stop: async () => { stopped = true; } };
    await expect(replay({ bag, from: 0, to: 10_000, launch: async (bus) => { seenBus = bus as never; return [broken as never]; } })).rejects.toThrow("장벽 실패");
    expect(stopped).toBe(true);
    await expect(seenBus!.publish({ topic: "/perception/analysis", key: "f9", header: h(9, 9), body: { frame_id: "f9", observed_ms: 9 } } as never)).rejects.toThrow(/닫힌 통로/);
  });

  it("장벽은 이어지는 발행(다섯 단계)이 다 끝난 뒤 다음 메시지로 간다", async () => {
    const bag = Bag.open(":memory:");
    bag.write({ topic: "/perception/analysis", key: "f1", header: h(1, 1000), body: { frame_id: "f1", observed_ms: 1000 } } as never, 1000);
    bag.write({ topic: "/perception/analysis", key: "f2", header: h(2, 2000), body: { frame_id: "f2", observed_ms: 2000 } } as never, 2000);
    const seen: string[] = [];
    await replay({
      bag, from: 0, to: 10_000,
      launch: async (bus, clock) => {
        const w = new BusNode({ name: "world", bus, epoch: EPOCH, clock, log: () => {} });
        const a = new BusNode({ name: "act", bus, epoch: EPOCH, clock, log: () => {} });
        w.on("/perception/analysis", async (b) => { seen.push(String(b.frame_id)); await w.publish("/world/changes", { rev: Number(b.observed_ms), changes: [] }); });
        a.on("/world/changes", async () => { await a.publish("/act/log", { n: 1 }); });
        a.on("/act/log", async (b) => { const n = Number(b.n); seen.push(`log ${n}`); if (n < 5) await a.publish("/act/log", { n: n + 1 }); });
        return [w, a];
      },
    });
    const five = ["log 1", "log 2", "log 3", "log 4", "log 5"];
    expect(seen).toEqual(["f1", ...five, "f2", ...five]);
  });
});
