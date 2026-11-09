// 승인 정책(src/agent/approval.ts 규칙): 가전 명령은 말로 시킨 것이라 그 말이 승인이다. 위험 목록(현관 잠금 해제, 인덕션 켜기, 전자레인지 시작)과
// 사용자가 「하지 마」라고 해 둔 명령만 승인 토큰이 있어야 실행한다. 답(이번만·앞으로도·하지 마)은 승인 기억에 남긴다. 위험 목록은 「앞으로도」를 기억하지 않는다.

import { randomUUID } from "node:crypto";
import { isUnknown } from "../hub/signals.js";
import type { Command, CommandResult, CommandType, DeviceHub, DeviceKind, DeviceSpec } from "../hub/types.js";
import { checkCommand, normalizeCommand } from "../model/mapping.js";
import { DEVICE_VERB, STEP_LABEL } from "../plan/labels.js";
import { approvalNeed, deviceKey, memoryApprovals, type ApprovalAnswer, type ApprovalBook } from "./approval.js";
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

/** 「하지 마」를 기억한 명령을 다시 시켰을 때의 까닭. what: 「거실 천장등 켜기」. */
export const PREFERENCE_REASON = (what: string) => `${josa(what, "은/는")} 하지 말라고 한 일이에요.`;
/** 승인 대기에 「하지 마」로 답했을 때의 답. */
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
  /** 왜 묻는가: 위험 목록이거나 「하지 마」를 기억한 명령. */
  why: "risky" | "preference";
  expiresAt: number; // epoch ms
}

export interface PolicyOptions {
  ttlMs?: number;
  now?: () => number;
  /** 승인 기억(src/server/home.ts가 runtime/homes/<집>/approvals.json으로 만든다). 없으면 이 프로세스 안에서만 기억한다. */
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

  issue(deviceId: string, cmd: Command, reason: string, why: PendingConfirmation["why"] = "risky"): PendingConfirmation {
    this.purge();
    const p: PendingConfirmation = { token: randomUUID(), deviceId, command: structuredClone(cmd), reason, why, expiresAt: this.now() + this.ttlMs };
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
    const need = approvalNeed({ key: deviceKey(id, c.type), risky: risky !== null, requested: true, memory: this.approvals.memory() });
    if (!need.ask) return hub.command(id, c);
    const why = need.ask === "risky" ? "risky" : "preference";
    const reason = risky ?? PREFERENCE_REASON(commandName(spec.label, c));

    if (confirmToken !== undefined) {
      const p = this.peek(confirmToken);
      if (p && p.deviceId === id && stable(p.command) === stable(c)) {
        this.tokens.delete(confirmToken);
        return hub.command(id, c);
      }
      return this.ask(id, c, reason, why, state, p ? TOKEN_MISMATCH : TOKEN_MISSING);
    }
    return this.ask(id, c, reason, why, state, reason);
  }

  /** 토큰만으로 대기 중인 명령을 실행한다(POST /api/agent/confirm, 실제 폰 답 단추). 「앞으로도」는 기억한다(위험 목록은 이번만으로 본다). */
  async confirm(hub: DeviceHub, token: string, choice: Exclude<ApprovalAnswer, "never"> = "once"): Promise<CommandResult> {
    const p = this.consume(token);
    if (!p) return { ok: false, error: TOKEN_MISSING };
    this.approvals.answer(deviceKey(p.deviceId, p.command.type), p.why === "risky" ? "once" : choice);
    return hub.command(p.deviceId, p.command);
  }

  /** 「하지 마」: 대기 중인 명령을 실행하지 않고 기억한다. 없거나 만료면 undefined. */
  refuse(token: string): PendingConfirmation | undefined {
    const p = this.consume(token);
    if (p) this.approvals.answer(deviceKey(p.deviceId, p.command.type), "never");
    return p;
  }

  private ask(id: string, cmd: Command, reason: string, why: PendingConfirmation["why"], state: CommandResult["state"], error: string): CommandResult {
    const p = this.issue(id, cmd, reason, why);
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
