// 글에서 방 이름 찾기: 방 이름 변형·별칭으로 찾고, 긴 변형이 먼저 자리를 차지한다. 에이전트 기기 찾기와 배치 편집기가 같이 쓴다(도메인 나누기 F4).

import type { RoomSpec } from "../contract/devices.js";
import { compact } from "../shared/korean.js";

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
