import { afterEach, describe, expect, it } from "vitest";
import { startFakeOpenAI, type FakeServer } from "../scripts/fake-openai.js";
import { VlmClient } from "../src/infer/vlm.js";
import { ObservationPipeline, loadObserveConfig } from "../src/observe/pipeline.js";
import { WorldState } from "../src/world/state.js";
import type { Detector } from "../src/brain/detector.js";
import { ScriptedDetector } from "./helpers/detectors.js";
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
  it("엔진 프레임마다 YOLOX와 VLM이 둘 다 분석하고, 같은 사진은 버리고, World State를 보낸다", async () => {
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

  it("감지기가 느려도 앞 프레임을 덮어쓰지 않고, 대기열을 넘친 프레임은 YOLOX·VLM 분석 없음으로 남긴다", async () => {
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
    expect(observed.filter((l) => l.yolo !== null).length + capped.length).toBe(10);               // 나머지는 모두 YOLOX를 거쳤다
    expect(p.status().yolo_missing.cap).toBe(capped.length);
    await p.close();
  });

  it("감지가 실패한 프레임은 물체를 사라짐으로 세지 않고 YOLOX 분석 없음으로 남기며, VLM은 그 프레임도 분석한다", async () => {
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

  it("고리 범위보다 늦게 온 프레임은 분석하지 않고 YOLOX·VLM 분석 없음(stale)으로 남긴다", async () => {
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
