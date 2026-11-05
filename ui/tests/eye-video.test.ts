// 눈 영상(H.264) 순수 부분: web/eye-video.js를 TS로 옮긴 ui/src/panels/eye-video.ts. 루트 tests/eye-video.test.ts와 같은 규칙.
import { afterEach, describe, expect, it } from "vitest";
import { createDecodeGate, createDisplayMode, createStreamParser, runDecoder } from "../src/panels/eye-video";

/** 서버 src/phone/video.ts encodeStreamMessage와 같은 틀: [헤더 길이 u32][본문 길이 u32][JSON 헤더][본문]. */
function encode(header: object, body: Uint8Array): Uint8Array {
  const head = new TextEncoder().encode(JSON.stringify(header));
  const out = new Uint8Array(8 + head.length + body.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, head.length);
  view.setUint32(4, body.length);
  out.set(head, 8);
  out.set(body, 8 + head.length);
  return out;
}
const concat = (parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
};

describe("영상/JPEG 고르기", () => {
  it("영상 프레임을 그린 지 3초 안이면 영상, 아니면 JPEG", () => {
    let t = 0;
    const m = createDisplayMode({ staleMs: 3000, now: () => t });
    expect(m.mode).toBe("jpeg");
    m.frame();
    t = 2999;
    expect(m.mode).toBe("video");
    t = 3000;
    expect(m.mode).toBe("jpeg");
    m.frame();
    m.reset();
    expect(m.mode).toBe("jpeg");
  });
});

describe("디코더 관문", () => {
  it("처음과 reset 뒤에는 키프레임부터 넣는다", () => {
    const g = createDecodeGate();
    expect(g.accept(false)).toBe(false);
    expect(g.accept(true)).toBe(true);
    expect(g.accept(false)).toBe(true);
    g.reset();
    expect(g.accept(false)).toBe(false);
    expect(g.accept(true)).toBe(true);
  });

  it("디코더가 밀리면 다음 키프레임까지 건너뛴다", () => {
    const g = createDecodeGate({ maxQueue: 5 });
    expect(g.accept(true, 0)).toBe(true);
    expect(g.accept(false, 6)).toBe(false);
    expect(g.accept(false, 0)).toBe(false);
    expect(g.accept(true, 6)).toBe(false);
    expect(g.accept(true, 1)).toBe(true);
    expect(g.accept(false, 1)).toBe(true);
  });
});

describe("스트림 자르기", () => {
  it("잘려 오거나 붙어 와도 메시지 단위로 자른다", () => {
    const p = createStreamParser();
    const bytes = concat([encode({ type: "config" }, new Uint8Array([1, 2])), encode({ type: "chunk", key: true, ts: 5 }, new Uint8Array([9]))]);
    expect(p.push(bytes.subarray(0, 5))).toEqual([]);
    const out = p.push(bytes.subarray(5));
    expect(out.map((m) => m.header)).toEqual([{ type: "config" }, { type: "chunk", key: true, ts: 5 }]);
    expect([...out[0]!.body]).toEqual([1, 2]);
  });

  it("길이가 말이 안 되면 던진다", () => {
    const broken = new Uint8Array(8);
    new DataView(broken.buffer).setUint32(0, 10);
    new DataView(broken.buffer).setUint32(4, 0xffffffff);
    expect(() => createStreamParser().push(broken)).toThrow("영상 스트림 길이가 맞지 않아요");
  });
});

// runDecoder를 jsdom에서 돌리려고 WebCodecs·fetch를 흉내 낸다
describe("영상 스트림 읽기(runDecoder)", () => {
  type G = Record<string, unknown>;
  const g = globalThis as unknown as G;
  const saved = { fetch: globalThis.fetch, VideoDecoder: g.VideoDecoder, EncodedVideoChunk: g.EncodedVideoChunk };
  const stops: (() => void)[] = [];
  afterEach(() => {
    for (const s of stops.splice(0)) s();
    globalThis.fetch = saved.fetch;
    g.VideoDecoder = saved.VideoDecoder;
    g.EncodedVideoChunk = saved.EncodedVideoChunk;
  });
  const until = async (ok: () => boolean, ms = 2000) => {
    for (let t = 0; t < ms && !ok(); t += 10) await new Promise((r) => setTimeout(r, 10));
    expect(ok()).toBe(true);
  };
  const canvas = { width: 0, height: 0, getContext: () => ({ drawImage() {} }) } as unknown as HTMLCanvasElement;
  function fakeFetch(bodies: Uint8Array[]) {
    const signals: AbortSignal[] = [];
    globalThis.fetch = (async (_url: string, init: RequestInit) => {
      signals.push(init.signal!);
      const body = bodies.shift() ?? new Uint8Array(0);
      return new Response(new ReadableStream({ start(c) { c.enqueue(body); } }));
    }) as typeof fetch;
    return signals;
  }
  function fakeDecoder(failKeys: number[]) {
    const decoded: string[] = [];
    let keys = 0;
    g.EncodedVideoChunk = class { constructor(init: object) { Object.assign(this, init); } };
    g.VideoDecoder = class {
      static async isConfigSupported() { return { supported: true }; }
      state = "unconfigured";
      decodeQueueSize = 0;
      configure() { this.state = "configured"; }
      decode(c: { type: string; timestamp: number }) {
        if (c.type === "key" && failKeys.includes(keys++)) throw new DOMException("키프레임이 아님", "DataError");
        decoded.push(`${c.type}${c.timestamp}`);
      }
      close() { this.state = "closed"; }
    };
    return decoded;
  }
  const msg = (header: object) => encode(header, new Uint8Array([1, 1, 1]));

  it("decode가 바로 던지면 그 청크만 버리고 다음 키프레임부터 다시 푼다", async () => {
    const signals = fakeFetch([concat([
      msg({ type: "config", codec: "avc1.42E01F", width: 592, height: 1280 }),
      msg({ type: "chunk", key: true, ts: 0 }), msg({ type: "chunk", key: false, ts: 1 }),
      msg({ type: "chunk", key: true, ts: 2 }), msg({ type: "chunk", key: false, ts: 3 }),
    ])]);
    const decoded = fakeDecoder([0]);
    const d = runDecoder({ canvas, url: "http://x/api/eye/video", retryMs: 20 });
    stops.push(() => d.close());
    await until(() => decoded.length === 2);
    expect(decoded).toEqual(["key2", "delta3"]);
    expect(signals).toHaveLength(1);
    expect(signals[0]!.aborted).toBe(false);
  });

  it("스트림이 깨지면 그 연결을 끊고 다시 붙는다", async () => {
    const broken = new Uint8Array(8);
    new DataView(broken.buffer).setUint32(0, 10);
    new DataView(broken.buffer).setUint32(4, 0xffffffff);
    const signals = fakeFetch([broken, msg({ type: "config", codec: "avc1.42E01F", width: 592, height: 1280 })]);
    fakeDecoder([]);
    const d = runDecoder({ canvas, url: "http://x/api/eye/video", retryMs: 20 });
    stops.push(() => d.close());
    await until(() => signals.length === 2);
    expect(signals[0]!.aborted).toBe(true);
    d.close();
    expect(signals[1]!.aborted).toBe(true);
  });
});
