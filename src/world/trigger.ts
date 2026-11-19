// PAM 호출 시점. 기본 periodic: 관찰이 살아 있는 동안(엔진 프레임이 liveMs 안에 옴) periodMs마다 그때 World State로 부른다.
// 주기 기본은 PAM 모델 이름에 nano가 들면 1초, 아니면 5초다(PAM_PERIOD_MS를 주면 그 값). 동시 상한(기본 1) 때문에 답이 주기보다 늦으면 실제 간격은 답 시간이다.
// 계기와 행동은 PAM의 FSM이 정하므로 의미 있는 변화를 기다리지 않는다. 사람이 떠난 뒤(컵이 남은 때)에도 계속 부른다.
// 프레임이 오지 않으면(폰 없음) 부르지 않는다. 사람 없음 + 등장·사라짐 없음이 idleStopMs(30분) 이어지면 멈추고, 등장·사라짐이 생기면 다시(출처: docs/provenance.md).
// event: World State에 의미 있는 변화가 있을 때(최소 간격 minGapMs). 두 모드 모두 나가 있는 판단이 maxInflight(기본 1)면 부르지 않는다.
// nudge(미리 세운 목표의 사람이 떠남)는 나가 있는 판단을 기다리지 않고 상한 위로 하나 더 나간다: 그 판단들은 떠나기 전 관찰이라 기다리면 반응이 답 시간만큼 늦다
// (2026-11-20 pfsm12: 1초 주기 판단이 늘 하나 나가 있어 첫 명령이 3초). 늦게 온 앞 판단의 답은 판단(src/brain/decide.ts)이 번호로 늦은 답으로 본다.
import type { WorldChange } from "../contract/world.js";

export type TriggerMode = "event" | "periodic";
/** 주기 판단이 멈춘 까닭: no_frames 엔진 프레임이 liveMs 넘게 오지 않음, idle 사람 없음·등장 사라짐 없음이 idleStopMs. */
export type TriggerPause = "no_frames" | "idle";
export interface TriggerConfig { mode: TriggerMode; minGapMs: number; periodMs: number; idleStopMs: number; liveMs: number; maxInflight: number }
const ACTIVITY = new Set(["appeared", "gone", "person_appeared", "person_gone"]);
const num = (env: Record<string, string | undefined>, key: string, d: number) => {
  const raw = env[key]?.trim();
  if (!raw) return d;
  const v = Number(raw);
  if (!Number.isFinite(v) || v < 0) throw new Error(`${key}=${raw}: 0 이상의 숫자여야 합니다`);
  return v;
};

/** periodic 기본 주기(ms): PAM 모델 이름에 nano가 들면 nanoMs, 아니면 defaultMs(2026-11-20 사용자 「NANO면 1초마다 해 그냥」). */
export const PAM_PERIOD = { nanoMs: 1000, defaultMs: 5000 };

/** PAM_TRIGGER(periodic 기본·event), PAM_PERIOD_MS(기본: pamModel에 nano가 들면 1000, 아니면 5000), PAM_LIVE_MS(10000), PAM_IDLE_STOP_MS(1800000), PAM_MIN_GAP_MS(3000),
 *  PAM_MAX_INFLIGHT(1). pamModel은 서버가 넘기는 최종 PAM 모델 이름이다(world는 env의 모델 칸을 읽지 않는다). 틀린 값이면 던진다. */
export function loadTriggerConfig(env: Record<string, string | undefined>, o: { pamModel?: string } = {}): TriggerConfig {
  const mode = env.PAM_TRIGGER?.trim() || "periodic";
  if (mode !== "event" && mode !== "periodic") throw new Error(`PAM_TRIGGER=${mode}: event 또는 periodic이어야 합니다`);
  const period = /nano/i.test(o.pamModel ?? "") ? PAM_PERIOD.nanoMs : PAM_PERIOD.defaultMs;
  return { mode, minGapMs: num(env, "PAM_MIN_GAP_MS", 3000), periodMs: num(env, "PAM_PERIOD_MS", period), idleStopMs: num(env, "PAM_IDLE_STOP_MS", 1_800_000),
    liveMs: num(env, "PAM_LIVE_MS", 10_000), maxInflight: Math.max(1, Math.floor(num(env, "PAM_MAX_INFLIGHT", 1))) };
}

export class Trigger {
  private pending = false;
  private lastCall = Number.NEGATIVE_INFINITY;
  private lastFrame = Number.NEGATIVE_INFINITY;
  private lastActivity: number;
  private nudged = false;
  constructor(private readonly cfg: TriggerConfig, startedAtMs: number) { this.lastActivity = startedAtMs; }

  onChanges(changes: WorldChange[]): void {
    for (const c of changes) {
      if (c.meaningful) this.pending = true;
      if (ACTIVITY.has(c.kind)) this.lastActivity = Math.max(this.lastActivity, c.at_ms);
    }
  }

  /** 엔진 프레임이 온 시각. */
  onFrame(atMs: number): void { this.lastFrame = Math.max(this.lastFrame, atMs); }

  /** 다음 판단을 주기·최소 간격·나가 있는 판단을 기다리지 않고 부르게 한다(미리 세운 목표의 사람이 떠남, src/act/track/goal.ts).
   *  동시 상한 위로는 하나만 더 나가고, 멈춤(프레임 없음)은 지킨다. 부르면 풀린다. */
  nudge(): void { this.nudged = true; }

  due(nowMs: number, personVisible: boolean, inflight: number): boolean {
    if (this.nudged) return inflight <= this.cfg.maxInflight && this.pause(nowMs, personVisible) === null;
    if (inflight >= this.cfg.maxInflight) return false;
    if (this.cfg.mode === "event") return this.pending && nowMs - this.lastCall >= this.cfg.minGapMs;
    if (nowMs - this.lastCall < this.cfg.periodMs) return false;
    return this.pause(nowMs, personVisible) === null;
  }

  /** 주기 판단이 멈춘 까닭(멈추지 않았으면 null). event는 멈추지 않는다. */
  pause(nowMs: number, personVisible: boolean): TriggerPause | null {
    if (this.cfg.mode !== "periodic") return null;
    if (nowMs - this.lastFrame > this.cfg.liveMs) return "no_frames";
    if (!personVisible && !this.pending && nowMs - this.lastActivity >= this.cfg.idleStopMs) return "idle";
    return null;
  }

  called(nowMs: number): void { this.lastCall = nowMs; this.pending = false; this.nudged = false; }
}
