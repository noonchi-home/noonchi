// 시나리오 1 합성 기록을 만든다: npx tsx scripts/scenario1-compose.ts [--out <파일>] (기본 tests/fixtures/scenario1/judgment-composed.ndjson)
// 집에서 일어나는 일(아래 SCENES·LEGS·VARIANTS)과 시스템 재생에서 읽은 것으로 줄을 만든다. 시험은 이 스크립트를 부르지 않고 기록 파일만 읽는다.
// - 폰 구간: 출발은 그 자리로 보낸 가기 명령 + 반응 1.5초(+ hold)를 0.1초 단위로 올림, 도착은 출발 + 시스템 안내 길을 0.8m/s로 걷는 시간(minWalk 이상)을 0.05초 단위로 올림.
// - 사진: 첫 촬영 1.5초부터 시청자가 떠난 12.95초 뒤 앞까지 시스템 VLM 간격(재생 틱마다 빠름 1초·보통 2초, nextVlmCapture). 답 지연은 사진 차례대로 LAGS를 돈다.
// - 사진 내용: 그 촬영 시각의 사람 장면(SCENES). 프레임은 장면·컵 상태마다 정해진 차례를 돈다: 식탁 T, 거실 L, 손에 든 컵 e410(들기 명령 1초 뒤부터), 싱크대 S(넣기 명령 1초 뒤부터).
// - 사람은 시스템이 컵을 치울 준비로 본(ready) 3초 뒤 식탁을 떠나 2초 뒤 소파에서 TV를 본다.
// - 시청자는 거실 복귀 도착 4.25초 뒤 떠나고, 떠난 5초 뒤 돌아온다.
// - PAM은 대기 자리 도착 뒤 첫 시청 사진의 답 0.35초 뒤에 답한다.
// 가기 명령·VLM 간격·명령 시각은 재생(tests/helpers/scenario1-replay.ts)을 되풀이해 줄이 바뀌지 않을 때까지 맞춘다. 길(걷는 시간)이 바뀌면 이 스크립트를 다시 돌린다.
import { writeFileSync } from "node:fs";
import { nextVlmCapture } from "../tests/helpers/home-realism.js";
import { composedWalkMs, replayScenario, useComposedRows, type ReplaySeen, type Variant } from "../tests/helpers/scenario1-replay.js";

type Row = Record<string, unknown>;
const OUT = process.argv.includes("--out") ? process.argv[process.argv.indexOf("--out") + 1]! : "tests/fixtures/scenario1/judgment-composed.ndjson";

const METADATA: Row = {"kind": "metadata", "name": "시나리오 1 합성(composed)", "home": "mokryeon_180b", "learned_discard": true, "recording": "tests/fixtures/replay/wide-mug-v1.json", "source": "Rows are what happens in the home: where the resident is (fridge, table, sofa), device events, phone arrivals and when the viewer leaves. Every photo row has its capture time and the VLM answer lag (1.5-2.0 s; measured average nano 1.6 s, mini 1.8 s) at the system's VLM interval. The replay builds each photo from the phone camera at that moment (the spot the phone stands at, facing that spot's look_at, landscape 40 deg vertical view, 1.15 m, 10 deg down): only what is inside that view is in the photo. Frame references copy only the recorded VLM cup and drinking observations. The phone reacts after 1.5 s and follows the issued doorways and waypoints at up to 0.8 m/s. The living-room standby position is by the wall after the turn, facing both the TV and the sofa. Appliance recognition is composed from camera visibility and appliance state. A person is counted when the torso is in view and located only when the feet are in view. A held cup is in front of the camera. PAM answers after the first watching answer."};
const PLAN_RESPONSE: Row = {"kind": "plan_response", "source": "composed submit_plan response for this fixture; original cup id bound by the planner", "steps": [{"kind": "go", "act": "가기", "target": "dining_table_978b20c7", "until": {"phone_near": "dining_table_978b20c7"}, "timeout_s": 120}, {"kind": "pick", "act": "들기", "target": "cup_1", "until": {"object": "cup_1", "follow": true, "facts": {"place": "in_hand"}}, "timeout_s": 120}, {"kind": "go", "act": "가기", "target": "sink_counter_kitchen", "until": {"phone_near": "sink_counter_kitchen"}, "timeout_s": 120}, {"kind": "place", "act": "넣기", "target": "sink_counter_kitchen", "object": "cup_1", "until": {"all": [{"object": "cup_1", "follow": true, "facts": {"place": "in_sink"}}, {"not": {"person_holding": "cup_1"}}]}, "timeout_s": 120}]};
const SOURCE = {
  initial: "composed",
  fridgeOpen: "composed: the resident opens the fridge",
  start: "composed phone start spot",
  walk: "composed phone: departs after the go command, walks straight at 0.8 m/s, arrives",
  left: "composed: the viewer leaves the sofa",
  photo: "composed resident place; the VLM answer arrives lag ms after capture",
  pam: "composed: PAM answers 350 ms after the first watching answer",
  framePhoto: (frame: string) => `wide-mug-v1#${frame} (VLM cup/drinking observation); composed resident place; answer arrives lag ms after capture`,
  variants: {"back": "composed: the resident leaves the table and comes back to the same meal; the phone stays at the table watch spot", "brief": "composed: the viewer stands, is briefly hidden, then sits again; the zone is never empty for 2 s", "manual": "composed external power off; the TV rule stops watching, so photos return to 2 s", "cadence_wrong": "deliberately wrong: keeps 1 s photos after a manual off, when the TV rule no longer watches", "lag_missing": "deliberately wrong: a photo row without lag would arrive at its capture time", "lag_zero": "deliberately wrong: an answer cannot arrive at its capture time", "arrive_early": "deliberately wrong: the phone reaches the table watch spot before it could walk there after the go command", "pam_seated": "2026-11-25 example run: the resident sits at the table with the cup set down (VLM 쉬거나 자는 중) and PAM answers drinking[*] (컵 치우기) with the label temp state while the resident is still there; the resident leaves at 24.3 s as in normal"} as Record<string, string>,
};

