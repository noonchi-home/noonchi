import { expect, it } from "vitest";
import { BusNode, MemoryBus, Outbox, realClock } from "../src/bus/index.js";
import { BrainPlans, dailyMemory, planningRoutes } from "../src/brain/node.js";
import type { DecisionRecord } from "../src/contract/events.js";

const decision: DecisionRecord = { id: "pam-1", seq: 1, atMs: 10, finalTime: new Date(10).toISOString(), textSent: "관찰", status: "valid", prediction: null,
  action: "컵 치우기", memoryVersion: 1, world: { objects: [], person_visible: false, vlm_missing: 0, yolo_missing: 0 } };

it("기억은 같은 날 한 번 읽고 반성 뒤와 다음 날 다시 읽는다", () => {
  let calls = 0;
  const memory = dailyMemory(() => ++calls);
  expect(memory.get("day1")).toBe(1);
  expect(memory.get("day1")).toBe(1);
  memory.invalidate();
  expect(memory.get("day1")).toBe(2);
  expect(memory.get("day2")).toBe(3);
});

it("계획을 만들다가 그만두면 같은 요청의 모델을 끊고 새 계획에는 늦은 답을 쓰지 않는다", async () => {
  const bus = new MemoryBus();
  const epoch = { boot: "b", home: "one" };
  const act = new BusNode({ name: "act", epoch, bus });
  const brain = new BusNode({ name: "brain", epoch, bus });
  const port = new BrainPlans(new Outbox(act, { clock: realClock, log: () => {} }));
  let calls = 0, aborts = 0;
  port.routes(act);
  planningRoutes(brain, async (_r, signal) => {
    calls++;
    if (calls === 1) await new Promise<void>((r) => signal.addEventListener("abort", () => { aborts++; r(); }, { once: true }));
    return { ok: false, error: "모델 답" };
  }, realClock);
  try {
    await brain.prepare(); await act.prepare(); act.start(); brain.start();
    const end = new AbortController();
    const one = port.plan(decision, end.signal);
    await expect.poll(() => calls).toBe(1);
    end.abort();
    expect((await one).ok).toBe(false);
    await expect.poll(() => aborts).toBe(1);
    const two = port.plan({ ...decision, id: "pam-2", seq: 2 }, new AbortController().signal);
    expect(await two).toEqual({ ok: false, error: "모델 답" });
  } finally { port.close(); await brain.stop(); await act.stop(); await bus.close(); }
});


it("녹화한 판단과 계획 결과만으로 같은 요청을 마친다", async () => {
  const { Bag, replay } = await import("../src/record/index.js");
  const bag = Bag.open(":memory:");
  const epoch = { boot: "b", home: "one" };
  const header = { ...epoch, node: "brain" as const, inst: "recorded", stamp: 100, seq: 1 };
  bag.write({ header, key: "_", topic: "/brain/decision", body: { rev: 1, check: { ok: true }, decision, assist: "noonchi", at_ms: 100 } }, 100);
  bag.write({ header: { ...header, stamp: 110 }, key: "pam-1:1", topic: "/brain/plan",
    body: { req: "pam-1:1", decision_id: decision.id, result: { ok: false, error: "녹화한 결과" } } }, 110);
  let done: Promise<unknown> | undefined;
  try {
    await replay({ bag, from: 100, to: 111, launch: async (bus, clock) => {
      const act = new BusNode({ name: "act", bus, epoch, clock });
      const port = new BrainPlans(new Outbox(act, { clock, log: () => {} }), clock);
      port.routes(act);
      act.on("/brain/decision", (b) => { done = port.plan(b.decision, new AbortController().signal); });
      return [act];
    } });
    expect(await done).toEqual({ ok: false, error: "녹화한 결과" });
  } finally { bag.close(); }
});
