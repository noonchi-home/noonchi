// 인식 노드(src/observe/node.ts): 관찰 흐름이 World State를 바로 부르지 않는다.
// World State 입력(YOLO 임시 갈래·VLM 답)은 /perception/scene 하나로 사진 없이 차례대로, 미니맵 모양은 /perception/detections로 낸다.
// 가까이 보기 id는 VLM 합치기 뒤 /world/closer 답으로 받는다(기한이 지나면 timeout, 노드를 끝내면 closed).
import { describe, expect, it } from "vitest";
import { BusNode, MemoryBus, RETRY_MS, VirtualClock, type Envelope, type TopicName } from "../src/bus/index.js";
import type { Detection } from "../src/contract/observe.js";
import type { VlmClient } from "../src/infer/vlm.js";
import { startPerceptionNode, type WorldPort } from "../src/observe/index.js";
import { ObservationPipeline } from "../src/observe/pipeline.js";
import { settle } from "../src/record/replay.js";
import { WorldState, startWorldNode, type CloserPass } from "../src/world/index.js";
import { LOOK_SIZE, LOOK_VIEW } from "./helpers/camera.js";
import { ScriptedDetector, det as mkDet } from "./helpers/detectors.js";

const EPOCH = { boot: "b1", home: "h#1" };
const jpeg = (i: number) => Buffer.from([0xff, 0xd8, i]);
const head = (at: number) => ({ kind: "engine" as const, width: 480, height: 360, captured_at: at, time_err_ms: 0 });
const cupIn = mkDet("cup", 0.8, [230, 170, 20, 10], 41);
const person = mkDet("person", 0.9, [150, 20, 120, 330], 0);
const pass = (frameId: string, atMs: number, dets: Detection[]): CloserPass => ({ frameId, capturedAtMs: atMs, view: LOOK_VIEW, ...LOOK_SIZE, dets: dets.map((d) => ({ ...d, edge: false })) });
const ws = () => new WorldState({ evidenceStepMs: 1000, surfaces: () => [], floorAt: () => 0, roomAt: () => ({ id: "kitchen", label: "주방" }), devices: () => [] });
const vlm = { model: "v", json: async () => ({ value: { scene: "kitchen", observations: [{ object_id: "d1", state: "in_sink" }], summary: "컵 하나" }, costUsd: 0, model: "v", attempts: 1 }) } as unknown as VlmClient;

/** 정한 토픽의 다음 발행 한 번을 실패시키는 통로. */
class FlakyBus extends MemoryBus {
  readonly failing = new Set<TopicName>();
  override async publish<N extends TopicName>(e: Envelope<N>): Promise<void> {
    if (this.failing.delete(e.topic)) throw new Error(`${e.topic} 발행 실패`);
    return super.publish(e);
  }
}

async function rig(o: { clock?: VirtualClock; world?: boolean } = {}) {
  const bus = new FlakyBus({ warn: () => {} });
  const clock = o.clock ?? new VirtualClock(10_000);
  const w = o.world ? await startWorldNode({ bus, epoch: EPOCH, world: ws(), clock, log: () => {} }) : null;
  const perception = await startPerceptionNode({ bus, epoch: EPOCH, clock, log: () => {} });
  const probe = new BusNode({ name: "recorder", bus, epoch: EPOCH, clock, log: () => {} });
  const got: { topic: TopicName; body: any }[] = [];
  for (const t of ["/perception/scene", "/perception/detections"] as const) probe.on(t, (b) => { got.push({ topic: t, body: b }); }, t === "/perception/detections" ? { mode: "all" } : {});
  await probe.prepare();
  const nodes = [...(w ? [w.node] : []), perception.node, probe];
  for (const n of nodes) n.start();
  const flush = () => settle(bus, nodes);
  await flush();
  return { bus, clock, perception, got, flush };
}

