// 기기별 신호 출처(설정 2단계 「가전 선택」). 엔진·대시보드는 이 허브로 읽고, 안쪽 허브(world)는 숨은 세계로 계속 시뮬레이션한다.
// 「신호 없음」 기기는 상태를 「모름」(빈 twin·matter, signal: "none")으로 보이고, 명령은 world에서 실행하되 결과 상태도 가린다.
// 실행할 수 있는지(문 열림 등)는 world가 자기 상태로 판단한다(구현명세서 2.19: 환경은 숨은 세계, 엔진은 공개된 믿음).
// 신호 없음 기기는 실행 결과도 알 수 없으므로, world가 상태 때문에 거절해도 「보냄」(ok, 가린 상태)으로 돌려준다(거절 이유가 숨은 상태를 드러냄).
// stop() 뒤(집을 바꿈)에는 늦게 도착한 명령을 실행하지 않는다.
// 「thinq」 기기(실제 모드에서 ThinQ와 짝지음): 상태는 ThinQ 연결(src/devices/thinq/link.ts)이 읽어 안쪽 허브에 비춘 값 + readback이고,
// 처음 읽기 전이거나 연결이 없으면 「모름」이다. 명령은 연결로 보내고, 안쪽 허브를 직접 바꾼 변화는 보내지 않는다(읽기로만 바뀜).
// 「relay」 기기(실제 모드에서 TV_RELAY_*로 짝지은 TV): TV 중계 연결(src/devices/relay/link.ts)이 thinq와 같은 방식으로 읽고 보낸다.
// 직접 적외선 TV(setInfrared, remotes.json의 TV 전원 단추)는 신호 출처가 아니라 따로 다룬다. 같은 TV에 둘을 함께 두지 않는다(서버 시작이 막는다).
// 카메라로 본 상태(observe, World State가 넘김): 실제 출처가 없으면 그 값이 기기 상태이고(vision.applied), 있으면 실제 상태를 두고 보임 기록만 붙인다.
// 실제 출처: ThinQ·중계 기기는 읽은 값이 있을 때, 가상 기기는 명령·센서 값을 한 번이라도 받은 뒤(안쪽 허브가 바뀜을 알리거나 명령이 받아짐).
// 신호 없음 기기·읽기 전 ThinQ 기기·명령 받은 적 없는 가상 기기는 실제 출처가 없다. 실제 상태와 다르면 처음 한 번만 mismatch로 알린다.

import { IrTv, type IrConfig, type IrPort } from "./ir.js";
import { AsyncLocalStorage } from "node:async_hooks";
import { HOUSEHOLD_KINDS } from "../kinds.js";
import type { PowerStamp } from "../../contract/devices.js";
import { matterFromTwin } from "../mapping.js";
import type { ThinqLink } from "../thinq/link.js";
import type { Command, CommandResult, DeviceHub, DeviceSpec, DeviceState, PressResult, Readback, SightEvidence, VisionResult } from "../../contract/devices.js";
import type { RemoteEvent } from "../../contract/ir.js";
import { compact } from "../../shared/korean.js";
import type { RemoteBrief, RemoteRuntime } from "./ir-remotes.js";

/** virtual: 트윈 시뮬레이터, none: 신호 없음, thinq: 실제 가전(ThinQ 기기 id), relay: TV 중계로 잇는 실제 TV(중계 쪽 기기 이름). */
export type SignalSource = { kind: "virtual" } | { kind: "none" } | { kind: "thinq"; deviceId: string } | { kind: "relay"; deviceId: string };
export type SignalKind = SignalSource["kind"];

/** SignalHub가 쓰는 ThinQ 연결 부분. */
export type ThinqLinkLike = Pick<ThinqLink, "readback" | "command" | "onUpdate">;
/** 실제 가전 연결(ThinQ·TV 중계)이 SignalHub에 주는 것. */
export interface RealLinkLike {
  readback(id: string): Readback | undefined;
  command(id: string, cmd: Command): Promise<CommandResult>;
  onUpdate(cb: ((id: string) => void) | null): void;
}
type RealKind = "thinq" | "relay";
const isReal = (s: SignalSource): s is Extract<SignalSource, { kind: RealKind }> => s.kind === "thinq" || s.kind === "relay";

