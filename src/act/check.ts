// 검사(결정론) 둘. 통과하지 못하면 실행하지 않고 이유(CHECK_TEXT)를 낸다.
// 계획 전 검사(checkDecision, 에이전트를 부르기 전): 행동 목록에 있는 행동이다, 대상 종류가 있는 행동이면 치우지 않은 대상이 보인다(남은 같은 종류가 모두 싱크대 안이면 그 이유).
// 실행 전 검사(checkPlan, 에이전트가 만든 계획): 아는 행동이고 계획이 있다, 대상 물건이 있고 이미 싱크대 안이 아니다, 판단 뒤에 찍힌 프레임으로 다시 봤고 STALE_MS 안이다,
// 사람이 그 물건을 들고 있거나 쓰는 중이 아니다, 이동 단계가 있으면 경로가 있다, 시험 모드에서는 짝지은 실제 가전 단계를 막는다.
import type { PlanView } from "../contract/plan.js";
import type { ControlMode } from "../contract/setup.js";
import type { WorldView } from "../contract/world.js";
import { CHECK_TEXT } from "../plan/labels.js";
import type { DecisionRecord } from "../world/decide.js";
import { holdsTarget, planTargetId, putAway, taskOf } from "./tasks.js";

export type CheckFail = keyof typeof CHECK_TEXT;
export type CheckResult = { ok: true } | { ok: false; reason: CheckFail; text: string };
export interface CheckInput {
  decision: DecisionRecord;
  /** 이번 판단에 보낸 행동 목록. */
  tasks: string[];
  plan: PlanView | null;
  world: WorldView;
  nowMs: number;
  /** 대상을 마지막으로 본 뒤 이만큼 지나면 낡은 근거(STALE_MS). */
  staleMs: number;
  mode: ControlMode;
  /** 계획의 가전 단계와 그 가전이 실제 가전(ThinQ)과 짝지어졌는가. */
  deviceSteps?: { deviceId: string; paired: boolean }[];
}

const fail = (reason: CheckFail): CheckResult => ({ ok: false, reason, text: CHECK_TEXT[reason] });

/** 계획 전 검사: 에이전트를 부를 만한 판단인가(LLM을 부르지 않고 본다). */
export function checkDecision(i: Pick<CheckInput, "decision" | "tasks" | "world">): CheckResult {
  const spec = taskOf(i.decision.action);
  if (!spec || !i.tasks.includes(spec.name)) return fail("unknown_task");
  // 지금 보이는 대상만(시야 밖의 낡은 물건으로 모델을 부르지 않는다)
  if (spec.target && !i.world.objects.some((o) => o.cls === spec.target && o.status === "present" && !putAway(o))) {
    return fail(i.world.objects.some((x) => x.cls === spec.target && x.status !== "gone" && putAway(x)) ? "in_sink" : "no_target");
  }
  return { ok: true };
}

export function checkPlan(i: CheckInput): CheckResult {
  const spec = taskOf(i.decision.action);
  if (!spec || !i.tasks.includes(spec.name) || !i.plan) return fail("unknown_task");
  if (spec.target) {
    const id = planTargetId(i.plan);
    const o = i.world.objects.find((x) => x.id === id);
    if (!o || o.status === "gone" || o.cls !== spec.target) {
      return fail(i.world.objects.some((x) => x.cls === spec.target && x.status !== "gone" && putAway(x)) ? "in_sink" : "no_target");
    }
    if (putAway(o)) return fail("in_sink");
    if (o.last_seen_ms <= i.decision.atMs || i.nowMs - o.last_seen_ms > i.staleMs) return fail("stale");
    if (o.facts.place?.value === "in_hand" || o.facts.use?.value === "in_use" || holdsTarget(i.world, spec.target)) return fail("in_hand");
  }
  // 손 자리를 모르면(맞추기 전) 길 없이 「완료」로 넘긴다. 자리를 아는데 길이 없을 때만 막는다
  if (i.plan.robot.position && i.plan.steps.some((s) => s.kind === "move") && i.plan.path.length === 0) return fail("unreachable");
  if (i.mode === "test" && (i.deviceSteps ?? []).some((d) => d.paired)) return fail("device_mode");
  return { ok: true };
}

/** 실행 설정. 틀린 값이면 시작을 막는다. */
export function loadActConfig(env: Record<string, string | undefined>): { staleMs: number } {
  const raw = env.STALE_MS?.trim();
  if (!raw) return { staleMs: 3000 };
  const v = Number(raw);
  if (!Number.isFinite(v) || v <= 0) throw new Error(`STALE_MS=${raw}: 0보다 큰 숫자여야 합니다`);
  return { staleMs: v };
}
