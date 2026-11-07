// PAM 호출 시점. 기본 event: World State에 의미 있는 변화가 있을 때(최소 간격 minGapMs, 동시 maxInflight).
// periodic(출처: docs/provenance.md): 사람이 보이는 동안 periodMs마다. 사람 없음 + 등장·사라짐 없음이 idleStopMs 이어지면 멈추고, 등장·사라짐이 생기면 다시.
import type { WorldChange } from "../contract/world.js";

export type TriggerMode = "event" | "periodic";
export interface TriggerConfig { mode: TriggerMode; minGapMs: number; periodMs: number; idleStopMs: number; maxInflight: number }
const ACTIVITY = new Set(["appeared", "gone", "person_appeared", "person_gone"]);
const num = (env: Record<string, string | undefined>, key: string, d: number) => {
  const raw = env[key]?.trim();
  if (!raw) return d;
  const v = Number(raw);
  if (!Number.isFinite(v) || v < 0) throw new Error(`${key}=${raw}: 0 이상의 숫자여야 합니다`);
  return v;
};

export function loadTriggerConfig(env: Record<string, string | undefined>): TriggerConfig {
  const mode = env.PAM_TRIGGER?.trim() || "event";
  if (mode !== "event" && mode !== "periodic") throw new Error(`PAM_TRIGGER=${mode}: event 또는 periodic이어야 합니다`);
  return { mode, minGapMs: num(env, "PAM_MIN_GAP_MS", 3000), periodMs: num(env, "PAM_PERIOD_MS", 1000), idleStopMs: num(env, "PAM_IDLE_STOP_MS", 1_800_000),
    maxInflight: Math.max(1, Math.floor(num(env, "PAM_MAX_INFLIGHT", mode === "event" ? 1 : 4))) };
}

export class Trigger {
  private pending = false;
  private lastCall = Number.NEGATIVE_INFINITY;
  private lastActivity: number;
  constructor(private readonly cfg: TriggerConfig, startedAtMs: number) { this.lastActivity = startedAtMs; }

  onChanges(changes: WorldChange[]): void {
    for (const c of changes) {
      if (c.meaningful) this.pending = true;
      if (ACTIVITY.has(c.kind)) this.lastActivity = Math.max(this.lastActivity, c.at_ms);
    }
  }

  due(nowMs: number, personVisible: boolean, inflight: number): boolean {
    if (inflight >= this.cfg.maxInflight) return false;
    if (this.cfg.mode === "event") return this.pending && nowMs - this.lastCall >= this.cfg.minGapMs;
    if (nowMs - this.lastCall < this.cfg.periodMs) return false;
    return !this.paused(nowMs, personVisible);
  }

  paused(nowMs: number, personVisible: boolean): boolean {
    return this.cfg.mode === "periodic" && !personVisible && !this.pending && nowMs - this.lastActivity >= this.cfg.idleStopMs;
  }

  called(nowMs: number): void { this.lastCall = nowMs; this.pending = false; }
}
