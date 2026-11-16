// twin-studio 카탈로그(종류별 JSON) 읽기·찾기. 배치 편집기가 새 물건의 크기·놓는 방식·상태를 여기서 가져온다.

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { compact, stripParticle } from "../shared/korean.js";

export interface TypeInfo {
  type: string;
  label: string;
  category: string;
  /** floor | surface | wall | ceiling | opening */
  mount: string;
  /** [폭, 깊이] m */
  footprint: [number, number];
  height: number;
  attrs: Record<string, unknown[]>;
  states: Record<string, unknown>;
  nodeType?: string;
  /** 물건을 놓거나 눕는 면(이름·바닥에서 높이 m, 예: 침대 mattress). 카탈로그에 없으면 칸이 없다. */
  surfaces?: { name: string; height: number }[];
}

function num(v: unknown, fallback: number): number {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

/** 카탈로그 surfaces: 이름과 숫자 높이가 있는 것만. 하나도 없으면 null. */
function surfacesOf(v: unknown): { name: string; height: number }[] | null {
  if (!Array.isArray(v)) return null;
  const out = v.flatMap((s) => (s && typeof s === "object" && typeof (s as { name?: unknown }).name === "string" && typeof (s as { height?: unknown }).height === "number" && Number.isFinite((s as { height: number }).height)
    ? [{ name: (s as { name: string }).name, height: (s as { height: number }).height }] : []));
  return out.length ? out : null;
}

/** 폴더의 *.json → 종류 표. 읽지 못한 파일은 건너뛴다. */
export function loadCatalog(dir: string): Map<string, TypeInfo> {
  const out = new Map<string, TypeInfo>();
  if (!existsSync(dir)) return out;
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".json")).sort()) {
    let raw: Record<string, unknown>;
    try {
      raw = JSON.parse(readFileSync(join(dir, file), "utf8").replace(/^﻿/, "")) as Record<string, unknown>;
    } catch {
      continue;
    }
    const type = typeof raw.type === "string" ? raw.type : file.replace(/\.json$/, "");
    const fp = Array.isArray(raw.footprint) ? raw.footprint : [];
    out.set(type, {
      type,
      label: typeof raw.label === "string" ? raw.label : type,
      category: typeof raw.category === "string" ? raw.category : "props",
      mount: typeof raw.mount === "string" ? raw.mount : "floor",
      footprint: [num(fp[0], 0.4), num(fp[1], 0.4)],
      height: num(raw.height, 0.5),
      attrs: raw.attrs && typeof raw.attrs === "object" ? (raw.attrs as Record<string, unknown[]>) : {},
      states: raw.states && typeof raw.states === "object" ? (raw.states as Record<string, unknown>) : {},
      nodeType: typeof raw.node_type === "string" ? raw.node_type : undefined,
      ...(surfacesOf(raw.surfaces) ? { surfaces: surfacesOf(raw.surfaces)! } : {}),
    });
  }
  return out;
}

/** 한국어 이름·종류 id로 종류를 찾는다(낱말마다 조사를 떼고 모두 맞는 것). 짧은 이름이 먼저. */
export function findTypes(catalog: Map<string, TypeInfo>, query: string): TypeInfo[] {
  const tokens = query.split(/\s+/).map((t) => compact(t)).filter(Boolean);
  if (tokens.length === 0) return [];
  const hay = (t: TypeInfo) => compact(t.label) + " " + t.type.toLowerCase();
  const hit = (t: TypeInfo, token: string) => hay(t).includes(token) || hay(t).includes(stripParticle(token));
  return [...catalog.values()]
    .filter((t) => t.mount !== "opening" && t.category !== "structure")
    .filter((t) => tokens.every((token) => hit(t, token)))
    .sort((a, b) => a.label.length - b.label.length || a.type.localeCompare(b.type));
}
