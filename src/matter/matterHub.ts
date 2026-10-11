// MatterHub: DeviceHub를 matter.js로 구현한다. 상태의 원천은 Matter 속성이고 twin 상태는 매핑으로 계산한다.
//   transport "network": 브리지(ServerNode)를 네트워크에 올리고, 컨트롤러가 페어링 코드로 커미셔닝한 뒤
//                        Matter Read/Write/Invoke/Subscribe로 다룬다. 커미셔닝은 저장 폴더에 남아 재시작 때 다시 쓴다.
//   transport "local":   네트워크 없이 같은 프로세스의 브리지 엔드포인트를 behavior API로 직접 다룬다(Matter 데이터 모델은 같음).
// 센서(문 열림)는 두 모드 모두 브리지 쪽 속성(BooleanState.stateValue)에 직접 쓴다.

import type { ClientNode, Endpoint, ServerNode } from "@matter/main";
import { resolve } from "node:path";
import type { TwinData } from "../model/devices.js";
import {
  checkCommand,
  defaultTwinValue,
  matterFromCommand,
  matterFromTwin,
  normalizeCommand,
  summaryFromClusters,
  twinFromMatter,
  type MatterSummary,
} from "../model/mapping.js";
import type { Command, CommandResult, DeviceHub, DeviceSpec, DeviceState } from "../hub/types.js";
import { BRIDGE_DEFAULTS, createBridge, formatPairingInfo, type MatterBridge, type PairingInfo } from "./bridge.js";
import {
  commissionBridge,
  commissionedPeer,
  createController,
  setPeerAddress,
  TimeoutError,
  waitForBridgedEndpoints,
  waitForSubscription,
  withTimeout,
  type DiscoveryMode,
} from "./controller.js";
import { releaseProcessSignals, setMatterLogLevel, setStorageDriver, type MatterLogLevel, type StorageDriver } from "./environment.js";
import { clusterState, MatterOpError, refreshRemote, runOps, watchEndpoint } from "./ops.js";

export type MatterTransport = "network" | "local";
export type CommissioningStatus = "none" | "new" | "reused";

export interface MatterHubOptions {
  /** 기본: MATTER_TRANSPORT 또는 "network". */
  transport?: MatterTransport;
  /** 저장 폴더(브리지·컨트롤러 노드가 하위 폴더를 하나씩 쓴다). 기본 ".matter". */
  storageDir?: string;
  /** 브리지 UDP 포트(기본 5540). 컨트롤러는 controllerPort(기본 port + 1). */
  port?: number;
  controllerPort?: number;
  passcode?: number;
  discriminator?: number;
  vendorId?: number;
  productId?: number;
  /** 기기 id → twin 초기 상태. */
  initial?: Record<string, Record<string, unknown>>;
  /** matter.js 저장소 드라이버(기본 sqlite, MATTER_STORAGE_DRIVER가 있으면 그것). 프로세스 전체에 적용된다. */
  storageDriver?: StorageDriver;
  /** true면 브리지 저장소의 마지막 Matter 상태를 이어받는다(기본: 매번 twin 초기 상태). */
  keepState?: boolean;
  /** 커미셔닝할 때 브리지 찾는 방법(기본 "address": 같은 PC의 127.0.0.1:port). */
  discovery?: DiscoveryMode;
  /** 커미셔닝·재연결 제한 시간(기본 90초). */
  commissionTimeoutMs?: number;
  /** 페어링 안내 등 출력(기본 console.log). */
  log?: (line: string) => void;
  /** matter.js 로그 수준(기본 MATTER_LOG_LEVEL 또는 error). */
  logLevel?: MatterLogLevel;
  now?: () => Date;
}

export interface MatterHubInfo {
  transport: MatterTransport;
  commissioning: CommissioningStatus;
  storageDir: string;
  port: number;
  controllerPort?: number;
  /** network: 컨트롤러의 자동 구독(브리지 쪽 변화가 돌아오는 길)이 섰는지. */
  subscribed?: boolean;
  pairing?: PairingInfo;
}

/** 이 PC의 네트워크 환경 때문에 network 전송을 쓸 수 없을 때(포트·mDNS·커미셔닝 시간 초과 등). */
export class MatterNetworkError extends Error {
  override name = "MatterNetworkError";
}

export function isNetworkUnavailable(e: unknown): boolean {
  return e instanceof MatterNetworkError;
}

const NETWORK_ERROR = /timeout|timed out|시간 초과|ENOTFOUND|ENETUNREACH|EHOSTUNREACH|EADDRINUSE|EADDRNOTAVAIL|EACCES|No device could be commissioned|discover|mdns|network|socket/i;

