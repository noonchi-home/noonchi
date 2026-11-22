import type { PlanStep, PlanView } from "../../../src/contract/plan";
import { isOpen, type DashData } from "./data";
import { WORDS } from "./words";

export interface NarrationLines {
  status: string;
  judgment: string;
  execution: string;
}

const empty = "—";
// 시안의 공개 명령과 단계가 서로 맞을 때만 직전 완료 단계를 함께 설명한다.
const cupSteps = new Map([
  ["식탁으로 가 주세요", "식탁으로 가기"], ["컵을 들어 주세요", "컵 집기"],
  ["싱크대로 가 주세요", "싱크대로 가기"], ["컵을 싱크대에 넣어 주세요", "컵 내려놓기"],
]);
const knownSteps = new Set(cupSteps.values());
const stepKinds: Record<PlanStep["kind"], string> = { move: "이동", act: "작업", device: "기기 조작", ask: "응답 확인", wait: "대기" };

function latestPlan(data: DashData): PlanView | null {
  if (!data.plan) return null;
  return data.plans.reduce((current, other) => {
    if (other.id === current.id || current.supersedes === other.id) return current;
    return other.supersedes === current.id || Date.parse(other.updatedAt) > Date.parse(current.updatedAt) ? other : current;
  }, data.plan);
}

function statusLine(data: DashData, decision: DashData["decision"]): string {
  const people = data.personFed ? data.people.filter(p => p.name !== undefined) : [];
  const person = people.at(-1);
  const state = person?.state ?? decision?.fsm?.state;
  const at = person?.at_ms ?? decision?.at_ms;
  const goal: { status: string; checking_ms?: number } | null = data.goal;
  if (goal?.status === "checking" && goal.checking_ms != null && (at == null || goal.checking_ms >= at)) {
    return "사용자 상태를 확인하고 있어요.";
  }
  if (state === "away") {
    const previous = person ? people.reverse().find(p => p.state !== state)?.state : decision?.fsm?.from;
    return previous === "drinking" ? "먹거나 마시던 분이 자리를 비웠어요." : "사용자가 자리를 비웠어요.";
  }
  const activity = person?.name ?? data.habit?.states.find(s => s.id === state)?.name;
  if (activity) return activity.endsWith("중") ? `사용자가 ${activity}이에요.` : `사용자 상태는 ‘${activity}’예요.`;
  const robot = data.robots.at(-1);
  if (robot) return `클로이드 상태는 ‘${WORDS.timeline.robot[robot.state]}’예요.`;
  return "상태를 기다리고 있어요.";
}

function judgmentLine(data: DashData, decision: DashData["decision"], plan: PlanView | null): string {
  if (!decision || (plan && plan.id !== `plan:${decision.id}`)) return empty;
  const person = data.people.at(-1);
  if (!plan && person && person.at_ms > decision.at_ms && person.state !== decision.fsm?.state) return empty;
  if (decision.action === null) return "이번에는 지켜보기로 했어요.";
  const learned = !decision.source && decision.fsm?.learned && decision.fsm.next_index >= 0 && decision.fsm.action === decision.action;
  const choice = decision.action === "컵 치우기" ? "컵을 치우기로 했어요." : "다음 행동을 정했어요.";
  return learned ? `배운 습관에 따라 ${choice}` : choice;
}

function executionLine(plan: PlanView | null, command: string | null): string {
  const index = isOpen(plan) ? plan.steps.findIndex(s => s.status === "active") : -1;
  const step = plan?.steps[index];
  const sent = command?.trim().replace(/[.。]+$/u, "");
  if (sent) {
    // phone_command에는 승인 질문이 걸러져 있다. 자유 문장은 옮겨 쓰지 않고 공개 명령의 송신만 알린다.
    const label = cupSteps.get(sent);
    if (!label) return "폰에 안내를 보냈어요.";
    const request = `폰에 ${sent.replace(/ 주세요$/u, " 달라고")} 했어요.`;
    const previous = plan?.steps[index - 1];
    if (step?.label === label && previous?.status === "done" && knownSteps.has(previous.label)) {
      const completed = previous.label.endsWith(" 가기") ? previous.label.replace(/가기$/u, "가는") : `‘${previous.label}’`;
      return `${completed} 단계를 마쳤어요. ${request}`;
    }
    return request;
  }
  if (!plan) return empty;
  if (step) {
    const label = knownSteps.has(step.label) && step.kind !== "ask" ? step.label : stepKinds[step.kind];
    return `계획의 ${index + 1}번째 단계는 ‘${label}’예요.`;
  }
  if (plan.status === "done") return "계획을 마쳤어요.";
  if (plan.status === "cancelled") return "계획이 취소됐어요.";
  if (plan.status === "failed") return "계획을 마치지 못했어요.";
  return "다음 단계의 시작을 기다리고 있어요.";
}

export function narrationOf(data: DashData, command: string | null, connected: boolean | null): NarrationLines {
  if (connected !== true) return {
    status: connected === false ? "연결이 끊겼어요." : "연결을 기다리고 있어요.", judgment: empty, execution: empty,
  };
  if (data.safety && data.safety.text === data.say) return { status: data.safety.text, judgment: empty, execution: empty };
  const decision = data.decision?.status === "valid" && !data.decision.late ? data.decision : null;
  const plan = latestPlan(data);
  return { status: statusLine(data, decision), judgment: judgmentLine(data, decision, plan), execution: executionLine(plan, command) };
}
