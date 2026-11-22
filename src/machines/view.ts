import type { PendingGoal } from "../contract/goal.js";
import type { GoalState, ManagerState, RobotState, RobotStep, SafetyState, Timed } from "../contract/machines.js";
import type { OffTrack, PlanStatus } from "../contract/plan.js";

/** 지금 보이는 단계와 보류·관찰·충전 자리 복귀 상태. */
export interface RobotFacts {
  step: RobotStep | null;
  dock: "look" | "go" | "room" | "standby" | null;
  inspection: "go" | "look" | null;
  blocked: boolean;
  off: boolean;
  observing: boolean;
  asking: boolean;
}

export function robotState(f: RobotFacts): RobotState {
  if (f.off) return { state: "run", step: null };
  if (f.blocked) return { state: "recover", step: f.step };
  if (f.inspection) return { state: f.inspection === "go" ? "move" : "observe", step: f.step };
  if (f.step || f.asking) return { state: "run", step: f.step };
  if (f.dock === "standby") return { state:"standby", step:null };
  if (f.dock === "room") return { state:"return_room", step:null };
  if (f.dock === "go") return { state: "return", step: null };
  return { state: f.dock || f.observing ? "observe" : "idle", step: null };
}

type GoalFacts = Pick<PendingGoal, "id" | "action" | "status" | "prep" | "gone_ms" | "reason">;
export function goalState(g: GoalFacts | null, plan: { goal: string | null; status: PlanStatus } | null): GoalState {
  const fields = { id: g?.id ?? null, action: g?.action ?? null, left_ms: g?.gone_ms ?? null, reason: g?.reason ?? null, result: null };
  if (!g) return { ...fields, state: "idle" };
  if (g.status === "checking") return { ...fields, state: "checking" };
  if (g.status === "dropped") return { ...fields, state: "dropped" };
  if (g.status === "used") {
    if (plan?.goal === g.id && (plan.status === "done" || plan.status === "failed" || plan.status === "cancelled")) {
      return { ...fields, state: "done", result: plan.status };
    }
    return { ...fields, state: "started" };
  }
  return { ...fields, state: g.prep === "ready" || g.prep === "planning" ? g.prep : "armed" };
}

export function safetyState(fall: boolean, off: OffTrack): SafetyState {
  return { state: fall || off.notices.length ? "emergency" : off.hot.length ? "suspect" : "normal",
    fall, hot: [...off.hot].sort(), notices: [...off.notices].sort() };
}

export function managerState(f: { emergency: boolean; requested: boolean; goal: boolean; mode: ManagerState["mode"]; tasks: string[] }): ManagerState {
  const owner = f.emergency ? "safety" : f.requested ? "request" : f.goal ? "goal" : "idle";
  return { owner, mode: f.mode, tasks: [...f.tasks] };
}

/** 같은 집·같은 기계에서 처음 본 시각을 보존한다. 상태는 JSON으로 보낼 작은 계약 값이다. */
export class MachineLane<T extends object> {
  private key: string | undefined;
  private current: Timed<T> | null = null;

  change(value: T, since: number): Timed<T> | null {
    const key = JSON.stringify(value);
    if (key === this.key) return null;
    this.key = key;
    this.current = { ...value, since_ms: since };
    return this.current;
  }
  last(): Timed<T> | null { return this.current; }
}
