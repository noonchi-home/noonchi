// 외부 연락(call_service) 종류 표·받는 이 등록부와 서버 글: 실제 폰 승인 질문·답, 대시보드 말풍선 카드, 기록 DB service 줄.
// 연락은 밖으로 나가는 일이라 위험 목록처럼 늘 묻고 답 둘 다 이번만이다(src/agent/policy.ts askService).
// 받는 이는 서버에 등록한 연락처(runtime/homes/<집>/contacts.json)뿐이다. 모델은 받는 이를 정하지 못한다(도구에 그 칸이 없다).
// 승인 질문에는 보낼 내용(고장 설명·에러 코드, 사람 상태)과 받는 이 이름이 그대로 보인다. 모델이 쓴 그 글에 위험 가전 이름이 있으면 묻지 않고 모델에게 돌려준다(tools.ts).
// 기록은 KEEP_HEARD_TEXT가 꺼져 있으면(기본) 받는 이·고장 설명·에러 코드·사람 상태를 남기지 않는다(들은 말·개인정보 가림).
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { ServiceCall, ServiceContact, ServiceKind, ServiceOutcome, ServiceResult } from "../contract/service.js";
import { josa } from "../shared/korean.js";
import { HEARD_MARK } from "../world/labels.js";

/** 도구 이름. */
export const CALL_SERVICE = "call_service";

/** 종류마다: to 등록이 없을 때 받는 이 이름, ask 승인 질문(받는 이 이름으로), what 일 이름(거절·취소 답·기록 줄), sent·failed·unknown 답. */
export const SERVICE_KINDS: Record<ServiceKind, { to: string; ask: (name: string) => string; what: string; sent: string; failed: string; unknown: string }> = {
  as_center: {
    to: "AS센터", ask: (n) => `${n}에 전화할까요?`, what: "AS센터 전화",
    sent: "AS센터에 전화를 요청했어요.", failed: "AS센터에 전화하지 못했어요.", unknown: "AS센터 전화 요청이 접수됐는지 확인하지 못했어요.",
  },
  guardian: {
    to: "보호자", ask: (n) => `${n}에게 연락할까요?`, what: "보호자 연락",
    sent: "보호자에게 연락을 요청했어요.", failed: "보호자에게 연락하지 못했어요.", unknown: "보호자 연락 요청이 접수됐는지 확인하지 못했어요.",
  },
};
export const SERVICE_KIND_IDS = Object.keys(SERVICE_KINDS) as [ServiceKind, ...ServiceKind[]];

/** CALL_SERVICE_URL이 없을 때 실제 폰 답·말풍선 카드 글. */
export const SERVICE_UNCONNECTED = "전화 서비스가 아직 연결되지 않았어요.";

const OUTCOME_TEXT: Record<ServiceOutcome, string> = { sent: "보냄", refused: "거절", unconnected: "연결 없음", failed: "실패", unknown: "확인 불가" };

// ── 받는 이 등록부 ─────────────────────────────────────────

/** 종류마다 받는 이. */
export type ServiceContacts = Record<ServiceKind, ServiceContact>;

/** 등록이 없을 때: 종류 이름, 번호 없음(전화 서비스가 정한다). */
export const DEFAULT_CONTACTS: ServiceContacts = Object.fromEntries(SERVICE_KIND_IDS.map((k) => [k, { name: SERVICE_KINDS[k].to, phone: null }])) as ServiceContacts;

/** 등록부 자리(커밋하지 않는 runtime 아래, 승인 기억 approvals.json 옆). */
export const contactsPath = (runtimeDir: string, homeId: string) => join(runtimeDir, "homes", homeId, "contacts.json");

const NAME_MAX = 40;
const PHONE = /^\+?[0-9][0-9 -]{2,19}$/;

function contactOf(v: unknown): ServiceContact | null {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  const { name, phone } = v as { name?: unknown; phone?: unknown };
  if (typeof name !== "string" || !name.trim() || name.trim().length > NAME_MAX) return null;
  if (phone !== undefined && phone !== null && (typeof phone !== "string" || !PHONE.test(phone.trim()))) return null;
  return { name: name.trim(), phone: typeof phone === "string" ? phone.trim() : null };
}

/** 등록부를 읽는다. 파일이 없으면 종류 이름. 깨졌거나 모양이 틀린 칸은 종류 이름으로 두고 warning에 까닭을 적는다(받는 이를 짐작하지 않는다). */
export function loadContacts(path: string): { contacts: ServiceContacts; warning?: string } {
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, "utf8").replace(/^﻿/, ""));
  } catch (e) {
    if ((e as { code?: string }).code === "ENOENT") return { contacts: { ...DEFAULT_CONTACTS } };
    return { contacts: { ...DEFAULT_CONTACTS }, warning: `${path}을 읽지 못해 받는 이를 종류 이름(AS센터·보호자)으로 둡니다: ${(e as Error).message}` };
  }
  const obj = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const bad: ServiceKind[] = [];
  const contacts = Object.fromEntries(SERVICE_KIND_IDS.map((k) => {
    if (obj[k] === undefined) return [k, DEFAULT_CONTACTS[k]];
    const c = contactOf(obj[k]);
    if (!c) bad.push(k);
    return [k, c ?? DEFAULT_CONTACTS[k]];
  })) as ServiceContacts;
  if (raw !== obj) return { contacts, warning: `${path}이 JSON 객체가 아니라 받는 이를 종류 이름으로 둡니다` };
  return bad.length ? { contacts, warning: `${path}의 ${bad.join("·")} 칸이 틀려(이름 ${NAME_MAX}자까지, 번호는 숫자·+·-) 종류 이름으로 둡니다` } : { contacts };
}

