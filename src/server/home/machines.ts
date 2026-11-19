import { pamTasks } from "../../act/index.js";
import type { GoalState, ManagerState, RobotState, SafetyState } from "../../contract/machines.js";
import { goalState, MachineLane, managerState, robotState, safetyState } from "../../machines/index.js";
import { POSE_FALL } from "../../world/vocab.js";
import type { HomeCore } from "./core.js";

/** 집이 바뀌면 새 시간 줄을 시작한다. 명령 전송이나 계획 변경은 이곳을 거치지 않는다. */
export class HomeMachines {
  readonly robot = new MachineLane<RobotState>();
  private readonly goals = new MachineLane<GoalState>();
  private readonly safety = new MachineLane<SafetyState>();
  private readonly manager = new MachineLane<ManagerState>();

  sample(core: HomeCore): void {
    const out = core.out.act;
    const tracker = core.tracker;
    if (core.closed || !out || !tracker) return;
    const now = core.nowMs();
    const f = tracker.machineFacts();
    const look = core.looker?.activeTrigger();
    const robot = this.robot.change(robotState({ ...f, blocked: f.blocked || look === "stalled", observing: look === "unknown_fact" }), now);
    if (robot) {
      out.push("/robot/state", robot);
      out.push("/robot/changes", robot);
      core.app?.broadcast({ type: "robot", ...robot });
    }
    const plan = core.plans.current();
    const last = this.goals.last();
    const goal = goalState(core.goal, plan && plan.id === f.planId ? { goal: f.goalId, status: plan.status } : null);
    if (!(last?.id === goal.id && last.state === "done" && goal.state === "started")) {
      const g = this.goals.change(goal, now);
      if (g) {
        out.push("/goal/state", g);
        out.push("/goal/changes", g);
      }
    }
    const current = safetyState(core.view()?.person.facts.posture?.value === POSE_FALL, tracker.offTrack());
    const safe = this.safety.change(current, now);
    if (safe) {
      out.push("/safety/state", safe);
      out.push("/safety/changes", safe);
    }
    const mode = core.mode();
    const m = this.manager.change(managerState({ emergency: current.state === "emergency", requested: f.requested,
      goal: f.active || !!tracker.goal(), mode, tasks: pamTasks(mode, core.pamHeard) }), now);
    if (m) {
      out.push("/manager/state", m);
      out.push("/manager/changes", m);
    }
  }
}
