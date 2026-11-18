// 토픽 표·머리·낡은 메시지·요청 id. 토픽마다 QoS·순서 기준·보내는 노드가 있고, 사진은 SENSOR에만 base64로, 받는 쪽은 지난 기동·지난 집·옛 근거 시각을 버린다.
import { describe, expect, it } from "vitest";
import { Freshness, MAX_FRAME_B64, NODES, Pending, TOPICS, decode, encode, frameBytes, msgId, type Envelope, type TopicName } from "../src/bus/index.js";
import { SCENE_STATES } from "../src/world/vocab.js";

const EPOCH = { boot: "b1", home: "h#1" };
/** 최상위 칸이 다 있는 가장 작은 집 상태 보기. */
const VIEW = { at_ms: 0, objects: [], person: {}, fixtures: [], devices: [], eye: null, frame_ms: null, vlm_missing: 0, yolo_missing: 0 };
const e = <N extends "/perception/analysis" | "/world/state">(topic: N, body: Record<string, unknown>, over: Partial<Envelope<N>["header"]> = {}, key = "_"): Envelope<N> =>
  ({ topic, key, header: { stamp: 1000, node: topic === "/world/state" ? "world" : "perception", inst: "i1", seq: 1, ...EPOCH, ...over }, body } as never);

describe("토픽 표", () => {
  it("토픽마다 QoS가 셋 가운데 하나이고 보내는 노드가 노드 목록 안이다", () => {
    for (const [name, t] of Object.entries(TOPICS)) {
      expect(["sensor", "state", "reliable"], name).toContain(t.qos.kind);
      if (t.qos.kind === "sensor") {
        expect(t.qos.depth, name).toBeGreaterThanOrEqual(1);
        expect(t.from, `${name}: SENSOR는 보내는 노드가 하나(놓친 수 기준 seq)`).toHaveLength(1);
      }
      for (const n of t.from) expect(NODES, name).toContain(n);
    }
  });

  it("사진 칸은 SENSOR 토픽에만 있고, 사진은 base64 글로 싣고 상한을 넘으면 거절한다", () => {
    for (const [name, t] of Object.entries(TOPICS)) if ("photo" in t && t.photo) expect(t.qos.kind, name).toBe("sensor");
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);
    const body = { jpeg_b64: jpeg.toString("base64"), width: 4, height: 3, observed_ms: 1 };
    expect(frameBytes(TOPICS["/perception/frame"].body.parse(body))).toEqual(jpeg);
    expect(() => TOPICS["/perception/frame"].body.parse({ ...body, jpeg_b64: "A".repeat(MAX_FRAME_B64 + 4) })).toThrow();
  });

  it("QoS가 없는 토픽은 타입 검사가 실패한다", () => {
    // @ts-expect-error qos가 없다
    const bad: (typeof TOPICS)["/world/state"] = { body: TOPICS["/world/state"].body, key: () => "_", order: "rev", from: ["world"] };
    expect(bad).toBeDefined();
  });

  it("메시지 식별자는 기동·집·노드·인스턴스·seq를 모두 담는다(노드를 다시 만들어 seq가 1로 돌아와도 겹치지 않는다)", () => {
    const a = e("/world/state", { rev: 1, view: VIEW }).header;
    expect(msgId(a)).not.toBe(msgId({ ...a, inst: "i2" }));
    expect(msgId(a)).not.toBe(msgId({ ...a, home: "h#2" }));
  });

  it("머리·몸은 JSON으로 오가고 모양이 틀리면 거절한다", () => {
    const one = e("/world/state", { rev: 1, view: VIEW });
    const raw = encode(one);
    expect(decode("/world/state", raw)).toEqual(one);
    expect(() => decode("/world/state", raw.replace('"node":"world"', '"node":"nobody"'))).toThrow();
    expect(() => decode("/world/state", raw.replace('"boot":"b1"', '"boot":""'))).toThrow();
  });
});

