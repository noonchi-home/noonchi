// tests/ir-bridge.test.ts
import { afterEach, describe, expect, it, vi } from "vitest";
import { ECHO_MS, IrBridge, PING_MS, PORT_OPENED, READY_MS, parseRaw, parseRx, sendLine, type BridgePress } from "../src/devices/hub/ir-bridge.js";
import type { IrPort } from "../src/devices/hub/ir.js";

function wire() {
  const written: string[] = [];
  let rx: (line: string) => void = () => {};
  let gone: (reason?: "busy") => void = () => {};
  const open: IrPort = (_name, received, lost) => { rx = received; gone = lost; return { send: (l) => { written.push(l); }, close: () => {} }; };
  return { open, written, rx: (l: string) => rx(l), lost: (r?: "busy") => gone(r) };
}
function connected() {
  const w = wire();
  const b = new IrBridge(w.open, "COM7");
  b.start();
  w.rx("ready ir_bridge raw=750");
  const presses: BridgePress[] = [];
  b.onPress((p) => presses.push(p));
  return { ...w, b, presses };
}
afterEach(() => { vi.useRealTimers(); });

describe("ir_bridge 줄", () => {
  it("RX·RXRAW를 읽고 모양이 틀린 줄은 버린다", () => {
    expect(parseRx("RX NEC 0x4 0x8")).toEqual({ protocol: "NEC", address: 4, command: 8 });
    expect(parseRx("RX SAMSUNG 0x707 0x2")).toEqual({ protocol: "SAMSUNG", address: 0x707, command: 2 });
    expect(parseRx("RX NEC 0x4")).toBeNull();
    expect(parseRaw("RXRAW 3 180 90 11")).toEqual([180, 90, 11]);
    expect(parseRaw("RXRAW 4 180 90 11")).toBeNull();
    expect(parseRaw("RXRAW 3 180 0 11")).toBeNull();
  });
  it("NEC·RAW 보내기 줄을 만들고 750칸을 넘는 원본은 거절한다", () => {
    expect(sendLine({ kind: "nec", address: 4, command: 0xc4 })).toBe("NEC 0x4 0xC4 0");
    expect(sendLine({ kind: "raw", khz: 38, ticks: [180, 90, 11, 11], decoded: null })).toBe("RAW 38 4 180 90 11 11");
    expect(() => sendLine({ kind: "raw", khz: 38, ticks: Array(751).fill(11), decoded: null })).toThrow();
  });
});

