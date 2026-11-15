// 폰 ↔ 폰 서버 연결(link.js): https면 wss로 /phone/events, 붙으면 시계 핑(바로·2초마다), clock 답으로 촬영 시각·오차를 맞추고, 끊기면 1초 뒤 다시 붙는다.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createLink, phoneSocketUrl } from "../ui/src/phone/core/link.js";
import { PHONE_PROTOCOL } from "../ui/src/phone/protocol.js";

class FakeSocket {
  static OPEN = 1;
  static all: FakeSocket[] = [];
  readyState = 0;
  sent: string[] = [];
  private on: Record<string, ((e: any) => void)[]> = {};
  constructor(readonly url: string) { FakeSocket.all.push(this); }
  addEventListener(type: string, fn: (e: any) => void) { (this.on[type] ??= []).push(fn); }
  send(data: string) { this.sent.push(data); }
  close() { this.readyState = 3; this.fire("close", {}); }
  fire(type: string, e: unknown) { for (const fn of this.on[type] ?? []) fn(e); }
  open() { this.readyState = 1; this.fire("open", {}); }
  push(msg: unknown) { this.fire("message", { data: JSON.stringify(msg) }); }
}

let t = 0;
beforeEach(() => { FakeSocket.all = []; t = 0; vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });
const make = (onMessage = (_: unknown) => {}) => createLink({ url: "ws://pc/phone/events", onMessage, Socket: FakeSocket as never, now: () => t });

describe("폰 연결(link.js)", () => {
  it("https면 wss, 아니면 ws로 /phone/events", () => {
    expect(phoneSocketUrl({ protocol: "https:", host: "pc.ts.net:8443" })).toBe("wss://pc.ts.net:8443/phone/events");
    expect(phoneSocketUrl({ protocol: "http:", host: "192.168.0.7:8210" })).toBe("ws://192.168.0.7:8210/phone/events");
  });

  it("열리기 전에는 보내지 않고 false. 새 폰은 열리자마자 판본 hello를 보내고, 바로·2초마다 clock 핑", () => {
    const link = make();
    const ws = FakeSocket.all[0]!;
    expect(link.send({ type: "pose" })).toBe(false);
    ws.open();
    expect(ws.sent.map((s) => JSON.parse(s))).toEqual([{ type: "hello", protocol: PHONE_PROTOCOL }, { type: "clock", t0: 0 }]);
    vi.advanceTimersByTime(4000);
    expect(ws.sent.filter((s) => JSON.parse(s).type === "clock")).toHaveLength(3);
    expect(link.send({ type: "pose" })).toBe(true);
    link.close();
  });

  it("clock 답 중 왕복이 가장 짧은 표본으로 촬영 시각·오차를 붙인다. 표본이 없으면 빈 객체. clock은 화면으로 넘기지 않는다", () => {
    const seen: unknown[] = [];
    const link = make((m) => seen.push(m));
    const ws = FakeSocket.all[0]!;
    expect(link.stamp(1000)).toEqual({});
    ws.open();
    t = 1000;
    ws.push({ type: "clock", t0: 960, server: 5980 }); // 왕복 40, 차 5000
    ws.push({ type: "clock", t0: 990, server: 7995 }); // 왕복 10, 차 7000 → 이것
    ws.push({ type: "status", anchors: [] });
    expect(seen).toEqual([{ type: "status", anchors: [] }]);
    expect(link.stamp(1000)).toEqual({ captured_at: 8000, time_err_ms: 5 });
    link.close();
  });

  it("끊기면 1초 뒤 다시 붙고, close() 뒤에는 다시 붙지 않는다", () => {
    const link = make();
    FakeSocket.all[0]!.open();
    FakeSocket.all[0]!.close();
    vi.advanceTimersByTime(999);
    expect(FakeSocket.all).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(FakeSocket.all).toHaveLength(2);
    link.close();
    vi.advanceTimersByTime(5000);
    expect(FakeSocket.all).toHaveLength(2);
  });

  it("붙으면 onOpen, 끊기면 onClose. close() 뒤에는 onClose를 부르지 않는다", () => {
    const log: string[] = [];
    const link = createLink({ url: "ws://pc/phone/events", onMessage: () => {}, onOpen: () => log.push("open"), onClose: () => log.push("close"), Socket: FakeSocket as never, now: () => t });
    FakeSocket.all[0]!.open();
    FakeSocket.all[0]!.close();
    vi.advanceTimersByTime(1000);
    FakeSocket.all[1]!.open();
    link.close();
    expect(log).toEqual(["open", "close", "open"]);
  });

  it("끊겨 다시 붙기를 기다리는 1초 안에 close()하면 새 소켓을 만들지 않고 clock 핑도 없다", () => {
    const link = make();
    FakeSocket.all[0]!.open();
    FakeSocket.all[0]!.close();
    link.close();
    vi.advanceTimersByTime(5000);
    expect(FakeSocket.all).toHaveLength(1);
    expect(FakeSocket.all[0]!.sent.filter((s) => JSON.parse(s).type === "clock")).toHaveLength(1);
  });
});

