// 계획 단계의 끝난 조건·기다리기 조건: World State 낱말(src/world/vocab.ts) 키로만 쓰는 JSON 조건과 그 판정.
// 계획을 만드는 에이전트는 CONDITION_JSON_SCHEMA에 맞춰 쓰고 checkCondition으로 이 집에 맞는지 보고, 실행 쪽은 ConditionWatch로 볼 때마다 판정한다.
// - 판정은 참·거짓·모름 세 값이다. 안 보여서 모르는 것은 모름이고, not(모름)도 모름이다. 단계는 참일 때만 넘어간다.
// - 단계가 시작된 뒤(sinceMs) 본 사실만 쓴다: 그 전 사실은 모름. 「모름」 값(안이 안 보임·하는 일 모름)은 다른 값과 견주면 모름.
// - 지금만 맞는 면(하는 일·순간 동작·쓰는 중 등)은 FACT_FRESH_MS 안의 VLM 답만 쓴다. 값이 없으면 그 안에 그 대상 답이 있었을 때만 거짓.
// - 사람 방·가까이는 발이 보인 바닥 자리로만 본다(FRESH_MS 안). 폰 근처는 폰 자리(FRESH_MS 안)와 그 자리가 같은 방이고 평면 거리 안. 방을 모르면 모름.
// - became: 그 단계(seq면 그 칸)가 시작된 뒤 가전이 그 상태가 됨(가전 이력). seq: 앞 칸이 참이 된 뒤 다음 칸이 참이고, 칸마다 기준 시각이 그때로 바뀐다.
// - for_s: 그 시간 넘게 이어서 참(거짓·모름이면 다시 센다).
// 물건 이름은 id(cup_1) 또는 종류(cup: 그 종류 아무거나, 한 물건이 모든 칸을 함께 맞춰야 참). follow면 그 id와, 단계 시작 뒤 새로 생긴 같은 종류 물건(옮겨서 새 id가 붙은 그 물건).
// 가전 이름은 id 또는 종류(washer).
import { z } from "zod";
import type { WorldFact, WorldView } from "../contract/world.js";
import {
  CLASSES, DAY_PARTS, DEVICE_STATES, FACT_FRESH_MS, FRESH_MS, NEAR_M, NOW_FACETS, PHONE_NEAR_M, STATES, UNKNOWN_STATES,
  type ClassKey, type DeviceStateKey, type Facet, type StateKey, type Target,
} from "./vocab.js";

type Plan2 = [number, number];
/** 참·거짓·모름(null). */
export type Tri = boolean | null;

const keys = <T extends object>(o: T) => Object.keys(o) as [keyof T & string, ...(keyof T & string)[]];
const ALL_FACETS = ["place", "contents", "open", "use", "screen", "posture", "holding", "activity", "moment"] as const satisfies readonly Facet[];
const PERSON_FACETS = ["posture", "place", "holding", "activity", "moment"] as const satisfies readonly Facet[];
const STATE_KEYS = z.enum(keys(STATES));
const DEVICE_KEYS = z.enum(keys(DEVICE_STATES));
const FIXTURES = (Object.keys(CLASSES) as ClassKey[]).filter((k) => CLASSES[k].role === "fixture") as [ClassKey, ...ClassKey[]];
const OBJECTS = (Object.keys(CLASSES) as ClassKey[]).filter((k) => CLASSES[k].role === "object");
const FactMap = z.partialRecord(z.enum(ALL_FACETS), STATE_KEYS).refine((m) => Object.keys(m).length > 0, { message: "facts가 비었습니다" });
const meters = z.number().positive().max(10).optional();