function asNetworkError(message: string, e: unknown): Error {
  const cause = e instanceof Error ? e : new Error(String(e));
  if (e instanceof TimeoutError || NETWORK_ERROR.test(cause.message)) {
    return new MatterNetworkError(`${message}: ${cause.message}`, { cause });
  }
  return new Error(`${message}: ${cause.message}`, { cause });
}

/** 환경 변수 → 옵션(MATTER_TRANSPORT, MATTER_STORAGE_DIR, MATTER_PORT, MATTER_PASSCODE, MATTER_DISCRIMINATOR, MATTER_DISCOVERY). */
export function matterHubOptionsFromEnv(env: NodeJS.ProcessEnv = process.env): MatterHubOptions {
  const num = (v: string | undefined) => (v && /^\d+$/.test(v) ? Number(v) : undefined);
  const opts: MatterHubOptions = {};
  if (env.MATTER_TRANSPORT === "network" || env.MATTER_TRANSPORT === "local") opts.transport = env.MATTER_TRANSPORT;
  if (env.MATTER_STORAGE_DIR) opts.storageDir = env.MATTER_STORAGE_DIR;
  if (num(env.MATTER_PORT) !== undefined) opts.port = num(env.MATTER_PORT);
  if (num(env.MATTER_PASSCODE) !== undefined) opts.passcode = num(env.MATTER_PASSCODE);
  if (num(env.MATTER_DISCRIMINATOR) !== undefined) opts.discriminator = num(env.MATTER_DISCRIMINATOR);
  if (env.MATTER_DISCOVERY === "address" || env.MATTER_DISCOVERY === "mdns") opts.discovery = env.MATTER_DISCOVERY;
  return opts;
}

type Listener = (s: DeviceState) => void;

export class MatterHub implements DeviceHub {
  private readonly specs = new Map<string, DeviceSpec>();
  private readonly data = new Map<string, DeviceState>();
  private readonly listeners = new Set<Listener>();
  private readonly opts: Required<Pick<MatterHubOptions, "transport" | "storageDir" | "port" | "discovery" | "commissionTimeoutMs">> & MatterHubOptions;
  private readonly now: () => Date;
  private readonly log: (line: string) => void;

  private bridge?: MatterBridge;
  private controller?: ServerNode;
  private peer?: ClientNode;
  /** 기기 id → 명령·읽기에 쓰는 엔드포인트(local: 브리지 엔드포인트, network: 컨트롤러 쪽 엔드포인트). */
  private readonly endpoints = new Map<string, Endpoint>();
  private readonly unwatch: (() => void)[] = [];
  private readonly dirty = new Set<string>();
  private flushScheduled = false;
  private commissioning: CommissioningStatus = "none";
  private subscribed = false;
  private started = false;
  private starting?: Promise<void>;

  constructor(devices: DeviceSpec[], opts: MatterHubOptions = {}) {
    const env = matterHubOptionsFromEnv();
    opts = definedOnly(opts);
    this.opts = {
      ...env,
      ...opts,
      transport: opts.transport ?? env.transport ?? "network",
      storageDir: resolve(opts.storageDir ?? env.storageDir ?? ".matter"),
      port: opts.port ?? env.port ?? BRIDGE_DEFAULTS.port,
      discovery: opts.discovery ?? env.discovery ?? "address",
      commissionTimeoutMs: opts.commissionTimeoutMs ?? 90_000,
    };
    this.now = opts.now ?? (() => new Date());
    this.log = opts.log ?? ((line) => console.log(line));
    for (const spec of devices) {
      this.specs.set(spec.id, structuredClone(spec));
      const twin = this.initialTwin(spec);
      const matter = matterFromTwin(spec, twin);
      this.data.set(spec.id, this.make(spec.id, { ...twin, ...twinFromMatter(spec, matter) }, matter));
    }
  }

  static fromTwin(twin: Pick<TwinData, "devices" | "initial">, opts: MatterHubOptions = {}): MatterHub {
    return new MatterHub(twin.devices, { ...opts, initial: { ...twin.initial, ...opts.initial } });
  }

  get info(): MatterHubInfo {
    const pairing = this.bridge ? this.bridge.pairing() : undefined;
    return {
      transport: this.opts.transport,
      commissioning: this.commissioning,
      storageDir: this.opts.storageDir,
      port: this.opts.port,
      ...(this.opts.transport === "network" ? { controllerPort: this.controllerPort, subscribed: this.subscribed } : {}),
      ...(pairing ? { pairing } : {}),
    };
  }

