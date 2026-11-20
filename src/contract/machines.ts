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

export type HouseholdAction =
  | { kind:"visit" | "tv_off" | "tv_on" }
  | { kind:"choose_station"; candidates:string[]; direction:string; visited:string[] };
export type HouseholdOffer = HouseholdAction & { id:string; rev:number; until_ms:number; target_id:string; goal_id:string|null };
export type GoalIntent = (HouseholdOffer & {op:"offer"}) | {op:"withdraw";id:string;rev:number};
export type ManagerDirective = (HouseholdOffer & {op:"grant"}) | {op:"revoke";id:string;rev:number};
export type DirectiveResult = {id:string;at_ms:number;target_id:string;evidence_rev:number} & (
  {outcome:"arrived"|"selected"|"cancelled"|"failed"|"unknown"} |
  {outcome:"applied";command_id:string;expected_power:"on"|"off"});

export interface RobotStep { plan_id: string; number: number; label: string }
export interface RobotState {
  state: "idle" | "observe" | "move" | "run" | "return" | "return_room" | "standby" | "recover";
  step: RobotStep | null;
}
export interface GoalState {
  state: "idle" | "armed" | "checking" | "planning" | "ready" | "started" | "done" | "dropped";
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
