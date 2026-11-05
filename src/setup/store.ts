// 설정 흐름(집 → 가전 → 위치 동기화)의 선택 저장. npm start만 파일에 쓰고(persist), 테스트·데모는 메모리에만 둔다.
//   runtime/setup.json                 { version, home, done, updated_at }
//   runtime/homes/<id>/signals.json    { version, home, sources: { <기기 id>: { kind } }, updated_at }  (virtual이 아닌 것만)
// 기기 목록은 집 배치(TwinData.devices)에서만 온다. 여기에는 기기별 출처만 적는다(구현명세서 2.3).

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { SignalSource } from "../hub/signals.js";

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

const KINDS = new Set(["virtual", "none"]);

/** POST /api/setup/devices 본문의 sources({ 기기 id: "virtual"|"none" })를 검사한다. */
export function parseSources(raw: unknown, deviceIds: string[]): Record<string, SignalSource> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new SetupError("sources는 { 기기 id: \"virtual\" | \"none\" } 객체여야 합니다.");
  const known = new Set(deviceIds);
  const out: Record<string, SignalSource> = {};
  for (const [id, v] of Object.entries(raw)) {
    if (!known.has(id)) throw new SetupError(`없는 기기입니다: ${id}`);
    if (typeof v !== "string" || !KINDS.has(v)) throw new SetupError(`${id}: 출처는 virtual 또는 none이어야 합니다(받은 값: ${JSON.stringify(v)}).`);
    out[id] = { kind: v as SignalSource["kind"] };
  }
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
  private readonly memory = new Map<string, Record<string, SignalSource>>();

  constructor(opts: SetupStoreOptions) {
    this.persist = opts.persist;
    this.runtimeDir = opts.runtimeDir;
    this.log = opts.log ?? (() => {});
    this.current = this.persist ? this.readState() : { home: null, done: true };
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

  /** 집의 기기 출처(virtual이 아닌 것만). 지금 집에 없는 기기 id는 버리고 알린다. */
  sources(homeId: string, deviceIds: string[]): Record<string, SignalSource> {
    const raw = this.persist ? this.readSources(homeId) : this.memory.get(homeId) ?? {};
    const known = new Set(deviceIds);
    const out: Record<string, SignalSource> = {};
    for (const [id, s] of Object.entries(raw)) {
      if (!known.has(id)) {
        this.log(`[경고] 신호 출처: 집 ${homeId}에 없는 기기 ${id}는 버립니다(배치에서 빠짐).`);
        continue;
      }
      if (s.kind !== "virtual") out[id] = { ...s };
    }
    return out;
  }

  saveSources(homeId: string, sources: Record<string, SignalSource>): void {
    const kept = Object.fromEntries(Object.entries(sources).filter(([, s]) => s.kind !== "virtual").map(([id, s]) => [id, { ...s }]));
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

  private readState(): SetupState {
    const path = this.statePath();
    if (!existsSync(path)) return { home: null, done: false };
    try {
      const raw = JSON.parse(readFileSync(path, "utf8")) as { home?: unknown; done?: unknown };
      return { home: typeof raw.home === "string" && raw.home ? raw.home : null, done: raw.done === true };
    } catch (e) {
      this.log(`[경고] 설정 파일을 읽지 못해 처음부터 설정합니다: ${path} (${(e as Error).message})`);
      return { home: null, done: false };
    }
  }

  private writeState(): void {
    if (!this.persist) return;
    writeJson(this.statePath(), { version: 1, home: this.current.home, done: this.current.done, updated_at: new Date().toISOString() });
  }

  private readSources(homeId: string): Record<string, SignalSource> {
    const path = this.signalsPath(homeId);
    if (!existsSync(path)) return {};
    try {
      const raw = JSON.parse(readFileSync(path, "utf8")) as { home?: unknown; sources?: Record<string, { kind?: unknown }> };
      if (raw.home !== homeId || !raw.sources || typeof raw.sources !== "object") throw new Error("집 id나 sources가 맞지 않음");
      const out: Record<string, SignalSource> = {};
      for (const [id, s] of Object.entries(raw.sources)) {
        if (typeof s?.kind === "string" && KINDS.has(s.kind)) out[id] = { kind: s.kind as SignalSource["kind"] };
        else this.log(`[경고] 신호 출처: ${id}의 출처 ${JSON.stringify(s?.kind)}를 모릅니다. 가상으로 둡니다.`);
      }
      return out;
    } catch (e) {
      this.log(`[경고] 신호 출처 파일을 읽지 못해 모두 가상으로 둡니다: ${path} (${(e as Error).message})`);
      return {};
    }
  }
}
