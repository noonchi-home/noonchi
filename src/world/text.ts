// PAM 관찰 텍스트: 시각이 붙은 줄(오래된 것부터) + [지속] 오래 이어진 사실 + [눈] 클로이드 눈이 있는 방 이름. 사진은 넣지 않는다.
import type { WorldChange, WorldFact, WorldView } from "../contract/world.js";
import { CHANGE_TEXT, EYE_TEXT, OUT_OF_VIEW_NOW, PLACE_UNKNOWN, ROOM_UNKNOWN, STATE_TEXT, objectName, onSurface } from "./labels.js";

export interface TimedLine { atMs: number; text: string }

const pad = (n: number) => String(n).padStart(2, "0");

/** ms → 그 시간대(분)의 시:분:초. */
export function clock(ms: number, offsetMinutes: number): string {
  const d = new Date(ms + offsetMinutes * 60_000);
  return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
}

/** 시각 순으로 줄을 쓰고, 이어진 같은 글은 「처음~마지막 글 N번」 한 줄로 묶는다. */
export function collapseLines(lines: TimedLine[], offsetMinutes: number): string[] {
  const sorted = [...lines].sort((a, b) => a.atMs - b.atMs);
  const out: string[] = [];
  for (let i = 0; i < sorted.length; ) {
    let j = i;
    while (j + 1 < sorted.length && sorted[j + 1]!.text === sorted[i]!.text) j++;
    const first = clock(sorted[i]!.atMs, offsetMinutes);
    out.push(j === i ? `${first} ${sorted[i]!.text}` : `${first}~${clock(sorted[j]!.atMs, offsetMinutes)} ${sorted[i]!.text} ${j - i + 1}번`);
    i = j + 1;
  }
  return out;
}

export function buildPamText(o: { lines: TimedLine[]; facts: string[]; eye?: string | null; offsetMinutes: number; maxLines?: number }): string {
  return [
    ...collapseLines(o.lines, o.offsetMinutes).slice(-(o.maxLines ?? 40)),
    ...o.facts.map((f) => `[지속] ${f}`),
    ...(o.eye ? [`[눈] ${o.eye}`] : []),
  ].join("\n");
}

/** 오래 이어진 시간: 1분 아래는 초째, 그 위는 분째. */
const lasting = (ms: number) => (ms < 60_000 ? `${Math.max(0, Math.round(ms / 1000))}초째` : `${Math.floor(ms / 60_000)}분째`);

/** World State → PAM 관찰 텍스트: 최근 windowMs(기본 60초)의 변화 줄 + 오래 이어진 사실(물건·사람·상태가 있는 가전) + 눈 위치. */
export function textFromWorld(world: WorldView, recent: readonly WorldChange[], o: { nowMs: number; offsetMinutes: number; windowMs?: number }): string {
  const since = o.nowMs - (o.windowMs ?? 60_000);
  const lines = recent.filter((c) => c.at_ms >= since && c.at_ms <= o.nowMs).map((c) => ({ atMs: c.at_ms, text: c.text }));
  const at = (ms: number) => clock(ms, o.offsetMinutes);
  const facts: string[] = [];
  for (const ob of world.objects.filter((x) => x.status !== "gone")) {
    const place = ob.facts.place;
    const where = ob.surface_label ? onSurface(ob.surface_label) : place ? STATE_TEXT[place.value] ?? place.value : PLACE_UNKNOWN;
    const extra = (Object.entries(ob.facts) as [string, WorldFact | undefined][])
      .filter(([k, f]) => f && k !== "place").map(([, f]) => STATE_TEXT[f!.value] ?? f!.value);
    facts.push(`${objectName(ob.cls, ob.id)} ${where}${extra.length ? ` · ${extra.join(" · ")}` : ""}: ${at(ob.first_seen_ms)}부터 ${lasting(o.nowMs - ob.first_seen_ms)}, 마지막 확인 ${at(ob.last_seen_ms)}${ob.status === "out_of_view" ? `, ${OUT_OF_VIEW_NOW}` : ""}`);
  }
  const person = world.person.visible ? CHANGE_TEXT.personAppeared : CHANGE_TEXT.personGone;
  facts.push(world.person.since_ms === null ? person : `${person}: ${at(world.person.since_ms)}부터 ${lasting(o.nowMs - world.person.since_ms)}`);
  for (const d of world.devices.filter((x) => x.status)) {
    facts.push(`${d.label} ${d.id}: ${d.status}, ${at(d.changed_ms)}에 바뀜${d.remaining_min !== null ? `, ${CHANGE_TEXT.remaining(d.remaining_min)}` : ""}`);
  }
  const eye = world.eye ? `${EYE_TEXT} ${world.eye.room_label ?? ROOM_UNKNOWN}` : null;
  return buildPamText({ lines, facts, eye, offsetMinutes: o.offsetMinutes });
}
