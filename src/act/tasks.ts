// 행동 목록(PAM에 보내는 작업 목록과 그 설명). PAM이 고른 행동(task_index → 행동 이름)은 에이전트가 계획 모드로 계획을 만든다(src/agent/planner.ts).
// 목록은 services/pam/scenarios/noonchi/tasks.json과 같다(tests/agent-planner.test.ts). 최종 목록은 FSM 담당(박석준·김준형)이 정한다.
// 여기에는 계획 모양이 없다: 무엇을 어떤 순서로 할지는 에이전트가 정한다. target은 계획 전 검사(LLM을 부르기 전)에만 쓴다.
import type { PlanView } from "../contract/plan.js";
import type { Facet, ObjClass, WorldFact, WorldObject, WorldView } from "../contract/world.js";
import type { DeviceKind } from "../devices/kinds.js";
import type { ActionChoice } from "./prompts.js";
import { UNKNOWN_STATES, type StateKey } from "../world/vocab.js";

type Kind = "go" | "pick" | "place" | "do" | "device" | "ask" | "say" | "wait";
/** 이 행동의 계획에 쓸 수 있는 단계: 단계 종류(src/agent/planTools.ts AgentStepKind), 꼭 있어야 하는 단계 종류(need), 기기 단계의 가전 종류·도구. 승인한 일의 범위다. */
export interface TaskAllow { kinds: readonly Kind[]; need: readonly Kind[]; devices?: { kinds: readonly DeviceKind[]; tools: readonly string[] } }

/** 행동 하나: 이름, 에이전트에게 주는 설명, 쓸 수 있는 단계, 계획 전 검사의 대상 종류(이 종류 중 치우지 않은 물건이 보여야 부른다),
 *  판단 전에 더 잘 볼 대상 물건의 면(look: 모르면 관찰 모드 B가 가까이 볼지 고른다, src/act/look.ts). */
export interface TaskSpec {
  name: string; description: string; allow: TaskAllow; target?: ObjClass; look?: readonly Facet[];
  /** 행동 조건: 대상 물건의 그 면이 이 값으로 확인돼야 한다(계획 전 검사는 확인된 반대 값이면 막고, 실행 전 검사는 모르면 보류, src/act/check.ts). 면은 look 안이다. */
  want?: Partial<Record<Facet, StateKey>>;
  /** false면 계획을 만들지 않는 행동이다. 판단 기록과 생각 말풍선에만 보인다. */
  plan?: false;
  /** 집는 물건 종류. 없으면 target이다. */
  carry?: ObjClass;
  /** true면 집는 물건이 안 보여도(냉장고 안) 평면도 자리에서 집는 단계를 받는다. */
  carryUnseen?: true;
  /** 코치 모드에서만 PAM에 보내는 행동(사람이 하는 일을 단계마다 알려 준다. 가전을 조작하지 않는다). */
  coach?: true;
  /** 이 행동 계획의 단계 수 상한(없으면 8, src/agent/planTools.ts PLAN_LIMITS). */
  maxSteps?: number;
  /** 대상 물건에 손을 대는 행동(치우기·채우기·따르기): 대상이 안 보이면 마지막으로 본 자리로 찾으러 간다(src/act/track/find.ts).
   *  사람이 그 대상 종류를 쓰는 것을 보면 그 사람이 사라질 때까지 찾기·가까이 가서 보기·첫 명령을 미룬다(usingNow, src/act/track/use.ts).
   *  대상을 건드리지 않는 행동(그대로 두기)은 찾지 않는다. */
  touch?: true;
}

const HAND = ["go", "pick", "place"] as const;
/** 채워 주기: 병을 꺼내 와 그 자리에서 따른다(do). 병을 도로 넣는 place는 써도 되고 안 써도 된다. */
const FILL: TaskAllow = { kinds: ["go", "pick", "do", "place"], need: ["go", "pick", "do"] };

