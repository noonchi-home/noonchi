// 행동 목록(PAM에 보내는 작업 목록과 그 설명). PAM이 고른 행동(task_index → 행동 이름)은 에이전트가 계획 모드로 계획을 만든다(src/agent/planner.ts).
// 목록은 services/pam/scenarios/noonchi/tasks.json과 같다(tests/agent-planner.test.ts). 최종 목록은 FSM 담당(박석준·김준형)이 정한다.
// 여기에는 계획 모양이 없다: 무엇을 어떤 순서로 할지는 에이전트가 정한다. target은 계획 전 검사(LLM을 부르기 전)에만 쓴다.
import type { PlanView } from "../contract/plan.js";
import type { Facet, ObjClass, WorldObject, WorldView } from "../contract/world.js";
import type { DeviceKind } from "../hub/types.js";
import type { ActionChoice } from "./prompts.js";

type Kind = "go" | "pick" | "place" | "do" | "device" | "ask" | "say" | "wait";
/** 이 행동의 계획에 쓸 수 있는 단계: 단계 종류(src/agent/planTools.ts AgentStepKind), 꼭 있어야 하는 단계 종류(need), 기기 단계의 가전 종류·도구. 승인한 일의 범위다. */
export interface TaskAllow { kinds: readonly Kind[]; need: readonly Kind[]; devices?: { kinds: readonly DeviceKind[]; tools: readonly string[] } }

/** 행동 하나: 이름, 에이전트에게 주는 설명, 쓸 수 있는 단계, 계획 전 검사의 대상 종류(이 종류 중 치우지 않은 물건이 보여야 부른다),
 *  판단 전에 더 잘 볼 대상 물건의 면(look: 모르면 관찰 모드 B가 가까이 볼지 고른다, src/act/look.ts). */
export interface TaskSpec {
  name: string; description: string; allow: TaskAllow; target?: ObjClass; look?: readonly Facet[];
  /** false면 계획을 만들지 않는 행동이다. 판단 기록과 생각 말풍선에만 보인다. */
  plan?: false;
  /** 집는 물건 종류. 없으면 target이다. */
  carry?: ObjClass;
  /** true면 집는 물건이 안 보여도(냉장고 안) 평면도 자리에서 집는 단계를 받는다. */
  carryUnseen?: true;
}

const HAND = ["go", "pick", "place"] as const;
/** 채워 주기: 병을 꺼내 와 그 자리에서 따른다(do). 병을 도로 넣는 place는 써도 되고 안 써도 된다. */
const FILL: TaskAllow = { kinds: ["go", "pick", "do", "place"], need: ["go", "pick", "do"] };

export const TASKS: Record<string, TaskSpec> = {
  "컵 치우기": {
    name: "컵 치우기", description: "사람이 자리를 비운 뒤 식탁 등에 남은 컵을 사람이 싱크대에 넣게 한다.", target: "cup", look: ["contents"],
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
    name: "컵 그대로 두기", description: "사람이 자리를 비웠지만 컵에 음료가 남아 있어 치우지 않고 그대로 둔다.", target: "cup", look: ["contents"], plan: false,
    allow: { kinds: [], need: [] },
  },
  "컵에 물 채워 주기": {
    name: "컵에 물 채워 주기", description: "사람이 식사 중인데 컵이 비어 있으면 사람이 냉장고에서 물병을 꺼내 와 컵에 물을 따르게 한다.", target: "cup", look: ["contents"],
    carry: "bottle", carryUnseen: true, allow: FILL,
  },
  "컵에 콜라 따라 주기": {
    name: "컵에 콜라 따라 주기", description: "사람이 TV를 보는 중인데 컵이 비어 있으면 사람이 냉장고에서 콜라를 꺼내 와 컵에 따르게 한다.", target: "cup", look: ["contents"],
    carry: "bottle", carryUnseen: true, allow: FILL,
  },
};

/** PAM에 보내는 행동 목록(순서가 task_index다). */
export const TASK_NAMES: readonly string[] = Object.keys(TASKS);

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

/** 실행 추적이 놓기 단계를 끝낸 물건(src/act/track.ts placed): World State id → 그 계획의 넣은 곳(평면도 id), 끝낸 때 그 면의 싱크볼 안이었으면 part basin, 끝낸 시각.
 *  계획을 만들지 않는다. 이미 치운 것을 아는 근거로만 쓴다. */
export type Placed = ReadonlyMap<string, { target: string; part?: "basin"; atMs: number }>;

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

/** 대상 종류 중 사라지지 않았고 이미 치우지 않은(싱크대 안·실행 추적이 놓은 것이 아닌) 물건 가운데 가장 최근에 본 것. 대상이 없는 행동이거나 못 찾으면 null. */
export function targetOf(spec: Pick<TaskSpec, "target">, world: WorldView, placed?: Placed): WorldObject | null {
  if (!spec.target) return null;
  return world.objects.filter((o) => o.cls === spec.target && o.status !== "gone" && !putAway(o, placed)).sort((a, b) => b.last_seen_ms - a.last_seen_ms)[0] ?? null;
}

/** 계획이 다루는 물건: 첫 act 단계의 대상 물건 id. 없으면 null. */
export function planTargetId(plan: PlanView): string | null {
  return plan.steps.find((s) => s.kind === "act" && s.target?.objectId)?.target?.objectId ?? null;
}

/** 계획 단계 대상(objectId) 가운데 World State에서 그 종류인 첫 물건 id. 없으면 null. */
export function planObjectOf(plan: PlanView, world: WorldView, cls: ObjClass): string | null {
  for (const s of plan.steps) {
    const id = s.target?.objectId;
    if (id && world.objects.some((o) => o.id === id && o.cls === cls)) return id;
  }
  return null;
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
  const hit = (c: ActionChoice, w: string) => (c.whole ? TAIL.some((t) => core === squash(w) + t) : said.includes(squash(w)));
  return choices.find((c) => [c.label, ...c.words].some((w) => hit(c, w))) ?? null;
}