  /** 브리지 쪽(실제 Matter 기기) 엔드포인트. 상태 기기(Matter 아님)는 undefined. */
  bridgeEndpoint(id: string): Endpoint | undefined {
    return this.bridge?.endpoints.get(id);
  }

  /**
   * 브리지 커미셔닝 창을 연다(network). 이미 우리 컨트롤러가 커미셔닝한 브리지에 Home Assistant 같은
   * 다른 Matter 컨트롤러를 더 붙일 때 쓴다. 돌려준 페어링 코드로 추가한다.
   */
  async openCommissioningWindow(timeoutSeconds = 900): Promise<PairingInfo> {
    if (!this.bridge || !this.peer) throw new Error("Matter 컨트롤러가 브리지에 연결되어 있지 않습니다(network 전송으로 시작해야 합니다).");
    // 패브릭 관리자인 우리 컨트롤러가 브리지에 Matter 명령으로 연다(로컬 호출은 원격 세션이 없어 거부된다)
    await this.peer.commandsOf("administratorCommissioning").openBasicCommissioningWindow!({ commissioningTimeout: timeoutSeconds });
    return this.bridge.pairing();
  }

  /** matter.js 브리지 노드(start 뒤). */
  get bridgeNode(): ServerNode | undefined {
    return this.bridge?.node;
  }

  private get controllerPort(): number {
    return this.opts.controllerPort ?? this.opts.port + 1;
  }

  async start(): Promise<void> {
    if (this.started) return;
    // 동시에 여러 번 불러도 노드는 한 번만 만든다
    this.starting ??= this.doStart().finally(() => {
      this.starting = undefined;
    });
    return this.starting;
  }

  private async doStart(): Promise<void> {
    setMatterLogLevel(this.opts.logLevel);
    setStorageDriver(this.opts.storageDriver);
    releaseProcessSignals();
    const devices = [...this.specs.values()];
    try {
      this.bridge = await createBridge(devices, {
        storageDir: this.opts.storageDir,
        port: this.opts.port,
        ...(this.opts.passcode !== undefined ? { passcode: this.opts.passcode } : {}),
        ...(this.opts.discriminator !== undefined ? { discriminator: this.opts.discriminator } : {}),
        ...(this.opts.vendorId !== undefined ? { vendorId: this.opts.vendorId } : {}),
        ...(this.opts.productId !== undefined ? { productId: this.opts.productId } : {}),
        ...(this.opts.initial ? { initial: this.opts.initial } : {}),
        ...(this.opts.keepState ? { keepState: true } : {}),
      });
      if (this.opts.transport === "local") {
        for (const [id, ep] of this.bridge.endpoints) this.endpoints.set(id, ep);
        this.log(formatPairingInfo(this.bridge.pairing()) + "\n  (local 전송: 네트워크에 올리지 않았다. MATTER_TRANSPORT=network로 띄우면 이 코드로 페어링할 수 있다.)");
      } else {
        await this.startNetwork();
      }
      for (const [id, ep] of this.endpoints) {
        this.refresh(id, ep);
        this.unwatch.push(watchEndpoint(ep, () => this.markDirty(id)));
      }
      this.started = true;
    } catch (e) {
      await this.stop();
      throw e;
    }
  }

