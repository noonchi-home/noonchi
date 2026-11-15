import { afterEach, describe, expect, it } from "vitest";
import { startFakeOpenAI, type FakeServer } from "../scripts/fake-openai.js";
import { VlmClient } from "../src/infer/vlm.js";
import { ObservationPipeline, loadObserveConfig } from "../src/observe/pipeline.js";
import { WorldState } from "../src/world/state.js";
import type { Detection, Detector } from "../src/brain/detector.js";
import { ScriptedDetector, det as mkDet } from "./helpers/detectors.js";
import { standing } from "./helpers/poses.js";
import type { BrainLog, SeenEvent } from "../src/contract/events.js";
import type { WorldView } from "../src/contract/world.js";

let fake: FakeServer | undefined;
afterEach(async () => { await fake?.close(); fake = undefined; });
const jpeg = (i: number) => Buffer.from([0xff, 0xd8, i]);
const cupDet = () => new ScriptedDetector(() => [mkDet("cup", 0.9, [10, 10, 10, 10], 41)]);
const until = async (ok: () => boolean) => { for (let i = 0; i < 200 && !ok(); i++) await new Promise((r) => setTimeout(r, 5)); };
/** 답을 시험이 풀 때까지 붙잡아 두는 VLM. 풀면 d1을 싱크대 안으로 답한다. */
function gatedVlm() {
  const gates: (() => void)[] = [];
  const vlm = { model: "gated", json: () => new Promise((ok) => {
    gates.push(() => ok({ value: { scene: "kitchen", observations: [{ object_id: "d1", state: "in_sink" }], summary: `s${gates.length}` }, costUsd: 0, model: "gated", attempts: 1 }));
  }) } as unknown as VlmClient;
  return { vlm, gates };
}
const head = (at: number) => ({ kind: "engine" as const, width: 100, height: 100, captured_at: at, time_err_ms: 0 });

