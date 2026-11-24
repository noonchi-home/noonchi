import type { PlanStep, PlanView } from "../../../src/contract/plan.ts";
import type { TraceRefs, TraceRow } from "../../../src/contract/trace.ts";

export interface ActionConditions {
  confirmed: string | null;
  current: string | null;
  next: string | null;
}

const IDLE: ActionConditions = { confirmed: null, current: null, next: null };

function sameAttempt(a: TraceRefs["attempt"], b: TraceRefs["attempt"]): boolean {
  return !a || !b ? a === b : a.boot === b.boot && a.homeEpoch === b.homeEpoch &&
    a.attemptId === b.attemptId && a.gen === b.gen;
}

function latest(rows: readonly TraceRow[], matches: (row: TraceRow) => boolean): TraceRow | undefined {
  // A late reply for a previous look is still from the previous look.
  const began = (row: TraceRow) => row.started_ms ?? row.refs.evidence?.observedMs ?? row.ended_ms ?? -Infinity;
  return rows.reduce<TraceRow | undefined>((selected, row) =>
    matches(row) && (!selected || began(row) >= began(selected)) ? row : selected, undefined);
}

export function actionConditions(plan: PlanView | null, step: PlanStep | null, rows: readonly TraceRow[], connected: boolean | null): ActionConditions {
  if (connected !== true || plan?.status !== "running" || !step) return IDLE;
  const index = plan.steps.findIndex(candidate => candidate.id === step.id && candidate.status === "active");
  if (index < 0) return IDLE;
  const currentStep = plan.steps[index]!;
  const planRows = rows.filter(row => row.refs.plan_id === plan.id);
  const phase = latest(planRows, row => row.refs.step_id === currentStep.id &&
    (row.kind === "EXECUTION" || (row.kind === "TOOL" && row.name === "가전 도구")));
  const activity = phase ? planRows.filter(row => row.activity_id === phase.activity_id) : [];
  if (phase && (phase.state === "failed" || phase.state === "cancelled" || activity.some(row =>
    row.kind === "EXECUTION" && row.name === "활동 종료" && row.state !== "pending" &&
    (!row.refs.attempt || sameAttempt(row.refs.attempt, phase.refs.attempt))))) return IDLE;

  const target = phase?.refs.object_id;
  const observation = target && phase ? latest(activity, row => row.kind === "TOOL" &&
    (row.name === "컵 안 확인" || row.name === "근접 관찰") && row.refs.object_id === target &&
    sameAttempt(row.refs.attempt, phase.refs.attempt)) : undefined;
  const proof = observation?.refs.evidence;
  const photo = observation?.state === "done" && proof?.source === "photo" && proof.subjectId === target;
  const confirmed = photo && observation?.output === "빈 컵 확인" ? "컵 안이 비었어요" :
    photo && observation?.output === "컵 내용물 확인" ? "컵에 내용물이 있어요" :
    phase?.kind === "TOOL" && phase.state === "done" && phase.output === "가전 응답 확인" && target && target === currentStep.target?.deviceId
      ? phase.output : null;

  const current = phase?.state === "done" ? null :
    phase?.kind === "EXECUTION" && phase.name === "집기 안내" && currentStep.label === "컵 집기"
      ? "컵을 든 모습" : phase?.name === "수행 안내" && observation?.state === "pending" ? observation.name : currentStep.label;
  const next = plan.steps.slice(index + 1).find(candidate => candidate.status === "pending")?.label ?? null;
  return { confirmed, current, next };
}