const TABLE = "dining_table_978b20c7", SINK = "sink_counter_kitchen";
/** 답 지연(ms): 사진 차례대로 돈다. */
const LAGS = [1700, 1500, 1900, 1600, 1800];
/** 첫 촬영(ms), 시청자가 떠난 뒤 마지막 촬영까지(ms). 떠난 때를 모르면 95초까지. */
const PHOTO_START = 1500, PHOTO_AFTER_LEFT_MS = 12950, PHOTO_END = 95000;
/** 폰이 가기 명령을 받고 걷기 시작하기까지(ms). */
const REACT_MS = 1500;
/** 폰을 든 사람이 들기·넣기 명령을 받고 컵을 든·넣은 사진이 되기까지(ms). */
const HAND_MS = 1000;
/** 시스템이 컵을 치울 준비로 본 뒤 사람이 식탁을 떠나기까지, 그 뒤 소파에서 TV를 보기까지(ms). */
const RISE_AFTER_READY_MS = 3000, TO_SOFA_MS = 2000;
/** 거실 복귀 도착부터 시청자가 떠나기까지, 떠나서 돌아오기까지(ms). */
const LEAVE_AFTER_STANDBY_MS = 4250, RETURN_AFTER_MS = 5000;
/** PAM이 대기 자리 도착 뒤 첫 시청 답보다 늦게 답하는 시간(ms). */
const PAM_AFTER_MS = 350;
/** 프레임 차례: 식탁(T), 거실(L), 손에 든 컵, 싱크대(S). wide-mug-v1 프레임 id. */
const FRAMES = { T: ["e36", "e93", "e36", "e112"], L: ["e243", "e340", "e162"], held: "e410", S: ["e727", "e807"] };

/** 폰 구간: 시작 자리(meal_watch) 다음 차례. go는 시스템이 보내는 가기 명령 목적지, hold는 반응 뒤 더 기다림, minWalk는 가장 짧은 걷는 시간. */
const START_SPOT = "meal_watch";
const LEGS: { value: string; go: string; hold?: number; minWalk?: number }[] = [
  { value: "kitchen_entry", go: "kitchen_entry" },
  { value: "meal_watch", go: "meal_watch" },
  { value: "living_standby", go: "living_standby" },
  { value: "table", go: TABLE, hold: 2050, minWalk: 4900 },
  { value: "sink", go: SINK },
  { value: "living_standby", go: "living_standby" },
];
/** 사람 장면(촬영 시각 from부터): 냉장고 → 식탁 → 소파 TV. rise는 식탁을 떠나는 때, left는 소파를 떠나는 때. */
const SCENES = (rise: number, left: number): { from: number; kind: string; value: string }[] => [
  { from: 0, kind: "fridge", value: "standing" },
  { from: 5500, kind: "away", value: "kitchen" },
  { from: 7500, kind: "table", value: "sitting" },
  { from: 9500, kind: "table", value: "drinking" },
  { from: rise, kind: "away", value: "table" },
  { from: rise + TO_SOFA_MS, kind: "tv", value: "watching" },
  { from: left, kind: "tv", value: "empty" },
  { from: left + RETURN_AFTER_MS, kind: "tv", value: "watching" },
];

