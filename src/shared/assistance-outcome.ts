import type { AssistanceAttempt, AssistanceExecution, AssistanceOutcome, AssistanceReactionProof } from "../contract/assistance-outcome.js";
import type { WorldView } from "../contract/world.js";

export function assistanceContext(decision: { fsm?: { from: string | null } | null }, world: WorldView): string | null {
  const state = decision.fsm?.from;
  if (state) return JSON.stringify(["state", state]);
  const activity = world.person.facts.activity;
  return activity?.certainty === "confirmed" && world.person.room
    ? JSON.stringify(["activity", activity.value, world.person.room]) : null;
}

const PROOF_SOURCE = {
  explicit_accept: "phone_answer", explicit_decline: "phone_answer",
  confirmed_handoff: "handoff", self_resolved: "resident_action",
} as const;

export function assistanceOutcome(attempt: AssistanceAttempt, execution: AssistanceExecution, endedMs: number,
                                  proofs: readonly AssistanceReactionProof[] = []): AssistanceOutcome {
  const { key, home, user, action, context, request, startedMs } = attempt;
  const valid = proofs.filter(p => p.home === home && p.user === user
    && p.key.boot === key.boot && p.key.homeEpoch === key.homeEpoch && p.key.attemptId === key.attemptId && p.key.gen === key.gen
    && p.evidence.source === PROOF_SOURCE[p.kind] && !!p.evidence.originId && !!p.evidence.subjectId
    && p.evidence.observedMs >= startedMs && p.evidence.observedMs <= endedMs
    && (p.evidence.source !== "phone_answer" || p.evidence.subjectId === p.user));
  const latest = (list: AssistanceReactionProof[]) => list.sort((a, b) => b.evidence.observedMs - a.evidence.observedMs)[0];
  const proof = latest(valid.filter(p => p.kind.startsWith("explicit_"))) ?? latest(valid) ?? null;
  const reaction = !proof ? "unknown" : proof.kind === "explicit_decline" ? "declined"
    : proof.kind === "self_resolved" ? "self_resolved" : "accepted";
  return { key, home, user, action, context, request, startedMs, endedMs, execution, reaction, proof };
}
