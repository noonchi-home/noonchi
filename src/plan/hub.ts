// 지금 클로이드 계획 하나를 보관하고, 바뀔 때마다 /events로 {type:"plan"}을 보낸다.
// 컵 두뇌(brain) 행동·판단, 에이전트 기기 행동, task planner가 보낸 계획(POST /api/plan)이 들어온다.
// 같은 계획을 고칠 때마다 revision을 올리고, 두뇌가 다시 판단해 새 행동을 내면 새 계획에 supersedes를 단다.
import { CUP_TASKS } from "../brain/decision.js";
import type { AgentEvent, BrainLog, BrainStage, ServerMessage } from "../contract/events.js";
import type { PlanStatus, PlanStep, PlanView, StepStatus, XZ } from "../contract/plan.js";
import type { FloorPlan } from "./floor.js";
import { ASK_JUDGMENT, JUDGMENT } from "./labels.js";
import { askPlan, cupPlan, devicePlan } from "./planner.js";
import { roomAt } from "./route.js";

const [CLEAR_CUP, ASK_USER] = CUP_TASKS;

const isOpen = (p: PlanView | null): p is PlanView => !!p && (p.status === "planned" || p.status === "running");

/** 계획을 닫는다. 끝나지 않은 단계는 done이면 모두 done, failed면 지금 단계만 failed, 나머지는 건너뜀. */
function close(p: PlanView, status: "done" | "cancelled" | "failed"): PlanView {
  const steps = p.steps.map((s): PlanStep => {
    if (s.status === "done" || s.status === "skipped" || s.status === "failed") return s;
    if (status === "done") return { ...s, status: "done" };
    if (status === "failed" && s.status === "active") return { ...s, status: "failed" };
    return { ...s, status: "skipped" };
  });
  return { ...p, steps, status };
}

/** 단계 상태로 계획 상태를 맞춘다(취소한 계획은 그대로). */
function statusOf(prev: PlanStatus, steps: PlanStep[]): PlanStatus {
  if (prev === "cancelled") return prev;
  if (steps.some((s) => s.status === "failed")) return "failed";
  if (steps.every((s) => s.status === "done" || s.status === "skipped")) return "done";
  if (steps.some((s) => s.status === "active" || s.status === "done")) return "running";
  return prev;
}

export class PlanHub {
  private plan: PlanView | null = null;
  /** 마지막 두뇌 계획과 그 계획을 만들 때의 판단 세대(다시 계획인지 본다). */
  private brainPlan: { id: string; status: PlanStatus; generation: number } | null = null;
  private stage: BrainStage | null = null;
  private generation = 0;
  /** 승인 토큰 → 지금 기기 계획 id. */
  private readonly tokens = new Map<string, string>();

  constructor(
    private fp: FloorPlan,
    private readonly broadcast: (m: ServerMessage) => void,
    private readonly now: () => string = () => new Date().toISOString(),
  ) {}

  current(): PlanView | null {
    return this.plan;
  }

  /** 두뇌가 대시보드로 보내는 메시지 그대로({type:"brain", event}, src/brain/live.ts). 다른 메시지는 무시. */
  onDashboard(m: unknown): void {
    const msg = m as { type?: unknown; event?: { type?: unknown } } | null;
    if (msg?.type === "brain" && typeof msg.event?.type === "string") this.onBrain(msg.event as BrainLog);
  }

