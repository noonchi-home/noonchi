// 실행 추적: 판단 → 계획 → 실행 중 → 결과 확인 → 완료 또는 실패. 단계마다 execution 기록을 낸다(plan_id는 plan:<판단 id>).
// 로봇이 없어 집기·옮기기는 폰으로 사람에게 부탁하고(소리로도 읽음), 결과는 World State로 본다(대상 물건이 시야 안에서 사라짐).
// 물어보기는 답을 받으면 완료. 실행 전 검사는 통과할 때까지 tick마다 다시 보고, recheckMs가 지나도 안 되면 그 이유로 실패한다.
// 로봇은 한 번에 한 계획만 실행한다: 진행 중인 계획과 행동·대상이 같은 판단은 기록만 하고, 지금 계획보다 먼저 보낸(seq가 작은) 판단은 버린다.
import type { BrainLog, ExecState } from "../contract/events.js";
import type { PlanView } from "../contract/plan.js";
import type { WorldChange, WorldView } from "../contract/world.js";
import type { FloorPlan } from "../plan/floor.js";
import type { PlanHub } from "../plan/hub.js";
import { EXEC_TEXT } from "../plan/labels.js";
import type { DecisionRecord } from "../world/decide.js";
import type { CheckResult } from "./check.js";
import type { ActionChoice } from "./prompts.js";
import { planFor, planIdOf, targetOf, taskOf, type TaskSpec } from "./tasks.js";

export interface TrackerOptions {
  plans: PlanHub;
  world: () => WorldView;
  /** 실행 전 검사(src/act/check.ts checkPlan). */
  check: (d: DecisionRecord, plan: PlanView) => CheckResult;
  floor: () => FloorPlan;
  /** 폰으로 보낸다: { type: "action", id, task, active, … }. */
  toPhone: (msg: unknown) => void;
  emit: (l: BrainLog) => void;
  clock?: { now(): number };
  /** 실행 중·결과 확인을 이만큼 기다린다(기본 120000). */
  verifyTimeoutMs?: number;
  /** 검사를 다시 보는 시간(기본 3000). */
  recheckMs?: number;
}

/** targetId: 계획을 만들 때 World State에서 고른 대상 물건(없으면 null). asked: 폰에 부탁을 띄웠는가. */
interface Run { plan: PlanView; decision: DecisionRecord; spec: TaskSpec; targetId: string | null; state: ExecState; since: number; asked: boolean }

const OPEN = new Set<ExecState>(["planned", "running", "verifying"]);

export class ExecutionTracker {
  private run: Run | null = null;
  private lastSeq = 0;
  private stopped = false;
  private readonly clock: { now(): number };

  constructor(private readonly o: TrackerOptions) {
    this.clock = o.clock ?? { now: () => Date.now() };
  }

  current(): { planId: string; state: ExecState } | null {
    return this.run && { planId: this.run.plan.id, state: this.run.state };
  }

  /** 폰에 띄운 부탁·질문(답을 기다리는 중). 없으면 null. */
  openRequest(): { planId: string; task: string; kind: TaskSpec["kind"]; text: string; choices: ActionChoice[] } | null {
    const r = this.run;
    return r && r.state === "running" ? { planId: r.plan.id, task: r.spec.name, kind: r.spec.kind, text: r.spec.prompt.text, choices: r.spec.prompt.choices } : null;
  }

  onDecision(d: DecisionRecord): void {
    if (this.stopped) return;
    if (d.seq < this.lastSeq) return this.note(d, EXEC_TEXT.late);
    const spec = taskOf(d.action);
    if (d.status !== "valid") return this.note(d, EXEC_TEXT.decisionFailed);
    if (!d.action) return this.note(d, EXEC_TEXT.wait);
    const world = this.o.world();
    const targetId = spec ? targetOf(spec, world)?.id ?? null : null;
    const open = this.run && OPEN.has(this.run.state) ? this.run : null;
    if (open && spec && open.spec.name === spec.name && open.targetId === targetId) return this.note(d, EXEC_TEXT.same);
    this.lastSeq = d.seq;
    const now = this.clock.now();
    const plan = spec && planFor(this.o.floor(), d, world, new Date(now).toISOString());
    // 새 계획이 있으면 PlanHub.onDecision이 지금 계획을 취소로 닫고 supersedes를 단다
    if (open) {
      this.finish("failed", EXEC_TEXT.superseded, false);
      if (!plan) this.o.plans.close(open.plan.id, "cancelled");
    }
    if (!spec || !plan) {
      this.emit(planIdOf(d.id), "decided");
      this.emit(planIdOf(d.id), "failed", EXEC_TEXT.noPlan);
      return;
    }
    this.run = { plan, decision: d, spec, targetId, state: "decided", since: now, asked: false };
    this.step("decided");
    this.o.plans.onDecision(plan);
    this.step("planned");
    this.tryStart(false);
  }

