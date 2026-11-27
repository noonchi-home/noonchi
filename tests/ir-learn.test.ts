// tests/ir-learn.test.ts
import { afterEach, expect, it, vi } from "vitest";
import type { IrSignal } from "../src/contract/ir.js";
import type { BridgePress, BridgeState } from "../src/devices/hub/ir-bridge.js";
import { necTicks } from "../src/devices/hub/ir-fake.js";
import { LearnSession, signalOf, type LearnOutcome } from "../src/devices/hub/ir-learn.js";

function bridge(start: BridgeState = "connected") {
  const pressCbs = new Set<(p: BridgePress) => void>(), stateCbs = new Set<(s: BridgeState) => void>();
  const b = {
    state: start,
    raw: [] as boolean[],
    onPress: (cb: (p: BridgePress) => void) => { pressCbs.add(cb); return () => { pressCbs.delete(cb); }; },
    onState: (cb: (s: BridgeState) => void) => { stateCbs.add(cb); return () => { stateCbs.delete(cb); }; },
    rawReport: async (on: boolean) => { b.raw.push(on); },
    press: (p: Partial<BridgePress>) => { for (const cb of [...pressCbs]) cb({ decoded: null, ticks: null, overflow: false, at: Date.now(), ...p }); },
    set: (s: BridgeState) => { b.state = s; for (const cb of [...stateCbs]) cb(s); },
  };
  return b;
}
const nec = (command: number): Partial<BridgePress> => ({ decoded: { protocol: "NEC", address: 4, command }, ticks: necTicks(4, command) });
async function learn(others: { label: string; signal: IrSignal }[] = [], b = bridge()) {
  const results: LearnOutcome[] = [];
  const s = new LearnSession(b, { others, done: (r) => results.push(r) });
  await s.start();
  return { b, s, results };
}
afterEach(() => { vi.useRealTimers(); });

it("같은 NEC 신호를 두 번 받으면 저장하고 원본 알림을 켰다가 끈다", async () => {
  const { b, s, results } = await learn();
  b.press(nec(8));
  expect(s.presses).toBe(1);
  expect(results).toEqual([]);
  b.press(nec(8));
  expect(results).toEqual([{ state: "saved", signal: { kind: "nec", address: 4, command: 8 } }]);
  expect(b.raw).toEqual([true, false]);
});

it("다른 신호가 끼면 그 신호부터 다시 센다", async () => {
  const { b, results } = await learn();
  b.press(nec(8)); b.press(nec(9));
  expect(results).toEqual([]);
  b.press(nec(9));
  expect(results).toEqual([{ state: "saved", signal: { kind: "nec", address: 4, command: 9 } }]);
});

it("방식을 모르는 리모컨은 원본으로 저장한다", async () => {
  const ticks = [30, 30, 11, 34, 11, 11, 11, 34];
  const { b, results } = await learn();
  b.press({ ticks }); b.press({ ticks: ticks.map((t) => t + 1) });
  expect(results).toEqual([{ state: "saved", signal: { kind: "raw", khz: 38, ticks: ticks.map((t) => t + 1), decoded: null } }]);
});

it("같은 리모컨의 다른 단추와 신호가 같으면 그 단추 이름으로 거절한다", async () => {
  const { b, results } = await learn([{ label: "전원", signal: { kind: "nec", address: 4, command: 8 } }]);
  b.press(nec(8)); b.press(nec(8));
  expect(results).toEqual([{ state: "duplicate", of: "전원" }]);
});

it("30초 안에 두 번 받지 못하면 시간 초과, 남은 시간은 줄어든다", async () => {
  vi.useFakeTimers();
  const { s, results } = await learn();
  vi.advanceTimersByTime(10_000);
  expect(s.leftMs()).toBe(20_000);
  vi.advanceTimersByTime(20_000);
  expect(results).toEqual([{ state: "timeout" }]);
  expect(s.leftMs()).toBe(0);
});

it("원본이 넘치면 overflow, 연결이 끊기면 lost, 멈추면 cancelled이고 끝은 한 번만 알린다", async () => {
  const a = await learn(); a.b.press({ overflow: true }); a.b.press(nec(8)); a.b.press(nec(8));
  expect(a.results).toEqual([{ state: "overflow" }]);
  const l = await learn(); l.b.set("lost"); l.s.cancel();
  expect(l.results).toEqual([{ state: "lost" }]);
  const c = await learn(); c.s.cancel();
  expect(c.results).toEqual([{ state: "cancelled" }]);
});

it("연결 전에는 시작하지 않고 RAWON도 보내지 않는다", async () => {
  const b = bridge("connecting");
  await expect(learn([], b)).rejects.toThrow("적외선 장치가 연결되지 않았어요.");
  expect(b.raw).toEqual([]);
});

it("NEC가 아닌 해석 신호에 원본이 없으면 쓰지 않는다", () => {
  expect(signalOf({ decoded: { protocol: "SONY", address: 1, command: 2 }, ticks: null, overflow: false, at: 0 })).toBeNull();
});
