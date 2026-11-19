// 대시보드 말풍선 말 한 문장(메시지 상자 줄, 클로이드가 직접 하는 말): 사람 자세가 쓰러짐 의심(src/world/fall.ts)이면 무엇보다 먼저 그것을 알린다.
// 열린 계획이면 실제 폰에 낸 지금 명령을 클로이드 말로 바꾼 것(「컵을 들어 주세요」 → 「컵을 들게요.」, 끝을 모르면 단계 이름), 명령이 없는 기다리기·기기 단계는
// 그 단계, 그것도 아니면 정한 것. 닫힌 지 SAY_DONE_MS 안이면 끝낸 일, 그 밖에는 지켜보는 것.
// 승인 질문은 대시보드에 보이지 않는다(D37): 단계 id가 :approve(처음 하는 일)·:hand(손으로 켜는 위험 가전 켜기 전 질문)로 끝나는 명령은 없는 것으로 본다.
// 코치 계획: 다시 알린(tell) 지 SAY_TOLD_MS 안이면 다시 알려 줬다고, 조용한 단계면 그 단계를 지켜본다고, 끄기 안내(:off)가 떠 있으면 불을 꺼 달라고 했다고 한다.
// 끄기 안내가 남아 새 계획 시작을 미루는 동안(src/act/track/safety.ts offWaiting)은 그 가전 꺼짐을 기다린다고 한다.
// 다른 계획이 도는 동안 닫힌 계획의 가전이 다시 켜져 그 안내가 줄에서 기다리면(src/act/track/safety.ts offTold) SAY_DONE_MS 동안 다시 켜졌다고 한다.
// 가까이 보기(src/act/look.ts)를 시작한 지 SAY_LOOK_MS 안이면 계획과 상관없이 그 자리를 가까이 보고 있다고 한다.
// 외부 연락 결과(AS센터 전화·보호자 연락, src/agent/service.ts serviceSay)는 SAY_DONE_MS 동안 계획·지켜보기 글보다 먼저 말하되, 안전 알림(쓰러짐 의심·다시 켜짐·끄기 안내·꺼짐 기다림)이 먼저다.
import type { PlannedCommandMessage } from "../contract/phone.js";
import type { PlanView } from "../contract/plan.js";
import type { WorldView } from "../contract/world.js";
import { SAY_TEXT, STEP_COMMAND, STEP_LABEL } from "./labels.js";
import { isOffStep } from "./off-step.js";
import { planTargetId } from "./tasks.js";
import { POSE_FALL } from "../world/vocab.js";

export const SAY_DONE_MS = 20_000;
export const SAY_LOOK_MS = 6000;
/** 다시 알린 뒤 이만큼(ms) 「다시 알려 줬어요.」(실행 추적이 그 글을 띄워 두는 시간 tellHoldMs와 같다). */
export const SAY_TOLD_MS = 8000;
const HIDDEN = /:(approve|hand)$/;
const OPEN = new Set<PlanView["status"]>(["planned", "running"]);

/** 컵 치우기 단계(단계 이름이나 명령 글이 같다)면 그 열쇠(정한 폰 명령 STEP_COMMAND으로 말한다). */
const cupKey = (label: string | undefined, text: string) =>
  (Object.keys(STEP_COMMAND) as (keyof typeof STEP_COMMAND)[]).find((k) => STEP_LABEL[k] === label || STEP_COMMAND[k] === text) ?? null;

/** look: 마지막으로 가까이 보기를 시작한 자리 이름과 그 시각.
 *  told: 마지막으로 다시 알린(tell) 시각. quiet: 지금 조용히 띄운 단계 이름(src/act/track/coach.ts quietStep).
 *  reflected: 마지막 반성 시각과 새로 배운 규칙 수·쓰고 있는 습관 수(20초 동안 말한다). offWait: 끄기 안내 때문에 새 계획을 미루는 동안 기다리는 가전 이름.
 *  offTold: 줄에서 기다리는 끄기 안내를 마지막으로 소리로 알린 가전 이름과 시각(20초 동안 말한다). service: 마지막 외부 연락 결과 글과 그 시각(20초 동안 말한다). */
