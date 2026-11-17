// 토픽 표·머리·낡은 메시지·요청 id. 토픽마다 QoS·순서 기준·보내는 노드가 있고, 사진은 SENSOR에만 base64로, 받는 쪽은 지난 기동·지난 집·옛 근거 시각을 버린다.
import { describe, expect, it } from "vitest";
import { Freshness, MAX_FRAME_B64, NODES, Pending, TOPICS, decode, encode, frameBytes, msgId, type Envelope } from "../src/bus/index.js";

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

describe("요청 id", () => {
  it("열어 둔 요청 id의 답만 받고, 한 번 받으면 닫힌다", () => {
    const p = new Pending<{ target: string }>();
    p.open("r1", { target: "cup_1" });
    expect(p.take("r0")).toBeUndefined();
    expect(p.take("r1")).toEqual({ target: "cup_1" });
    expect(p.take("r1")).toBeUndefined();
  });
});
