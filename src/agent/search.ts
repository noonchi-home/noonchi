// 한국어 이름·방 이름으로 기기 찾기(find_devices, list_devices의 room 인자).
// 순서: 방 찾기(긴 이름 우선) → 방만 말했으면 그 방 전체 → 이름 구절 일치 → 낱말(이름·종류 동의어) AND 일치.

import type { DeviceSpec, RoomSpec } from "../contract/devices.js";
import type { DeviceKind } from "../devices/kinds.js";
import { KINDS, mapEntries } from "../devices/kinds.js";
import { KIND_LABELS } from "../devices/index.js";
import { compact, stripParticle } from "../shared/korean.js";
import { detectRooms } from "../layout/index.js";

/** 종류별로 사람들이 부르는 말(소문자, 띄어쓰기 없음, 등록부 synonyms). */
export const KIND_SYNONYMS: Record<DeviceKind, readonly string[]> = mapEntries(KINDS, (e) => e.synonyms);

const STOPWORDS = new Set(["좀", "다", "모든", "모두", "전부", "전체", "것", "거", "기기", "장치", "방", "집", "우리", "있는"]);

function tokenMatches(token: string, d: DeviceSpec): boolean {
  if (compact(d.label).includes(token)) return true;
  if (KIND_SYNONYMS[d.kind].includes(token)) return true;
  return compact(KIND_LABELS[d.kind]) === token;
}

export interface FindResult {
  rooms: string[];     // 글에서 찾은 방 id
  tokens: string[];    // 기기를 고르는 데 쓴 낱말
  devices: DeviceSpec[];
}

export function findDevices(query: string, devices: DeviceSpec[], rooms: RoomSpec[]): FindResult {
  const { rooms: found, rest } = detectRooms(query, rooms);
  const roomIds = found.map((r) => r.id);
  const inRooms = roomIds.length > 0 ? devices.filter((d) => roomIds.includes(d.room)) : devices;
  const raw = rest.split(/\s+/).map((t) => compact(t)).filter((t) => t.length > 0);
  // 낱말: 그대로 맞는 기기가 없으면 조사를 떼어 본다. 아무 기기와도 안 맞는 말(좀, 큰…)은 버린다.
  const tokens: string[] = [];
  for (const t of raw) {
    if (STOPWORDS.has(t)) continue;
    const cand = devices.some((d) => tokenMatches(t, d)) ? t : stripParticle(t);
    if (STOPWORDS.has(cand)) continue;
    if (devices.some((d) => tokenMatches(cand, d))) tokens.push(cand);
  }

  if (tokens.length === 0) {
    return { rooms: roomIds, tokens, devices: roomIds.length > 0 ? inRooms : [] };
  }

  // 이름 구절 일치(예: "거실 TV", "다용도실 문", "안방 욕실 등")
  const words = query.split(/\s+/).filter(Boolean);
  const phrases = new Set([compact(query), words.map((w) => compact(stripParticle(w))).join("")]);
  const byPhrase = devices.filter((d) => [...phrases].some((p) => p.length >= 2 && compact(d.label).includes(p)));
  if (byPhrase.length > 0) return { rooms: roomIds, tokens, devices: byPhrase };

  const byTokens = inRooms.filter((d) => tokens.every((t) => tokenMatches(t, d)));
  return { rooms: roomIds, tokens, devices: byTokens };
}
