// 폰 ↔ 폰 서버 연결(link.js): https면 wss로 /phone/events, 붙으면 시계 핑(바로·2초마다), clock 답으로 촬영 시각·오차를 맞추고, 끊기면 1초 뒤 다시 붙는다.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createLink, phoneSocketUrl } from "../ui/src/phone/core/link.js";

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

  it("열리기 전에는 보내지 않고 false. 열리면 바로·2초마다 clock 핑", () => {
    const link = make();
    const ws = FakeSocket.all[0]!;
    expect(link.send({ type: "pose" })).toBe(false);
    ws.open();
    expect(ws.sent.map((s) => JSON.parse(s))).toEqual([{ type: "clock", t0: 0 }]);
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
});
