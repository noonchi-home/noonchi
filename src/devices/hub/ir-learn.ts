// 리모컨 단추 하나 배우기: 같은 신호를 두 번 연달아 받으면 저장한다(30초).
import { IR_LEARN_MS, type IrSignal } from "../../contract/ir.js";
import type { BridgePress, BridgeState } from "./ir-bridge.js";
import { equalSignal, sameTicks } from "./ir-remotes.js";

export interface LearnBridge {
  readonly state: BridgeState;
  onPress(cb: (p: BridgePress) => void): () => void;
  onState(cb: (s: BridgeState) => void): () => void;
  rawReport(on: boolean): Promise<void>;
}
export type LearnOutcome =
  | { state: "saved"; signal: IrSignal }
  | { state: "duplicate"; of: string }
  | { state: "timeout" | "overflow" | "lost" | "cancelled" };

const NEC_NAME = /^NEC2?$/;
export function signalOf(p: BridgePress): IrSignal | null {
  if (p.overflow) return null;
  if (p.decoded && NEC_NAME.test(p.decoded.protocol)) return { kind: "nec", address: p.decoded.address, command: p.decoded.command };
  if (p.ticks && p.ticks.length >= 4) return { kind: "raw", khz: 38, ticks: p.ticks, decoded: p.decoded };
  return null;
}
export function samePress(a: BridgePress, b: BridgePress): boolean {
  if (a.decoded && b.decoded) return a.decoded.protocol === b.decoded.protocol && a.decoded.address === b.decoded.address && a.decoded.command === b.decoded.command;
  return !!a.ticks && !!b.ticks && sameTicks(a.ticks, b.ticks);
}

export class LearnSession {
  private previous: BridgePress | null = null;
  private timer?: ReturnType<typeof setTimeout>;
  private offs: (() => void)[] = [];
  private ended = false;
  private readonly now: () => number;
  private readonly limit: number;
  private readonly started: number;

  constructor(private readonly bridge: LearnBridge, private readonly o: {
    others: readonly { label: string; signal: IrSignal }[]; done(r: LearnOutcome): void; now?: () => number; timeoutMs?: number;
  }) {
    this.now = o.now ?? (() => Date.now());
    this.limit = o.timeoutMs ?? IR_LEARN_MS;
    this.started = this.now();
  }

  get presses(): number { return this.previous ? 1 : 0; }
  leftMs(): number { return this.ended ? 0 : Math.max(0, this.started + this.limit - this.now()); }

  async start(): Promise<void> {
    if (this.bridge.state !== "connected") throw new Error("적외선 장치가 연결되지 않았어요.");
    this.offs.push(this.bridge.onPress((p) => this.press(p)), this.bridge.onState((s) => { if (s !== "connected") this.end({ state: "lost" }); }));
    this.timer = setTimeout(() => this.end({ state: "timeout" }), this.limit);
    try { await this.bridge.rawReport(true); } catch (e) { this.end({ state: "lost" }); throw e; }
  }

  cancel(): void { this.end({ state: "cancelled" }); }

  private press(p: BridgePress) {
    if (this.ended) return;
    if (p.overflow) { this.end({ state: "overflow" }); return; }
    const signal = signalOf(p);
    if (!signal) return;
    if (!this.previous || !samePress(this.previous, p)) { this.previous = p; return; }
    const twin = this.o.others.find((x) => equalSignal(x.signal, signal));
    this.end(twin ? { state: "duplicate", of: twin.label } : { state: "saved", signal });
  }

  private end(r: LearnOutcome) {
    if (this.ended) return;
    this.ended = true;
    clearTimeout(this.timer);
    for (const off of this.offs.splice(0)) off();
    void this.bridge.rawReport(false).catch(() => {});
    this.o.done(r);
  }
}
