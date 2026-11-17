// 실행기(ROS 2 single-threaded executor처럼): 준비·시작 두 단계, 같은 노드의 콜백은 겹치지 않음, 콜백 안 발행은 콜백이 끝난 뒤,
// 처리 성공 뒤에만 ack·Freshness 확정, 상태를 기다리는 변화는 처리한 뒤 ack, 동기 예외에도 줄이 멈추지 않음,
// 끝내기 계약(돌던 콜백·spawn한 일 취소와 대기), 가상 시계는 타이머 일이 끝난 뒤 간다.
import { describe, expect, it } from "vitest";
import { BusNode, MemoryBus, VirtualClock, type Bus } from "../src/bus/index.js";

const EPOCH = { boot: "b1", home: "h#1" };
/** 최상위 칸이 다 있는 가장 작은 집 상태 보기. */
const VIEW = { at_ms: 0, objects: [], person: {}, fixtures: [], devices: [], eye: null, frame_ms: null, vlm_missing: 0, yolo_missing: 0 } as never;
const tick = (ms = 20) => new Promise((r) => setTimeout(r, ms));
const node = (name: ConstructorParameters<typeof BusNode>[0]["name"], bus: MemoryBus, clock?: VirtualClock) => new BusNode({ name, bus, epoch: EPOCH, clock, log: () => {} });