describe("폰 판본(link.js)", () => {
  const status = (protocol?: number) => ({ type: "status", aligned: false, ...(protocol === undefined ? {} : { protocol }) });
  function versioned(storage: { getItem(k: string): string | null; setItem(k: string, v: string): void } = memory()) {
    const reloads: number[] = [];
    const stale: number[] = [];
    const got: unknown[] = [];
    const link = createLink({ url: "ws://pc/phone/events", onMessage: (m: unknown) => got.push(m), Socket: FakeSocket as never, now: () => t, reload: () => reloads.push(t), storage, onStale: () => stale.push(t) });
    return { link, reloads, stale, got };
  }
  function memory() {
    const m = new Map<string, string>();
    return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v); } };
  }

  it("폰 상태의 protocol이 폰 빌드와 다르면 페이지를 다시 읽는다. 같으면 다시 읽지 않는다. 다시 붙을 때의 상태도 본다", () => {
    const { link, reloads, got } = versioned();
    const ws = FakeSocket.all[0]!;
    ws.open();
    ws.push(status(PHONE_PROTOCOL));
    expect(reloads).toEqual([]);
    expect(got).toHaveLength(1);
    ws.close();
    vi.advanceTimersByTime(1000);
    t = 5000;
    FakeSocket.all[1]!.open();
    FakeSocket.all[1]!.push(status(PHONE_PROTOCOL + 1));
    expect(reloads).toEqual([5000]);
    link.close();
  });

  it("같은 탭에서 60초 안에 두 번 다시 읽지 않고 「새로 고침이 필요해요」를 알린다(onStale). 저장소가 막혀도 다시 읽지 않고 알린다", () => {
    const store = memory();
    const a = versioned(store);
    FakeSocket.all[0]!.open();
    FakeSocket.all[0]!.push(status(PHONE_PROTOCOL + 1));
    expect(a.reloads).toEqual([0]);
    a.link.close();
    // 다시 읽은 뒤 같은 탭(같은 저장소)의 새 페이지
    t = 30_000;
    const b = versioned(store);
    FakeSocket.all.at(-1)!.open();
    FakeSocket.all.at(-1)!.push(status(PHONE_PROTOCOL + 1));
    expect([b.reloads, b.stale]).toEqual([[], [30_000]]);
    b.link.close();
    t = 61_000;
    const c = versioned(store);
    FakeSocket.all.at(-1)!.open();
    FakeSocket.all.at(-1)!.push(status(PHONE_PROTOCOL + 1));
    expect(c.reloads).toEqual([61_000]);
    c.link.close();
    const blocked = versioned({ getItem: () => { throw new Error("막힘"); }, setItem: () => { throw new Error("막힘"); } });
    FakeSocket.all.at(-1)!.open();
    FakeSocket.all.at(-1)!.push(status(PHONE_PROTOCOL + 1));
    expect([blocked.reloads, blocked.stale]).toEqual([[], [61_000]]);
    blocked.link.close();
  });
});