export const TASKS: Record<string, TaskSpec> = {
  "컵 치우기": {
    name: "컵 치우기", description: "사람이 자리를 비운 뒤 식탁 등에 남은 컵을 사람이 싱크대에 넣게 한다.", target: "cup", touch: true,
    allow: { kinds: HAND, need: HAND },
  },
  "사용자에게 물어보기": { name: "사용자에게 물어보기", description: "컵 안을 확인할 수 없는 등 애매할 때 폰으로 사용자에게 어떻게 할지 묻는다.", allow: { kinds: ["ask", "say"], need: ["ask"] } },
  "세탁물 건조기로 옮기기": {
    name: "세탁물 건조기로 옮기기", description: "세탁기가 멈추면 사람이 세탁물을 꺼내 건조기에 넣게 하고 건조기를 시작한다.",
    allow: { kinds: ["wait", ...HAND, "device", "ask", "say"], need: [...HAND, "device"], devices: { kinds: ["dryer"], tools: ["start"] } },
  },
  "에어컨 켜기": {
    name: "에어컨 켜기", description: "더울 때 사람이 있는 방의 에어컨을 켠다.",
    allow: { kinds: ["device", "say"], need: ["device"], devices: { kinds: ["aircon"], tools: ["turn_on"] } },
  },
  // 컵 갈래(2026-11-13): 끝에 더해 앞 넷의 task_index를 지킨다. 물·콜라를 가르는 사실(먹는 중·TV 보는 중)은 FSM 기억(src/brain/decision.ts CUP_FSM_MEMORY)에 있다
  "컵 그대로 두기": {
    name: "컵 그대로 두기", description: "사람이 자리를 비웠지만 컵에 음료가 남아 있어 치우지 않고 그대로 둔다.", target: "cup", look: ["contents"], want: { contents: "has_contents" }, plan: false,
    allow: { kinds: [], need: [] },
  },
  "컵에 물 채워 주기": {
    name: "컵에 물 채워 주기", description: "사람이 식사 중인데 컵이 비어 있으면 사람이 냉장고에서 물병을 꺼내 와 컵에 물을 따르게 한다.", target: "cup", touch: true, look: ["contents"], want: { contents: "empty" },
    carry: "bottle", carryUnseen: true, allow: FILL,
  },
  "컵에 콜라 따라 주기": {
    name: "컵에 콜라 따라 주기", description: "사람이 TV를 보는 중인데 컵이 비어 있으면 사람이 냉장고에서 콜라를 꺼내 와 컵에 따르게 한다.", target: "cup", touch: true, look: ["contents"], want: { contents: "empty" },
    carry: "bottle", carryUnseen: true, allow: FILL,
  },
  // 코치 행동(2026-11-13): 단계 목록은 에이전트 계획 모드가 만든다. 여기에는 설명과 쓸 수 있는 단계만 둔다(device 없음)
  "라면 끓이기 알려 주기": {
    name: "라면 끓이기 알려 주기", coach: true, maxSteps: 14,
    description: "사람이 라면을 끓이려 하거나 방법을 물으면 냄비 꺼내기부터 불 끄기까지 사람이 할 일을 단계마다 알려 준다. 클로이드는 가전을 조작하지 않는다.",
    allow: { kinds: ["go", "pick", "place", "do", "wait", "say"], need: ["do"] },
  },
  // 저절로 꺼지는 가전(등록부 selfStop): 켠 뒤 끄기 do 대신 그 가전의 꺼짐을 기다리는 wait를 둔다(src/agent/planTools.ts finish, 실행 추적 cycleEnded)
  "전자레인지로 데우기 알려 주기": {
    name: "전자레인지로 데우기 알려 주기", coach: true, maxSteps: 12,
    description: "사람이 전자레인지 앞에서 쓰는 법을 묻거나 막히면 문 열기부터 꺼내기까지 사람이 할 일을 단계마다 천천히 알려 준다. 클로이드는 가전을 조작하지 않는다.",
    allow: { kinds: ["go", "pick", "place", "do", "wait", "say"], need: ["do", "wait"] },
  },
};

/** 모든 행동 이름(검사·tasks.json 견주기). PAM에 보내는 목록은 지금 모드를 따른다(src/act/mode.ts pamTasks). */
export const TASK_NAMES: readonly string[] = Object.keys(TASKS);

/** 그 행동이 어느 모드로 하는 행동인가: 코치 행동(TaskSpec.coach)이면 coach, 그 밖의 목록 행동이면 noonchi, 대기(null)·목록 밖이면 null.
 *  판단 기록 assist와 대시보드 메시지 상자 머리(「코치 모드」·「눈치 모드」)의 기준은 이 하나다. */