describe("BusNode 실행기", () => {
  it("모든 노드를 준비한 뒤 시작하면, 먼저 시작한 노드의 첫 발행도 잃지 않는다", async () => {
    const bus = new MemoryBus();
    const w = node("world", bus);
    const a = node("act", bus);
    const got: number[] = [];
    let sent = false;
    w.every(5, async () => { if (!sent) { sent = true; await w.publish("/world/changes", { rev: 1, changes: [] }); } });
    a.on("/world/changes", (b) => { got.push(b.rev as number); });
    await w.prepare();
    await a.prepare();
    w.start();
    await tick(50);
    a.start();
    await tick(50);
    expect(got).toEqual([1]);
    await w.stop();
    await a.stop();
  });

  it("같은 노드의 메시지 콜백과 타이머 콜백이 겹치지 않는다", async () => {
    const bus = new MemoryBus();
    const n = node("act", bus);
    let running = 0;
    let overlap = false;
    const work = async () => { running++; overlap ||= running > 1; await tick(); running--; };
    n.on("/world/changes", work);
    n.every(5, work);
    const w = node("world", bus);
    await n.prepare();
    await w.prepare();
    n.start();
    w.start();
    for (let i = 0; i < 5; i++) await w.publish("/world/changes", { rev: i + 1, changes: [] });
    await tick(200);
    await n.stop();
    expect(overlap).toBe(false);
  });

  it("콜백 안에서 발행한 메시지는 그 콜백이 끝난 뒤에 처리된다(자기 구독도)", async () => {
    const bus = new MemoryBus();
    const n = node("act", bus);
    const order: string[] = [];
    n.on("/act/log", () => { order.push("log"); });
    n.on("/world/changes", async () => { await n.publish("/act/log", { a: 1 }); order.push("changes-end"); });
    const w = node("world", bus);
    await n.prepare();
    await w.prepare();
    n.start();
    w.start();
    await w.publish("/world/changes", { rev: 1, changes: [] });
    await tick(50);
    await n.idle();
    expect(order).toEqual(["changes-end", "log"]);
  });

  it("콜백이 던지면 ack하지 않아 다시 받고, Freshness는 성공한 것만 확정한다", async () => {
    const bus = new MemoryBus();
    const n = node("act", bus);
    let calls = 0;
    n.on("/world/changes", () => { calls++; if (calls === 1) throw new Error("처음 한 번 실패"); });
    const w = node("world", bus);
    await n.prepare();
    await w.prepare();
    n.start();
    w.start();
    await w.publish("/world/changes", { rev: 1, changes: [] });
    await tick(300);
    expect(calls).toBe(2);
  });

  it("타이머 콜백이 동기로 던져도 줄이 멈추지 않는다", async () => {
    const clock = new VirtualClock(0);
    const n = node("act", new MemoryBus(), clock);
    const ran: number[] = [];
    n.every(100, () => { ran.push(clock.now()); if (ran.length === 1) throw new Error("동기 예외"); });
    await n.prepare();
    n.start();
    await clock.advanceTo(300, () => n.idle());
    expect(ran).toEqual([100, 200, 300]);
  });

  it("지난 기동·지난 집의 메시지는 콜백에 오지 않는다", async () => {
    const bus = new MemoryBus();
    const n = node("act", bus);
    const got: number[] = [];
    n.on("/world/changes", (b) => { got.push(b.rev as number); });
    await n.prepare();
    n.start();
    await bus.publish({ topic: "/world/changes", key: "_", header: { stamp: 1, node: "world", inst: "i1", seq: 1, boot: "b0", home: "h#1" }, body: { rev: 1, changes: [] } } as never);
    await bus.publish({ topic: "/world/changes", key: "_", header: { stamp: 2, node: "world", inst: "i1", seq: 2, boot: "b1", home: "h#0" }, body: { rev: 2, changes: [] } } as never);
    await tick(50);
    expect(got).toEqual([]);
  });

  it("끝내기: 돌던 콜백에 취소 신호를 주고 끝나길 기다리며, 닫힌 뒤 발행은 거절된다", async () => {
    const bus = new MemoryBus();
    const n = node("act", bus);
    let cancelled = false;
    n.on("/world/changes", (_b, ctx) => new Promise<void>((r) => ctx.signal.addEventListener("abort", () => { cancelled = true; r(); })));
    const w = node("world", bus);
    await n.prepare();
    await w.prepare();
    n.start();
    w.start();
    await w.publish("/world/changes", { rev: 1, changes: [] });
    await tick(50);
    await n.stop();
    expect(cancelled).toBe(true);
    await expect(n.publish("/act/log", { a: 1 })).rejects.toThrow(/닫힌 노드/);
  });

  it("끝내기: spawn한 긴 일(LLM 호출)도 끊고 끝나길 기다리며, 그 뒤 post는 버린다", async () => {
    const n = node("brain", new MemoryBus());
    await n.prepare();
    n.start();
    let cut = false;
    let posted = false;
    const job = n.spawn((signal) => new Promise<string>((_ok, no) => signal.addEventListener("abort", () => { cut = true; no(signal.reason); })))
      .catch(() => n.post(() => { posted = true; }));
    await n.stop();
    expect(cut).toBe(true);
    await job;
    await tick();
    expect(posted).toBe(false);
    await expect(n.spawn(async () => 1)).rejects.toThrow(/닫힌 노드/);
  });

  it("변화는 그 판본 이상의 상태를 가진 뒤에 처리한다", async () => {
    const bus = new MemoryBus();
    const n = node("act", bus);
    const seen: [number, number][] = [];
    n.withState("/world/changes", "/world/state", (change, state) => { seen.push([change.rev as number, state.rev as number]); });
    const w = node("world", bus);
    await n.prepare();
    await w.prepare();
    n.start();
    w.start();
    await w.publish("/world/changes", { rev: 1, changes: [] });
    await tick(50);
    expect(seen).toEqual([]);
    await w.publish("/world/state", { rev: 1, view: VIEW });
    await tick(50);
    expect(seen).toEqual([[1, 1]]);
  });

  it("상태를 기다리는 변화는 처리한 뒤에 ack한다: 그 전에 노드를 끝내면 다시 띄운 노드가 다시 받는다", async () => {
    const bus = new MemoryBus();
    const w = node("world", bus);
    await w.prepare();
    w.start();
    const a1 = node("act", bus);
    const seen1: number[] = [];
    a1.withState("/world/changes", "/world/state", (c) => { seen1.push(c.rev as number); });
    await a1.prepare();
    a1.start();
    await w.publish("/world/changes", { rev: 1, changes: [] });
    await tick(50);
    await a1.stop();
    expect(seen1).toEqual([]);
    expect(bus.length("/world/changes")).toBe(1);
    const a2 = node("act", bus);
    const seen2: [number, number][] = [];
    a2.withState("/world/changes", "/world/state", (c, s) => { seen2.push([c.rev as number, s.rev as number]); });
    await a2.prepare();
    a2.start();
    await w.publish("/world/state", { rev: 1, view: VIEW });
    await tick(100);
    expect(seen2).toEqual([[1, 1]]);
    expect(bus.length("/world/changes")).toBe(0);
  });

  it("withState의 상태 콜백은 상태가 올 때마다(같은 rev를 다시 내도) 먼저 불리고, 내려놓은 변화는 그 뒤에 처리된다", async () => {
    const bus = new MemoryBus();
    const n = node("act", bus);
    const seen: string[] = [];
    n.withState("/world/changes", "/world/state", (c, s) => { seen.push(`변화 ${c.rev}@${s.rev}`); }, (s) => { seen.push(`상태 ${s.rev}`); });
    const w = node("world", bus);
    await n.prepare();
    await w.prepare();
    n.start();
    w.start();
    await w.publish("/world/changes", { rev: 1, changes: [] });
    await tick(50);
    await w.publish("/world/state", { rev: 1, view: VIEW });
    await tick(50);
    await w.publish("/world/state", { rev: 1, view: VIEW });
    await tick(50);
    expect(seen).toEqual(["상태 1", "변화 1@1", "상태 1"]);
  });

  it("prepare를 다시 불러도 이미 만든 구독은 다시 만들지 않고, 그 뒤 더한 구독만 만든다(재생이 준비된 노드를 받아도 한 번만 받는다)", async () => {
    const mem = new MemoryBus();
    const made: string[] = [];
    const bus: Bus = { publish: (e) => mem.publish(e), close: () => mem.close(), subscribe: (t, n, d, o) => { made.push(t); return mem.subscribe(t, n, d, o); } };
    const n = new BusNode({ name: "act", bus, epoch: EPOCH, log: () => {} });
    n.on("/world/changes", () => {});
    await n.prepare();
    await n.prepare();
    n.on("/world/state", () => {});
    await n.prepare();
    expect(made).toEqual(["/world/changes", "/world/state"]);
  });

  it("보내는 노드가 아닌 노드가 발행하면 거절된다", async () => {
    const n = node("brain", new MemoryBus());
    await expect(n.publish("/world/state", { rev: 1, view: VIEW })).rejects.toThrow(/world/);
  });

  it("가상 시계: 타이머마다 그 일(비동기 포함)이 끝난 뒤에 다음 시각으로 간다", async () => {
    const clock = new VirtualClock(0);
    const n = node("act", new MemoryBus(), clock);
    const log: string[] = [];
    n.every(250, async () => { const at = clock.now(); log.push(`시작 ${at}`); await tick(10); log.push(`끝 ${at}@${clock.now()}`); });
    await n.prepare();
    n.start();
    await clock.advanceTo(750, () => n.idle());
    expect(log).toEqual(["시작 250", "끝 250@250", "시작 500", "끝 500@500", "시작 750", "끝 750@750"]);
  });

  it("통로가 발행에 답하지 않으면(끊김) 발행은 시간 제한으로 실패하고, 끝내기는 기다리는 발행을 끊는다", async () => {
    const stuck: Bus = { publish: () => new Promise<void>(() => {}), subscribe: async () => ({ start() {}, stop: async () => {}, lost: () => 0 }), close: async () => {} };
    const quick = new BusNode({ name: "act", bus: stuck, epoch: EPOCH, log: () => {}, publishTimeoutMs: 50 });
    await expect(quick.publish("/act/log", { a: 1 })).rejects.toThrow(/50ms/);
    const clock = new VirtualClock(0);
    const n = new BusNode({ name: "act", bus: stuck, epoch: EPOCH, clock, log: () => {} });
    let failed: unknown = null;
    n.every(100, async () => { try { await n.publish("/act/log", { a: 2 }); } catch (e) { failed = e; throw e; } });
    await n.prepare();
    n.start();
    void clock.advanceTo(100);
    await tick(30);
    const t0 = Date.now();
    await n.stop();
    expect(Date.now() - t0).toBeLessThan(1000);
    expect(failed).not.toBeNull();
  });
});
