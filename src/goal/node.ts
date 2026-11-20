import { Outbox, type BusNode, type Clock } from "../bus/index.js";
import type { GoalState } from "../contract/machines.js";
import { goalState, MachineLane } from "../machines/index.js";

import type { GoalTriggers } from "./triggers.js";
import type { RoomWatch } from "./room-watch.js";

export function goalRoutes(node: BusNode, clock: Clock, triggers?: GoalTriggers, rooms?:RoomWatch) {
  if (triggers) node.on("/brain/decision", ({decision}) => triggers.decision(decision));
  const lane = new MachineLane<GoalState>();
  const out = new Outbox(node, { clock, log: (s) => console.warn(s) });
  if (rooms) {
    node.on("/act/directive_result",r=>rooms.result(r));
    node.on("/manager/directive",d=>{if(d.op==="revoke") rooms.revoked(d.id,clock.now());});
    node.on("/manager/request",()=>rooms.interrupt());
  }
  node.on("/act/work", (w) => {
    rooms?.setBusy(w.emergency || w.requested || w.active || !!w.activeAction || w.docking);
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
