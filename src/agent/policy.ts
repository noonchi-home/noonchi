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

// ── 폰으로 나가는 사람용 글: 위험 가전은 기본 거부 ─────────────────────
// 위험 가전(CONFIRM_RULES의 켜기·시작 대상: 인덕션·전자레인지)에 대한 폰 글은 서버가 정해 둔 글 틀(src/plan/labels.ts RISKY_STEP_TEXT)로만 나간다.
// 모델이 쓴 글(계획 단계 이름·명령·안전 문구·say·ask·답 단추·답 말·tell_person·ask_person·말 요청 에이전트의 답)에 위험 가전 이름이 나오거나
// 그 단계 대상이 위험 가전이면 그 글은 폰으로 보내지 않는다(서버 글로 바꾸거나 버린다). 켜는 말인지 끄는 말인지 낱말로 가르지 않는다.
// 자리 목록은 PHONE_LINE_SITES이고, tests/phone-lines.test.ts가 자리마다 본다.

/** 위험 가전 이름 표: 가전 종류 → 부르는 이름. 종류는 CONFIRM_RULES의 켜기·시작 대상과 같다(tests/policy.test.ts). */
export const RISKY_ON_NAMES: Partial<Record<DeviceKind, readonly string[]>> = {
  cooktop: ["인덕션", "전기레인지", "가스레인지", "하이라이트", "가스불", "화구", "버너", "쿡탑"],
  microwave: ["전자레인지"],
};

/** 위험 가전 종류인가. */
export const isRiskyKind = (kind: string | null | undefined): kind is DeviceKind => !!kind && Object.hasOwn(RISKY_ON_NAMES, kind);

/** 글에 나오는 위험 가전 종류(이름 표로만 본다). */
export function riskyNames(text: string): DeviceKind[] {
  return (Object.entries(RISKY_ON_NAMES) as [DeviceKind, readonly string[]][]).filter(([, names]) => names.some((n) => text.includes(n))).map(([k]) => k);
}

/** 폰으로 나가는 사람용 글이 생기는 자리. 모델이 쓴 위험 가전 글은 어느 자리에서도 나가지 않는다(tests/phone-lines.test.ts가 자리마다 본다). */
export const PHONE_LINE_SITES = [
  "step.label", "step.command", "step.caution", "say.text", "ask.question", "ask.choices.label", "ask.choices.reply",
  "observer.tell_person", "observer.ask_person", "track.tell", "track.askCloser", "agent.reply",
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
