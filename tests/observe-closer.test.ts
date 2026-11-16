import { afterEach, describe, expect, it } from "vitest";
import { startFakeOpenAI, type FakeServer } from "../scripts/fake-openai.js";
import type { Detector } from "../src/observe/detector.js";
import type { Detection, CameraView } from "../src/contract/observe.js";
import type { BrainLog } from "../src/contract/events.js";
import type { WorldChange } from "../src/contract/world.js";
import { VlmClient } from "../src/infer/vlm.js";
import { cropJpeg } from "../src/observe/crop.js";
import { closerSpanMs, closerStaleMs, createPipeline, ObservationPipeline } from "../src/observe/pipeline.js";
import { sha256 } from "../src/observe/ring.js";
import { CLOSER_NOTE } from "../src/observe/scene.js";
import { WorldState } from "../src/world/state.js";
import { AWAY_VIEW, frameJpeg, LOOK_SIZE, LOOK_VIEW } from "./helpers/camera.js";
import { cropAware, cropTurns, det } from "./helpers/detectors.js";
import { CLOSER_SUMMARY, closerVlmReply } from "./helpers/look.js";

let fake: FakeServer | undefined;
afterEach(async () => { await fake?.close(); fake = undefined; });
type Part = { type: string; text?: string };
const until = async (ok: () => boolean) => { for (let i = 0; i < 400 && !ok(); i++) await new Promise((r) => setTimeout(r, 5)); };

// 싱크대 윗면(높이 0.9)은 LOOK_VIEW 그림 가운데다. 잘라 키운 사진의 컵 [220, 160, 40, 20]은 엔진 프레임 [230, 170, 20, 10], 싱크대 위다.
const SINK = { id: "sink_1", label: "싱크대", center: [0.6, 0] as [number, number], top: 0.9, radius: 0.5 };
const SPOT = { id: "sink_1", label: "싱크대", position: [0.6, 0.9, 0] as [number, number, number] };
const cup: Detection = det("cup", 0.72, [220, 160, 40, 20], 41);
// 잘라 키운 사진 왼쪽 끝 컵(엔진 프레임 [120, 170, 20, 10], 잘라 본 경계에 닿음)·사람·싱크대(가전 설비): 물건 감지가 아니다
const edgeCup: Detection = det("cup", 0.72, [0, 160, 40, 20], 41);
const person: Detection = det("person", 0.9, [100, 40, 60, 200], 0);
const sink: Detection = det("sink", 0.9, [60, 100, 300, 200], 71);
const CROP = [120, 90, 240, 180] as [number, number, number, number];
/** 가짜 서버가 받은 VLM 요청 중 before 뒤의 것. */
const chats = (f: FakeServer, before: number) => f.requests.slice(before).filter((q) => q.path.endsWith("/chat/completions"));
/** 요청에 실린 사진(data URL)들. */
const imagesOf = (q: { body: any }) => (q.body.messages[0].content as (Part & { image_url?: { url: string } })[]).flatMap((x) => (x.type === "image_url" ? [x.image_url!.url] : []));
/** n번째 엔진 프레임(setup의 frame이 만드는 사진)을 CROP으로 잘라 키운 사진의 data URL. */
const cropUrl = (n: number) => `data:image/jpeg;base64,${cropJpeg(frameJpeg(n, [[0, 0, 8, 8]]), CROP, LOOK_SIZE).toString("base64")}`;
const fakeVlm = (f: FakeServer) => new VlmClient({ baseUrl: `${f.url}/v1`, model: "m", apiKey: "", extraBody: {} });

