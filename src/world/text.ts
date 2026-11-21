// PAM 관찰 텍스트: 시각이 붙은 줄(오래된 것부터) + [지속] 오래 이어진 사실 + [때] 날짜·요일·하루 때 + [눈] 클로이드 눈이 있는 방 이름. 사진은 넣지 않는다.
import type { Facet, WorldChange, WorldFact, WorldView } from "../contract/world.js";
import { CHANGE_TEXT, EYE_TEXT, GUESS, OBJECT_NAME, OUT_OF_VIEW_NOW, PLACE_UNKNOWN, ROOM_UNKNOWN, STATE_TEXT, dayText, fixtureName, inBasin, objectName, onSurface } from "./labels.js";
import { RELATED_KINDS } from "./relations.js";
import { DRINKWARE, FACT_FRESH_MS, NOW_FACETS, STATES, type StateKey, type Target } from "./vocab.js";
import { headWithin } from "../shared/cut.js";

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

/** PAM 판단 관찰 텍스트 상한(글자 수, pam-predict/3(src/brain/pam/request.ts)와 같다). textFromWorld는 이 안으로 만든다. 판단 보내기 전 검사(brain)도 이 값을 쓴다. */
export const PAM_TEXT_MAX = 20_000;

/** 오래 이어진 시간: 1분 아래는 초째, 그 위는 분째. */
const lasting = (ms: number) => (ms < 60_000 ? `${Math.max(0, Math.round(ms / 1000))}초째` : `${Math.floor(ms / 60_000)}분째`);

/** 사람 곁 면: 사람 자리에서 면 가운데까지 이만큼(m) 안(책상 의자·식탁 의자에서 그 면 가운데는 0.5~1m). */
const SURFACE_NEAR_M = 1.5;
/** 바뀐 지 이만큼 안 된 가전은 꺼짐·멈춤이어도 [지속] 줄에 둔다. */
const RECENT_DEVICE_MS = 600_000;
/** 사람 [지속] 사실 줄의 면 순서. 순간 동작은 변화 줄로만 낸다. */
const PERSON_ORDER: readonly Facet[] = ["posture", "place", "holding", "activity"];
const factText = (f: WorldFact | undefined) => (f ? STATE_TEXT[f.value] ?? f.value : null);
/** 지금만 맞는 면의 사실이 FACT_FRESH_MS보다 오래됐으면 지금 사실로 쓰지 않는다(VLM 답이 끊김). */
const current = (target: Target, facet: string, f: WorldFact | undefined, nowMs: number) =>
  f && (!(NOW_FACETS[target] as readonly string[]).includes(facet) || nowMs - f.at_ms <= FACT_FRESH_MS) ? f : undefined;
const said = (xs: (string | null)[]) => xs.filter((t): t is string => t !== null);
/** 손에 있음을 뺀 물건 자리 값 글(바닥·조리대 위·책상 위…). */
const PLACE_WORDS = (Object.keys(STATES) as StateKey[]).filter((k) => STATES[k].facet === "place" && k !== "in_hand").map((k) => STATE_TEXT[k] ?? k);

/** World State → PAM 관찰 텍스트: 최근 windowMs(기본 60초)의 변화 줄 + 오래 이어진 사실(물건·가전 설비·사람·가전) + 때 + 눈 위치.
 *  가전은 켜짐·작동 중·열림 같은 상태이거나, 관련 가전(식기세척기·냉장고)이거나, 10분 안에 바뀐 것만 둔다. 카메라로 본 상태면 줄 끝에 마지막으로 본 시각. */
