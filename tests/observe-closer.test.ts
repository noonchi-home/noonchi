import { afterEach, describe, expect, it } from "vitest";
import { startFakeOpenAI, type FakeServer } from "../scripts/fake-openai.js";
import type { Detection, Detector } from "../src/brain/detector.js";
import type { BrainLog } from "../src/contract/events.js";
import type { WorldChange } from "../src/contract/world.js";
import { VlmClient } from "../src/infer/vlm.js";
import { ObservationPipeline } from "../src/observe/pipeline.js";
import { sha256 } from "../src/observe/ring.js";
import { CLOSER_NOTE } from "../src/observe/scene.js";
import type { CameraView } from "../src/phone/session.js";
import { WorldState } from "../src/world/state.js";
import { AWAY_VIEW, frameJpeg, LOOK_VIEW } from "./helpers/camera.js";
import { cropAware } from "./helpers/detectors.js";
import { CLOSER_SUMMARY, closerVlmReply } from "./helpers/look.js";

let fake: FakeServer | undefined;
afterEach(async () => { await fake?.close(); fake = undefined; });
type Part = { type: string; text?: string };
const until = async (ok: () => boolean) => { for (let i = 0; i < 400 && !ok(); i++) await new Promise((r) => setTimeout(r, 5)); };

// 싱크대 윗면(높이 0.9)은 LOOK_VIEW 그림 가운데다. 잘라 키운 사진의 컵 [220, 160, 40, 20]은 엔진 프레임 [230, 170, 20, 10], 싱크대 위다.
const SINK = { id: "sink_1", label: "싱크대", center: [0.6, 0] as [number, number], top: 0.9, radius: 0.5 };
const SPOT = { id: "sink_1", label: "싱크대", position: [0.6, 0.9, 0] as [number, number, number] };
const cup: Detection = { label: "cup", score: 0.72, cls: 41, box: [220, 160, 40, 20] };
const fakeVlm = (f: FakeServer) => new VlmClient({ baseUrl: `${f.url}/v1`, model: "m", apiKey: "", extraBody: {} });

/** 관찰 흐름 하나: 엔진 사진은 전체 감지(기본 없음), 잘라 키운 사진은 컵. frame(at)은 2초 간격 엔진 프레임 하나를 넣는다. */
function setup(o: { vlm: VlmClient; detector?: (engine: Set<string>) => Detector | null; vlmMaxInflight?: number }) {
  const engine = new Set<string>();
  const logs: BrainLog[] = [];
  const changes: WorldChange[][] = [];
  const world = new WorldState({ surfaces: () => [SINK], floorAt: () => 0, roomAt: () => null, devices: () => [] });
  const p = new ObservationPipeline({
    config: { engineMs: 2000, vlmMaxInflight: o.vlmMaxInflight ?? 4, vlmTimeoutMs: 5000, detectQueueMax: 8, keepMs: 20_000 },
    detector: o.detector ? o.detector(engine) : cropAware(engine, { crop: [cup] }), vlm: o.vlm, world,
    emit: (l) => logs.push(l), broadcastWorld: () => {}, onChanges: (c) => changes.push(c),
  });
  let n = 0;
  const frame = (atMs: number, view: CameraView | null = LOOK_VIEW) => {
    const jpeg = frameJpeg(++n, [[0, 0, 8, 8]]);   // 잘라 보는 자리 밖 표시: 고른 회색만이면 잘라 키운 사진이 엔진 사진과 같은 JPEG이 된다
    engine.add(sha256(jpeg));
    p.onEngine(jpeg, { kind: "engine", width: 480, height: 360, captured_at: atMs, time_err_ms: 0 }, null, view, atMs + 5);
  };
  return { p, world, logs, changes, frame };
}