// ── 글 ─────────────────────────────────────────────────

/** 끝의 마침표·빈칸을 뗀 글. */
const bare = (t: string) => t.replace(/[\s.。!?]+$/u, "");

/** 실제 폰 승인 질문: 보낼 내용과 받는 이(「탈수할 때 멈춤 · 에러 UE. LG전자 서비스센터에 전화할까요?」). 가전 이름은 승인 칸의 기기 자리에 따로 보인다. */
export function serviceAsk(call: ServiceCall): string {
  const what = call.kind === "as_center"
    ? [call.problem ? bare(call.problem) : null, call.errorCode ? `에러 ${call.errorCode}` : null].filter((x): x is string => !!x).join(" · ")
    : call.person ? bare(call.person) : "";
  const ask = SERVICE_KINDS[call.kind].ask(call.to.name);
  return what ? `${what}. ${ask}` : ask;
}

/** 승인한 뒤의 답(보냄·연결 없음·실패·확인 불가). 거절은 REFUSED_REPLY(일 이름)이다. */
export function serviceReply(kind: ServiceKind, outcome: Exclude<ServiceOutcome, "refused">): string {
  return outcome === "unconnected" ? SERVICE_UNCONNECTED : SERVICE_KINDS[kind][outcome];
}

/** 취소 답: 「AS센터 전화를 취소했어요.」. */
export const serviceCancelled = (kind: ServiceKind) => `${josa(SERVICE_KINDS[kind].what, "을/를")} 취소했어요.`;

/** 기록 DB service 줄: 글은 「세탁기 AS센터 전화 · 보냄」(가전 이름은 등록부 이름, 없으면 일 이름만).
 *  keep(KEEP_HEARD_TEXT=1)이 아니면 받는 이·고장 설명·에러 코드·사람 상태를 빼고 detail에 들은 말 표시만 둔다(거절도 같다). */
export function serviceRecord(r: ServiceResult, keep: boolean): { text: string; subject?: string; data: Record<string, unknown> } {
  const what = SERVICE_KINDS[r.call.kind].what;
  const base = { id: r.id, kind: r.call.kind, outcome: r.outcome, device: r.call.device };
  const detail = keep ? { to: r.call.to, problem: r.call.problem, error_code: r.call.errorCode, person: r.call.person } : { detail: HEARD_MARK };
  return {
    text: `${r.call.device ? `${r.call.device.label} ${what}` : what} · ${OUTCOME_TEXT[r.outcome]}`,
    ...(r.call.device ? { subject: r.call.device.id } : {}),
    data: { ...base, ...detail, ...(r.error ? { error: r.error } : {}) },
  };
}

/** 대시보드 말풍선 카드 글. 거절은 승인 답이라 대시보드에 보이지 않는다(null). */
export function serviceSay(r: ServiceResult): string | null {
  return r.outcome === "refused" ? null : serviceReply(r.call.kind, r.outcome);
}

/** 보낼 글(승인 질문에 그대로 보인다)에 위험 가전 이름이 있을 때 모델에게 돌려주는 까닭(src/agent/tools.ts가 riskyNames로 본다). */
export const SERVICE_RISKY_PROBLEM = "고장 설명·사람 상태에 인덕션·전자레인지 같은 위험 가전 이름은 쓰지 않습니다. 가전은 device_id로 정하고 설명에는 증상만 씁니다.";

/** 모델이 쓴 보낼 글(고장 설명·에러 코드·사람 상태). */
export const serviceText = (call: ServiceCall) => [call.problem, call.errorCode, call.person].filter(Boolean).join(" ");

/** 도구 인자 + 등록 받는 이 → 연락. 모자라면 까닭 글: AS센터 전화는 가전(device_id)이나 고장 설명(problem), 보호자 연락은 사람 상태(person)가 있어야 한다. */
export function serviceCall(
  args: { kind: ServiceKind; problem?: string; error_code?: string; person?: string },
  device: ServiceCall["device"], to: ServiceContact,
): ServiceCall | string {
  const text = (v: string | undefined) => (v?.trim() ? v.trim() : null);
  const call: ServiceCall = { kind: args.kind, to, device, problem: text(args.problem), errorCode: text(args.error_code), person: text(args.person) };
  if (call.kind === "as_center" && !call.device && !call.problem) return "AS센터 전화에는 고장 난 가전(device_id)이나 고장 설명(problem)이 필요합니다. 사용자에게 무엇이 고장 났는지 물으세요.";
  if (call.kind === "guardian" && !call.person) return "보호자 연락에는 사람 상태 요약(person)이 필요합니다. 어떤 상황인지 한 문장으로 넣으세요.";
  return call;
}

/** 같은 연락인지 가르는 열쇠(확인 불가 뒤 다시 보낼 때 같은 id를 쓴다): 종류와 가전. */
export const serviceKey = (call: ServiceCall) => `${call.kind}:${call.device?.id ?? ""}`;

/** 기록·행동 인자로 남기는 연락 모양(도구 인자와 같은 이름). */
export function serviceArgs(call: ServiceCall): Record<string, unknown> {
  return { kind: call.kind, to: call.to.name, device_id: call.device?.id ?? null, problem: call.problem, error_code: call.errorCode, person: call.person };
}
