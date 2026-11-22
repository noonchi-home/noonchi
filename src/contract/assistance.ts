export interface AttemptKey {
  boot: string;
  homeEpoch: string;
  attemptId: string;
  gen: number;
}

export interface EvidenceRef {
  source: string;
  subjectId: string;
  observedMs: number;
  originId: string;
}

export type AssistanceGoal =
  | { kind: "deliver"; objectId: string | null; recipientId: string | null; room: string | null }
  | { kind: "clear"; objectId: string; from: string; to: string; basin: boolean }
  | { kind: "device"; deviceId: string; attr: string; value: unknown };

export type EvidenceChoice =
  | { tool: "read_device" | "last_seen" | "look_closer"; target: string }
  | { tool: "wait_for_new_photo" | "stop" };

export type MissingEvidence = "device_power" | "object_location" | "recipient_location" | "completion";
export type EvidenceStatus = "found" | "position_known" | "stale" | "ambiguous" | "unavailable" | "rejected";
export interface EvidenceCheck { choice: EvidenceChoice; status: EvidenceStatus; ref?: EvidenceRef }

export interface EvidenceQuestion {
  goal: AssistanceGoal;
  missing: MissingEvidence;
  allowed: readonly EvidenceChoice[];
  observations: readonly EvidenceRef[];
  checks: readonly EvidenceCheck[];
}

export type Intervention = "default" | "verify_first" | "defer_proactive";
