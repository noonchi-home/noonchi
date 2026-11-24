import type { TraceEvent, TraceOutput, TracePort, TraceRefs, TraceTarget } from "../contract/trace.js";

/** Observe an existing call without changing its result or performing an extra call. */
export async function measuredTrace<T>(
  trace: TracePort | undefined, event: TraceEvent, refs: TraceRefs, signal: AbortSignal | undefined,
  run: () => Promise<T>, output: (value: T) => TraceOutput | null,
  target?: TraceTarget,
): Promise<T> {
  if (!trace || signal?.aborted) return run();
  const row = trace.start(event, refs, undefined, target);
  try {
    const value = await run();
    const result = output(value);
    trace.finish(row, signal?.aborted ? "cancelled" : result ? "done" : "failed",
      signal?.aborted ? "stopped" : result ?? "failed");
    return value;
  } catch (error) {
    trace.finish(row, signal?.aborted ? "cancelled" : "failed", signal?.aborted ? "stopped" : "failed");
    throw error;
  }
}
