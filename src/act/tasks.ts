// 행동 목록의 행동마다 계획 모양을 정해 둔다. PAM이 고른 행동(task_index → 행동 이름)을 클로이드 계획으로 바꾼다.
// 대기(-1)·판단 실패·계획 모양이 없는 행동은 계획이 없다.
import type { PlanStep, PlanView } from "../contract/plan.js";
import type { ObjClass, WorldObject, WorldView } from "../contract/world.js";
import type { FloorPlan } from "../plan/floor.js";
import { STEP_COMMAND, STEP_LABEL } from "../plan/labels.js";
import { askPlan, cupPlan } from "../plan/planner.js";
import type { DecisionRecord } from "../world/decide.js";
import { ASK_PROMPT, type ActionChoice, type ActionPrompt, type TaskName } from "./prompts.js";

/** pick_place: 대상 물건을 집어 옮긴다(로봇이 없어 실제 폰으로 사람에게 단계마다 명령). ask: 실제 폰으로 묻는다. */
export type TaskSpec =
  | { name: TaskName; kind: "pick_place"; target: ObjClass }
  | { name: TaskName; kind: "ask"; target?: undefined; prompt: ActionPrompt };

export const TASKS: Record<string, TaskSpec> = {
  "컵 치우기": { name: "컵 치우기", kind: "pick_place", target: "cup" },
  "사용자에게 물어보기": { name: "사용자에게 물어보기", kind: "ask", prompt: ASK_PROMPT },
};

/** 컵 치우기 단계 열쇠(STEP_LABEL·STEP_COMMAND와 같다). 실행 추적이 단계마다 명령과 넘어가는 때를 고른다. */
export type CupStep = keyof typeof STEP_COMMAND;

/** 계획 단계 → 컵 치우기 단계 열쇠(cupPlan이 단 단계 글로 찾는다). 컵 치우기 단계가 아니면 null. */
export function cupStepOf(step: PlanStep): CupStep | null {
  return (Object.keys(STEP_COMMAND) as CupStep[]).find((k) => STEP_LABEL[k] === step.label) ?? null;
}

/** 행동 이름 → 계획 모양. 목록 밖이면 null. */
export function taskOf(action: string | null): TaskSpec | null {
  return action && Object.hasOwn(TASKS, action) ? TASKS[action]! : null;
}

/** 이미 치운 물건: World State 자리가 싱크대 안. */
export const putAway = (o: WorldObject) => o.facts.place?.value === "in_sink";

/** 대상 종류 중 사라지지 않았고 이미 치우지 않은(싱크대 안이 아닌) 물건 가운데 가장 최근에 본 것. 대상이 없는 행동이거나 못 찾으면 null. */
export function targetOf(spec: TaskSpec, world: WorldView): WorldObject | null {
  if (!spec.target) return null;
  return world.objects.filter((o) => o.cls === spec.target && o.status !== "gone" && !putAway(o)).sort((a, b) => b.last_seen_ms - a.last_seen_ms)[0] ?? null;
}

/** 계획이 다루는 물건: 첫 act 단계의 대상 물건 id. 없으면 null. */
export function planTargetId(plan: PlanView): string | null {
  return plan.steps.find((s) => s.kind === "act" && s.target?.objectId)?.target?.objectId ?? null;
}

export const planIdOf = (decisionId: string) => `plan:${decisionId}`;

export function planFor(fp: FloorPlan, d: DecisionRecord, world: WorldView, nowIso: string): PlanView | null {
  const spec = taskOf(d.action);
  if (d.status !== "valid" || !d.prediction || !spec) return null;
  const id = planIdOf(d.id);
  const base = spec.kind === "ask" ? askPlan(fp, id, nowIso) : cupPlan(fp, id, nowIso, targetOf(spec, world));
  return base && { ...base, judgment: d.prediction.reasoning };
}

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
