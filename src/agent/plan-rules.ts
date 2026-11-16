// 계획 단계 규칙: 사람 단계 종류(HUMAN_KINDS), 손으로 켜는 위험 가전 단계(riskyHand), 폰이 꼭 필요한 계획(needsPhone), 저절로 꺼지는 가전의 꺼짐 기다리기(selfStopWait).
// 계획 검사(src/agent/planTools.ts PlanDraft)와 실행 추적(src/act/track/)이 같은 규칙을 쓴다. 승인 판정은 src/agent/policy.ts needsConfirm 하나다.
import type { Capability } from "../contract/devices.js";
import { isSelfStop } from "../devices/kinds.js";
import { needsConfirm } from "./policy.js";
import { toolCommand } from "./tools.js";
import type { ApprovalWhy } from "./approval.js";
import type { AgentPlan, AgentStep, AgentStepKind } from "./planTools.js";

export const HUMAN_KINDS: readonly AgentStepKind[] = ["go", "pick", "place", "do"];

/** 손으로 켜는 가전이 위험 목록인가(승인 판정 src/agent/policy.ts needsConfirm에 켜기를 넣어 본다). 끄는 단계·위험 목록이 아닌 가전은 아니다. */
export function riskyHand(step: Pick<AgentStep, "hand">, devices: readonly { id: string; kind: string; capabilities?: readonly Capability[] }[]): boolean {
  if (step.hand?.to !== "on") return false;
  const d = devices.find((x) => x.id === step.hand!.deviceId);
  return !!d && needsConfirm(d, { type: "on" });
}

/** 폰 답·폰 안내가 꼭 필요한 계획인가: 사람 단계(go·pick·place·do)나 질문이 있거나, 처음 하는 일이라 승인 질문이 필요하거나(approval),
 *  승인 판정상 묻는 가전 단계(위험 목록, src/agent/policy.ts needsConfirm. 가전을 모르면 묻는 것으로 본다)가 있거나, 어떤 단계든 시간 초과 때 폰에 묻는(on_timeout ask) 계획.
 *  가전 단계·기다리기·알림만 있고 이미 승인됐고 시간 초과가 모두 실패인 계획(에어컨 켜기 등)은 폰 없이 돈다. */
export function needsPhone(plan: Pick<AgentPlan, "steps">, approval: ApprovalWhy | null, devices: readonly { id: string; kind: string; capabilities?: readonly Capability[] }[]): boolean {
  if (approval) return true;
  return plan.steps.some((s) => {
    if (HUMAN_KINDS.includes(s.kind) || s.kind === "ask" || s.onTimeout === "ask") return true;
    if (s.kind !== "device" || !s.device) return false;
    const cmd = toolCommand(s.device.tool, s.device.args);
    const d = devices.find((x) => x.id === s.device!.deviceId);
    return !!cmd && (!d || needsConfirm(d, cmd));
  });
}

/** 저절로 꺼지는 가전의 꺼짐 기다리기인가: wait이고 until이 정확히 {"device": 그 가전, "state": "off"}이며 그 가전 종류가 등록부 selfStop(src/devices/kinds.ts isSelfStop).
 *  맞으면 그 가전 id, 아니면 null. 실행 추적은 이 단계를 끝 조건 대신 작동 한 번 끝남(cycleEnded)으로 넘긴다. */
export function selfStopWait(step: Pick<AgentStep, "kind" | "until">, devices: readonly { id: string; kind: string }[]): string | null {
  if (step.kind !== "wait" || !step.until) return null;
  const u = step.until as Record<string, unknown>;
  const keys = Object.keys(u).sort();
  if (keys.length !== 2 || keys[0] !== "device" || keys[1] !== "state" || u.state !== "off" || typeof u.device !== "string") return null;
  const d = devices.find((x) => x.id === u.device);
  return d && isSelfStop(d.kind) ? d.id : null;
}
