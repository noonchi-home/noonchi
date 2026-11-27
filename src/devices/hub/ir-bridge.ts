// 신지훈 ir_bridge 펌웨어와 USB 직렬로 말하기(줄 목록: hardware/ir-bridge/README.md).
// 포트 하나에 연결 하나. 배우기·시험 쏘기·TV 전원·리모컨 단추가 이 연결을 함께 쓴다.
import type { IrDecoded, IrSignal } from "../../contract/ir.js";
import type { IrPort } from "./ir.js";

export const RAW_MAX = 750;
export const ECHO_MS = 600;
export const READY_MS = 4000;
export const PING_MS = 1500;
export const REPLY_MS = 2000;
export const RAW_REPLY_MS = 5000;
export const GROUP_MS = 300;
/** serial.ps1이 포트를 연 바로 뒤 내는 줄(보드 줄이 아니다). IrBridge는 이 줄부터 READY_MS를 센다: PowerShell이 늦게 뜨면 시작부터 세어 답 없음이 됐다. */
export const PORT_OPENED = "#opened";
const READY = /^ready ir_bridge(?:\s|$)/;
const RX = /^RX\s+(\S+)\s+0x([0-9a-fA-F]+)\s+0x([0-9a-fA-F]+)$/;
const NOT_CONNECTED = "적외선 장치가 연결되지 않았어요.";

export function parseRx(line: string): IrDecoded | null {
  const m = RX.exec(line.trim());
  return m ? { protocol: m[1]!, address: parseInt(m[2]!, 16), command: parseInt(m[3]!, 16) } : null;
}

export function parseRaw(line: string): number[] | null {
  const parts = line.trim().split(/\s+/);
  if (parts[0] !== "RXRAW" || parts.length < 3 || !parts.slice(1).every((p) => /^\d+$/.test(p))) return null;
  const ticks = parts.slice(2).map(Number);
  return ticks.length === Number(parts[1]) && ticks.every((t) => t >= 1 && t <= 255) ? ticks : null;
}

const hex = (n: number) => "0x" + n.toString(16).toUpperCase();
export function sendLine(signal: IrSignal): string {
  if (signal.kind === "nec") return `NEC ${hex(signal.address)} ${hex(signal.command)} 0`;
  const t = signal.ticks;
  if (t.length < 1 || t.length > RAW_MAX || t.some((v) => !Number.isInteger(v) || v < 1 || v > 255)) throw new Error("원본 신호 길이가 맞지 않아요.");
  return `RAW ${signal.khz} ${t.length} ${t.join(" ")}`;
}

export interface BridgePress { decoded: IrDecoded | null; ticks: number[] | null; overflow: boolean; at: number }
export type BridgeState = "connecting" | "connected" | "wrong_firmware" | "silent" | "busy" | "lost";
interface Waiting { line: string; ir: boolean; ms: number; resolve(): void; reject(e: Error): void; timer?: ReturnType<typeof setTimeout> }

export class IrBridge {
  state: BridgeState = "connecting";
  private connection?: { send(line: string): void; close(): void };
  private readonly pressCbs = new Set<(p: BridgePress) => void>();
  private readonly stateCbs = new Set<(s: BridgeState) => void>();
  private queue: Waiting[] = [];
  private held: { press: BridgePress; timer: ReturnType<typeof setTimeout> } | null = null;
  private quietUntil = -Infinity;
  private heardOther = false;
  private readyTimer?: ReturnType<typeof setTimeout>;
  private closed = false;

  constructor(private readonly open: IrPort, readonly port: string, private readonly now: () => number = () => Date.now()) {}

  start(): void {
    this.connection = this.open(this.port, (line) => this.receive(line), (reason) => this.drop(reason === "busy" ? "busy" : "lost"));
    this.readyTimer = setTimeout(() => this.ping(), READY_MS);
  }

  onPress(cb: (p: BridgePress) => void): () => void { this.pressCbs.add(cb); return () => { this.pressCbs.delete(cb); }; }
  onState(cb: (s: BridgeState) => void): () => void { this.stateCbs.add(cb); return () => { this.stateCbs.delete(cb); }; }