export function textFromWorld(world: WorldView, recent: readonly WorldChange[], o: { nowMs: number; offsetMinutes: number; windowMs?: number }): string {
  const since = o.nowMs - (o.windowMs ?? 60_000);
  // 싱크볼 안 물건의 VLM 자리 변화 줄(손에 있음 말고)도 쓰지 않는다(아래 [지속] 줄과 같은 까닭)
  const inBasinIds = new Set(world.objects.filter((x) => x.surface_label !== null && x.surface_part === "basin").map((x) => x.id));
  const placeWord = (c: WorldChange) => PLACE_WORDS.some((w) => c.text.endsWith(` ${w}`));
  const lines = recent
    .filter((c) => c.at_ms >= since && c.at_ms <= o.nowMs && !(c.kind === "state" && inBasinIds.has(c.subject) && placeWord(c)))
    .map((c) => ({ atMs: c.at_ms, text: c.text }));
  const at = (ms: number) => clock(ms, o.offsetMinutes);
  // 물건: 첫 줄은 트윈 면(위치로 정한 것, 없으면 자리 모름)과 처음 본 때·마지막 확인. 사실은 줄마다 그 값이 처음 보인 시각부터 세고,
  // VLM 한 장만 보고 붙인 값(짐작)은 표시한다. 한 장에서 짐작한 「비어 있음」을 물건을 처음 본 때부터 이어진 것처럼 쓰지 않는다(2026-11-16 밤 판정 F·E).
  // 놓인 곳(place)도 면 자리와 같은 값이어도 그 줄을 둔다(값이 바뀌었다 돌아온 시각·짐작을 잃지 않게)
  const objects: ObjectLines[] = world.objects.filter((x) => x.status !== "gone").map((ob) => {
    const name = objectName(ob.cls, ob.id);
    // 싱크볼 안 물건은 「<싱크대> 안 · 치움」으로 쓰고 VLM 자리 답(손에 있음 말고)은 쓰지 않는다: 싱크대 컵의 VLM 자리 답은 22장 중 바닥·조리대 16장,
    // 싱크대 안 0장이었고(2026-11-16 판정), 「책상 위(짐작)」를 본 PAM이 치운 컵을 다시 치우기로 골랐다(23:48)
    const basin = ob.surface_label !== null && ob.surface_part === "basin";
    const where = ob.surface_label ? (basin ? inBasin(ob.surface_label) : onSurface(ob.surface_label)) : PLACE_UNKNOWN;
    const lines = [`${name} ${where}: ${at(ob.first_seen_ms)}부터 ${lasting(o.nowMs - ob.first_seen_ms)}, 마지막 확인 ${at(ob.last_seen_ms)}${ob.status === "out_of_view" ? `, ${OUT_OF_VIEW_NOW}` : ""}`];
    for (const [k, f] of Object.entries(ob.facts) as [string, WorldFact | undefined][]) {
      if (!current("object", k, f, o.nowMs)) continue;
      if (basin && k === "place" && f!.value !== "in_hand") continue;
      // 사람이 말로 답한 값은 꼬리를 붙인다(내용물, src/world/state/contents.ts)
      lines.push(`${name} ${STATE_TEXT[f!.value] ?? f!.value}${f!.certainty === "inferred" ? `(${GUESS})` : ""}: ${at(f!.since_ms)}부터 ${lasting(o.nowMs - f!.since_ms)}`);
    }
    // 손에 든 물건(손에 있음 사실이거나 사람이 들고 있음)은 넘쳐도 덜어 내지 않는다
    const held = ob.facts.place?.value === "in_hand" || world.person.holding.includes(ob.id);
    return { lines, out: ob.status === "out_of_view", last: ob.last_seen_ms, held };
  });
  const facts: string[] = [];
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
  // 사람 곁(같은 방, 면 가운데가 SURFACE_NEAR_M 안) 면을 방금(FACT_FRESH_MS 안) 본 사진에 그 면 위 컵·병이 없으면 「그 면 위 마실 것 없음」
  if (p.visible && p.position) {
    for (const s of world.surfaces_seen ?? []) {
      if (o.nowMs - s.seen_ms > FACT_FRESH_MS || s.room !== p.room || Math.hypot(s.center[0] - p.position[0], s.center[1] - p.position[1]) > SURFACE_NEAR_M) continue;
      if (world.objects.some((x) => x.status !== "gone" && x.surface === s.id && (DRINKWARE as readonly string[]).includes(x.cls))) continue;
      facts.push(`${CHANGE_TEXT.noDrink(s.label)}: ${at(s.seen_ms)} 확인`);
    }
  }
  for (const d of world.devices.filter((x) => x.status && (x.active || RELATED_KINDS.has(x.kind) || (x.event_ms !== null && o.nowMs - x.event_ms <= RECENT_DEVICE_MS)))) {
    const from = d.event_ms ?? d.changed_ms;
    facts.push(`${d.label} ${d.id}: ${d.status}, ${at(from)}부터 ${lasting(o.nowMs - from)}${d.remaining_min !== null ? `, ${CHANGE_TEXT.remaining(d.remaining_min)}` : ""}${d.vision ? `, ${CHANGE_TEXT.seenAt(at(d.vision.at_ms))}` : ""}`);
  }
  const eye = world.eye ? `${EYE_TEXT} ${world.eye.room_label ?? ROOM_UNKNOWN}` : null;
  const time = timeText(o.nowMs, o.offsetMinutes);
  return fitText(objects, (keep, maxLines) =>
    buildPamText({ lines, facts: [...keep.flatMap((x) => x.lines), ...facts], time, eye, offsetMinutes: o.offsetMinutes, maxLines }));
}

