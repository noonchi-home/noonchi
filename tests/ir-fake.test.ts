// tests/ir-fake.test.ts
import { afterEach, expect, it, vi } from "vitest";
import { IrBridge, PING_MS, READY_MS, type BridgePress } from "../src/devices/hub/ir-bridge.js";
import { fakeBoard, necTicks } from "../src/devices/hub/ir-fake.js";
afterEach(() => { vi.useRealTimers(); });

it("NEC 원본 길이는 리더 2칸 + 32비트 64칸 + 끝 1칸이다", () => {
  const t = necTicks(4, 8);
  expect(t).toHaveLength(67);
  expect(t.slice(0, 2)).toEqual([180, 90]);
  expect(t.slice(2, 4)).toEqual([11, 11]);
  expect(t.slice(6, 8)).toEqual([11, 34]);
});

it("ir_bridge처럼 답하고, 자기 신호는 IrBridge가 거른다", async () => {
  vi.useFakeTimers();
  const board = fakeBoard();
  const bridge = new IrBridge(board.port, "FAKE");
  const presses: BridgePress[] = [];
  bridge.onPress((p) => presses.push(p));
  bridge.start();
  await vi.advanceTimersByTimeAsync(60);
  expect(bridge.state).toBe("connected");
  const sent = bridge.send({ kind: "nec", address: 4, command: 0xc5 });
  await vi.advanceTimersByTimeAsync(1);
  await sent;
  expect(board.written).toContain("NEC 0x4 0xC5 0");
  expect(presses).toEqual([]);
  await vi.advanceTimersByTimeAsync(700);
  const on = bridge.rawReport(true);
  await vi.advanceTimersByTimeAsync(1);
  await on;
  board.press({ protocol: "NEC", address: 4, command: 8 });
  await vi.advanceTimersByTimeAsync(1);
  expect(presses).toEqual([expect.objectContaining({ decoded: { protocol: "NEC", address: 4, command: 8 }, ticks: necTicks(4, 8) })]);
});

it("autoPressMs면 RAWON 동안 배울 때마다 다른 명령 코드로 누른다", async () => {
  vi.useFakeTimers();
  const board = fakeBoard({ autoPressMs: 1200 });
  const bridge = new IrBridge(board.port, "FAKE");
  const got: number[] = [];
  bridge.onPress((p) => { if (p.decoded) got.push(p.decoded.command); });
  bridge.start();
  await vi.advanceTimersByTimeAsync(60);
  const a = bridge.rawReport(true); await vi.advanceTimersByTimeAsync(1); await a;
  await vi.advanceTimersByTimeAsync(2400);
  const b = bridge.rawReport(false); await vi.advanceTimersByTimeAsync(1); await b;
  const c = bridge.rawReport(true); await vi.advanceTimersByTimeAsync(1); await c;
  await vi.advanceTimersByTimeAsync(1200);
  expect(got).toEqual([0x21, 0x21, 0x22]);
});

it("ir_tv 펌웨어 흉내는 다른 펌웨어, 뽑으면 lost", async () => {
  vi.useFakeTimers();
  const old = new IrBridge(fakeBoard({ firmware: "ir_tv" }).port, "COM7");
  old.start();
  await vi.advanceTimersByTimeAsync(READY_MS + PING_MS + 100);
  expect(old.state).toBe("wrong_firmware");
  const board = fakeBoard();
  const b = new IrBridge(board.port, "COM7");
  b.start();
  await vi.advanceTimersByTimeAsync(60);
  board.unplug();
  expect(b.state).toBe("lost");
});
