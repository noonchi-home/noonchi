// 기기별 신호 출처(설정 2단계 「가전 선택」). 엔진·대시보드는 이 허브로 읽고, 안쪽 허브(world)는 숨은 세계로 계속 시뮬레이션한다.
// 「신호 없음」 기기는 상태를 「모름」(빈 twin·matter, signal: "none")으로 보이고, 명령은 world에서 실행하되 결과 상태도 가린다.
// 실행할 수 있는지(문 열림 등)는 world가 자기 상태로 판단한다(구현명세서 2.19: 환경은 숨은 세계, 엔진은 공개된 믿음).
// 신호 없음 기기는 실행 결과도 알 수 없으므로, world가 상태 때문에 거절해도 「보냄」(ok, 가린 상태)으로 돌려준다(거절 이유가 숨은 상태를 드러냄).
// stop() 뒤(집을 바꿈)에는 늦게 도착한 명령을 실행하지 않는다.
// 「thinq」 기기(실제 모드에서 ThinQ와 짝지음): 상태는 ThinQ 연결(src/devices/thinq/link.ts)이 읽어 안쪽 허브에 비춘 값 + readback이고,
// 처음 읽기 전이거나 연결이 없으면 「모름」이다. 명령은 연결로 보내고, 안쪽 허브를 직접 바꾼 변화는 보내지 않는다(읽기로만 바뀜).
// 카메라로 본 상태(observe, World State가 넘김): 실제 출처가 없으면 그 값이 기기 상태이고(vision.applied), 있으면 실제 상태를 두고 보임 기록만 붙인다.
// 실제 출처: ThinQ 기기는 읽은 값이 있을 때, 가상 기기는 명령·센서 값을 한 번이라도 받은 뒤(안쪽 허브가 바뀜을 알리거나 명령이 받아짐).
// 신호 없음 기기·읽기 전 ThinQ 기기·명령 받은 적 없는 가상 기기는 실제 출처가 없다. 실제 상태와 다르면 처음 한 번만 mismatch로 알린다.

import { AsyncLocalStorage } from "node:async_hooks";
import type { PowerStamp } from "../../contract/devices.js";
import { matterFromTwin } from "../mapping.js";
import type { ThinqLink } from "../thinq/link.js";
import type { Command, CommandResult, DeviceHub, DeviceSpec, DeviceState, SightEvidence, VisionResult } from "../../contract/devices.js";

/** virtual: 트윈 시뮬레이터, none: 신호 없음, thinq: 실제 가전(ThinQ 기기 id). */
export type SignalSource = { kind: "virtual" } | { kind: "none" } | { kind: "thinq"; deviceId: string };
export type SignalKind = SignalSource["kind"];

/** SignalHub가 쓰는 ThinQ 연결 부분. */
export type ThinqLinkLike = Pick<ThinqLink, "readback" | "command" | "onUpdate">;

const VIRTUAL: SignalSource = { kind: "virtual" };
const STOPPED: CommandResult = { ok: false, error: "집을 바꾸는 중이라 이 명령은 실행하지 않았어요." };
const NO_LINK = "ThinQ 연결이 없어 보내지 않았어요.";