export function modeOf(action: string | null): "noonchi" | "coach" | null {
  const t = taskOf(action);
  return t ? (t.coach ? "coach" : "noonchi") : null;
}

/** 메시지 상자 문장: 행동마다 허락형(src/brain/thought.ts 「<조건> <허락> 된다고 하셨어요」)과 클로이드가 직접 하는 말(src/act/labels.ts SAY_TEXT.decided
 *  「컵을 치울게요.」). 표에 없는 행동은 「<행동>을 해도」·「<행동>을 할게요」. 행동 목록에 없는 일은 문장에 나오지 않는다. */
export const TASK_SAY: Readonly<Record<string, { may: string; will: string }>> = {
  "컵 치우기": { may: "치워도", will: "컵을 치울게요" },
  "사용자에게 물어보기": { may: "여쭤봐도", will: "폰으로 여쭤볼게요" },
  "세탁물 건조기로 옮기기": { may: "세탁물을 건조기로 옮겨도", will: "세탁물을 건조기로 옮길게요" },
  "에어컨 켜기": { may: "에어컨을 켜도", will: "에어컨을 켤게요" },
  "컵 그대로 두기": { may: "그대로 둬도", will: "컵을 그대로 둘게요" },
  "컵에 물 채워 주기": { may: "물을 채워 드려도", will: "컵에 물을 채울게요" },
  "컵에 콜라 따라 주기": { may: "콜라를 따라 드려도", will: "컵에 콜라를 따를게요" },
  "라면 끓이기 알려 주기": { may: "라면 끓이는 법을 알려 드려도", will: "라면 끓이는 법을 알려 드릴게요" },
  "전자레인지로 데우기 알려 주기": { may: "전자레인지 쓰는 법을 알려 드려도", will: "전자레인지 쓰는 법을 알려 드릴게요" },
};

/** 손대는 행동(touch)의 대상 종류. 손대지 않는 행동·목록 밖이면 null. */
export function touchTarget(action: string | null): ObjClass | null {
  const t = taskOf(action);
  return t?.touch ? t.target ?? null : null;
}

/** 코치 모드에서도 PAM에 보내는 눈치 행동. */
const COACH_ALSO: readonly string[] = ["사용자에게 물어보기"];

/** 모드의 행동 목록(순서가 task_index, 행동 목록 순서 그대로). noonchi: 코치가 아닌 행동, coach: 코치 행동과 「사용자에게 물어보기」.
 *  PAM에 보내는 목록은 지금 모드와 들은 말로 정한다(src/act/mode.ts pamTasks). */
export function tasksFor(mode: "noonchi" | "coach"): string[] {
  return TASK_NAMES.filter((n) => (mode === "coach" ? TASKS[n]!.coach || COACH_ALSO.includes(n) : !TASKS[n]!.coach));
}

/** 행동 이름 → 행동. 목록 밖이면 null. */
export function taskOf(action: string | null): TaskSpec | null {
  return action && Object.hasOwn(TASKS, action) ? TASKS[action]! : null;
}

/** 판단 전에 더 잘 볼 것: 대상 종류마다 하나, 그 종류를 대상으로 둔 행동들의 볼 면을 모은 것(관찰 모드 B, src/act/look.ts). */
export function lookTargets(): { cls: ObjClass; facets: readonly Facet[] }[] {
  const by = new Map<ObjClass, Facet[]>();
  for (const t of Object.values(TASKS)) {
    if (!t.target || !t.look?.length) continue;
    const have = by.get(t.target) ?? [];
    by.set(t.target, [...have, ...t.look.filter((f) => !have.includes(f))]);
  }
  return [...by].map(([cls, facets]) => ({ cls, facets }));
}

/** 실행 추적이 놓기 단계를 끝낸 물건(src/act/track/steps.ts placed): World State id → 그 계획의 넣은 곳(평면도 id), 끝낸 때 그 면의 싱크볼 안이었으면 part basin, 끝낸 시각.
 *  계획을 만들지 않는다. 이미 치운 것을 아는 근거로만 쓴다. */
export type Placed = ReadonlyMap<string, { target: string; part?: "basin"; atMs: number }>;