describe("인식 노드", () => {
  it("프레임 하나를 /perception/scene에 eye → frame → VLM 답 차례로 사진 없이 내고, 감지 대기열 고리는 집 상태 보기를 읽지 않는다", async () => {
    const r = await rig();
    let views = 0;
    const port: WorldPort = { ...r.perception.port, view: () => { views++; return r.perception.port.view(); } };
    const p = new ObservationPipeline({
      config: { engineMs: 1000, vlmMaxInflight: 4, vlmTimeoutMs: 5000, detectQueueMax: 8, keepMs: 20_000 },
      detector: new ScriptedDetector(() => [cupIn]), vlm, world: port, emit: () => {}, onSeen: (e) => r.perception.seen(e),
    });
    // 폰 눈 사건은 추적 상태·시각 칸이 더 있다: 집 상태로는 눈 자리만 간다
    p.onEngine(jpeg(1), head(1000), { position: [1, 2], height_m: 1.4, yaw_deg: 30, pitch_deg: -10, tracking: "ok", at: "2026-11-18T00:00:01Z" }, null, 1005);
    await p.idle();
    await r.flush();
    const scene = r.got.filter((g) => g.topic === "/perception/scene").map((g) => g.body);
    expect(scene.map((b) => b.kind)).toEqual(["eye", "frame", "scene"]);
    const eye = { position: [1, 2], height_m: 1.4, yaw_deg: 30, pitch_deg: -10 };
    expect(scene[0]).toEqual({ kind: "eye", eye, at_ms: 1000 });
    expect(scene[1]).toMatchObject({ frame: { id: "e1", capturedAtMs: 1000, eye }, dets: [{ label: "cup" }] });
    expect(scene[1].frame.eye).toEqual(eye);
    expect(scene[2]).toEqual({ kind: "scene", frame_id: "e1", observed_ms: 1000, scene: { scene: "kitchen", observations: [{ object_id: "d1", state: "in_sink" }], summary: "컵 하나" } });
    expect(JSON.stringify(r.got)).not.toMatch(/jpeg|sha256/);
    expect(r.got.filter((g) => g.topic === "/perception/detections").map((g) => g.body.frame_id)).toEqual(["e1"]);
    expect(views).toBe(0);
    await p.close();
  });

  it("미니맵 물체 모양은 /perception/detections로 낸다(근거 시각은 촬영 시각)", async () => {
    const r = await rig();
    const mask = { at: [1, 2, 3, 4] as [number, number, number, number], cols: 0, rows: 0, bits: "" };
    r.perception.seen({ type: "seen", at_ms: 1100, frame_id: "e1", captured_at_ms: 1000, frame: { width: 480, height: 360 }, shapes: [{ label: "cup", score: 0.8, mask }] });
    await r.flush();
    expect(r.got.filter((g) => g.topic === "/perception/detections").map((g) => g.body)).toEqual([{ observed_ms: 1000, frame_id: "e1", frame: { width: 480, height: 360 }, shapes: [{ label: "cup", score: 0.8, mask }] }]);
  });

  it("가까이 보기 id는 VLM 합치기 뒤 /world/closer 답으로 받는다(VLM 답이 새로 만든 물건 id 포함). view()는 가장 새 /world/state 보기다", async () => {
    const r = await rig({ world: true });
    const port = r.perception.port;
    port.send({ kind: "closer_merge", look: "e2.c1", passes: [pass("e1", 1000, [cupIn]), pass("e2", 2000, [person, cupIn])], from: "e2" });
    // 물건은 VLM 답으로만: 가까이 본 VLM 답이 d2와 이은 컵(v1)을 답한다
    const objects = [{ id: "v1", cls: "cup", box: { x: 0.4, y: 0.4, w: 0.1, h: 0.1 }, det: "d2" }];
    port.send({ kind: "closer_scene", look: "e2.c1", frame_id: "e2", observed_ms: 2000, scene: { scene: "k", observations: [{ object_id: "d2", state: "in_sink" }], objects, summary: "s" }, at: { view: LOOK_VIEW, ...LOOK_SIZE, crop: [120, 60, 240, 180] } });
    const ids = port.closerIds("e2.c1");
    await r.flush();
    expect(await ids).toEqual(new Map([["d2", "cup_1"], ["v1", "cup_1"]]));
    expect(port.view()!.objects.map((o) => o.id)).toEqual(["cup_1"]);
  });

  it("입력 발행이 실패하면 같은 봉투로 차례대로 다시 보내고, 성공하기 전에는 뒤 입력을 붙잡아 둔다(frame 없이 VLM 답만 가지 않게)", async () => {
    const clock = new VirtualClock(10_000);
    const r = await rig({ clock });
    r.bus.failing.add("/perception/scene");
    r.perception.port.send({ kind: "yolo_missing", frame_id: "e1", observed_ms: 1000, yolo: "error" });
    r.perception.port.send({ kind: "missing", frame_id: "e1", observed_ms: 1000, missing: "timeout" });
    await r.flush();
    expect(r.got.filter((g) => g.topic === "/perception/scene")).toEqual([]);
    await clock.advanceTo(10_000 + RETRY_MS, r.flush);
    await r.flush();
    expect(r.got.filter((g) => g.topic === "/perception/scene").map((g) => g.body.kind)).toEqual(["yolo_missing", "missing"]);
  });

  it("답이 기한(답을 낸 뒤 2초) 안에 없으면 timeout, 기다리는 중 노드를 끝내면 closed로 끝나고 끝내기가 걸리지 않는다", async () => {
    const clock = new VirtualClock(10_000);
    const r = await rig({ clock });
    const port = r.perception.port;
    port.send({ kind: "closer_merge", look: "e1.c1", passes: [pass("e1", 1000, [cupIn])], from: "e1" });
    await clock.advanceTo(15_000, r.flush);   // VLM 답을 기다리는 동안은 기한이 흐르지 않는다
    port.send({ kind: "closer_end", look: "e1.c1" });
    const late = port.closerIds("e1.c1");
    let done = false;
    void late.then(() => { done = true; });
    await clock.advanceTo(16_999, r.flush);
    expect(done).toBe(false);
    await clock.advanceTo(17_000, r.flush);
    expect(await late).toBe("timeout");
    port.send({ kind: "closer_merge", look: "e3.c2", passes: [pass("e3", 3000, [cupIn])], from: "e3" });
    const open = port.closerIds("e3.c2");
    await r.perception.node.stop();
    expect(await open).toBe("closed");
    expect(await port.closerIds("모르는 look")).toBe("closed");
  });
});
