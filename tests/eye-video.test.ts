// 대시보드 눈 영상(web/eye-video.js)의 순수 부분: 영상/JPEG 고르기, 디코더 관문, 캡션.
import { afterEach, describe, expect, it } from "vitest";
import { encodeStreamMessage } from "../src/phone/video.js";
import { createDecodeGate, createDisplayMode, displayCaption, runDecoder } from "../web/eye-video.js";

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
    m.reset(); // 폰 영상이 끝남
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
    expect(g.accept(true, 6)).toBe(false); // 아직 밀림
    expect(g.accept(true, 1)).toBe(true);
    expect(g.accept(false, 1)).toBe(true);
  });
});

describe("눈 캡션", () => {
  it("영상 통계가 있으면 코덱·크기·fps·Mbps, 없으면 null", () => {
    expect(displayCaption({ codec: "avc1.42E01F", width: 592, height: 1280, fps: 29.5, kbps: 1830 }))
      .toBe("클로이드의 눈 · 실시간 H.264 592×1280 29.5 fps · 1.8Mbps · 엔진 입력 아님");
    expect(displayCaption({ codec: null, width: null, height: null, fps: 0, kbps: 0 })).toBeNull();
    expect(displayCaption({ codec: "avc1.42E01F", width: 592, height: 1280, fps: 0, kbps: 0 })).toBeNull();
    expect(displayCaption(undefined)).toBeNull();
  });
});

// runDecoder를 Node에서 돌리려고 WebCodecs·fetch를 흉내 낸다
describe("영상 스트림 읽기(runDecoder)", () => {
  const saved = { fetch: globalThis.fetch, VideoDecoder: (globalThis as any).VideoDecoder, EncodedVideoChunk: (globalThis as any).EncodedVideoChunk };
  const stops: (() => void)[] = [];
  afterEach(() => {
    for (const s of stops.splice(0)) s();
    globalThis.fetch = saved.fetch;
    (globalThis as any).VideoDecoder = saved.VideoDecoder;
    (globalThis as any).EncodedVideoChunk = saved.EncodedVideoChunk;
  });
  const until = async (ok: () => boolean, ms = 2000) => {
    for (let t = 0; t < ms && !ok(); t += 10) await new Promise((r) => setTimeout(r, 10));
    expect(ok()).toBe(true);
  };
  const canvas = { width: 0, height: 0, getContext: () => ({ drawImage() {} }) };
  /** fetch마다 bodies에서 하나씩 꺼내 스트림으로 준다(끝내지 않고 열어 둔다). */
  function fakeFetch(bodies: Buffer[]) {
    const signals: AbortSignal[] = [];
    globalThis.fetch = (async (_url: string, init: RequestInit) => {
      signals.push(init.signal!);
      const body = bodies.shift() ?? Buffer.alloc(0);
      return new Response(new ReadableStream({ start(c) { c.enqueue(new Uint8Array(body)); } }));
    }) as typeof fetch;
    return signals;
  }
  function fakeDecoder(failKeys: number[]) {
    const decoded: string[] = [];
    let keys = 0;
    (globalThis as any).EncodedVideoChunk = class { constructor(init: object) { Object.assign(this, init); } };
    (globalThis as any).VideoDecoder = class {
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
  const msg = (header: object, bytes = 3) => encodeStreamMessage(header, Buffer.alloc(bytes, 1));

  it("decode가 바로 던지면(깨진 키프레임) 그 청크만 버리고 다음 키프레임부터 다시 푼다", async () => {
    const signals = fakeFetch([Buffer.concat([
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
    const broken = Buffer.alloc(8);
    broken.writeUInt32BE(10, 0);
    broken.writeUInt32BE(0xffffffff, 4);
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
