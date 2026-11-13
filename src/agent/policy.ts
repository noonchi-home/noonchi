// 승인 정책(src/agent/approval.ts 규칙): 가전 명령은 말로 시킨 것이라 그 말이 승인이다. 위험 목록(현관 잠금 해제, 인덕션 켜기, 전자레인지 시작)만
// 승인 토큰이 있어야 실행하고 늘 묻는다. 위험 목록의 답(승인·거절)은 둘 다 이번만이라 승인 기억에 남기지 않는다.

import { randomUUID } from "node:crypto";
import { isUnknown } from "../hub/signals.js";
import type { Command, CommandResult, CommandType, DeviceHub, DeviceKind, DeviceSpec } from "../hub/types.js";
import { checkCommand, normalizeCommand } from "../model/mapping.js";
import { DEVICE_VERB, STEP_LABEL } from "../plan/labels.js";
import { approvalNeed, deviceKey, memoryApprovals, type ApprovalBook } from "./approval.js";
import { josa, toolForCommand } from "./phrases.js";

export interface ConfirmRule {
  kind: DeviceKind;
  command: CommandType; // 정규화된 명령 기준(전자레인지 on → start)
  reason: (label: string) => string;
}

export const CONFIRM_RULES: ConfirmRule[] = [
  { kind: "lock", command: "unlock", reason: (l) => `${l} 잠금 해제는 사용자 승인이 필요합니다.` },
  { kind: "cooktop", command: "on", reason: (l) => `${l} 켜기는 화재 위험이 있어 사용자 승인이 필요합니다.` },
  { kind: "microwave", command: "start", reason: (l) => `${l} 시작은 사용자 승인이 필요합니다.` },
];

// ── 폰으로 나가는 사람용 글 거르기 ─────────────────────────────
// 위험 가전(CONFIRM_RULES의 켜기·시작 대상) 조작은 「그 가전의 hand_device가 붙은 do 단계」에서만 나간다. 실행 추적은 그 단계에서만 켜기 전에 묻고,
// 켠 가전을 기억해 끄기 단계·끄기 안내를 챙긴다. 그래서 그 밖의 자리(PHONE_LINE_SITES)에서는 위험 가전을 켜거나 조작하라는 글이 나가지 않게 한 함수(phoneLineProblem)로 거른다.
// 위험 가전 이름이 나오거나 대상이 위험 가전인 글은 켜기가 아님이 분명한 말(허용 목록 SAFE_WORDS: 가·올려·내려·닦아·넣어·꺼내·열어·기다려·켜지 마…)이나 끄는 말만
// 통과하고, 켜는 말·조작하는 말(전원·버튼·누르기·작동·화력…)이나 모르는 말은 켜기로 본다. 낱말은 아래 표에만 둔다.

/** 위험 가전 낱말 표: 가전 종류 → 부르는 이름. 종류는 CONFIRM_RULES의 켜기·시작 대상과 같다(tests/policy.test.ts). */
export const RISKY_ON_NAMES: Partial<Record<DeviceKind, readonly string[]>> = {
  cooktop: ["인덕션", "전기레인지", "가스레인지", "하이라이트", "가스불", "화구", "버너", "쿡탑"],
  microwave: ["전자레인지"],
};
/** 켜는 말. */
const ON_WORDS = /켜|켤|켭|틀어|점화|가열해|가열하|돌려|돌리|시작해\s*(주|줘|요)|시작\s*버튼/;
/** 조작하는 말: 켜는 것일 수 있다(끄는 말과 함께면 끄기). */
const OP_VERBS = /누르|눌러|눌|세게|불\s*(을|를)?\s*(올|높|세)|설정|조절|맞춰|맞추|높여|높이|작동|만져|만지|써\s*주|사용해/;
/** 조작하는 곳: 켜지 말라는 말과 함께가 아니면 켜기로 본다. */
const OP_NOUNS = /전원|버튼|스위치|다이얼|화력|세기|온도|타이머/;
/** 끄는 말. 「꺼내」는 아니다. */
const OFF_WORDS = /꺼\s*(주|줘|요|두|놓|$)|꺼지|꺼져|끄|끈|끌|끕/;
/** 켜기가 아님이 분명한 말(허용 목록). */
const SAFE_WORDS = /가\s*주세요|가\s*줘|(으로|로)\s*가|가기|와\s*주세요|올려|올리|내려|내리|닦|치워|치우|넣어|넣고|넣기|꺼내|열어|열고|닫아|닫고|확인|기다려|기다리|지켜|살펴|놓아|놓고|놓기|두어|둬|뜨거워|뜨겁|식혀|식으|조심/;
/** 켜지(누르지) 말라는 말: 그 부분은 빼고 보고, 남은 말에 켜는 말이 없으면 켜기가 아니다. */
const NOT_ON = /(켜|켤|틀|돌리|시작하|작동시키|누르|눌|만지)지\s*(마|말|않)|(켜|틀|돌리|누르)면\s*안/g;