describe("IrBridge", () => {
  it("포트를 연 표시 줄부터 준비 시간을 세서 늦게 연 포트의 ready도 답 없음 없이 받고, 그 줄은 다른 펌웨어로 세지 않는다", async () => {
    vi.useFakeTimers();
    const w = wire();
    const b = new IrBridge(w.open, "COM7");
    const states: string[] = [];
    b.onState((s) => states.push(s));
    b.start();
    await vi.advanceTimersByTimeAsync(3500);
    w.rx(PORT_OPENED);
    await vi.advanceTimersByTimeAsync(2200);
    expect(b.state).toBe("connecting");
    w.rx("ready ir_bridge raw=750");
    expect(states).toEqual(["connected"]);
    const q = wire();
    const quiet = new IrBridge(q.open, "COM8");
    quiet.start();
    await vi.advanceTimersByTimeAsync(1000);
    q.rx(PORT_OPENED);
    await vi.advanceTimersByTimeAsync(READY_MS + PING_MS - 100);
    expect(quiet.state).toBe("connecting");
    await vi.advanceTimersByTimeAsync(200);
    expect(quiet.state).toBe("silent");
  });

  it("ready ir_bridge 전에는 보내지 않고, 뒤에는 ok 답을 받아야 끝난다", async () => {
    const w = wire();
    const b = new IrBridge(w.open, "COM7");
    b.start();
    await expect(b.send({ kind: "nec", address: 4, command: 8 })).rejects.toThrow("적외선 장치가 연결되지 않았어요.");
    expect(w.written).toEqual([]);
    w.rx("ready ir_bridge raw=750");
    expect(b.state).toBe("connected");
    let done = false;
    const sent = b.send({ kind: "nec", address: 4, command: 8 }).then(() => { done = true; });
    expect(w.written).toEqual(["NEC 0x4 0x8 0"]);
    await Promise.resolve();
    expect(done).toBe(false);
    w.rx("ok sent NEC 0x4 0x8");
    await sent;
    expect(done).toBe(true);
  });

  it("err 답은 그 명령만 실패시키고 다음 명령을 보낸다", async () => {
    const { b, rx, written } = connected();
    const first = b.send({ kind: "nec", address: 4, command: 8 });
    const second = b.rawReport(true);
    expect(written).toEqual(["NEC 0x4 0x8 0"]);
    rx("err bad command");
    await expect(first).rejects.toThrow("err bad command");
    expect(written).toEqual(["NEC 0x4 0x8 0", "RAWON"]);
    rx("ok raw on");
    await expect(second).resolves.toBeUndefined();
  });

  it("ready 줄이 없으면 PING을 보내 ok pong이면 연결, 다른 줄만 오면 다른 펌웨어, 아무 줄도 없으면 답 없음", () => {
    vi.useFakeTimers();
    const a = wire(); const pong = new IrBridge(a.open, "COM7"); pong.start();
    vi.advanceTimersByTime(READY_MS);
    expect(a.written).toEqual(["PING"]);
    a.rx("ok pong");
    expect(pong.state).toBe("connected");
    const c = wire(); const other = new IrBridge(c.open, "COM8"); other.start();
    c.rx("boot"); c.rx("ready"); c.rx("light none");
    vi.advanceTimersByTime(READY_MS + PING_MS);
    expect(other.state).toBe("wrong_firmware");
    const d = wire(); const silent = new IrBridge(d.open, "COM9"); silent.start();
    vi.advanceTimersByTime(READY_MS + PING_MS);
    expect(silent.state).toBe("silent");
  });

  it("RXRAW 다음 RX는 한 누름이고, 보낸 뒤 600 ms 안에 받은 자기 신호는 누름이 아니다", async () => {
    vi.useFakeTimers();
    const { b, rx, presses } = connected();
    rx("RXRAW 4 180 90 11 11"); rx("RX NEC 0x4 0x8");
    expect(presses).toEqual([expect.objectContaining({ decoded: { protocol: "NEC", address: 4, command: 8 }, ticks: [180, 90, 11, 11], overflow: false })]);
    rx("RXRAW 4 180 90 11 34");
    vi.advanceTimersByTime(300);
    expect(presses[1]).toMatchObject({ decoded: null, ticks: [180, 90, 11, 34] });
    const sent = b.send({ kind: "nec", address: 4, command: 8 });
    rx("RX NEC 0x4 0x8");
    rx("ok sent NEC 0x4 0x8");
    await sent;
    rx("RX NEC 0x4 0x8");
    expect(presses).toHaveLength(2);
    vi.advanceTimersByTime(ECHO_MS);
    rx("RX NEC 0x4 0x8");
    expect(presses).toHaveLength(3);
    rx("RXOVF");
    vi.advanceTimersByTime(300);
    expect(presses[3]).toMatchObject({ overflow: true });
  });

  it("보드가 다시 시작하면 기다리던 명령을 실패로 끝내고 다시 연결된다", async () => {
    const { b, rx } = connected();
    const states: string[] = [];
    b.onState((s) => states.push(s));
    const pending = b.send({ kind: "nec", address: 4, command: 8 });
    rx("ready ir_bridge raw=750");
    await expect(pending).rejects.toThrow();
    expect(states).toEqual(["connecting", "connected"]);
  });

  it("다른 프로그램이 포트를 쥐면 busy, 선이 빠지면 lost", () => {
    const a = wire(); const busy = new IrBridge(a.open, "COM7"); busy.start(); a.lost("busy");
    expect(busy.state).toBe("busy");
    const { b, lost } = connected(); lost();
    expect(b.state).toBe("lost");
  });
});
