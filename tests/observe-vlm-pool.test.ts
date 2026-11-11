import { describe, expect, it } from "vitest";
import { VlmPool, type VlmResult } from "../src/observe/vlm-pool.js";
import { sha256, type EngineFrame } from "../src/observe/ring.js";

const f = (id: string, at: number): EngineFrame => ({ id, capturedAtMs: at, latestAtMs: at, jpeg: Buffer.from(id), sha256: sha256(Buffer.from(id)), width: 1, height: 1, eye: null, view: null });
const scene = { scene: "s", observations: [], summary: "x" };

describe("VLM 동시 요청", () => {
  it("상한까지 기다리지 않고 보내고, 넘친 프레임은 VLM 분석 없음(cap)으로 낸다", async () => {
    const out: VlmResult[] = [];
    const gates: (() => void)[] = [];
    const pool = new VlmPool({ maxInflight: 2, onResult: (r) => out.push(r),
      analyze: () => new Promise((ok) => gates.push(() => ok({ scene, costUsd: 0 }))) });
    expect(pool.submit(f("a", 1), [])).toBe("sent");
    expect(pool.submit(f("b", 2), [])).toBe("sent");
    expect(pool.submit(f("c", 3), [])).toBe("skipped");
    expect(out).toEqual([{ frameId: "c", capturedAtMs: 3, scene: null, missing: "cap", costUsd: 0 }]);
    gates[1]!(); gates[0]!();
    await pool.idle();
    expect(out.slice(1).map((r) => r.frameId)).toEqual(["b", "a"]);   // 답 순서대로, 프레임 번호로 짝 맞춤
  });
  it("시간 초과·형식 오류도 VLM 분석 없음으로 낸다", async () => {
    const out: VlmResult[] = [];
    const untilAbort = (signal: AbortSignal) => new Promise<never>((_, no) => signal.addEventListener("abort", () => no(signal.reason)));
    const pool = new VlmPool({ maxInflight: 4, timeoutMs: 10, onResult: (r) => out.push(r),
      analyze: async (fr, _d, signal) => (fr.id === "late" ? untilAbort(signal) : { scene: null, costUsd: 0, error: "형식이 2번 틀림" }) });
    pool.submit(f("late", 1), []); pool.submit(f("bad", 2), []);
    await pool.idle();
    expect(out.map((r) => [r.frameId, r.missing])).toEqual(expect.arrayContaining([["late", "timeout"], ["bad", "format"]]));
    expect(pool.stats().missing).toMatchObject({ timeout: 1, format: 1 });
  });
  it("시간 초과면 요청을 끊고, 끊긴 뒤에야 자리가 비어 동시 요청이 상한을 넘지 않는다", async () => {
    let live = 0, peak = 0;
    const signals: AbortSignal[] = [];
    const pool = new VlmPool({ maxInflight: 1, timeoutMs: 10, onResult: () => {},
      analyze: (_fr, _d, signal) => { live++; peak = Math.max(peak, live); signals.push(signal);
        return new Promise((_, no) => signal.addEventListener("abort", () => { live--; no(signal.reason); })); } });
    pool.submit(f("a", 1), []);
    expect(pool.submit(f("b", 2), [])).toBe("skipped");
    await pool.idle();
    expect(signals[0]!.aborted).toBe(true);
    expect(pool.stats().inflight).toBe(0);
    expect(pool.submit(f("c", 3), [])).toBe("sent");
    await pool.idle();
    expect(peak).toBe(1);
  });
  it("가까이 보기 자리는 따로 있다: 보통 프레임이 상한을 다 써도 가까이 보기는 가고, 그 자리가 차 있으면 null이다. 답은 onResult가 아니라 돌려준 약속으로 온다", async () => {
    const out: VlmResult[] = [];
    const gates = new Map<string, () => void>();
    const pool = new VlmPool({ maxInflight: 1, closerSlots: 1, onResult: (r) => out.push(r),
      analyze: (fr) => new Promise((ok) => gates.set(fr.id, () => ok({ scene, costUsd: 0.001 }))) });
    expect(pool.submit(f("a", 1), [])).toBe("sent");
    expect(pool.submit(f("b", 2), [])).toBe("skipped");
    expect(pool.closerFree()).toBe(true);
    const answer = pool.submitCloser(f("c", 3), []);
    expect(answer).not.toBeNull();
    expect(pool.closerFree()).toBe(false);
    expect(pool.submitCloser(f("d", 4), [])).toBeNull();
    expect(pool.submit(f("e", 5), [])).toBe("skipped");   // 가까이 보기 자리는 보통 프레임이 쓰지 않는다
    gates.get("c")!();
    expect(await answer).toEqual({ frameId: "c", capturedAtMs: 3, scene, costUsd: 0.001 });
    expect(pool.closerFree()).toBe(true);
    gates.get("a")!();
    await pool.idle();
    expect(out.map((r) => [r.frameId, r.missing])).toEqual([["b", "cap"], ["e", "cap"], ["a", undefined]]);
    expect(pool.stats()).toMatchObject({ sent: 2, costUsd: 0.002, inflight: 0 });
  });
  it("가까이 보기 자리를 두지 않으면 가까이 보기를 보내지 않는다. 멈추면 나가 있는 가까이 보기는 답을 기다리지 않고 분석 없음(error)으로 끝난다", async () => {
    expect(new VlmPool({ maxInflight: 1, onResult: () => {}, analyze: async () => ({ scene, costUsd: 0 }) }).submitCloser(f("x", 1), [])).toBeNull();
    const pool = new VlmPool({ maxInflight: 1, closerSlots: 1, timeoutMs: 60_000, onResult: () => {}, analyze: () => new Promise(() => {}) });
    const answer = pool.submitCloser(f("c", 3), [])!;
    pool.stop();
    expect(await answer).toEqual({ frameId: "c", capturedAtMs: 3, scene: null, missing: "error", costUsd: 0 });
    expect(pool.closerFree()).toBe(false);
    expect(pool.submitCloser(f("d", 4), [])).toBeNull();
  });
  it("멈추면 나가 있는 요청을 끊고 결과를 내지 않는다", async () => {
    const out: VlmResult[] = [];
    let aborted = false;
    const pool = new VlmPool({ maxInflight: 2, timeoutMs: 60_000, onResult: (r) => out.push(r),
      analyze: (_fr, _d, signal) => new Promise((_, no) => signal.addEventListener("abort", () => { aborted = true; no(signal.reason); })) });
    pool.submit(f("a", 1), []);
    pool.stop();
    await pool.idle();
    expect(aborted).toBe(true);
    expect(out).toEqual([]);
    expect(pool.submit(f("b", 2), [])).toBe("skipped");
  });
});
