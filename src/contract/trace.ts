import type { AttemptKey, EvidenceRef } from "./assistance.js";
import type { DeviceStateKey } from "./world.js";

export type TraceKind = "AGENT" | "OBSERVATION" | "LLM" | "TOOL" | "EXECUTION" | "GUARDRAIL";
export type TraceState = "pending" | "done" | "failed" | "cancelled";
export const TRACE_KEPT = 240;

/** IDs of the production messages that led to a public row. Free-form model and user text have no field here. */
export interface TraceRefs {
  goal_id?: string;
  decision_id?: string;
  plan_id?: string;
  step_id?: string;
  request_id?: string;
  object_id?: string;
  attempt?: AttemptKey;
  evidence?: EvidenceRef;
}

/** Private parameters to resolve against the action registry and this home's verified layout. */
export interface TraceTarget {
  action?: string;
  destination?: string;
  device?: string;
  deviceState?: DeviceStateKey;
}

export interface TraceRow {
  id: string;
  activity_id: string;
  rev: number;
  /** Keep the completed preparation row while its goal or execution is active. */
  retained?: true;
  cause_id?: string;
  refs: TraceRefs;
  kind: TraceKind;
  name: string;
  input: string;
  output: string;
  started_ms: number | null;
  ended_ms: number | null;
  state: TraceState;
}

export interface TraceMessage { type: "trace"; epoch: string; rows: TraceRow[] }

export type TraceEvent =
  | "goal" | "action" | "wait" | "replan" | "pam" | "vlm" | "closer_vlm" | "observer" | "planner" | "dialog"
  | "closer" | "top" | "device_tool" | "move" | "pick" | "place" | "work" | "activity_result"
  | "person_left" | "person_changed" | "object_changed" | "device" | "safety" | "guard";
export type TraceOutput =
  | "goal_armed" | "goal_planning" | "goal_ready" | "goal_checking" | "goal_fired" | "goal_used" | "goal_dropped"
  | "model_answer" | "scene_people" | "scene_objects" | "scene_people_objects" | "scene_no_target"
  | "selected" | "select_cup" | "waiting" | "late" | "replanned"
  | "failed" | "stopped" | "found" | "unconfirmed" | "cup_empty" | "cup_contents"
  | "step_done" | "place_done" | "move_done" | "activity_done" | "activity_cancelled" | "activity_failed"
  | "safety_fall" | "safety_monitor" | "safety_device" | "safety_cleared"
  | "guard_busy" | "guard_safety" | "guard_changed" | "guard_target" | "guard_placed" | "guard_plan"
  | "device_ack" | "approval_needed" | "person_seen" | "person_not_seen" | "person_room_changed" | "changed";

/** Production producers choose fixed public vocabulary and retain the real correlation keys. */
export interface TracePort {
  start(event: TraceEvent, refs?: TraceRefs, atMs?: number, target?: TraceTarget): string;
  finish(id: string, state: Exclude<TraceState, "pending">, output: TraceOutput, atMs?: number, causeId?: string, evidence?: EvidenceRef): void;
  event(event: TraceEvent, refs: TraceRefs, output: TraceOutput, causeId?: string, target?: TraceTarget): TraceRow | undefined;
  link(from: TraceRefs, to: TraceRefs): void;
}
