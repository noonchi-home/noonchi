import type { AttemptKey, EvidenceRef } from "./assistance.js";

export interface AssistanceAttempt {
  key: AttemptKey;
  home: string;
  user: string | null;
  action: string;
  context: string | null;
  request: "direct" | "proactive";
  startedMs: number;
}

export type AssistanceProofKind = "explicit_accept" | "explicit_decline" | "confirmed_handoff" | "self_resolved";
export interface AssistanceReactionProof {
  key: AttemptKey;
  home: string;
  user: string;
  kind: AssistanceProofKind;
  evidence: EvidenceRef;
}

export type AssistanceExecution = "done" | "cancelled" | "failed";
export type AssistanceReaction = "unknown" | "accepted" | "declined" | "self_resolved";

export interface AssistanceOutcome extends AssistanceAttempt {
  endedMs: number;
  execution: AssistanceExecution;
  reaction: AssistanceReaction;
  proof: AssistanceReactionProof | null;
}