type FactMap = Partial<Record<Facet, StateKey>>;
export type Condition =
  | { person: "visible" | "not_visible" }
  | { person_in_room: string }
  | { person_near: string; within_m?: number }
  | { person_fact: (typeof PERSON_FACETS)[number]; value: StateKey }
  | { people_at_least: number }
  | { object: string; facts?: FactMap; surface?: string; status?: "present" | "out_of_view" | "gone"; follow?: boolean }
  | { fixture: string; room?: string; facts: FactMap }
  | { device: string; state: DeviceStateKey }
  | { device: string; became: DeviceStateKey }
  | { phone_near: string; within_m?: number }
  | { elapsed_s: number }
  | { day_part: (typeof DAY_PARTS)[number]["key"] }
  | { for_s: number; cond: Condition }
  | { seq: Condition[] }
  | { all: Condition[] }
  | { any: Condition[] }
  | { not: Condition };

/** 값이 그 면의 값이고 그 대상에 붙는가. */
const factsFit = (facts: FactMap | undefined, target: Target) =>
  Object.entries(facts ?? {}).every(([f, v]) => STATES[v as StateKey].facet === f && (STATES[v as StateKey].for as readonly Target[]).includes(target));

export const ConditionSchema: z.ZodType<Condition> = z.lazy(() => z.union([
  z.object({ person: z.enum(["visible", "not_visible"]) }).strict(),
  z.object({ person_in_room: z.string().min(1) }).strict(),
  z.object({ person_near: z.string().min(1), within_m: meters }).strict(),
  z.object({ person_fact: z.enum(PERSON_FACETS), value: STATE_KEYS }).strict()
    .refine((c) => STATES[c.value].facet === c.person_fact && (STATES[c.value].for as readonly Target[]).includes("person"), { message: "사람의 그 면 값이 아닙니다" }),
  z.object({ people_at_least: z.number().int().min(1).max(5) }).strict(),
  z.object({
    object: z.string().min(1), facts: FactMap.optional(), surface: z.string().min(1).optional(), status: z.enum(["present", "out_of_view", "gone"]).optional(), follow: z.boolean().optional(),
  }).strict()
    .refine((c) => c.facts !== undefined || c.surface !== undefined || c.status !== undefined, { message: "facts·surface·status 중 하나는 있어야 합니다" })
    .refine((c) => factsFit(c.facts, "object"), { message: "물건의 그 면 값이 아닙니다" }),
  z.object({ fixture: z.enum(FIXTURES), room: z.string().min(1).optional(), facts: FactMap }).strict()
    .refine((c) => factsFit(c.facts, "fixture"), { message: "가전 설비의 그 면 값이 아닙니다" }),
  z.object({ device: z.string().min(1), state: DEVICE_KEYS }).strict(),
  z.object({ device: z.string().min(1), became: DEVICE_KEYS }).strict(),
  z.object({ phone_near: z.string().min(1), within_m: meters }).strict(),
  z.object({ elapsed_s: z.number().nonnegative() }).strict(),
  z.object({ day_part: z.enum(DAY_PARTS.map((p) => p.key) as [(typeof DAY_PARTS)[number]["key"]]) }).strict(),
  z.object({ for_s: z.number().positive(), cond: ConditionSchema }).strict(),
  z.object({ seq: z.array(ConditionSchema).min(2) }).strict(),
  z.object({ all: z.array(ConditionSchema).min(1) }).strict(),
  z.object({ any: z.array(ConditionSchema).min(1) }).strict(),
  z.object({ not: ConditionSchema }).strict(),
]));

/** 계획 에이전트에 줄 JSON Schema. */
export const CONDITION_JSON_SCHEMA = z.toJSONSchema(ConditionSchema) as Record<string, unknown>;

/** 조건 종류(맨 바깥 키). 문서 표가 이 목록을 다 다룬다(tests/world-vocab.test.ts). */
export const CONDITION_KINDS = [
  "person", "person_in_room", "person_near", "person_fact", "people_at_least", "object", "fixture", "device", "phone_near", "elapsed_s", "day_part", "for_s", "seq", "all", "any", "not",
] as const;

export function parseCondition(raw: unknown): Condition {
  return ConditionSchema.parse(raw);
}

