// 대시보드 말풍선 카드 한 문장: 열린 계획이면 실제 폰에 낸 지금 명령(없거나 승인 질문이면 정한 것), 닫힌 지 SAY_DONE_MS 안이면 끝낸 일, 그 밖에는 지켜보는 것.
// 승인 질문은 대시보드에 보이지 않는다(D37): 단계 id가 :approve로 끝나는 명령은 없는 것으로 본다.
import type { PlannedCommandMessage } from "../contract/phone.js";
import type { PlanView } from "../contract/plan.js";
import type { WorldView } from "../contract/world.js";
import { SAY_TEXT } from "../plan/labels.js";
import { cupStepOf, planTargetId } from "./tasks.js";

export const SAY_DONE_MS = 20_000;
const OPEN = new Set<PlanView["status"]>(["planned", "running"]);

export function sayLine({ plan, command, world, nowMs }: { plan: PlanView | null; command: PlannedCommandMessage | null; world: WorldView | null; nowMs: number }): string {
  if (plan && OPEN.has(plan.status)) {
    const sent = command?.type === "command" && command.id === plan.id && !command.step.endsWith(":approve") ? command : null;
    if (sent && sent.choices.length > 1) return SAY_TEXT.asked;
    const step = sent ? plan.steps.find((s) => s.id === sent.step) : undefined;
    const key = step ? cupStepOf(step) : null;
    if (key) return SAY_TEXT.told[key];
    const cupId = planTargetId(plan);
    const surface = cupId ? world?.objects.find((o) => o.id === cupId)?.surface_label ?? null : null;
    return SAY_TEXT.decided(plan.goal, surface);
  }
  if (plan && nowMs - Date.parse(plan.updatedAt) <= SAY_DONE_MS) return plan.status === "done" ? SAY_TEXT.done(plan.goal) : SAY_TEXT.stopped(plan.goal);
  const seen = world?.objects.filter((o) => o.status !== "gone" && o.surface_label).sort((a, b) => b.last_seen_ms - a.last_seen_ms)[0];
  return seen?.surface_label ? SAY_TEXT.looking(seen.surface_label) : SAY_TEXT.watching;
}
