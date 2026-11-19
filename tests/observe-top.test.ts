// 위에서 보기(src/observe/pipeline.ts topReady·topLook, src/observe/top.ts topDropOf): 컵 안을 내려다본 VLM 프레임 쌍(TOP_CONFIRM)을 고르고,
// 장마다 그 컵 하나만 d1로 VLM에 보내 대상 확인(옮겨짐·not_visible·안이 안 보임·그릇 감지·같은 종류 가까이)을 거친 내용물만 World State에 넣는다.
import { pipelineOn } from "./helpers/world-port.js";
import { afterEach, describe, expect, it } from "vitest";
import { startFakeOpenAI, type FakeServer } from "../scripts/fake-openai.js";
import type { Detector } from "../src/observe/detector.js";
import type { CameraView, Detection, SceneObservation } from "../src/contract/observe.js";
import type { WorldObject } from "../src/contract/world.js";
import { VlmClient } from "../src/infer/vlm.js";
import { ObservationPipeline } from "../src/observe/pipeline.js";
import { sha256 } from "../src/observe/ring.js";
import { TOP_NOTE } from "../src/observe/scene.js";
import { topDropOf } from "../src/observe/top.js";
import { WorldState } from "../src/world/state/world.js";
import { cylinderBox, eyeOfView, frameJpeg, viewLooking } from "./helpers/camera.js";
import { det } from "./helpers/detectors.js";

type V3 = [number, number, number];
let fake: FakeServer | undefined;
afterEach(async () => { await fake?.close(); fake = undefined; });
const until = async (ok: () => boolean) => { for (let i = 0; i < 400 && !ok(); i++) await new Promise((r) => setTimeout(r, 5)); };
const textOf = (content: unknown): string => (Array.isArray(content) ? content.map((p: { type?: string; text?: string }) => (p.type === "text" ? p.text ?? "" : "")).join("\n") : String(content ?? ""));
const requestText = (body: any) => (Array.isArray(body?.messages) ? body.messages : []).map((m: { content: unknown }) => textOf(m.content)).join("\n");

const TABLE = { id: "table_1", label: "식탁", center: [1, 0] as [number, number], top: 0.75, radius: 1 };
const CUP_AT: V3 = [1, 0.75, 0];
/** 0.6m 앞 옆에서 본 카메라, 컵 입구 바로 위 0.4m에서 내려다본 카메라. */
const SIDE = viewLooking([0.4, 1.4, 0], [1, 0.8, 0]);
const ABOVE = viewLooking([0.98, 1.15, 0], CUP_AT);
const sideCup = (at: V3 = CUP_AT, h = 0.1): Detection => det("cup", 0.9, cylinderBox(SIDE, at, 0.04, h), 41);
/** 잘라 키운 위 사진 가운데 그릇(YOLO가 위에서 본 컵을 그릇으로 봄). */
const BOWL: Detection = det("bowl", 0.8, [190, 130, 100, 100]);

/** VLM 가짜 답: TOP_NOTE가 든 요청은 d1에 차례대로 states(장마다)를 답하고, gate가 있으면 그 장의 답을 붙잡는다. 그 밖은 기본 답. */
function topReply(states: string[][], gate?: (n: number) => Promise<void> | undefined) {
  let n = 0;
  const sent: any[] = [];
  const reply = async (body: any): Promise<string | null> => {
    if (body?.response_format?.json_schema?.name !== "scene_observation" || !requestText(body).includes(TOP_NOTE)) return null;
    const i = n++;
    sent.push(body);
    await gate?.(i);
    const obs: SceneObservation["observations"] = (states[i] ?? states.at(-1)!).map((state) => ({ object_id: "d1", state: state as SceneObservation["observations"][number]["state"] }));
    return JSON.stringify({ scene: "kitchen", observations: obs, objects: [], summary: "위에서 본 컵" });
  };
  return { reply, sent };
}

