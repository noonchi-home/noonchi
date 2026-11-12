// engine.js의 형(테스트에서 TypeScript로 부른다).
export function engineDue(lastMs: number | null, nowMs: number, intervalMs: number): boolean;
export function engineSlot(lastMs: number | null, nowMs: number, intervalMs: number): number | null;
export type EngineAction = "wait" | "send" | "encoding" | "buffer";
export function engineStep(o: { last: number | null; now: number; intervalMs: number; canStart: boolean; buffered: number; maxBuffered: number }): { last: number | null; action: EngineAction };
export function grabOnce(
  grab: (width: number, height: number) => Uint8Array, wants: readonly ({ width: number; height: number } | null)[], now?: () => number,
): ({ pixels: Uint8Array; readMs: number } | null)[];
