// VLM 동시 요청: 앞 답을 기다리지 않고 maxInflight까지 보낸다. 답은 프레임 번호로 맞춘다.
// 상한을 넘은 프레임·시간 초과·형식 오류·호출 오류는 버리지 않고 VLM 분석 없음으로 낸다.
// 시간 초과는 signal을 끊어 HTTP 요청까지 끊는다. 자리는 analyze가 끝나야 비므로 실제로 나가 있는 요청은 maxInflight를 넘지 않는다.
// 가까이 보기(src/observe/pipeline.ts closer)는 따로 둔 자리(closerSlots)로 간다: 보통 프레임이 maxInflight를 다 써도 막히지 않고, 보통 프레임은 그 자리를 쓰지 않는다.
// 가까이 보기 답은 onResult가 아니라 submitCloser가 돌려준 약속으로 온다. 멈추거나 부른 쪽 신호가 끊기면 HTTP 요청을 끊고 답을 기다리지 않고 분석 없음(error)으로 끝난다.
import type { VlmMissing } from "../contract/world.js";
import type { EngineFrame } from "../contract/observe.js";
import type { SceneDetection, SceneObservation } from "./scene.js";

export type { VlmMissing } from "../contract/world.js";
/** 풀이 내는 분석 없음(늦게 온 프레임 stale은 풀에 오기 전에 관찰 흐름이 남긴다). */
type PoolMissing = Exclude<VlmMissing, "stale">;
export interface VlmResult { frameId: string; capturedAtMs: number; scene: SceneObservation | null; missing?: PoolMissing; costUsd: number }
type Analysis = { scene: SceneObservation | null; costUsd: number; error?: string };
type Analyze = (frame: EngineFrame, dets: SceneDetection[], signal: AbortSignal) => Promise<Analysis>;

export class VlmPool {
  private readonly running = new Set<Promise<void>>();
  private readonly controllers = new Set<AbortController>();
  /** 멈출 때 끝낼 나가 있는 요청(답을 넘기고 자리를 비움). */
  private readonly settlers = new Set<() => void>();
  private sent = 0;
  private cost = 0;
  private stopped = false;
  /** 나가 있는 보통 프레임·가까이 보기 요청 수. */
  private frames = 0;
  private closers = 0;
  private readonly missing: Record<PoolMissing, number> = { cap: 0, timeout: 0, format: 0, error: 0 };
  constructor(private readonly o: { maxInflight: number; analyze: Analyze; onResult: (r: VlmResult) => void; timeoutMs?: number; closerSlots?: number }) {}

  private miss(frame: EngineFrame, why: PoolMissing, costUsd = 0): VlmResult {
    if (!this.stopped) this.missing[why]++;
    return { frameId: frame.id, capturedAtMs: frame.capturedAtMs, scene: null, missing: why, costUsd };
  }

  /** 상한 안이면 바로 보낸다("sent"). 넘으면 VLM 분석 없음(cap)을 onResult로 내고 "skipped". 멈춘 뒤에는 아무것도 내지 않는다. */
  submit(frame: EngineFrame, dets: SceneDetection[]): "sent" | "skipped" {
    if (this.stopped) return "skipped";
    if (this.frames >= this.o.maxInflight) {
      this.o.onResult(this.miss(frame, "cap"));
      return "skipped";
    }
    this.frames++;
    this.start(frame, dets, (r) => { if (!this.stopped) this.o.onResult(r); }, () => this.frames--);
    return "sent";
  }

  /** 가까이 보기 자리가 비었는가. */
  closerFree(): boolean {
    return !this.stopped && this.closers < (this.o.closerSlots ?? 0);
  }

