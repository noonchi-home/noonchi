import type { EvidenceRef } from "../../contract/assistance.js";
import { assistanceContext, type AssistanceAttempt, type AssistanceExecution, type AssistanceReactionProof } from "../../contract/assistance-outcome.js";
import type { DecisionRecord } from "../../contract/events.js";
import type { AgentStep } from "../../contract/plan-work.js";
import { EXEC_TEXT } from "../labels.js";
import { taskOf } from "../tasks.js";
import { assess, type AssessmentWorld, type Attempt } from "./attempt.js";
import { Part, type Run } from "./core.js";
import { allowedEvidence, EvidenceRun } from "./evidence.js";

const NEED_STATE = "지금 상태를 확인할 수 없어 멈췄어요.";
const ALREADY_DONE = "이미 필요한 일이 끝났어요.";
const LOCATION_CHANGED = "지금 자리에 맞춰 다시 계획해요.";
const POLICY_DEFER = "이번에는 먼저 돕지 않아요.";

export class AdaptiveExecution extends Part {
  private readonly identity = new WeakMap<Attempt, Omit<AssistanceAttempt, "key">>();
  private readonly evidence = new WeakMap<Attempt, EvidenceRun>();
  private readonly proofs = new WeakMap<Attempt, AssistanceReactionProof[]>();
  private readonly handoffs = new Map<Run, { at: number; target: string; objectId: string }>();

  direct(d: DecisionRecord): boolean { return d.source === "speech"; }

  policy(d: DecisionRecord) {
    return this.direct(d) ? "default" : this.o.assistance?.interventionFor?.(d, this.o.state.view()) ?? "default";
  }

  bind(a: Attempt, d: DecisionRecord): string | null {
    const ad = this.o.assistance;
    const old = this.identity.get(a);
    if (old) return old.user;
    if (!ad || !d.action) return null;
    const world = this.o.state.view();
    const user = (ad.bindResident ?? ad.resident)?.(world) ?? null;
    this.identity.set(a, { home: ad.home ?? ad.homeEpoch, user, action: d.action,
      context: assistanceContext(d, world), request: this.direct(d) ? "direct" : "proactive", startedMs: this.clock.now() });
    this.o.trace?.link({ attempt: a.key }, { decision_id: d.id });
    return user;
  }

  finish(a: Attempt, execution: AssistanceExecution): void {
    if (a.ended) return;
    a.ended = true;
    this.cancel(a);
    const i = this.identity.get(a);
    if (i) this.o.assistance?.ended?.({ ...i, key: a.key }, execution, this.clock.now(), this.proofs.get(a) ?? []);
  }

  cancel(a: Attempt): void { this.evidence.get(a)?.cancel(); }

  finishRun(r: Run, execution: AssistanceExecution): void {
    const a = r.attempt;
    const g = a.goal;
    const step = this.core.stepOf(r);
    const w = this.o.state.view();
    const p = w.household_photo;
    const identity = this.identity.get(a);
    const object = g?.kind === "deliver" ? w.objects.find(o => o.id === g.objectId) : undefined;
    if (execution === "done" && step?.kind === "place" && step.target && g?.kind === "deliver" &&
        identity?.user && object?.status === "present" && object.surface === step.target &&
        p?.at_ms === object.last_seen_ms && p.at_ms >= r.stepAt && !w.person.holding.includes(object.id) &&
        !this.proofs.get(a)?.length) {
      this.handoffs.set(r, { at: p.at_ms, target: step.target, objectId: object.id });
      return;
    }
    this.finish(a, execution);
  }

