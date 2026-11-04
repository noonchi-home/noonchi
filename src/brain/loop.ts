// 판정 반복: 한 번에 하나만 부르고(single-flight), 끝나면 그때의 최신 창으로 다시 부른다(latest-wins).
// 사진을 줄 세우지 않는다. 11-01 시뮬레이션에서 FIFO는 20초 만에 226장이 밀렸다.

import type { WindowConfig } from "./config.js";
import type { Perceiver, Perception } from "./perception.js";
import { selectWindow, type Frame, type FrameBuffer } from "./window.js";

export interface PerceptionResult {
  perception: Perception | null;
  /** 판정에 쓴 가장 최근 사진의 촬영 시각. */
  evidenceAtMs: number;
  frameIds: string[];
  startedAtMs: number;
  completedAtMs: number;
  costUsd: number;
  model: string;
  error?: string;
}

export interface LoopOptions {
  perceiver: Perceiver;
  buffer: FrameBuffer;
  config: { intervalMs: number; callCap: number; window: WindowConfig };
  clock: { now(): number };
  onResult(result: PerceptionResult): void;
}

export class PerceptionLoop {
  private inFlight: Promise<void> | null = null;
  private nextAtMs = Number.NEGATIVE_INFINITY;
  private lastEvidenceId: string | null = null;
  private calls = 0;
  private costUsd = 0;
  private capped = false;

  constructor(private readonly opts: LoopOptions) {}

  onFrame(frame: Frame): void {
    this.opts.buffer.push(frame);
    this.poll();
  }

  /** 부를 수 있으면 부른다: 진행 중 아님, 간격 지남, 새 사진 있음, 상한 안. */
  poll(): void {
    if (this.inFlight) return;
    const latest = this.opts.buffer.latest();
    if (!latest || latest.id === this.lastEvidenceId) return;
    if (this.opts.clock.now() < this.nextAtMs) return;
    if (this.calls >= this.opts.config.callCap) {
      this.capped = true;
      return;
    }
    this.inFlight = this.run().finally(() => {
      this.inFlight = null;
      this.poll();
    });
  }

  private async run(): Promise<void> {
    const frames = selectWindow(this.opts.buffer.frames(), this.opts.config.window);
    const last = frames.at(-1)!;
    const startedAtMs = this.opts.clock.now();
    // 다시 묻기도 실제 요청이라 상한 안에서만 허락한다
    const maxAttempts = Math.min(2, this.opts.config.callCap - this.calls);
    this.nextAtMs = startedAtMs + this.opts.config.intervalMs;
    this.lastEvidenceId = last.id;
    let result: PerceptionResult;
    try {
      const reply = await this.opts.perceiver.perceive(frames, { maxAttempts });
      this.calls += reply.attempts ?? 1;
      this.costUsd += reply.costUsd;
      result = {
        perception: reply.perception, evidenceAtMs: last.capturedAtMs, frameIds: frames.map((f) => f.id),
        startedAtMs, completedAtMs: this.opts.clock.now(), costUsd: reply.costUsd, model: reply.model,
        ...(reply.error ? { error: reply.error } : {}),
      };
    } catch (e) {
      this.calls += 1;
      result = {
        perception: null, evidenceAtMs: last.capturedAtMs, frameIds: frames.map((f) => f.id),
        startedAtMs, completedAtMs: this.opts.clock.now(), costUsd: 0, model: "",
        error: e instanceof Error ? e.message : String(e),
      };
    }
    this.opts.onResult(result);
  }

  /** 진행 중인 판정(과 그 뒤 이어진 판정)이 끝날 때까지 기다린다. */
  async idle(): Promise<void> {
    while (this.inFlight) await this.inFlight;
  }

  stats(): { calls: number; costUsd: number; capped: boolean } {
    return { calls: this.calls, costUsd: this.costUsd, capped: this.capped };
  }
}
