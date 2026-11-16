// 외부 연락(call_service) 종류 표와 서버 글: 실제 폰 승인 질문·답, 대시보드 말풍선 카드, 기록 DB service 줄.
// 연락은 밖으로 나가는 일이라 위험 목록처럼 늘 묻고 답 둘 다 이번만이다(src/agent/policy.ts askService). 글은 모두 서버가 정한다(모델 글을 폰으로 보내지 않는다).
import type { ServiceCall, ServiceKind, ServiceOutcome, ServiceResult } from "../contract/service.js";
import { josa } from "../shared/korean.js";

/** 도구 이름. */
export const CALL_SERVICE = "call_service";

/** 종류마다: to 받는 이를 정하지 않을 때 이름, ask 실제 폰 승인 질문, what 일 이름(거절·취소 답·기록 줄), sent·failed 답. */
export const SERVICE_KINDS: Record<ServiceKind, { to: string; ask: string; what: string; sent: string; failed: string }> = {
  as_center: { to: "AS센터", ask: "AS센터에 전화할까요?", what: "AS센터 전화", sent: "AS센터에 전화를 요청했어요.", failed: "AS센터에 전화하지 못했어요." },
  guardian: { to: "보호자", ask: "보호자에게 연락할까요?", what: "보호자 연락", sent: "보호자에게 연락을 요청했어요.", failed: "보호자에게 연락하지 못했어요." },
};
export const SERVICE_KIND_IDS = Object.keys(SERVICE_KINDS) as [ServiceKind, ...ServiceKind[]];

/** CALL_SERVICE_URL이 없을 때 실제 폰 답·말풍선 카드 글. */
export const SERVICE_UNCONNECTED = "전화 서비스가 아직 연결되지 않았어요.";

const OUTCOME_TEXT: Record<ServiceOutcome, string> = { sent: "보냄", refused: "거절", unconnected: "연결 없음", failed: "실패" };

/** 승인한 뒤의 답(보냄·연결 없음·실패). 거절은 REFUSED_REPLY(일 이름)이다. */
export function serviceReply(kind: ServiceKind, outcome: Exclude<ServiceOutcome, "refused">): string {
  return outcome === "sent" ? SERVICE_KINDS[kind].sent : outcome === "unconnected" ? SERVICE_UNCONNECTED : SERVICE_KINDS[kind].failed;
}

/** 취소 답: 「AS센터 전화를 취소했어요.」. */
export const serviceCancelled = (kind: ServiceKind) => `${josa(SERVICE_KINDS[kind].what, "을/를")} 취소했어요.`;

/** 기록 DB service 줄 글: 「세탁기 AS센터 전화 · 보냄」(가전이 없으면 일 이름만). */
export function serviceRecordText(r: ServiceResult): string {
  const what = SERVICE_KINDS[r.call.kind].what;
  return `${r.call.device ? `${r.call.device.label} ${what}` : what} · ${OUTCOME_TEXT[r.outcome]}`;
}

/** 대시보드 말풍선 카드 글. 거절은 승인 답이라 대시보드에 보이지 않는다(null). */
export function serviceSay(r: ServiceResult): string | null {
  return r.outcome === "refused" ? null : serviceReply(r.call.kind, r.outcome);
}

/** 도구 인자 → 연락. 모자라면 까닭 글: AS센터 전화는 가전(device_id)이나 고장 설명(problem), 보호자 연락은 사람 상태(person)가 있어야 한다. */
export function serviceCall(
  args: { kind: ServiceKind; to?: string; problem?: string; error_code?: string; person?: string },
  device: ServiceCall["device"],
): ServiceCall | string {
  const text = (v: string | undefined) => (v?.trim() ? v.trim() : null);
  const call: ServiceCall = {
    kind: args.kind, to: text(args.to) ?? SERVICE_KINDS[args.kind].to, device, problem: text(args.problem), errorCode: text(args.error_code), person: text(args.person),
  };
  if (call.kind === "as_center" && !call.device && !call.problem) return "AS센터 전화에는 고장 난 가전(device_id)이나 고장 설명(problem)이 필요합니다. 사용자에게 무엇이 고장 났는지 물으세요.";
  if (call.kind === "guardian" && !call.person) return "보호자 연락에는 사람 상태 요약(person)이 필요합니다. 어떤 상황인지 한 문장으로 넣으세요.";
  return call;
}

/** 기록·행동 인자로 남기는 연락 모양(도구 인자와 같은 이름). */
export function serviceArgs(call: ServiceCall): Record<string, unknown> {
  return { kind: call.kind, to: call.to, device_id: call.device?.id ?? null, problem: call.problem, error_code: call.errorCode, person: call.person };
}
