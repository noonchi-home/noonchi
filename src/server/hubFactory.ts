// HUB=memory|matter로 DeviceHub를 고른다(기본 matter).
// matter: devices 입구의 지연 로더(loadMatterHub, src/devices/matter/load.ts)로 src/devices/matter/matterHub.ts를 불러온다(memory만 쓸 때 matter.js를 읽지 않게). 모듈이 없으면 경고하고 MemoryHub로 대신한다.
// matterHub.ts에 기대하는 export(하나만 있으면 된다):
//   createMatterHub(twin: TwinData, opts: { transport, storageDir?, ... }): DeviceHub | Promise<DeviceHub>
//   default 같은 함수 | MatterHub.fromTwin(twin, opts) | new MatterHub(twin, opts)
// startHub: 만들고 시작까지 한다. network 커미셔닝이 실패하면 local 전송으로, local도 실패하면 MemoryHub로 대신한다.

import { MemoryHub, loadMatterHub } from "../devices/index.js";
import type { DeviceHub } from "../contract/devices.js";
import type { TwinData } from "../layout/index.js";
import { headWithin } from "../shared/cut.js";

export type HubKind = "memory" | "matter";
export type MatterTransport = "network" | "local";
type Env = Record<string, string | undefined>;

export interface HubFactoryOptions {
  memoryNow?: () => Date;
  transport?: MatterTransport;
  storageDir?: string;
  /** MatterHub에 그대로 넘길 추가 옵션(port, commissionTimeoutMs, log 등). */
  matter?: Record<string, unknown>;
  /** 테스트용: matter 모듈 불러오기를 바꾼다. */
  importer?: () => Promise<Record<string, unknown>>;
}

export interface CreatedHub {
  hub: DeviceHub;
  kind: HubKind;
  warning?: string;
}

type TwinLike = Pick<TwinData, "devices" | "initial"> & Partial<TwinData>;

const defaultImporter = loadMatterHub;

function isMissingModule(e: unknown): boolean {
  const err = e as { code?: string; message?: string };
  return err?.code === "ERR_MODULE_NOT_FOUND" || /Cannot find module|Failed to load url/i.test(String(err?.message ?? ""));
}

type Factory = (twin: TwinLike, opts: Record<string, unknown>) => DeviceHub | Promise<DeviceHub>;

function pickFactory(mod: Record<string, unknown>): Factory | undefined {
  if (typeof mod.createMatterHub === "function") return mod.createMatterHub as Factory;
  if (typeof mod.default === "function" && !/^class\s/.test(Function.prototype.toString.call(mod.default))) return mod.default as Factory;
  const C = mod.MatterHub as (Function & { fromTwin?: Factory }) | undefined;
  if (typeof C === "function") {
    if (typeof C.fromTwin === "function") return (t, o) => C.fromTwin!(t, o);
    return (t, o) => new (C as unknown as new (t: TwinLike, o: Record<string, unknown>) => DeviceHub)(t, o);
  }
  return undefined;
}

export async function createHub(kind: string, twin: TwinLike, opts: HubFactoryOptions = {}): Promise<CreatedHub> {
  const k = (kind || "memory").trim().toLowerCase();
  if (k === "memory") return { hub: MemoryHub.fromTwin(twin, { now: opts.memoryNow }), kind: "memory" };
  if (k !== "matter") throw new Error(`HUB 값은 memory 또는 matter여야 합니다(받은 값: ${kind}).`);
  let mod: Record<string, unknown>;
  try {
    mod = await (opts.importer ?? defaultImporter)();
  } catch (e) {
    if (!isMissingModule(e)) throw e;
    return {
      hub: MemoryHub.fromTwin(twin, { now: opts.memoryNow }),
      kind: "memory",
      warning: `Matter 허브(src/devices/matter/matterHub.ts)를 불러오지 못해 MemoryHub로 대신합니다: ${(e as Error).message}`,
    };
  }
  const factory = pickFactory(mod);
  if (!factory) throw new Error("src/devices/matter/matterHub.ts에 createMatterHub 함수나 MatterHub 클래스 export가 없습니다.");
  const hub = await factory(twin, { ...opts.matter, transport: opts.transport ?? "network", storageDir: opts.storageDir });
  return { hub, kind: "matter" };
}

