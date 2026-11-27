// 적외선 리모컨 설정 API 본체(/api/setup/ir*, 계약 src/contract/ir.ts). 보드 연결(IrBridge)은 여기서 하나만 연다.
// 배우기·시험 쏘기는 두 모드 모두 되고, TV 전원(IrTv)과 리모컨 단추 보내기는 start.ts가 실제 모드에서만 붙인다.
// attach·detach는 changed()를 부르지 않는다(집을 여는 중이라 start.ts가 곧 applyControl을 부른다).
// 저장·포트 고르기(setPort·saveRemote·deleteRemote·배우기 저장·deleteButton·preset) 뒤에는 changed()로 TV 설정과 리모컨 단추를 다시 붙이게 한다.
import { existsSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { IR_LABEL_MAX, IR_PRESETS, REMOTE_ROLES } from "../shared/ir.js";
import type {
  IrDeviceChoice, IrFirmware, IrLearnView, IrPortChoice, IrPortState, IrPortsView,
  IrRemoteView, IrSignal, IrTestView, IrView, RemoteRole,
} from "../contract/ir.js";
import { remoteKind, HOUSEHOLD_KINDS } from "../devices/kinds.js";
import {
  IrBridge, LearnSession, codeOf, equalSignal, fakeBoard, findPort, loadRemotes, newId, pressMatches, probePort, saveRemotes, tvConfigOf, tvPort,
  type BridgePress, type BridgeState, type ButtonEntry, type FakeBoard, type IrConfig, type IrPort, type LearnOutcome,
  type RemoteBrief, type RemoteEntry, type RemoteRuntime, type RemotesFile, type SerialPortInfo,
} from "../devices/index.js";
import { HttpError } from "./app.js";

export interface IrDevice { id: string; label: string; roomLabel: string; kind: string }
export interface IrSetupOptions {
  runtimeDir: string;
  open: IrPort;
  listPorts: () => Promise<SerialPortInfo[]>;
  /** IR_FAKE=1: 포트 목록에 FAKE(가짜 보드)를 더한다. */
  fake: boolean;
  mode: () => "test" | "live";
  /** TV 중계로 켜고 끄는 TV(TV_RELAY_DEVICE). 이 TV 리모컨에는 전원 단추를 넣지 않는다(시작할 때 TvSetupConflict가 된다). */
  relayTv: string | null;
  changed: () => void;
  log: (line: string) => void;
  now?: () => number;
}

const FAKE = "FAKE";
const FAKE_LABEL = "가상 적외선 장치";
const ROLE_LABEL: Record<NonNullable<RemoteRole>, string> = { on: "켜기", off: "끄기", toggle: "전원" };
/** lg_tv_power: LG TV 켜기·끄기 전용 NEC 신호(주소 0x04, 명령 0xC4·0xC5). */
const LG_TV_POWER: { label: string; role: NonNullable<RemoteRole>; signal: IrSignal }[] = [
  { label: "켜기", role: "on", signal: { kind: "nec", address: 0x04, command: 0xc4 } },
  { label: "끄기", role: "off", signal: { kind: "nec", address: 0x04, command: 0xc5 } },
];
const FIRMWARE_OF: Record<IrPortState, IrFirmware> = {
  connected: "ir_bridge", wrong_firmware: "other", busy: "in_use",
  silent: "silent", lost: "silent", missing: "silent", connecting: "silent", none: "silent",
};

const E = {
  body: "요청 내용을 확인해 주세요.",
  label: "이름은 1~20자로 넣어 주세요.",
  noDevice: "트윈에 없는 가전이에요.",
  notAllowed: "리모컨을 달 수 없는 가전이에요.",
  taken: "이 가전에는 이미 리모컨이 있어요.",
  tvOnly: "TV 리모컨에만 넣을 수 있어요.",
  noPort: "포트 목록에 없는 포트예요.",
  confirm: "실제 가전에 보내려면 한 번 더 확인해 주세요.",
  noRemote: "리모컨을 찾을 수 없어요.",
  noButton: "단추를 찾을 수 없어요.",
  otherHome: "허브에서 열린 집을 다시 확인해 주세요.",
  learning: "이미 단추를 배우는 중이에요.",
  notConnected: "적외선 장치가 연결되지 않았어요.",
  sendFailed: "신호를 보내지 못했어요.",
  relayTv: "이 TV는 TV 중계로 켜고 꺼요. 전원 단추는 넣을 수 없어요.",
} as const;
const roleTaken = (button: string, role: NonNullable<RemoteRole>) => `「${button}」 단추가 이미 ${ROLE_LABEL[role]} 단추예요.`;

const home = z.string().min(1);
const id = z.string().min(1);
const role = z.enum(REMOTE_ROLES).nullable();
const bodies = {
  port: z.object({ home, port: z.string().min(1) }),
  remote: z.object({ home, id: id.optional(), label: z.string(), device: id }),
  remoteDelete: z.object({ home, id }),
  learn: z.object({ home, remote: id, label: z.string(), role }),
  home: z.object({ home }),
  button: z.object({ home, remote: id, button: id }),
  test: z.object({ home, remote: id, button: id, confirm: z.literal(true) }),
  preset: z.object({ home, remote: id, preset: z.enum(IR_PRESETS) }),
};

function parse<T>(schema: z.ZodType<T>, body: unknown): T {
  const r = schema.safeParse(body);
  if (!r.success) throw new HttpError(400, E.body);
  return r.data;
}
function labelOf(raw: string): string {
  const label = raw.trim();
  if (!label || label.length > IR_LABEL_MAX) throw new HttpError(400, E.label);
  return label;
}

interface Learning { remote: string; label: string; role: RemoteRole; session: LearnSession | null; view: IrLearnView }

export class IrSetup {
  private home: { id: string; devices: readonly IrDevice[] } | null = null;
  private file: RemotesFile = { version: 1, port: null, remotes: [] };
  private bridge: IrBridge | null = null;
  private offs: (() => void)[] = [];
  private portName: string | null = null;
  private portState: IrPortState = "none";
  private learning: Learning | null = null;
  private fakeOne: FakeBoard | null = null;
  /** 저장할 때마다 +1(판 번호). */
  private version = 0;
  /** 보드를 새로 열 때마다 +1(연결 번호). */
  private link = 0;
  private tvCache: { version: number; link: number; config: IrConfig | null } | null = null;
  private readonly pressed = new Set<(e: { device: string; remote: string; button: string; role: RemoteRole }) => void>();
  private readonly tvOpen: IrPort;
  private readonly rt: RemoteRuntime;
  private readonly now: () => number;

  constructor(private readonly o: IrSetupOptions) {
    this.now = o.now ?? (() => Date.now());
    this.tvOpen = tvPort(() => this.bridge,
      (code) => this.tvRemote()?.buttons.find((b) => codeOf(b.id) === code)?.signal,
      (p) => { const b = this.tvRemote()?.buttons.find((x) => x.role && pressMatches(x.signal, p)); return b && codeOf(b.id); });
    this.rt = {
      list: () => this.visible().map((r): RemoteBrief => ({ device: r.device, remote: r.id, label: r.label,
        buttons: r.buttons.map((b) => ({ id: b.id, label: b.label, role: b.role })) })),
      send: async (device, button) => {
        const b = this.visible().find((r) => r.device === device)?.buttons.find((x) => x.id === button);
        if (!b) throw new Error(E.noButton);
        if (!this.bridge || this.bridge.state !== "connected") throw new Error(E.notConnected);
        await this.bridge.send(b.signal);
      },
      onPressed: (cb) => { this.pressed.add(cb); return () => { this.pressed.delete(cb); }; },
    };
  }

  /** 집을 연다: remotes.json을 읽고 저장한 포트(USB 장치 id로 지금 COM을 찾음)를 연다. 포트 목록을 못 읽어도 던지지 않는다(missing). */
  async attach(h: { id: string; devices: readonly IrDevice[] }): Promise<void> {
    this.detach();
    this.home = h;
    try {
      this.file = loadRemotes(this.o.runtimeDir, h.id);
    } catch (e) {
      this.home = null;
      throw new Error(`리모컨 설정(remotes.json)을 읽지 못했어요: ${(e as Error).message}`);
    }
    this.version++;
    if (existsSync(join(this.o.runtimeDir, "homes", h.id, "ir.json")))
      this.o.log("[경고] ir.json은 더 읽지 않아요. 앱 「가전 연결 → 리모컨 등록」에서 다시 등록해 주세요.");
    for (const r of this.file.remotes)
      if (!h.devices.some((d) => d.id === r.device)) this.o.log(`[경고] 리모컨 ${r.id}의 가전 ${r.device}가 이 집에 없어요.`);
    const saved = this.file.port;
    if (!saved) return;
    this.portName = saved.name;
    if (saved.name === FAKE) {
      if (this.o.fake) this.openBridge(FAKE);
      else this.portState = "missing";
      return;
    }
    let ports: SerialPortInfo[];
    try {
      ports = await this.o.listPorts();
    } catch (e) {
      this.o.log(`[경고] 직렬 포트 목록을 읽지 못해 적외선 장치를 열지 않았어요: ${(e as Error).message}`);
      this.portState = "missing";
      return;
    }
    if (this.home !== h) return;
    const found = findPort(ports, saved);
    if (!found) { this.portState = "missing"; return; }
    if (found.name !== saved.name) {
      this.file = { ...this.file, port: { name: found.name, pnp: saved.pnp } };
      this.write();
    }
    this.portName = found.name;
    this.openBridge(found.name);
  }

  /** 집을 닫는다: 배우기를 멈추고(저장 안 함) 보드 연결을 닫는다. */
  detach(): void {
    this.stopLearning();
    this.learning = null;
    this.closeBridge();
    this.home = null;
    this.file = { version: 1, port: null, remotes: [] };
    this.portName = null;
    this.portState = "none";
  }

  view(): IrView {
    const h = this.home;
    const remotes = this.visible().map((r): IrRemoteView => {
      const d = h!.devices.find((x) => x.id === r.device)!;
      return { id: r.id, label: r.label, device: r.device, deviceLabel: d.label, roomLabel: d.roomLabel, deviceKind: d.kind,
        buttons: r.buttons.map((b) => ({ id: b.id, label: b.label, role: b.role, signal: b.signal.kind })) };
    });
    const taken = new Set(this.file.remotes.map((r) => r.device));
    const devices: IrDeviceChoice[] = (h?.devices ?? []).filter((d) => this.allowed(d.kind) && !taken.has(d.id))
      .map((d) => ({ id: d.id, label: d.label, roomLabel: d.roomLabel, kind: d.kind }));
    return { ok: true, home: h?.id ?? "", mode: this.o.mode(), port: { name: this.portName, state: this.portState },
      remotes, learning: this.learnView(), devices };
  }

  async ports(): Promise<IrPortsView> {
    let listed: SerialPortInfo[];
    try {
      listed = await this.o.listPorts();
    } catch (e) {
      this.o.log(`[경고] 직렬 포트 목록을 읽지 못했어요: ${(e as Error).message}`);
      listed = [];
    }
    const ports: IrPortChoice[] = [];
    for (const p of listed) ports.push({ name: p.name, label: p.label, firmware: this.held(p.name) ?? await probePort(this.o.open, p.name) });
    if (this.o.fake) ports.push({ name: FAKE, label: FAKE_LABEL, firmware: this.held(FAKE) ?? "ir_bridge" });
    return { ok: true, ports };
  }

  async setPort(body: unknown): Promise<IrView> {
    const b = parse(bodies.port, body);
    this.requireHome(b.home);
    let info: SerialPortInfo | null = null;
    if (b.port === FAKE) {
      if (!this.o.fake) throw new HttpError(400, E.noPort);
    } else {
      let listed: SerialPortInfo[];
      try { listed = await this.o.listPorts(); } catch { listed = []; }
      info = listed.find((p) => p.name === b.port) ?? null;
      if (!info) throw new HttpError(400, E.noPort);
    }
    this.requireHome(b.home);
    this.stopLearning();
    this.closeBridge();
    this.file = { ...this.file, port: { name: b.port, pnp: info?.pnp ?? null } };
    this.write();
    this.portName = b.port;
    this.openBridge(b.port);
    this.o.changed();
    return this.view();
  }

  saveRemote(body: unknown): IrView {
    const b = parse(bodies.remote, body);
    this.requireHome(b.home);
    const label = labelOf(b.label);
    const device = this.home!.devices.find((d) => d.id === b.device);
    if (!device) throw new HttpError(400, E.noDevice);
    if (!this.allowed(device.kind)) throw new HttpError(400, E.notAllowed);
    if (this.file.remotes.some((r) => r.device === b.device && r.id !== b.id)) throw new HttpError(400, E.taken);
    let remotes: RemoteEntry[];
    if (b.id) {
      const moved = this.visible().find((r) => r.id === b.id);
      if (!moved) throw new HttpError(404, E.noRemote);
      // 전원 단추가 있는 리모컨을 중계 TV로 옮기면 다음 시작이 TvSetupConflict로 막힌다
      if (moved.buttons.some((x) => x.role)) this.requirePowerAllowed(b.device);
      remotes = this.file.remotes.map((r) => (r.id === b.id ? { ...r, label, device: b.device } : r));
    } else remotes = [...this.file.remotes, { id: newId("r"), label, device: b.device, buttons: [] }];
    this.file = { ...this.file, remotes };
    this.write();
    this.o.changed();
    return this.view();
  }

  deleteRemote(body: unknown): IrView {
    const b = parse(bodies.remoteDelete, body);
    this.requireHome(b.home);
    if (!this.visible().some((r) => r.id === b.id)) throw new HttpError(404, E.noRemote);
    if (this.learning?.remote === b.id) { this.stopLearning(); this.learning = null; }
    this.file = { ...this.file, remotes: this.file.remotes.filter((r) => r.id !== b.id) };
    this.write();
    this.o.changed();
    return this.view();
  }

  async learn(body: unknown): Promise<IrView> {
    const b = parse(bodies.learn, body);
    this.requireHome(b.home);
    const label = labelOf(b.label);
    const remote = this.visible().find((r) => r.id === b.remote);
    if (!remote) throw new HttpError(404, E.noRemote);
    if (b.role) this.requirePowerAllowed(remote.device);
    const clash = b.role && remote.buttons.find((x) => x.role === b.role && x.label !== label);
    if (clash) throw new HttpError(400, roleTaken(clash.label, b.role!));
    if (this.learning?.session) throw new HttpError(409, E.learning);
    const bridge = this.bridge;
    if (!bridge || bridge.state !== "connected") throw new HttpError(409, E.notConnected);
    const entry: Learning = { remote: remote.id, label, role: b.role, session: null,
      view: { remote: remote.id, label, role: b.role, state: "waiting", presses: 0, left_ms: 0 } };
    const session = new LearnSession(bridge, {
      others: remote.buttons.filter((x) => x.label !== label).map((x) => ({ label: x.label, signal: x.signal })),
      done: (r) => this.learned(entry, r),
      now: this.now,
    });
    entry.session = session;
    this.learning = entry;
    try {
      await session.start();
    } catch {
      if (this.learning === entry) this.learning = null;
      throw new HttpError(bridge.state === "connected" ? 502 : 409, bridge.state === "connected" ? E.sendFailed : E.notConnected);
    }
    return this.view();
  }

  cancelLearn(body: unknown): IrView {
    const b = parse(bodies.home, body);
    this.requireHome(b.home);
    this.stopLearning();
    return this.view();
  }

  deleteButton(body: unknown): IrView {
    const b = parse(bodies.button, body);
    this.requireHome(b.home);
    const remote = this.visible().find((r) => r.id === b.remote);
    if (!remote) throw new HttpError(404, E.noRemote);
    if (!remote.buttons.some((x) => x.id === b.button)) throw new HttpError(404, E.noButton);
    this.replace(remote.id, remote.buttons.filter((x) => x.id !== b.button));
    this.o.changed();
    return this.view();
  }

  async test(body: unknown): Promise<IrTestView> {
    // 확인(confirm: true)은 본문 모양보다 먼저 본다: 앱이 확인 창을 거치지 않은 요청을 그 까닭으로 알린다
    if (typeof body !== "object" || body === null || (body as { confirm?: unknown }).confirm !== true) throw new HttpError(400, E.confirm);
    const b = parse(bodies.test, body);
    this.requireHome(b.home);
    const remote = this.visible().find((r) => r.id === b.remote);
    if (!remote) throw new HttpError(404, E.noRemote);
    const button = remote.buttons.find((x) => x.id === b.button);
    if (!button) throw new HttpError(404, E.noButton);
    const bridge = this.bridge;
    if (!bridge || bridge.state !== "connected") throw new HttpError(409, E.notConnected);
    try {
      await bridge.send(button.signal);
    } catch (e) {
      this.o.log(`[경고] 적외선 신호를 보내지 못했어요: ${(e as Error).message}`);
      throw new HttpError(502, E.sendFailed);
    }
    return { ok: true, sent: true };
  }

  preset(body: unknown): IrView {
    const b = parse(bodies.preset, body);
    this.requireHome(b.home);
    const remote = this.visible().find((r) => r.id === b.remote);
    if (!remote) throw new HttpError(404, E.noRemote);
    if (this.home!.devices.find((d) => d.id === remote.device)?.kind !== HOUSEHOLD_KINDS.viewerPower) throw new HttpError(400, E.tvOnly);
    this.requirePowerAllowed(remote.device);
    const added: ButtonEntry[] = [];
    for (const p of LG_TV_POWER) {
      const role = remote.buttons.find((x) => x.role === p.role);
      if (role) throw new HttpError(400, roleTaken(role.label, p.role));
      const same = remote.buttons.find((x) => x.label === p.label || equalSignal(x.signal, p.signal));
      if (same) throw new HttpError(400, `「${same.label}」 단추가 이미 있어요.`);
      added.push({ id: newId("b"), label: p.label, role: p.role, signal: p.signal, learned_at: new Date(this.now()).toISOString() });
    }
    this.replace(remote.id, [...remote.buttons, ...added]);
    this.o.changed();
    return this.view();
  }

  /** 트윈 TV 리모컨의 전원 뜻 단추 → IrTv 설정. 연결과 상관없이 파일로 만든다.
   *  같은 연결에서 내용이 같으면 앞 객체를 그대로 준다(SignalHub.setInfrared가 IrTv를 다시 만들지 않는다): TV와 상관없는 저장이
   *  확인을 기다리던 TV 명령을 끊지 않게. 보드를 다시 열면(link) 새 객체라 IrTv도 새로 연다. */
  tvConfig(): IrConfig | null {
    const c = this.tvCache;
    if (c && c.version === this.version && c.link === this.link) return c.config;
    const made = this.home ? tvConfigOf({ ...this.file, remotes: this.visible() }, this.home.devices) : null;
    const config = c && c.link === this.link && JSON.stringify(c.config) === JSON.stringify(made) ? c.config : made;
    this.tvCache = { version: this.version, link: this.link, config };
    return config;
  }

  tvPort(): IrPort { return this.tvOpen; }
  runtime(): RemoteRuntime { return this.rt; }

  /** 보드가 연결됐고 단추가 있는 리모컨이 있다. */
  ready(): boolean {
    return this.portState === "connected" && this.visible().some((r) => r.buttons.length > 0);
  }

  /** 저장한 포트와 단추가 있는 리모컨이 있다(연결 전에도: 시작할 때 실제 모드를 지킬지 본다). */
  hasRemotes(): boolean {
    return this.file.port !== null && this.visible().some((r) => r.buttons.length > 0);
  }

  private allowed(kind: string): boolean {
    return remoteKind(kind);
  }

  /** 이 집 트윈에 있는 가전의 리모컨만(없는 가전의 리모컨은 파일에 두고 보이지 않는다). */
  private visible(): RemoteEntry[] {
    const h = this.home;
    return h ? this.file.remotes.filter((r) => h.devices.some((d) => d.id === r.device)) : [];
  }

  private tvRemote(): RemoteEntry | undefined {
    const tv = this.tvConfig();
    return tv ? this.visible().find((r) => r.device === tv.device) : undefined;
  }

  private requireHome(id: string) {
    if (!this.home || this.home.id !== id) throw new HttpError(409, E.otherHome);
  }

  /** 중계 TV(relayTv)의 리모컨이면 전원 단추를 받지 않는다. */
  private requirePowerAllowed(device: string) {
    if (device === this.o.relayTv) throw new HttpError(409, E.relayTv);
  }

  private held(name: string): IrFirmware | undefined {
    return this.bridge && this.portName === name ? FIRMWARE_OF[this.portState] : undefined;
  }

  private write() {
    saveRemotes(this.o.runtimeDir, this.home!.id, this.file);
    this.version++;
  }

  private replace(remote: string, buttons: ButtonEntry[]) {
    this.file = { ...this.file, remotes: this.file.remotes.map((r) => (r.id === remote ? { ...r, buttons } : r)) };
    try {
      this.write();
    } catch (e) {
      this.file = loadRemotes(this.o.runtimeDir, this.home!.id);
      throw e;
    }
  }

  private openBridge(name: string) {
    const open = name === FAKE ? (this.fakeOne ??= fakeBoard({ autoPressMs: 1200 })).port : this.o.open;
    const bridge = new IrBridge(open, name, this.now);
    this.bridge = bridge;
    this.link++;
    this.portState = "connecting";
    this.offs.push(
      bridge.onState((s: BridgeState) => { if (this.bridge === bridge) this.portState = s; }),
      bridge.onPress((p) => this.press(p)),
    );
    bridge.start();
  }

  private closeBridge() {
    for (const off of this.offs.splice(0)) off();
    const b = this.bridge;
    this.bridge = null;
    b?.close();
  }

  /** 사람이 누른 단추: 등록 단추와 맞으면 알린다. 배우는 중에는 알리지 않는다. */
  private press(p: BridgePress) {
    if (this.learning?.session) return;
    for (const r of this.visible()) {
      const b = r.buttons.find((x) => pressMatches(x.signal, p));
      if (!b) continue;
      for (const cb of this.pressed) cb({ device: r.device, remote: r.id, button: b.id, role: b.role });
      return;
    }
  }

  private learnView(): IrLearnView | null {
    const l = this.learning;
    if (!l) return null;
    if (!l.session) return l.view;
    return { ...l.view, presses: l.session.presses, left_ms: l.session.leftMs() };
  }

  private stopLearning() {
    this.learning?.session?.cancel();
  }

  private learned(entry: Learning, r: LearnOutcome) {
    const presses = entry.session?.presses ?? 0;
    entry.session = null;
    if (this.learning !== entry) return;
    const base = { remote: entry.remote, label: entry.label, role: entry.role, presses, left_ms: 0 };
    if (r.state !== "saved") {
      entry.view = { ...base, state: r.state, ...(r.state === "duplicate" ? { duplicate_of: r.of } : {}) };
      return;
    }
    const remote = this.visible().find((x) => x.id === entry.remote);
    if (!remote) { entry.view = { ...base, state: "cancelled" }; return; }
    const twin = remote.buttons.find((x) => x.label !== entry.label && equalSignal(x.signal, r.signal));
    if (twin) { entry.view = { ...base, state: "duplicate", duplicate_of: twin.label }; return; }
    const at = new Date(this.now()).toISOString();
    const old = remote.buttons.find((x) => x.label === entry.label);
    const id = old?.id ?? newId("b");
    const button: ButtonEntry = { id, label: entry.label, role: entry.role, signal: r.signal, learned_at: at };
    try {
      this.replace(remote.id, old ? remote.buttons.map((x) => (x.id === id ? button : x)) : [...remote.buttons, button]);
    } catch (e) {
      this.o.log(`[경고] 배운 단추를 저장하지 못했어요: ${(e as Error).message}`);
      entry.view = { ...base, state: "cancelled" };
      return;
    }
    entry.view = { ...base, state: "saved", button: id };
    this.o.changed();
  }
}
