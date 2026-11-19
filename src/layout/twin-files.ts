// twin-studio 데이터 읽기(docs/plan.md "기기 목록 만들기"): 고른 집(homes.json, HOME_ID)의 1순위 <out>/scene.json objects(attrs 있는 것), 없으면 <data>의 placement + floorplan 문 + 카탈로그.
// 여기서는 날 물건 목록(방·문·물건)만 만들고, 가전 만들기(DeviceSpec·초기 상태)는 src/devices/devices.ts buildDevices가 한다.

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import type { DeviceSpec, RoomSpec } from "../contract/devices.js";
import { repoPath } from "../shared/paths.js";
import { buildDevices, type Attrs, type RawObject, type SkippedObject, type StatesSpec } from "../devices/index.js";
import { resolveHome, type Home } from "./homes.js";
import { loadScene } from "./scene.js";

export type TwinSource = "scene" | "catalog";

export interface TwinData {
  source: TwinSource;
  /** twin-studio 폴더 */
  dir: string;
  /** 고른 집 */
  home: Home;
  rooms: RoomSpec[];
  devices: DeviceSpec[];
  /** 기기 id → twin 초기 상태(twinAttrs의 모든 키). */
  initial: Record<string, Record<string, unknown>>;
  /** 상태(attrs)는 있지만 기기로 만들지 않은 객체(twin 전용·매핑 없음). */
  skipped: SkippedObject[];
  warnings: string[];
}

export interface LoadOptions {
  source?: "auto" | TwinSource;
  /** homes.json의 집 id(없으면 기본 집) */
  home?: string;
}

interface RawDoor {
  id: string;
  connects?: string[];
  kind?: string;
  asset?: string;
  swing_into?: string;
}

/** 트윈 결과물 기본 폴더: 이 저장소 twin/(scripts/twin-assets.ts로 twin-studio에서 복사). */
export const DEFAULT_TWIN_DIR = repoPath("twin/");

/** 트윈 결과물 폴더(절대 경로): 인자 → TWIN_STUDIO_DIR → 저장소 twin/. 상대 경로는 base(기본 cwd) 기준. */
export function resolveTwinStudioDir(dir?: string, base: string = process.cwd()): string {
  const d = dir?.trim() || process.env.TWIN_STUDIO_DIR?.trim();
  if (!d) return resolve(DEFAULT_TWIN_DIR);
  return isAbsolute(d) ? resolve(d) : resolve(base, d);
}

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, "utf8").replace(/^﻿/, ""));
}

function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

function asAttrs(v: unknown): Attrs {
  const out: Attrs = {};
  for (const [k, vals] of Object.entries(asRecord(v))) if (Array.isArray(vals)) out[k] = vals;
  return out;
}

function parseRooms(v: unknown): RoomSpec[] {
  if (!Array.isArray(v)) return [];
  return v
    .map((r) => asRecord(r))
    .filter((r) => typeof r.id === "string")
    .map((r) => ({ id: r.id as string, label: typeof r.label === "string" ? r.label : (r.id as string) }));
}

function parseDoors(v: unknown): RawDoor[] {
  if (!Array.isArray(v)) return [];
  return v.map((d) => asRecord(d)).filter((d) => typeof d.id === "string") as unknown as RawDoor[];
}

/** twin-studio layout.py와 같은 규칙: 여닫이는 swing_into, 미닫이는 connects[0], 방이 아니면 connects 중 첫 방. */
export function doorRoom(door: RawDoor, roomIds: Set<string>): string {
  const connects = door.connects ?? [];
  const target = door.kind === "swing" ? door.swing_into : connects[0];
  if (target && roomIds.has(target)) return target;
  return connects.find((r) => roomIds.has(r)) ?? target ?? "";
}

/** 문 이름: 현관문, 나머지는 "들어가는 방(connects[1]) 문". */
export function doorLabel(door: RawDoor, rooms: RoomSpec[]): string {
  if (door.asset === "door_main" || door.id === "door_main") return "현관문";
  const label = (id?: string) => rooms.find((r) => r.id === id)?.label;
  const connects = door.connects ?? [];
  const name = label(connects[1]) ?? label(connects[0]);
  return name ? `${name} 문` : door.id;
}

function buildTwin(home: Home, source: TwinSource, rooms: RoomSpec[], objects: RawObject[], warnings: string[]): TwinData {
  return { source, dir: home.studioDir, home, rooms, ...buildDevices(rooms, objects, warnings), warnings };
}

