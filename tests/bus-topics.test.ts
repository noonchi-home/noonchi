// 토픽 표·머리·낡은 메시지·요청 id. 토픽마다 QoS·순서 기준·보내는 노드가 있고, 사진은 SENSOR에만 base64로, 받는 쪽은 지난 기동·지난 집·옛 근거 시각을 버린다.
import { describe, expect, it } from "vitest";
import { Freshness, MAX_FRAME_B64, NODES, Pending, TOPICS, decode, encode, frameBytes, msgId, type Envelope, type TopicName } from "../src/bus/index.js";
import { SCENE_STATES } from "../src/world/vocab.js";

const EPOCH = { boot: "b1", home: "h#1" };
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
    const a = e("/world/state", { rev: 1, view: {} }).header;
    expect(msgId(a)).not.toBe(msgId({ ...a, inst: "i2" }));
    expect(msgId(a)).not.toBe(msgId({ ...a, home: "h#2" }));
  });

  it("머리·몸은 JSON으로 오가고 모양이 틀리면 거절한다", () => {
    const one = e("/world/state", { rev: 1, view: {} });
    const raw = encode(one);
    expect(decode("/world/state", raw)).toEqual(one);
    expect(() => decode("/world/state", raw.replace('"node":"world"', '"node":"nobody"'))).toThrow();
    expect(() => decode("/world/state", raw.replace('"boot":"b1"', '"boot":""'))).toThrow();
  });
});

describe("낡은 메시지", () => {
  it("지난 기동·지난 집의 메시지는 버린다", () => {
    const f = new Freshness(() => EPOCH);
    expect(f.check(e("/world/state", { rev: 1, view: {} }, { boot: "b0" }))).toBe(false);
    expect(f.check(e("/world/state", { rev: 1, view: {} }, { home: "h#0" }))).toBe(false);
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
    f.commit(e("/world/state", { rev: 5, view: {} }));
    expect(f.check(e("/world/state", { rev: 4, view: {} }, { stamp: 9999, seq: 9 }))).toBe(false);
    expect(f.check(e("/world/state", { rev: 6, view: {} }))).toBe(true);
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

  it("/perception/scene은 VLM 갈래 다섯만 받고, 사진 칸(jpeg·jpeg_b64)이 있거나 모르는 사실이면 거절한다", () => {
    const kinds = [
      { kind: "scene", frame_id: "e1", observed_ms: 1, scene },
      { kind: "missing", frame_id: "e1", observed_ms: 1, missing: "timeout" },
      { kind: "closer_scene", look: "e1.c1", frame_id: "e1", observed_ms: 1, scene },
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

  it("/perception/detections는 미니맵 물체 모양만 받는다(사진 없음)", () => {
    const seen = { observed_ms: 1, frame_id: "e1", frame: { width: 640, height: 360 }, shapes: [{ label: "cup", score: 0.8, mask }] };
    expect(ok("/perception/detections", seen)).toBe(true);
    expect(ok("/perception/detections", { ...seen, jpeg_b64: "x" })).toBe(false);
    expect(ok("/perception/detections", { ...seen, shapes: [{ label: "없는 종류", score: 0.8, mask }] })).toBe(false);
    expect(ok("/perception/detections", { observed_ms: 1 })).toBe(false);
  });

  it("/world/state는 {rev, view}, /world/changes는 {rev, changes}만 받는다", () => {
    expect(ok("/world/state", { rev: 1, view: { at_ms: 1, objects: [] } })).toBe(true);
    expect(ok("/world/state", { rev: 1 })).toBe(false);
    expect(ok("/world/state", { rev: 1, view: null })).toBe(false);
    const change = { kind: "appeared", at_ms: 1, subject: "cup_1", text: "컵 보임", meaningful: true };
    expect(ok("/world/changes", { rev: 1, changes: [change] })).toBe(true);
    expect(ok("/world/changes", { rev: 1 })).toBe(false);
    expect(ok("/world/changes", { rev: 1, changes: [{ ...change, kind: "없는 변화" }] })).toBe(false);
    expect(ok("/world/changes", { rev: 1, changes: [change], view: {} })).toBe(false);
  });

  it("/world/closer는 {look, ids}(감지 번호 → 물건 id 표)만 받는다", () => {
    expect(ok("/world/closer", { look: "e2.c1", ids: { d1: "cup_1" } })).toBe(true);
    expect(ok("/world/closer", { look: "e2.c1", ids: {} })).toBe(true);
    expect(ok("/world/closer", { look: "e2.c1" })).toBe(false);
    expect(ok("/world/closer", { look: "e2.c1", ids: { d1: 1 } })).toBe(false);
  });

  it("/world/input은 지킴·따르기 창만, /phone/heard는 {text, observed_ms}, /device/changes는 {id, state, note}만 받는다", () => {
    expect(ok("/world/input", { kind: "guard", id: "cup_1", on: true, at_ms: 1 })).toBe(true);
    expect(ok("/world/input", { kind: "contents", id: "cup_1", on: false, at_ms: 1 })).toBe(true);
    expect(ok("/world/input", { kind: "move", id: "cup_1", on: true, at_ms: 1 })).toBe(false);
    expect(ok("/world/input", { kind: "guard", id: "cup_1", at_ms: 1 })).toBe(false);
    expect(ok("/phone/heard", { text: "컵 치워 줘", observed_ms: 1 })).toBe(true);
    expect(ok("/phone/heard", { text: "컵 치워 줘" })).toBe(false);
    const state = { id: "tv", online: true, twin: { on: true }, matter: {}, updatedAt: "2026-11-18T00:00:00Z" };
    expect(ok("/device/changes", { id: "tv", state, note: { label: "TV", kind: "tv", initial: true } })).toBe(true);
    expect(ok("/device/changes", { id: "tv", note: {} })).toBe(false);
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