describe("관찰 흐름", () => {
  it("엔진 프레임마다 YOLO와 VLM이 둘 다 분석하고, 같은 사진은 버리고, World State를 보낸다", async () => {
    fake = await startFakeOpenAI();
    const logs: BrainLog[] = [];
    const worlds: WorldView[] = [];
    const p = new ObservationPipeline({
      config: { engineMs: 1000, vlmMaxInflight: 4, vlmTimeoutMs: 5000, detectQueueMax: 8, keepMs: 20_000 },
      detector: new ScriptedDetector(() => [mkDet("cup", 0.9, [220, 160, 40, 20], 41)]),
      vlm: new VlmClient({ baseUrl: `${fake.url}/v1`, model: "m", apiKey: "", extraBody: {} }),
      world: new WorldState({ evidenceStepMs: 1000, surfaces: () => [], floorAt: () => 0, roomAt: () => null, devices: () => [] }),
      emit: (l) => logs.push(l), broadcastWorld: (w) => worlds.push(w),
    });
    for (let i = 1; i <= 3; i++) p.onEngine(jpeg(i), { kind: "engine", width: 480, height: 360, captured_at: i * 1000, time_err_ms: 0 }, null, null, i * 1000 + 5);
    p.onEngine(jpeg(3), { kind: "engine", width: 480, height: 360, captured_at: 4000, time_err_ms: 0 }, null, null, 4005);
    await p.idle();
    const answers = logs.filter((l) => l.type === "observe" && l.vlm !== null);
    expect(answers).toHaveLength(3);
    expect(fake.requests.filter((r) => r.path.endsWith("/chat/completions"))).toHaveLength(3);
    expect(p.status().duplicates).toBe(1);
    expect(worlds.at(-1)!.objects[0]).toMatchObject({ cls: "cup", facts: { contents: { value: "contents_unknown" } } });
    await p.close();
  });

  it("엔진 프레임마다 VLM을 한 번 부르고, 최근 프레임을 창 크기(기본 5장)까지 오래된 것부터 보낸다. 처음에는 있는 만큼, 창 시간보다 앞선 프레임은 빼고", async () => {
    const calls: { images: Buffer[]; captions: string[] }[] = [];
    const vlm = { model: "w", json: async (req: { images: Buffer[]; captions: string[] }) => {
      calls.push({ images: req.images, captions: req.captions });
      return { value: { scene: "k", observations: [], summary: "s" }, costUsd: 0.001, model: "w", attempts: 1 };
    } } as unknown as VlmClient;
    const p = new ObservationPipeline({ config: { engineMs: 2000, vlmMaxInflight: 1, vlmTimeoutMs: 5000, detectQueueMax: 8, keepMs: 20_000 }, detector: cupDet(), vlm,
      world: new WorldState({ evidenceStepMs: 1000, surfaces: () => [], floorAt: () => 0, roomAt: () => null, devices: () => [] }), emit: () => {}, broadcastWorld: () => {} });
    for (let i = 1; i <= 7; i++) {
      p.onEngine(jpeg(i), head(i * 2000), null, null, i * 2000 + 5);
      await p.idle();
    }
    // 앞 프레임과 16초 떨어진 프레임: 고리(20초)에는 앞 프레임이 남아 있어도 창(5장 × 2초 = 10초)보다 앞서므로 한 장만
    p.onEngine(jpeg(8), head(30_000), null, null, 30_005);
    await p.idle();
    expect(calls.map((c) => c.images.length)).toEqual([1, 2, 3, 4, 5, 5, 5, 1]);
    expect(calls[6]!.images.map((b) => b[2])).toEqual([3, 4, 5, 6, 7]);
    expect(calls[6]!.captions).toEqual(["Photo 1 of 5, t-8s", "Photo 2 of 5, t-6s", "Photo 3 of 5, t-4s", "Photo 4 of 5, t-2s", "Photo 5 of 5, t-0s (latest)"]);
    expect(calls[7]!.images.map((b) => b[2])).toEqual([8]);
    expect(p.status().vlm).toMatchObject({ sent: 8, costUsd: 0.008 });
    await p.close();
  });

  it("붙잡은 장면(held)은 같은 사진이어도 VLM 간격(기본 2초)마다 새 관찰로 받는다. held가 없는 같은 사진은 그대로 버린다", async () => {
    const run = async (held: boolean) => {
      let sent = 0;
      const vlm = { model: "w", json: async () => { sent++; return { value: { scene: "k", observations: [], summary: "s" }, costUsd: 0, model: "w", attempts: 1 }; } } as unknown as VlmClient;
      const p = new ObservationPipeline({ config: { engineMs: 100, vlmMs: 2000, vlmMaxInflight: 4, vlmTimeoutMs: 5000, detectQueueMax: 8, keepMs: 20_000 }, detector: null, vlm,
        world: new WorldState({ evidenceStepMs: 2000, surfaces: () => [], floorAt: () => 0, roomAt: () => null, devices: () => [] }), emit: () => {}, broadcastWorld: () => {} });
      p.onEngine(jpeg(1), head(1000), null, null, 1005);
      for (let t = 1100; t <= 7000; t += 100) p.onEngine(jpeg(1), { ...head(t), ...(held ? { held: true as const } : {}) }, null, null, t + 5);
      await p.idle();
      const s = p.status();
      await p.close();
      return { frames: s.frames, duplicates: s.duplicates, sent };
    };
    expect(await run(true)).toEqual({ frames: 4, duplicates: 57, sent: 4 });
    expect(await run(false)).toEqual({ frames: 1, duplicates: 60, sent: 1 });
  });

  it("엔진 프레임이 올 때마다(같은 사진·늦은 프레임 포함) onFrame을 부른다: 판단 시점이 관찰이 살아 있는지 본다", async () => {
    let frames = 0;
    const vlm = { model: "w", json: async () => ({ value: { scene: "k", observations: [], summary: "s" }, costUsd: 0, model: "w", attempts: 1 }) } as unknown as VlmClient;
    const p = new ObservationPipeline({ config: { engineMs: 2000, vlmMaxInflight: 4, vlmTimeoutMs: 5000, detectQueueMax: 8, keepMs: 20_000 }, detector: cupDet(), vlm,
      world: new WorldState({ evidenceStepMs: 1000, surfaces: () => [], floorAt: () => 0, roomAt: () => null, devices: () => [] }), emit: () => {}, broadcastWorld: () => {}, onFrame: () => frames++ });
    p.onEngine(jpeg(1), head(40_000), null, null, 40_005);
    p.onEngine(jpeg(1), head(42_000), null, null, 42_005);
    p.onEngine(jpeg(2), head(10_000), null, null, 42_100);
    await p.idle();
    expect(frames).toBe(3);
    await p.close();
    p.onEngine(jpeg(3), head(44_000), null, null, 44_005);
    expect(frames).toBe(3);
  });

  it("창 크기 1이면 그 프레임 한 장만 보낸다", async () => {
    const counts: number[] = [];
    const vlm = { model: "w", json: async (req: { images: Buffer[] }) => {
      counts.push(req.images.length);
      return { value: { scene: "k", observations: [], summary: "s" }, costUsd: 0, model: "w", attempts: 1 };
    } } as unknown as VlmClient;
    const p = new ObservationPipeline({ config: { engineMs: 2000, vlmMaxInflight: 1, vlmTimeoutMs: 5000, detectQueueMax: 8, keepMs: 20_000, vlmWindowFrames: 1 }, detector: cupDet(), vlm,
      world: new WorldState({ evidenceStepMs: 1000, surfaces: () => [], floorAt: () => 0, roomAt: () => null, devices: () => [] }), emit: () => {}, broadcastWorld: () => {} });
    for (let i = 1; i <= 3; i++) {
      p.onEngine(jpeg(i), head(i * 2000), null, null, i * 2000 + 5);
      await p.idle();
    }
    expect(counts).toEqual([1, 1, 1]);
    await p.close();
  });

  it("VLM 상한을 넘은 프레임은 VLM 분석 없음으로 기록한다", async () => {
    const logs: BrainLog[] = [];
    const hang = { json: () => new Promise(() => {}) } as unknown as VlmClient;
    const p = new ObservationPipeline({ config: { engineMs: 1000, vlmMaxInflight: 1, vlmTimeoutMs: 60_000, detectQueueMax: 8, keepMs: 20_000 }, detector: null, vlm: hang,
      world: new WorldState({ evidenceStepMs: 1000, surfaces: () => [], floorAt: () => 0, roomAt: () => null, devices: () => [] }), emit: (l) => logs.push(l), broadcastWorld: () => {} });
    p.onEngine(jpeg(1), { kind: "engine", width: 1, height: 1 }, null, null, 1000);
    p.onEngine(jpeg(2), { kind: "engine", width: 1, height: 1 }, null, null, 2000);
    expect(logs.filter((l) => l.type === "observe" && l.vlm_missing === "cap")).toHaveLength(1);
    expect(logs.filter((l) => l.type === "observe" && l.yolo !== null).map((l) => l.type === "observe" && l.yolo)).toEqual(["감지기 없음", "감지기 없음"]);
    await p.close();
  });

  it("감지기가 느려도 앞 프레임을 덮어쓰지 않고, 대기열을 넘친 프레임은 YOLO·VLM 분석 없음으로 남긴다", async () => {
    fake = await startFakeOpenAI();
    const logs: BrainLog[] = [];
    const slow = { detect: () => new Promise<{ detections: []; ms: number }>((ok) => setTimeout(() => ok({ detections: [], ms: 30 }), 30)), close: async () => {} } as unknown as Detector;
    const p = new ObservationPipeline({ config: { engineMs: 200, vlmMaxInflight: 4, vlmTimeoutMs: 5000, detectQueueMax: 3, keepMs: 20_000 }, detector: slow,
      vlm: new VlmClient({ baseUrl: `${fake.url}/v1`, model: "m", apiKey: "", extraBody: {} }),
      world: new WorldState({ evidenceStepMs: 1000, surfaces: () => [], floorAt: () => 0, roomAt: () => null, devices: () => [] }), emit: (l) => logs.push(l), broadcastWorld: () => {} });
    for (let i = 1; i <= 10; i++) p.onEngine(jpeg(i), { kind: "engine", width: 1, height: 1, captured_at: i * 10, time_err_ms: 0 }, null, null, i * 10 + 1);
    await p.idle();
    const observed = logs.filter((l): l is Extract<BrainLog, { type: "observe" }> => l.type === "observe");
    const ids = new Set(observed.map((l) => l.frame_id));
    expect([...ids].sort()).toEqual(Array.from({ length: 10 }, (_, i) => `e${i + 1}`).sort());       // 기록 없이 사라진 프레임이 없다
    const capped = observed.filter((l) => l.yolo_missing === "cap");
    expect(capped.length).toBeGreaterThan(0);
    expect(capped.every((l) => l.vlm_missing === "cap")).toBe(true);
    expect(capped.every((l) => !("boxes" in l) && !("frame" in l))).toBe(true);
    expect(observed.filter((l) => l.yolo !== null).length + capped.length).toBe(10);               // 나머지는 모두 YOLO를 거쳤다
    expect(p.status().yolo_missing.cap).toBe(capped.length);
    await p.close();
  });

  it("World State가 받지 않는 낮은 신뢰도 감지(사람 0.5·물건 0.4 아래)는 모양(seen)·YOLO 글·VLM 감지 목록에 넣지 않는다", async () => {
    const logs: BrainLog[] = [];
    const seen: SeenEvent[] = [];
    const sent: string[] = [];
    const vlm = { model: "cap", json: async (req: { texts: string[] }) => {
      sent.push(req.texts.join("\n"));
      return { value: { scene: "room", observations: [], summary: "s" }, costUsd: 0, model: "cap", attempts: 1 };
    } } as unknown as VlmClient;
    // 실제 폰 프레임에서 본 모양: 흐린 프레임의 사람 0.31·병 0.27 같은 낮은 점수 감지가 진짜 감지와 함께 나온다
    const frames: Detection[][] = [
      [
        mkDet("person", 0.62, [0, 0, 100, 300], 0),
        mkDet("person", 0.31, [200, 400, 80, 200], 0),
        mkDet("cup", 0.83, [50, 500, 40, 50], 41),
        mkDet("bottle", 0.27, [300, 600, 20, 60], 39),
      ],
      [mkDet("person", 0.49, [0, 0, 360, 780], 0), mkDet("bowl", 0.39, [10, 10, 50, 30], 45)],
    ];
    let n = 0;
    const p = new ObservationPipeline({ config: { engineMs: 1000, vlmMaxInflight: 4, vlmTimeoutMs: 5000, detectQueueMax: 8, keepMs: 20_000 },
      detector: new ScriptedDetector(() => frames[n++]!), vlm,
      world: new WorldState({ evidenceStepMs: 1000, surfaces: () => [], floorAt: () => 0, roomAt: () => null, devices: () => [] }), emit: (l) => logs.push(l), broadcastWorld: () => {}, onSeen: (e) => seen.push(e) });
    for (let i = 1; i <= 2; i++) p.onEngine(jpeg(i), { kind: "engine", width: 360, height: 780, captured_at: i * 1000, time_err_ms: 0 }, null, null, i * 1000 + 5);
    await p.idle();
    const yolo = (id: string) => logs.find((l): l is Extract<BrainLog, { type: "observe" }> => l.type === "observe" && l.frame_id === id && l.yolo !== null)!;
    expect(yolo("e1")).toMatchObject({ yolo: "사람 0.62 · 컵 0.83" });
    expect(seen.find((e) => e.frame_id === "e1")!.shapes.map((x) => [x.label, x.score])).toEqual([["person", 0.62], ["cup", 0.83]]);
    expect(yolo("e2")).toMatchObject({ yolo: "감지 없음" });
    expect(seen.find((e) => e.frame_id === "e2")!.shapes).toEqual([]);
    expect(sent).toHaveLength(2);
    expect(sent[0]).toContain(`{"id":"d1","class":"person"`);
    expect(sent[0]).toContain(`{"id":"d2","class":"cup"`);
    expect(sent[0]).not.toContain("bottle");
    expect(sent[0]).not.toContain(`"d3"`);
    expect(sent[1]).toBe("Detections: []");
    await p.close();
  });

  it("감지기가 낸 관절을 World State에 넣는다: 손목이 컵 상자 안이면 컵 손에 있음. 상태에 관절 모델 이름과 관절을 돌린 프레임 수", async () => {
    const worlds: WorldView[] = [];
    const vlm = { model: "v", json: async () => ({ value: { scene: "k", observations: [], summary: "s" }, costUsd: 0, model: "v", attempts: 1 }) } as unknown as VlmClient;
    const dets: Detection[] = [mkDet("person", 0.9, [150, 40, 160, 300], 0), mkDet("cup", 0.9, [220, 160, 40, 20], 41)];
    let n = 0;
    const p = new ObservationPipeline({ config: { engineMs: 1000, vlmMaxInflight: 4, vlmTimeoutMs: 5000, detectQueueMax: 8, keepMs: 20_000 },
      detector: new ScriptedDetector(() => dets, () => (++n === 4 ? undefined : [standing({ 10: [235, 170, 0.9] })])), vlm,
      world: new WorldState({ evidenceStepMs: 1000, surfaces: () => [], floorAt: () => 0, roomAt: () => null, devices: () => [] }), emit: () => {}, broadcastWorld: (w) => worlds.push(w) });
    for (let i = 1; i <= 4; i++) p.onEngine(jpeg(i), { kind: "engine", width: 360, height: 780, captured_at: i * 1000, time_err_ms: 0 }, null, null, i * 1000 + 5);
    await p.idle();
    expect(worlds.at(-1)!.objects[0]!.facts.place).toMatchObject({ value: "in_hand", certainty: "confirmed" });
    expect(worlds.at(-1)!.person.facts).toMatchObject({ posture: { value: "standing" } });
    expect(p.status()).toMatchObject({ detector: "scripted", pose: "scripted-pose", provider: "scripted", detected: 4, posed: 3, pose_ms: 0 });
    await p.close();
  });

  it("감지가 실패한 프레임은 물체를 사라짐으로 세지 않고 YOLO 분석 없음으로 남기며, VLM은 그 프레임도 분석한다", async () => {
    fake = await startFakeOpenAI();
    const logs: BrainLog[] = [];
    let fail = false;
    const det = { detect: async () => { if (fail) throw new Error("onnx"); return { detections: [mkDet("cup", 0.9, [220, 160, 40, 20], 41)], ms: 1 }; }, close: async () => {} } as unknown as Detector;
    const world = new WorldState({ evidenceStepMs: 1000, surfaces: () => [], floorAt: () => 0, roomAt: () => null, devices: () => [] });
    const p = new ObservationPipeline({ config: { engineMs: 1000, vlmMaxInflight: 4, vlmTimeoutMs: 5000, detectQueueMax: 8, keepMs: 20_000 }, detector: det,
      vlm: new VlmClient({ baseUrl: `${fake.url}/v1`, model: "m", apiKey: "", extraBody: {} }), world, emit: (l) => logs.push(l), broadcastWorld: () => {} });
    for (let i = 1; i <= 3; i++) p.onEngine(jpeg(i), { kind: "engine", width: 1, height: 1, captured_at: i * 1000, time_err_ms: 0 }, null, null, i * 1000);
    await p.idle();
    fail = true;
    for (let i = 4; i <= 7; i++) p.onEngine(jpeg(i), { kind: "engine", width: 1, height: 1, captured_at: i * 1000, time_err_ms: 0 }, null, null, i * 1000);
    await p.idle();
    expect(world.view(7000).objects[0]).toMatchObject({ cls: "cup", status: "present" });
    expect(logs.filter((l) => l.type === "observe" && l.yolo_missing === "error")).toHaveLength(4);
    expect(fake.requests.filter((r) => r.path.endsWith("/chat/completions"))).toHaveLength(7);
    await p.close();
  });

  it("VLM 답이 그 프레임이 고리에서 빠진 뒤에 와도 물체별 사실을 넣는다", async () => {
    const { vlm, gates } = gatedVlm();
    const world = new WorldState({ evidenceStepMs: 1000, surfaces: () => [], floorAt: () => 0, roomAt: () => null, devices: () => [] });
    const p = new ObservationPipeline({ config: { engineMs: 1000, vlmMaxInflight: 50, vlmTimeoutMs: 600_000, detectQueueMax: 50, keepMs: 20_000 }, detector: cupDet(), vlm, world,
      emit: () => {}, broadcastWorld: () => {} });
    for (let i = 1; i <= 3; i++) { p.onEngine(jpeg(i), head(i * 1000), null, null, i * 1000 + 5); await until(() => gates.length >= i); }
    p.onEngine(jpeg(4), head(24_000), null, null, 24_005);
    await until(() => gates.length >= 4);
    gates[2]!();
    await until(() => world.view(24_000).objects[0]?.facts.place !== undefined);
    expect(world.view(24_000).objects[0]!.facts.place).toMatchObject({ value: "in_sink", at_ms: 3000 });
    await p.close();
  });

  it("감지가 된 프레임마다 물체 모양과 엔진 프레임 크기를 seen으로 낸다(감지 없음은 빈 목록, 감지 실패는 내지 않음). observe 기록에는 상자가 없다", async () => {
    fake = await startFakeOpenAI();
    const logs: BrainLog[] = [];
    const seen: SeenEvent[] = [];
    const script: (() => Detection[] | null)[] = [
      () => [mkDet("cup", 0.83, [100, 50, 40, 60], 41)],
      () => [],
      () => null,
    ];
    let n = 0;
    const det = { name: "scripted", detect: async () => {
      const dets = script[n++]!();
      if (!dets) throw new Error("onnx");
      return { detections: dets, ms: 1, width: 360, height: 640 };
    }, close: async () => {} } as unknown as Detector;
    const p = new ObservationPipeline({ config: { engineMs: 1000, vlmMaxInflight: 4, vlmTimeoutMs: 5000, detectQueueMax: 8, keepMs: 20_000 }, detector: det,
      vlm: new VlmClient({ baseUrl: `${fake.url}/v1`, model: "m", apiKey: "", extraBody: {} }),
      world: new WorldState({ evidenceStepMs: 1000, surfaces: () => [], floorAt: () => 0, roomAt: () => null, devices: () => [] }), emit: (l) => logs.push(l), broadcastWorld: () => {}, onSeen: (e) => seen.push(e) });
    for (let i = 1; i <= 3; i++) p.onEngine(jpeg(i), { kind: "engine", width: 360, height: 640, captured_at: i * 1000, time_err_ms: 0 }, null, null, i * 1000 + 5);
    await p.idle();
    const observed = logs.filter((l): l is Extract<BrainLog, { type: "observe" }> => l.type === "observe");
    const yolo = (id: string) => observed.find((l) => l.frame_id === id && l.vlm === null && l.vlm_missing === undefined)!;
    expect(yolo("e1")).toMatchObject({ yolo: "컵 0.83" });
    expect(yolo("e1")).not.toHaveProperty("boxes");
    expect(yolo("e1")).not.toHaveProperty("frame");
    expect(seen.map((e) => e.frame_id)).toEqual(["e1", "e2"]);
    expect(seen[0]).toMatchObject({ type: "seen", captured_at_ms: 1000, frame: { width: 360, height: 640 }, shapes: [{ label: "cup", score: 0.83, mask: { at: [100, 50, 40, 60], cols: 1, rows: 1 } }] });
    expect(Object.keys(seen[0]!.shapes[0]!).sort()).toEqual(["label", "mask", "score"]);
    expect(seen[1]).toMatchObject({ shapes: [], frame: { width: 360, height: 640 } });
    expect(yolo("e3")).toMatchObject({ yolo: null, yolo_missing: "error" });
    expect(yolo("e3")).not.toHaveProperty("boxes");
    expect(yolo("e3")).not.toHaveProperty("frame");
    const answers = observed.filter((l) => l.vlm !== null || l.vlm_missing !== undefined);
    expect(answers).toHaveLength(3);
    for (const a of answers) {
      expect(a).not.toHaveProperty("boxes");
      expect(a).not.toHaveProperty("frame");
    }
    await p.close();
  });

  it("늦게 온 프레임의 observe에는 상자가 없다", async () => {
    const { vlm, gates } = gatedVlm();
    const logs: BrainLog[] = [];
    const p = new ObservationPipeline({ config: { engineMs: 1000, vlmMaxInflight: 50, vlmTimeoutMs: 600_000, detectQueueMax: 50, keepMs: 20_000 }, detector: cupDet(), vlm,
      world: new WorldState({ evidenceStepMs: 1000, surfaces: () => [], floorAt: () => 0, roomAt: () => null, devices: () => [] }), emit: (l) => logs.push(l), broadcastWorld: () => {} });
    p.onEngine(jpeg(1), head(40_000), null, null, 40_005);
    await until(() => gates.length >= 1);
    p.onEngine(jpeg(2), head(13_000), null, null, 40_100);
    const stale = logs.find((l) => l.type === "observe" && l.frame_id === "e2")!;
    expect(stale).toMatchObject({ yolo_missing: "stale" });
    expect(stale).not.toHaveProperty("boxes");
    await p.close();
  });

  it("고리 범위보다 늦게 온 프레임은 분석하지 않고 YOLO·VLM 분석 없음(stale)으로 남긴다", async () => {
    const { vlm, gates } = gatedVlm();
    const logs: BrainLog[] = [];
    let detected = 0;
    const det = new ScriptedDetector(() => { detected++; return [mkDet("cup", 0.9, [10, 10, 10, 10], 41)]; });
    const world = new WorldState({ evidenceStepMs: 1000, surfaces: () => [], floorAt: () => 0, roomAt: () => null, devices: () => [] });
    const p = new ObservationPipeline({ config: { engineMs: 1000, vlmMaxInflight: 50, vlmTimeoutMs: 600_000, detectQueueMax: 50, keepMs: 20_000 }, detector: det, vlm, world,
      emit: (l) => logs.push(l), broadcastWorld: () => {} });
    for (let i = 1; i <= 3; i++) { p.onEngine(jpeg(i), head(40_000 + i * 1000), null, null, 40_005 + i * 1000); await until(() => gates.length >= i); }
    p.onEngine(jpeg(9), head(13_000), null, null, 43_100);
    await until(() => logs.some((l) => l.type === "observe" && l.frame_id === "e4"));
    expect(logs.filter((l) => l.type === "observe" && l.frame_id === "e4")).toEqual([expect.objectContaining({ yolo: null, yolo_missing: "stale", vlm: null, vlm_missing: "stale" })]);
    expect(detected).toBe(3);
    expect(gates).toHaveLength(3);
    expect(world.view(43_000)).toMatchObject({ yolo_missing: 1, vlm_missing: 1 });
    expect(p.status().yolo_missing.stale).toBe(1);
    await p.close();
  });
});

describe("관찰 흐름 설정", () => {
  it("VLM 창 크기(VLM_WINDOW_FRAMES) 기본은 5장, 1~10장이고 고리는 창보다 짧지 않다", () => {
    expect(loadObserveConfig({}).vlmWindowFrames).toBe(5);
    expect(loadObserveConfig({ VLM_WINDOW_FRAMES: "1" }).vlmWindowFrames).toBe(1);
    expect(() => loadObserveConfig({ VLM_WINDOW_FRAMES: "0" })).toThrow(/VLM_WINDOW_FRAMES=0/);
    expect(() => loadObserveConfig({ VLM_WINDOW_FRAMES: "11" })).toThrow(/VLM_WINDOW_FRAMES=11/);
    expect(loadObserveConfig({ VLM_WINDOW_FRAMES: "8", ENGINE_FRAME_MS: "5000" }).keepMs).toBe(40_000); // 엔진 간격만 길게 주면 VLM도 그 간격
  });
});
