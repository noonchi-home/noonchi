import { Outbox, type BusNode, type Clock } from "../bus/index.js";
import type { GoalState } from "../contract/machines.js";
import { goalState, MachineLane } from "../machines/index.js";

import type { GoalTriggers } from "./triggers.js";

export function goalRoutes(node: BusNode, clock: Clock, triggers?: GoalTriggers) {
  if (triggers) node.on("/brain/decision", ({decision}) => triggers.decision(decision));
  const lane = new MachineLane<GoalState>();
  const out = new Outbox(node, { clock, log: (s) => console.warn(s) });
  node.on("/act/work", (w) => {
    const goal = goalState(w.goal, w.plan);
    const last = lane.last();
    if (goal.id === last?.id && last.state === "done" && goal.state === "started") return;
    const change = lane.change(goal, w.at_ms);
    if (change) {
      out.push("/goal/state", change);
      out.push("/goal/changes", change);
    }
  });
  return out;
}
