// 설정 흐름(집 → 가전 → 운영 모드 → 위치 동기화)의 선택 저장. npm start만 파일에 쓰고(persist), 테스트·데모는 메모리에만 둔다.
//   runtime/setup.json                 { version, home, done, mode, assist, updated_at }  (mode: test 시험 · live 실제, 없으면 test. assist: auto 자동 · noonchi 눈치 · coach 코치, 없으면(옛 파일)·틀리면 noonchi, 새로 만드는 파일은 auto)
//   runtime/homes/<id>/signals.json    { version, home, sources: { <기기 id>: { kind } }, updated_at }  (virtual이 아닌 것만)
//   runtime/homes/<id>/thinq.json      { version, home, pairs: { <기기 id>: <ThinQ 기기 id> }, updated_at }
// 기기 목록은 집 배치(TwinData.devices)에서만 온다. 여기에는 기기별 출처와 ThinQ 짝만 적는다(구현명세서 2.3).
// 저장한 출처는 virtual·none뿐이다. 실제 모드의 thinq 출처는 짝에서 만든다(effectiveSources).

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { AssistMode, ControlMode } from "../../contract/setup.js";
import type { SignalSource } from "../../devices/index.js";
import type { DeviceKind } from "../../devices/kinds.js";
import { PAIRABLE_KINDS } from "../../devices/index.js";

/** 저장하는 출처(설정 2단계). */
export type StoredSource = { kind: "virtual" } | { kind: "none" };

export class SetupError extends Error {}

export interface SetupState {
  /** 고른 집 id. 고른 적이 없으면 null(HOME_ID 또는 기본 집으로 뜬다). */
  home: string | null;
  /** 설정을 끝냈는가. false면 대시보드가 설정 화면으로 보낸다. */
  done: boolean;
}

export interface SetupStoreOptions {
  runtimeDir: string;
  persist: boolean;
  log?: (line: string) => void;
}

/** quiet: 사라진 기기 id를 버릴 때 알리지 않는다(화면이 자주 읽을 때). */
export interface ReadOptions {
  quiet?: boolean;
}

const KINDS = new Set(["virtual", "none"]);

/** POST /api/setup/devices 본문의 sources({ 기기 id: "virtual"|"none" })를 검사한다. */
export function parseSources(raw: unknown, deviceIds: string[]): Record<string, StoredSource> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new SetupError("sources는 { 기기 id: \"virtual\" | \"none\" } 객체여야 합니다.");
  const known = new Set(deviceIds);
  const out: Record<string, StoredSource> = {};
  for (const [id, v] of Object.entries(raw)) {
    if (!known.has(id)) throw new SetupError(`없는 기기입니다: ${id}`);
    if (typeof v !== "string" || !KINDS.has(v)) throw new SetupError(`${id}: 출처는 virtual 또는 none이어야 합니다(받은 값: ${JSON.stringify(v)}).`);
    out[id] = { kind: v as "virtual" | "none" };
  }
  return out;
}

/** POST /api/setup/pairs 본문의 pairs({ 기기 id: ThinQ 기기 id | null })를 검사한다. null은 짝 풀기. */
export function parsePairs(raw: unknown, devices: { id: string; kind: DeviceKind }[]): Record<string, string | null> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new SetupError("pairs는 { 기기 id: ThinQ 기기 id | null } 객체여야 합니다.");
  const kinds = new Map(devices.map((d) => [d.id, d.kind]));
  const out: Record<string, string | null> = {};
  for (const [id, v] of Object.entries(raw)) {
    const kind = kinds.get(id);
    if (!kind) throw new SetupError(`없는 기기입니다: ${id}`);
    if (!PAIRABLE_KINDS.includes(kind)) throw new SetupError(`에어컨·냉장고만 ThinQ와 짝지을 수 있어요: ${id}`);
    if (v !== null && (typeof v !== "string" || !v.trim())) throw new SetupError(`${id}: ThinQ 기기 id는 글자이거나 null이어야 합니다.`);
    out[id] = v === null ? null : v.trim();
  }
  return out;
}

