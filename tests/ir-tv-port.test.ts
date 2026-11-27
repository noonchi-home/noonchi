// tests/ir-tv-port.test.ts
import { afterEach, expect, it, vi } from "vitest";
import { IrBridge, PING_MS, READY_MS } from "../src/devices/hub/ir-bridge.js";
import { fakeBoard, type FakeBoard } from "../src/devices/hub/ir-fake.js";
import type { IrPort } from "../src/devices/hub/ir.js";
import { codeOf, pressMatches, tvConfigOf, type RemotesFile } from "../src/devices/hub/ir-remotes.js";
import { tvPort } from "../src/devices/hub/ir-tv-port.js";
import { MemoryHub } from "../src/devices/hub/memory.js";
import { SignalHub } from "../src/devices/hub/signals.js";
import { describeDevice } from "../src/devices/mapping.js";

const id = "tv_1";
const attrs = { power: ["on", "off"] };
const spec = { id, label: "TV", room: "living", roomLabel: "거실", twinType: "tv", twinAttrs: attrs, ...describeDevice("tv", attrs)! };
const at = "2026-11-27T10:00:00.000Z";
const file: RemotesFile = { version: 1, port: { name: "FAKE", pnp: null }, remotes: [{ id: "r_0000000a", label: "거실 TV 리모컨", device: id, buttons: [
  { id: "b_000000c4", label: "켜기", role: "on", signal: { kind: "nec", address: 4, command: 0xc4 }, learned_at: at },
  { id: "b_000000c5", label: "끄기", role: "off", signal: { kind: "nec", address: 4, command: 0xc5 }, learned_at: at },
  { id: "b_00000008", label: "전원", role: "toggle", signal: { kind: "nec", address: 4, command: 8 }, learned_at: at },
] }] };
const buttons = file.remotes[0]!.buttons;
const hubs: SignalHub[] = [];
afterEach(async () => { for (const h of hubs.splice(0)) await h.stop(); vi.useRealTimers(); });

async function setup() {
  vi.useFakeTimers({ now: 100_000 });
  const board = fakeBoard();
  const bridge = new IrBridge(board.port, "FAKE");
  bridge.start();
  await vi.advanceTimersByTimeAsync(60);
  const hub = new SignalHub(new MemoryHub([spec], { [id]: { power: "on" } }));
  hubs.push(hub);
  const port = tvPort(() => bridge, (code) => buttons.find((b) => codeOf(b.id) === code)?.signal,
    (p) => { const b = buttons.find((x) => x.role && pressMatches(x.signal, p)); return b && codeOf(b.id); });
  hub.setInfrared(tvConfigOf(file, [{ id, kind: "tv" }]), port);
  await vi.advanceTimersByTimeAsync(1);
  return { board, bridge, hub };
}

it("끄기는 끄기 전용 NEC를 쏘고, 자기 신호를 손 조작으로 보지 않고, 카메라 화면 꺼짐으로 확인한다", async () => {
  const { board, hub } = await setup();
  const result = hub.command(id, { type: "off" }, "auto-1");
  await vi.advanceTimersByTimeAsync(1);
  expect(board.written).toContain("NEC 0x4 0xC5 0");
  await vi.advanceTimersByTimeAsync(500);
  const seen = Date.now();
  hub.observe(id, { power: "off" }, seen, { power: { seenAt: seen, explicit: true } });
  await expect(result).resolves.toMatchObject({ ok: true, outcome: "done" });
  expect(hub.powerStamp(id)?.power).toBe("off");
});

it("사람이 전원 단추를 누르면 전원을 모름으로 되돌린다", async () => {
  const { board, hub } = await setup();
  const result = hub.command(id, { type: "off" }, "auto-1");
  await vi.advanceTimersByTimeAsync(500);
  const seen = Date.now();
  hub.observe(id, { power: "off" }, seen, { power: { seenAt: seen, explicit: true } });
  await result;
  await vi.advanceTimersByTimeAsync(700);
  board.press({ protocol: "NEC", address: 4, command: 8 });
  await vi.advanceTimersByTimeAsync(1);
  expect(hub.powerStamp(id)?.power).toBeNull();
});

it("보드를 뽑으면 TV 명령을 거절하고, 어댑터를 떼어도 보드 연결은 남는다", async () => {
  const a = await setup();
  a.hub.setInfrared(null, () => { throw new Error("unused"); });
  expect(a.bridge.state).toBe("connected");
  const b = await setup();
  b.board.unplug();
  await expect(b.hub.command(id, { type: "on" }, "auto-2")).resolves.toMatchObject({ ok: false, error: "TV 송신기가 연결되지 않았어요." });
});

// 실제 보드: PowerShell 시작·C# 컴파일·DTR 재시작이 길면 PING이 보드에 닿지 않고 ready가 늦게 온다
const lateBoard = (board: FakeBoard, ms: number): IrPort => (name, received, lost) => {
  const opened = Date.now();
  const c = board.port(name, received, lost);
  return { send: (line) => { if (Date.now() - opened >= ms) c.send(line); }, close: () => c.close() };
};

it("ready가 늦어 연결이 답 없음이 되었다가 연결되면 TV 명령을 다시 받는다", async () => {
  vi.useFakeTimers({ now: 100_000 });
  const late = READY_MS + PING_MS + 500;
  const board = fakeBoard({ bootMs: late });
  const bridge = new IrBridge(lateBoard(board, late), "COM7");
  bridge.start();
  const hub = new SignalHub(new MemoryHub([spec], { [id]: { power: "on" } }));
  hubs.push(hub);
  hub.setInfrared(tvConfigOf(file, [{ id, kind: "tv" }]), tvPort(() => bridge, (code) => buttons.find((b) => codeOf(b.id) === code)?.signal, () => undefined));
  await vi.advanceTimersByTimeAsync(READY_MS + PING_MS + 10);
  expect(bridge.state).toBe("silent");
  await vi.advanceTimersByTimeAsync(600);
  expect(bridge.state).toBe("connected");
  const result = hub.command(id, { type: "off" }, "auto-1");
  await vi.advanceTimersByTimeAsync(1);
  expect(board.written).toContain("NEC 0x4 0xC5 0");
  await vi.advanceTimersByTimeAsync(500);
  const seen = Date.now();
  hub.observe(id, { power: "off" }, seen, { power: { seenAt: seen, explicit: true } });
  await expect(result).resolves.toMatchObject({ ok: true, outcome: "done" });
});