/** 관찰 흐름: 옆 사진(1~6초)으로 컵 하나를 확인하고 크기를 잰 뒤 위 사진을 넣는다. 옆 엔진 사진은 컵, 위 엔진 사진은 감지 없음, 잘라 키운 사진은 crop(). */
function setup(vlm: VlmClient, crop: () => Detection[] = () => [BOWL]) {
  const engine = new Set<string>();
  const sides = new Map<string, Detection[]>();
  const clock = { t: 0, now() { return this.t; } };
  const world = new WorldState({ surfaces: () => [TABLE], floorAt: () => 0, roomAt: () => null, devices: () => [] });
  const detector: Detector = {
    name: "test", provider: "test",
    detect: async (jpeg: Buffer) => {
      const key = sha256(jpeg);
      const dets = sides.get(key) ?? (engine.has(key) ? [] : crop());
      return { detections: dets, ms: 0, width: 480, height: 360 };
    },
  };
  const p = pipelineOn({
    config: { engineMs: 1000, vlmMaxInflight: 4, vlmTimeoutMs: 5000, detectQueueMax: 8, keepMs: 30_000 },
    detector, vlm, world, emit: () => {}, broadcastWorld: () => {}, clock,
  });
  let n = 0;
  const frame = (atMs: number, view: CameraView, dets: Detection[] = []) => {
    const jpeg = frameJpeg(++n, [[0, 0, 8, 8]]);
    engine.add(sha256(jpeg));
    if (dets.length) sides.set(sha256(jpeg), dets);
    clock.t = Math.max(clock.t, atMs + 5);
    p.onEngine(jpeg, { kind: "engine", width: 480, height: 360, captured_at: atMs, time_err_ms: 0 }, eyeOfView(view), view, atMs + 5);
    return jpeg;
  };
  const cup = () => world.view(clock.now()).objects.find((o) => o.cls === "cup")!;
  return { p, world, frame, clock, cup };
}

/** 옆 사진 1~6초로 컵을 확인한다. */
async function seeCup(s: ReturnType<typeof setup>, h = 0.1) {
  for (let i = 1; i <= 6; i++) s.frame(i * 1000, SIDE, [sideCup(CUP_AT, h)]);
  await s.p.idle();
  expect(s.cup()).toMatchObject({ id: "cup_1", status: "present" });
  expect(s.cup().size_m).toBeDefined();
}
const spotOf = (o: WorldObject) => ({ id: o.id, label: "컵", position: o.position! });
const fakeVlm = (f: FakeServer) => new VlmClient({ baseUrl: `${f.url}/v1`, model: "m", apiKey: "", extraBody: {} });

describe("위에서 비추기 끝(topReady)", () => {
  it("컵 안을 내려다본 VLM 프레임이 1.5초 이상·6초 이하로 두 장이면 참. 1초 간격·옆 사진·sinceMs 앞 프레임은 세지 않는다", async () => {
    const t = topReply([["empty"]]);
    fake = await startFakeOpenAI({ reply: t.reply });
    const s = setup(fakeVlm(fake));
    await seeCup(s);
    expect(s.p.topReady("cup_1", 0)).toBe(false);   // 옆 사진은 컵 안을 보지 않는다
    s.frame(8000, ABOVE);
    expect(s.p.topReady("cup_1", 7000)).toBe(false);
    s.frame(9000, ABOVE);
    expect(s.p.topReady("cup_1", 7000)).toBe(false);   // 1초 간격
    s.frame(10_000, ABOVE);
    expect(s.p.topReady("cup_1", 7000)).toBe(true);
    expect(s.p.topReady("cup_1", 8500)).toBe(false);   // 9·10초는 1초 간격
    expect(s.p.topReady("cup_9", 7000)).toBe(false);
    await s.p.idle();
  });
});

