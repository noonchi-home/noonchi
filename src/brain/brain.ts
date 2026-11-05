// 상위 판단 실행기: 폰 프레임 → (YOLO 존재 판정) + 판정 반복(VLM) → 컵 상태 기계 → 판단 모델(모의·PAM) → 이벤트·모의 행동.
// 실시간 연결(폰 프레임·사진·답, 감지기 돌리기, 메시지 나눠 보내기)은 live.ts가 한다. 여기는 시간을 받는 순수한 흐름이다.

import type { BrainLog } from "../contract/events.js";
import type { BrainConfig } from "./config.js";
import {
  CUP_MEMORY, CUP_TASKS, isoWithOffset, selectDecisionFrames, type DecisionEvidence, type DecisionModel, type PamMemory,
} from "./decision.js";
import { PerceptionLoop, type PerceptionResult } from "./loop.js";
import { CupMachine, type BrainState, type DecideIntent, type MachineOutput } from "./machine.js";
import type { Perceiver, Perception } from "./perception.js";
import type { Presence } from "./presence.js";
import { FrameBuffer, type Frame } from "./window.js";

export type { PerceptionLog, PresenceLog } from "../contract/events.js";
export type BrainOutput = BrainLog;

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
  /** 감지 모드: onPresence로 YOLO 존재 판정을 넣는다(자리 비움·재확인·결과 확인, VLM 거르기). */
  presence?: boolean;
  /** 재확인 뒤 모의 행동과 결과 확인까지 간다. */
  acting?: boolean;
}

const YN: Record<string, string> = { yes: "예", no: "아니오", unknown: "모름" };

export function summarize(p: Perception | null): string {
  if (!p) return "판정 없음";
  return `사람 ${YN[p.person_present]} · 들고 있음 ${YN[p.person_holding_cup]} · 마심 ${YN[p.drinking]} · 컵 ${YN[p.cup_visible]}(${p.cup_support}) · 내용물 ${p.contents}${p.contents_status === "inferred" ? "(추정)" : p.contents_status === "confirmed" ? "(확신)" : ""}`;
}

export function summarizePresence(p: Presence): string {
  return `YOLO 사람 ${YN[p.person]} · 컵 ${YN[p.cup]} · 식탁 비춤 ${YN[p.table]}`;
}

/** 판단 근거로 쓸 수 있게 남겨 두는 최근 VLM 판정(근거 시각 → 마지막 사진). */
interface Judged { perception: Perception; frame: Frame; answer: boolean }

export class CupBrain {
  readonly machine: CupMachine;
  private readonly buffer: FrameBuffer;
  private readonly loop: PerceptionLoop;
  private readonly tasks: string[];
  private decisionRun: Promise<void> | null = null;
  /** 판단 사진 5장(2초 간격)이 아직 모자라 미룬 판단. 사진이 모이면 그때의 최신 사진까지로 판단한다. */
  private pending: { intent: DecideIntent; deadlineMs: number } | null = null;
  private lastPresence: Presence | null = null;
  private lastPresenceText = "";
  /** 거르기: 마지막 VLM 호출을 시작할 때의 (사람, 컵) 짝. */
  private lastCallSig = "";
  /** 받은 요청 답 사진(판정이 끝날 때까지). 여러 장이어도 결과마다 제 사진을 찾는다. */
  private answerFrames = new Map<string, Frame>();
  private judged = new Map<number, Judged>();
  /** 멈춘 뒤에는 판정 결과·답 사진·존재 판정·판단을 더 처리하지 않는다(새 모델 호출이 나가지 않게). */
  private stopped = false;

  constructor(private readonly opts: CupBrainOptions) {
    this.tasks = opts.tasks ?? [...CUP_TASKS];
    const decision = opts.decision;
    this.machine = new CupMachine(opts.config, {
      decisive: decision.whatIf
        ? () => decision.whatIf!({ contents: "empty" }, this.tasks) !== decision.whatIf!({ contents: "not_empty" }, this.tasks)
        : undefined,
      presence: opts.presence,
      acting: opts.acting,
    });
    this.buffer = new FrameBuffer(opts.config.bufferMs);
    this.loop = new PerceptionLoop({
      perceiver: opts.perceiver,
      buffer: this.buffer,
      config: opts.config,
      clock: opts.clock,
      onResult: (r) => this.onResult(r),
      gate: opts.presence ? () => this.gate() : undefined,
      onStart: () => { this.lastCallSig = this.sig(); },
    });
  }

  onFrame(frame: Frame): void {
    this.loop.onFrame(frame);
  }

  /** YOLO 존재 판정(감지 모드). 바뀔 때만 기록을 낸다. */
  onPresence(pr: Presence): void {
    if (this.stopped) return;
    const now = this.opts.clock.now();
    this.lastPresence = pr;
    const text = summarizePresence(pr);
    if (text !== this.lastPresenceText) {
      this.lastPresenceText = text;
      this.opts.emit({
        type: "presence", at_ms: now, evidence_age_ms: now - pr.atMs, person: pr.person, cup: pr.cup, table: pr.table, scores: pr.scores, summary: text,
      });
    }
    this.apply(this.machine.observePresence(pr, now));
    this.retryPending();
    this.loop.poll();
  }

  /** 요청 답 사진. 요청이 떠 있고 요청 뒤에 찍힌 사진이면 다음 판정을 그 사진 한 장으로 하고 true. */
  answerPhoto(frame: Frame): boolean {
    if (this.stopped) return false;
    const req = this.machine.pendingRequest;
    if (!req || frame.capturedAtMs <= req.issuedAtMs) return false;
    this.answerFrames.set(frame.id, frame);
    this.loop.answer([frame]);
    return true;
  }