/** 관찰 흐름 하나: 엔진 사진은 전체 감지(기본 없음), 잘라 키운 사진은 컵. frame(at)은 2초 간격 엔진 프레임 하나를 넣고 시계를 받은 시각(at + 5ms)까지 옮긴다. */
function setup(o: { vlm: VlmClient; detector?: (engine: Set<string>) => Detector | null; vlmMaxInflight?: number; onChanges?: (c: WorldChange[]) => void; engineMs?: number; vlmMs?: number }) {
  const engine = new Set<string>();
  const logs: BrainLog[] = [];
  const changes: WorldChange[][] = [];
  const clock = { t: 0, now() { return this.t; } };
  const world = new WorldState({ surfaces: () => [SINK], floorAt: () => 0, roomAt: () => null, devices: () => [] });
  const p = new ObservationPipeline({
    config: { engineMs: o.engineMs ?? 2000, vlmMs: o.vlmMs, vlmMaxInflight: o.vlmMaxInflight ?? 4, vlmTimeoutMs: 5000, detectQueueMax: 8, keepMs: 20_000 },
    detector: o.detector ? o.detector(engine) : cropAware(engine, { crop: [cup] }), vlm: o.vlm, world,
    emit: (l) => logs.push(l), broadcastWorld: () => {}, onChanges: (c) => { changes.push(c); o.onChanges?.(c); }, clock,
  });
  let n = 0;
  const frame = (atMs: number, view: CameraView | null = LOOK_VIEW) => {
    const jpeg = frameJpeg(++n, [[0, 0, 8, 8]]);   // 잘라 보는 자리 밖 표시: 고른 회색만이면 잘라 키운 사진이 엔진 사진과 같은 JPEG이 된다
    engine.add(sha256(jpeg));
    clock.t = Math.max(clock.t, atMs + 5);
    p.onEngine(jpeg, { kind: "engine", width: 480, height: 360, captured_at: atMs, time_err_ms: 0 }, null, view, atMs + 5);
  };
  return { p, world, logs, changes, frame, clock };
}

