import { assistanceOutcome, planIdOf, type BoundAssistanceAnswer } from "../../act/index.js";
import { assistanceContext, type AssistanceAttempt, type AssistanceExecution, type AssistanceOutcome, type AssistanceReactionProof } from "../../contract/assistance-outcome.js";
import type { DecisionRecord } from "../../contract/events.js";
import type { PlanView } from "../../contract/plan.js";
import type { WorldView } from "../../contract/world.js";

export function assistanceResident(world: WorldView, resident: string | null, now: number, freshnessMs: number): string | null {
  const photo = world.household_photo;
  return photo && now >= photo.at_ms && now - photo.at_ms <= freshnessMs && photo.proof?.person_count === 1
    && world.person.count === 1 && world.person.visible ? resident : null;
}

export class HomeAssistance {
  private readonly candidates = new Map<string, { attempt: AssistanceAttempt; proof?: AssistanceReactionProof }>();

  constructor(private readonly o: {
    home: string;
    epoch: { boot: string; home: string };
    world: () => WorldView;
    resident: (world: WorldView) => string | null;
    now: () => number;
    publish: (outcome: AssistanceOutcome) => void;
  }) {}

  admit(decision: DecisionRecord): void {
    if (decision.status !== "valid" || decision.late || !decision.action) return;
    const id = planIdOf(decision.id);
    if (this.candidates.has(id)) return;
    const world = this.o.world();
    this.candidates.set(id, { attempt: {
      key: { boot: this.o.epoch.boot, homeEpoch: this.o.epoch.home, attemptId: decision.id, gen: 0 },
      home: this.o.home, user: this.o.resident(world), action: decision.action,
      context: assistanceContext(decision, world), request: decision.source === "speech" ? "direct" : "proactive",
      startedMs: decision.atMs,
    } });
    if (this.candidates.size > 256) this.candidates.delete(this.candidates.keys().next().value!);
  }

  answer(answer: BoundAssistanceAnswer): void {
    const candidate = this.candidates.get(answer.planId);
    const user = this.o.resident(this.o.world());
    if (!candidate || !user || candidate.attempt.user !== user) return;
    const key = candidate.attempt.key;
    if (answer.key.boot !== key.boot || answer.key.homeEpoch !== key.homeEpoch
      || answer.key.attemptId !== key.attemptId || answer.key.gen !== key.gen) return;
    candidate.proof = { key, home: this.o.home, user, kind: answer.kind, evidence: {
      source: "phone_answer", subjectId: user, observedMs: answer.atMs, originId: JSON.stringify([answer.planId, answer.stepId]),
    } };
  }

  ended(attempt: AssistanceAttempt, execution: AssistanceExecution, endedMs: number, proofs: readonly AssistanceReactionProof[]): void {
    const id = planIdOf(attempt.key.attemptId);
    const candidate = this.candidates.get(id);
    this.candidates.delete(id);
    const context = candidate ? candidate.attempt.context : attempt.context;
    this.o.publish(assistanceOutcome({ ...attempt, context }, execution, endedMs, candidate?.proof ? [...proofs, candidate.proof] : proofs));
  }

  onPlan(plan: PlanView): void {
    if (plan.source !== "brain" || plan.dryRun || plan.status === "planned" || plan.status === "running") return;
    const execution = plan.status;
    const endedMs = this.o.now();
    queueMicrotask(() => {
      const candidate = this.candidates.get(plan.id);
      if (candidate) this.ended(candidate.attempt, execution, endedMs, []);
    });
  }
}
