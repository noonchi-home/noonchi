import { Outbox, type Body, type BusNode, type Clock } from "../bus/index.js";
import type { DecisionRecord } from "../contract/events.js";
import { saidIn } from "../world/labels.js";
import { TaskManager } from "./manager.js";

type Input = Body<"/brain/decision">;
type Job = DecisionRecord & { input: Input };

export function managerRoutes(node: BusNode, clock: Clock) {
  const manager = new TaskManager<Job>();
  const out = new Outbox(node, { clock, log: (s) => console.warn(s) });
  let work: Body<"/act/work"> | null = null;
  const sample = (at: number) => {
    if (!work) return;
    const changed = manager.transition({ ...work, goal: work.active || !!work.goal && !["used", "dropped"].includes(work.goal.status) }, at);
    if (changed) {
      out.push("/manager/state", changed);
      out.push("/manager/changes", changed);
    }
  };
  const offer = (input: Input) => {
    const d = input.decision;
    const gate = work && d.action && d.status === "valid" && !d.late
      ? manager.offer({ ...d, input }, d.source === "speech" || saidIn(d.textSent).length > 0, work) : "take";
    out.push("/manager/order", { input, gate, resumed: false });
    sample(clock.now());
  };
  node.on("/act/work", (w) => {
    work = w;
    const waiting = manager.take(w);
    if (waiting) out.push("/manager/order", { input: waiting.input, gate: "take", resumed: true });
    sample(w.at_ms);
  });
  node.on("/brain/decision", offer);
  node.on("/manager/request", (r) => {
    if (r.kind === "speech") offer(r.input);
    else { manager.cancel(); sample(clock.now()); }
  });
  return out;
}
