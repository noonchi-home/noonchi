import type { GoalDrop } from "./goal.js";

export type Trigger =
  | { kind: "device"; deviceKind: string; attr: string; value: string | boolean; mode: "edge" | "level"; id?: string }
  | { kind: "entered"; state: string }
  | { kind: "noViewer"; room: string; ms: number }
  | { kind: "postureAttention"; posture: "seated"; target: string };
export interface TriggerFact {
  value: boolean | "unknown";
  observed_ms: number | null;
  rev: number | null;
}

export interface RobotStep { plan_id: string; number: number; label: string }
export interface RobotState {
  state: "idle" | "observe" | "move" | "run" | "return" | "recover";
  step: RobotStep | null;
}
export interface GoalState {
  state: "idle" | "armed" | "planning" | "ready" | "started" | "done" | "dropped";
  id: string | null;
  action: string | null;
  left_ms: number | null;
  reason: GoalDrop | null;
  result: "done" | "failed" | "cancelled" | null;
}
export interface SafetyState {
  state: "normal" | "suspect" | "emergency";
  fall: boolean;
  hot: string[];
  notices: string[];
}
export interface ManagerState {
  owner: "safety" | "request" | "goal" | "idle";
  mode: "noonchi" | "coach";
  tasks: string[];
}
export type Timed<T> = T & { since_ms: number };
export type RobotMessage = Timed<RobotState> & { type: "robot" };