/** 확인된 값: 사실이 확인됨이고 「모름」 값이 아니면 그 값, 아니면 null(모름). 내용물은 World State가 확인 규칙(사진 3장·4초)을 지킨 값만 확인됨으로 둔다. */
export function sureValue(o: WorldObject, facet: Facet): StateKey | null {
  const f = o.facts[facet];
  return f && f.certainty === "confirmed" && !UNKNOWN_STATES.includes(f.value as StateKey) ? (f.value as StateKey) : null;
}

/** 행동 조건(want)을 그 물건에 견준다: 다 맞음(ok), 확인된 반대 값(mismatch, 묻지 않는다), 모름(unknown: 짐작·모름 값·없음). */
export function wantOf(spec: Pick<TaskSpec, "want">, o: WorldObject): { ok: true } | { ok: false; why: "mismatch" | "unknown"; facet: Facet } {
  for (const [facet, want] of Object.entries(spec.want ?? {}) as [Facet, StateKey][]) {
    const sure = sureValue(o, facet);
    if (sure === null) return { ok: false, why: "unknown", facet };
    if (sure !== want) return { ok: false, why: "mismatch", facet };
  }
  return { ok: true };
}

/** 불투명이 확인된 물건: 옆에서 안이 안 보여 가까이 봐도 내용물을 모른다(사람에게 묻는다). */
export const opaqueBody = (o: WorldObject): boolean => o.facts.body?.value === "opaque" && o.facts.body.certainty === "confirmed";

/** 이미 치운 물건: World State 자리가 싱크대 안이거나, 실행 추적이 놓기 단계를 끝낸 물건(placed). */
export const putAway = (o: WorldObject, placed?: Placed) => o.facts.place?.value === "in_sink" || !!placed?.has(o.id);

/** 사람이 물건을 들고 있고, 든 것을 모르거나 그 종류 물건이다(관절로 든 것이 책·리모컨 같은 다른 종류뿐이면 아니다).
 *  든 물건 id는 확인 전 물건도 들어 있어 종류를 id 앞(book_3 → book)으로 본다.
 *  known이면 든 것을 모를 때는 아니다(사람이 그 자리에서 다른 것을 들고 있는 일: 식사 중 숟가락). */
export function holdsTarget(world: WorldView, cls: string | undefined, known = false): boolean {
  if (world.person.facts.holding?.value !== "holding_object") return false;
  const held = world.person.holding.map((id) => id.replace(/_\d+$/, ""));
  return (held.length === 0 && !known) || (cls !== undefined && held.includes(cls));
}

/** 사람이 그 종류 물건을 쓰는 중이라고 보는 사람 활동(마시는 중이면 컵·병). */
export const USE_ACTS: Readonly<Partial<Record<StateKey, readonly string[]>>> = { drinking: ["cup", "bottle"] };
/** 사람이 그 종류를 쓰는 까닭: 활동(act, USE_ACTS), 들고 있음(holding), 그 물건·가전이 쓰는 중으로 보임(using). */
export type UseWhy = { kind: "act"; act: StateKey } | { kind: "holding" } | { kind: "using" };

/** 사람이 쓰는 것: 까닭과 쓰는 물건 id(World State 물건으로 알 때). ids가 null이면 무엇을 쓰는지 몰라 그 종류 전체다. */
export interface Use { why: UseWhy; ids: string[] | null }

/** 사람이 그 종류(물건·가전)를 지금 쓰는 중인가와 그 까닭·물건. 쓰는 중 지킴의 기준은 여기 하나다(실행 추적 src/act/track/use.ts가 사람이 모두 사라질 때까지 붙잡는다).
 *  사람이 보일 때만, 그 사람이 나타난 뒤(since_ms) 찍힌 사진의 사실로 본다(사라지기 전 사진의 늦은 답은 다음 등장의 근거가 아니다):
 *  - 활동: 그 종류를 쓰는 활동(USE_ACTS, 마시는 중). 손에 든 그 종류 물건이 있으면 그 물건, 없으면 종류 전체.
 *  - 들고 있음: 사람이 그 종류나 무엇인지 모르는 물건을 든다(holdsTarget, 든 id가 World State 물건이면 그 물건, 모르면 종류 전체),
 *    그 종류 물건을 손에 든 채 봤다(그 물건), 후보 자리(sightings)를 손에 든 채 봤다(종류 전체).
 *  - 쓰는 중: 그 종류 물건이 쓰는 중(use in_use)으로 보였다(그 물건), 그 종류 가전이 쓰는 중(종류 전체: 전자레인지를 쓰는 사람). */
