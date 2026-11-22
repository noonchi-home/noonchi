import type { AssistanceGoal, AttemptKey, EvidenceRef } from "../../contract/assistance.js";
import type { DecisionRecord } from "../../contract/events.js";
import type { WorldObject } from "../../contract/world.js";
import type { AgentPlan } from "../../agent/index.js";
import { taskOf } from "../tasks.js";

export interface Attempt {
  key: Readonly<AttemptKey>;
  since: number;
  goal: AssistanceGoal | null;
  ended: boolean;
  evidence: EvidenceRef[];
}

export class AttemptBook {
  private readonly decisions = new Map<string, Attempt>();
  constructor(private readonly boot: string, private readonly homeEpoch: string) {}

  issue(decision: Pick<DecisionRecord, "id" | "atMs" | "action">): Attempt {
    const current = this.decisions.get(decision.id);
    if (current) return current;
    const attempt: Attempt = {
      key: { boot: this.boot, homeEpoch: this.homeEpoch, attemptId: decision.id, gen: 0 },
      since: decision.atMs, goal: null, ended: false, evidence: [],
    };
    this.decisions.set(decision.id, attempt);
    // The decision sequence also rejects past deliveries; keep only the recent identities.
    if (this.decisions.size > 256) this.decisions.delete(this.decisions.keys().next().value!);
    return attempt;
  }

  advance(a: Attempt): void {
    a.key = { ...a.key, gen: a.key.gen + 1 };
  }
}

export function sameAttempt(a: AttemptKey, b: AttemptKey): boolean {
  return a.boot === b.boot && a.homeEpoch === b.homeEpoch && a.attemptId === b.attemptId && a.gen === b.gen;
}

export function goalOf(plan: AgentPlan, world: { objects: readonly Pick<WorldObject, "id" | "surface">[]; room: string | null },
                       recipientId: string | null): AssistanceGoal | null {
  const completion = taskOf(plan.task)?.completion;
  if (completion === "device") {
    const devices = plan.steps.flatMap(s => s.device ? [s.device] : []);
    const device = devices.length === 1 ? devices[0] : undefined;
    if (!device || !["turn_on", "turn_off"].includes(device.tool)) return null;
    return { kind: "device", deviceId: device.deviceId, attr: "power", value: device.tool === "turn_on" };
  }
  const place = [...plan.steps].reverse().find(s => s.kind === "place" && s.target);
  if (completion === "deliver") return { kind: "deliver", objectId: place?.object ?? null, recipientId, room: world.room };
  if (completion !== "clear" || !place?.object || !place.target) return null;
  const from = world.objects.find(o => o.id === place.object)?.surface;
  return from ? { kind: "clear", objectId: place.object, from, to: place.target, basin: true } : null;
}

export function acceptEvidence(a: Attempt, key: AttemptKey, ref: EvidenceRef, subjects: readonly string[], now: number): boolean {
  if (a.ended || !sameAttempt(a.key, key) || !subjects.includes(ref.subjectId) ||
      !Number.isFinite(ref.observedMs) || ref.observedMs < a.since || ref.observedMs > now ||
      a.evidence.some(e => e.source === ref.source && e.originId === ref.originId && e.subjectId === ref.subjectId)) return false;
  a.evidence.push(ref);
  return true;
}

type SeenObject = Pick<WorldObject, "id" | "surface" | "surface_part" | "status" | "last_seen_ms" | "facts" | "closer_hold">;

export interface AssessmentWorld {
  now: number;
  photo?: { id: string; at_ms: number };
  objects: readonly SeenObject[];
  holding: readonly string[];
  destination?: { recipientId: string; room: string | null; ref: EvidenceRef };
  receipt?: { recipientId: string; objectId: string; self: boolean; ref: EvidenceRef };
  device?: { attr: string; value: unknown; ref: EvidenceRef };
}

export interface Assessment {
  kind: "ready" | "need_evidence" | "fulfilled" | "changed" | "invalid";
  evidence: EvidenceRef[];
  self?: boolean;
}

export function assess(a: Attempt, w: AssessmentWorld): Assessment {
  const g = a.goal;
  const result = (kind: Assessment["kind"], ref?: EvidenceRef): Assessment => ({ kind, evidence: ref ? [ref] : [] });
  const fresh = (ref: EvidenceRef) => ref.observedMs >= a.since && ref.observedMs <= w.now && w.now - ref.observedMs <= 10_000;
  if (a.ended) return result("invalid");
  if (!g) return result("ready");
  if (g.kind === "device") {
    const d = w.device;
    if (!d || d.ref.subjectId !== g.deviceId || d.attr !== g.attr || !fresh(d.ref)) return result("need_evidence");
    return result(Object.is(d.value, g.value) ? "fulfilled" : "ready", d.ref);
  }
  if (g.kind === "deliver") {
    const receipt = w.receipt;
    if (g.objectId && g.recipientId && receipt?.objectId === g.objectId && receipt.recipientId === g.recipientId &&
        receipt.ref.subjectId === g.objectId && fresh(receipt.ref)) {
      return { ...result("fulfilled", receipt.ref), self: receipt.self };
    }
    const place = w.destination;
    if (g.recipientId && place?.recipientId === g.recipientId && place.ref.subjectId === g.recipientId && place.room &&
        g.room && place.room !== g.room && fresh(place.ref)) return result("changed", place.ref);
    return result("ready");
  }
  const object = w.objects.find(o => o.id === g.objectId);
  if (!object || object.status !== "present" || object.closer_hold || !w.photo || object.last_seen_ms !== w.photo.at_ms) {
    return result("need_evidence");
  }
  const ref = { source: "photo", originId: w.photo.id, subjectId: object.id, observedMs: object.last_seen_ms };
  if (!fresh(ref)) return result("need_evidence");
  if (w.holding.includes(object.id) || object.facts.in_hand?.value === "yes") return result("invalid", ref);
  if (object.surface === g.to && (!g.basin || object.surface_part === "basin")) return result("fulfilled", ref);
  return result(object.surface === g.from ? "ready" : "changed", ref);
}