/** 지금 쓸 출처: 시험 모드는 저장한 출처 그대로, 실제 모드는 짝지은 기기를 thinq로. */
export function effectiveSources(stored: Record<string, StoredSource>, pairs: Record<string, string>, mode: ControlMode): Record<string, SignalSource> {
  const out: Record<string, SignalSource> = Object.fromEntries(Object.entries(stored).map(([id, s]) => [id, { ...s }]));
  if (mode !== "live") return out;
  for (const [id, deviceId] of Object.entries(pairs)) out[id] = { kind: "thinq", deviceId };
  return out;
}

function writeJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`);
  renameSync(tmp, path);
}

export class SetupStore {
  readonly persist: boolean;
  private readonly runtimeDir: string;
  private readonly log: (line: string) => void;
  private current: SetupState;
  private currentMode: ControlMode;
  private currentAssist: AssistMode;
  private readonly memory = new Map<string, Record<string, StoredSource>>();
  private readonly memoryPairs = new Map<string, Record<string, string>>();

  constructor(opts: SetupStoreOptions) {
    this.persist = opts.persist;
    this.runtimeDir = opts.runtimeDir;
    this.log = opts.log ?? (() => {});
    const saved = this.persist ? this.readState() : { home: null, done: true, mode: "test" as const, assist: "noonchi" as const };
    this.current = { home: saved.home, done: saved.done };
    this.currentMode = saved.mode;
    this.currentAssist = saved.assist;
  }

  state(): SetupState {
    return { ...this.current };
  }

  /** 다른 집을 고르면 설정을 다시 끝내야 한다. */
  setHome(id: string): void {
    const done = this.current.home === id ? this.current.done : false;
    this.current = { home: id, done };
    this.writeState();
  }

  markDone(): void {
    this.current = { ...this.current, done: true };
    this.writeState();
  }

  /** 운영 모드. 저장한 적이 없으면 시험 모드. */
  mode(): ControlMode {
    return this.currentMode;
  }

  setMode(mode: ControlMode): void {
    this.currentMode = mode;
    this.writeState();
  }

  /** 돕는 방식. 새로 만드는 설정은 자동, assist가 없는 옛 파일이나 틀린 값이면 눈치 모드. */
  assist(): AssistMode {
    return this.currentAssist;
  }

  setAssist(assist: AssistMode): void {
    this.currentAssist = assist;
    this.writeState();
  }

  /** 집의 ThinQ 짝(기기 id → ThinQ 기기 id). 지금 집에 없는 기기 id는 버리고 알린다. */
  pairs(homeId: string, deviceIds: string[], opts: ReadOptions = {}): Record<string, string> {
    const raw = this.persist ? this.readPairs(homeId) : this.memoryPairs.get(homeId) ?? {};
    const known = new Set(deviceIds);
    const out: Record<string, string> = {};
    for (const [id, deviceId] of Object.entries(raw)) {
      if (known.has(id)) out[id] = deviceId;
      else if (!opts.quiet) this.log(`[경고] ThinQ 짝: 집 ${homeId}에 없는 기기 ${id}는 버립니다(배치에서 빠짐).`);
    }
    return out;
  }

  savePairs(homeId: string, pairs: Record<string, string>): void {
    const kept = { ...pairs };
    if (!this.persist) {
      this.memoryPairs.set(homeId, kept);
      return;
    }
    writeJson(this.pairsPath(homeId), { version: 1, home: homeId, pairs: kept, updated_at: new Date().toISOString() });
  }

  /** 집의 기기 출처(virtual이 아닌 것만). 지금 집에 없는 기기 id는 버리고 알린다. */
  sources(homeId: string, deviceIds: string[], opts: ReadOptions = {}): Record<string, StoredSource> {
    const raw = this.persist ? this.readSources(homeId) : this.memory.get(homeId) ?? {};
    const known = new Set(deviceIds);
    const out: Record<string, StoredSource> = {};
    for (const [id, s] of Object.entries(raw)) {
      if (!known.has(id)) {
        if (!opts.quiet) this.log(`[경고] 신호 출처: 집 ${homeId}에 없는 기기 ${id}는 버립니다(배치에서 빠짐).`);
        continue;
      }
      if (s.kind !== "virtual") out[id] = { ...s };
    }
    return out;
  }

  /** 이 집 가전을 고른 적이 있는지. 모두 가상으로 저장해도 고른 것이다(설정 화면은 안 고른 집을 모두 끈 채로 연다). */
  hasSources(homeId: string): boolean {
    return this.persist ? existsSync(this.signalsPath(homeId)) : this.memory.has(homeId);
  }

  saveSources(homeId: string, sources: Record<string, StoredSource>): void {
    const kept = Object.fromEntries(Object.entries(sources).filter(([, s]) => s.kind === "none").map(([id, s]) => [id, { ...s }]));
    if (!this.persist) {
      this.memory.set(homeId, kept);
      return;
    }
    writeJson(this.signalsPath(homeId), { version: 1, home: homeId, sources: kept, updated_at: new Date().toISOString() });
  }

  private statePath(): string {
    return join(this.runtimeDir, "setup.json");
  }

  private signalsPath(homeId: string): string {
    return join(this.runtimeDir, "homes", homeId, "signals.json");
  }

  private pairsPath(homeId: string): string {
    return join(this.runtimeDir, "homes", homeId, "thinq.json");
  }

  private readState(): SetupState & { mode: ControlMode; assist: AssistMode } {
    const path = this.statePath();
    if (!existsSync(path)) return { home: null, done: false, mode: "test", assist: "auto" };
    try {
      const raw = JSON.parse(readFileSync(path, "utf8")) as { home?: unknown; done?: unknown; mode?: unknown; assist?: unknown };
      return { home: typeof raw.home === "string" && raw.home ? raw.home : null, done: raw.done === true, mode: raw.mode === "live" ? "live" : "test", assist: raw.assist === "coach" || raw.assist === "auto" ? raw.assist : "noonchi" };
    } catch (e) {
      this.log(`[경고] 설정 파일을 읽지 못해 처음부터 설정합니다: ${path} (${(e as Error).message})`);
      return { home: null, done: false, mode: "test", assist: "noonchi" };
    }
  }

  private writeState(): void {
    if (!this.persist) return;
    writeJson(this.statePath(), { version: 1, home: this.current.home, done: this.current.done, mode: this.currentMode, assist: this.currentAssist, updated_at: new Date().toISOString() });
  }

  private readPairs(homeId: string): Record<string, string> {
    const path = this.pairsPath(homeId);
    if (!existsSync(path)) return {};
    try {
      const raw = JSON.parse(readFileSync(path, "utf8")) as { home?: unknown; pairs?: Record<string, unknown> };
      if (raw.home !== homeId || !raw.pairs || typeof raw.pairs !== "object") throw new Error("집 id나 pairs가 맞지 않음");
      return Object.fromEntries(Object.entries(raw.pairs).filter((e): e is [string, string] => typeof e[1] === "string" && !!e[1]));
    } catch (e) {
      this.log(`[경고] ThinQ 짝 파일을 읽지 못해 짝 없이 둡니다: ${path} (${(e as Error).message})`);
      return {};
    }
  }

  private readSources(homeId: string): Record<string, StoredSource> {
    const path = this.signalsPath(homeId);
    if (!existsSync(path)) return {};
    try {
      const raw = JSON.parse(readFileSync(path, "utf8")) as { home?: unknown; sources?: Record<string, { kind?: unknown }> };
      if (raw.home !== homeId || !raw.sources || typeof raw.sources !== "object") throw new Error("집 id나 sources가 맞지 않음");
      const out: Record<string, StoredSource> = {};
      for (const [id, s] of Object.entries(raw.sources)) {
        if (typeof s?.kind === "string" && KINDS.has(s.kind)) out[id] = { kind: s.kind as "virtual" | "none" };
        else this.log(`[경고] 신호 출처: ${id}의 출처 ${JSON.stringify(s?.kind)}를 모릅니다. 가상으로 둡니다.`);
      }
      return out;
    } catch (e) {
      this.log(`[경고] 신호 출처 파일을 읽지 못해 모두 가상으로 둡니다: ${path} (${(e as Error).message})`);
      return {};
    }
  }
}
