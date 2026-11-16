// 빠른 프레임과 VLM 프레임: 모든 엔진 프레임에 YOLO를 돌리고, VLM 프레임 간격마다 한 장만 VLM·기록에 쓴다.

import { describe, expect, it, vi } from "vitest";
import type { Detector } from "../src/observe/detector.js";
import type { BrainLog, SeenEvent } from "../src/contract/events.js";
import type { VlmClient } from "../src/infer/vlm.js";
import { FAST_QUEUE_MAX, ObservationPipeline, loadObserveConfig, type ObserveConfig } from "../src/observe/pipeline.js";
import { WorldState } from "../src/world/state/world.js";
import { det } from "./helpers/detectors.js";

type Observe = Extract<BrainLog, { type: "observe" }>;
const jpeg = (i: number) => Buffer.from([0xff, 0xd8, i]);
const head = (at: number) => ({ kind: "engine" as const, width: 480, height: 360, captured_at: at, time_err_ms: 0 });
const CUP = det("cup", 0.9, [220, 160, 40, 20]);
const FAST: ObserveConfig = { engineMs: 100, vlmMs: 2000, vlmMaxInflight: 4, vlmTimeoutMs: 5000, detectQueueMax: 8, keepMs: 20_000 };

/** 관찰 흐름 하나. 감지기는 부른 횟수를 세고(fail이면 오류), VLM은 받은 사진(셋째 바이트 = 프레임 번호)과 글을 적는다. hold면 감지를 gates에 붙잡아 둔다. */
function setup(config: ObserveConfig, o: { hold?: boolean; fail?: () => boolean; detector?: null; delayMs?: number } = {}) {
  const logs: BrainLog[] = [];
  const seen: SeenEvent[] = [];
  const calls: { images: number[]; captions: string[] }[] = [];
  const gates: (() => void)[] = [];
  const detected: number[] = [];
  const detector = {
    name: "counting", provider: "test",
    detect: async (bytes: Buffer) => {
      detected.push(bytes[2]!);
      if (o.hold) await new Promise<void>((ok) => gates.push(ok));
      if (o.delayMs) await new Promise<void>((ok) => setTimeout(ok, o.delayMs));
      if (o.fail?.()) throw new Error("onnx");
      return { detections: [CUP], ms: 1, width: 480, height: 360 };
    },
  } as Detector;
  const vlm = { model: "w", json: async (req: { images: Buffer[]; captions: string[] }) => {
    calls.push({ images: req.images.map((b) => b[2]!), captions: req.captions });
    return { value: { scene: "k", observations: [], summary: "s" }, costUsd: 0, model: "w", attempts: 1 };
  } } as unknown as VlmClient;
  const world = new WorldState({ surfaces: () => [], floorAt: () => 0, roomAt: () => null, devices: () => [] });
  const p = new ObservationPipeline({
    config, detector: o.detector === null ? null : detector, vlm, world, emit: (l) => logs.push(l), broadcastWorld: () => {}, onSeen: (e) => seen.push(e),
  });
  const observed = () => logs.filter((l): l is Observe => l.type === "observe");
  /** i번째 프레임(촬영 시각 i × stepMs). */
  const send = (i: number, stepMs = 100) => p.onEngine(jpeg(i), head(i * stepMs), null, null, i * stepMs + 5);
  return { p, world, logs, seen, calls, gates, detected, observed, send };
}