export interface SayInput {
  plan: PlanView | null; command: PlannedCommandMessage | null; world: WorldView | null; nowMs: number; look?: { place: string; atMs: number } | null;
  told?: { atMs: number } | null; quiet?: string | null; reflected?: { atMs: number; learned: number; active: number } | null; offWait?: string | null;
  offTold?: { device: string; atMs: number } | null; service?: { text: string; atMs: number } | null;
}

/** 말풍선 말과, 그 말이 안전 알림(쓰러짐 의심·다시 켜짐·꺼짐 기다림·끄기 안내)인가. 대시보드 메시지 상자는 안전 알림이 유효한 동안 한 줄을 늘 그 알림에 준다. */
export function sayOf(i: SayInput): { text: string; safety: boolean } {
  const { world, nowMs, look = null, offWait = null, offTold = null, command } = i;
  if (world?.person?.facts.posture?.value === POSE_FALL) return { text: SAY_TEXT.fall, safety: true };
  if (look && nowMs - look.atMs <= SAY_LOOK_MS) return { text: SAY_TEXT.closer(look.place), safety: false };
  if (offTold && nowMs - offTold.atMs <= SAY_DONE_MS) return { text: SAY_TEXT.rearmed(offTold.device), safety: true };
  if (offWait) return { text: SAY_TEXT.offWait(offWait), safety: true };
  // 끄기 안내(켠 채 닫힌 계획 뒤)가 떠 있는 동안
  if (command?.type === "command" && isOffStep(command.step)) return { text: SAY_TEXT.offAsked, safety: true };
  return { text: restLine(i), safety: false };
}

/** 말풍선 글 한 문장(sayOf의 글). */
export const sayLine = (i: SayInput): string => sayOf(i).text;

/** 안전 알림·가까이 보기 다음 차례의 말. */
function restLine({ plan, command, world, nowMs, told = null, quiet = null, reflected = null, service = null }: SayInput): string {
  if (service && nowMs - service.atMs <= SAY_DONE_MS) return service.text;
  if (plan && OPEN.has(plan.status)) {
    if (told && nowMs - told.atMs <= SAY_TOLD_MS) return SAY_TEXT.retold;
    if (quiet) return SAY_TEXT.quiet(quiet);
    const sent = command?.type === "command" && command.id === plan.id && !HIDDEN.test(command.step) ? command : null;
    if (sent && sent.choices.length > 1) return SAY_TEXT.asked;
    const step = sent ? plan.steps.find((s) => s.id === sent.step) : undefined;
    const key = sent ? cupKey(step?.label, sent.text) : null;
    if (key) return SAY_TEXT.will(STEP_COMMAND[key], step?.label ?? STEP_LABEL[key]);
    // 컵 안 보기(위에서 비추기, src/act/track/steps.ts topStep)
    if (step && sent!.view === "above") return SAY_TEXT.lookIn(sent!.target?.label ?? step.label);
    if (step) return sent!.choices.length === 0 ? SAY_TEXT.said : SAY_TEXT.will(sent!.text, step.label);
    const active = plan.steps.find((s) => s.status === "active");
    if (active?.kind === "wait") return SAY_TEXT.waiting(active.label);
    if (active?.kind === "device") return SAY_TEXT.device(active.label);
    const cupId = planTargetId(plan);
    const surface = cupId ? world?.objects.find((o) => o.id === cupId)?.surface_label ?? null : null;
    return SAY_TEXT.decided(plan.goal, surface);
  }
  if (reflected && nowMs - reflected.atMs <= SAY_DONE_MS) {
    if (reflected.learned > 0) return SAY_TEXT.learned(reflected.learned);
    if (reflected.active > 0) return SAY_TEXT.using(reflected.active);
  }
  if (plan && nowMs - Date.parse(plan.updatedAt) <= SAY_DONE_MS) return plan.status === "done" ? SAY_TEXT.done(plan.goal) : SAY_TEXT.stopped(plan.goal);
  const seen = world?.objects.filter((o) => o.status !== "gone" && o.surface_label).sort((a, b) => b.last_seen_ms - a.last_seen_ms)[0];
  return seen?.surface_label ? SAY_TEXT.looking(seen.surface_label) : SAY_TEXT.watching;
}