  handoffTick(closing = false): void {
    if (!this.handoffs.size) return;
    const w = this.o.state.view();
    const p = w.household_photo;
    const now = this.clock.now();
    for (const [r, candidate] of this.handoffs) {
      const room = this.o.layout.floor().objects.get(candidate.target)?.room;
      const exact = w.objects.find(o => o.id === candidate.objectId);
      const proved = !!(room && p?.proof?.person_count === 1 && p.proof.person?.room === room && w.person.count === 1 &&
        p.at_ms > candidate.at && p.at_ms <= now && now - p.at_ms <= 10_000 &&
        exact?.status === "present" && exact.last_seen_ms === p.at_ms && w.person.holding.includes(exact.id));
      if (proved && p && exact) {
        this.response(r, "confirmed_handoff", { source: "handoff", subjectId: exact.id, observedMs: p.at_ms, originId: p.id });
      }
      if (closing || proved || now - candidate.at >= 10_000) {
        this.handoffs.delete(r);
        this.finish(r.attempt, "done");
      }
    }
  }

  response(r: Run, kind: AssistanceReactionProof["kind"], evidence: EvidenceRef): void {
    const { attempt } = r;
    const i = this.identity.get(attempt);
    const world = this.o.state.view();
    if (attempt.ended || !i?.user || this.o.assistance?.resident?.(world) !== i.user) return;
    const proof = { key: attempt.key, home: i.home, user: i.user, kind, evidence };
    this.proofs.set(attempt, [...(this.proofs.get(attempt) ?? []), proof]);
  }

  preflight(a: Attempt, d: DecisionRecord): "ready" | "fulfilled" | "deferred" {
    if (!this.o.assistance) return "ready";
    const world = this.o.state.view();
    if (this.policy(d) === "defer_proactive") return "deferred";
    this.bind(a, d);
    if (taskOf(d.action)?.completion !== "device") return "ready";
    const id = this.o.assistance.targetDevice?.(d, world);
    if (!id) return "ready";
    a.goal = { kind: "device", deviceId: id, attr: "power", value: true };
    return assess(a, this.snapshot(a)).kind === "fulfilled" ? "fulfilled" : "ready";
  }

  private snapshot(a: Attempt): AssessmentWorld {
    const w = this.o.state.view();
    const p = w.household_photo;
    const i = this.identity.get(a);
    const single = !!(p?.proof?.person && p.proof.person_count === 1 && w.person.count === 1 &&
      i?.user && this.o.assistance?.resident?.(w) === i.user);
    const g = a.goal;
    const seen = g?.kind === "deliver" && g.objectId && single ? w.objects.find(o => o.id === g.objectId) : undefined;
    const held = seen?.status === "present" && p?.at_ms === seen.last_seen_ms && w.person.holding.includes(seen.id) &&
      seen.facts.contents?.certainty === "confirmed" && seen.facts.contents.value === "has_contents";
    const current = this.core.run?.attempt === a ? this.core.run : null;
    const noContact = !current || current.at < 0 || (current.plan.steps.slice(0, current.at + 1)
      .every(s => s.kind === "go" || s.kind === "say" || s.kind === "wait"));
    return {
      now: this.clock.now(), photo: p, objects: w.objects, holding: w.person.holding,
      ...(g?.kind === "device" ? { device: this.o.assistance?.readDevice?.(g.deviceId) ?? undefined } : {}),
      ...(single && i?.user && p?.proof?.person ? {
        destination: { recipientId: i.user, room: p.proof.person.room,
          ref: { source: "photo", subjectId: i.user, observedMs: p.at_ms, originId: p.id } },
        ...(held && seen && noContact ? { receipt: { recipientId: i.user, objectId: seen.id, self: true,
          ref: { source: "photo", subjectId: seen.id, observedMs: p.at_ms, originId: p.id } } } : {}),
      } : {}),
    };
  }

