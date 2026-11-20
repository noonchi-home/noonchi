import { pamTasks } from "../../act/index.js";
import type { SafetyState } from "../../contract/machines.js";
import { MachineLane, safetyState } from "../../machines/index.js";
import { POSE_FALL } from "../../world/vocab.js";
import type { HomeCore } from "./core.js";

/** 집이 바뀌면 새 시간 줄을 시작한다. 명령 전송이나 계획 변경은 이곳을 거치지 않는다. */
export class HomeMachines {
  private lastWork = "";
  private readonly safety = new MachineLane<SafetyState>();

  sample(core: HomeCore): void {
    const out = core.out.act;
    const tracker = core.tracker;
    if (core.closed || !out || !tracker) return;
    const now = core.nowMs();
    const f = tracker.machineFacts();
    const look = core.looker?.activeTrigger();
    const robot = tracker.robotTransition({ ...f, blocked: f.blocked || look === "stalled", observing: look === "unknown_fact" }, now);
    if (robot) {
      out.push("/robot/state", robot);
      out.push("/robot/changes", robot);
      core.app?.broadcast({ type: "robot", ...robot });
    }
    const plan = core.plans.current();
    const current = safetyState(core.view()?.person.facts.posture?.value === POSE_FALL, tracker.offTrack());
    const safe = this.safety.change(current, now);
    if (safe) {
      out.push("/safety/state", safe);
      out.push("/safety/changes", safe);
    }
    const mode = core.mode();
    const g = core.goal;
    const goal = g && { id: g.id, action: g.action, status: g.status, prep: g.prep, gone_ms: g.gone_ms, reason: g.reason };
    const work = { ...tracker.workContext(), active: f.active, requested: f.requested, goal,
      plan: plan && plan.id === f.planId ? { goal: f.goalId, status: plan.status } : null,
      phoneBusy:tracker.visitPhoneBusy(), mode, tasks: pamTasks(mode, core.pamHeard) };
    const key = JSON.stringify(work);
    if (key !== this.lastWork) {
      this.lastWork = key;
      out.push("/act/work", { ...work, at_ms: now });
    }
  }
}
