// PAM 관찰 텍스트: 시각이 붙은 줄(오래된 것부터) + [지속] 오래 이어진 사실 + [때] 날짜·요일·하루 때 + [눈] 클로이드 눈이 있는 방 이름. 사진은 넣지 않는다.
import type { Facet, WorldChange, WorldFact, WorldView } from "../contract/world.js";
import { CHANGE_TEXT, EYE_TEXT, OBJECT_NAME, OUT_OF_VIEW_NOW, PLACE_UNKNOWN, ROOM_UNKNOWN, STATE_TEXT, dayText, fixtureName, objectName, onSurface } from "./labels.js";
import { RELATED_KINDS } from "./relations.js";
import { FACT_FRESH_MS, NOW_FACETS, type Target } from "./vocab.js";

export interface TimedLine { atMs: number; text: string }

const pad = (n: number) => String(n).padStart(2, "0");

/** ms → 그 시간대(분)의 시:분:초. */
export function clock(ms: number, offsetMinutes: number): string {
  const d = new Date(ms + offsetMinutes * 60_000);
  return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
}

/** [때] 글: 그 시간대의 날짜·요일·하루 때(11월 7일 토요일 밤). */
export function timeText(ms: number, offsetMinutes: number): string {
  const d = new Date(ms + offsetMinutes * 60_000);
  return dayText(d.getUTCMonth() + 1, d.getUTCDate(), d.getUTCDay(), d.getUTCHours());
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

export function buildPamText(o: { lines: TimedLine[]; facts: string[]; time?: string | null; eye?: string | null; offsetMinutes: number; maxLines?: number }): string {
  return [
    ...collapseLines(o.lines, o.offsetMinutes).slice(-(o.maxLines ?? 40)),
    ...o.facts.map((f) => `[지속] ${f}`),
    ...(o.time ? [`[때] ${o.time}`] : []),
    ...(o.eye ? [`[눈] ${o.eye}`] : []),
  ].join("\n");
}

/** 오래 이어진 시간: 1분 아래는 초째, 그 위는 분째. */
const lasting = (ms: number) => (ms < 60_000 ? `${Math.max(0, Math.round(ms / 1000))}초째` : `${Math.floor(ms / 60_000)}분째`);

/** 바뀐 지 이만큼 안 된 가전은 꺼짐·멈춤이어도 [지속] 줄에 둔다. */
const RECENT_DEVICE_MS = 600_000;
/** 사람 [지속] 사실 줄의 면 순서. 순간 동작은 변화 줄로만 낸다. */
const PERSON_ORDER: readonly Facet[] = ["posture", "place", "holding", "activity"];
const factText = (f: WorldFact | undefined) => (f ? STATE_TEXT[f.value] ?? f.value : null);
/** 지금만 맞는 면의 사실이 FACT_FRESH_MS보다 오래됐으면 지금 사실로 쓰지 않는다(VLM 답이 끊김). */
const current = (target: Target, facet: string, f: WorldFact | undefined, nowMs: number) =>
  f && (!(NOW_FACETS[target] as readonly string[]).includes(facet) || nowMs - f.at_ms <= FACT_FRESH_MS) ? f : undefined;
const said = (xs: (string | null)[]) => xs.filter((t): t is string => t !== null);

/** World State → PAM 관찰 텍스트: 최근 windowMs(기본 60초)의 변화 줄 + 오래 이어진 사실(물건·가전 설비·사람·가전) + 때 + 눈 위치.
 *  가전은 켜짐·작동 중·열림 같은 상태이거나, 관련 가전(식기세척기·냉장고)이거나, 10분 안에 바뀐 것만 둔다. 카메라로 본 상태면 줄 끝에 마지막으로 본 시각. */
export function textFromWorld(world: WorldView, recent: readonly WorldChange[], o: { nowMs: number; offsetMinutes: number; windowMs?: number }): string {
  const since = o.nowMs - (o.windowMs ?? 60_000);
  const lines = recent.filter((c) => c.at_ms >= since && c.at_ms <= o.nowMs).map((c) => ({ atMs: c.at_ms, text: c.text }));
  const at = (ms: number) => clock(ms, o.offsetMinutes);
  const facts: string[] = [];
  for (const ob of world.objects.filter((x) => x.status !== "gone")) {
    const place = ob.facts.place;
    const where = ob.surface_label ? onSurface(ob.surface_label) : place ? STATE_TEXT[place.value] ?? place.value : PLACE_UNKNOWN;
    const extra = (Object.entries(ob.facts) as [string, WorldFact | undefined][])
      .filter(([k, f]) => current("object", k, f, o.nowMs) && k !== "place").map(([, f]) => STATE_TEXT[f!.value] ?? f!.value);
    facts.push(`${objectName(ob.cls, ob.id)} ${where}${extra.length ? ` · ${extra.join(" · ")}` : ""}: ${at(ob.first_seen_ms)}부터 ${lasting(o.nowMs - ob.first_seen_ms)}, 마지막 확인 ${at(ob.last_seen_ms)}${ob.status === "out_of_view" ? `, ${OUT_OF_VIEW_NOW}` : ""}`);
  }
  for (const f of world.fixtures) {
    const values = said((Object.entries(f.facts) as [string, WorldFact | undefined][]).map(([k, v]) => factText(current("fixture", k, v, o.nowMs))));
    if (values.length) facts.push(`${fixtureName(f.cls, f.id, f.room_label)} ${values.join(" · ")}: 마지막 확인 ${at(f.last_seen_ms)}`);
  }
  const p = world.person;
  const label = (id: string) => world.devices.find((d) => d.id === id)?.label ?? id;
  const about = p.visible
    ? [CHANGE_TEXT.personAppeared, ...(p.count > 1 ? [CHANGE_TEXT.people(p.count)] : []), ...(p.room_label ? [p.room_label] : []),
      ...p.near.map((id) => CHANGE_TEXT.near(label(id)))].join(" · ")
    : CHANGE_TEXT.personGone;
  facts.push(p.since_ms === null ? about : `${about}: ${at(p.since_ms)}부터 ${lasting(o.nowMs - p.since_ms)}`);
  // 사람 사실은 줄마다 그 값이 처음 보인 시각부터 센다(보임 시각과 다르다)
  for (const k of PERSON_ORDER) {
    const f = p.visible ? current("person", k, p.facts[k], o.nowMs) : undefined;
    if (f) facts.push(`${CHANGE_TEXT.state(OBJECT_NAME.person!, f.value)}: ${at(f.since_ms)}부터 ${lasting(o.nowMs - f.since_ms)}`);
  }
  for (const d of world.devices.filter((x) => x.status && (x.active || RELATED_KINDS.has(x.kind) || (x.event_ms !== null && o.nowMs - x.event_ms <= RECENT_DEVICE_MS)))) {
    const from = d.event_ms ?? d.changed_ms;
    facts.push(`${d.label} ${d.id}: ${d.status}, ${at(from)}부터 ${lasting(o.nowMs - from)}${d.remaining_min !== null ? `, ${CHANGE_TEXT.remaining(d.remaining_min)}` : ""}${d.vision ? `, ${CHANGE_TEXT.seenAt(at(d.vision.at_ms))}` : ""}`);
  }
  const eye = world.eye ? `${EYE_TEXT} ${world.eye.room_label ?? ROOM_UNKNOWN}` : null;
  return buildPamText({ lines, facts, time: timeText(o.nowMs, o.offsetMinutes), eye, offsetMinutes: o.offsetMinutes });
}
