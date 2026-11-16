// 외부 연락(call_service) 종류 표·받는 이 등록부·다시 보내기 기억과 서버 글: 실제 폰 승인 질문·답, 대시보드 말풍선 카드, 기록 DB service 줄.
// 연락은 밖으로 나가는 일이라 위험 목록처럼 늘 묻고 답 둘 다 이번만이다(src/agent/policy.ts askService).
// 받는 이는 서버에 등록한 연락처(runtime/homes/<집>/contacts.json)뿐이다. 그 종류가 등록되지 않았으면 묻지도 보내지도 않는다. 모델은 받는 이를 정하지 못한다(도구에 그 칸이 없다).
// 보내는 칸은 승인 질문에 보이는 칸뿐이다: AS센터 전화는 가전·고장 설명·에러 코드, 보호자 연락은 사람 상태. 다른 칸을 넣으면 묻지 않고 모델에게 돌려준다.
// 모델이 쓴 보낼 글에 위험 가전 이름이 있어도 돌려준다(tools.ts).
// 기록·대시보드 사본은 KEEP_HEARD_TEXT가 꺼져 있으면(기본) 받는 이·고장 설명·에러 코드·사람 상태를 남기지 않는다(들은 말·개인정보 가림).
// 다시 보내기 기억(ServiceRetryStore): 확인 불가로 끝난 연락의 id를 내용 해시로 runtime/homes/<집>/service-retry.json에 남겨, 접수가 확인될 때까지 같은 내용은 같은 id로 보낸다.
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { ServiceCall, ServiceContact, ServiceKind, ServiceOutcome, ServiceResult } from "../contract/service.js";
import { josa } from "../shared/korean.js";
import { HEARD_MARK } from "../world/labels.js";

/** 도구 이름. */
export const CALL_SERVICE = "call_service";

/** 종류마다: ask 승인 질문(받는 이 이름으로), what 일 이름(거절·취소 답·기록 줄), sent·failed·unknown 답, missing 받는 이가 등록되지 않았을 때 답. */
export const SERVICE_KINDS: Record<ServiceKind, { ask: (name: string) => string; what: string; sent: string; failed: string; unknown: string; missing: string }> = {
  as_center: {
    ask: (n) => `${n}에 전화할까요?`, what: "AS센터 전화",
    sent: "AS센터에 전화를 요청했어요.", failed: "AS센터에 전화하지 못했어요.", unknown: "AS센터 전화 요청이 접수됐는지 확인하지 못했어요.",
    missing: "AS센터 연락처가 등록되지 않았어요.",
  },
  guardian: {
    ask: (n) => `${n}에게 연락할까요?`, what: "보호자 연락",
    sent: "보호자에게 연락을 요청했어요.", failed: "보호자에게 연락하지 못했어요.", unknown: "보호자 연락 요청이 접수됐는지 확인하지 못했어요.",
    missing: "보호자 연락처가 등록되지 않았어요.",
  },
};
export const SERVICE_KIND_IDS = Object.keys(SERVICE_KINDS) as [ServiceKind, ...ServiceKind[]];

/** CALL_SERVICE_URL이 없을 때 실제 폰 답·말풍선 카드 글. */
export const SERVICE_UNCONNECTED = "전화 서비스가 아직 연결되지 않았어요.";

/** 받는 이가 등록되지 않은 종류의 답(이 글이 도구 오류면 실제 폰 답도 이 글이다). */
export const SERVICE_MISSING: ReadonlySet<string> = new Set(SERVICE_KIND_IDS.map((k) => SERVICE_KINDS[k].missing));

const OUTCOME_TEXT: Record<ServiceOutcome, string> = { sent: "보냄", refused: "거절", unconnected: "연결 없음", failed: "실패", unknown: "확인 불가" };

// ── 받는 이 등록부 ─────────────────────────────────────────

/** 종류마다 등록한 받는 이. 없는 종류는 연락하지 않는다. */
export type ServiceContacts = Partial<Record<ServiceKind, ServiceContact>>;

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