  /** 폰 부탁·질문의 답. */
  reply(id: string, choice: string): void {
    if (this.stopped) return;
    this.apply(this.machine.actionReply(id, choice, this.opts.clock.now()));
  }

  /** 시간이 흐를 때 부른다(타이머). 시간 초과를 처리하고 판정을 다시 시도한다. */
  tick(): void {
    if (this.stopped) return;
    this.apply(this.machine.tick(this.opts.clock.now()));
    this.retryPending();
    this.loop.poll();
  }

  private sig(): string {
    const p = this.lastPresence;
    return p ? `${p.person}/${p.cup}` : "";
  }

  /** 감지 모드 VLM 거르기(계획서 2026-11-04-brain-live.md "VLM 거르기"). */
  private gate(): boolean {
    const pr = this.lastPresence;
    if (!pr || this.opts.clock.now() - pr.atMs > this.opts.config.staleMs) return false;
    if (pr.person === "unknown" || pr.cup === "unknown") return false;
    if (pr.person === "no" && pr.cup === "no") return false;
    if (this.machine.needsVlm(this.opts.clock.now())) return true;
    if (this.machine.state === "watching") return pr.person === "yes" && pr.cup === "yes";
    if (this.machine.state === "requesting") return pr.cup === "yes";
    return this.sig() !== this.lastCallSig;
  }

  private onResult(r: PerceptionResult): void {
    if (this.stopped) return;
    const now = this.opts.clock.now();
    const answerFrame = r.frameIds.length === 1 ? this.answerFrames.get(r.frameIds[0]!) : undefined;
    const answer = answerFrame !== undefined;
    if (answerFrame) this.answerFrames.delete(answerFrame.id);
    this.opts.emit({
      type: "perception", at_ms: now, evidence_age_ms: now - r.evidenceAtMs, frames: r.frameIds.length,
      summary: summarize(r.perception), cost_usd: r.costUsd, ...(answer ? { answer: true as const } : {}), ...(r.error ? { error: r.error } : {}),
    });
    if (r.perception) {
      const frame = answerFrame ?? this.buffer.frames().find((f) => f.id === r.frameIds.at(-1));
      if (frame) this.remember(r.evidenceAtMs, { perception: r.perception, frame, answer });
    }
    this.apply(this.machine.observe({ ...r, answer }, now));
    this.retryPending();
  }

  /** 판단 근거(evidence)로 넘길 수 있게 최근 판정을 조금 남긴다. */
  /** 기계가 받아들여 들고 있는 컵 안 근거(keepEvidence)의 사진은 오래돼도 지우지 않는다(판단이 늦어져도 근거로 넘기게). */
  private remember(atMs: number, j: Judged): void {
    this.judged.set(atMs, j);
    const keep = new Set(this.machine.keepEvidence());
    const floor = atMs - this.opts.config.bufferMs;
    for (const k of this.judged.keys()) if (k < floor && !keep.has(k)) this.judged.delete(k);
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

  /** 판단 근거의 내용물이 확신한 VLM 판정에서 왔으면 그 판정의 사진(요청 답 사진이면 그 사진)을 근거로 넘긴다. */
  private evidenceFor(intent: DecideIntent, time: { offsetMinutes: number; epochMs: number }): DecisionEvidence[] {
    const j = intent.contentsAtMs === null ? undefined : this.judged.get(intent.contentsAtMs);
    if (!j || j.perception.contents_status !== "confirmed") return [];
    return [{
      kind: "cup_contents", value: j.perception.contents, certain: true,
      timestamp: isoWithOffset(time.epochMs + j.frame.capturedAtMs, time.offsetMinutes),
      source: j.answer ? "request_answer_photo" : "scene_frame", jpeg: j.frame.jpeg,
    }];
  }

  /** 사진이 모이면 판단 모델을 부르고 true. 끝 시각은 근거 시각 이후의 최신 사진까지 늦출 수 있다. */
  private tryDecision(intent: DecideIntent): boolean {
    if (this.stopped) return true; // 멈춘 뒤에는 판단 모델을 부르지 않는다(미뤄 두지도 않음)
    const time = this.opts.time ?? { offsetMinutes: -new Date().getTimezoneOffset(), epochMs: 0 };
    const endMs = Math.max(intent.endMs, this.buffer.latest()?.capturedAtMs ?? intent.endMs);
    const frames = selectDecisionFrames(this.buffer.frames(), endMs, {
      stepMs: this.opts.config.decisionStepMs, toleranceMs: 500, ...time,
    });
    if (!frames) return false;
    const run = this.opts.decision.decide({
      frames, memory: this.opts.memory ?? CUP_MEMORY, memoryKind: this.opts.memoryKind ?? "list",
      tasks: this.tasks, facts: { contents: intent.contents }, evidence: this.evidenceFor(intent, time),
    }).then(
      (pred) => { if (!this.stopped) this.apply(this.machine.decided(intent.generation, pred, this.tasks, this.opts.clock.now())); },
      (e: unknown) => { if (!this.stopped) this.apply(this.machine.decisionFailed(intent.generation, e instanceof Error ? e.message : String(e), this.opts.clock.now())); },
    );
    const tracked: Promise<void> = run.finally(() => { if (this.decisionRun === tracked) this.decisionRun = null; });
    this.decisionRun = tracked;
    return true;
  }

  /** 판정을 더 부르지 않는다(서버 종료). 진행 중인 판정·판단 결과는 그대로 끝나게 둔다. */
  stop(): void {
    this.stopped = true;
    this.loop.stop();
    this.pending = null;
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