export function usingNow(world: WorldView, cls: string): Use | null {
  const p = world.person;
  if (!p.visible) return null;
  const from = p.since_ms ?? Number.NEGATIVE_INFINITY;
  const fresh = (f: WorldFact | undefined, value: string) => f?.value === value && f.at_ms >= from;
  const mine = world.objects.filter((o) => o.cls === cls);
  const inHand = mine.filter((o) => fresh(o.facts.place, "in_hand")).map((o) => o.id);
  const known = (ids: string[]) => {
    const ok = [...new Set(ids)].filter((id) => mine.some((o) => o.id === id));
    return ok.length ? ok : null;
  };
  const act = p.facts.activity;
  if (act && act.at_ms >= from && USE_ACTS[act.value as StateKey]?.includes(cls)) return { why: { kind: "act", act: act.value as StateKey }, ids: known(inHand) };
  if (fresh(p.facts.holding, "holding_object") && holdsTarget(world, cls)) {
    const held = p.holding.filter((id) => id.replace(/_\d+$/, "") === cls);
    // 든 것 가운데 World State 물건이 아닌 id(확인 전 물건)나 무엇인지 모르는 듦이 있으면 어느 물건인지 몰라 종류 전체다
    const unknown = held.length === 0 || held.some((id) => !mine.some((o) => o.id === id));
    return { why: { kind: "holding" }, ids: unknown ? null : known([...held, ...inHand]) };
  }
  if (inHand.length) return { why: { kind: "holding" }, ids: inHand };
  if ((world.sightings ?? []).some((s) => s.cls === cls && s.in_hand && s.at_ms >= from)) return { why: { kind: "holding" }, ids: null };
  const used = mine.filter((o) => fresh(o.facts.use, "in_use")).map((o) => o.id);
  if (used.length) return { why: { kind: "using" }, ids: used };
  if (world.fixtures.some((f) => f.cls === cls && fresh(f.facts.use, "in_use"))) return { why: { kind: "using" }, ids: null };
  return null;
}

/** 대상 종류 중 사라지지 않았고 이미 치우지 않은(싱크대 안·실행 추적이 놓은 것이 아닌) 물건 가운데 가장 최근에 본 것. 대상이 없는 행동이거나 못 찾으면 null. */
export function targetOf(spec: Pick<TaskSpec, "target">, world: WorldView, placed?: Placed): WorldObject | null {
  if (!spec.target) return null;
  return world.objects.filter((o) => o.cls === spec.target && o.status !== "gone" && !putAway(o, placed)).sort((a, b) => b.last_seen_ms - a.last_seen_ms)[0] ?? null;
}

/** 찾을 자리: 안 보이는 대상을 마지막으로 본 자리. objectId는 확인 물건 id, 후보 자리(World State sightings)면 null. */
export interface LostSpot { objectId: string | null; cls: ObjClass; position: [number, number, number]; surface: string | null; surface_label: string | null; at_ms: number }

/** 대상이 안 보일 때 찾으러 갈 자리(가장 새 것 하나). 그 종류 있는 물건이 freshMs 안에(seenAfter를 주면 그 뒤에도) 보였으면 null
 *  (막은 검사의 신선도 기준을 그대로 받는다: 실행 전 검사는 판단 뒤에 다시 본 것만 신선하다).
 *  objectId를 주면(실행 전) 그 물건의 마지막 자리만, 아니면(계획 전) 그 종류 확인 물건과 후보 자리(sightings) 가운데 고른다.
 *  치운 것(putAway, 놓기를 끝낸 물건의 옛 id away 포함)·들고 감 보호(carried)였던 물건·자리를 모르는 물건·쉬는 자리(resting: 찾아보고 못 찾은 자리)는 뺀다. */