  /** 두뇌 이벤트(판정·존재 기록은 무시). */
  onBrain(e: BrainLog): void {
    if (e.type === "brain") {
      this.generation = Math.max(this.generation, e.generation);
      this.stage = e.stage;
      const p = this.plan;
      if (!isOpen(p) || p.source !== "brain") return;
      if (e.stage === "cancel") this.commit({ ...close(p, "cancelled"), judgment: JUDGMENT.cancel });
      else if (this.judgmentFor(p) !== p.judgment) this.commit({ ...p, judgment: this.judgmentFor(p) });
    } else if (e.type === "action") {
      if (!e.active) return; // 끝날 때 거두는 action은 result가 닫는다
      const made = e.task === CLEAR_CUP ? cupPlan(this.fp, e.id, this.now()) : e.task === ASK_USER ? askPlan(this.fp, e.id, this.now()) : null;
      if (!made) return;
      const prev = this.brainPlan;
      const supersedes = prev && prev.id !== made.id && prev.status !== "done" && this.generation > prev.generation ? prev.id : undefined;
      const steps = made.steps.map((s, i): PlanStep => (i === 0 ? { ...s, status: "active" } : s));
      this.commit({ ...made, steps, status: "running", judgment: this.judgmentFor(made), ...(supersedes ? { supersedes } : {}) });
    } else if (e.type === "result") {
      const p = this.plan;
      if (!isOpen(p) || p.source !== "brain" || p.id !== e.id) return;
      if (e.outcome === "cleared" || e.outcome === "answered") this.commit({ ...close(p, "done"), judgment: JUDGMENT.result });
      else this.commit(close(p, e.outcome === "declined" || e.outcome === "withdrawn" ? "cancelled" : "failed"));
    }
  }

  /** 에이전트 이벤트: 기기를 바꾼 행동은 한 단계 계획. 진행 중인 두뇌·planner 계획은 덮지 않는다. */
  onAgent(e: AgentEvent): void {
    if (e.event === "action") {
      const made = devicePlan(this.fp, e.action, this.now());
      if (!made || (isOpen(this.plan) && this.plan.source !== "agent")) return;
      this.commit(made);
    } else if (e.event === "pending") {
      const p = this.plan;
      if (p?.source === "agent" && p.status === "planned" && p.steps[0]?.target?.deviceId === e.pending.deviceId) this.tokens.set(e.pending.token, p.id);
    } else if (e.event === "confirmed" || e.event === "cancelled") {
      const id = this.tokens.get(e.token);
      this.tokens.delete(e.token);
      const p = this.plan;
      if (!id || !isOpen(p) || p.id !== id) return;
      this.commit(close(p, e.event === "cancelled" ? "cancelled" : e.ok ? "done" : "failed"));
    }
  }

  /** 폰(클로이드의 눈) 바닥 자리를 로봇 자리로 쓴다. 다음 계획부터. 맞추기 전 추정 눈은 쓰지 않는다. */
  onEye(position: XZ, estimated = false): void {
    if (estimated || !position.every(Number.isFinite)) return;
    const at: XZ = [position[0], position[1]];
    this.fp = { ...this.fp, robot: { ...this.fp.robot, position: at, room: roomAt(this.fp, at) } };
  }

  /** task planner가 보낸 계획. 같은 id면 바꾼다(번호는 지금보다 크게). origin은 받은 그대로. */
  put(plan: PlanView): void {
    this.commit(plan);
  }

  /** 지금 계획의 단계 상태 하나를 바꾼다. 계획·단계가 없으면 false. */
  setStep(planId: string, stepId: string, status: StepStatus): boolean {
    const p = this.plan;
    if (!p || p.id !== planId || !p.steps.some((s) => s.id === stepId)) return false;
    const steps = p.steps.map((s) => (s.id === stepId ? { ...s, status } : s));
    this.commit({ ...p, steps, status: statusOf(p.status, steps) });
    return true;
  }

  private judgmentFor(p: PlanView): string {
    if (!this.stage) return p.judgment;
    if (this.stage === "act" && p.steps[0]?.kind === "ask") return ASK_JUDGMENT;
    return JUDGMENT[this.stage];
  }

  private commit(next: PlanView): void {
    const cur = this.plan;
    const same = cur?.id === next.id;
    if (!same) this.tokens.clear();
    const plan: PlanView = { ...next, revision: same ? Math.max(next.revision, cur!.revision + 1) : next.revision, updatedAt: this.now() };
    this.plan = plan;
    if (plan.source === "brain") this.brainPlan = { id: plan.id, status: plan.status, generation: this.brainPlan?.id === plan.id ? this.brainPlan.generation : this.generation };
    this.broadcast({ type: "plan", plan });
  }
}