/** 엔진 사진은 감지 없음, 잘라 키운 사진은 컵. hold()가 참이면 잘라 키운 사진 감지를 gates에 붙잡아 둔다(풀면 답한다). */
const heldDetector = (gates: (() => void)[], hold: () => boolean = () => true) => (engine: Set<string>): Detector => ({
  name: "held", provider: "test",
  detect: async (jpeg: Buffer) => {
    if (engine.has(sha256(jpeg))) return { detections: [], ms: 0, width: 480, height: 360 };
    if (hold()) await new Promise<void>((ok) => gates.push(ok));
    return { detections: [cup], ms: 0, width: 480, height: 360 };
  },
});

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
    const looked = s.logs.find((l) => l.type === "observe" && l.frame_id === "e3.c1" && l.yolo !== null)!;
    expect(looked).toMatchObject({ captured_at_ms: 6000, yolo: "컵 0.72", closer: [120, 90, 240, 180] });
    expect(looked).not.toHaveProperty("boxes");
    // 합친 변화는 한 번에 내고, 잘라 본 사진의 요약은 장면 요약을 바꾸지 않는다
    expect(s.changes.filter((c) => c.some((x) => x.kind === "appeared"))).toHaveLength(1);
    expect(s.changes.flat().filter((c) => c.kind === "vlm" && c.text.includes(CLOSER_SUMMARY))).toEqual([]);
    // 가격표에 없는 모델(m)이면 가까이 보기 비용은 모름
    expect(s.p.status().closer).toEqual({ looks: 1, failed: 0, costUsd: null, model: "m" });
    await s.p.close();
  });

  it("엔진 프레임이 100ms마다 와도 VLM 프레임 간격(2초)으로 고른 최대 5장을 자른다: 9초 폭에서 5장이고, 가장 새 VLM 프레임 뒤의 빠른 프레임은 쓰지 않는다", async () => {
    fake = await startFakeOpenAI({ reply: closerVlmReply() });
    const cropped: string[] = [];
    const s = setup({ vlm: fakeVlm(fake), engineMs: 100, vlmMs: 2000, detector: (engine) => ({
      name: "crops", provider: "test",
      detect: async (jpeg: Buffer) => {
        if (engine.has(sha256(jpeg))) return { detections: [], ms: 0, width: 480, height: 360 };
        cropped.push(sha256(jpeg));
        return { detections: [cup], ms: 0, width: 480, height: 360 };
      },
    }) });
    // 0~10.9초, 100ms 간격 110장. VLM 프레임은 0·2·…·10초(1·21·…·101번째 장)
    for (let i = 0; i < 110; i++) s.frame(i * 100);
    await s.p.idle();
    const r = await s.p.closer(SPOT);
    expect(r).toMatchObject({ ok: true, frame_id: "e101.c1", captured_at_ms: 10_000, frames: 5, found: [{ id: "cup_1", cls: "cup" }] });
    const want = [21, 41, 61, 81, 101].map((n) => sha256(cropJpeg(frameJpeg(n, [[0, 0, 8, 8]]), CROP, LOOK_SIZE)));
    expect(cropped).toEqual(want);
    await s.p.close();
  }, 30_000);

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

  it("최근 5장을 잘라 서로 다른 3장에서 같은 자리로 보인 컵을 만든다: 2·3·5번째 장에만 컵이 보여도 새 컵이 생기고, VLM은 컵이 보인 가장 새 장(5번째)을 받는다", async () => {
    fake = await startFakeOpenAI({ reply: closerVlmReply() });
    const s = setup({ vlm: fakeVlm(fake), detector: (engine) => cropTurns(engine, [[], [cup], [cup], [], [cup]]) });
    for (let i = 1; i <= 5; i++) s.frame(i * 2000);
    await s.p.idle();
    const before = fake.requests.length;
    expect(await s.p.closer(SPOT)).toEqual({
      ok: true, frame_id: "e5.c1", captured_at_ms: 10_000, crop: CROP, frames: 5,
      found: [{ id: "cup_1", cls: "cup", score: 0.72, facts: ["in_sink"] }], summary: CLOSER_SUMMARY, vlm: "ok",
    });
    expect(s.world.view(10_000).objects).toEqual([expect.objectContaining({ id: "cup_1", status: "present", surface: "sink_1", first_seen_ms: 4000, last_seen_ms: 10_000, closer_hold: true })]);
    expect(s.world.view(10_000).objects[0]!.facts.place).toMatchObject({ value: "in_sink", certainty: "inferred" });
    const sent = chats(fake, before);
    expect(sent).toHaveLength(1);
    expect(imagesOf(sent[0]!)).toEqual([cropUrl(5)]);
    await s.p.close();
  });

  it("VLM은 물건 감지가 있는 가장 새 장을 받는다: 5번째 장에 컵이 없으면 4번째 장을 보내고, 결과·기록·사실은 그 장 기준이다", async () => {
    fake = await startFakeOpenAI({ reply: closerVlmReply() });
    const s = setup({ vlm: fakeVlm(fake), detector: (engine) => cropTurns(engine, [[], [cup], [cup], [cup], []]) });
    for (let i = 1; i <= 5; i++) s.frame(i * 2000);
    await s.p.idle();
    const before = fake.requests.length;
    expect(await s.p.closer(SPOT)).toEqual({
      ok: true, frame_id: "e4.c1", captured_at_ms: 8000, crop: CROP, frames: 5,
      found: [{ id: "cup_1", cls: "cup", score: 0.72, facts: ["in_sink"] }], summary: CLOSER_SUMMARY, vlm: "ok",
    });
    const sent = chats(fake, before);
    expect(sent).toHaveLength(1);
    expect(imagesOf(sent[0]!)).toEqual([cropUrl(4)]);
    expect((sent[0]!.body.messages[0].content as Part[]).map((x) => x.text ?? "").join("\n")).toContain(`"box":[220,160,40,20]`);
    expect(s.logs.filter((l) => l.type === "observe" && l.closer)).toEqual([
      expect.objectContaining({ frame_id: "e4.c1", captured_at_ms: 8000, yolo: "컵 0.72", closer: CROP }),
      expect.objectContaining({ frame_id: "e4.c1", captured_at_ms: 8000, vlm: CLOSER_SUMMARY, closer: CROP }),
    ]);
    expect(s.world.view(10_000).objects).toEqual([expect.objectContaining({ id: "cup_1", status: "present", first_seen_ms: 4000, last_seen_ms: 8000 })]);
    expect(s.world.view(10_000).objects[0]!.facts.place).toMatchObject({ value: "in_sink", certainty: "inferred" });
    await s.p.close();
  });

  it("5장 중 1장에만 컵이 보여도 VLM이 그 상자에 사실(싱크대 안)을 답하면 확인된 컵을 만들고 그 사실을 넣는다. found의 id는 그 컵이고 등장과 사실은 한 번에 낸다", async () => {
    fake = await startFakeOpenAI({ reply: closerVlmReply() });
    const s = setup({ vlm: fakeVlm(fake), detector: (engine) => cropTurns(engine, [[], [], [], [], [cup]]) });
    for (let i = 1; i <= 5; i++) s.frame(i * 2000);
    await s.p.idle();
    expect(await s.p.closer(SPOT)).toEqual({
      ok: true, frame_id: "e5.c1", captured_at_ms: 10_000, crop: CROP, frames: 5,
      found: [{ id: "cup_1", cls: "cup", score: 0.72, facts: ["in_sink"] }], summary: CLOSER_SUMMARY, vlm: "ok",
    });
    expect(s.world.view(10_000).objects).toEqual([expect.objectContaining({
      id: "cup_1", status: "present", surface: "sink_1", first_seen_ms: 10_000, last_seen_ms: 10_000, closer_hold: true, closer_rev: { place: 1 },
    })]);
    expect(s.world.view(10_000).objects[0]!.facts.place).toMatchObject({ value: "in_sink", certainty: "inferred", closer_ms: 10_000 });
    expect(s.changes.filter((c) => c.some((x) => x.subject === "cup_1"))).toEqual([[
      expect.objectContaining({ kind: "appeared", subject: "cup_1" }), expect.objectContaining({ kind: "state", subject: "cup_1" }),
    ]]);
    await s.p.close();
  });

  it("1장에만 보인 컵은 VLM이 그 상자에 사실을 답하지 않거나(답 없음·가림) VLM 답이 없으면(형식 오류) 만들지 않는다", async () => {
    const one = async (reply: (body: any) => string | null) => {
      fake = await startFakeOpenAI({ reply });
      const s = setup({ vlm: fakeVlm(fake), detector: (engine) => cropTurns(engine, [[], [], [], [], [cup]]) });
      for (let i = 1; i <= 5; i++) s.frame(i * 2000);
      await s.p.idle();
      const r = await s.p.closer(SPOT);
      expect(s.world.view(10_000).objects).toEqual([]);
      await s.p.close();
      await fake.close();
      fake = undefined;
      return r;
    };
    const silent = (body: any) => (closerVlmReply()(body) === null ? null : JSON.stringify({ scene: "kitchen", observations: [], summary: CLOSER_SUMMARY }));
    expect(await one(silent)).toMatchObject({ ok: true, found: [{ id: null, cls: "cup", facts: [] }], vlm: "ok" });
    expect(await one(closerVlmReply("not_visible"))).toMatchObject({ ok: true, found: [{ id: null, cls: "cup", facts: ["not_visible"] }], vlm: "ok" });
    const broken = (body: any) => (closerVlmReply()(body) === null ? null : "{not json");
    expect(await one(broken)).toMatchObject({ ok: true, found: [{ id: null, cls: "cup", facts: [] }], summary: null, vlm: "format" });
  });

  it("사람·가전 설비·잘라 본 경계에 닿은 상자만 있는 장은 건너뛰고, 물건 감지가 있는 장이 하나도 없으면 가장 새 장을 보낸다", async () => {
    fake = await startFakeOpenAI({ reply: closerVlmReply() });
    const s = setup({ vlm: fakeVlm(fake), detector: (engine) => cropTurns(engine, [[cup], [cup], [cup], [edgeCup, person], [sink]]) });
    for (let i = 1; i <= 5; i++) s.frame(i * 2000);
    await s.p.idle();
    let before = fake.requests.length;
    expect(await s.p.closer(SPOT)).toMatchObject({ ok: true, frame_id: "e3.c1", captured_at_ms: 6000, frames: 5, found: [{ id: "cup_1", cls: "cup", facts: ["in_sink"] }], vlm: "ok" });
    expect(imagesOf(chats(fake, before)[0]!)).toEqual([cropUrl(3)]);
    await s.p.close();
    const none = setup({ vlm: fakeVlm(fake), detector: (engine) => cropTurns(engine, [[person], [person, edgeCup], [], [sink], [person]]) });
    for (let i = 1; i <= 5; i++) none.frame(i * 2000);
    await none.p.idle();
    before = fake.requests.length;
    expect(await none.p.closer(SPOT)).toMatchObject({ ok: true, frame_id: "e5.c1", captured_at_ms: 10_000, frames: 5, found: [{ id: null, cls: "person" }], vlm: "ok" });
    expect(imagesOf(chats(fake, before)[0]!)).toEqual([cropUrl(5)]);
    expect(none.world.view(10_000).objects).toEqual([]);
    await none.p.close();
  });

  it("못 보면 까닭을 낸다: 새 사진 모자람(최근 장 중 쓸 수 있는 장이 3장 안 됨·오래된 프레임)·카메라 맞추기 전·대상이 사진 밖·감지기 없음·닫힘", async () => {
    fake = await startFakeOpenAI({ reply: closerVlmReply() });
    const s = setup({ vlm: fakeVlm(fake) });
    expect(await s.p.closer(SPOT)).toEqual({ ok: false, why: "no_fresh_frames" });
    s.frame(2000);
    s.frame(4000);
    expect(await s.p.closer(SPOT)).toEqual({ ok: false, why: "no_fresh_frames" });
    s.frame(14_000);   // 2초·4초 프레임은 가장 새 프레임보다 촬영 범위(2초 간격 5장, 9초) 넘게 앞서 찍혔다
    expect(await s.p.closer(SPOT)).toEqual({ ok: false, why: "no_fresh_frames" });
    for (const at of [16_000, 18_000, 20_000]) s.frame(at, AWAY_VIEW);
    expect(await s.p.closer(SPOT)).toEqual({ ok: false, why: "out_of_view" });
    s.frame(22_000);
    s.frame(24_000);
    expect(await s.p.closer({ ...SPOT, position: [-2, 0, 0] })).toEqual({ ok: false, why: "out_of_view" });
    expect(await s.p.closer(SPOT)).toEqual({ ok: false, why: "no_fresh_frames" });   // 최근 5장 중 16·18·20초 프레임은 대상이 사진 밖이라 쓸 수 있는 장이 둘뿐
    s.frame(26_000, null);
    expect(await s.p.closer(SPOT)).toEqual({ ok: false, why: "no_view" });
    await s.p.idle();
    expect(s.world.view(26_000).objects).toEqual([]);
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
        name: "held", provider: "test",
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

  it("감지를 합친 변화로 단계가 끝나 신호가 끊기면 VLM은 보내지 않고, 합친 결과는 실행한 가까이 보기로 돌려준다(VLM 답 없음 aborted)", async () => {
    fake = await startFakeOpenAI({ reply: closerVlmReply() });
    const ac = new AbortController();
    const s = setup({ vlm: fakeVlm(fake), onChanges: (c) => { if (c.some((x) => x.kind === "appeared")) ac.abort(); } });
    for (let i = 1; i <= 3; i++) s.frame(i * 2000);
    await s.p.idle();
    const sentBefore = fake.requests.length;
    expect(await s.p.closer(SPOT, ac.signal)).toEqual({
      ok: true, frame_id: "e3.c1", captured_at_ms: 6000, crop: [120, 90, 240, 180], frames: 3,
      found: [{ id: "cup_1", cls: "cup", score: 0.72, facts: [] }], summary: null, vlm: "aborted",
    });
    expect(ac.signal.aborted).toBe(true);
    expect(fake.requests.length).toBe(sentBefore);
    expect(s.world.view(6000).objects).toEqual([expect.objectContaining({ id: "cup_1", status: "present", facts: {} })]);
    expect(s.p.status().closer).toMatchObject({ looks: 1, failed: 0 });
    await s.p.close();
  });

  it("VLM 답을 기다리는 중에 끊기면 그 HTTP 요청을 끊고, 답이 와도 넣지 않는다", async () => {
    const signals: AbortSignal[] = [];
    const answers: (() => void)[] = [];
    const vlm = {
      model: "held",
      json: (req: { texts: string[]; signal?: AbortSignal }) => new Promise((ok) => {
        const value = { scene: "k", observations: [{ object_id: "d1", state: "in_sink" }], summary: "s" };
        if (!req.texts.includes(CLOSER_NOTE)) return ok({ value: { ...value, observations: [] }, costUsd: 0, model: "held", attempts: 1 });
        signals.push(req.signal!);
        answers.push(() => ok({ value, costUsd: 0, model: "held", attempts: 1 }));
      }),
    } as unknown as VlmClient;
    const s = setup({ vlm });
    for (let i = 1; i <= 3; i++) s.frame(i * 2000);
    await s.p.idle();
    const ac = new AbortController();
    const pending = s.p.closer(SPOT, ac.signal);
    await until(() => signals.length === 1);
    expect(signals[0]!.aborted).toBe(false);
    ac.abort();
    expect(signals[0]!.aborted).toBe(true);
    answers[0]!();
    // 감지는 이미 합쳤으므로 실행한 가까이 보기다: VLM 답만 넣지 않았다(aborted)
    expect(await pending).toEqual({
      ok: true, frame_id: "e3.c1", captured_at_ms: 6000, crop: [120, 90, 240, 180], frames: 3,
      found: [{ id: "cup_1", cls: "cup", score: 0.72, facts: [] }], summary: null, vlm: "aborted",
    });
    expect(s.world.view(6000).objects).toEqual([expect.objectContaining({ id: "cup_1", facts: {} })]);
    expect(s.p.status().closer).toMatchObject({ looks: 1, failed: 0 });
    await s.p.idle();
    expect(s.p.status().vlm.missing).toMatchObject({ timeout: 0, error: 0 });
    await s.p.close();
  });

  it("3장이 안 된 컵은 VLM 답을 넣기 전에 끊기면 만들지 않는다", async () => {
    const answers: (() => void)[] = [];
    const vlm = {
      model: "held",
      json: (req: { texts: string[] }) => new Promise((ok) => {
        const value = { scene: "k", observations: [{ object_id: "d1", state: "in_sink" }], summary: "s" };
        if (!req.texts.includes(CLOSER_NOTE)) return ok({ value: { ...value, observations: [] }, costUsd: 0, model: "held", attempts: 1 });
        answers.push(() => ok({ value, costUsd: 0, model: "held", attempts: 1 }));
      }),
    } as unknown as VlmClient;
    const s = setup({ vlm, detector: (engine) => cropTurns(engine, [[], [], [cup]]) });
    for (let i = 1; i <= 3; i++) s.frame(i * 2000);
    await s.p.idle();
    const ac = new AbortController();
    const pending = s.p.closer(SPOT, ac.signal);
    await until(() => answers.length === 1);
    ac.abort();
    answers[0]!();
    expect(await pending).toEqual({
      ok: true, frame_id: "e3.c1", captured_at_ms: 6000, crop: CROP, frames: 3,
      found: [{ id: null, cls: "cup", score: 0.72, facts: [] }], summary: null, vlm: "aborted",
    });
    expect(s.world.view(6000).objects).toEqual([]);
    await s.p.close();
  });

  it("가장 새 프레임이 지금보다 끊김 범위(closerStaleMs, 촬영 범위보다 짧은 3장 기준) 넘게 앞서 찍혔으면(폰 끊김) 자르지 않고, 감지가 끝난 뒤 다시 봐서 낡았으면 합치지 않는다", async () => {
    expect(closerSpanMs(2000)).toBe(9000);    // 쓸 프레임 촬영 범위: 2초 간격 5장
    expect(closerStaleMs(2000)).toBe(5000);   // 끊김 검사: 2초 간격 3장 기준
    fake = await startFakeOpenAI({ reply: closerVlmReply() });
    const gates: (() => void)[] = [];
    let hold = false;
    const s = setup({ vlm: fakeVlm(fake), detector: heldDetector(gates, () => hold) });
    for (let i = 1; i <= 3; i++) s.frame(i * 2000);
    await s.p.idle();
    const sentBefore = fake.requests.length;
    const span = closerStaleMs(2000);
    s.clock.t = 6000 + span + 1;
    expect(await s.p.closer(SPOT)).toEqual({ ok: false, why: "no_fresh_frames" });
    expect(s.world.view(6000).objects).toEqual([]);
    hold = true;
    s.clock.t = 6000 + span;
    const pending = s.p.closer(SPOT);
    for (let i = 0; i < 3; i++) {
      await until(() => gates.length === i + 1);
      if (i === 2) s.clock.t = 6000 + span + 1;
      gates[i]!();
    }
    expect(await pending).toEqual({ ok: false, why: "no_fresh_frames" });
    expect(s.world.view(6000).objects).toEqual([]);
    expect(fake.requests.length).toBe(sentBefore);
    expect(s.p.status().closer).toMatchObject({ looks: 0, failed: 2 });
    await s.p.close();
  });

  it("VLM 답이 왔을 때 쓴 가장 새 장이 지금보다 closerStaleMs 넘게 앞서 찍혔으면(폰 끊김) VLM 사실을 넣지 않고 3장이 안 된 후보도 만들지 않는다(vlm no_fresh_frames). 감지로 만든 물건은 그대로다", async () => {
    const answers: (() => void)[] = [];
    const vlm = {
      model: "held",
      json: (req: { texts: string[] }) => new Promise((ok) => {
        const value = { scene: "k", observations: [{ object_id: "d1", state: "in_sink" }], summary: "s" };
        if (!req.texts.includes(CLOSER_NOTE)) return ok({ value: { ...value, observations: [] }, costUsd: 0, model: "held", attempts: 1 });
        answers.push(() => ok({ value, costUsd: 0, model: "held", attempts: 1 }));
      }),
    } as unknown as VlmClient;
    /** 엔진 프레임 3장(마지막 6초) 뒤 가까이 보기 한 번: VLM 답은 시계를 answerAt으로 옮긴 뒤 온다. */
    const one = async (crops: Detection[][], answerAt: number) => {
      const s = setup({ vlm, detector: (engine) => cropTurns(engine, crops) });
      for (let i = 1; i <= 3; i++) s.frame(i * 2000);
      await s.p.idle();
      const n = answers.length;
      const pending = s.p.closer(SPOT);
      await until(() => answers.length === n + 1);
      s.clock.t = answerAt;
      answers.at(-1)!();
      const r = await pending;
      const objects = s.world.view(answerAt).objects;
      const logs = s.logs.filter((l) => l.type === "observe" && l.closer);
      const status = s.p.status().closer;
      await s.p.close();
      return { r, objects, logs, status };
    };
    const stale = 6000 + closerStaleMs(2000) + 1;
    // 1장에만 보인 컵: 끊김 범위 끝까지는 답을 넣어 만들고, 넘으면 만들지 않는다
    expect((await one([[], [], [cup]], 6000 + closerStaleMs(2000))).r).toMatchObject({ ok: true, found: [{ id: "cup_1", facts: ["in_sink"] }], vlm: "ok" });
    const late = await one([[], [], [cup]], stale);
    expect(late.r).toEqual({
      ok: true, frame_id: "e3.c1", captured_at_ms: 6000, crop: CROP, frames: 3,
      found: [{ id: null, cls: "cup", score: 0.72, facts: [] }], summary: null, vlm: "no_fresh_frames",
    });
    expect(late.objects).toEqual([]);
    expect(late.logs).toEqual([expect.objectContaining({ frame_id: "e3.c1", yolo: "컵 0.72" })]);
    expect(late.status).toMatchObject({ looks: 1, failed: 0 });
    // 3장에 보인 컵: 감지로 만든 컵은 남고 VLM 사실만 넣지 않는다
    const three = await one([[cup], [cup], [cup]], 6005 + 6000);
    expect(three.r).toMatchObject({ ok: true, found: [{ id: "cup_1", cls: "cup", facts: [] }], summary: null, vlm: "no_fresh_frames" });
    expect(three.objects).toEqual([expect.objectContaining({ id: "cup_1", status: "present", facts: {} })]);
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

describe("가까이 보기 VLM 모델(VLM_CLOSER_MODEL)", () => {
  /** 환경 변수로 만든 관찰 흐름(createPipeline): VLM은 가짜 서버 주소, 엔진 사진은 감지 없음, 잘라 키운 사진은 컵. */
  async function envSetup(env: Record<string, string>) {
    const engine = new Set<string>();
    const clock = { t: 0, now() { return this.t; } };
    const world = new WorldState({ surfaces: () => [SINK], floorAt: () => 0, roomAt: () => null, devices: () => [] });
    const lines: string[] = [];
    const p = await createPipeline({ env, world, emit: () => {}, broadcastWorld: () => {}, log: (l) => lines.push(l), inject: { detector: cropAware(engine, { crop: [cup] }), clock } });
    let n = 0;
    const frame = (atMs: number) => {
      const jpeg = frameJpeg(++n, [[0, 0, 8, 8]]);
      engine.add(sha256(jpeg));
      clock.t = Math.max(clock.t, atMs + 5);
      p.onEngine(jpeg, { kind: "engine", width: 480, height: 360, captured_at: atMs, time_err_ms: 0 }, null, LOOK_VIEW, atMs + 5);
    };
    return { p, frame, lines };
  }

  /** 엔진 프레임 3장 뒤 가까이 보기 한 번: 보통 프레임·가까이 보기 VLM 요청의 주소와 본문 model, 가까이 보기 상태. */
  async function run(f: FakeServer, env: Record<string, string>) {
    const s = await envSetup({ VLM_BASE_URL: `${f.url}/v1`, VLM_MODEL: "gpt-5.4-nano", ...env });
    const before = f.requests.length;
    for (let i = 1; i <= 3; i++) s.frame(i * 2000);
    await s.p.idle();
    const frames = chats(f, before);
    const mid = f.requests.length;
    expect(await s.p.closer(SPOT)).toMatchObject({ ok: true, vlm: "ok" });
    const closer = chats(f, mid);
    const status = s.p.status();
    await s.p.close();
    return {
      frameModels: [...new Set(frames.map((q) => q.body.model))], closerModels: closer.map((q) => q.body.model),
      paths: [...new Set([...frames, ...closer].map((q) => `${q.method} ${q.path}`))], closer: status.closer, vlmModel: status.vlm_model, lines: s.lines,
    };
  }

  it("주면 가까이 보기 요청 본문의 model만 그 모델이고 같은 주소로 간다. 보통 프레임은 VLM_MODEL 그대로, 가까이 보기 비용은 그 모델 가격으로 센다", async () => {
    fake = await startFakeOpenAI({ reply: closerVlmReply() });
    const r = await run(fake, { VLM_CLOSER_MODEL: "gpt-5.4-mini" });
    expect(r.frameModels).toEqual(["gpt-5.4-nano"]);
    expect(r.closerModels).toEqual(["gpt-5.4-mini"]);
    expect(r.paths).toEqual(["POST /v1/chat/completions"]);
    // 가짜 서버 사용량 입력 10·출력 5토큰: gpt-5.4-mini (10 × 0.75 + 5 × 4.5) / 백만 = 0.00003달러
    expect(r.closer).toEqual({ looks: 1, failed: 0, costUsd: 0.00003, model: "gpt-5.4-mini" });
    expect(r.vlmModel).toBe("gpt-5.4-nano");
    expect(r.lines.join("\n")).toContain("가까이 보기 VLM gpt-5.4-mini");
  });

  it("안 주면 보통 프레임과 가까이 보기가 같은 VLM_MODEL이다", async () => {
    fake = await startFakeOpenAI({ reply: closerVlmReply() });
    const r = await run(fake, {});
    expect(r.frameModels).toEqual(["gpt-5.4-nano"]);
    expect(r.closerModels).toEqual(["gpt-5.4-nano"]);
    expect(r.paths).toEqual(["POST /v1/chat/completions"]);
    // gpt-5.4-nano (10 × 0.2 + 5 × 1.25) / 백만 = 0.00000825달러, 0.00001로 반올림
    expect(r.closer).toEqual({ looks: 1, failed: 0, costUsd: 0.00001, model: "gpt-5.4-nano" });
    expect(r.lines.join("\n")).not.toContain("가까이 보기 VLM");
  });
});
