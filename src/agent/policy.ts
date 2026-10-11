// 승인 정책: 위험한 명령(현관 잠금 해제, 인덕션 켜기, 전자레인지 시작)은 사용자 승인 토큰이 있어야 실행한다.

import { randomUUID } from "node:crypto";
import type { Command, CommandResult, CommandType, DeviceHub, DeviceKind, DeviceSpec } from "../hub/types.js";
import { checkCommand, normalizeCommand } from "../model/mapping.js";

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

  constructor(opts: PolicyOptions = {}) {
    this.ttlMs = opts.ttlMs ?? CONFIRM_TTL_MS;
    this.now = opts.now ?? Date.now;
  }

  /** 승인이 필요하면 한국어 이유, 아니면 null. */
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

  /** 정책을 거쳐 명령한다. 승인이 필요하면 needsConfirmation(토큰)을 돌려주고 실행하지 않는다. */
  async guard(hub: DeviceHub, id: string, cmd: Command, confirmToken?: string): Promise<CommandResult> {
    const spec = hub.list().find((d) => d.id === id);
    if (!spec) return { ok: false, error: `기기를 찾을 수 없습니다: ${id}` };
    const c = normalizeCommand(spec, cmd);
    const state = hub.get(id);
    const invalid = checkCommand(spec, c, state);
    if (invalid) return { ok: false, error: invalid, state };
    const reason = this.requiresConfirmation(spec, c);
    if (!reason) return hub.command(id, c);

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

  /** 토큰만으로 대기 중인 명령을 실행한다(POST /api/agent/confirm, 화면 승인 버튼). */
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
