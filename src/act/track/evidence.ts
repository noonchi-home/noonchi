import type { AssistanceGoal, EvidenceChoice, EvidenceQuestion, EvidenceRef } from "../../contract/assistance.js";
import { acceptEvidence, sameAttempt, type Attempt } from "./attempt.js";

export interface EvidencePorts {
  choose(question: EvidenceQuestion, signal: AbortSignal): Promise<EvidenceChoice | null>;
  acquire(choice: EvidenceChoice, signal: AbortSignal): Promise<EvidenceRef | null>;
}

export function allowedEvidence(goal: AssistanceGoal, crop: boolean): EvidenceChoice[] {
  const choices: EvidenceChoice[] = [{ tool: "wait_for_new_photo" }, { tool: "stop" }];
  if (goal.kind === "device") choices.push({ tool: "read_device", target: goal.deviceId });
  const id = goal.kind !== "device" && goal.objectId;
  if (id) {
    choices.push({ tool: "last_seen", target: id });
    if (crop) choices.push({ tool: "look_closer", target: id });
  }
  return choices;
}

export function sameChoice(a: EvidenceChoice, b: EvidenceChoice): boolean {
  return a.tool === b.tool && ("target" in a ? a.target : null) === ("target" in b ? b.target : null);
}

/** Tick is driven by the act clock. Rev changes do not renew a segment or its proof. */
export class EvidenceRun {
  private stage = -Infinity;
  private since = 0;
  private calls = 0;
  private total = 0;
  private waitFor: string | null = null;
  private stopped = false;
  private clockMs = 0;
  private readonly used = new Map<string, EvidenceChoice[]>();
  private job: { abort: AbortController; done: Promise<void> } | null = null;

  constructor(private readonly attempt: Attempt, private readonly ports: EvidencePorts) {}

  request(stage: number, now: number, origin: string, goal: AssistanceGoal, allowed: readonly EvidenceChoice[]) {
    this.clockMs = now;
    if (this.stage !== stage) {
      this.cancel();
      this.stage = stage;
      this.since = now;
      this.calls = 0;
      this.waitFor = null;
    }
    if (this.stopped || this.attempt.ended || now - this.since >= 30_000) {
      this.cancel();
      return "exhausted";
    }
    if (this.job) return "pending";
    if (this.calls >= 3 || this.total >= 6) return "exhausted";
    if (this.waitFor === origin) return "pending";
    this.calls++;
    this.total++;
    const abort = new AbortController();
    const key = this.attempt.key;
    const signal = abort.signal;
    const live = () => !signal.aborted && !this.attempt.ended && sameAttempt(this.attempt.key, key);
    const done = Promise.resolve().then(async () => {
      if (!live()) return;
      const choice = await this.ports.choose({ goal, missing: "confirmed_state", allowed, observations: [...this.attempt.evidence] }, signal);
      if (!live() || !choice || !allowed.some(a => sameChoice(a, choice))) return;
      if (choice.tool === "stop") { this.stopped = true; return; }
      if (choice.tool === "wait_for_new_photo") { this.waitFor = origin; return; }
      const previous = this.used.get(origin) ?? [];
      if (previous.some(a => sameChoice(a, choice))) return;
      this.used.set(origin, [...previous, choice]);
      const ref = await this.ports.acquire(choice, signal);
      if (ref && live() && "target" in choice) acceptEvidence(this.attempt, key, ref, [choice.target], this.clockMs);
    }).catch(() => {}).finally(() => {
      if (this.job?.abort === abort) this.job = null;
    });
    this.job = { abort, done };
    return "pending";
  }

  cancel(): void {
    this.job?.abort.abort();
    this.job = null;
  }

  async idle(): Promise<void> { await this.job?.done; }
}