  /** 가까이 보기 자리로 보낸다. 자리가 차 있거나 멈췄거나 signal이 이미 끊겼으면 null(보내지 않음). 답(분석 없음 포함)은 돌려준 약속으로 온다.
   *  signal이 끊기면 HTTP 요청을 끊고 답을 기다리지 않고 분석 없음(error, 분석 없음 셈에는 넣지 않음)으로 끝난다. 자리는 그 요청이 끝나야 빈다. */
  submitCloser(frame: EngineFrame, dets: SceneDetection[], signal?: AbortSignal): Promise<VlmResult> | null {
    if (!this.closerFree() || signal?.aborted) return null;
    this.closers++;
    return new Promise((resolve) => this.start(frame, dets, resolve, () => this.closers--, signal));
  }

  /** 요청 하나: 끝나면(답·분석 없음·멈춤) 자리를 먼저 비우고 done에 한 번 넘긴다. 부른 쪽이 끊으면(signal) 요청을 끊고 done에 먼저 넘기며, 자리는 요청이 끝날 때 빈다. */
  private start(frame: EngineFrame, dets: SceneDetection[], done: (r: VlmResult) => void, free: () => void, signal?: AbortSignal): void {
    this.sent++;
    const ac = new AbortController();
    this.controllers.add(ac);
    const timer = setTimeout(() => ac.abort(new Error("시간 초과")), this.o.timeoutMs ?? 20_000);
    timer.unref?.();
    let settled = false;
    let freed = false;
    const release = () => {
      if (freed) return;
      freed = true;
      free();
    };
    const answer = (r: VlmResult) => {
      if (settled) return;
      settled = true;
      this.settlers.delete(stopNow);
      signal?.removeEventListener("abort", cancel);
      done(r);
    };
    const settle = (r: VlmResult) => {
      release();
      answer(r);
    };
    const quiet = (): VlmResult => ({ frameId: frame.id, capturedAtMs: frame.capturedAtMs, scene: null, missing: "error", costUsd: 0 });
    const stopNow = () => settle(quiet());
    const cancel = () => {
      ac.abort(new Error("끊김"));
      answer(quiet());
    };
    this.settlers.add(stopNow);
    signal?.addEventListener("abort", cancel, { once: true });
    let call: Promise<Analysis>;
    try {
      call = this.o.analyze(frame, dets, ac.signal);
    } catch (e) {
      call = Promise.reject(e);
    }
    const job: Promise<void> = call.then(
      (r) => {
        if (this.stopped) return settle(this.miss(frame, "error"));
        this.cost += r.costUsd;
        if (settled) return release(); // 부른 쪽이 끊은 요청: 답은 이미 넘겼다
        if (ac.signal.aborted) return settle(this.miss(frame, "timeout", r.costUsd));
        if (!r.scene) return settle(this.miss(frame, r.error?.includes("형식") ? "format" : "error", r.costUsd));
        settle({ frameId: frame.id, capturedAtMs: frame.capturedAtMs, scene: r.scene, costUsd: r.costUsd });
      },
      () => (settled ? release() : settle(this.miss(frame, !this.stopped && ac.signal.aborted ? "timeout" : "error"))),
    ).finally(() => {
      clearTimeout(timer);
      this.controllers.delete(ac);
      this.running.delete(job);
      release();
    });
    this.running.add(job);
  }

  stats(): { sent: number; missing: Record<PoolMissing, number>; inflight: number; costUsd: number } {
    return { sent: this.sent, missing: { ...this.missing }, inflight: this.running.size, costUsd: Math.round(this.cost * 1e5) / 1e5 };
  }

  async idle(): Promise<void> {
    while (this.running.size) await Promise.all([...this.running]);
  }

  /** 멈추면 나가 있는 요청을 모두 끊고, 그 뒤 끝난 답은 내지 않는다. 기다리던 가까이 보기는 바로 분석 없음(error)으로 끝난다. */
  stop(): void {
    this.stopped = true;
    for (const ac of this.controllers) ac.abort(new Error("멈춤"));
    for (const stopNow of [...this.settlers]) stopNow();
  }
}