describe("가까이 보기(관찰 흐름 closer)", () => {
  it("최근 엔진 프레임 3장마다 싱크대 윗면 둘레를 2배로 잘라 같은 감지기로 보고 한 번에 합쳐 컵 하나를 만든다. 마지막 장만 VLM에 혼자 보내고 그 답은 컵 사실만 넣는다", async () => {
    fake = await startFakeOpenAI({ reply: closerVlmReply() });
    const s = setup({ vlm: fakeVlm(fake) });
    expect(s.p.latest()).toBeNull();
    for (let i = 1; i <= 3; i++) s.frame(i * 2000);
    await s.p.idle();
    expect(s.p.latest()).toEqual({ view: LOOK_VIEW, capturedAtMs: 6000, width: 480, height: 360 });
    expect(s.world.view(6000).objects).toEqual([]);   // 전체 사진은 싱크대 안 컵을 못 본다
    const before = fake.requests.length;
    const r = await s.p.closer(SPOT);
    expect(r).toEqual({
      ok: true, frame_id: "e3.c1", captured_at_ms: 6000, crop: [120, 90, 240, 180], frames: 3,
      found: [{ id: "cup_1", cls: "cup", score: 0.72, facts: ["in_sink"] }], summary: CLOSER_SUMMARY, vlm: "ok",
    });
    expect(s.world.view(6000).objects).toEqual([expect.objectContaining({ id: "cup_1", status: "present", surface: "sink_1", closer_hold: true })]);
    expect(s.world.view(6000).objects[0]!.facts.place).toMatchObject({ value: "in_sink", certainty: "inferred" });
    const sent = fake.requests.slice(before).filter((q) => q.path.endsWith("/chat/completions"));
    expect(sent).toHaveLength(1);
    const content = sent[0]!.body.messages[0].content as Part[];
    expect(content.filter((x) => x.type === "image_url")).toHaveLength(1);
    const text = content.filter((x) => x.type === "text").map((x) => x.text).join("\n");
    expect(text).toContain(CLOSER_NOTE);
    expect(text).toContain(`"box":[220,160,40,20]`);
    expect(s.logs.find((l) => l.type === "observe" && l.frame_id === "e3.c1" && l.boxes)).toMatchObject({
      captured_at_ms: 6000, boxes: [{ label: "cup", score: 0.72, box: [230, 170, 20, 10] }], frame: { width: 480, height: 360 }, closer: [120, 90, 240, 180],
    });
    // 합친 변화는 한 번에 내고, 잘라 본 사진의 요약은 장면 요약을 바꾸지 않는다
    expect(s.changes.filter((c) => c.some((x) => x.kind === "appeared"))).toHaveLength(1);
    expect(s.changes.flat().filter((c) => c.kind === "vlm" && c.text.includes(CLOSER_SUMMARY))).toEqual([]);
    expect(s.p.status().closer).toEqual({ looks: 1, failed: 0, costUsd: expect.any(Number) });
    await s.p.close();
  });

  it("새 프레임 없이 다시 보면 같은 원본 프레임의 답이라 확신이 오르지 않고, 새 프레임으로 다시 보면 같은 cup_1을 고친다. 그사이 전체 사진이 못 봐도 지킴 중이라 사라지지 않는다", async () => {
    fake = await startFakeOpenAI({ reply: closerVlmReply() });
    const s = setup({ vlm: fakeVlm(fake) });
    for (let i = 1; i <= 3; i++) s.frame(i * 2000);
    await s.p.idle();
    await s.p.closer(SPOT);
    expect(await s.p.closer(SPOT)).toMatchObject({ ok: true, frame_id: "e3.c2", found: [{ id: "cup_1" }] });
    expect(s.world.view(6000).objects[0]!.facts.place).toMatchObject({ value: "in_sink", certainty: "inferred" });
    for (let i = 4; i <= 6; i++) s.frame(i * 2000);
    await s.p.idle();
    expect(s.world.view(12_000).objects).toEqual([expect.objectContaining({ id: "cup_1", status: "present", closer_hold: true })]);
    expect(await s.p.closer(SPOT)).toMatchObject({ ok: true, frame_id: "e6.c3", captured_at_ms: 12_000, found: [{ id: "cup_1" }] });
    expect(s.world.view(12_000).objects.map((o) => o.id)).toEqual(["cup_1"]);
    expect(s.world.view(12_000).objects[0]).toMatchObject({ last_seen_ms: 12_000, facts: { place: { value: "in_sink", certainty: "confirmed" } } });
    await s.p.close();
  });

  it("못 보면 까닭을 낸다: 새 사진 모자람(3장 안 됨·오래된 프레임)·카메라 맞추기 전·대상이 사진 밖·감지기 없음·닫힘", async () => {
    fake = await startFakeOpenAI({ reply: closerVlmReply() });
    const s = setup({ vlm: fakeVlm(fake) });
    expect(await s.p.closer(SPOT)).toEqual({ ok: false, why: "no_fresh_frames" });
    s.frame(2000);
    s.frame(4000);
    expect(await s.p.closer(SPOT)).toEqual({ ok: false, why: "no_fresh_frames" });
    s.frame(10_000);   // 2초·4초 프레임은 가장 새 프레임보다 너무 앞서 찍혔다
    expect(await s.p.closer(SPOT)).toEqual({ ok: false, why: "no_fresh_frames" });
    s.frame(12_000, AWAY_VIEW);
    expect(await s.p.closer(SPOT)).toEqual({ ok: false, why: "out_of_view" });
    s.frame(14_000);
    s.frame(16_000);
    expect(await s.p.closer({ ...SPOT, position: [-2, 0, 0] })).toEqual({ ok: false, why: "out_of_view" });
    expect(await s.p.closer(SPOT)).toEqual({ ok: false, why: "no_fresh_frames" });   // 12초 프레임은 대상이 사진 밖이라 쓸 수 있는 장이 둘뿐
    s.frame(18_000, null);
    expect(await s.p.closer(SPOT)).toEqual({ ok: false, why: "no_view" });
    await s.p.idle();
    expect(s.world.view(18_000).objects).toEqual([]);
    expect(s.p.status().closer).toMatchObject({ looks: 0, failed: 7 });
    await s.p.close();
    expect(await s.p.closer(SPOT)).toEqual({ ok: false, why: "closed" });
    const none = setup({ vlm: fakeVlm(fake), detector: () => null });
    for (let i = 1; i <= 3; i++) none.frame(i * 2000);
    expect(await none.p.closer(SPOT)).toEqual({ ok: false, why: "no_detector" });
    await none.p.idle();
    await none.p.close();
  });

  it("끊긴 요청은 자르기 전과 합치기 바로 전에 보고 합치지 않는다", async () => {
    fake = await startFakeOpenAI({ reply: closerVlmReply() });
    const gates: (() => void)[] = [];
    const s = setup({
      vlm: fakeVlm(fake),
      detector: (engine) => ({
        name: "held",
        detect: async (jpeg: Buffer) => {
          if (engine.has(sha256(jpeg))) return { detections: [], ms: 0, width: 480, height: 360 };
          await new Promise<void>((ok) => gates.push(ok));
          return { detections: [cup], ms: 0, width: 480, height: 360 };
        },
      }),
    });
    for (let i = 1; i <= 3; i++) s.frame(i * 2000);
    await s.p.idle();
    const sentBefore = fake.requests.length;
    const early = new AbortController();
    early.abort();
    expect(await s.p.closer(SPOT, early.signal)).toEqual({ ok: false, why: "aborted" });
    expect(gates).toHaveLength(0);
    const late = new AbortController();
    const pending = s.p.closer(SPOT, late.signal);
    await until(() => gates.length === 1);
    late.abort();
    gates[0]!();
    expect(await pending).toEqual({ ok: false, why: "aborted" });
    expect(gates).toHaveLength(1);
    expect(s.world.view(6000).objects).toEqual([]);
    expect(fake.requests.length).toBe(sentBefore);
    // 끝까지 가다가 합치기 바로 전에 끊겨도 합치지 않는다
    const last = new AbortController();
    const third = s.p.closer(SPOT, last.signal);
    for (let i = 0; i < 3; i++) {
      await until(() => gates.length === 2 + i);
      if (i === 2) last.abort();
      gates.at(-1)!();
    }
    expect(await third).toEqual({ ok: false, why: "aborted" });
    expect(s.world.view(6000).objects).toEqual([]);
    expect(fake.requests.length).toBe(sentBefore);
    await s.p.close();
  });

  it("보통 프레임이 VLM 자리를 다 써도 가까이 보기는 따로 둔 자리로 간다. 가까이 보기가 이미 돌고 있으면 「VLM 자리 없음」이고 합치지 않는다. 닫으면 답을 기다리던 가까이 보기는 닫힘으로 끝난다", async () => {
    const normal: (() => void)[] = [];
    const closer: (() => void)[] = [];
    const vlm = {
      model: "held",
      json: (req: { texts: string[] }) => new Promise((ok) => {
        const answer = () => ok({ value: { scene: "k", observations: [{ object_id: "d1", state: "in_sink" }], summary: "s" }, costUsd: 0, model: "held", attempts: 1 });
        (req.texts.includes(CLOSER_NOTE) ? closer : normal).push(answer);
      }),
    } as unknown as VlmClient;
    const s = setup({ vlm, vlmMaxInflight: 1 });
    for (let i = 1; i <= 3; i++) s.frame(i * 2000);
    await until(() => s.p.status().detected === 3);
    expect(normal).toHaveLength(1);
    expect(s.p.status().vlm.missing.cap).toBe(2);
    const first = s.p.closer(SPOT);
    await until(() => closer.length === 1);
    expect(await s.p.closer(SPOT)).toEqual({ ok: false, why: "vlm_busy" });
    expect(s.world.view(6000).objects.map((o) => o.id)).toEqual(["cup_1"]);
    closer[0]!();
    expect(await first).toMatchObject({ ok: true, found: [{ id: "cup_1", facts: ["in_sink"] }], vlm: "ok" });
    const hanging = s.p.closer(SPOT);
    await until(() => closer.length === 2);
    await s.p.close();
    expect(await hanging).toEqual({ ok: false, why: "closed" });
    expect(s.p.status().closer).toMatchObject({ looks: 1, failed: 2 });
  });
});