/** 이 집에서 쓸 수 있는 이름: 가전(종류·속성), 방, 가구·가전·도면 설비 자리. */
export interface ConditionHome {
  devices: readonly { id: string; kind: string; twinAttrs: Record<string, unknown[]> }[];
  rooms: readonly string[];
  /** 가구·가전·도면 설비 id가 트윈에 있는가. */
  hasPlace: (id: string) => boolean;
}

const classOf = (name: string): ClassKey | null => {
  if (OBJECTS.includes(name as ClassKey)) return name as ClassKey;
  const m = /^(.+)_\d+$/.exec(name);
  return m && OBJECTS.includes(m[1] as ClassKey) ? (m[1] as ClassKey) : null;
};

/** 이 집에 맞지 않는 조건의 까닭(없으면 빈 목록): 없는 가전·방·자리, 그 가전에 없는 상태, 그 종류에 없는 면, 물건 id 모양. */
export function checkCondition(c: Condition, home: ConditionHome): string[] {
  const out: string[] = [];
  const walk = (x: Condition): void => {
    if ("all" in x) return x.all.forEach(walk);
    if ("any" in x) return x.any.forEach(walk);
    if ("seq" in x) return x.seq.forEach(walk);
    if ("not" in x) return walk(x.not);
    if ("for_s" in x) return walk(x.cond);
    if ("person_in_room" in x && !home.rooms.includes(x.person_in_room)) out.push(`없는 방: ${x.person_in_room}`);
    if ("person_near" in x && !home.hasPlace(x.person_near)) out.push(`없는 자리: ${x.person_near}`);
    if ("phone_near" in x && !home.hasPlace(x.phone_near)) out.push(`없는 자리: ${x.phone_near}`);
    if ("object" in x) {
      const cls = classOf(x.object);
      if (!cls) out.push(`물건 종류나 id가 아님: ${x.object}`);
      else for (const f of Object.keys(x.facts ?? {})) if (!(CLASSES[cls].facets as readonly string[]).includes(f)) out.push(`${cls}에 없는 면: ${f}`);
      if (x.follow && cls === x.object) out.push(`follow는 물건 id에만: ${x.object}`);
      if (x.surface && !home.hasPlace(x.surface)) out.push(`없는 자리: ${x.surface}`);
    }
    if ("fixture" in x) {
      for (const f of Object.keys(x.facts)) if (!(CLASSES[x.fixture as ClassKey].facets as readonly string[]).includes(f)) out.push(`${x.fixture}에 없는 면: ${f}`);
      if (x.room && !home.rooms.includes(x.room)) out.push(`없는 방: ${x.room}`);
    }
    if ("device" in x) {
      const key = "state" in x ? x.state : x.became;
      const devs = home.devices.filter((d) => d.id === x.device || d.kind === x.device);
      if (!devs.length) out.push(`이 집에 없는 가전: ${x.device}`);
      else if (!devs.some((d) => (d.twinAttrs[DEVICE_STATES[key].attr] ?? []).includes(DEVICE_STATES[key].value))) out.push(`${x.device}에 없는 상태: ${key}`);
    }
  };
  walk(c);
  return out;
}

export interface ConditionContext {
  nowMs: number;
  /** 단계가 시작된 시각: 사실의 새로움·became·elapsed_s의 기준. */
  sinceMs: number;
  /** 트윈 가구·가전·도면 설비 id의 평면 자리 [x, y]. 모르면 null. */
  locate: (id: string) => Plan2 | null;
  /** 그 자리의 방 id(폰 근처를 같은 방으로 거른다). 모르면 null. */
  roomOf: (id: string) => string | null;
  /** 하루 때를 셀 시간대(분, 기본 540). */
  offsetMinutes?: number;
}

const dist = (a: Plan2, b: Plan2) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const and = (xs: Tri[]): Tri => (xs.includes(false) ? false : xs.includes(null) ? null : true);
const or = (xs: Tri[]): Tri => (xs.includes(true) ? true : xs.includes(null) ? null : false);
const not = (x: Tri): Tri => (x === null ? null : !x);

