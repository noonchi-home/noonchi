// 지금 클로이드 계획 하나를 보관하고, 바뀔 때마다 /events로 {type:"plan"}을 보낸다.
// 에이전트 기기 행동, PAM 판단 계획(src/act/), task planner가 보낸 계획(POST /api/plan)이 들어온다. 같은 계획을 고칠 때마다 revision을 올린다.
import type { AgentEvent, ServerMessage } from "../contract/events.js";
import type { PlanStatus, PlanStep, PlanView, StepStatus, XZ } from "../contract/plan.js";
import type { FloorPlan } from "./floor.js";
import { devicePlan } from "./planner.js";
import { roomAt } from "./route.js";

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

  /** 지금 평면도(맞춘 눈이 있으면 그 자리가 로봇 자리). */
  floor(): FloorPlan {
    return this.fp;
  }

  /** 에이전트 이벤트: 기기를 바꾼 행동은 한 단계 계획. 진행 중인 다른 출처 계획은 덮지 않는다. */
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

  /** PAM 판단으로 만든 계획(src/act/tasks.ts). 열린 판단 계획이 있으면 그것을 취소로 닫고 새 계획이 바꾼다(supersedes). */
  onDecision(plan: PlanView): void {
    const cur = this.plan;
    if (isOpen(cur) && cur.source === "brain" && cur.id !== plan.id) {
      this.commit(close(cur, "cancelled"));
      this.commit({ ...plan, supersedes: cur.id });
      return;
    }
    this.commit(plan);
  }

  /** 지금 계획이 planId이고 열려 있으면 닫는다(실행 추적의 완료·실패). 아니면 false. */
  close(planId: string, status: "done" | "cancelled" | "failed"): boolean {
    const p = this.plan;
    if (!isOpen(p) || p.id !== planId) return false;
    this.commit(close(p, status));
    return true;
  }

  /** task planner가 보낸 계획. 같은 id면 바꾼다(번호는 지금보다 크게). origin은 받은 그대로. */
  put(plan: PlanView): void {
    this.commit(plan);
  }

  /** 지금 계획의 단계 상태 하나를 바꾼다. 계획·단계가 없으면 false. */
  setStep(planId: string, stepId: string, status: StepStatus): boolean {
    return this.setSteps(planId, { [stepId]: status });
  }

  /** 지금 계획의 단계 상태 여럿을 한 번에 바꾸고 한 번만 보낸다(실행 추적이 단계를 넘길 때: 앞 단계 done, 다음 단계 active). 계획이 다르거나 없는 단계가 있으면 false. */
  setSteps(planId: string, changes: Record<string, StepStatus>): boolean {
    const p = this.plan;
    const ids = Object.keys(changes);
    if (!p || p.id !== planId || ids.length === 0 || !ids.every((id) => p.steps.some((s) => s.id === id))) return false;
    const steps = p.steps.map((s) => (Object.hasOwn(changes, s.id) ? { ...s, status: changes[s.id]! } : s));
    this.commit({ ...p, steps, status: statusOf(p.status, steps) });
    return true;
  }

  private commit(next: PlanView): void {
    const cur = this.plan;
    const same = cur?.id === next.id;
    if (!same) this.tokens.clear();
    const plan: PlanView = { ...next, revision: same ? Math.max(next.revision, cur!.revision + 1) : next.revision, updatedAt: this.now() };
    this.plan = plan;
    this.broadcast({ type: "plan", plan });
  }
}
