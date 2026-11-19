import { saidIn } from "../../world/labels.js";
import { MachineLane, robotState, type RobotFacts } from "../../machines/index.js";
import type { RobotState } from "../../contract/machines.js";
import type { TrackCore } from "../track/core.js";
import { RobotPhone } from "./phone.js";
import { Steps } from "../track/steps.js";
import { Approvals } from "../track/approval.js";
import { Coach } from "../track/coach.js";
import { ContentsHold } from "../track/contents.js";
import { Finder } from "../track/find.js";
import { Dock } from "../track/dock.js";

/** 한 집에서 진행하는 로봇의 단계와 그 단계가 차지한 실제 폰 명령 줄. */
export class RobotMachine {
  readonly commands: RobotPhone;
  private readonly lane = new MachineLane<RobotState>();

  constructor(private readonly core: TrackCore) {
    this.commands = new RobotPhone(core.o.toPhone, (command) => {
      const plan = core.run?.plan;
      const step = plan?.view.id === command.id ? plan.steps.find((s) => s.id === command.step) : undefined;
      return !!step && core.safety.turnsOff(step);
    });
    core.steps = new Steps(core);
    core.approval = new Approvals(core);
    core.coach = new Coach(core);
    core.contents = new ContentsHold(core);
    core.finder = new Finder(core);
    core.dock = new Dock(core);
  }

  transition(facts: RobotFacts, now: number) {
    return this.lane.change(robotState(facts), now);
  }

  last() { return this.lane.last(); }

  facts() {
    const c = this.core;
    const r = c.open();
    const step = r?.state === "running" ? c.stepOf(r) : null;
    const find = r?.find ?? c.finding?.find;
    const hold = r?.hold ?? c.idlePeek?.hold;
    const inspecting = !!find || !!hold;
    const walking = find?.part === "go" || hold?.peek?.part === "go";
    const decision = r?.decision ?? c.planning?.decision ?? c.finding?.decision;
    return {
      step: r && step ? { plan_id: r.plan.view.id, number: r.at + 1, label: step.label } : null,
      dock: c.docking?.phase ?? null,
      inspection: inspecting ? (walking ? "go" as const : "look" as const) : null,
      blocked: find?.blockedAt != null || hold?.pausedAt != null || (!find && r?.verify?.at != null) || r?.asking?.why === "again"
        || (r?.state === "planned" && !r.asking && (r.phoneWait || r.deferred || r.busyAt !== null || r.usedAt !== null)),
      asking: !!r?.asking,
      off: c.safety.offShown(),
      requested: !!decision && (decision.source === "speech" || saidIn(decision.textSent).length > 0),
      active: !!r || !!c.planning,
      goalId: c.run?.goal ?? null,
      planId: c.run?.plan.view.id ?? null,
    };
  }
}