/** 사실 하나가 그 값인가(참·거짓·모름). */
function factIs(f: WorldFact | undefined, value: StateKey, target: Target, answeredMs: number | null, x: ConditionContext): Tri {
  const now = NOW_FACETS[target].includes(STATES[value].facet);
  const since = now ? Math.max(x.sinceMs, x.nowMs - FACT_FRESH_MS) : x.sinceMs;
  if (f) {
    if (f.at_ms < since) return null;
    if (f.value === value) return true;
    return UNKNOWN_STATES.includes(f.value as StateKey) ? null : false;
  }
  return now && answeredMs !== null && answeredMs >= since ? false : null;
}
const factsAre = (facts: Partial<Record<Facet, WorldFact>>, want: FactMap | undefined, target: Target, answeredMs: number | null, x: ConditionContext): Tri =>
  and(Object.values(want ?? {}).map((v) => factIs(facts[STATES[v].facet], v, target, answeredMs, x)));

/** 물건 후보. own은 그 id·종류. follow면 원래 물건이 보이지 않는 동안 moved(단계 시작 뒤 새로 생긴 같은 종류 물건)도 본다. */
function candidates(name: string, follow: boolean, w: WorldView, sinceMs: number): { own: WorldView["objects"]; moved: WorldView["objects"] } {
  const own = w.objects.filter((o) => o.id === name || o.cls === name);
  if (!follow || own.some((o) => o.status === "present")) return { own, moved: [] };
  const cls = classOf(name);
  return { own, moved: w.objects.filter((o) => o.id !== name && o.cls === cls && o.first_seen_ms >= sinceMs && o.status !== "gone") };
}

/** 옮겨 새로 생긴 물건이 여럿이면 어느 것이 그 물건인지 모르므로 모두 같은 답일 때만 그 답. */
const agree = (xs: Tri[]): Tri => (xs.length && xs.every((r) => r === xs[0]) ? xs[0]! : null);

interface Memo { held: Map<string, { since: number; last: number }>; stage: Map<string, { at: number; since: number }> }

