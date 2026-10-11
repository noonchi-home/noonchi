// 한국어 이름·방 이름으로 기기 찾기(find_devices, list_devices의 room 인자).
// 순서: 방 찾기(긴 이름 우선) → 방만 말했으면 그 방 전체 → 이름 구절 일치 → 낱말(이름·종류 동의어) AND 일치.

import type { DeviceKind, DeviceSpec, RoomSpec } from "../hub/types.js";
import { KIND_LABELS } from "../model/mapping.js";

/** 종류별로 사람들이 부르는 말(소문자, 띄어쓰기 없음). */
export const KIND_SYNONYMS: Record<DeviceKind, string[]> = {
  light: ["불", "조명", "등", "전등", "전구", "램프", "라이트"],
  plug: ["플러그", "콘센트"],
  tv: ["tv", "티비", "텔레비전", "테레비"],
  speaker: ["스피커"],
  aircon: ["에어컨", "에어콘", "냉방기"],
  purifier: ["공기청정기", "청정기"],
  fan: ["팬", "환풍기", "선풍기", "가습기"],
  hood: ["후드", "레인지후드"],
  cooktop: ["인덕션", "쿡탑", "가스레인지", "화구"],
  microwave: ["전자레인지", "전자렌지"],
  dishwasher: ["식기세척기", "식세기"],
  washer: ["세탁기"],
  dryer: ["건조기"],
  fridge: ["냉장고"],
  vacuum: ["로봇청소기", "청소기", "로청"],
  covering: ["커튼", "블라인드"],
  lock: ["현관문", "도어락", "도어록", "문", "현관"],
  contact: ["문"],
  valve: ["물", "수도", "수전", "샤워", "싱크"],
  thermostat: ["보일러", "난방"],
  status: ["충전대"],
};

/** 방 별칭 → 방 이름(label). 그 이름의 방이 있을 때만 쓴다. */
const ROOM_ALIASES: Record<string, string> = {
  부엌: "주방·식당",
  키친: "주방·식당",
  화장실: "공용 욕실",
  욕실: "공용 욕실",
  베란다: "다용도실(발코니)",
  세탁실: "다용도실(발코니)",
  침실: "안방",
  큰방: "안방",
  공부방: "서재",
  아이방: "작은방",
  리빙룸: "거실",
};

const PARTICLES = ["에서", "으로", "이랑", "한테", "까지", "부터", "랑", "을", "를", "이", "가", "은", "는", "도", "의", "에", "로", "만", "좀"];
const STOPWORDS = new Set(["좀", "다", "모든", "모두", "전부", "전체", "것", "거", "기기", "장치", "방", "집", "우리", "있는"]);

/** 비교용: 소문자, 괄호 안·띄어쓰기·가운뎃점·문장부호 제거. */
export function compact(s: string): string {
  return s.toLowerCase().replace(/\([^)]*\)/g, "").replace(/[\s·.,!?~'"]/g, "");
}

function stripParticle(token: string): string {
  for (const p of PARTICLES) {
    if (token.length > p.length && token.endsWith(p)) return token.slice(0, -p.length);
  }
  return token;
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** 방 이름 변형: 전체, 괄호 앞, 가운뎃점으로 나눈 부분, 괄호 안, id, 욕실→화장실, 별칭. */
function roomVariants(room: RoomSpec): string[] {
  const label = room.label;
  const base = label.replace(/\([^)]*\)/g, "").trim();
  const inner = [...label.matchAll(/\(([^)]*)\)/g)].map((m) => m[1] ?? "");
  const parts = base.split("·");
  const out = [label, base, ...parts, ...inner, room.id];
  for (const v of [...out]) if (v.includes("욕실")) out.push(v.replace("욕실", "화장실"));
  for (const [alias, target] of Object.entries(ROOM_ALIASES)) if (target === label) out.push(alias);
  return [...new Set(out.map(compact).filter((v) => v.length >= 2))];
}

/** 띄어쓰기를 무시하고 변형을 찾는 정규식(예: "안방욕실" → /안\s*방\s*욕\s*실/). */
function looseRe(variant: string): RegExp {
  return new RegExp([...variant].map(escapeRe).join("\\s*"), "gi");
}

export interface RoomMatch {
  rooms: RoomSpec[];
  rest: string; // 방 이름을 뺀 나머지 글
}

/** 글에서 방 이름을 찾는다. 긴 변형이 먼저 자리를 차지한다(안방 욕실 > 안방, 욕실). */
export function detectRooms(text: string, rooms: RoomSpec[]): RoomMatch {
  const cands: { room: RoomSpec; variant: string }[] = [];
  for (const room of rooms) for (const variant of roomVariants(room)) cands.push({ room, variant });
  cands.sort((a, b) => b.variant.length - a.variant.length);
  const taken: boolean[] = new Array(text.length).fill(false);
  const found: RoomSpec[] = [];
  for (const { room, variant } of cands) {
    for (const m of text.matchAll(looseRe(variant))) {
      const start = m.index ?? 0;
      const end = start + m[0].length;
      if (taken.slice(start, end).some(Boolean)) continue;
      for (let i = start; i < end; i++) taken[i] = true;
      if (!found.includes(room)) found.push(room);
    }
  }
  const rest = [...text].map((ch, i) => (taken[i] ? " " : ch)).join("").replace(/\s+/g, " ").trim();
  return { rooms: found, rest };
}

/** list_devices의 room 인자: id, 이름, 변형·별칭 중 하나. */
export function resolveRoom(text: string, rooms: RoomSpec[]): RoomSpec | undefined {
  const t = text.trim();
  const exact = rooms.find((r) => r.id === t || r.label === t);
  if (exact) return exact;
  const c = compact(t);
  const byVariant = rooms.find((r) => roomVariants(r).includes(c));
  if (byVariant) return byVariant;
  const d = detectRooms(t, rooms);
  return d.rooms.length === 1 && compact(d.rest) === "" ? d.rooms[0] : undefined;
}

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