  send(signal: IrSignal): Promise<void> {
    let line: string;
    try { line = sendLine(signal); } catch (e) { return Promise.reject(e as Error); }
    return this.command(line, signal.kind === "raw" ? RAW_REPLY_MS : REPLY_MS, true);
  }
  rawReport(on: boolean): Promise<void> { return this.command(on ? "RAWON" : "RAWOFF", REPLY_MS, false); }

  close(): void {
    if (this.closed) return;
    this.drop("lost");
    this.closed = true;
    this.connection?.close();
  }

  private ping() {
    if (this.state !== "connecting" || this.closed) return;
    this.write("PING");
    this.readyTimer = setTimeout(() => { if (this.state === "connecting") this.setState(this.heardOther ? "wrong_firmware" : "silent"); }, PING_MS);
  }

  private command(line: string, ms: number, ir: boolean): Promise<void> {
    if (this.state !== "connected") return Promise.reject(new Error(NOT_CONNECTED));
    return new Promise((resolve, reject) => {
      this.queue.push({ line, ir, ms, resolve, reject });
      if (this.queue.length === 1) this.next();
    });
  }

  private next() {
    const w = this.queue[0];
    if (!w) return;
    if (w.ir) this.quietUntil = Infinity;
    w.timer = setTimeout(() => this.settle(new Error("적외선 장치가 답하지 않아요.")), w.ms);
    this.write(w.line);
  }

  private settle(error: Error | null) {
    const w = this.queue.shift();
    if (!w) return;
    clearTimeout(w.timer);
    if (w.ir) this.quietUntil = this.now() + ECHO_MS;
    if (error) w.reject(error); else w.resolve();
    this.next();
  }

  private write(line: string) {
    try { this.connection?.send(line); } catch { this.drop("lost"); }
  }

  private receive(raw: string) {
    const text = raw.trim();
    if (!text || this.closed) return;
    if (text === PORT_OPENED) {
      if (this.state === "connecting") { clearTimeout(this.readyTimer); this.readyTimer = setTimeout(() => this.ping(), READY_MS); }
      return;
    }
    if (READY.test(text)) {
      clearTimeout(this.readyTimer);
      if (this.state === "connected") { this.rejectAll("적외선 장치가 다시 시작했어요."); this.setState("connecting"); }
      this.setState("connected");
      return;
    }
    if (this.state === "connecting" && text === "ok pong") { clearTimeout(this.readyTimer); this.setState("connected"); return; }
    if (this.state !== "connected") { this.heardOther = true; return; }
    if (text.startsWith("ok")) { this.settle(null); return; }
    if (text.startsWith("err")) { this.settle(new Error(text)); return; }
    const at = this.now();
    if (text === "RXOVF") { this.hold({ decoded: null, ticks: null, overflow: true, at }); return; }
    const ticks = text.startsWith("RXRAW") ? parseRaw(text) : null;
    if (ticks) { this.hold({ decoded: null, ticks, overflow: false, at }); return; }
    const rx = parseRx(text);
    if (!rx) return;
    if (this.held) { this.held.press.decoded = rx; this.release(); }
    else this.emit({ decoded: rx, ticks: null, overflow: false, at });
  }

  private hold(press: BridgePress) {
    this.release();
    this.held = { press, timer: setTimeout(() => this.release(), GROUP_MS) };
  }
  private release() {
    const h = this.held;
    if (!h) return;
    this.held = null;
    clearTimeout(h.timer);
    this.emit(h.press);
  }
  private emit(p: BridgePress) {
    if (p.at < this.quietUntil) return;
    for (const cb of this.pressCbs) cb(p);
  }

  private rejectAll(message: string) {
    for (const w of this.queue.splice(0)) { clearTimeout(w.timer); w.reject(new Error(message)); }
    this.quietUntil = this.now() + ECHO_MS;
  }

  private drop(state: BridgeState) {
    if (this.closed) return;
    clearTimeout(this.readyTimer);
    if (this.held) { clearTimeout(this.held.timer); this.held = null; }
    this.rejectAll(NOT_CONNECTED);
    this.setState(state);
  }

  private setState(s: BridgeState) {
    if (this.state === s) return;
    this.state = s;
    for (const cb of this.stateCbs) cb(s);
  }
}