  /** 폰 버튼·음성 답. 지금 부탁한 계획이 아니면 무시한다. */
  onReply(planId: string, choice: string): void {
    const r = this.run;
    if (this.stopped || !r || r.plan.id !== planId || r.state !== "running") return;
    const picked = r.spec.prompt.choices.find((c) => c.id === choice);
    if (!picked) return;
    if (r.spec.kind === "ask") return this.finish("done", EXEC_TEXT.answered(picked.label));
    if (choice === "later") return this.finish("failed", EXEC_TEXT.declined);
    this.step("verifying");
    const target = this.o.world().objects.find((x) => x.id === r.targetId);
    if (!target || target.status === "gone") this.finish("done");
  }

  /** 결과 확인: 대상 물건이 사라지면 완료(부탁 중에 먼저 치워도). */
  onWorld(changes: WorldChange[]): void {
    const r = this.run;
    if (this.stopped || !r || !r.targetId || (r.state !== "running" && r.state !== "verifying")) return;
    if (!changes.some((c) => c.kind === "gone" && c.subject === r.targetId)) return;
    if (r.state === "running") this.step("verifying");
    this.finish("done");
  }

  /** 타이머(250ms)가 부른다: 검사 다시 보기, 시간 초과. */
  tick(): void {
    const r = this.run;
    if (this.stopped || !r) return;
    const waited = this.clock.now() - r.since;
    if (r.state === "planned") this.tryStart(waited >= (this.o.recheckMs ?? 3000));
    else if ((r.state === "running" || r.state === "verifying") && waited > (this.o.verifyTimeoutMs ?? 120_000)) {
      this.finish("failed", r.state === "running" && r.spec.kind === "ask" ? EXEC_TEXT.noAnswer : EXEC_TEXT.timeout);
    }
  }

  /** 멈추면 더 기록하지 않고 폰에도 보내지 않는다. */
  stop(): void {
    this.stopped = true;
  }

  private tryStart(last: boolean): void {
    const r = this.run!;
    const c = this.o.check(r.decision, r.plan);
    if (!c.ok) {
      if (last) this.finish("failed", c.text);
      return;
    }
    const first = r.plan.steps[0];
    if (first) this.o.plans.setStep(r.plan.id, first.id, "active");
    this.step("running");
    r.asked = true;
    const { prompt, name } = r.spec;
    this.o.toPhone({ type: "action", id: r.plan.id, task: name, active: true, dry_run: true, speak: true, would: prompt.would, text: prompt.text, choices: prompt.choices });
  }

  private finish(state: "done" | "failed", text?: string, closePlan = true): void {
    const r = this.run!;
    this.step(state, text);
    if (r.asked) this.o.toPhone({ type: "action", id: r.plan.id, task: r.spec.name, active: false });
    // 새 판단이 바꾸면 계획은 PlanHub.onDecision이 취소로 닫는다
    if (closePlan) this.o.plans.close(r.plan.id, state);
  }

  private step(state: ExecState, text?: string): void {
    const r = this.run!;
    r.state = state;
    r.since = this.clock.now();
    this.emit(r.plan.id, state, text);
  }

  /** 계획을 만들지 않는 판단(대기·실패·같은 행동·늦은 답)은 그 판단 줄에 기록만 한다. */
  private note(d: DecisionRecord, text: string): void {
    this.emit(planIdOf(d.id), "decided", text);
  }

  private emit(planId: string, state: ExecState, text?: string): void {
    this.o.emit({ type: "execution", at_ms: this.clock.now(), plan_id: planId, state, text: text ?? EXEC_TEXT[state] });
  }
}
