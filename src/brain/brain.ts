// 상위 판단 실행기: 폰 프레임 → 판정 반복(VLM) → 컵 상태 기계 → 판단 모델(PAM 자리) → 이벤트.
// 2단계에서 start.ts가 폰 프레임을 넣고, 이벤트를 대시보드(추론 기록)·폰(요청 글)으로 보낸다.

import type { BrainConfig } from "./config.js";
import {
  CUP_MEMORY, CUP_TASKS, selectDecisionFrames, type DecisionModel, type PamMemory,
} from "./decision.js";
import { PerceptionLoop, type PerceptionResult } from "./loop.js";
import { CupMachine, type BrainEvent, type BrainState, type DecideIntent, type MachineOutput } from "./machine.js";
import type { Perceiver, Perception } from "./perception.js";
import { FrameBuffer, type Frame } from "./window.js";

export interface PerceptionLog {
  type: "perception";
  at_ms: number;
  evidence_age_ms: number;
  frames: number;
  summary: string;
  cost_usd: number;
  error?: string;
}

export type BrainOutput = BrainEvent | PerceptionLog;

export interface CupBrainOptions {
  perceiver: Perceiver;
  decision: DecisionModel;
  config: BrainConfig;
  clock: { now(): number };
  emit(e: BrainOutput): void;
  tasks?: string[];
  memory?: PamMemory;
  memoryKind?: "list" | "fsm";
  /** 판단 사진 명목 시각용: 시간대(분)와, 프레임 시각이 상대값이면 그 0의 실제 시각. */
  time?: { offsetMinutes: number; epochMs: number };
}

const YN: Record<string, string> = { yes: "예", no: "아니오", unknown: "모름" };

export function summarize(p: Perception | null): string {
  if (!p) return "판정 없음";
  return `사람 ${YN[p.person_present]} · 들고 있음 ${YN[p.person_holding_cup]} · 마심 ${YN[p.drinking]} · 컵 ${YN[p.cup_visible]}(${p.cup_support}) · 내용물 ${p.contents}${p.contents_status === "inferred" ? "(추정)" : p.contents_status === "confirmed" ? "(확신)" : ""}`;
}

export class CupBrain {
  readonly machine: CupMachine;
  private readonly buffer: FrameBuffer;
  private readonly loop: PerceptionLoop;
  private readonly tasks: string[];
  private decisionRun: Promise<void> | null = null;
  /** 판단 사진 5장(2초 간격)이 아직 모자라 미룬 판단. 사진이 모이면 그때의 최신 사진까지로 판단한다. */
  private pending: { intent: DecideIntent; deadlineMs: number } | null = null;

  constructor(private readonly opts: CupBrainOptions) {
    this.tasks = opts.tasks ?? [...CUP_TASKS];
    const decision = opts.decision;
    this.machine = new CupMachine(opts.config, {
      decisive: decision.whatIf
        ? () => decision.whatIf!({ contents: "empty" }, this.tasks) !== decision.whatIf!({ contents: "not_empty" }, this.tasks)
        : undefined,
    });
    this.buffer = new FrameBuffer(opts.config.bufferMs);
    this.loop = new PerceptionLoop({
      perceiver: opts.perceiver,
      buffer: this.buffer,
      config: opts.config,
      clock: opts.clock,
      onResult: (r) => this.onResult(r),
    });
  }

  onFrame(frame: Frame): void {
    this.loop.onFrame(frame);
  }

  /** 시간이 흐를 때 부른다(타이머). 시간 초과를 처리하고 판정을 다시 시도한다. */
  tick(): void {
    this.apply(this.machine.tick(this.opts.clock.now()));
    this.retryPending();
    this.loop.poll();
  }

  private onResult(r: PerceptionResult): void {
    const now = this.opts.clock.now();
    this.opts.emit({
      type: "perception", at_ms: now, evidence_age_ms: now - r.evidenceAtMs, frames: r.frameIds.length,
      summary: summarize(r.perception), cost_usd: r.costUsd, ...(r.error ? { error: r.error } : {}),
    });
    this.apply(this.machine.observe(r, now));
    this.retryPending();
  }

  private apply(out: MachineOutput): void {
    for (const e of out.events) this.opts.emit(e);
    for (const intent of out.intents) this.startDecision(intent);
  }

  private startDecision(intent: DecideIntent): void {
    if (!this.tryDecision(intent)) {
      this.pending = { intent, deadlineMs: this.opts.clock.now() + this.opts.config.requestTimeoutMs };
      const m = this.machine;
      this.opts.emit({
        type: "brain", stage: "decide", state: m.state, text: "판단 사진 5장(2초 간격)이 아직 모자람 → 모이면 판단",
        at_ms: this.opts.clock.now(), evidence_age_ms: null, generation: m.generation,
      });
    }
  }

  private retryPending(): void {
    const p = this.pending;
    if (!p) return;
    if (p.intent.generation !== this.machine.generation || this.machine.state !== "deciding") {
      this.pending = null; // 사람이 돌아오는 등 흐름이 바뀌었다
      return;
    }
    // 기한부터 본다: 기한이 지난 뒤에는 사진이 모였어도 부르지 않는다
    if (this.opts.clock.now() > p.deadlineMs) {
      this.pending = null;
      this.apply(this.machine.decisionFailed(p.intent.generation, "판단 사진 5장(2초 간격)을 못 모음", this.opts.clock.now()));
    } else if (this.tryDecision(p.intent)) {
      this.pending = null;
    }
  }

  /** 사진이 모이면 판단 모델을 부르고 true. 끝 시각은 근거 시각 이후의 최신 사진까지 늦출 수 있다. */
  private tryDecision(intent: DecideIntent): boolean {
    const time = this.opts.time ?? { offsetMinutes: -new Date().getTimezoneOffset(), epochMs: 0 };
    const endMs = Math.max(intent.endMs, this.buffer.latest()?.capturedAtMs ?? intent.endMs);
    const frames = selectDecisionFrames(this.buffer.frames(), endMs, {
      stepMs: this.opts.config.decisionStepMs, toleranceMs: 500, ...time,
    });
    if (!frames) return false;
    const run = this.opts.decision.decide({
      frames, memory: this.opts.memory ?? CUP_MEMORY, memoryKind: this.opts.memoryKind ?? "list",
      tasks: this.tasks, facts: { contents: intent.contents },
    }).then(
      (pred) => this.apply(this.machine.decided(intent.generation, pred, this.tasks, this.opts.clock.now())),
      (e: unknown) => this.apply(this.machine.decisionFailed(intent.generation, e instanceof Error ? e.message : String(e), this.opts.clock.now())),
    );
    const tracked: Promise<void> = run.finally(() => { if (this.decisionRun === tracked) this.decisionRun = null; });
    this.decisionRun = tracked;
    return true;
  }

  async idle(): Promise<void> {
    while (true) {
      await this.loop.idle();
      if (!this.decisionRun) return;
      await this.decisionRun;
    }
  }

  stats(): { calls: number; costUsd: number; capped: boolean; state: BrainState; generation: number } {
    return { ...this.loop.stats(), state: this.machine.state, generation: this.machine.generation };
  }
}