describe("빠른 프레임과 VLM 프레임", () => {
  it("100ms 간격 40장(4초): YOLO는 40번, VLM 제출은 2번(0초·2초 프레임)이고 observe 기록은 VLM 프레임에만 남는다. 빠른 프레임은 seen만 낸다", async () => {
    const s = setup(FAST);
    for (let i = 0; i < 40; i++) { s.send(i); await s.p.idle(); }
    expect(s.detected).toHaveLength(40);
    expect(s.calls.map((c) => c.images)).toEqual([[0], [0, 20]]);
    // 기록: VLM 프레임 2장의 YOLO 줄 2개 + VLM 답 2개
    expect(s.observed().map((l) => [l.frame_id, l.yolo, l.vlm])).toEqual([["e1", "컵 0.90", null], ["e1", null, "s"], ["e21", "컵 0.90", null], ["e21", null, "s"]]);
    for (const l of s.observed()) {
      expect(l).not.toHaveProperty("boxes");
      expect(l).not.toHaveProperty("frame");
    }
    // 모양은 장마다
    expect(s.seen).toHaveLength(40);
    expect(s.seen[7]).toEqual({ type: "seen", at_ms: expect.any(Number), frame_id: "e8", captured_at_ms: 700, frame: { width: 480, height: 360 }, shapes: [{ label: "cup", score: 0.9, mask: CUP.mask }] });
    expect(s.p.status()).toMatchObject({ frames: 40, detected: 40, skipped: 0, queued: 0, vlm: { sent: 2 } });
    // 빠른 프레임도 World State에 들어간다: 처음 본 뒤 4초인 41번째 장에 컵 등장
    expect(s.world.view(3900).objects).toEqual([]);
    s.send(40);
    await s.p.idle();
    expect(s.world.view(4000).objects.map((o) => [o.id, o.first_seen_ms, o.last_seen_ms])).toEqual([["cup_1", 0, 4000]]);
    expect(s.logs.filter((l) => l.type === "world_change" && l.kind !== "vlm").map((l) => l.type === "world_change" && l.kind)).toEqual(["appeared"]);
    await s.p.close();
  });

  it("VLM 창은 VLM 프레임만 고른다: 5장이면 8초 폭이다", async () => {
    const s = setup(FAST);
    for (let i = 0; i <= 100; i++) { s.send(i); await s.p.idle(); }
    expect(s.calls).toHaveLength(6);
    expect(s.calls.at(-1)!.images).toEqual([20, 40, 60, 80, 100]);
    expect(s.calls.at(-1)!.captions).toEqual(["Photo 1 of 5, t-8s", "Photo 2 of 5, t-6s", "Photo 3 of 5, t-4s", "Photo 4 of 5, t-2s", "Photo 5 of 5, t-0s (latest)"]);
    await s.p.close();
  });

  it("최신 우선: 감지가 밀리면 대기열의 빠른 프레임을 2장만 두고 오래된 것부터 기록 없이 버린다. VLM 프레임은 버리지 않는다", async () => {
    expect(FAST_QUEUE_MAX).toBe(2);
    const s = setup(FAST, { hold: true });
    for (let i = 0; i <= 22; i++) s.send(i); // 0번(VLM 프레임)을 감지하는 동안 1~22번이 쌓인다. 20번은 VLM 프레임
    expect(s.p.status()).toMatchObject({ queued: 3, skipped: 19 });
    while (s.detected.length < 4 || s.gates.length) { s.gates.shift()?.(); await new Promise((r) => setTimeout(r, 1)); }
    await s.p.idle();
    expect(s.detected).toEqual([0, 20, 21, 22]);
    expect(s.observed().some((l) => l.yolo_missing !== undefined)).toBe(false);
    expect(s.observed().filter((l) => l.yolo !== null).map((l) => l.frame_id)).toEqual(["e1", "e21"]);
    expect(s.seen.map((e) => e.frame_id)).toEqual(["e1", "e21", "e22", "e23"]);
    expect(s.p.status()).toMatchObject({ detected: 4, skipped: 19, yolo_missing: { cap: 0, error: 0, stale: 0 } });
    await s.p.close();
  });

  it("감지 모델 yolo26s-seg 속도(한 장 144ms, 초당 약 7장)·엔진 프레임 100ms: 10초 동안 VLM 프레임은 모두 감지하고 분석 없음(cap)이 없다. 대기열은 빠른 프레임 FAST_QUEUE_MAX장 + VLM 프레임 안이고 끝나면 빈다. 컵은 처음 본 뒤 4초에 감지 지연(약 0.5초 안)만큼 늦게 나온다", async () => {
    vi.useFakeTimers({ now: 0 });
    try {
      // 144ms: dml에서 잰 yolo26s-seg 한 장 전체(scripts/brain-yolo-bench.ts, 2026-11-16)
      const s = setup(FAST, { delayMs: 144 });
      let most = 0;
      for (let i = 0; i <= 100; i++) {
        s.send(i);
        most = Math.max(most, s.p.status().queued);
        await vi.advanceTimersByTimeAsync(100);
      }
      await vi.advanceTimersByTimeAsync(2000);
      await s.p.idle();
      const st = s.p.status();
      expect(st.yolo_missing).toEqual({ cap: 0, error: 0, stale: 0 });
      expect(most).toBeLessThanOrEqual(FAST_QUEUE_MAX + 1);
      expect(most).toBeLessThan(FAST.detectQueueMax);
      expect(st.queued).toBe(0);
      for (const v of [0, 20, 40, 60, 80, 100]) expect(s.detected, `VLM 프레임 ${v}`).toContain(v);
      // 10초 × 약 7장
      expect(st.detected).toBeGreaterThanOrEqual(65);
      expect(st.detected + st.skipped).toBe(101);
      expect(s.calls).toHaveLength(6);
      const cup = s.world.view(10_000).objects.find((x) => x.cls === "cup")!;
      expect(cup.first_seen_ms).toBe(0);
      const appeared = s.logs.find((l) => l.type === "world_change" && l.kind === "appeared");
      expect(appeared && appeared.type === "world_change" ? appeared.at_ms : null).toBeGreaterThanOrEqual(4000);
      // 등장 줄 시각은 감지를 마친 때다: 4초 뒤 장이 대기열(빠른 프레임 2장)을 지나 감지되기까지 144ms × 3 + 엔진 간격 안
      expect(appeared && appeared.type === "world_change" ? appeared.at_ms : null).toBeLessThanOrEqual(4000 + 3 * 144 + 100);
      await s.p.close();
    } finally {
      vi.useRealTimers();
    }
  });

  it("대기열이 찼을 때 VLM 프레임은 기다리는 빠른 프레임을 밀어내고 들어간다. 빠른 프레임이 없을 때만 YOLO·VLM 분석 없음(cap)이다", async () => {
    const s = setup({ ...FAST, detectQueueMax: 2 }, { hold: true });
    s.send(0); // 감지 중
    s.send(1);
    s.send(2); // 대기열 [1, 2]
    s.send(20); // VLM 프레임: 1을 밀어내고 [2, 20]
    expect(s.p.status()).toMatchObject({ queued: 2, skipped: 1 });
    s.send(40); // VLM 프레임: 2를 밀어내고 [20, 40]
    s.send(60); // VLM 프레임: 밀어낼 빠른 프레임이 없다
    expect(s.p.status()).toMatchObject({ queued: 2, skipped: 2, yolo_missing: { cap: 1 } });
    expect(s.observed().filter((l) => l.yolo_missing === "cap")).toEqual([expect.objectContaining({ frame_id: "e6", vlm_missing: "cap" })]);
    while (s.detected.length < 3 || s.gates.length) { s.gates.shift()?.(); await new Promise((r) => setTimeout(r, 1)); }
    await s.p.idle();
    expect(s.detected).toEqual([0, 20, 40]);
    await s.p.close();
  });

  it("감지가 실패한 빠른 프레임은 셈만 하고 기록·World State 분석 없음·VLM 없이 넘어간다. VLM 프레임의 실패는 지금처럼 기록하고 VLM에 보낸다", async () => {
    let fail = false;
    const s = setup(FAST, { fail: () => fail });
    s.send(0);
    await s.p.idle();
    fail = true;
    for (let i = 1; i <= 20; i++) { s.send(i); await s.p.idle(); }
    expect(s.p.status().yolo_missing.error).toBe(20);
    expect(s.observed().filter((l) => l.yolo_missing === "error").map((l) => l.frame_id)).toEqual(["e21"]);
    expect(s.world.view(2000).yolo_missing).toBe(1);
    expect(s.calls).toHaveLength(2);
    expect(s.seen).toHaveLength(1);
    await s.p.close();
  });

  it("감지기가 없으면 VLM 프레임만 「감지기 없음」으로 기록하고 VLM에 보낸다", async () => {
    const s = setup(FAST, { detector: null });
    for (let i = 0; i <= 20; i++) { s.send(i); await s.p.idle(); }
    expect(s.observed().filter((l) => l.yolo !== null).map((l) => [l.frame_id, l.yolo])).toEqual([["e1", "감지기 없음"], ["e21", "감지기 없음"]]);
    expect(s.calls).toHaveLength(2);
    expect(s.seen).toEqual([]);
    await s.p.close();
  });

  it("ENGINE_FRAME_MS=2000 VLM_FRAME_MS=2000이면 프레임마다 YOLO 줄과 VLM 답이 하나씩 남는다(옛 동작)", async () => {
    const s = setup(loadObserveConfig({ ENGINE_FRAME_MS: "2000", VLM_FRAME_MS: "2000" }));
    for (let i = 0; i < 4; i++) { s.send(i, 2000); await s.p.idle(); }
    expect(s.observed().map((l) => [l.frame_id, l.yolo !== null, l.vlm !== null])).toEqual([
      ["e1", true, false], ["e1", false, true], ["e2", true, false], ["e2", false, true], ["e3", true, false], ["e3", false, true], ["e4", true, false], ["e4", false, true],
    ]);
    expect(s.calls.map((c) => c.images.length)).toEqual([1, 2, 3, 4]);
    expect(s.seen).toHaveLength(4);
    await s.p.close();
  });
});

