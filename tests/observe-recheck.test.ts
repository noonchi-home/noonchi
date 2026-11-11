// 약한 후보 다시 보기(관찰 흐름 drain): 전체 사진의 약한 물건 후보 자리를 2배로 잘라 같은 감지기로 다시 보고, 받은 감지를 그 프레임 감지에 넣는다.
import { describe, expect, it, vi } from "vitest";
import type { DetectResult, Detection } from "../src/brain/detector.js";
import type { BrainLog } from "../src/contract/events.js";
import type { VlmClient } from "../src/infer/vlm.js";
import { ObservationPipeline, RECHECK_IOU, RECHECK_MAX, RECHECK_MIN } from "../src/observe/pipeline.js";
import { sha256 } from "../src/observe/ring.js";
import { WorldState } from "../src/world/state.js";
import { frameJpeg, LOOK_SIZE } from "./helpers/camera.js";
import { WeakSplitDetector } from "./helpers/detectors.js";

type Box = [number, number, number, number];
const COCO: Partial<Record<Detection["label"], number>> = { person: 0, bottle: 39, cup: 41, fork: 42, bowl: 45, sink: 71 };
const det = (label: Detection["label"], score: number, box: Box): Detection => ({ label, score, box, cls: COCO[label]! });

// 480×360 엔진 프레임. 40×50 후보 상자가 그림 안쪽이면 잘라 보는 상자(240×180)는 후보 가운데에 놓이고,
// 잘라 키운 사진 가운데 상자 CENTER [200, 130, 80, 100]은 엔진 프레임에서 그 후보 상자 그대로다.
const GLASS: Box = [200, 150, 40, 50];   // 잘라 보는 상자 [100, 85, 240, 180]
const CENTER: Box = [200, 130, 80, 100];
const A: Box = [130, 95, 40, 50], B: Box = [310, 95, 40, 50], C: Box = [130, 215, 40, 50], D: Box = [310, 215, 40, 50];
// 그림 왼쪽 끝 후보: 잘라 보는 상자 [0, 85, 240, 180]이 그림 안으로 붙어 후보가 잘라 본 경계에 닿는다
const EDGE: Box = [0, 150, 40, 50];

/** 관찰 흐름 하나. full(n)은 n번째 엔진 프레임 전체 사진 감지(0.25 미만은 weak), crop(k)은 k번째로 잘라 키운 사진 감지. frame()은 2초 간격 엔진 프레임 하나를 넣고 끝까지 기다린다. */
function setup(full: (n: number) => Detection[], crop?: (k: number) => Detection[] | Error) {
  const engine = new Set<string>();
  const nOf = new Map<string, number>();
  const logs: BrainLog[] = [];
  const texts: string[] = [];
  const detected: DetectResult[] = [];
  const vlm = {
    model: "v",
    json: async (req: { texts: string[] }) => {
      texts.push(req.texts.join("\n"));
      return { value: { scene: "kitchen", observations: [], summary: "s" }, costUsd: 0, model: "v", attempts: 1 };
    },
  } as unknown as VlmClient;
  const world = new WorldState({ surfaces: () => [], floorAt: () => 0, roomAt: () => null, devices: () => [] });
  const applied = vi.spyOn(world, "applyDetections");
  const detector = new WeakSplitDetector(engine, (jpeg) => full(nOf.get(sha256(jpeg))!), crop);
  const p = new ObservationPipeline({
    config: { engineMs: 2000, vlmMaxInflight: 4, vlmTimeoutMs: 5000, detectQueueMax: 8, keepMs: 20_000 },
    detector, vlm, world, emit: (l) => logs.push(l), broadcastWorld: () => {}, onDetected: (_, r) => detected.push(r),
  });
  let n = 0;
  const frame = async () => {
    const jpeg = frameJpeg(++n, [[0, 0, 8, 8]]);   // 잘라 보는 자리 밖 표시: 고른 회색만이면 잘라 키운 사진이 엔진 사진과 같은 JPEG이 된다
    engine.add(sha256(jpeg));
    nOf.set(sha256(jpeg), n);
    p.onEngine(jpeg, { kind: "engine", ...LOOK_SIZE, captured_at: n * 2000, time_err_ms: 0 }, null, null, n * 2000 + 5);
    await p.idle();
  };
  /** i번째(0부터) 엔진 프레임에 World State가 받은 감지. */
  const input = (i: number) => applied.mock.calls[i]![1];
  /** i번째(0부터) 엔진 프레임의 YOLO 결과 기록. */
  const yoloLog = (i: number) => logs.filter((l) => l.type === "observe" && l.boxes)[i];
  return { p, world, texts, detector, detected, frame, input, yoloLog };
}