  /** Returns true while an adaptive gate owns progression of the active step. */
  gate(r: Run, i: number, beforeCommand = false): boolean {
    if (!this.o.assistance || r.attempt.ended || taskOf(r.decision.action)?.coach) return false;
    const a = r.attempt;
    const step = r.plan.steps[i];
    if (this.core.start.context().emergency) {
      this.o.trace?.event("guard", { plan_id: r.plan.view.id, attempt: a.key }, "guard_safety");
      this.core.steps.finish(r, "failed", EXEC_TEXT.goalSafety, "cancelled");
      return true;
    }
    if (r.safePlace) return false;
    const policy = this.policy(r.decision);
    if (r.at < 0 && policy === "defer_proactive") {
      this.core.steps.finish(r, "failed", POLICY_DEFER, "cancelled");
      return true;
    }
    if (r.asking) return false; // An approval owns the phone and its own deadline.
    const w = this.snapshot(a);
    if (a.goal?.kind === "device" && r.device !== "idle" && w.device && w.device.ref.observedMs < r.stepAt) w.device = undefined;
    const result = assess(a, w);
    if (result.kind === "fulfilled") {
      if (result.self && result.evidence[0]) this.response(r, "self_resolved", { ...result.evidence[0], source: "resident_action" });
      this.core.steps.finish(r, "done", ALREADY_DONE);
      return true;
    }
    if (result.kind === "changed" && a.goal?.kind === "deliver" && w.destination?.room) {
      if (r.carried.size) {
        this.core.steps.safePlace(r);
        return true;
      }
      if (!r.carried.size && !this.core.touching(r) && this.core.start.replan(r, w.destination.room, i)) return true;
      // Once manipulation was commissioned the existing stage/finish path owns safety.
      if (!r.carried.size && !this.core.touching(r)) {
        this.core.steps.finish(r, "failed", NEED_STATE, "cancelled");
        return true;
      }
    }
    if (beforeCommand && step?.kind === "pick" && a.goal?.kind === "clear") {
      const object = w.objects.find(o => a.goal?.kind === "clear" && o.id === a.goal.objectId);
      if (result.kind === "changed" || object?.facts.place?.value === "in_hand" || (object && w.holding.includes(object.id))) {
        return this.wait(r, i, w);
      }
    }
    const requires = a.goal && (a.goal.kind === "device" || policy === "verify_first" && r.state === "planned" ||
      a.goal.kind === "clear" && step?.kind === "pick" && beforeCommand && !!w.photo);
    if (requires && result.kind === "need_evidence" && r.device !== "running") {
      if (r.device === "sent" || beforeCommand || r.state === "planned") return this.wait(r, i, w);
    }
    if (policy === "verify_first" && r.state === "planned" && !a.goal) {
      this.core.steps.finish(r, "failed", NEED_STATE, "cancelled");
      return true;
    }
    if (beforeCommand) this.cancel(a);
    return false;
  }

  private wait(r: Run, i: number, w: AssessmentWorld): boolean {
    if (this.o.phone.approvalsWaiting?.() || this.o.phone.talking?.()) return true;
    const a = r.attempt;
    const g = a.goal!;
    const ports = this.o.assistance?.evidence;
    const id = g.kind === "device" ? null : g.objectId;
    const allowed = allowedEvidence(g, !!(id && this.o.assistance?.cropVisible?.(id)));
    let run = this.evidence.get(a);
    if (ports && !run) { run = new EvidenceRun(a, ports); this.evidence.set(a, run); }
    const missing = g.kind === "device" ? "device_power" : g.kind === "clear" ? "object_location" : "recipient_location";
    if (run?.request(i, w.now, w.photo?.id ?? w.device?.ref.originId ?? "", g, allowed, missing) === "pending") return true;
    this.core.steps.finish(r, "failed", NEED_STATE, "cancelled");
    return true;
  }

  /** A changed room cannot authorize another physical operation already sent in the old plan. */
  canReplan(r: Run, next: number): boolean {
    const irreversible = (step: AgentStep) => ["pick", "place", "do", "device"].includes(step.kind);
    return (r.attempt.replans ?? 0) < 1 && !r.plan.steps.slice(0, next).some(irreversible);
  }

  changedRoomText(): string { return LOCATION_CHANGED; }
}
