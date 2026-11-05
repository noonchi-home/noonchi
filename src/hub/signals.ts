// 기기별 신호 출처(설정 2단계 「가전 선택」). 엔진·대시보드는 이 허브로 읽고, 안쪽 허브(world)는 숨은 세계로 계속 시뮬레이션한다.
// 「신호 없음」 기기는 상태를 「모름」(빈 twin·matter, signal: "none")으로 보이고, 명령은 world에서 실행하되 결과 상태도 가린다.
// 실행할 수 있는지(문 열림 등)는 world가 자기 상태로 판단한다(구현명세서 2.19: 환경은 숨은 세계, 엔진은 공개된 믿음).
// 신호 없음 기기는 실행 결과도 알 수 없으므로, world가 상태 때문에 거절해도 「보냄」(ok, 가린 상태)으로 돌려준다(거절 이유가 숨은 상태를 드러냄).
// stop() 뒤(집을 바꿈)에는 늦게 도착한 명령을 실행하지 않는다.

import type { Command, CommandResult, DeviceHub, DeviceSpec, DeviceState } from "./types.js";

/** 다음 단계에서 { kind: "thinq"; deviceId: string }(실제 가전 읽기 전용)을 더한다. */
export type SignalSource = { kind: "virtual" } | { kind: "none" };
export type SignalKind = SignalSource["kind"];

const VIRTUAL: SignalSource = { kind: "virtual" };
const STOPPED: CommandResult = { ok: false, error: "집을 바꾸는 중이라 이 명령은 실행하지 않았어요." };

/** 「모름」으로 가린 상태인가. */
export function isUnknown(s: DeviceState | undefined): boolean {
  return s?.signal === "none";
}

interface MatterPassThrough {
  info?: unknown;
  openCommissioningWindow?: (timeoutSeconds?: number) => Promise<unknown>;
}

export class SignalHub implements DeviceHub {
  private map = new Map<string, SignalSource>();
  private readonly listeners = new Set<(s: DeviceState) => void>();
  private unsub: (() => void) | null = null;
  private stopped = false;

  constructor(readonly world: DeviceHub, sources: Record<string, SignalSource> = {}) {
    this.map = this.normalize(sources);
  }

  source(id: string): SignalSource {
    return this.map.get(id) ?? VIRTUAL;
  }

  /** virtual이 아닌 것만. */
  sources(): Record<string, SignalSource> {
    return Object.fromEntries([...this.map].map(([id, s]) => [id, { ...s }]));
  }

  /** 출처를 통째로 바꾼다. 보기가 달라진 기기만 구독자에게 새 보기 상태를 한 번 보낸다. */
  setSources(sources: Record<string, SignalSource>): void {
    const next = this.normalize(sources);
    const changed = this.world.list().filter((d) => (this.map.get(d.id)?.kind ?? "virtual") !== (next.get(d.id)?.kind ?? "virtual"));
    this.map = next;
    for (const d of changed) {
      const s = this.get(d.id);
      if (s) this.emit(s);
    }
  }

  // Matter 허브면 /api/matter가 쓰는 값을 그대로 넘긴다
  get info(): unknown {
    return (this.world as MatterPassThrough).info;
  }

  openCommissioningWindow(timeoutSeconds?: number): Promise<unknown> {
    const fn = (this.world as MatterPassThrough).openCommissioningWindow;
    if (typeof fn !== "function") return Promise.reject(new Error("Matter 허브가 아닙니다."));
    return fn.call(this.world, timeoutSeconds);
  }

  start(): Promise<void> {
    return this.world.start();
  }

  async stop(): Promise<void> {
    this.stopped = true;
    this.unsub?.();
    this.unsub = null;
    await this.world.stop();
  }

  list(): DeviceSpec[] {
    return this.world.list();
  }

  get(id: string): DeviceState | undefined {
    return this.view(this.world.get(id));
  }

  states(): DeviceState[] {
    return this.world.states().map((s) => this.view(s)!);
  }

  async command(id: string, cmd: Command): Promise<CommandResult> {
    if (this.stopped) return STOPPED;
    return this.result(id, await this.world.command(id, cmd));
  }

  async setSensor(id: string, attr: string, value: unknown): Promise<CommandResult> {
    if (this.stopped) return STOPPED;
    return this.result(id, await this.world.setSensor(id, attr, value));
  }

  subscribe(cb: (s: DeviceState) => void): () => void {
    this.listeners.add(cb);
    // 신호 없음 기기의 변화는 엔진이 알 수 없으므로 보내지 않는다
    this.unsub ??= this.world.subscribe((s) => {
      if (this.source(s.id).kind === "virtual") this.emit(s);
    });
    return () => {
      this.listeners.delete(cb);
    };
  }

  private emit(s: DeviceState): void {
    for (const cb of this.listeners) cb(s);
  }

  private view(s: DeviceState | undefined): DeviceState | undefined {
    if (!s || this.source(s.id).kind === "virtual") return s;
    return { id: s.id, online: true, twin: {}, matter: {}, updatedAt: s.updatedAt, signal: "none" };
  }

  private result(id: string, r: CommandResult): CommandResult {
    if (!r.state) return r;
    if (this.source(id).kind !== "virtual") return { ok: true, state: this.view(r.state) };
    return { ...r, state: this.view(r.state) };
  }

  private normalize(sources: Record<string, SignalSource>): Map<string, SignalSource> {
    return new Map(Object.entries(sources).filter(([, s]) => s.kind !== "virtual").map(([id, s]) => [id, { ...s }]));
  }
}
