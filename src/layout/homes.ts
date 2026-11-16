// twin-studio 집 목록(homes.json, docs/plan.md "집 고르기"). 평면도마다 데이터 폴더·산출물 폴더가 하나씩 있다.
// homes.json이 없는 옛 twin-studio는 아파트 한 집(data/apartment, apartment/)으로 본다.

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export interface Home {
  id: string;
  name: string;
  studioDir: string;
  /** floorplan.json·placement.json */
  dataDir: string;
  /** scene.json·assets/ (/twin/에 붙는다) */
  outDir: string;
  scenePath: string;
  /** 모든 집이 함께 쓰는 three.js 뷰어(/twin/viewer/) */
  viewerDir: string;
  /** 모든 종류의 개별 GLB(/twin/lib/). 실행 중 새 종류를 더할 때 쓴다. */
  libraryDir: string;
  /** 종류별 카탈로그 JSON 폴더 */
  catalogDir: string;
}

export interface HomeRegistry {
  default: string;
  viewerDir: string;
  libraryDir: string;
  homes: Home[];
}

interface RawHome {
  id?: unknown;
  name?: unknown;
  data?: unknown;
  out?: unknown;
}

const ID = /^[a-z][a-z0-9_]*$/;
const LEGACY: RawHome = { id: "apartment", name: "아파트", data: "data/apartment", out: "apartment" };

/** 집 폴더 catalog/ → 공용 data/catalog → 옛 data/apartment/catalog(카탈로그를 옮기기 전 체크아웃). */
function catalogDirOf(studioDir: string, dataDir: string): string {
  const candidates = [join(dataDir, "catalog"), join(studioDir, "data", "catalog"), join(studioDir, "data", "apartment", "catalog")];
  return candidates.find((d) => existsSync(d)) ?? candidates[1]!;
}

export function readRegistry(studioDir: string): HomeRegistry {
  const path = join(studioDir, "homes.json");
  let raw: Record<string, unknown> = { homes: [LEGACY] };
  if (existsSync(path)) {
    try {
      raw = JSON.parse(readFileSync(path, "utf8").replace(/^﻿/, "")) as Record<string, unknown>;
    } catch (e) {
      throw new Error(`homes.json을 읽지 못했습니다: ${path} (${(e as Error).message})`);
    }
  }
  const viewerDir = join(studioDir, typeof raw.viewer === "string" ? raw.viewer : "apartment/viewer");
  const libraryDir = join(studioDir, typeof raw.library === "string" ? raw.library : "library");
  const entries = Array.isArray(raw.homes) ? (raw.homes as RawHome[]) : [];
  if (entries.length === 0) throw new Error(`homes.json에 집이 없습니다: ${path}`);
  const homes: Home[] = [];
  for (const e of entries) {
    if (typeof e.id !== "string" || !ID.test(e.id)) throw new Error(`homes.json: id는 영어 소문자로 시작하고 소문자·숫자·_만 씁니다: ${JSON.stringify(e.id)}`);
    if (typeof e.data !== "string" || typeof e.out !== "string") throw new Error(`homes.json: ${e.id}의 data·out 경로가 없습니다`);
    if (homes.some((h) => h.id === e.id)) throw new Error(`homes.json: id가 겹칩니다: ${e.id}`);
    const dataDir = join(studioDir, e.data);
    const outDir = join(studioDir, e.out);
    homes.push({
      id: e.id, name: typeof e.name === "string" && e.name ? e.name : e.id, studioDir,
      dataDir, outDir, scenePath: join(outDir, "scene.json"), viewerDir, libraryDir, catalogDir: catalogDirOf(studioDir, dataDir),
    });
  }
  const def = typeof raw.default === "string" ? raw.default : homes[0]!.id;
  if (!homes.some((h) => h.id === def)) throw new Error(`homes.json: default ${def}가 homes에 없습니다`);
  return { default: def, viewerDir, libraryDir, homes };
}

/** id가 없으면 기본 집. */
export function resolveHome(studioDir: string, id?: string): Home {
  const reg = readRegistry(studioDir);
  const key = id?.trim() || reg.default;
  const home = reg.homes.find((h) => h.id === key);
  if (!home) throw new Error(`없는 집입니다: ${key} (있는 집: ${reg.homes.map((h) => h.id).join(", ")})`);
  return home;
}

export function listHomes(studioDir: string): { id: string; name: string }[] {
  return readRegistry(studioDir).homes.map((h) => ({ id: h.id, name: h.name }));
}