/** 위험 가전에 닿는 글의 쓰임: 닿는 가전 종류(글의 이름, 없으면 대상)와 켜기(on, 조작·모르는 말 포함)·끄기(off)·켜기가 아님(safe). 닿지 않으면 null. */
export function riskyUse(text: string, targetKind?: string | null): { kinds: DeviceKind[]; use: "on" | "off" | "safe" } | null {
  const named = (Object.entries(RISKY_ON_NAMES) as [DeviceKind, readonly string[]][]).filter(([, names]) => names.some((n) => text.includes(n))).map(([k]) => k);
  const kinds = named.length ? named : targetKind && Object.hasOwn(RISKY_ON_NAMES, targetKind) ? [targetKind as DeviceKind] : [];
  if (!kinds.length) return null;
  const t = text.replace(NOT_ON, " ");
  const negated = t !== text;
  if (ON_WORDS.test(t)) return { kinds, use: "on" };
  if (OP_VERBS.test(t)) return { kinds, use: OFF_WORDS.test(t) ? "off" : "on" };
  if (OFF_WORDS.test(t)) return { kinds, use: "off" };
  if (OP_NOUNS.test(t) && !negated) return { kinds, use: "on" };
  return { kinds, use: SAFE_WORDS.test(t) || negated ? "safe" : "on" };
}

/** 폰으로 나가는 사람용 글이 생기는 자리. 모두 phoneLineProblem 하나로 거른다(tests/phone-lines.test.ts가 자리마다 본다). */
export const PHONE_LINE_SITES = [
  "step.label", "step.command", "step.caution", "say.text", "ask.question", "ask.choices.label", "ask.choices.reply",
  "observer.tell_person", "observer.ask_person", "track.tell", "track.askCloser", "agent.reply",
] as const;

/** 글이 놓이는 자리: 단계 대상(평면도·가전 id와 그 가전 종류), 그 단계의 손으로 다루는 가전(hand_device, 이 집 가전 종류). */
export interface LineContext { targetId?: string | null; targetKind?: string | null; hand?: { id: string; kind: string | null; to: "on" | "off" } | null }

/** 폰으로 나가는 사람용 글을 거른다: 위험 가전을 켜거나 조작하라는 글이 그 가전의 hand_device(to on)가 붙은 단계 밖에서 나가거나,
 *  글·대상이 가리키는 위험 가전과 hand_device 가전이 다르면 까닭, 아니면 null. */
export function phoneLineProblem(text: string, o: LineContext = {}): string | null {
  const u = riskyUse(text, o.targetKind);
  if (!u) return null;
  const hand = o.hand;
  const targetRisky = !!o.targetKind && Object.hasOwn(RISKY_ON_NAMES, o.targetKind);
  if (hand && (u.kinds.some((k) => k !== hand.kind) || (targetRisky && o.targetId && o.targetId !== hand.id))) {
    return "글·대상이 가리키는 위험 가전과 hand_device 가전이 다릅니다";
  }
  if (u.use === "on" && hand?.to !== "on") return "위험 가전을 켜라는 말(전원·버튼 같은 조작 포함)은 그 가전의 hand_device(to on)가 있는 do 단계에서만 씁니다";
  return null;
}

/** 말 요청 에이전트의 답이 걸렸을 때 대신 읽는 한 줄. */
export const RISKY_REPLY = "불이나 열이 나는 가전은 폰에서 승인한 뒤에만 켜요.";

/** 승인 대기에 「거절」로 답했을 때의 답. what: 「현관문 잠금 풀기」. */
export const REFUSED_REPLY = (what: string) => `${josa(what, "은/는")} 하지 않을게요.`;

/** 명령 이름: 「거실 천장등 켜기」. */
export function commandName(label: string, cmd: Command): string {
  return STEP_LABEL.device(label, DEVICE_VERB[toolForCommand(cmd)] ?? "");
}

export interface PendingConfirmation {
  token: string;
  deviceId: string;
  command: Command; // 정규화된 명령
  reason: string;
  expiresAt: number; // epoch ms
}

export interface PolicyOptions {
  ttlMs?: number;
  now?: () => number;
  /** 승인 기억(src/server/home.ts가 runtime/homes/<집>/approvals.json으로 만든다). 없으면 이 프로세스 안에서만 기억한다. 실행 추적과 같은 기억을 쓴다. */
  approvals?: ApprovalBook;
}

export const CONFIRM_TTL_MS = 5 * 60 * 1000;

const TOKEN_MISSING = "승인 토큰이 없거나 만료되었습니다.";
const TOKEN_MISMATCH = "승인 토큰이 이 기기·명령과 맞지 않습니다.";