describe("위에서 보기(topLook)", () => {
  it("쌍의 두 장을 TOP_NOTE와 d1 하나로 VLM에 보내고, 대상 확인을 거친 답을 넣어 내용물을 확인한다. 감지기는 대상 확인에만 쓴다(그릇을 만들지 않는다)", async () => {
    const t = topReply([["empty"], ["empty"]]);
    fake = await startFakeOpenAI({ reply: t.reply });
    const s = setup(fakeVlm(fake));
    await seeCup(s);
    const photos = [s.frame(8000, ABOVE), s.frame(10_000, ABOVE)];
    await s.p.idle();
    const r = await s.p.topLook(spotOf(s.cup()), 7000);
    expect(r).toMatchObject({ ok: true, frames: 2, found: [{ id: "cup_1", cls: "cup", score: 1, facts: ["empty", "empty"] }], vlm: "ok", top: [{ kept: true }, { kept: true }] });
    expect(t.sent).toHaveLength(2);
    for (const [i, body] of t.sent.entries()) {
      // 이미 가까이 다가간 폰 사진은 가장자리까지 보낸다. 컵이 화면을 채우면 가운데만 잘라서는 수면과 테두리를 구별할 수 없다.
      const image = body.messages.flatMap((msg: any) => msg.content).find((p: any) => p.type === "image_url");
      expect(image.image_url.url === `data:image/jpeg;base64,${photos[i]!.toString("base64")}`).toBe(true);
      const m = /Detections: (\[.*\])/.exec(requestText(body));
      const dets: { id: string; class: string; box: number[] }[] = JSON.parse(m![1]!);
      expect(dets).toEqual([expect.objectContaining({ id: "d1", class: "cup" })]);
      const [x, y, w, h] = dets[0]!.box;
      expect(x).toBeGreaterThanOrEqual(0);
      expect(y).toBeGreaterThanOrEqual(0);
      expect(x! + w!).toBeLessThanOrEqual(480);
      expect(y! + h!).toBeLessThanOrEqual(360);
    }
    expect(s.cup()).toMatchObject({ facts: { contents: { value: "empty", certainty: "confirmed" } }, last_seen_ms: 10_000 });
    expect(s.world.view(s.clock.now()).objects.map((o) => o.cls)).toEqual(["cup"]);
  });

  it("d1에 not_visible이 있으면 내용물 값이 같이 와도 버린다. 안이 안 보임이면 버린다", async () => {
    const t = topReply([["not_visible", "empty"], ["contents_unknown"]]);
    fake = await startFakeOpenAI({ reply: t.reply });
    const s = setup(fakeVlm(fake));
    await seeCup(s);
    s.frame(8000, ABOVE);
    s.frame(10_000, ABOVE);
    await s.p.idle();
    const r = await s.p.topLook(spotOf(s.cup()), 7000);
    expect(r).toMatchObject({ ok: true, top: [{ kept: false, why: "not_visible" }, { kept: false, why: "no_contents" }] });
    expect(s.cup().facts.contents?.certainty).not.toBe("confirmed");
  });

  it("잘라 키운 사진에 그릇 감지가 없으면 버린다", async () => {
    const t = topReply([["empty"]]);
    fake = await startFakeOpenAI({ reply: t.reply });
    const s = setup(fakeVlm(fake), () => []);
    await seeCup(s);
    s.frame(8000, ABOVE);
    s.frame(10_000, ABOVE);
    await s.p.idle();
    expect(await s.p.topLook(spotOf(s.cup()), 7000)).toMatchObject({ ok: true, top: [{ why: "no_vessel" }, { why: "no_vessel" }] });
  });

  it("컵 테두리가 잘려 확대 사진에서 놓쳐도 같은 원본 사진의 목표 상자 안 그릇 감지는 쓴다", async () => {
    const t = topReply([["empty"]]);
    fake = await startFakeOpenAI({ reply: t.reply });
    const s = setup(fakeVlm(fake), () => []);
    await seeCup(s);
    s.frame(8000, ABOVE, [BOWL]);
    s.frame(10_000, ABOVE, [BOWL]);
    await s.p.idle();
    expect(await s.p.topLook(spotOf(s.cup()), 7000)).toMatchObject({ ok: true, top: [{ kept: true }, { kept: true }] });
  });

  it("첫 답 뒤 컵이 0.35m 옮겨지면 둘째 장은 넣지 않고 moved로 끝난다", async () => {
    let release!: () => void;
    const held = new Promise<void>((ok) => { release = ok; });
    const t = topReply([["empty"], ["empty"]], (i) => (i === 1 ? held : undefined));
    fake = await startFakeOpenAI({ reply: t.reply });
    const s = setup(fakeVlm(fake));
    await seeCup(s);
    s.frame(8000, ABOVE);
    s.frame(10_000, ABOVE);
    await s.p.idle();
    const start = s.cup().position!;
    const look = s.p.topLook(spotOf(s.cup()), 7000);
    await until(() => t.sent.length === 2);
    // 옆 사진 2장이 옮겨진 컵을 본다(같은 물건, 자리만 바뀜. 장면 VLM 자리는 0.3m 넘게 사진 2장 이어야 옮긴다)
    s.frame(11_000, SIDE, [sideCup([1.35, 0.75, 0])]);
    s.frame(12_000, SIDE, [sideCup([1.35, 0.75, 0])]);
    await until(() => Math.abs(s.cup().position![0] - start[0]) > 0.1);
    release();
    const r = await look;
    expect(r).toMatchObject({ ok: true, top: [{ kept: true }, { kept: false, why: "moved" }] });
    expect(s.cup().facts.contents?.certainty).not.toBe("confirmed");
    await s.p.idle();
  });

  it("짧은 컵(높이 5cm)을 9cm 위에서 보아도 잰 크기의 상자로 보낸다(높이 12cm 고정 상자는 카메라 뒤로 넘어간다)", async () => {
    const t = topReply([["empty"], ["empty"]]);
    fake = await startFakeOpenAI({ reply: t.reply });
    const s = setup(fakeVlm(fake));
    await seeCup(s, 0.05);
    const low = viewLooking([0.99, 0.84, 0], CUP_AT);
    s.frame(8000, low);
    s.frame(10_000, low);
    await s.p.idle();
    expect(s.p.topReady("cup_1", 7000)).toBe(true);
    const r = await s.p.topLook(spotOf(s.cup()), 7000);
    expect(r).toMatchObject({ ok: true, top: [{ kept: true }, { kept: true }] });
    expect(t.sent).toHaveLength(2);
  });

  it("쌍이 없으면 no_fresh_frames다", async () => {
    const t = topReply([["empty"]]);
    fake = await startFakeOpenAI({ reply: t.reply });
    const s = setup(fakeVlm(fake));
    await seeCup(s);
    s.frame(8000, ABOVE);
    await s.p.idle();
    expect(await s.p.topLook(spotOf(s.cup()), 7000)).toEqual({ ok: false, why: "no_fresh_frames" });
    expect(t.sent).toHaveLength(0);
  });
});