describe("약한 후보 다시 보기(관찰 흐름)", () => {
  it("값: 후보 하한 0.1, 프레임마다 3개, 받는 IoU 0.3", () => {
    expect([RECHECK_MIN, RECHECK_MAX, RECHECK_IOU]).toEqual([0.1, 3, 0.3]);
  });

  it("전체 사진의 약한 병 0.13 자리를 2배로 잘라 같은 감지기로 다시 보고, 그 자리 컵 0.56을 엔진 프레임 픽셀 상자로 그 프레임 감지에 넣는다. 3장 연속이면 컵이 등장하고 VLM 상자 목록에도 컵이 있다", async () => {
    const s = setup(() => [det("bottle", 0.13, GLASS)], () => [det("cup", 0.56, CENTER)]);
    expect(s.p.status().recheck).toEqual({ tried: 0, found: 0, ms: null });
    await s.frame();
    expect(s.input(0)).toEqual([det("cup", 0.56, GLASS)]);
    expect(s.yoloLog(0)).toMatchObject({ yolo: "컵 0.56", boxes: [{ label: "cup", score: 0.56, box: GLASS }] });
    expect(s.texts[0]).toContain(`Detections: [{"id":"d1","class":"cup","box":[200,150,40,50]}]`);
    // 위치 맞추기는 감지기 결과 그대로 받는다(0.25 이상 감지, 다시 본 컵 없음)
    expect(s.detected[0]!.detections).toEqual([]);
    await s.frame();
    expect(s.world.view(4000).objects).toEqual([]);
    await s.frame();
    expect(s.world.view(6000).objects).toEqual([expect.objectContaining({ cls: "cup", status: "present" })]);
    expect(s.detector.crops).toBe(3);
    expect(s.p.status().recheck).toEqual({ tried: 3, found: 3, ms: expect.any(Number) });
    await s.p.close();
  });

  it("사람·가전 설비 후보, 0.1 미만, 그 종류 기준 이상 감지는 다시 보지 않는다", async () => {
    const s = setup(() => [det("person", 0.3, A), det("sink", 0.3, B), det("bottle", 0.09, C), det("cup", 0.42, D)], () => [det("cup", 0.6, CENTER)]);
    await s.frame();
    expect(s.detector.crops).toBe(0);
    expect(s.input(0)).toEqual([det("cup", 0.42, D)]);
    expect(s.p.status().recheck).toEqual({ tried: 0, found: 0, ms: null });
    await s.p.close();
  });

  it("후보가 넷이면 점수 높은 셋만 다시 본다. 기준은 종류마다다: 포크 0.3(기준 0.45)도 후보다", async () => {
    const s = setup(() => [det("fork", 0.3, B), det("bottle", 0.2, A), det("cup", 0.15, C), det("bowl", 0.11, D)], () => [det("cup", 0.6, CENTER)]);
    await s.frame();
    expect(s.detector.crops).toBe(3);
    expect(s.input(0)).toHaveLength(3);
    expect(s.input(0)).toEqual(expect.arrayContaining([det("cup", 0.6, A), det("cup", 0.6, B), det("cup", 0.6, C)]));
    expect(s.p.status().recheck).toMatchObject({ tried: 3, found: 3 });
    await s.p.close();
  });

  it("잘라 본 감지가 경계에 닿거나, 후보 상자와 IoU 0.3 미만이거나, 사람·기준 미만이면 받지 않고 그 후보도 넘기지 않는다. 여럿 받으면 점수 높은 것 하나, 종류는 다시 본 감지 것이다", async () => {
    const turns: Detection[][] = [
      [det("cup", 0.6, [250, 130, 80, 100])],                       // 엔진 프레임 [225, 150, 40, 50]: IoU 0.23
      [det("cup", 0.6, [240, 130, 80, 100])],                       // 엔진 프레임 [220, 150, 40, 50]: IoU 0.33
      [det("cup", 0.6, [0, 130, 80, 100])],                         // 엔진 프레임 EDGE: 잘라 본 경계에 닿음
      [det("person", 0.9, CENTER), det("cup", 0.3, CENTER)],       // 사람, 컵 기준(0.4) 미만
      [det("cup", 0.5, CENTER), det("bowl", 0.7, CENTER)],          // 그릇 0.7
      [],
    ];
    const cands = [det("bottle", 0.13, GLASS), det("bottle", 0.13, GLASS), det("bottle", 0.13, EDGE), det("bottle", 0.13, GLASS), det("bottle", 0.13, GLASS), det("fork", 0.3, GLASS)];
    const s = setup((n) => [cands[n - 1]!], (k) => turns[k]!);
    for (let i = 0; i < turns.length; i++) await s.frame();
    expect([0, 1, 2, 3, 4, 5].map(s.input)).toEqual([[], [det("cup", 0.6, [220, 150, 40, 50])], [], [], [det("bowl", 0.7, GLASS)], []]);
    expect(s.yoloLog(0)).toMatchObject({ boxes: [] });
    expect(s.yoloLog(5)).toMatchObject({ boxes: [] });
    expect(s.texts[0]).toContain("Detections: []");
    expect(s.p.status().recheck).toMatchObject({ tried: 6, found: 2 });
    await s.p.close();
  });

  it("다시 보는 감지기 오류는 그 후보만 버린다: 프레임 감지와 다른 후보는 그대로다", async () => {
    const strong = det("cup", 0.9, [400, 280, 40, 50]);
    const s = setup(() => [strong, det("bottle", 0.2, A), det("bowl", 0.15, C)], (k) => (k === 0 ? new Error("감지 실패") : [det("cup", 0.6, CENTER)]));
    await s.frame();
    expect(s.input(0)).toEqual([strong, det("cup", 0.6, C)]);
    expect(s.yoloLog(0)).toMatchObject({ yolo: "컵 0.90 · 컵 0.60" });
    expect(s.p.status().yolo_missing.error).toBe(0);
    expect(s.p.status().recheck).toMatchObject({ tried: 2, found: 1 });
    await s.p.close();
  });

  it("다시 본 감지가 그 프레임의 같은 종류 감지와 IoU 0.5 넘게 겹치면 넣지 않는다: 한 물건이 두 번 들어가지 않는다", async () => {
    const GLASS2: Box = [202, 150, 40, 50];
    const s = setup((n) => (n === 1 ? [det("cup", 0.8, GLASS), det("bottle", 0.13, GLASS2)] : [det("cup", 0.15, GLASS), det("bottle", 0.13, GLASS2)]), () => [det("cup", 0.56, CENTER)]);
    await s.frame();
    expect(s.input(0)).toEqual([det("cup", 0.8, GLASS)]);
    // 같은 유리컵의 약한 컵·병 후보가 둘 다 컵으로 다시 보여도 하나만
    await s.frame();
    expect(s.input(1)).toEqual([det("cup", 0.56, GLASS)]);
    expect(s.p.status().recheck).toMatchObject({ tried: 3, found: 1 });
    await s.p.close();
  });
});
