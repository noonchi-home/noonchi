// 검사(결정론) 둘. 통과하지 못하면 실행하지 않고 이유(CHECK_TEXT)를 낸다.
// 계획 전 검사(checkDecision, 에이전트를 부르기 전): 행동 목록에 있는 행동이다, 대상 종류가 있는 행동이면 치우지 않은 대상이 보인다(남은 같은 종류가 모두 싱크대 안이면 그 이유).
// 실행 전 검사(checkPlan, 에이전트가 만든 계획): 아는 행동이고 계획이 있다, 대상 물건이 있고 이미 싱크대 안이 아니다, 판단 뒤에 찍힌 프레임으로 다시 봤고 STALE_MS 안이다,
// 사람이 그 물건을 들고 있거나 쓰는 중이 아니다, 이동 단계가 있으면 경로가 있다, 시험 모드에서는 짝지은 실제 가전 단계를 막는다.
// 대상 물건은 계획 단계 대상 가운데 그 행동의 대상 종류인 첫 물건이다(채워 주기는 첫 act 단계가 병 집기이고 컵은 따르기 단계의 대상이다).
// 집는 것이 대상과 다른 행동(carry, 채워 주기)은 사람이 그 자리에서 다른 것을 들고 있는 일이라, 든 것을 모르는 것만으로는 막지 않는다(그 컵을 들었다고 보일 때만).
// 「치운 것」(src/act/tasks.ts putAway)은 싱크대 안 사실이거나 실행 추적이 놓기 단계를 끝낸 물건(placed)이다.
import type { PlanView } from "../contract/plan.js";
import type { ControlMode } from "../contract/setup.js";
import type { WorldView } from "../contract/world.js";
import { CHECK_TEXT } from "../plan/labels.js";
import type { DecisionRecord } from "../contract/events.js";
import { holdsTarget, planObjectOf, putAway, taskOf, type Placed } from "./tasks.js";

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
  /** 실행 추적이 놓기 단계를 끝낸 물건(이미 치운 것, src/act/track.ts placed). */
  placed?: Placed;
}

const fail = (reason: CheckFail): CheckResult => ({ ok: false, reason, text: CHECK_TEXT[reason] });

/** 계획 전 검사: 에이전트를 부를 만한 판단인가(LLM을 부르지 않고 본다). */
/** 계획 전 검사의 대상은 이만큼(ms) 안에 본 것이어야 한다(감지가 끊겨 남은 「보임」으로 모델을 부르지 않는다). */
export const PRECHECK_FRESH_MS = 10_000;

export function checkDecision(i: Pick<CheckInput, "decision" | "tasks" | "world" | "placed"> & { nowMs?: number }): CheckResult {
  const spec = taskOf(i.decision.action);
  if (!spec || !i.tasks.includes(spec.name)) return fail("unknown_task");
  // 지금 보이는 대상만(시야 밖의 낡은 물건으로 모델을 부르지 않는다)
  const fresh = (o: { last_seen_ms: number }) => i.nowMs === undefined || i.nowMs - o.last_seen_ms <= PRECHECK_FRESH_MS;
  if (spec.target && !i.world.objects.some((o) => o.cls === spec.target && o.status === "present" && fresh(o) && !putAway(o, i.placed))) {
    return fail(i.world.objects.some((x) => x.cls === spec.target && x.status !== "gone" && putAway(x, i.placed)) ? "in_sink" : "no_target");
  }
  return { ok: true };
}

export function checkPlan(i: CheckInput): CheckResult {
  const spec = taskOf(i.decision.action);
  if (!spec || !i.tasks.includes(spec.name) || !i.plan) return fail("unknown_task");
  if (spec.target) {
    const id = planObjectOf(i.plan, i.world, spec.target);
    const o = i.world.objects.find((x) => x.id === id);
    if (!o || o.status === "gone" || o.cls !== spec.target) {
      return fail(i.world.objects.some((x) => x.cls === spec.target && x.status !== "gone" && putAway(x, i.placed)) ? "in_sink" : "no_target");
    }
    if (putAway(o, i.placed)) return fail("in_sink");
    if (o.last_seen_ms <= i.decision.atMs || i.nowMs - o.last_seen_ms > i.staleMs) return fail("stale");
    if (o.facts.place?.value === "in_hand" || o.facts.use?.value === "in_use" || holdsTarget(i.world, spec.target, spec.carry !== undefined)) return fail("in_hand");
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