function check(c: Condition, w: WorldView, x: ConditionContext, m: Memo, path: string): Tri {
  if ("all" in c) return and(c.all.map((s, i) => check(s, w, x, m, `${path}.all${i}`)));
  if ("any" in c) return or(c.any.map((s, i) => check(s, w, x, m, `${path}.any${i}`)));
  if ("not" in c) return not(check(c.not, w, x, m, `${path}.not`));
  if ("for_s" in c) {
    const r = check(c.cond, w, x, m, `${path}.for`);
    const prev = m.held.get(path);
    if (r !== true) {
      m.held.delete(path);
      return r;
    }
    // 검사 사이가 FACT_FRESH_MS 넘게 비면 그동안 이어졌는지 모르므로 다시 센다
    const since = prev && x.nowMs - prev.last <= FACT_FRESH_MS ? prev.since : x.nowMs;
    m.held.set(path, { since, last: x.nowMs });
    return x.nowMs - since >= c.for_s * 1000;
  }
  if ("seq" in c) {
    const st = m.stage.get(path) ?? { at: 0, since: x.sinceMs };
    if (st.at < c.seq.length && check(c.seq[st.at]!, w, { ...x, sinceMs: st.since }, m, `${path}.seq${st.at}`) === true) {
      st.at++;
      st.since = x.nowMs; // 다음 칸은 이 칸이 참이 된 뒤의 근거만 쓴다
    }
    m.stage.set(path, st);
    return st.at >= c.seq.length;
  }
  if ("elapsed_s" in c) return x.nowMs - x.sinceMs >= c.elapsed_s * 1000;
  if ("day_part" in c) {
    const hour = new Date(x.nowMs + (x.offsetMinutes ?? 540) * 60_000).getUTCHours();
    return [...DAY_PARTS].reverse().find((p) => hour >= p.from)!.key === c.day_part;
  }
  const p = w.person;
  // 사람 보임·안 보임·수는 FACT_FRESH_MS 안에 분석한 프레임이 있을 때만(폰이 끊기면 모름)
  const live = w.frame_ms !== null && x.nowMs - w.frame_ms <= FACT_FRESH_MS;
  if ("person" in c) return live ? p.visible === (c.person === "visible") : null;
  if ("people_at_least" in c) return live ? (p.visible ? p.count : 0) >= c.people_at_least : null;
  if ("person_in_room" in c || "person_near" in c) {
    const fresh = p.visible && p.position !== null && p.position_ms !== null && x.nowMs - p.position_ms <= FRESH_MS && p.position_ms >= x.sinceMs;
    if (!fresh) return null;
    if ("person_in_room" in c) return p.room === null ? null : p.room === c.person_in_room;
    const at = x.locate(c.person_near);
    return at ? dist(p.position!, at) <= (c.within_m ?? NEAR_M) : null;
  }
  if ("person_fact" in c) return p.visible ? factIs(p.facts[c.person_fact], c.value, "person", p.answered_ms, x) : null;
  if ("object" in c) {
    const { own, moved } = candidates(c.object, c.follow === true, w, x.sinceMs);
    if (!own.length && !moved.length) return null;
    if (c.status === "gone" && c.facts === undefined && c.surface === undefined) return [...own, ...moved].every((o) => o.status === "gone");
    const one = (o: WorldView["objects"][number]): Tri => and([
      c.status === undefined ? true : o.status === c.status,
      c.surface === undefined ? true : o.last_seen_ms >= x.sinceMs ? o.surface === c.surface : null,
      factsAre(o.facts, c.facts, "object", o.answered_ms, x),
    ]);
    return or([...own.map(one), ...(moved.length ? [agree(moved.map(one))] : [])]);
  }
  if ("fixture" in c) {
    const fixes = w.fixtures.filter((f) => f.cls === c.fixture && (c.room === undefined || f.room === c.room));
    return fixes.length ? or(fixes.map((f) => factsAre(f.facts, c.facts, "fixture", f.answered_ms, x))) : null;
  }
  if ("device" in c) {
    const devs = w.devices.filter((d) => (d.id === c.device || d.kind === c.device) && d.status !== null);
    if (!devs.length) return null;
    if ("state" in c) return devs.some((d) => d.state.includes(c.state));
    const s = DEVICE_STATES[c.became];
    return devs.some((d) => d.history.some((h) => h.at_ms >= x.sinceMs && h.attr === s.attr && h.to === s.value && h.from !== null && h.from !== s.value));
  }
  if ("phone_near" in c) {
    const e = w.eye;
    const at = x.locate(c.phone_near);
    const room = x.roomOf(c.phone_near);
    if (!e || !at || !room || !e.room || x.nowMs - e.at_ms > FRESH_MS) return null;
    return room === e.room && dist(e.position, at) <= (c.within_m ?? PHONE_NEAR_M);
  }
  return null;
}

/** 조건 하나를 지켜본다. for_s·seq가 있으면 볼 때마다 불러야 이어진 시간·순서를 센다. */
export class ConditionWatch {
  private readonly memo: Memo = { held: new Map(), stage: new Map() };
  readonly condition: Condition;
  constructor(raw: unknown) {
    this.condition = parseCondition(raw);
  }

  /** 참·거짓·모름. */
  state(world: WorldView, ctx: ConditionContext): Tri {
    return check(this.condition, world, ctx, this.memo, "$");
  }

  /** 참일 때만 true(모름은 아직 아님). */
  check(world: WorldView, ctx: ConditionContext): boolean {
    return this.state(world, ctx) === true;
  }
}

/** 한 번 판정(참·거짓·모름). for_s는 처음 보는 것이라 0초로 세고, seq는 첫 칸만 본다. */
export function evaluate(raw: unknown, world: WorldView, ctx: ConditionContext): Tri {
  return new ConditionWatch(raw).state(world, ctx);
}
