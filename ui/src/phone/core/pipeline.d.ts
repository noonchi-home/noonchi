// pipeline.js의 형(테스트에서 TypeScript로 부른다).
export interface FramePipeline { readonly inFlight: number; canStart(): boolean; start(): number; finish(id: number): boolean; fail(id?: number): void }
export function createFramePipeline(opts?: { maxInFlight?: number }): FramePipeline;
export interface SendSnapshot { fps: number; readMs: number | null; encodeMs: number | null; kbPerFrame: number | null; skipped: { encoding: number; buffer: number; stale: number; engine: number } }
export function createSendStats(opts?: { windowMs?: number; now?: () => number }): {
  sent(e: { bytes: number; readMs: number; encodeMs: number }): void;
  skipped(reason: "encoding" | "buffer" | "stale" | "engine"): void;
  snapshot(): SendSnapshot;
};
export function frameWidth(param: string | null | undefined): number;
