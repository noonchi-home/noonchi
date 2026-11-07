// VLM 동시 요청: 앞 답을 기다리지 않고 maxInflight까지 보낸다. 답은 프레임 번호로 맞춘다.
// 상한을 넘은 프레임·시간 초과·형식 오류·호출 오류는 버리지 않고 VLM 분석 없음으로 낸다.
// 시간 초과는 signal을 끊어 HTTP 요청까지 끊는다. 자리는 analyze가 끝나야 비므로 실제로 나가 있는 요청은 maxInflight를 넘지 않는다.
import type { EngineFrame } from "./ring.js";
import type { SceneDetection, SceneObservation } from "./scene.js";

export type VlmMissing = "cap" | "timeout" | "format" | "error";
export interface VlmResult { frameId: string; capturedAtMs: number; scene: SceneObservation | null; missing?: VlmMissing; costUsd: number }
type Analysis = { scene: SceneObservation | null; costUsd: number; error?: string };
type Analyze = (frame: EngineFrame, dets: SceneDetection[], signal: AbortSignal) => Promise<Analysis>;

export class VlmPool {
  private readonly running = new Set<Promise<void>>();
  private readonly controllers = new Set<AbortController>();
  private sent = 0;
  private cost = 0;
  private stopped = false;
  private readonly missing: Record<VlmMissing, number> = { cap: 0, timeout: 0, format: 0, error: 0 };
  constructor(private readonly o: { maxInflight: number; analyze: Analyze; onResult: (r: VlmResult) => void; timeoutMs?: number }) {}

  private miss(frame: EngineFrame, why: VlmMissing, costUsd = 0): void {
    this.missing[why]++;
    this.o.onResult({ frameId: frame.id, capturedAtMs: frame.capturedAtMs, scene: null, missing: why, costUsd });
  }

  /** 상한 안이면 바로 보낸다("sent"). 넘으면 VLM 분석 없음(cap)을 onResult로 내고 "skipped". 멈춘 뒤에는 아무것도 내지 않는다. */
  submit(frame: EngineFrame, dets: SceneDetection[]): "sent" | "skipped" {
    if (this.stopped) return "skipped";
    if (this.running.size >= this.o.maxInflight) {
      this.miss(frame, "cap");
      return "skipped";
    }
    this.sent++;
    const ac = new AbortController();
    this.controllers.add(ac);
    const timer = setTimeout(() => ac.abort(new Error("시간 초과")), this.o.timeoutMs ?? 20_000);
    timer.unref?.();
    let call: Promise<Analysis>;
    try {
      call = this.o.analyze(frame, dets, ac.signal);
    } catch (e) {
      call = Promise.reject(e);
    }
    const job: Promise<void> = call.then(
      (r) => {
        if (this.stopped) return;
        this.cost += r.costUsd;
        if (ac.signal.aborted) return this.miss(frame, "timeout", r.costUsd);
        if (!r.scene) return this.miss(frame, r.error?.includes("형식") ? "format" : "error", r.costUsd);
        this.o.onResult({ frameId: frame.id, capturedAtMs: frame.capturedAtMs, scene: r.scene, costUsd: r.costUsd });
      },
      () => {
        if (!this.stopped) this.miss(frame, ac.signal.aborted ? "timeout" : "error");
      },
    ).finally(() => {
      clearTimeout(timer);
      this.controllers.delete(ac);
      this.running.delete(job);
    });
    this.running.add(job);
    return "sent";
  }

  stats(): { sent: number; missing: Record<VlmMissing, number>; inflight: number; costUsd: number } {
    return { sent: this.sent, missing: { ...this.missing }, inflight: this.running.size, costUsd: Math.round(this.cost * 1e5) / 1e5 };
  }

  async idle(): Promise<void> {
    while (this.running.size) await Promise.all([...this.running]);
  }

  /** 멈추면 나가 있는 요청을 모두 끊고, 그 뒤 끝난 답은 내지 않는다. */
  stop(): void {
    this.stopped = true;
    for (const ac of this.controllers) ac.abort(new Error("멈춤"));
  }
}
