// 실행 추적의 승인 질문(src/agent/approval.ts): 위험 목록 가전은 기기 단계에서(토큰), 손으로 켜는 위험 가전은 켜라는 명령보다 먼저 묻는다.
// 처음 하는 계획을 첫 단계 전에 묻기는 설정값(ASK_FIRST_TIME, 기본 끔)을 켤 때만이다.
// 시간 초과로 다시 묻기(계속·그만)도 같은 질문 자리(ask)를 쓴다. 물을 폰(판본이 맞는 폰)이 없으면 기다리지 않고 실패로 닫는다.
import { ConditionWatch } from "../../world/index.js";
import { approvalNeed, riskyHand, taskKey, type AgentStep, type ApprovalAnswer } from "../../agent/index.js";
import { APPROVAL_TEXT, EXEC_TEXT } from "../labels.js";
import { Part, choicesOf, type Run } from "./core.js";

/** 실제 폰에 띄운 질문: 첫 단계 전 승인, 위험 목록 가전 승인(토큰), 시간 초과로 다시 묻기, 컵 안 보기 뒤 남은 음료를 버려도 될지(leftover). */
export type Asking = { why: "plan" } | { why: "device"; token: string } | { why: "again" } | { why: "hand" } | { why: "leftover" };

/** 승인 질문: 묻기, 답 받기(계획·기기·손으로 켜기), 묻는 계획인지. */
export class Approvals extends Part {
  /** 질문·알림만 있는 계획은 승인을 묻지 않는다. 미리 세운 목표로 시작한 계획은 처음 하는 일 묻기(ASK_FIRST_TIME)를 켜도 묻지 않는다(사용자 결정 2026-11-18: 알아서 판단해 실행하는 것을 보인다).
   *  위험 목록 가전은 여기와 따로 그 단계에서 늘 묻는다(기기 단계 승인 토큰·손으로 켜기 risky). */
  need(r: Run): ReturnType<typeof approvalNeed> {
    if (r.goal !== null || r.plan.steps.every((s) => s.kind === "ask" || s.kind === "say")) return null;
    return approvalNeed({ key: taskKey(r.plan.task), risky: false, requested: false, memory: this.o.approvals.memory(), askFirst: this.o.askFirst });
  }

  /** 손으로 켜는 위험 가전 단계인가. 이 집 가전 목록을 모르면 손으로 켜는 단계는 모두 위험한 것으로 본다(묻는다). */
  risky(step: AgentStep | undefined): boolean {
    if (!step || step.kind !== "do" || step.hand?.to !== "on") return false;
    const devices = this.o.handDevices?.();
    return devices ? riskyHand(step, devices) : true;
  }

  /** 실제 폰에 질문(승인·다시 묻기): 위에 질문, 아래 답 단추. 물을 폰(판본이 맞는 폰)이 없으면 기다리지 않고 실패로 닫는다. */
  ask(r: Run, asking: Asking, text: string, stepId: string): void {
    if (!this.core.start.phoneOk()) {
      if (asking.why === "device") this.o.devices?.cancel(asking.token);
      return this.core.steps.finish(r, "failed", EXEC_TEXT.phoneGone);
    }
    const now = this.clock.now();
    Object.assign(r, { asking, askAt: now, spokeAt: now });
    r.sent = {
      type: "command", id: r.plan.view.id, step: stepId, text, vision: null,
      choices: choicesOf(r, this.core.stepOf(r)).map(({ id, label }) => ({ id, label })), target: null, speak: true,
    };
    this.core.robot.commands.show(r.sent);
  }

  /** 첫 단계 전 승인 답: 승인이면 기억하고, 실행 전 검사를 다시 본 뒤 첫 단계로(답을 기다리는 사이 대상이 바뀌었을 수 있다). 거절이면 기억하지 않고 취소로 닫는다. */
  approvedPlan(r: Run, answer: ApprovalAnswer): void {
    this.o.approvals.answer(taskKey(r.plan.task), answer);
    if (answer === "reject") return this.core.steps.finish(r, "failed", APPROVAL_TEXT.refused, "cancelled");
    r.asking = null;
    r.since = this.clock.now();
    this.core.steps.clear(r);
    this.core.start.tryStart(r, false);
  }

  /** 위험 목록 가전 승인 답(기억하지 않음): 승인이면 그 토큰으로 실행, 거절이면 실행하지 않고 취소로 닫는다. */
  approvedDevice(r: Run, token: string, answer: ApprovalAnswer): void {
    r.asking = null;
    this.core.steps.clear(r);
    if (answer === "reject") {
      this.o.devices?.cancel(token);
      return this.core.steps.finish(r, "failed", APPROVAL_TEXT.refused, "cancelled");
    }
    const gen = r.gen;
    r.device = "running";
    // 승인을 기다린 시간은 이 단계 시간 한도에 넣지 않는다
    r.deadline = this.clock.now() + (this.core.stepOf(r)?.timeoutMs ?? 0);
    this.o.devices!.confirm(token, () => this.core.live(r, gen)).then((res) => this.core.steps.deviceResult(r, gen, res), () => this.core.steps.deviceResult(r, gen, { ok: false }));
  }

  /** 켜기 전 질문의 답(기억하지 않는다): 승인이면 그때 켜라는 명령을 보내고(그 가전은 끄는 단계가 끝날 때까지 켠 것으로 본다), 거절이면 취소로 닫는다.
   *  기다린 시간은 단계 시간 한도·끝나는 조건 기준 시각에 넣지 않는다. */
  approvedHand(r: Run, answer: ApprovalAnswer): void {
    const step = this.core.stepOf(r);
    if (answer === "reject" || !step?.hand) return this.core.steps.finish(r, "failed", APPROVAL_TEXT.refused, "cancelled");
    const now = this.clock.now();
    Object.assign(r, { asking: null, stepAt: now, spokeAt: now, visionAt: now, deadline: now + step.timeoutMs, watch: step.until ? new ConditionWatch(step.until) : null });
    this.core.safety.turnedOn(r, step.hand.deviceId, now);
    this.core.steps.show(r, step);
  }
}