describe("낡은 메시지", () => {
  it("지난 기동·지난 집의 메시지는 버린다", () => {
    const f = new Freshness(() => EPOCH);
    expect(f.check(e("/world/state", { rev: 1, view: VIEW }, { boot: "b0" }))).toBe(false);
    expect(f.check(e("/world/state", { rev: 1, view: VIEW }, { home: "h#0" }))).toBe(false);
  });

  it("observed_ms 순서 토픽은 옛 근거 시각을 버린다(늦게 끝난 옛 VLM 답). 확정은 성공 뒤에만 한다", () => {
    const f = new Freshness(() => EPOCH);
    const newer = e("/perception/analysis", { frame_id: "f2", observed_ms: 2000 }, { stamp: 2100 }, "f2");
    const older = e("/perception/analysis", { frame_id: "f2", observed_ms: 1000 }, { stamp: 2200, seq: 2 }, "f2");
    expect(f.check(newer)).toBe(true);
    expect(f.check(older)).toBe(true);
    f.commit(newer);
    expect(f.check(older)).toBe(false);
  });

  it("rev 순서 토픽은 옛 판본을 버린다", () => {
    const f = new Freshness(() => EPOCH);
    f.commit(e("/world/state", { rev: 5, view: VIEW }));
    expect(f.check(e("/world/state", { rev: 4, view: VIEW }, { stamp: 9999, seq: 9 }))).toBe(false);
    expect(f.check(e("/world/state", { rev: 6, view: VIEW }))).toBe(true);
  });

  it("같은 근거 시각에서 A 인스턴스 → B 인스턴스를 처리한 뒤 A의 이미 처리한 메시지가 다시 와도 버린다(인스턴스마다 처리한 seq를 기억)", () => {
    const f = new Freshness(() => EPOCH);
    const at = (inst: string, seq: number) => e("/perception/analysis", { frame_id: "f1", observed_ms: 1000 }, { inst, seq }, "f1");
    f.commit(at("A", 5));
    expect(f.check(at("B", 1))).toBe(true);
    f.commit(at("B", 1));
    expect(f.check(at("A", 5))).toBe(false);
    expect(f.check(at("A", 4))).toBe(false);
    expect(f.check(at("B", 1))).toBe(false);
    expect(f.check(at("A", 6))).toBe(true);
  });
});