/** 등록부를 읽는다. 파일이 없으면 등록 없음. 깨졌거나 모양이 틀린 칸은 등록이 없는 것으로 두고 warning에 까닭을 적는다(받는 이를 짐작하지 않는다). */
export function loadContacts(path: string): { contacts: ServiceContacts; warning?: string } {
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, "utf8").replace(/^﻿/, ""));
  } catch (e) {
    if ((e as { code?: string }).code === "ENOENT") return { contacts: {} };
    return { contacts: {}, warning: `${path}을 읽지 못해 외부 연락 받는 이가 없습니다: ${(e as Error).message}` };
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { contacts: {}, warning: `${path}이 JSON 객체가 아니라 외부 연락 받는 이가 없습니다` };
  const obj = raw as Record<string, unknown>;
  const bad: ServiceKind[] = [];
  const contacts: ServiceContacts = {};
  for (const k of SERVICE_KIND_IDS) {
    if (obj[k] === undefined) continue;
    const c = contactOf(obj[k]);
    if (c) contacts[k] = c;
    else bad.push(k);
  }
  return bad.length ? { contacts, warning: `${path}의 ${bad.join("·")} 칸이 틀려(이름 ${NAME_MAX}자까지, 번호는 숫자·+·-) 그 연락은 하지 않습니다` } : { contacts };
}

// ── 글 ─────────────────────────────────────────────────

/** 끝의 마침표·빈칸을 뗀 글. */
const bare = (t: string) => t.replace(/[\s.。!?]+$/u, "");

/** 실제 폰 승인 질문: 보낼 내용과 받는 이(「탈수할 때 멈춤 · 에러 UE. LG전자 서비스센터에 전화할까요?」). 가전 이름은 승인 칸의 기기 자리에 따로 보인다.
 *  보내는 칸(serviceCall이 종류마다 받는 칸)이 모두 여기에 보인다. */
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

/** 도구 인자 + 등록 받는 이 → 연락. 모자라거나 승인 질문에 보이지 않을 칸이 있으면 까닭 글:
 *  AS센터 전화는 가전(device_id)이나 고장 설명(problem)이 있어야 하고 사람 상태(person)는 받지 않는다. 보호자 연락은 사람 상태(person)만 받는다. */
export function serviceCall(
  args: { kind: ServiceKind; problem?: string; error_code?: string; person?: string },
  device: ServiceCall["device"], to: ServiceContact,
): ServiceCall | string {
  const text = (v: string | undefined) => (v?.trim() ? v.trim() : null);
  const call: ServiceCall = { kind: args.kind, to, device, problem: text(args.problem), errorCode: text(args.error_code), person: text(args.person) };
  if (call.kind === "as_center" && call.person) return "AS센터 전화에는 person을 넣지 않습니다. 가전(device_id)·고장 설명(problem)·에러 코드(error_code)만 보냅니다.";
  if (call.kind === "guardian" && (call.device || call.problem || call.errorCode)) return "보호자 연락에는 person만 넣습니다. 가전·고장 설명·에러 코드는 보내지 않습니다.";
  if (call.kind === "as_center" && !call.device && !call.problem) return "AS센터 전화에는 고장 난 가전(device_id)이나 고장 설명(problem)이 필요합니다. 사용자에게 무엇이 고장 났는지 물으세요.";
  if (call.kind === "guardian" && !call.person) return "보호자 연락에는 사람 상태 요약(person)이 필요합니다. 어떤 상황인지 한 문장으로 넣으세요.";
  return call;
}

/** 대시보드 사본에서 가릴 글: 받는 이 이름·번호, 고장 설명·에러 코드·사람 상태, 그것이 든 승인 질문. */
export const serviceSecrets = (call: ServiceCall): string[] =>
  [serviceAsk(call), call.problem, call.errorCode, call.person, call.to.name, call.to.phone].filter((x): x is string => !!x);