const ceil = (v: number, step: number) => Math.ceil(v / step) * step;
const sceneAt = (scenes: ReturnType<typeof SCENES>, t: number) => scenes.filter((s) => s.from <= t).at(-1)!;
const fastWhen = (seen: ReplaySeen | null) => (t: number) => seen?.fastAt.findLast(([at]) => at <= t)?.[1] ?? false;
const firstAt = (seen: ReplaySeen | null, kind: string) => seen?.trace.find((e) => e.kind === kind)?.at ?? Infinity;

interface Photo { at: number; kind: string; value: string; lag?: number; frame?: string }
interface Counters { photos: number; T: number; L: number; S: number }

/** 사진 줄의 프레임: 식탁 장면은 T, 거실 장면(식탁을 떠남·TV)은 컵 상태에 따라 L·든 컵·S. 그 밖(냉장고·주방 떠남)은 없음. */
function frameOf(p: { at: number; kind: string; value: string }, c: Counters, cup: { pick: number; place: number }): string | undefined {
  if (p.kind === "table") return FRAMES.T[c.T++ % FRAMES.T.length];
  if (p.kind === "tv" || (p.kind === "away" && p.value === "table")) {
    if (p.at >= cup.place + HAND_MS) return FRAMES.S[c.S++ % FRAMES.S.length];
    if (p.at >= cup.pick + HAND_MS) return FRAMES.held;
    return FRAMES.L[c.L++ % FRAMES.L.length];
  }
  return undefined;
}
/** 이 사진들까지 센 차례(답 지연·프레임 차례를 이어 가려고). */
function counted(photos: Photo[]): Counters {
  const c: Counters = { photos: photos.length, T: 0, L: 0, S: 0 };
  for (const p of photos) {
    if (!p.frame) continue;
    if (FRAMES.T.includes(p.frame) && p.kind === "table") c.T++;
    else if (FRAMES.S.includes(p.frame)) c.S++;
    else if (FRAMES.L.includes(p.frame)) c.L++;
  }
  return c;
}
/** after 다음 촬영부터 end 앞까지 시스템 VLM 간격의 촬영 시각. */
function captures(after: number | null, end: number, seen: ReplaySeen | null): number[] {
  const out: number[] = [];
  const fast = fastWhen(seen);
  for (let t = after === null ? PHOTO_START : nextVlmCapture(after, fast); t < end; t = nextVlmCapture(t, fast)) out.push(t);
  return out;
}
const photoRow = (p: Photo, withSource: boolean): Row => ({
  at: p.at, kind: p.kind, value: p.value, ...(p.lag !== undefined ? { lag: p.lag } : {}), ...(p.frame ? { frame: p.frame } : {}),
  ...(withSource ? { source: p.frame ? SOURCE.framePhoto(p.frame) : SOURCE.photo } : {}),
});

/** 기본 줄(변형 없는 재생). seen은 앞 재생에서 본 것(없으면 가기 명령을 모른다). */
function compose(seen: ReplaySeen | null) {
  const walks = composedWalkMs([START_SPOT, ...LEGS.map((l) => l.value)]);
  const eyes: { at: number; value: string; depart: number }[] = [];
  let since = 0;
  for (const [i, leg] of LEGS.entries()) {
    const go = seen?.goes.find((g) => g.target === leg.go && g.at > since);
    if (!go) break;
    const depart = ceil(go.at + REACT_MS + (leg.hold ?? 0), 100);
    eyes.push({ at: ceil(depart + Math.max(walks[i]!, leg.minWalk ?? 0), 50), value: leg.value, depart });
    since = depart;
  }
  const back = eyes.length === LEGS.length ? eyes.at(-1)!.at : null;
  const left = back === null ? Infinity : back + LEAVE_AFTER_STANDBY_MS;
  const times = captures(null, Number.isFinite(left) ? left + PHOTO_AFTER_LEFT_MS : PHOTO_END, seen);
  const ready = firstAt(seen, "ready");
  const rise = ready + RISE_AFTER_READY_MS;
  const scenes = SCENES(rise, left);
  const cup = { pick: firstAt(seen, "pick"), place: firstAt(seen, "place") };
  const c: Counters = { photos: 0, T: 0, L: 0, S: 0 };
  const photos: Photo[] = times.map((at) => {
    const s = sceneAt(scenes, at);
    const p = { at, kind: s.kind, value: s.value, lag: LAGS[c.photos++ % LAGS.length]! };
    return { ...p, frame: frameOf(p, c, cup) };
  });
  // PAM: 대기 자리(세 번째 구간) 도착 뒤 첫 시청 사진의 답 뒤
  const standby = eyes[2]?.at;
  const watched = standby === undefined ? undefined : photos.find((p) => p.at >= standby && p.kind === "tv" && p.value === "watching");
  const rows: Row[] = [
    { at: 0, kind: "initial", source: SOURCE.initial },
    { at: 500, kind: "fridge_open", source: SOURCE.fridgeOpen },
    { at: 150, kind: "eye", value: START_SPOT, source: SOURCE.start },
    ...eyes.map((e) => ({ at: e.at, kind: "eye", value: e.value, depart: e.depart, source: SOURCE.walk })),
    ...(Number.isFinite(left) ? [{ at: left, kind: "left", source: SOURCE.left }] : []),
    ...photos.map((p) => photoRow(p, true)),
    ...(watched ? [{ at: watched.at + watched.lag! + PAM_AFTER_MS, kind: "pam", value: "watching_tv", response: PAM_WATCHING, source: SOURCE.pam }] : []),
  ];
  return { rows, photos, left, rise, ready };
}
const PAM_WATCHING = { observation: "거실에서 TV를 봄", reasoning: "시청 중", state: "watching_tv", from: null, next_index: -1 };