describe("관찰 흐름 설정: 두 간격", () => {
  it("엔진 프레임 기본 100ms(50 이상), VLM 프레임 기본 2000ms(mock은 VLM을 시간당 약 1,800번 부른다)", () => {
    expect(loadObserveConfig({})).toMatchObject({ engineMs: 100, vlmMs: 2000, vlmMaxInflight: 4, detectQueueMax: 8, keepMs: 20_000 });
    expect(3_600_000 / loadObserveConfig({}).vlmMs!).toBe(1800);
    expect(loadObserveConfig({ ENGINE_FRAME_MS: "50" }).engineMs).toBe(50);
    expect(() => loadObserveConfig({ ENGINE_FRAME_MS: "49" })).toThrow(/ENGINE_FRAME_MS=49/);
  });

  it("VLM_FRAME_MS는 ENGINE_FRAME_MS 이상이어야 한다. 엔진 간격만 2초보다 길게 주면 VLM도 그 간격이다", () => {
    expect(loadObserveConfig({ ENGINE_FRAME_MS: "150", VLM_FRAME_MS: "3000" })).toMatchObject({ engineMs: 150, vlmMs: 3000 });
    expect(() => loadObserveConfig({ ENGINE_FRAME_MS: "500", VLM_FRAME_MS: "400" })).toThrow(/VLM_FRAME_MS=400/);
    expect(loadObserveConfig({ ENGINE_FRAME_MS: "5000" })).toMatchObject({ engineMs: 5000, vlmMs: 5000 });
    expect(loadObserveConfig({ ENGINE_FRAME_MS: "500" })).toMatchObject({ engineMs: 500, vlmMs: 2000 });
  });

  it("고리는 20초, VLM 창 시간(창 크기 × VLM 프레임 간격)이 더 길면 창 시간", () => {
    expect(loadObserveConfig({ VLM_WINDOW_FRAMES: "8", VLM_FRAME_MS: "5000" }).keepMs).toBe(40_000);
    expect(loadObserveConfig({ VLM_WINDOW_FRAMES: "8" }).keepMs).toBe(20_000);
  });
});
