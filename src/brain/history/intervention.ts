import type { AssistanceOutcome, AssistanceReaction } from "../../contract/assistance-outcome.js";
import type { HistoryRow } from "../../contract/history.js";
import type { HistoryDb } from "./db.js";

export type Intervention = "default" | "verify_first" | "defer_proactive";
export interface HabitContext { action: string; context: string | null }
export interface PolicyScope { home: string; user: string; action: string; context: string }
export interface InterventionChange extends PolicyScope { policy: Intervention }
export interface InterventionPreference extends PolicyScope { atMs: number; originId: string }
export interface CurrentIntervention { policy: Intervention; appliesDay: string }

export function policyFor(db: HistoryDb, home: string, user: string | null, habit: HabitContext, day: string): Intervention {
  return db.policyFor(home, user, habit, day);
}

export function interventionChanges(rows: readonly HistoryRow[], preferences: readonly InterventionPreference[],
  prior: (scope: PolicyScope) => CurrentIntervention | null, dayOf: (ms: number) => string): InterventionChange[] {
  const keyOf = (s: PolicyScope) => JSON.stringify([s.home, s.user, s.action, s.context]);
  const groups = new Map<string, { scope: PolicyScope; days: Map<string, AssistanceReaction> }>();
  const resets = new Map<string, InterventionPreference>();
  for (const preference of preferences) {
    const key = keyOf(preference);
    resets.set(key, preference);
    groups.set(key, { scope: preference, days: new Map() });
  }
  for (const row of rows) {
    const o = row.data as AssistanceOutcome;
    if (o.request !== "proactive" || o.reaction === "unknown" || !o.user || !o.context || !o.proof) continue;
    const scope = { home: o.home, user: o.user, action: o.action, context: o.context };
    const key = keyOf(scope);
    if (o.proof.evidence.observedMs <= (resets.get(key)?.atMs ?? -Infinity)) continue;
    const group = groups.get(key) ?? { scope, days: new Map<string, AssistanceReaction>() };
    group.days.set(row.day, o.reaction);
    groups.set(key, group);
  }

  const changes: InterventionChange[] = [];
  for (const [key, { scope, days }] of groups) {
    const before = prior(scope);
    const reset = resets.get(key);
    const clear = before?.policy === "defer_proactive" && reset && dayOf(reset.atMs) >= before.appliesDay;
    if (before?.policy === "defer_proactive" && !clear) continue;
    const [first, second] = [...days.values()].slice(-2);
    const policy = first && first === second
      ? first === "declined" ? "defer_proactive" : first === "self_resolved" ? "verify_first" : "default"
      : clear ? "default" : undefined;
    if (policy && policy !== (before?.policy ?? "default")) changes.push({
      home: scope.home, user: scope.user, action: scope.action, context: scope.context, policy,
    });
  }
  return changes;
}