  private async startNetwork(): Promise<void> {
    const bridge = this.bridge!;
    try {
      await bridge.start();
    } catch (e) {
      throw asNetworkError("Matter 브리지를 네트워크에 올리지 못했습니다", e);
    }
    this.log(formatPairingInfo(bridge.pairing()));

    const address = { ip: "127.0.0.1", port: this.opts.port };
    const timeoutMs = this.opts.commissionTimeoutMs;
    this.controller = await createController({ storageDir: this.opts.storageDir, port: this.controllerPort });
    let peer = commissionedPeer(this.controller);
    if (peer && !bridge.isCommissioned) {
      // 브리지 저장소가 새로 만들어졌다 → 컨트롤러 쪽 기록은 쓸모없다
      await peer.delete();
      peer = undefined;
    }
    if (peer) await setPeerAddress(peer, address);
    try {
      await this.controller.start();
    } catch (e) {
      throw asNetworkError("Matter 컨트롤러를 네트워크에 올리지 못했습니다", e);
    }

    if (peer) {
      this.commissioning = "reused";
      this.log(`[Matter 컨트롤러] 저장된 커미셔닝을 다시 쓴다(${peer.id}).`);
    } else {
      // 컨트롤러 저장소만 지워졌으면 브리지는 이미 다른(옛) 패브릭에 있다 → 커미셔닝 창을 다시 연다
      if (bridge.isCommissioned) await bridge.enterCommissionableMode();
      const pairing = bridge.pairing();
      this.log(`[Matter 컨트롤러] 브리지를 커미셔닝한다(${this.opts.discovery === "mdns" ? "mDNS 검색" : `${address.ip}:${address.port}`})...`);
      try {
        peer = await commissionBridge(this.controller, {
          pairingCode: pairing.manualPairingCode,
          discriminator: pairing.discriminator,
          discovery: this.opts.discovery,
          address,
          timeoutMs,
        });
      } catch (e) {
        throw asNetworkError("브리지 커미셔닝에 실패했습니다", e);
      }
      this.commissioning = "new";
      this.log(`[Matter 컨트롤러] 커미셔닝 완료(${peer.id}).`);
    }
    this.peer = peer;

    const ids = [...bridge.endpoints.keys()];
    try {
      if (!peer.lifecycle.isOnline) await withTimeout(peer.start(), timeoutMs, "피어 시작 시간 초과");
      const found = await waitForBridgedEndpoints(peer, ids, timeoutMs);
      // 저장된 캐시가 아니라 지금 값을 읽는다(재연결 확인도 겸한다).
      // 한 피어에 동시 교환(exchange)이 많으면 matter.js가 오래된 것부터 닫으므로 동시에 몇 개씩만 읽는다.
      await withTimeout(eachLimit([...found.values()], READ_CONCURRENCY, refreshRemote), timeoutMs, "브리지 상태 읽기 시간 초과");
      for (const [id, ep] of found) this.endpoints.set(id, ep);
    } catch (e) {
      throw asNetworkError("커미셔닝된 브리지에 연결하지 못했습니다", e);
    }
    this.subscribed = await waitForSubscription(peer, Math.min(timeoutMs, 30_000));
    if (!this.subscribed) this.log("[Matter 컨트롤러] 경고: 구독이 아직 서지 않았다. 명령은 되지만 브리지 쪽 변화가 늦게 보일 수 있다.");
  }

  async stop(): Promise<void> {
    for (const off of this.unwatch.splice(0)) off();
    this.endpoints.clear();
    this.dirty.clear();
    const controller = this.controller;
    const bridge = this.bridge;
    this.controller = undefined;
    this.peer = undefined;
    this.bridge = undefined;
    this.started = false;
    this.subscribed = false;
    this.commissioning = "none";
    // 브리지를 먼저 닫는다: 컨트롤러가 살아 있어야 브리지가 구독 종료를 바로 확인받는다
    // (반대 순서면 브리지가 닫힌 컨트롤러로 재전송하다 10초 넘게 걸린다)
    if (bridge) await bridge.close().catch((e) => this.log(`[Matter] 브리지 종료 오류: ${(e as Error).message}`));
    if (controller) await controller.close().catch((e) => this.log(`[Matter] 컨트롤러 종료 오류: ${(e as Error).message}`));
  }

  list(): DeviceSpec[] {
    return [...this.specs.values()].map((s) => structuredClone(s));
  }

  get(id: string): DeviceState | undefined {
    const s = this.data.get(id);
    return s ? structuredClone(s) : undefined;
  }

  states(): DeviceState[] {
    return [...this.data.values()].map((s) => structuredClone(s));
  }

  async command(id: string, cmd: Command): Promise<CommandResult> {
    const spec = this.specs.get(id);
    const state = this.data.get(id);
    if (!spec || !state) return { ok: false, error: `기기를 찾을 수 없습니다: ${id}` };
    const c = normalizeCommand(spec, cmd);
    const error = checkCommand(spec, c, state);
    if (error) return { ok: false, error, state: structuredClone(state) };
    const ep = this.endpoints.get(id);
    if (!ep) return { ok: false, error: `${spec.label}: Matter 기기가 준비되지 않았습니다(허브 시작 전이거나 Matter 기기 아님).`, state: structuredClone(state) };
    try {
      await runOps(ep, matterFromCommand(spec, c, state.matter));
      if (this.opts.transport === "network") await refreshRemote(ep);
    } catch (e) {
      const message = e instanceof MatterOpError ? e.message : (e as Error).message;
      return { ok: false, error: `${spec.label}: Matter 명령이 실패했습니다(${message}).`, state: this.get(id)! };
    }
    return { ok: true, state: this.refresh(id, ep) };
  }