function loadFromScene(home: Home, warnings: string[]): TwinData {
  // 합친 장면(scene.json + 도면 설비 + 시연용으로 더하는 가전, src/layout/scene.ts)에서 기기를 만든다
  const scene = asRecord(loadScene(home) ?? readJson(home.scenePath));
  const plan = asRecord(scene.plan);
  let rooms = parseRooms(plan.rooms);
  let doors = parseDoors(plan.doors);
  const floorplanPath = join(home.dataDir, "floorplan.json");
  if ((rooms.length === 0 || doors.length === 0) && existsSync(floorplanPath)) {
    const fp = asRecord(readJson(floorplanPath));
    if (rooms.length === 0) rooms = parseRooms(fp.rooms);
    if (doors.length === 0) doors = parseDoors(fp.doors);
  }
  const doorById = new Map(doors.map((d) => [d.id, d]));
  const objects: RawObject[] = (Array.isArray(scene.objects) ? scene.objects : []).map((raw) => {
    const o = asRecord(raw);
    const id = String(o.id);
    const door = doorById.get(id);
    const label = door ? doorLabel(door, rooms) : String(o.label ?? o.name ?? id);
    return {
      id, type: String(o.type), label, room: typeof o.room === "string" ? o.room : "",
      attrs: asAttrs(o.attrs), states: asRecord(o.states) as StatesSpec, state: asRecord(o.state),
    };
  });
  return buildTwin(home, "scene", rooms, objects, warnings);
}

function loadFromCatalog(home: Home, warnings: string[]): TwinData {
  const base = home.dataDir;
  const fp = asRecord(readJson(join(base, "floorplan.json")));
  const placement = asRecord(readJson(join(base, "placement.json")));
  const rooms = parseRooms(fp.rooms);
  const roomIds = new Set(rooms.map((r) => r.id));
  const catalog = new Map<string, Record<string, unknown>>();
  const catalogDir = home.catalogDir;
  for (const file of readdirSync(catalogDir).filter((f) => f.endsWith(".json")).sort()) {
    try {
      const entry = asRecord(readJson(join(catalogDir, file)));
      catalog.set(typeof entry.type === "string" ? entry.type : file.replace(/\.json$/, ""), entry);
    } catch (e) {
      warnings.push(`카탈로그를 읽지 못했습니다: ${file} (${(e as Error).message})`);
    }
  }
  const objects: RawObject[] = [];
  const fromEntry = (id: string, type: string, label: string, room: string, state?: unknown): RawObject => {
    const entry = catalog.get(type);
    if (!entry) warnings.push(`카탈로그에 없는 종류: ${type} (${id})`);
    return { id, type, label, room, attrs: asAttrs(entry?.attrs), states: asRecord(entry?.states) as StatesSpec, state: asRecord(state) };
  };
  for (const raw of Array.isArray(placement.items) ? placement.items : []) {
    const it = asRecord(raw);
    const id = String(it.id);
    const type = String(it.type);
    objects.push(fromEntry(id, type, String(it.label ?? id), String(it.room ?? ""), it.state));
  }
  for (const door of parseDoors(fp.doors)) {
    if (!door.asset) continue;
    objects.push(fromEntry(door.id, door.asset, doorLabel(door, rooms), doorRoom(door, roomIds)));
  }
  return buildTwin(home, "catalog", rooms, objects, warnings);
}

/** twin-studio 폴더에서 방·기기·초기 상태를 읽는다. */
export function loadTwin(twinStudioDir?: string, opts: LoadOptions = {}): TwinData {
  const dir = resolveTwinStudioDir(twinStudioDir);
  const want = opts.source ?? "auto";
  const warnings: string[] = [];
  const home = resolveHome(dir, opts.home);
  const scenePath = home.scenePath;
  const hasCatalog = existsSync(join(home.dataDir, "placement.json"));
  if (want !== "catalog" && existsSync(scenePath)) {
    try {
      return loadFromScene(home, warnings);
    } catch (e) {
      if (want === "scene") throw new Error(`scene.json을 읽지 못했습니다: ${scenePath} (${(e as Error).message})`);
      warnings.push(`scene.json을 읽지 못해 catalog로 대신합니다: ${(e as Error).message}`);
    }
  } else if (want === "scene") {
    throw new Error(`scene.json이 없습니다: ${scenePath}`);
  }
  if (!hasCatalog) {
    throw new Error(`twin-studio 데이터를 찾을 수 없습니다: ${dir} (집 ${home.id}: ${scenePath} 또는 ${join(home.dataDir, "placement.json")} 필요, TWIN_STUDIO_DIR·HOME_ID 확인)`);
  }
  return loadFromCatalog(home, warnings);
}

/** DeviceSpec 목록만. */
export function loadDevices(twinStudioDir?: string, opts?: LoadOptions): DeviceSpec[] {
  return loadTwin(twinStudioDir, opts).devices;
}