type Base = ReturnType<typeof compose>;
/** 변형: 기본 줄을 replace_from(부터 replace_until 앞까지) 이 줄로 바꾼다. */
interface VariantSpec {
  name: Variant;
  from: (b: Base) => number;
  until?: (b: Base) => number;
  /** 변형 줄(사진 앞에 둘 줄과 사진 뒤에 둘 줄). */
  head?: (b: Base) => Row[];
  tail?: (b: Base) => Row[];
  /** 사진 시각을 정해 둔 변형(일부러 틀린 간격). 없으면 그 변형 재생의 VLM 간격. */
  times?: (b: Base) => number[];
  /** 그 변형 사진의 장면 값: 사진 차례 j와 시각. 없으면 SCENES. */
  value?: (j: number, at: number, b: Base) => { kind: string; value: string } | undefined;
  /** 답 지연 차례를 이 자리부터 다시 돈다(없으면 앞 사진에 이어서). */
  lagFrom?: number;
  lag?: (j: number) => number | undefined;
  frames?: string[];
  /** 프레임 차례를 처음부터 다시 돈다(없으면 앞 사진에 이어서). */
  frameRestart?: boolean;
}
const VARIANTS: VariantSpec[] = [
  { name: "back", from: (b) => b.rise + TO_SOFA_MS - 300, head: (b) => [{ at: b.left, kind: "left" }], value: () => ({ kind: "table", value: "drinking" }), frameRestart: true },
  {
    name: "brief", from: (b) => b.left, head: (b) => [{ at: b.left, kind: "left" }], lagFrom: 3,
    value: (j) => (j < 5 ? { kind: "tv", value: ["standing", "empty", "watching", "empty", "empty"][j]! } : undefined),
  },
  { name: "manual", from: (b) => b.left - 1, head: (b) => [{ at: b.left, kind: "left" }, { at: b.left - 1, kind: "manual_off" }], lagFrom: 3 },
  {
    name: "cadence_wrong", from: (b) => b.left - 1, head: (b) => [{ at: b.left, kind: "left" }, { at: b.left - 1, kind: "manual_off" }], lagFrom: 3,
    times: (b) => Array.from({ length: 13 }, (_, j) => b.left + 550 + j * 1000),
  },
  { name: "lag_missing", from: (b) => b.left + 550, times: (b) => [b.left + 550], lag: () => undefined, frames: [] },
  { name: "lag_zero", from: (b) => b.left + 550, times: (b) => [b.left + 550], lag: () => 0, frames: [] },
  {
    name: "arrive_early", from: () => 12000,
    head: (b) => [
      ...[[12000, "meal_watch", 9200], [35700, "living_standby", 32300], [45900, "table", 41000], [57400, "sink", 50300], [79000, "living_standby", 67200]]
        .map(([at, value, depart]) => ({ at, kind: "eye", value, depart })),
      { at: b.left, kind: "left" },
    ],
  },
  {
    // 치울 준비(ready) 바로 앞부터 식탁을 떠나기 바로 앞까지 컵을 내려놓고 쉬고, 떠나기 0.4초 앞에 PAM이 답한다
    name: "pam_seated", from: (b) => b.ready - 300, until: (b) => b.rise - 300, value: () => ({ kind: "table", value: "resting" }), frames: ["e112", "e93", "e112"],
    tail: (b) => [{ at: b.rise - 400, kind: "pam", value: "~resting", response: PAM_RESTING }],
  },
];
const PAM_RESTING = { observation: "식탁에 앉아 컵을 내려놓고 쉬는 중", reasoning: "마시기를 끝내고 다른 일로 넘어감", state: "~쉬거나_자는_중", from: "drinking", next_index: 0 };