// ── 시작(대체 경로 포함) ───────────────────────────────────

export interface StartHubOptions {
  memoryNow?: () => Date;
  /** HUB, MATTER_TRANSPORT, MATTER_STORAGE_DIR, MATTER_COMMISSION_TIMEOUT_MS를 읽는다. */
  env?: Env;
  log?: (line: string) => void;
  importer?: HubFactoryOptions["importer"];
  /** MatterHub 추가 옵션(테스트: port, log 등). */
  matter?: Record<string, unknown>;
}

export interface StartedHub {
  hub: DeviceHub;
  kind: HubKind;
  /** kind가 matter일 때 실제로 쓰는 전송. */
  transport?: MatterTransport;
  /** 대체 경로를 탄 이유(사람에게 보일 한국어). */
  warnings: string[];
}

/** 서버 기본 커미셔닝 제한 시간: 이 PC에서 65개 기기 network 시작이 7~10초라 넉넉히 30초. */
export const DEFAULT_COMMISSION_TIMEOUT_MS = 30_000;

function errorText(e: unknown): string {
  return headWithin((e instanceof Error ? e.message : String(e)).split("\n")[0]!, 300);
}

export async function startHub(twin: TwinLike, opts: StartHubOptions = {}): Promise<StartedHub> {
  const env = opts.env ?? {};
  const log = opts.log ?? ((line: string) => console.log(line));
  const kind = env.HUB?.trim() || "matter";
  const transport: MatterTransport = env.MATTER_TRANSPORT?.trim().toLowerCase() === "local" ? "local" : "network";
  const timeout = Number(env.MATTER_COMMISSION_TIMEOUT_MS);
  const commissionTimeoutMs = Number.isFinite(timeout) && timeout > 0 ? timeout : DEFAULT_COMMISSION_TIMEOUT_MS;
  const storageDir = env.MATTER_STORAGE_DIR?.trim() || undefined;
  const warnings: string[] = [];
  const warn = (m: string) => {
    warnings.push(m);
    log(`[경고] ${m}`);
  };

  const create = (t: MatterTransport) =>
    createHub(kind, twin, { transport: t, storageDir, importer: opts.importer, memoryNow: opts.memoryNow, matter: { commissionTimeoutMs, ...opts.matter } });

  const first = await create(transport);
  if (first.warning) warn(first.warning);
  if (first.kind === "memory") {
    await first.hub.start();
    return { hub: first.hub, kind: "memory", warnings };
  }

  const tryStart = async (hub: DeviceHub): Promise<unknown> => {
    try {
      await hub.start();
      return undefined;
    } catch (e) {
      await hub.stop().catch(() => {});
      return e ?? new Error("알 수 없는 오류");
    }
  };

  const firstError = await tryStart(first.hub);
  if (firstError === undefined) return { hub: first.hub, kind: "matter", transport, warnings };

  let lastError = firstError;
  if (transport === "network") {
    warn(`Matter network 전송을 시작하지 못했습니다(${errorText(firstError)}). local 전송으로 바꿉니다(Matter 데이터 모델은 같고 네트워크·외부 컨트롤러 페어링만 빠짐).`);
    const local = await create("local");
    const localError = await tryStart(local.hub);
    if (localError === undefined) return { hub: local.hub, kind: "matter", transport: "local", warnings };
    lastError = localError;
  }
  warn(`Matter 허브를 시작하지 못해 MemoryHub로 대신합니다(${errorText(lastError)}).`);
  const memory = MemoryHub.fromTwin(twin, { now: opts.memoryNow });
  await memory.start();
  return { hub: memory, kind: "memory", warnings };
}
