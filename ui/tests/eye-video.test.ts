// 눈 영상(H.264) 순수 부분: web/eye-video.js를 TS로 옮긴 ui/src/dashboard/panels/eye-video.ts. 루트 tests/eye-video.test.ts와 같은 규칙.
import { afterEach, describe, expect, it, vi } from "vitest";
import { createDecodeGate, createDelayLine, createDisplayMode, createStreamParser, runDecoder } from "../src/dashboard/panels/eye-video";

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

// 장면·마스크 짝 맞추기(2026-11-20): 대시보드는 장면을 마스크 지연만큼 들고 있다가 그리고, 장면마다 서버 시계 촬영 시각(at)을 알린다
describe("장면 늦추기(createDelayLine)", () => {
  afterEach(() => { vi.useRealTimers(); });
  it("장면마다 받은 때 + 지연에 그린다. 한꺼번에 때가 되면 가장 새 장면만 그리고 앞 장면은 버린다. 그린 장면도 그린 뒤 놓는다", () => {
    vi.useFakeTimers();
    const drawn: string[] = [];
    const dropped: string[] = [];
    const line = createDelayLine<string>({ draw: (img, at) => drawn.push(`${img}@${at}`), drop: (img) => dropped.push(img), now: () => Date.now() });
    line.setDelay(300);
    line.push(1000, "a");
    vi.advanceTimersByTime(33);
    line.push(1033, "b");
    vi.advanceTimersByTime(266);
    expect(drawn).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(drawn).toEqual(["a@1000"]);
    vi.advanceTimersByTime(33);
    expect(drawn).toEqual(["a@1000", "b@1033"]);
    line.push(1066, "c");
    line.push(1099, "d");
    line.setDelay(0);
    expect(drawn).toEqual(["a@1000", "b@1033", "d@1099"]);
    expect(dropped).toEqual(["a", "b", "c", "d"]);
  });

  it("들고 있는 장면이 max를 넘으면 가장 오래된 장면부터 버린다", () => {
    vi.useFakeTimers();
    const dropped: string[] = [];
    const line = createDelayLine<string>({ draw: () => {}, drop: (img) => dropped.push(img), now: () => Date.now(), max: 2 });
    line.setDelay(500);
    for (const img of ["a", "b", "c"]) line.push(null, img);
    expect(dropped).toEqual(["a"]);
    line.close();
    expect(dropped).toEqual(["a", "b", "c"]);
  });
});

describe("장면 시각(runDecoder)", () => {
  type G = Record<string, unknown>;
  const g = globalThis as unknown as G;
  const saved = { fetch: globalThis.fetch, VideoDecoder: g.VideoDecoder, EncodedVideoChunk: g.EncodedVideoChunk, createImageBitmap: g.createImageBitmap };
  const stops: (() => void)[] = [];
  afterEach(() => {
    for (const s of stops.splice(0)) s();
    globalThis.fetch = saved.fetch;
    Object.assign(g, { VideoDecoder: saved.VideoDecoder, EncodedVideoChunk: saved.EncodedVideoChunk, createImageBitmap: saved.createImageBitmap });
  });
  const until = async (ok: () => boolean, ms = 2000) => {
    for (let t = 0; t < ms && !ok(); t += 10) await new Promise((r) => setTimeout(r, 10));
    expect(ok()).toBe(true);
  };
  const serve = (bytes: Uint8Array) => {
    globalThis.fetch = (async () => new Response(new ReadableStream({ start(c) { c.enqueue(bytes); } }))) as unknown as typeof fetch;
  };
  const drawnSizes: [number, number][] = [];
  const canvas = { width: 0, height: 0, getContext: () => ({ drawImage(_i: unknown, _x: number, _y: number, w: number, h: number) { drawnSizes.push([w, h]); } }) } as unknown as HTMLCanvasElement;
  const bitmaps = () => {
    const closed: number[] = [];
    g.createImageBitmap = async (src: { width?: number; height?: number; displayWidth?: number; displayHeight?: number }) => {
      const width = src.displayWidth ?? 4, height = src.displayHeight ?? 2;
      return { width, height, close: () => closed.push(width) };
    };
    return closed;
  };

  it("영상 모드 화면 프레임(jpeg 메시지)은 그 촬영 시각으로 알리고, 지연만큼 들고 있다가 그린 뒤 그 시각을 알린다", async () => {
    bitmaps();
    serve(concat([encode({ type: "jpeg", at: 5000, width: 4, height: 2 }, new Uint8Array([0xff, 0xd8, 0xff, 0xd9]))]));
    const frames: (number | null)[] = [];
    const shown: (number | null)[] = [];
    const d = runDecoder({ canvas, url: "http://x/api/eye/video", onFrame: (at) => frames.push(at), onShown: (at) => shown.push(at) });
    stops.push(() => d.close());
    d.setDelay(200);
    await until(() => frames.length === 1);
    expect([frames, shown]).toEqual([[5000], []]);
    await until(() => shown.length === 1, 1000);
    expect(shown).toEqual([5000]);
    expect([canvas.width, canvas.height]).toEqual([4, 2]);
  });

  it("H.264 청크의 at(서버 시계 촬영 시각)을 디코더 timestamp(µs)로 넣고, 풀린 장면을 그 시각으로 알린다. at이 없으면 null", async () => {
    bitmaps();
    serve(concat([
      encode({ type: "config", codec: "avc1.42E01F", width: 8, height: 6 }, new Uint8Array([1])),
      encode({ type: "chunk", key: true, ts: 0, at: 7000 }, new Uint8Array([1])),
      encode({ type: "chunk", key: false, ts: 33_333 }, new Uint8Array([1])),
    ]));
    const decoded: number[] = [];
    g.EncodedVideoChunk = class { constructor(init: object) { Object.assign(this, init); } };
    g.VideoDecoder = class {
      static async isConfigSupported() { return { supported: true }; }
      state = "unconfigured";
      decodeQueueSize = 0;
      constructor(private readonly init: { output: (f: object) => void }) {}
      configure() { this.state = "configured"; }
      decode(c: { timestamp: number }) {
        decoded.push(c.timestamp);
        this.init.output({ timestamp: c.timestamp, displayWidth: 8, displayHeight: 6, close() {} });
      }
      close() { this.state = "closed"; }
    };
    const shown: (number | null)[] = [];
    const d = runDecoder({ canvas, url: "http://x/api/eye/video", onShown: (at) => shown.push(at) });
    stops.push(() => d.close());
    await until(() => shown.length === 2);
    expect(decoded).toEqual([7_000_000, 33_333]);
    expect(shown).toEqual([7000, null]);
  });
});