function variantRow(spec: VariantSpec, base: Base, seen: ReplaySeen | null): Row {
  const from = spec.from(base);
  const before = base.photos.filter((p) => p.at < from);
  const c = spec.frameRestart ? { ...counted(before), T: 0, L: 0, S: 0 } : counted(before);
  const until = spec.until?.(base);
  const times = spec.times ? spec.times(base) : captures(before.at(-1)?.at ?? null, until ?? base.left + PHOTO_AFTER_LEFT_MS, seen);
  const scenes = SCENES(base.rise, base.left);
  const cup = { pick: firstAt(seen, "pick"), place: firstAt(seen, "place") };
  const photos = times.map((at, j): Photo => {
    const s = spec.value?.(j, at, base) ?? sceneAt(scenes, at);
    const lag = spec.lag ? spec.lag(j) : LAGS[((spec.lagFrom ?? c.photos) + j) % LAGS.length]!;
    const p = { at, kind: s.kind, value: s.value };
    const frame = spec.frames ? spec.frames[j] : frameOf(p, c, cup);
    return { ...p, ...(lag !== undefined ? { lag } : {}), ...(frame ? { frame } : {}) };
  });
  return {
    kind: "variant", name: spec.name, replace_from: from, ...(until !== undefined ? { replace_until: until } : {}),
    rows: [...(spec.head?.(base) ?? []), ...photos.map((p) => photoRow(p, false)), ...(spec.tail?.(base) ?? [])],
    source: SOURCE.variants[spec.name],
  };
}

const document = (base: Base, variants: Row[]): Row[] => [
  METADATA, PLAN_RESPONSE, ...variants.filter((v) => v.name !== "pam_seated"), ...base.rows, ...variants.filter((v) => v.name === "pam_seated"),
];
async function replayOnce(rows: Row[], variant: Variant): Promise<ReplaySeen> {
  useComposedRows(rows);
  let seen: ReplaySeen | null = null;
  await replayScenario(variant, undefined, undefined, (s) => { seen = s; }).catch(() => undefined);
  if (!seen) throw new Error(`재생이 끝나지 않았어요: ${variant}`);
  return seen;
}
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

// 기본 줄: 재생에서 본 가기 명령·VLM 간격·명령 시각으로 다시 만들어 바뀌지 않을 때까지
let base = compose(null);
let baseSeen: ReplaySeen | null = null;
for (let i = 0; ; i++) {
  if (i > 40) throw new Error("기본 줄이 40번 안에 정해지지 않았어요");
  baseSeen = await replayOnce(document(base, []), "normal");
  const next = compose(baseSeen);
  if (same(next.rows, base.rows)) break;
  base = next;
}
if (!Number.isFinite(base.left) || !Number.isFinite(base.ready))
  throw new Error(`폰이 모든 자리를 가지 못했어요(시스템이 보낸 가기 명령: ${baseSeen?.goes.map((g) => `${g.target}@${g.at}`).join(", ")}). 장면 시각을 고쳐야 해요`);
// 변형 줄: 기본 줄을 두고, 기본 재생에서 본 것으로 시작해 그 변형 재생으로 같은 방법
const variants: Row[] = [];
for (const spec of VARIANTS) {
  let row = variantRow(spec, base, baseSeen);
  // 시각·프레임을 정해 둔 변형(일부러 틀린 한 줄)은 재생에서 읽을 것이 없다
  for (let i = 0; !(spec.times && spec.frames); i++) {
    if (i > 20) throw new Error(`변형 ${spec.name} 줄이 20번 안에 정해지지 않았어요`);
    const next = variantRow(spec, base, await replayOnce(document(base, [...variants, row]), spec.name));
    if (same(next, row)) break;
    row = next;
  }
  variants.push(row);
}
writeFileSync(OUT, document(base, VARIANTS.map((s) => variants.find((v) => v.name === s.name)!)).map((r) => JSON.stringify(r)).join("\n") + "\n");
console.log(`${OUT}: 기본 ${base.rows.length}줄, 변형 ${variants.length}개`);