describe("위에서 본 장 거르기(topDropOf)", () => {
  const cup = (over: Partial<WorldObject> = {}): WorldObject => ({
    id: "cup_1", cls: "cup", position: [1, 0.75, 0], surface: null, surface_label: null, room: null, error_m: 0.1, status: "present",
    first_seen_ms: 0, last_seen_ms: 0, last_in_view_ms: 0, facts: {}, answered_ms: null, devices: [], closer_hold: false, followed_by: null, ...over,
  });
  const scene = (...states: string[]): SceneObservation => ({ scene: "k", observations: states.map((state) => ({ object_id: "d1", state: state as SceneObservation["observations"][number]["state"] })), summary: "s" });
  const box: [number, number, number, number] = [150, 100, 180, 160];
  const base = { start: [1, 0.75, 0] as V3, now: cup(), others: [] as WorldObject[], scene: scene("empty"), dets: [BOWL], box, frame: { width: 480, height: 360 } };
  it("투명한 컵을 감지기가 놓쳐도 VLM이 같은 사진 목표 자리에서 찾았으면 내용물을 받는다", () => {
    const object = { id: "v1", cls: "cup", det: "d1", box: { x: 0.4, y: 0.35, w: 0.2, h: 0.3 } };
    const frame = { width: 480, height: 360 };
    const check = (o: typeof object) => topDropOf({ ...base, frame, dets: [], scene: { ...scene("empty"), objects: [o] } });
    expect(check(object)).toEqual({ value: "empty" });
    expect(check({ ...object, box: { ...object.box, x: 0 } })).toEqual({ drop: "no_vessel" });
    expect(check({ ...object, det: "d2" })).toEqual({ drop: "no_vessel" });
  });
  it("차례: 옮겨짐 → VLM 답 없음 → not_visible → 내용물 값 없음 → 그릇 감지 없음 → 같은 종류 가까이. 다 거치면 그 값", () => {
    expect(topDropOf(base)).toEqual({ value: "empty" });
    expect(topDropOf({ ...base, now: cup({ position: [1.2, 0.75, 0] }) })).toEqual({ drop: "moved" });
    expect(topDropOf({ ...base, now: cup({ followed_by: "cup_2" }) })).toEqual({ drop: "moved" });
    expect(topDropOf({ ...base, now: cup({ status: "gone" }) })).toEqual({ drop: "moved" });
    expect(topDropOf({ ...base, now: undefined })).toEqual({ drop: "moved" });
    expect(topDropOf({ ...base, scene: null })).toEqual({ drop: "vlm_missing" });
    expect(topDropOf({ ...base, scene: scene("empty", "not_visible") })).toEqual({ drop: "not_visible" });
    expect(topDropOf({ ...base, scene: scene("contents_unknown") })).toEqual({ drop: "no_contents" });
    // 모름이 섞이거나 내용물 값이 서로 다르면 버린다
    expect(topDropOf({ ...base, scene: scene("contents_unknown", "empty") })).toEqual({ drop: "no_contents" });
    expect(topDropOf({ ...base, scene: scene("empty", "has_contents") })).toEqual({ drop: "no_contents" });
    expect(topDropOf({ ...base, scene: scene("empty", "empty", "on_table") })).toEqual({ value: "empty" });
    expect(topDropOf({ ...base, dets: [det("bowl", 0.8, [10, 10, 40, 40])] })).toEqual({ drop: "no_vessel" });
    expect(topDropOf({ ...base, dets: [det("cell_phone", 0.8, [190, 130, 100, 100])] })).toEqual({ drop: "no_vessel" });
    expect(topDropOf({ ...base, others: [cup({ id: "cup_2", position: [1.08, 0.75, 0] })] })).toEqual({ drop: "crowded" });
    expect(topDropOf({ ...base, others: [cup({ id: "cup_2", position: [1.3, 0.75, 0] })] })).toEqual({ value: "empty" });
  });
});