const sourceKey = (s: SignalSource | undefined) => (!s ? "virtual" : s.kind === "thinq" ? `thinq:${s.deviceId}` : s.kind);
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
/** 알릴 만큼 바뀐 보기인가: 마지막 본 시각(vision.at)·updatedAt만 바뀐 것은 아니다. */
const shown = (s: DeviceState | undefined) => s && JSON.stringify([s.twin, s.signal ?? null, s.online, s.vision ? [s.vision.twin, s.vision.applied] : null]);

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
  private readonly power = new Map<string,PowerStamp>();
  private readonly sending = new AsyncLocalStorage<{id:string; generation:number; power:"on"|"off"}>();
  onPowerStamp?: (state:DeviceState) => void;

  powerStamp(id:string):PowerStamp | undefined {
    if (!this.power.has(id)) {
      if (!this.world.list().some(d=>d.id===id && d.kind==="tv")) return undefined;
      this.power.set(id,{power:this.powerOf(this.get(id)),generation:0,command_id:null});
    }
    return {...this.power.get(id)!};
  }
  private powerOf(state:DeviceState|undefined) {
    const p=state?.twin.power;
    return state?.online && !state.signal && !state.vision?.applied && (p==="on" || p==="off") ? p : null;
  }
  private link: ThinqLinkLike | null = null;
  /** 카메라로 본 트윈 속성 값과 마지막으로 본 촬영 시각. */
  private readonly vision = new Map<string, { twin: Record<string, unknown>; atMs: number; evidence: Record<string, SightEvidence> }>();
  /** 명령·센서 값을 받은 가상 기기(실제 출처가 생김). */
  private readonly commanded = new Set<string>();
  /** 이미 알린 다름(기기마다 본 값·실제 값). 같아지면 지운다. */
  private readonly mismatch = new Map<string, string>();

  constructor(readonly world: DeviceHub, sources: Record<string, SignalSource> = {}) {
    this.map = this.normalize(sources);
  }

  /**
   * 카메라로 본 상태(World State가 같은 값을 연속으로 본 뒤 넘긴다). 그 기기에 있는 속성·값만 받는다.
   * 실제 출처가 없으면 그 값이 기기 상태가 되고(보기가 바뀌면 알린다), 있으면 실제 상태를 두고 보임 기록만 남긴다.
   */
  observe(id: string, twin: Record<string, unknown>, atMs: number, evidence: Record<string, SightEvidence> = {}): VisionResult {
    const spec = this.stopped ? undefined : this.world.list().find((d) => d.id === id);
    const seen = spec ? Object.fromEntries(Object.entries(twin).filter(([attr, v]) => (spec.twinAttrs[attr] ?? []).some((x) => same(x, v)))) : {};
    if (!spec || !Object.keys(seen).length) return { kind: "ignored" };
    const before = this.get(id);
    const prev = this.vision.get(id);
    if (prev && atMs < prev.atMs) return { kind: "seen" }; // 늦게 온 앞선 사진
    // 근거는 이번에 본 속성마다 새로 쓴다(근거 없이 온 속성은 옛 근거를 지운다)
    const ev: Record<string, SightEvidence> = { ...prev?.evidence };
    for (const attr of Object.keys(seen)) {
      if (evidence[attr]) ev[attr] = evidence[attr]!;
      else delete ev[attr];
    }
    this.vision.set(id, { twin: { ...prev?.twin, ...seen }, atMs, evidence: ev });
    const after = this.get(id);
    if (after && shown(after) !== shown(before)) this.emit(after);
    if (!this.real(id)) {
      this.mismatch.delete(id);
      return { kind: "applied" };
    }
    const real = after?.twin ?? {};
    const differ = Object.keys(seen).filter((attr) => !same(real[attr], seen[attr]));
    if (!differ.length) {
      this.mismatch.delete(id);
      return { kind: "seen" };
    }
    const key = JSON.stringify(differ.map((attr) => [attr, seen[attr], real[attr]]));
    if (this.mismatch.get(id) === key) return { kind: "seen" };
    this.mismatch.set(id, key);
    return { kind: "mismatch", real: Object.fromEntries(differ.map((attr) => [attr, real[attr]])) };
  }

  /** 실제 출처가 있는가: ThinQ 기기는 읽은 값, 가상 기기는 명령·센서 값을 받은 적. */
  private real(id: string): boolean {
    const src = this.source(id);
    if (src.kind === "thinq") {
      const back = this.link?.readback(id);
      return !!back && back.deviceId === src.deviceId;
    }
    return src.kind === "virtual" && this.commanded.has(id);
  }

  /** 가상 기기가 명령·센서 값을 받았다: 카메라로 본 상태였으면 실제 상태로 바뀐 보기를 알린다(안쪽 허브는 값이 같으면 알리지 않는다). */
  private markCommanded(id: string, before: DeviceState | undefined): void {
    if (this.source(id).kind !== "virtual" || this.commanded.has(id)) return;
    this.commanded.add(id);
    const after = this.get(id);
    if (after && shown(after) !== shown(before)) this.emit(after);
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
    const changed = this.world.list().filter((d) => sourceKey(this.map.get(d.id)) !== sourceKey(next.get(d.id)));
    this.map = next;
    for (const d of changed) {
      const s = this.get(d.id);
      if (s) this.emit(s);
    }
  }

  /** ThinQ 연결을 붙이거나(실제 모드) 뗀다(시험 모드). thinq 기기의 새 보기를 한 번 보낸다. */
  setLink(link: ThinqLinkLike | null): void {
    this.link?.onUpdate(null);
    this.link = link;
    link?.onUpdate((id) => {
      if (this.source(id).kind !== "thinq") return;
      const s = this.get(id);
      if (s) this.emit(s);
    });
    for (const [id, src] of this.map) {
      if (src.kind !== "thinq") continue;
      const s = this.get(id);
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

  async command(id: string, cmd: Command, commandId?:string): Promise<CommandResult> {
    const stamp = this.powerStamp(id);
    if (!stamp || (cmd.type!=="on" && cmd.type!=="off") || this.stopped) return this.sendCommand(id,cmd);
    if (!commandId) {
      stamp.generation++;
      stamp.command_id=null;
      this.power.set(id,stamp);
      const state=this.get(id);
      if (state) this.onPowerStamp?.(state); // An unchanged manual request still revokes ownership.
    }
    const power=cmd.type;
    const result=await this.sending.run({id,generation:stamp.generation,power},()=>this.sendCommand(id,cmd));
    const current=this.power.get(id)!;
    if (commandId && current.generation===stamp.generation && result.ok && result.outcome!=="unverified" &&
        this.powerOf(result.state)===power && this.powerOf(this.get(id))===power && !this.stopped) {
      this.power.set(id,{generation:stamp.generation,command_id:commandId,power});
      this.onPowerStamp?.(result.state!);
    }
    return result;
  }

  private async sendCommand(id: string, cmd: Command): Promise<CommandResult> {
    if (this.stopped) return STOPPED;
    if (this.source(id).kind === "thinq") {
      if (!this.link) return { ok: false, outcome: "not_sent", error: NO_LINK, state: this.get(id) };
      const r = await this.link.command(id, cmd);
      return { ...r, state: this.view(r.state) };
    }
    const before = this.get(id);
    const r = await this.world.command(id, cmd);
    if (r.ok) this.markCommanded(id, before);
    return this.result(id, r);
  }

  async setSensor(id: string, attr: string, value: unknown): Promise<CommandResult> {
    if (this.stopped) return STOPPED;
    if (this.source(id).kind === "thinq") {
      const label = this.world.list().find((d) => d.id === id)?.label ?? id;
      return { ok: false, error: `${label}: 실제 가전 값이라 바꿀 수 없어요.`, state: this.get(id) };
    }
    const before = this.get(id);
    const r = await this.world.setSensor(id, attr, value);
    if (r.ok) this.markCommanded(id, before);
    return this.result(id, r);
  }

  subscribe(cb: (s: DeviceState) => void): () => void {
    this.listeners.add(cb);
    // 신호 없음 기기의 변화는 엔진이 알 수 없으므로 보내지 않는다. thinq 기기는 연결이 읽은 뒤 보낸다(setLink).
    // 가상 기기가 바뀌었다고 알리면 명령·센서 값을 받은 것이라 실제 출처가 생긴다
    this.unsub ??= this.world.subscribe((s) => {
      if (this.source(s.id).kind !== "virtual") return;
      this.commanded.add(s.id);
      this.emit(this.view(s)!);
    });
    return () => {
      this.listeners.delete(cb);
    };
  }

  private emit(s: DeviceState): void {
    const stamp=this.power.get(s.id);
    const power=this.powerOf(s);
    if (stamp && stamp.power!==power) {
      const sending=this.sending.getStore();
      const correlated=sending?.id===s.id && sending.generation===stamp.generation && sending.power===power;
      this.power.set(s.id,{power,generation:stamp.generation+(correlated ? 0 : 1),command_id:null});
    }
    for (const cb of this.listeners) cb(s);
  }

  private view(s: DeviceState | undefined): DeviceState | undefined {
    if (!s) return s;
    const base = this.sourceView(s);
    const v = this.vision.get(s.id);
    if (!v) return base;
    const applied = !this.real(s.id);
    const vision = { twin: { ...v.twin }, at: new Date(v.atMs).toISOString(), applied, ...(Object.keys(v.evidence).length ? { evidence: { ...v.evidence } } : {}) };
    if (!applied) return { ...base, vision };
    // 실제 출처가 없다: 본 값이 상태다. 모름으로 가린 기기는 본 속성만 안다
    const { signal, ...rest } = base;
    const twin = signal === "none" ? { ...v.twin } : { ...base.twin, ...v.twin };
    const spec = same(twin, base.twin) ? undefined : this.world.list().find((d) => d.id === s.id);
    const updatedAt = v.atMs > (Date.parse(base.updatedAt) || 0) ? vision.at : base.updatedAt;
    return { ...rest, twin, matter: spec ? matterFromTwin(spec, twin) : base.matter, updatedAt, vision };
  }

  /** 신호 출처대로 본 상태: 가상은 그대로, 읽은 ThinQ는 readback을 붙이고, 그 밖은 모름. */
  private sourceView(s: DeviceState): DeviceState {
    const src = this.source(s.id);
    if (src.kind === "virtual") return s;
    if (src.kind === "thinq") {
      const back = this.link?.readback(s.id);
      if (back && back.deviceId === src.deviceId) return { ...s, readback: back };
    }
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
