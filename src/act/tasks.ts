// 행동 목록(PAM에 보내는 작업 목록과 그 설명). PAM이 고른 행동(task_index → 행동 이름)은 에이전트가 계획 모드로 계획을 만든다(src/agent/planner.ts).
// 목록은 services/pam/scenarios/noonchi/tasks.json과 같다(tests/agent-planner.test.ts). 최종 목록은 FSM 담당(박석준·김준형)이 정한다.
// 여기에는 계획 모양이 없다: 무엇을 어떤 순서로 할지는 에이전트가 정한다. target은 계획 전 검사(LLM을 부르기 전)에만 쓴다.
import type { PlanView } from "../contract/plan.js";
import type { Facet, ObjClass, WorldObject, WorldView } from "../contract/world.js";
import type { DeviceKind } from "../hub/types.js";
import type { ActionChoice } from "./prompts.js";

type Kind = "go" | "pick" | "place" | "device" | "ask" | "say" | "wait";
/** 이 행동의 계획에 쓸 수 있는 단계: 단계 종류(src/agent/planTools.ts AgentStepKind), 꼭 있어야 하는 단계 종류(need), 기기 단계의 가전 종류·도구. 승인한 일의 범위다. */
export interface TaskAllow { kinds: readonly Kind[]; need: readonly Kind[]; devices?: { kinds: readonly DeviceKind[]; tools: readonly string[] } }

/** 행동 하나: 이름, 에이전트에게 주는 설명, 쓸 수 있는 단계, 계획 전 검사의 대상 종류(이 종류 중 치우지 않은 물건이 보여야 부른다),
 *  판단 전에 더 잘 볼 대상 물건의 면(look: 모르면 관찰 모드 B가 가까이 볼지 고른다, src/act/look.ts). */
export interface TaskSpec { name: string; description: string; allow: TaskAllow; target?: ObjClass; look?: readonly Facet[] }

const HAND = ["go", "pick", "place"] as const;

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
};

/** PAM에 보내는 행동 목록(순서가 task_index다). */
export const TASK_NAMES: readonly string[] = Object.keys(TASKS);

/** 행동 이름 → 행동. 목록 밖이면 null. */
export function taskOf(action: string | null): TaskSpec | null {
  return action && Object.hasOwn(TASKS, action) ? TASKS[action]! : null;
}

/** 판단 전에 더 잘 볼 것: 대상 종류와 볼 면이 있는 행동마다 하나(관찰 모드 B, src/act/look.ts). */
export function lookTargets(): { cls: ObjClass; facets: readonly Facet[] }[] {
  return Object.values(TASKS).flatMap((t) => (t.target && t.look?.length ? [{ cls: t.target, facets: t.look }] : []));
}

/** 실행 추적이 놓기 단계를 끝낸 물건(src/act/track.ts placed): World State id → 그 계획의 넣은 곳(평면도 id), 끝낸 때 그 면의 싱크볼 안이었으면 part basin, 끝낸 시각.
 *  계획을 만들지 않는다. 이미 치운 것을 아는 근거로만 쓴다. */
export type Placed = ReadonlyMap<string, { target: string; part?: "basin"; atMs: number }>;

/** 이미 치운 물건: World State 자리가 싱크대 안이거나, 실행 추적이 놓기 단계를 끝낸 물건(placed). */
export const putAway = (o: WorldObject, placed?: Placed) => o.facts.place?.value === "in_sink" || !!placed?.has(o.id);

/** 사람이 물건을 들고 있고, 든 것을 모르거나 그 종류 물건이다(관절로 든 것이 책·리모컨 같은 다른 종류뿐이면 아니다).
 *  든 물건 id는 확인 전 물건도 들어 있어 종류를 id 앞(book_3 → book)으로 본다. */
export function holdsTarget(world: WorldView, cls: string | undefined): boolean {
  if (world.person.facts.holding?.value !== "holding_object") return false;
  const held = world.person.holding.map((id) => id.replace(/_\d+$/, ""));
  return held.length === 0 || (cls !== undefined && held.includes(cls));
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