const VIRTUAL: SignalSource = { kind: "virtual" };
const STOPPED: CommandResult = { ok: false, error: "집을 바꾸는 중이라 이 명령은 실행하지 않았어요." };
const NO_LINK: Record<RealKind, string> = { thinq: "ThinQ 연결이 없어 보내지 않았어요.", relay: "TV 중계 연결이 없어 보내지 않았어요." };
const NO_REMOTE = "이 가전에 등록한 리모컨이 없어요.";
const REMOTE_FAILED = "리모컨 신호를 보내지 못했어요.";
const POWER_BUTTON = "켜기·끄기는 turn_on·turn_off로 해요.";

const sourceKey = (s: SignalSource | undefined) => (!s ? "virtual" : isReal(s) ? `${s.kind}:${s.deviceId}` : s.kind);
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
  onPowerIntent?: (id:string, power:"on"|"off", commandId:string|null) => void;
  onPowerStamp?: (state:DeviceState) => void;
  /** 리모컨 사건: 허브가 단추 신호를 보냄(sent)·사람이 등록한 단추를 누름(pressed). 트레이스가 받는다. */
  onRemote?: (e: RemoteEvent) => void;
  /** 등록한 리모컨(IrSetup.runtime()). live면 단추 신호를 실제로 쏜다(실제 모드). */
  private remotes: { rt: RemoteRuntime; live: boolean; off: () => void } | null = null;

  /** 리모컨을 붙이거나(실제·시험 모드) 뗀다. 사람이 누른 등록 단추는 onRemote(pressed)로 알린다. */
  setRemotes(rt: RemoteRuntime | null, live: boolean): void {
    this.remotes?.off();
    this.remotes = rt && !this.stopped
      ? { rt, live, off: rt.onPressed((e) => this.onRemote?.({ kind: "pressed", ...e, at_ms: Date.now(), command_id: null })) }
      : null;
  }

  private remoteBrief(id: string): RemoteBrief | undefined {
    return this.remotes?.rt.list().find((r) => r.device === id);
  }

  /** 그 가전의 리모컨 이름과 press_remote로 누를 수 있는 단추(전원 뜻 role이 없는 것) 이름들. 그런 단추가 없으면 undefined. */
  remoteOf(id: string): { label: string; buttons: string[] } | undefined {
    const r = this.remoteBrief(id);
    const buttons = r?.buttons.filter((b) => b.role === null).map((b) => b.label) ?? [];
    return r && buttons.length ? { label: r.label, buttons } : undefined;
  }

  /** 리모컨 단추 하나를 누른다(단추는 id → 이름 → 띄어쓰기 없는 이름 차례로 찾음). 시험 모드면 쏘지 않고 sent: false.
   *  전원 뜻 단추(켜기·끄기·전원)는 쏘지 않는다: turn_on·turn_off로만 보내야 IrTv·트윈 전원이 실제와 맞는다(contract/ir.ts RemoteRole). */
  async press(id: string, button: string, commandId?: string): Promise<PressResult> {
    if (this.stopped) return { ok: false, error: STOPPED.error! };
    const r = this.remoteBrief(id);
    if (!r) return { ok: false, error: NO_REMOTE };
    const b = r.buttons.find((x) => x.id === button) ?? r.buttons.find((x) => x.label === button) ?? r.buttons.find((x) => compact(x.label) === compact(button));
    if (b?.role) return { ok: false, error: POWER_BUTTON };
    if (!b) return { ok: false, error: `리모컨에 「${button}」 단추가 없어요. 있는 단추: ${this.remoteOf(id)?.buttons.join(", ") ?? "없음"}` };
    if (!this.remotes!.live) return { ok: true, sent: false };
    return (await this.sendRemote(r, b, commandId)) ? { ok: true, sent: true } : { ok: false, error: REMOTE_FAILED };
  }

  private async sendRemote(r: RemoteBrief, b: RemoteBrief["buttons"][number], commandId: string | undefined): Promise<boolean> {
    try {
      await this.remotes!.rt.send(r.device, b.id);
    } catch {
      return false;
    }
    this.onRemote?.({ kind: "sent", device: r.device, remote: r.remote, button: b.id, role: b.role, at_ms: Date.now(), command_id: commandId ?? null });
    return true;
  }

  /** 실제 모드에서 짝 없는(가상) TV 아닌 가전의 켜기·끄기: 그 뜻 단추를 쏘고 같은 명령을 트윈에도 넣는다(트윈이 따라온다). 결과는 읽지 못해 unverified.
   *  리모컨·그 뜻 단추가 없거나 ThinQ·중계와 짝지은 가전이면 null(원래 길로 보낸다). */
  private async remoteCommand(id: string, cmd: Command, commandId: string | undefined): Promise<CommandResult | null> {
    if (!this.remotes?.live || (cmd.type !== "on" && cmd.type !== "off") || this.source(id).kind !== "virtual") return null;
    if (this.world.list().find((d) => d.id === id)?.kind === HOUSEHOLD_KINDS.viewerPower) return null;
    const r = this.remoteBrief(id);
    const b = r?.buttons.find((x) => x.role === cmd.type);
    if (!r || !b) return null;
    if (!(await this.sendRemote(r, b, commandId))) return { ok: false, outcome: "failed", error: REMOTE_FAILED, state: this.get(id) };
    const twin = await this.sendCommand(id, cmd);
    return twin.ok ? { ...twin, outcome: "unverified" } : { ok: true, outcome: "unverified", state: this.get(id) };
  }

  powerStamp(id:string):PowerStamp | undefined {
    if (!this.power.has(id)) {
      if (!this.world.list().some(d=>d.id===id && d.kind===HOUSEHOLD_KINDS.viewerPower)) return undefined;
      this.power.set(id,{power:this.powerOf(this.get(id)),generation:0,command_id:null});
    }
    return {...this.power.get(id)!};
  }
  private powerOf(state:DeviceState|undefined) {
    const p=state?.twin.power;
    return state?.online && !state.signal && !state.vision?.applied && (p==="on" || p==="off") ? p : null;
  }
  private infrared: IrTv | null = null;

  setInfrared(config: IrConfig | null, open: IrPort) {
    if (this.stopped || this.infrared?.config === config) return;
    const previous = this.infrared;
    previous?.stop();
    this.infrared = null;
    if (previous) {
      this.vision.delete(previous.config.device);
      this.emit(this.get(previous.config.device)!);
    }
    if (!config) return;
    const id = config.device;
    if (!this.list().some(d => d.id === id && d.kind === HOUSEHOLD_KINDS.viewerPower))
      throw new Error("적외선 설정의 TV를 이 집에서 찾을 수 없어요.");
    const old = this.powerStamp(id)!;
    const tv = new IrTv(config, commandId => {
      if (this.infrared !== tv) return;
      const generation = this.power.get(id)!.generation + (commandId === null ? 1 : 0);
      this.power.set(id, { power: tv.power, generation, command_id: commandId });
      this.emit(this.get(id)!);
    }, (power, commandId) => this.onPowerIntent?.(id, power, commandId));
    this.vision.delete(id);
    this.infrared = tv;
    this.power.set(id, {power:null, generation:old.generation+1, command_id:null});
    this.emit(this.get(id)!);
    tv.start(open);
  }

  private readonly links: Record<RealKind, RealLinkLike | null> = { thinq: null, relay: null };
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
      if (evidence[attr]) ev[attr] = Object.freeze({ ...evidence[attr]! }); // 넘긴 값과 나누지 않는다
      else delete ev[attr];
    }
    this.vision.set(id, { twin: { ...prev?.twin, ...seen }, atMs, evidence: ev });
    if (this.infrared?.config.device === id) {
      this.infrared.see(seen.power, atMs, evidence.power);
      return { kind: "seen" };
    }
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

  /** 실제 출처가 있는가: ThinQ·중계 기기는 읽은 값, 가상 기기는 명령·센서 값을 받은 적. */
  private real(id: string): boolean {
    const src = this.source(id);
    if (isReal(src)) return !!this.back(id, src);
    return src.kind === "virtual" && this.commanded.has(id);
  }

  /** 실제 가전 기기의 읽은 값(그 출처·기기 id와 맞을 때만). */
  private back(id: string, src: Extract<SignalSource, { kind: RealKind }>): Readback | undefined {
    const back = this.links[src.kind]?.readback(id);
    return back && back.source === src.kind && back.deviceId === src.deviceId ? back : undefined;
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
    this.attach("thinq", link);
  }

  /** TV 중계 연결을 붙이거나(실제 모드) 뗀다. relay 기기의 새 보기를 한 번 보낸다. */
  setRelay(link: RealLinkLike | null): void {
    this.attach("relay", link);
  }

  private attach(kind: RealKind, link: RealLinkLike | null): void {
    this.links[kind]?.onUpdate(null);
    this.links[kind] = link;
    link?.onUpdate((id) => {
      if (this.source(id).kind !== kind) return;
      const s = this.get(id);
      if (s) this.emit(s);
    });
    for (const [id, src] of this.map) {
      if (src.kind !== kind) continue;
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
    this.infrared?.stop();
    this.remotes?.off();
    this.remotes = null;
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
    if (this.stopped) return STOPPED;
    if (this.infrared?.config.device === id) {
      if (cmd.type !== "on" && cmd.type !== "off")
        return { ok:false, outcome:"not_sent", error:"이 TV는 전원만 조절할 수 있어요." };
      const result = await this.infrared.command(cmd.type, commandId ?? null);
      return { ...result, state: this.get(id) };
    }
    const remote = await this.remoteCommand(id, cmd, commandId);
    if (remote) return remote;
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
    this.onPowerIntent?.(id,power,commandId??null);
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
    const src = this.source(id);
    if (isReal(src)) {
      const link = this.links[src.kind];
      if (!link) return { ok: false, outcome: "not_sent", error: NO_LINK[src.kind], state: this.get(id) };
      const r = await link.command(id, cmd);
      return { ...r, state: this.view(r.state) };
    }
    const before = this.get(id);
    const r = await this.world.command(id, cmd);
    if (r.ok) this.markCommanded(id, before);
    return this.result(id, r);
  }

  async setSensor(id: string, attr: string, value: unknown): Promise<CommandResult> {
    if (this.stopped) return STOPPED;
    if (this.infrared?.config.device === id || isReal(this.source(id))) {
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
    // 신호 없음 기기의 변화는 엔진이 알 수 없으므로 보내지 않는다. thinq·relay 기기는 연결이 읽은 뒤 보낸다(setLink·setRelay).
    // 가상 기기가 바뀌었다고 알리면 명령·센서 값을 받은 것이라 실제 출처가 생긴다
    this.unsub ??= this.world.subscribe((s) => {
      if (this.infrared?.config.device === s.id || this.source(s.id).kind !== "virtual") return;
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
    const ir = this.infrared;
    if (ir?.config.device === s.id) {
      const base = { id:s.id, online:ir.online, updatedAt:new Date(ir.updatedAt).toISOString() };
      if (!ir.power) return { ...base, twin:{}, matter:{}, signal:"none" };
      return { ...base, twin:{power:ir.power}, matter:{onOff:ir.power === "on"} };
    }
    const base = this.sourceView(s);
    const v = this.vision.get(s.id);
    if (!v) return base;
    const applied = !this.real(s.id);
    // 근거 하나하나는 observe에서 얼린 사본이다: 돌려준 값을 고쳐 다음 조회의 근거를 바꿀 수 없다.
    const vision = Object.freeze({ twin: Object.freeze({ ...v.twin }), at: new Date(v.atMs).toISOString(), applied, ...(Object.keys(v.evidence).length ? { evidence: Object.freeze({ ...v.evidence }) } : {}) });
    if (!applied) return { ...base, vision };
    // 실제 출처가 없다: 본 값이 상태다. 모름으로 가린 기기는 본 속성만 안다
    const { signal, ...rest } = base;
    const twin = signal === "none" ? { ...v.twin } : { ...base.twin, ...v.twin };
    const spec = same(twin, base.twin) ? undefined : this.world.list().find((d) => d.id === s.id);
    const updatedAt = v.atMs > (Date.parse(base.updatedAt) || 0) ? vision.at : base.updatedAt;
    return { ...rest, twin, matter: spec ? matterFromTwin(spec, twin) : base.matter, updatedAt, vision };
  }

  /** 신호 출처대로 본 상태: 가상은 그대로, 읽은 ThinQ·중계는 readback을 붙이고, 그 밖은 모름. */
  private sourceView(s: DeviceState): DeviceState {
    const src = this.source(s.id);
    if (src.kind === "virtual") return s;
    if (isReal(src)) {
      const back = this.back(s.id, src);
      if (back) return { ...s, readback: back };
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
