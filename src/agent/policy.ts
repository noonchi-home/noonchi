// 승인 정책(src/agent/approval.ts 규칙): 가전 명령은 말로 시킨 것이라 그 말이 승인이다. 위험 목록(현관 잠금 해제, 인덕션 켜기, 전자레인지 시작)만
// 승인 토큰이 있어야 실행하고 늘 묻는다. 위험 목록의 답(승인·거절)은 둘 다 이번만이라 승인 기억에 남기지 않는다.

import { randomUUID } from "node:crypto";
import { isUnknown } from "../hub/signals.js";
import type { Command, CommandResult, CommandType, DeviceHub, DeviceKind, DeviceSpec } from "../hub/types.js";
import { KINDS, KIND_ORDER, isRiskyKind } from "../model/kinds.js";
import { checkCommand, normalizeCommand } from "../model/mapping.js";
import { DEVICE_VERB, STEP_LABEL } from "../plan/labels.js";
import { approvalNeed, deviceKey, memoryApprovals, type ApprovalBook } from "./approval.js";
import { josa, toolForCommand } from "./phrases.js";

export interface ConfirmRule {
  kind: DeviceKind;
  command: CommandType; // 정규화된 명령 기준(전자레인지 on → start)
  reason: (label: string) => string;
}

/** 늘 승인을 묻는 명령(등록부 confirm, 등록부의 목록 순서). */
export const CONFIRM_RULES: ConfirmRule[] = KIND_ORDER
  .flatMap((k) => { const c = KINDS[k].confirm; return c ? [{ kind: k, command: c.command, reason: c.reason, order: c.order }] : []; })
  .sort((a, b) => a.order - b.order)
  .map(({ kind, command, reason }) => ({ kind, command, reason }));

// ── 폰으로 나가는 사람용 글: 위험 가전은 기본 거부 ─────────────────────
// 사람 단계(go·pick·place·do)의 이름·명령·안전 문구는 모델이 고른 동작·대상·물건으로 서버가 만든다(src/plan/labels.ts STEP_TEXT). 모델 문장은 받지 않는다.
// 알림(say)·기다리기 이름은 열쇠(notice), 질문의 답 단추·답 말은 답 묶음으로 서버가 정한다.
// 관찰 모드의 다시 알리기·사람 부탁은 방식·가까이 볼 곳만 고르고 실행 추적이 서버 글로 보낸다(src/plan/labels.ts TELL_TEXT·CLOSER_TEXT).
// 모델이 쓰는 글은 질문과 말 요청 에이전트의 답뿐이고, 거기에 위험 가전(인덕션·전자레인지) 이름이 나오면 폰으로 보내지 않는다(버리거나 고정 글로 바꾼다).
// 켜는 말인지 끄는 말인지 낱말로 가르지 않는다.
// 자리 목록은 PHONE_LINE_SITES이고, tests/phone-lines.test.ts가 자리마다 본다.
// 한계: 이름 표(별명·흔한 오타 포함)로만 본다. 이름 없이 조작만 말하는 글(예: 「전원 버튼을 눌러 주세요」)은 질문·에이전트 답에서 막지 못한다.

/** 위험 가전 이름 표(등록부 riskyOn.names): 가전 종류 → 부르는 이름(별명·흔한 오타·영어 포함). 종류는 CONFIRM_RULES의 켜기·시작 대상과 같다(tests/policy.test.ts).
 *  세 글자 이상인 이름은 띄어 써도 찾는다. 「레인지」만 쓰면 전자레인지로 본다(가스레인지·전기레인지는 긴 이름이 먼저 맞는다). */
export const RISKY_ON_NAMES: Partial<Record<DeviceKind, readonly string[]>> = Object.fromEntries(
  KIND_ORDER.flatMap((k) => { const r = KINDS[k].riskyOn; return r ? [[k, r.names]] : []; }),
);
/** 위험 가전이 아닌데 위험 가전 이름을 품은 이름(먼저 지운다). */
const NOT_RISKY = ["레인지후드"];

/** 위험 가전 종류인가(등록부 riskyOn). */
export { isRiskyKind };

/** 이름 → 종류(위험 가전이 아닌 이름은 null), 긴 이름부터. */
const NAME_ORDER: [string, DeviceKind | null][] = [
  ...(Object.entries(RISKY_ON_NAMES) as [DeviceKind, readonly string[]][]).flatMap(([k, names]) => names.map((n): [string, DeviceKind | null] => [n.toLowerCase(), k])),
  ...NOT_RISKY.map((n): [string, DeviceKind | null] => [n, null]),
].sort((a, b) => b[0].length - a[0].length);

/** 글에 나오는 위험 가전 종류(이름 표로만 본다). 긴 이름부터 맞추고 맞춘 자리는 지워 짧은 이름이 그 안에서 다시 맞지 않게 한다. */
export function riskyNames(text: string): DeviceKind[] {
  const raw = text.toLowerCase();
  let flat = raw.replace(/\s+/g, "");
  const kinds = new Set<DeviceKind>();
  for (const [name, kind] of NAME_ORDER) {
    // 세 글자 이상은 띄어 쓴 것도 찾게 빈칸을 뺀 글에서, 두 글자(화구·버너)는 띄어 쓴 낱말 사이에서 잘못 맞지 않게 원래 글에서 찾는다
    if (name.length >= 3) {
      if (!flat.includes(name)) continue;
      flat = flat.split(name).join("\u0000");
    } else if (!raw.includes(name)) continue;
    if (kind) kinds.add(kind);
  }
  return (Object.keys(RISKY_ON_NAMES) as DeviceKind[]).filter((k) => kinds.has(k));
}

/** 폰으로 나가는 사람용 글이 생기는 자리. 모델이 쓴 위험 가전 글은 어느 자리에서도 나가지 않는다(tests/phone-lines.test.ts가 자리마다 본다). */
export const PHONE_LINE_SITES = [
  "ask.question", "agent.reply",
] as const;

/** 모델이 쓴 글에 위험 가전 이름이 나와 버릴 때의 까닭(계획 검사·관찰 모드가 모델에게 돌려준다). */
export const RISKY_NAME_PROBLEM = "인덕션·전자레인지 같은 위험 가전 이름은 쓰지 않습니다. 그 가전을 target으로 하는 go·pick·place와 hand_device가 있는 do는 서버가 글을 정합니다";

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
