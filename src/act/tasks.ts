// 행동 목록의 행동마다 계획 모양을 정해 둔다. PAM이 고른 행동(task_index → 행동 이름)을 클로이드 계획으로 바꾼다.
// 대기(-1)·판단 실패·계획 모양이 없는 행동은 계획이 없다.
import type { PlanView } from "../contract/plan.js";
import type { ObjClass, WorldObject, WorldView } from "../contract/world.js";
import type { FloorPlan } from "../plan/floor.js";
import { askPlan, cupPlan } from "../plan/planner.js";
import type { DecisionRecord } from "../world/decide.js";
import { PROMPTS, type ActionChoice, type ActionPrompt, type TaskName } from "./prompts.js";

/** pick_place: 대상 물건을 집어 옮긴다(로봇이 없어 폰으로 사람에게 부탁). ask: 폰으로 묻는다. */
export interface TaskSpec { name: TaskName; kind: "pick_place" | "ask"; target?: ObjClass; prompt: ActionPrompt }

export const TASKS: Record<string, TaskSpec> = {
  "컵 치우기": { name: "컵 치우기", kind: "pick_place", target: "cup", prompt: PROMPTS["컵 치우기"] },
  "사용자에게 물어보기": { name: "사용자에게 물어보기", kind: "ask", prompt: PROMPTS["사용자에게 물어보기"] },
};

/** 행동 이름 → 계획 모양. 목록 밖이면 null. */
export function taskOf(action: string | null): TaskSpec | null {
  return action && Object.hasOwn(TASKS, action) ? TASKS[action]! : null;
}

/** 대상 종류 중 사라지지 않고 가장 최근에 본 물건. 대상이 없는 행동이거나 못 찾으면 null. */
export function targetOf(spec: TaskSpec, world: WorldView): WorldObject | null {
  if (!spec.target) return null;
  return world.objects.filter((o) => o.cls === spec.target && o.status !== "gone").sort((a, b) => b.last_seen_ms - a.last_seen_ms)[0] ?? null;
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

/** 폰에서 말한 답 → 선택지. 버튼 글이나 그 선택지의 말(words)이 들어 있는 첫 선택지. 없으면 null. */
export function matchChoice(text: string, choices: readonly ActionChoice[]): ActionChoice | null {
  const said = squash(text);
  if (!said) return null;
  return choices.find((c) => [c.label, ...c.words].some((w) => said.includes(squash(w)))) ?? null;
}