/** 기록·행동 인자로 남기는 연락 모양(도구 인자와 같은 이름). */
export function serviceArgs(call: ServiceCall): Record<string, unknown> {
  return { kind: call.kind, to: call.to.name, device_id: call.device?.id ?? null, problem: call.problem, error_code: call.errorCode, person: call.person };
}

// ── 다시 보내기 기억 ───────────────────────────────────────

/** 확인 불가 뒤 같은 내용의 연락을 같은 id로 다시 보내는 기간(마지막 확인 불가부터). */
export const SERVICE_RETRY_MS = 30 * 60 * 1000;

/** 기억 파일 자리(승인 기억 approvals.json 옆). */
export const serviceRetryPath = (runtimeDir: string, homeId: string) => join(runtimeDir, "homes", homeId, "service-retry.json");

/** 같은 연락인지 가르는 열쇠: 종류·받는 이·가전·고장 설명·에러 코드·사람 상태의 해시(내용 글은 파일에 쓰지 않는다). */
const retryKey = (call: ServiceCall) =>
  createHash("sha256").update(JSON.stringify([call.kind, call.to.name, call.to.phone, call.device?.id ?? null, call.problem, call.errorCode, call.person])).digest("hex");

/** 다시 보내기 기억: 확인 불가인 연락의 id. 접수(2xx)가 확인돼야 잊는다. */
export interface ServiceRetryBook {
  /** 같은 내용의 앞 연락이 확인 불가로 남아 있으면 그 id. */
  idFor(call: ServiceCall): string | null;
  /** 확인 불가로 끝났다(그 id를 남기고 기간을 새로 센다). */
  unsure(call: ServiceCall, id: string): void;
  /** 접수가 확인됐다(잊는다). */
  settled(call: ServiceCall): void;
}

type RetryFile = Record<string, { id: string; at_ms: number }>;

function readRetry(path: string): RetryFile {
  try {
    const raw = JSON.parse(readFileSync(path, "utf8")) as unknown;
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
    return Object.fromEntries(Object.entries(raw as Record<string, unknown>).flatMap(([k, v]) => {
      const e = v as { id?: unknown; at_ms?: unknown } | null;
      return e && typeof e.id === "string" && typeof e.at_ms === "number" ? [[k, { id: e.id, at_ms: e.at_ms }]] : [];
    }));
  } catch {
    return {};
  }
}

/** 파일(path, null이면 이 프로세스 안에서만)에 남는 다시 보내기 기억. SERVICE_RETRY_MS가 지난 것은 잊는다. 임시 파일에 쓴 뒤 이름을 바꾼다. */
export class ServiceRetryStore implements ServiceRetryBook {
  private readonly mem: RetryFile;

  constructor(private readonly path: string | null, private readonly now: () => number = () => Date.now()) {
    this.mem = path ? readRetry(path) : {};
  }

  idFor(call: ServiceCall): string | null {
    this.prune();
    return this.mem[retryKey(call)]?.id ?? null;
  }

  unsure(call: ServiceCall, id: string): void {
    this.prune();
    this.mem[retryKey(call)] = { id, at_ms: this.now() };
    this.save();
  }

  settled(call: ServiceCall): void {
    const key = retryKey(call);
    if (!Object.hasOwn(this.mem, key)) return;
    delete this.mem[key];
    this.save();
  }

  private prune(): void {
    const t = this.now();
    let gone = false;
    for (const [k, v] of Object.entries(this.mem)) {
      if (t - v.at_ms <= SERVICE_RETRY_MS) continue;
      delete this.mem[k];
      gone = true;
    }
    if (gone) this.save();
  }

  private save(): void {
    if (!this.path) return;
    mkdirSync(dirname(this.path), { recursive: true });
    const tmp = `${this.path}.${process.pid}.tmp`;
    writeFileSync(tmp, `${JSON.stringify(this.mem, null, 2)}\n`);
    renameSync(tmp, this.path);
  }
}