export function lostTarget(i: {
  world: WorldView; cls: ObjClass; now: number; freshMs: number; placed?: Placed; objectId?: string;
  /** 이 시각 뒤에 본 것만 신선하다(실행 전 검사의 판단 시각). 없으면 freshMs만 본다. */
  seenAfter?: number;
  /** 놓기를 끝낸 물건의 옛 id(실행 추적 Steps.awayIds): 그 마지막 자리는 치우기 전 자리라 찾지 않는다. */
  away?: ReadonlySet<string>;
  resting?: (spot: { cls: ObjClass; position: [number, number, number] }) => boolean;
}): LostSpot | null {
  const mine = i.world.objects.filter((o) => o.cls === i.cls && (i.objectId === undefined || o.id === i.objectId));
  const fresh = (o: WorldObject) => o.status === "present" && o.last_seen_ms > (i.seenAfter ?? Number.NEGATIVE_INFINITY) && i.now - o.last_seen_ms <= i.freshMs;
  if (mine.some((o) => fresh(o) && !putAway(o, i.placed))) return null;
  const spots: LostSpot[] = mine.filter((o) => o.position && !putAway(o, i.placed) && o.carried !== true && !i.away?.has(o.id))
    .map((o) => ({
      objectId: o.id, cls: i.cls, position: [...o.position!] as [number, number, number], surface: o.surface, surface_label: o.surface_label, at_ms: o.last_seen_ms,
    }));
  if (i.objectId === undefined) {
    for (const s of i.world.sightings ?? []) {
      if (s.cls === i.cls) spots.push({ objectId: null, cls: i.cls, position: [...s.position], surface: s.surface, surface_label: s.surface_label, at_ms: s.at_ms });
    }
  }
  return spots.filter((s) => !i.resting?.(s)).sort((a, b) => b.at_ms - a.at_ms)[0] ?? null;
}

/** 놓기를 끝낸 물건이 「치운 물건」(placed)인가: 그 행동의 대상 종류이고 집어 옮긴 것이 바로 그 대상일 때만(컵 치우기의 컵).
 *  다시 쓰는 물건(채워 주기에서 따르고 내려놓은 병: 집는 종류가 대상과 다름)과 대상 종류가 없는 행동의 물건은 아니다. 기준은 여기 하나다. */
export const clearsAway = (spec: Pick<TaskSpec, "target" | "carry"> | null, cls: string): boolean =>
  !!spec?.target && cls === spec.target && (spec.carry ?? spec.target) === spec.target;

/** 계획이 다루는 물건: 첫 act 단계의 대상 물건 id. 없으면 null. */
export function planTargetId(plan: PlanView): string | null {
  return plan.steps.find((s) => s.kind === "act" && s.target?.objectId)?.target?.objectId ?? null;
}

/** 계획 단계 대상(objectId) 가운데 그 종류인 물건 id 전부(단계 차례, 겹치지 않게): World State에서 그 종류인 것과,
 *  World State에 없지만 그 종류 id 꼴(cup_2)인 것(없어진 물건을 「없음」으로 막으려고). */
export function planObjectsOf(plan: PlanView, world: WorldView, cls: ObjClass): string[] {
  const shaped = new RegExp(`^${cls}_\\d+$`);
  const out: string[] = [];
  for (const s of plan.steps) {
    const id = s.target?.objectId;
    if (!id || out.includes(id)) continue;
    const o = world.objects.find((x) => x.id === id);
    if (o ? o.cls === cls : shaped.test(id)) out.push(id);
  }
  return out;
}

export const planIdOf = (decisionId: string) => `plan:${decisionId}`;

const squash = (t: string) => t.replace(/[\s.,!?~·]+/g, "");
/** whole 답 앞에 붙어도 되는 말. */
const LEAD = /^(응|어|네|예|자|이제)+/;
/** whole 답 뒤에 붙어도 되는 짧은 꼬리. */
const TAIL = ["", "요", "해", "해요", "해줘", "해줘요", "해주세요", "할게", "할게요"];

/** 폰에서 말한 답 → 선택지. 버튼 글이나 그 선택지의 말(words)이 들어 있는 첫 선택지(whole이면 말 전체가 그 말일 때만). 없으면 null. */
export function matchChoice(text: string, choices: readonly ActionChoice[]): ActionChoice | null {
  const said = squash(text);
  if (!said) return null;
  const core = said.replace(LEAD, "");
  // whole: 앞말을 지운 글과 지우기 전 글을 다 본다(「네」「응」 한 마디는 앞말을 지우면 빈 글이다)
  const hit = (c: ActionChoice, w: string) => (c.whole ? TAIL.some((t) => core === squash(w) + t || said === squash(w) + t) : said.includes(squash(w)));
  return choices.find((c) => [c.label, ...c.words].some((w) => hit(c, w))) ?? null;
}
