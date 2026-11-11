// 대시보드 말풍선 카드 한 문장: 열린 계획이면 실제 폰에 낸 지금 명령(컵 명령은 정한 글, 그 밖의 사람 단계는 단계 이름), 명령이 없는 기다리기·기기 단계는
// 그 단계, 그것도 아니면 정한 것. 닫힌 지 SAY_DONE_MS 안이면 끝낸 일, 그 밖에는 지켜보는 것.
// 승인 질문은 대시보드에 보이지 않는다(D37): 단계 id가 :approve로 끝나는 명령은 없는 것으로 본다.
// 가까이 보기(src/act/look.ts)를 시작한 지 SAY_LOOK_MS 안이면 계획과 상관없이 그 자리를 가까이 보고 있다고 한다.
import type { PlannedCommandMessage } from "../contract/phone.js";
import type { PlanView } from "../contract/plan.js";
import type { WorldView } from "../contract/world.js";
import { SAY_TEXT, STEP_COMMAND, STEP_LABEL } from "../plan/labels.js";
import { planTargetId } from "./tasks.js";

export const SAY_DONE_MS = 20_000;
export const SAY_LOOK_MS = 6000;
const OPEN = new Set<PlanView["status"]>(["planned", "running"]);

/** 컵 치우기 단계(단계 이름이나 명령 글이 같다)면 그 열쇠(정한 말풍선 글이 있다). */
const cupKey = (label: string | undefined, text: string) =>
  (Object.keys(STEP_COMMAND) as (keyof typeof STEP_COMMAND)[]).find((k) => STEP_LABEL[k] === label || STEP_COMMAND[k] === text) ?? null;

/** look: 마지막으로 가까이 보기를 시작한 자리 이름과 그 시각. */
export function sayLine({ plan, command, world, nowMs, look = null }: {
  plan: PlanView | null; command: PlannedCommandMessage | null; world: WorldView | null; nowMs: number; look?: { place: string; atMs: number } | null;
}): string {
  if (look && nowMs - look.atMs <= SAY_LOOK_MS) return SAY_TEXT.closer(look.place);
  if (plan && OPEN.has(plan.status)) {
    const sent = command?.type === "command" && command.id === plan.id && !command.step.endsWith(":approve") ? command : null;
    if (sent && sent.choices.length > 1) return SAY_TEXT.asked;
    const step = sent ? plan.steps.find((s) => s.id === sent.step) : undefined;
    const key = sent ? cupKey(step?.label, sent.text) : null;
    if (key) return SAY_TEXT.told[key];
    if (step) return sent!.choices.length === 0 ? SAY_TEXT.said : SAY_TEXT.toldStep(step.label);
    const active = plan.steps.find((s) => s.status === "active");
    if (active?.kind === "wait") return SAY_TEXT.waiting(active.label);
    if (active?.kind === "device") return SAY_TEXT.device(active.label);
    const cupId = planTargetId(plan);
    const surface = cupId ? world?.objects.find((o) => o.id === cupId)?.surface_label ?? null : null;
    return SAY_TEXT.decided(plan.goal, surface);
  }
  if (plan && nowMs - Date.parse(plan.updatedAt) <= SAY_DONE_MS) return plan.status === "done" ? SAY_TEXT.done(plan.goal) : SAY_TEXT.stopped(plan.goal);
  const seen = world?.objects.filter((o) => o.status !== "gone" && o.surface_label).sort((a, b) => b.last_seen_ms - a.last_seen_ms)[0];
  return seen?.surface_label ? SAY_TEXT.looking(seen.surface_label) : SAY_TEXT.watching;
}
