// 계획 도구와 통로가 함께 검사하는 끝 조건 낱말과 JSON 모양.
import { z } from "zod";
import { CLASSES, DAY_PARTS, DEVICE_STATES, STATES, type ClassKey, type DeviceStateKey, type StateKey, type Facet, type Target } from "./vocab.js";

const keys = <T extends object>(o: T) => Object.keys(o) as [keyof T & string, ...(keyof T & string)[]];
const ALL_FACETS = ["place", "contents", "body", "open", "use", "screen", "posture", "holding", "activity", "moment"] as const satisfies readonly Facet[];
const PERSON_FACETS = ["posture", "place", "holding", "activity", "moment"] as const satisfies readonly Facet[];
const STATE_KEYS = z.enum(keys(STATES));
const DEVICE_KEYS = z.enum(keys(DEVICE_STATES));
const FIXTURES = (Object.keys(CLASSES) as ClassKey[]).filter((k) => CLASSES[k].role === "fixture") as [ClassKey, ...ClassKey[]];
const FactMap = z.partialRecord(z.enum(ALL_FACETS), STATE_KEYS).refine((m) => Object.keys(m).length > 0, { message: "facts가 비었습니다" });
const meters = z.number().positive().max(10).optional();

export type FactMap = Partial<Record<Facet, StateKey>>;
export type Condition =
  | { person: "visible" | "not_visible" }
  | { person_in_room: string }
  | { person_near: string; within_m?: number }
  | { person_fact: (typeof PERSON_FACETS)[number]; value: StateKey }
  | { person_holding: string }
  | { people_at_least: number }
  | { object: string; facts?: FactMap; surface?: string; part?: "basin"; status?: "present" | "out_of_view" | "gone"; follow?: boolean }
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
  z.object({ person_holding: z.string().min(1) }).strict(),
  z.object({ people_at_least: z.number().int().min(1).max(5) }).strict(),
  z.object({
    object: z.string().min(1), facts: FactMap.optional(), surface: z.string().min(1).optional(), part: z.enum(["basin"]).optional(),
    status: z.enum(["present", "out_of_view", "gone"]).optional(), follow: z.boolean().optional(),
  }).strict()
    .refine((c) => c.facts !== undefined || c.surface !== undefined || c.status !== undefined, { message: "facts·surface·status 중 하나는 있어야 합니다" })
    .refine((c) => c.part === undefined || c.surface !== undefined, { message: "part는 surface와 함께 씁니다" })
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