  async setSensor(id: string, attr: string, value: unknown): Promise<CommandResult> {
    const spec = this.specs.get(id);
    const state = this.data.get(id);
    if (!spec || !state) return { ok: false, error: `기기를 찾을 수 없습니다: ${id}` };
    if (!spec.sensors.includes(attr)) {
      const list = spec.sensors.length > 0 ? spec.sensors.join(", ") : "없음";
      return { ok: false, error: `${spec.label}: '${attr}'은(는) 센서 값이 아닙니다(센서: ${list}).`, state: structuredClone(state) };
    }
    const allowed = spec.twinAttrs[attr] ?? [];
    if (allowed.length > 0 && !allowed.includes(value)) {
      return { ok: false, error: `${spec.label}: ${attr} 값은 ${allowed.map(String).join("/")} 중 하나여야 합니다(받은 값: ${JSON.stringify(value)}).`, state: structuredClone(state) };
    }
    const bridgeEp = this.bridge?.endpoints.get(id);
    const ep = this.endpoints.get(id);
    const hasBooleanState = bridgeEp !== undefined && "booleanState" in bridgeEp.behaviors.supported;
    if (attr === "door" && hasBooleanState && ep) {
      try {
        // 세계 시뮬레이션: 브리지(기기) 쪽 센서 속성을 직접 바꾼다
        await bridgeEp.setStateOf("booleanState", { stateValue: value !== "open" });
        if (this.opts.transport === "network") await refreshRemote(ep);
      } catch (e) {
        return { ok: false, error: `${spec.label}: 센서 값을 바꾸지 못했습니다(${(e as Error).message}).`, state: this.get(id)! };
      }
      return { ok: true, state: this.refresh(id, ep) };
    }
    // Matter 속성이 없는 센서(충전 상태 등)는 twin에만 있다
    return { ok: true, state: this.commit(id, { ...state.twin, [attr]: value }, state.matter) };
  }

  subscribe(cb: Listener): () => void {
    this.listeners.add(cb);
    return () => {
      this.listeners.delete(cb);
    };
  }

  // ── 내부 ──────────────────────────────────────────────

  private initialTwin(spec: DeviceSpec): Record<string, unknown> {
    const initial = this.opts.initial?.[spec.id];
    const twin: Record<string, unknown> = {};
    for (const [attr, values] of Object.entries(spec.twinAttrs)) twin[attr] = initial?.[attr] ?? defaultTwinValue(attr, values);
    return twin;
  }

  private markDirty(id: string): void {
    this.dirty.add(id);
    if (this.flushScheduled) return;
    this.flushScheduled = true;
    setImmediate(() => {
      this.flushScheduled = false;
      const ids = [...this.dirty];
      this.dirty.clear();
      for (const dirtyId of ids) {
        const ep = this.endpoints.get(dirtyId);
        if (ep) this.refresh(dirtyId, ep);
      }
    });
  }

  /** 엔드포인트 상태 → 요약 → twin. 바뀌었으면 저장하고 알린다. */
  private refresh(id: string, ep: Endpoint): DeviceState {
    const spec = this.specs.get(id)!;
    const prev = this.data.get(id)!;
    const summary = summaryFromClusters(spec, clusterState(ep));
    return this.commit(id, { ...prev.twin, ...twinFromMatter(spec, summary) }, summary);
  }

  private make(id: string, twin: Record<string, unknown>, matter: MatterSummary): DeviceState {
    return { id, online: true, twin, matter, updatedAt: this.now().toISOString() };
  }

  private commit(id: string, twin: Record<string, unknown>, matter: MatterSummary): DeviceState {
    const prev = this.data.get(id)!;
    if (sameJson(prev.twin, twin) && sameJson(prev.matter, matter)) return structuredClone(prev);
    const state = this.make(id, twin, matter);
    this.data.set(id, state);
    for (const cb of [...this.listeners]) {
      try {
        cb(structuredClone(state));
      } catch {
        // 구독자 오류는 허브 동작에 영향을 주지 않는다
      }
    }
    return structuredClone(state);
  }
}

/** 서버(src/server/hubFactory.ts)가 쓰는 진입점. start()는 부르는 쪽에서 한다. */
export function createMatterHub(twin: Pick<TwinData, "devices" | "initial">, opts: MatterHubOptions = {}): MatterHub {
  return MatterHub.fromTwin(twin, opts);
}

/** 값이 undefined인 키를 뺀다(명시적 undefined가 환경 변수·기본값을 지우지 않게). */
function definedOnly<T extends object>(o: T): T {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as T;
}

/** 피어 하나에 동시에 보낼 읽기 수(matter.js 세션당 동시 교환 한도보다 작게). */
const READ_CONCURRENCY = 3;

async function eachLimit<T>(items: T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const worker = async () => {
    while (next < items.length) await fn(items[next++]!);
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
}

function sameJson(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}