describe("인식·집 상태 토픽 모양(묶음 2)", () => {
  const ok = (t: TopicName, b: unknown) => TOPICS[t].body.safeParse(b).success;
  const scene = { scene: "kitchen", observations: [{ object_id: "d1", state: SCENE_STATES[0] }], summary: "컵 하나" };
  const mask = { at: [1, 2, 3, 4], cols: 2, rows: 1, bits: "wA==" };

  const view = { origin: [0, 1.5, 0], orientation: [0, 0, 0, 1], theta: 0, projection: Array(16).fill(0) };
  const at = { view, width: 480, height: 360, crop: [1, 2, 3, 4] };

  it("/perception/scene은 VLM 갈래 다섯만 받고, 사진 칸(jpeg·jpeg_b64)이 있거나 모르는 사실이면 거절한다", () => {
    const kinds = [
      { kind: "scene", frame_id: "e1", observed_ms: 1, scene },
      { kind: "missing", frame_id: "e1", observed_ms: 1, missing: "timeout" },
      { kind: "closer_scene", look: "e1.c1", frame_id: "e1", observed_ms: 1, scene, at },
      { kind: "closer_end", look: "e1.c1" },
      { kind: "top", object_id: "cup_1", frame_id: "e1", observed_ms: 1, value: "empty" },
    ];
    for (const b of kinds) {
      expect(ok("/perception/scene", b), b.kind).toBe(true);
      expect(ok("/perception/scene", { ...b, jpeg: "x" }), `${b.kind} jpeg`).toBe(false);
      expect(ok("/perception/scene", { ...b, jpeg_b64: "x" }), `${b.kind} jpeg_b64`).toBe(false);
    }
    expect(ok("/perception/scene", { kind: "frame", frame_id: "e1", observed_ms: 1 })).toBe(false);
    expect(ok("/perception/scene", { kind: "scene", frame_id: "e1", observed_ms: 1, scene: { ...scene, observations: [{ object_id: "d1", state: "없는 사실" }] } })).toBe(false);
    expect(ok("/perception/scene", { kind: "missing", frame_id: "e1", observed_ms: 1, missing: "모름" })).toBe(false);
  });

  it("/perception/scene VLM 갈래는 VLM 물건 목록(objects)·그 사진의 카메라(look)·가까이 본 장의 자리(at)를 싣고, 그 안의 사진 칸도 거절한다", () => {
    const objects = [{ id: "v1", cls: "glass", box: { x: 0.1, y: 0.2, w: 0.1, h: 0.2 }, det: null }, { id: "v2", cls: "cup", box: { x: 0.5, y: 0.5, w: 0.1, h: 0.1 }, det: "d1" }];
    const look = { view, width: 480, height: 360, eye: [1, 2], dets: [{ id: "d1", box: [1, 2, 3, 4], foot: [2, 6] }, { id: "d2", box: [5, 6, 7, 8] }] };
    const withObjects = { ...scene, objects };
    const kinds = [
      { kind: "scene", frame_id: "e1", observed_ms: 1, scene: withObjects, look },
      { kind: "scene", frame_id: "e1", observed_ms: 1, scene: withObjects, look: { ...look, eye: null } },
      { kind: "scene", frame_id: "e1", observed_ms: 1, scene: withObjects, look: { view, width: 480, height: 360 } },
      // 그 답이 본 가장 옛 사진의 촬영 시각(마시기·따르기 사건 구간)과 그릇의 순간 값(마심·따름)
      { kind: "scene", frame_id: "e1", observed_ms: 9, from_ms: 1, scene: { ...withObjects, observations: [{ object_id: "v1", state: "drank" }, { object_id: "v2", state: "poured" }] } },
      { kind: "closer_scene", look: "e1.c1", frame_id: "e1", observed_ms: 1, scene: withObjects, at },
    ];
    for (const b of kinds) expect(ok("/perception/scene", b), JSON.stringify(b).slice(0, 80)).toBe(true);
    expect(ok("/perception/scene", { kind: "closer_scene", look: "e1.c1", frame_id: "e1", observed_ms: 1, scene })).toBe(false);
    for (const photo of ["jpeg", "jpeg_b64", "sha256"]) {
      expect(ok("/perception/scene", { ...kinds[0], scene: { ...scene, objects: [{ ...objects[0], [photo]: "x" }] } }), `object.${photo}`).toBe(false);
      expect(ok("/perception/scene", { ...kinds[0], look: { ...look, [photo]: "x" } }), `look.${photo}`).toBe(false);
      expect(ok("/perception/scene", { ...kinds[0], look: { ...look, dets: [{ id: "d1", box: [1, 2, 3, 4], [photo]: "x" }] } }), `look.dets.${photo}`).toBe(false);
      expect(ok("/perception/scene", { ...kinds[3], at: { ...at, [photo]: "x" } }), `at.${photo}`).toBe(false);
    }
  });

  it("/perception/scene의 YOLO 임시 갈래(eye·frame·yolo_missing·closer_merge)는 감지 상자·눈 자리·프레임 번호만 싣고, 사진 바이트 칸(jpeg·jpeg_b64·sha256)은 어느 자리에서든 거절한다", () => {
    const d = { label: "cup", score: 0.8, box: [1, 2, 3, 4], cls: 41, mask, foot: [2, 6] };
    const frame = { id: "e1", capturedAtMs: 1000, latestAtMs: 1000, width: 480, height: 360, eye: { position: [1, 2], height_m: 1.4, yaw_deg: 0, pitch_deg: 0 }, view, vlm: true };
    const pose = { score: 0.9, box: [1, 2, 3, 4], keypoints: [[1, 2, 0.9]] };
    const pass = { frameId: "e1", capturedAtMs: 1000, view, width: 480, height: 360, dets: [{ ...d, edge: false }] };
    const kinds = [
      { kind: "eye", eye: frame.eye, at_ms: 1000 },
      { kind: "eye", eye: null, at_ms: 1000 },
      { kind: "frame", frame, dets: [d], poses: [pose] },
      { kind: "frame", frame: { ...frame, eye: null, view: null }, dets: [] },
      { kind: "yolo_missing", frame_id: "e1", observed_ms: 1000, yolo: "error" },
      { kind: "yolo_missing", frame_id: "e1", observed_ms: 1000, yolo: "cap", vlm: "cap" },
      { kind: "closer_merge", look: "e1.c1", passes: [pass], from: "e1" },
    ];
    for (const b of kinds) expect(ok("/perception/scene", b), JSON.stringify(b).slice(0, 60)).toBe(true);
    for (const photo of ["jpeg", "jpeg_b64", "sha256"]) {
      expect(ok("/perception/scene", { kind: "frame", frame: { ...frame, [photo]: "x" }, dets: [d] }), `frame.${photo}`).toBe(false);
      expect(ok("/perception/scene", { kind: "frame", frame, dets: [{ ...d, [photo]: "x" }] }), `det.${photo}`).toBe(false);
      expect(ok("/perception/scene", { kind: "closer_merge", look: "e1.c1", passes: [{ ...pass, [photo]: "x" }], from: "e1" }), `pass.${photo}`).toBe(false);
      expect(ok("/perception/scene", { kind: "eye", eye: null, at_ms: 1, [photo]: "x" }), `eye.${photo}`).toBe(false);
    }
  });

  it("/perception/detections는 미니맵 물체 모양만 받는다(사진 없음)", () => {
    const seen = { observed_ms: 1, frame_id: "e1", frame: { width: 640, height: 360 }, shapes: [{ label: "cup", score: 0.8, mask }] };
    expect(ok("/perception/detections", seen)).toBe(true);
    expect(ok("/perception/detections", { ...seen, jpeg_b64: "x" })).toBe(false);
    expect(ok("/perception/detections", { ...seen, shapes: [{ label: "없는 종류", score: 0.8, mask }] })).toBe(false);
    expect(ok("/perception/detections", { observed_ms: 1 })).toBe(false);
  });

  it("/world/state는 {rev, view}, /world/changes는 {rev, changes}만 받는다", () => {
    expect(ok("/world/state", { rev: 1, view: VIEW })).toBe(true);
    expect(ok("/world/state", { rev: 1 })).toBe(false);
    expect(ok("/world/state", { rev: 1, view: null })).toBe(false);
    // 깊이는 보지 않아도 최상위 칸은 다 있어야 하고 사진 칸·모르는 칸은 거절한다
    expect(ok("/world/state", { rev: 1, view: {} })).toBe(false);
    expect(ok("/world/state", { rev: 1, view: { ...VIEW, objects: undefined } })).toBe(false);
    expect(ok("/world/state", { rev: 1, view: { ...VIEW, at_ms: "1" } })).toBe(false);
    expect(ok("/world/state", { rev: 1, view: { ...VIEW, jpeg_b64: "x" } })).toBe(false);
    expect(ok("/world/state", { rev: 1, view: { ...VIEW, jpeg: "x" } })).toBe(false);
    // 후보 자리(sightings)는 있을 때만 싣는다
    expect(ok("/world/state", { rev: 1, view: { ...VIEW, sightings: [] } })).toBe(true);
    expect(ok("/world/state", { rev: 1, view: { ...VIEW, sightings: "x" } })).toBe(false);
    const change = { kind: "appeared", at_ms: 1, subject: "cup_1", text: "컵 보임", meaningful: true };
    expect(ok("/world/changes", { rev: 1, changes: [change] })).toBe(true);
    expect(ok("/world/changes", { rev: 1 })).toBe(false);
    expect(ok("/world/changes", { rev: 1, changes: [{ ...change, kind: "없는 변화" }] })).toBe(false);
    expect(ok("/world/changes", { rev: 1, changes: [change], view: VIEW })).toBe(false);
  });

  it("/world/closer는 {look, ids}(감지 번호 → 물건 id 표)만 받는다", () => {
    expect(ok("/world/closer", { look: "e2.c1", ids: { d1: "cup_1" } })).toBe(true);
    expect(ok("/world/closer", { look: "e2.c1", ids: {} })).toBe(true);
    expect(ok("/world/closer", { look: "e2.c1" })).toBe(false);
    expect(ok("/world/closer", { look: "e2.c1", ids: { d1: 1 } })).toBe(false);
  });

  it("/world/input은 지킴·따르기 창·지금 단계 대상(focus)만, /phone/heard는 {text, observed_ms}, /device/changes는 {id, state, note}만 받는다", () => {
    expect(ok("/world/input", { kind: "focus", id: "cup_1", focus: { step: "place", spot: [1, 2] }, at_ms: 1 })).toBe(true);
    expect(ok("/world/input", { kind: "focus", id: "cup_1", focus: { step: "carry", spot: null }, at_ms: 1 })).toBe(true);
    expect(ok("/world/input", { kind: "focus", id: null, focus: null, at_ms: 1 })).toBe(true);
    expect(ok("/world/input", { kind: "focus", id: "cup_1", focus: { step: "throw", spot: null }, at_ms: 1 })).toBe(false);
    expect(ok("/world/input", { kind: "focus", id: "cup_1", on: true, at_ms: 1 })).toBe(false);
    expect(ok("/world/input", { kind: "guard", id: null, on: true, at_ms: 1 })).toBe(false);
    // 찾기가 겨눈 자리의 같은 무리 물건을 계획 대상으로 잇기(relink)
    expect(ok("/world/input", { kind: "link", from: "cup_2", to: "cup_1", at_ms: 1 })).toBe(true);
    expect(ok("/world/input", { kind: "link", from: "cup_2", at_ms: 1 })).toBe(false);
    expect(ok("/world/input", { kind: "link", from: "cup_2", to: "cup_1", at_ms: 1, on: true })).toBe(false);
    expect(ok("/world/input", { kind: "guard", id: "cup_1", on: true, at_ms: 1 })).toBe(true);
    expect(ok("/world/input", { kind: "contents", id: "cup_1", on: false, at_ms: 1 })).toBe(true);
    expect(ok("/world/input", { kind: "move", id: "cup_1", on: true, at_ms: 1 })).toBe(false);
    expect(ok("/world/input", { kind: "guard", id: "cup_1", at_ms: 1 })).toBe(false);
    expect(ok("/phone/heard", { text: "컵 치워 줘", observed_ms: 1 })).toBe(true);
    expect(ok("/phone/heard", { text: "컵 치워 줘" })).toBe(false);
    const state = { id: "tv", online: true, twin: { on: true }, matter: {}, updatedAt: "2026-11-18T00:00:00Z" };
    expect(ok("/device/changes", { id: "tv", state, note: { label: "TV", kind: "tv", initial: true } })).toBe(true);
    expect(ok("/device/changes", { id: "tv", note: {} })).toBe(false);
    expect(ok("/device/changes", { id: "tv", state: { id: "tv" }, note: {} })).toBe(false);
    expect(ok("/device/changes", { id: "tv", state: { ...state, online: "yes" }, note: {} })).toBe(false);
    expect(ok("/device/changes", { id: "tv", state: { ...state, jpeg_b64: "x" }, note: {} })).toBe(false);
    expect(ok("/device/changes", { id: "tv", state, note: { 모름: 1 } })).toBe(false);
  });
});

describe("요청 id", () => {
  it("열어 둔 요청 id의 답만 받고, 한 번 받으면 닫힌다", () => {
    const p = new Pending<{ target: string }>();
    p.open("r1", { target: "cup_1" });
    expect(p.take("r0")).toBeUndefined();
    expect(p.take("r1")).toEqual({ target: "cup_1" });
    expect(p.take("r1")).toBeUndefined();
  });
});