function stable(v: unknown): string {
  if (v && typeof v === "object" && !Array.isArray(v)) {
    const o = v as Record<string, unknown>;
    return `{${Object.keys(o).filter((k) => o[k] !== undefined).sort().map((k) => `${JSON.stringify(k)}:${stable(o[k])}`).join(",")}}`;
  }
  return JSON.stringify(v);
}

export class Policy {
  private readonly tokens = new Map<string, PendingConfirmation>();
  private readonly ttlMs: number;
  private readonly now: () => number;
  readonly approvals: ApprovalBook;

  constructor(opts: PolicyOptions = {}) {
    this.ttlMs = opts.ttlMs ?? CONFIRM_TTL_MS;
    this.now = opts.now ?? Date.now;
    this.approvals = opts.approvals ?? memoryApprovals();
  }

  /** 위험 목록 명령이면 한국어 이유, 아니면 null. */
  requiresConfirmation(device: Pick<DeviceSpec, "kind" | "label" | "capabilities">, cmd: Command): string | null {
    const c = normalizeCommand(device, cmd);
    const rule = CONFIRM_RULES.find((r) => r.kind === device.kind && r.command === c.type);
    return rule ? rule.reason(device.label) : null;
  }

  issue(deviceId: string, cmd: Command, reason: string): PendingConfirmation {
    this.purge();
    const p: PendingConfirmation = { token: randomUUID(), deviceId, command: structuredClone(cmd), reason, expiresAt: this.now() + this.ttlMs };
    this.tokens.set(p.token, p);
    return structuredClone(p);
  }

  /** 토큰을 꺼내 지운다. 없거나 만료면 undefined. */
  consume(token: string): PendingConfirmation | undefined {
    const p = this.peek(token);
    if (p) this.tokens.delete(token);
    return p;
  }

  /** 만료되지 않은 대기 목록. */
  pending(): PendingConfirmation[] {
    this.purge();
    return [...this.tokens.values()].map((p) => structuredClone(p));
  }

  /** 정책을 거쳐 명령한다(말로 시킨 명령). 승인이 필요하면 needsConfirmation(토큰)을 돌려주고 실행하지 않는다. */
  async guard(hub: DeviceHub, id: string, cmd: Command, confirmToken?: string): Promise<CommandResult> {
    const spec = hub.list().find((d) => d.id === id);
    if (!spec) return { ok: false, error: `기기를 찾을 수 없습니다: ${id}` };
    const c = normalizeCommand(spec, cmd);
    const state = hub.get(id);
    // 상태를 모르면 상태에 기대는 사전 검사는 건너뛴다. 실행할 수 있는지는 안쪽 허브가 실제 상태로 다시 본다
    const invalid = checkCommand(spec, c, isUnknown(state) ? undefined : state);
    if (invalid) return { ok: false, error: invalid, state };
    const risky = this.requiresConfirmation(spec, c);
    // 말로 시킨 명령이라 위험 목록만 묻는다(approvalNeed)
    const need = approvalNeed({ key: deviceKey(id, c.type), risky: risky !== null, requested: true, memory: this.approvals.memory() });
    if (!need || risky === null) return hub.command(id, c);
    const reason = risky;

    if (confirmToken !== undefined) {
      const p = this.peek(confirmToken);
      if (p && p.deviceId === id && stable(p.command) === stable(c)) {
        this.tokens.delete(confirmToken);
        return hub.command(id, c);
      }
      return this.ask(id, c, reason, state, p ? TOKEN_MISMATCH : TOKEN_MISSING);
    }
    return this.ask(id, c, reason, state, reason);
  }

  /** 「승인」: 토큰만으로 대기 중인 명령을 실행한다(POST /api/agent/confirm, 실제 폰 답 단추). 위험 목록이라 기억하지 않는다. */
  async confirm(hub: DeviceHub, token: string): Promise<CommandResult> {
    const p = this.consume(token);
    if (!p) return { ok: false, error: TOKEN_MISSING };
    return hub.command(p.deviceId, p.command);
  }

  private ask(id: string, cmd: Command, reason: string, state: CommandResult["state"], error: string): CommandResult {
    const p = this.issue(id, cmd, reason);
    return { ok: false, error, state, needsConfirmation: { token: p.token, reason } };
  }

  private peek(token: string): PendingConfirmation | undefined {
    const p = this.tokens.get(token);
    if (!p) return undefined;
    if (this.now() >= p.expiresAt) {
      this.tokens.delete(token);
      return undefined;
    }
    return structuredClone(p);
  }

  private purge(): void {
    const now = this.now();
    for (const [t, p] of this.tokens) if (now >= p.expiresAt) this.tokens.delete(t);
  }
}
