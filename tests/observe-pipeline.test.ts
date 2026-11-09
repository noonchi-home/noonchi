import { afterEach, describe, expect, it } from "vitest";
import { startFakeOpenAI, type FakeServer } from "../scripts/fake-openai.js";
import { VlmClient } from "../src/infer/vlm.js";
import { ObservationPipeline, loadObserveConfig } from "../src/observe/pipeline.js";
import { WorldState } from "../src/world/state.js";
import type { Detection, Detector } from "../src/brain/detector.js";
import { ScriptedDetector } from "./helpers/detectors.js";
import { standing } from "./helpers/poses.js";
import type { BrainLog } from "../src/contract/events.js";
import type { WorldView } from "../src/contract/world.js";

let fake: FakeServer | undefined;
afterEach(async () => { await fake?.close(); fake = undefined; });
const jpeg = (i: number) => Buffer.from([0xff, 0xd8, i]);
const cupDet = () => new ScriptedDetector(() => [{ label: "cup", score: 0.9, cls: 41, box: [10, 10, 10, 10] }]);
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
      detector: new ScriptedDetector(() => [{ label: "cup", score: 0.9, cls: 41, box: [220, 160, 40, 20] }]),
      vlm: new VlmClient({ baseUrl: `${fake.url}/v1`, model: "m", apiKey: "", extraBody: {} }),
      world: new WorldState({ surfaces: () => [], floorAt: () => 0, roomAt: () => null, devices: () => [] }),
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

  it("VLM 상한을 넘은 프레임은 VLM 분석 없음으로 기록한다", async () => {
    const logs: BrainLog[] = [];
    const hang = { json: () => new Promise(() => {}) } as unknown as VlmClient;
    const p = new ObservationPipeline({ config: { engineMs: 1000, vlmMaxInflight: 1, vlmTimeoutMs: 60_000, detectQueueMax: 8, keepMs: 20_000 }, detector: null, vlm: hang,
      world: new WorldState({ surfaces: () => [], floorAt: () => 0, roomAt: () => null, devices: () => [] }), emit: (l) => logs.push(l), broadcastWorld: () => {} });
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
      world: new WorldState({ surfaces: () => [], floorAt: () => 0, roomAt: () => null, devices: () => [] }), emit: (l) => logs.push(l), broadcastWorld: () => {} });
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

  it("World State가 받지 않는 낮은 신뢰도 감지(사람 0.5·물건 0.4 아래)는 상자·YOLO 글·VLM 감지 목록에 넣지 않는다", async () => {
    const logs: BrainLog[] = [];
    const sent: string[] = [];
    const vlm = { model: "cap", json: async (req: { texts: string[] }) => {
      sent.push(req.texts.join("\n"));
      return { value: { scene: "room", observations: [], summary: "s" }, costUsd: 0, model: "cap", attempts: 1 };
    } } as unknown as VlmClient;
    // 실제 폰 프레임에서 본 모양: 흐린 프레임의 사람 0.31·병 0.27 같은 낮은 점수 감지가 진짜 감지와 함께 나온다
    const frames: Detection[][] = [
      [
        { label: "person", score: 0.62, cls: 0, box: [0, 0, 100, 300] },
        { label: "person", score: 0.31, cls: 0, box: [200, 400, 80, 200] },
        { label: "cup", score: 0.83, cls: 41, box: [50, 500, 40, 50] },
        { label: "bottle", score: 0.27, cls: 39, box: [300, 600, 20, 60] },
      ],
      [{ label: "person", score: 0.49, cls: 0, box: [0, 0, 360, 780] }, { label: "bowl", score: 0.39, cls: 45, box: [10, 10, 50, 30] }],
    ];
    let n = 0;
    const p = new ObservationPipeline({ config: { engineMs: 1000, vlmMaxInflight: 4, vlmTimeoutMs: 5000, detectQueueMax: 8, keepMs: 20_000 },
      detector: new ScriptedDetector(() => frames[n++]!), vlm,
      world: new WorldState({ surfaces: () => [], floorAt: () => 0, roomAt: () => null, devices: () => [] }), emit: (l) => logs.push(l), broadcastWorld: () => {} });
    for (let i = 1; i <= 2; i++) p.onEngine(jpeg(i), { kind: "engine", width: 360, height: 780, captured_at: i * 1000, time_err_ms: 0 }, null, null, i * 1000 + 5);
    await p.idle();
    const yolo = (id: string) => logs.find((l): l is Extract<BrainLog, { type: "observe" }> => l.type === "observe" && l.frame_id === id && l.boxes !== undefined)!;
    expect(yolo("e1")).toMatchObject({ yolo: "사람 0.62 · 컵 0.83", boxes: [{ label: "person", score: 0.62 }, { label: "cup", score: 0.83 }] });
    expect(yolo("e1").boxes).toHaveLength(2);
    expect(yolo("e2")).toMatchObject({ yolo: "감지 없음", boxes: [] });
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
    const dets: Detection[] = [{ label: "person", score: 0.9, cls: 0, box: [150, 40, 160, 300] }, { label: "cup", score: 0.9, cls: 41, box: [220, 160, 40, 20] }];
    let n = 0;
    const p = new ObservationPipeline({ config: { engineMs: 1000, vlmMaxInflight: 4, vlmTimeoutMs: 5000, detectQueueMax: 8, keepMs: 20_000 },
      detector: new ScriptedDetector(() => dets, () => (++n === 4 ? undefined : [standing({ 10: [235, 170, 0.9] })])), vlm,
      world: new WorldState({ surfaces: () => [], floorAt: () => 0, roomAt: () => null, devices: () => [] }), emit: () => {}, broadcastWorld: (w) => worlds.push(w) });
    for (let i = 1; i <= 4; i++) p.onEngine(jpeg(i), { kind: "engine", width: 360, height: 780, captured_at: i * 1000, time_err_ms: 0 }, null, null, i * 1000 + 5);
    await p.idle();
    expect(worlds.at(-1)!.objects[0]!.facts.place).toMatchObject({ value: "in_hand", certainty: "confirmed" });
    expect(worlds.at(-1)!.person.facts).toMatchObject({ posture: { value: "standing" } });
    expect(p.status()).toMatchObject({ detector: "scripted", pose: "scripted-pose", detected: 4, posed: 3, pose_ms: 0 });
    await p.close();
  });

  it("감지가 실패한 프레임은 물체를 사라짐으로 세지 않고 YOLO 분석 없음으로 남기며, VLM은 그 프레임도 분석한다", async () => {
    fake = await startFakeOpenAI();
    const logs: BrainLog[] = [];
    let fail = false;
    const det = { detect: async () => { if (fail) throw new Error("onnx"); return { detections: [{ label: "cup", score: 0.9, cls: 41, box: [220, 160, 40, 20] }], ms: 1 }; }, close: async () => {} } as unknown as Detector;
    const world = new WorldState({ surfaces: () => [], floorAt: () => 0, roomAt: () => null, devices: () => [] });
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
    const world = new WorldState({ surfaces: () => [], floorAt: () => 0, roomAt: () => null, devices: () => [] });
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

  it("YOLO observe에 상자와 엔진 프레임 크기를 싣는다(감지 없음은 빈 목록, 실패·VLM 답에는 없음)", async () => {
    fake = await startFakeOpenAI();
    const logs: BrainLog[] = [];
    const script: (() => Detection[] | null)[] = [
      () => [{ label: "cup", score: 0.83, cls: 41, box: [100, 50, 40, 60] }],
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
      world: new WorldState({ surfaces: () => [], floorAt: () => 0, roomAt: () => null, devices: () => [] }), emit: (l) => logs.push(l), broadcastWorld: () => {} });
    for (let i = 1; i <= 3; i++) p.onEngine(jpeg(i), { kind: "engine", width: 360, height: 640, captured_at: i * 1000, time_err_ms: 0 }, null, null, i * 1000 + 5);
    await p.idle();
    const observed = logs.filter((l): l is Extract<BrainLog, { type: "observe" }> => l.type === "observe");
    const yolo = (id: string) => observed.find((l) => l.frame_id === id && l.vlm === null && l.vlm_missing === undefined)!;
    expect(yolo("e1")).toMatchObject({ yolo: expect.any(String), boxes: [{ label: "cup", score: 0.83, box: [100, 50, 40, 60] }], frame: { width: 360, height: 640 } });
    expect(Object.keys(yolo("e1").boxes![0]!).sort()).toEqual(["box", "label", "score"]);
    expect(yolo("e2")).toMatchObject({ boxes: [], frame: { width: 360, height: 640 } });
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
      world: new WorldState({ surfaces: () => [], floorAt: () => 0, roomAt: () => null, devices: () => [] }), emit: (l) => logs.push(l), broadcastWorld: () => {} });
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
    const det = new ScriptedDetector(() => { detected++; return [{ label: "cup", score: 0.9, cls: 41, box: [10, 10, 10, 10] }]; });
    const world = new WorldState({ surfaces: () => [], floorAt: () => 0, roomAt: () => null, devices: () => [] });
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
  it("엔진 프레임 간격 기본은 2초(mock은 VLM을 시간당 약 1,800번 부른다), 200ms 아래는 시작을 막는다", () => {
    expect(loadObserveConfig({})).toMatchObject({ engineMs: 2000, vlmMaxInflight: 4, detectQueueMax: 8, keepMs: 20_000 });
    expect(3_600_000 / loadObserveConfig({}).engineMs).toBe(1800);
    expect(loadObserveConfig({ ENGINE_FRAME_MS: "500" }).engineMs).toBe(500);
    expect(() => loadObserveConfig({ ENGINE_FRAME_MS: "100" })).toThrow(/ENGINE_FRAME_MS=100/);
  });
});
