// 폰 AR 화면 마스코트 말풍선 글: 열린 계획(planned·running)의 판단 글, 없으면 마지막 판단의 관찰.
// 대시보드가 받는 계획(/events plan)·판단(/events brain decision)과 같은 자료다. 승인은 폰 승인 카드가 따로 맡는다.
// 글이 바뀌면 폰 서버가 brain_line으로 보낸다(server.ts setLine).
import type { BrainLog } from "../contract/events.js";
import type { PlanView } from "../contract/plan.js";

const isOpen = (p: PlanView | null): p is PlanView => !!p && (p.status === "planned" || p.status === "running");

export class MascotLine {
  private plan: PlanView | null = null;
  private observation: string | null = null;

  /** 지금 계획(PlanHub가 보낸 것). */
  onPlan(plan: PlanView | null): void {
    this.plan = plan;
  }

  /** 관찰 흐름 기록. 관찰이 있는 판단만 마지막 관찰을 바꾼다. */
  onBrain(e: BrainLog): void {
    if (e.type !== "decision" || e.status !== "valid") return;
    const seen = e.prediction?.observation.trim();
    if (seen) this.observation = seen;
  }

  /** 지금 말풍선 글. 아직 판단이 없으면 null. */
  text(): string | null {
    const judgment = isOpen(this.plan) ? this.plan.judgment.trim() : "";
    return judgment || this.observation;
  }
}