/** 변화 줄 기본 상한(buildPamText maxLines). */
const MAX_CHANGE_LINES = 40;

/**
 * PAM 상한(PAM_TEXT_MAX) 안으로 맞춘다. 넘치면 차례로 덜어 낸다: 시야 밖 물건(오래된 것부터) → 오래된 변화 줄(가장 새 줄 하나는 남김) → 보이는 물건(오래된 것부터).
 * 손에 든 물건과 사람·가전·때·눈 줄은 덜어 내지 않는다. 그래도 넘치면(아주 긴 요약·가전 줄) 줄마다 같은 길이로 잘라 꼭 상한 안으로 만든다.
 */
function fitText(objects: readonly ObjectLines[], render: (keep: readonly ObjectLines[], maxLines: number) => string): string {
  let keep = [...objects];
  let maxLines = MAX_CHANGE_LINES;
  let text = render(keep, maxLines);
  const over = () => text.length > PAM_TEXT_MAX;
  const dropOldest = (pick: (x: ObjectLines) => boolean) => {
    for (const x of objects.filter((y) => pick(y) && !y.held).sort((a, b) => a.last - b.last)) {
      if (!over()) return;
      keep = keep.filter((y) => y !== x);
      text = render(keep, maxLines);
    }
  };
  dropOldest((x) => x.out);
  while (over() && maxLines > 1) text = render(keep, --maxLines);
  dropOldest((x) => !x.out);
  if (!over()) return text;
  // 지켜야 할 줄만으로도 넘친다: 줄마다 같은 길이(cap)로 잘라 맞춘다. 가장 긴 cap을 반씩 찾아 고른다
  const lines = text.split("\n");
  const cut = (cap: number) => lines.map((l) => (l.length > cap ? `${headWithin(l, cap - 1)}…` : l)).join("\n");
  let lo = 1, hi = Math.max(...lines.map((l) => l.length));
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (cut(mid).length <= PAM_TEXT_MAX) lo = mid;
    else hi = mid - 1;
  }
  return headWithin(cut(lo), PAM_TEXT_MAX);
}

/** 물건 하나의 [지속] 줄(면 줄 + 사실 줄)과 덜어 낼 차례를 정하는 값: 지금 시야 밖인가, 마지막으로 본 시각, 손에 들었는가(덜어 내지 않음). */
interface ObjectLines { lines: string[]; out: boolean; last: number; held: boolean }
