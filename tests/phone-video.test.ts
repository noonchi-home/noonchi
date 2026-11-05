// 표시 영상 중계(src/phone/video.ts): 설정·GOP 캐시, 늦게 붙은 화면, 느린 화면 건너뛰기, 다른 연결 무시, 통계.
import { describe, expect, it } from "vitest";
import { encodeStreamMessage, VideoRelay, type VideoSink } from "../src/phone/video.js";
import { createStreamParser } from "../web/eye-video.js";

const DESC = Buffer.from([1, 0x42, 0xe0, 0x1f]);
const cfg = (codec = "avc1.42E01F") => ({ codec, width: 592, height: 1280, description: DESC });
const chunk = (key: boolean, ts: number, bytes = 1000) => ({ key, ts, width: 592, height: 1280, data: Buffer.alloc(bytes, key ? 0x65 : 0x41) });

/** 받은 바이트를 화면 쪽 파서(web/eye-video.js)로 읽는 가짜 화면. writableLength를 정해 느린 화면을 흉내 낸다. */
function sink() {
  const parser = createStreamParser();
  const got: { header: Record<string, unknown>; body: Uint8Array }[] = [];
  let close: (() => void) | null = null;
  const s: VideoSink & { got: typeof got; slow: number; ended: boolean; hangUp(): void } = {
    got, slow: 0, ended: false,
    get writableLength() { return s.slow; },
    write(buf: Buffer) { got.push(...parser.push(new Uint8Array(buf))); return true; },
    end() { s.ended = true; },
    once(_event: "close", fn: () => void) { close = fn; },
    hangUp() { close?.(); },
  };
  return s;
}
const kinds = (s: ReturnType<typeof sink>) => s.got.map((m) => (m.header.type === "chunk" ? (m.header.key ? `K${m.header.ts}` : `d${m.header.ts}`) : String(m.header.type)));

describe("VideoRelay", () => {
  it("설정과 청크를 붙은 화면에 그대로 보낸다(메시지 경계·본문 유지)", () => {
    const relay = new VideoRelay();
    const a = sink();
    relay.attach(a);
    relay.config(1, cfg());
    relay.chunk(1, chunk(true, 0));
    relay.chunk(1, chunk(false, 33_333, 7));
    expect(kinds(a)).toEqual(["config", "K0", "d33333"]);
    expect(a.got[0]).toEqual({ header: { type: "config", codec: "avc1.42E01F", width: 592, height: 1280 }, body: new Uint8Array(DESC) });
    expect(a.got[2]!.body).toEqual(new Uint8Array(Buffer.alloc(7, 0x41)));
  });

  it("늦게 붙은 화면은 설정과 마지막 키프레임부터의 묶음을 먼저 받는다", () => {
    const relay = new VideoRelay();
    relay.config(1, cfg());
    relay.chunk(1, chunk(true, 0));
    relay.chunk(1, chunk(false, 1));
    relay.chunk(1, chunk(true, 2));
    relay.chunk(1, chunk(false, 3));
    const late = sink();
    relay.attach(late);
    relay.chunk(1, chunk(false, 4));
    expect(kinds(late)).toEqual(["config", "K2", "d3", "d4"]);
  });

  it("키프레임 전 델타는 캐시하지 않고, 설정 전 청크는 버린다", () => {
    const relay = new VideoRelay();
    relay.chunk(1, chunk(true, 0));
    expect(relay.stats().codec).toBeNull();
    relay.config(1, cfg());
    relay.chunk(1, chunk(false, 1));
    const late = sink();
    relay.attach(late);
    expect(kinds(late)).toEqual(["config"]);
    relay.chunk(1, chunk(false, 2));
    relay.chunk(1, chunk(true, 3));
    expect(kinds(late)).toEqual(["config", "K3"]);
  });

  it("느린 화면은 델타를 건너뛰고 다음 키프레임부터 다시 받는다", () => {
    const relay = new VideoRelay({ maxBuffered: 100 });
    const slow = sink();
    const fast = sink();
    relay.config(1, cfg());
    relay.attach(slow);
    relay.attach(fast);
    relay.chunk(1, chunk(true, 0));
    slow.slow = 500;
    relay.chunk(1, chunk(false, 1));
    slow.slow = 0;
    relay.chunk(1, chunk(false, 2)); // 버퍼는 비었지만 1을 놓쳐 2는 못 푼다
    relay.chunk(1, chunk(true, 3));
    relay.chunk(1, chunk(false, 4));
    expect(kinds(slow)).toEqual(["config", "K0", "K3", "d4"]);
    expect(kinds(fast)).toEqual(["config", "K0", "d1", "d2", "K3", "d4"]);
  });

  it("다른 연결의 청크는 무시하고, 새 연결이 설정을 보내면 그 연결로 바꾼다", () => {
    const relay = new VideoRelay();
    const a = sink();
    relay.attach(a);
    relay.config(1, cfg());
    relay.chunk(1, chunk(true, 0));
    relay.chunk(2, chunk(true, 100));
    expect(kinds(a)).toEqual(["config", "K0"]);
    relay.config(2, cfg("avc1.4D401F"));
    relay.chunk(1, chunk(false, 1)); // 이전 연결은 이제 무시
    relay.chunk(2, chunk(false, 101)); // 새 설정 뒤 키프레임 전 델타는 못 푼다
    relay.chunk(2, chunk(true, 102));
    expect(kinds(a)).toEqual(["config", "K0", "config", "K102"]);
    expect(relay.stats().codec).toBe("avc1.4D401F");
  });

  it("연결이 끝나면 캐시를 비우고 화면에 end를 보낸다", () => {
    const relay = new VideoRelay();
    const a = sink();
    relay.attach(a);
    relay.config(1, cfg());
    relay.chunk(1, chunk(true, 0));
    relay.endSource(2); // 다른 연결은 상관없다
    relay.endSource(1);
    expect(kinds(a)).toEqual(["config", "K0", "end"]);
    const late = sink();
    relay.attach(late);
    expect(late.got).toEqual([]);
    expect(relay.stats()).toMatchObject({ codec: null, width: null, key_age_ms: null });
  });

  it("GOP가 너무 커지면 캐시를 버리고 다음 키프레임까지 늦게 붙은 화면은 기다린다", () => {
    const relay = new VideoRelay({ maxGopBytes: 2500 });
    relay.config(1, cfg());
    relay.chunk(1, chunk(true, 0, 1000));
    relay.chunk(1, chunk(false, 1, 1000));
    relay.chunk(1, chunk(false, 2, 1000));
    const late = sink();
    relay.attach(late);
    relay.chunk(1, chunk(false, 3));
    relay.chunk(1, chunk(true, 4));
    expect(kinds(late)).toEqual(["config", "K4"]);
  });

  it("통계: 최근 2초 fps·kbps, 마지막 키프레임 나이, 붙은 화면 수. 닫힌 화면은 뺀다", () => {
    let t = 10_000;
    const relay = new VideoRelay({ now: () => t });
    expect(relay.stats()).toEqual({ codec: null, width: null, height: null, fps: 0, kbps: 0, key_age_ms: null, viewers: 0 });
    const a = sink();
    relay.attach(a);
    relay.attach(sink());
    relay.config(1, cfg());
    for (let i = 0; i < 60; i++) {
      relay.chunk(1, chunk(i % 30 === 0, i, 2500));
      t += 1000 / 30;
    }
    a.hangUp();
    const s = relay.stats();
    expect(s).toMatchObject({ codec: "avc1.42E01F", width: 592, height: 1280, viewers: 1 });
    expect(s.fps).toBeGreaterThanOrEqual(29.5);
    expect(s.fps).toBeLessThanOrEqual(30);
    expect(s.kbps).toBeGreaterThanOrEqual(590); // 2500B × 8 × 30장/초 = 600kbps
    expect(s.kbps).toBeLessThanOrEqual(600);
    expect(s.key_age_ms).toBe(1000);
  });

  it("설정을 보낼 때 버퍼가 넘친 화면은 끊는다(다시 붙으면 설정·GOP부터 받는다)", () => {
    const relay = new VideoRelay({ maxBuffered: 100 });
    const slow = sink();
    const fast = sink();
    relay.attach(slow);
    relay.attach(fast);
    slow.slow = 500;
    relay.config(1, cfg());
    expect(slow.ended).toBe(true);
    expect(slow.got).toEqual([]);
    expect(kinds(fast)).toEqual(["config"]);
    expect(relay.stats().viewers).toBe(1);
  });

  it("GOP가 화면 버퍼 한도보다 크면 늦게 붙은 화면에 한꺼번에 쓰지 않고 다음 키프레임부터 보낸다", () => {
    const relay = new VideoRelay({ maxBuffered: 2500 });
    relay.config(1, cfg());
    relay.chunk(1, chunk(true, 0, 1000));
    relay.chunk(1, chunk(false, 1, 1000));
    relay.chunk(1, chunk(false, 2, 1000));
    const late = sink();
    relay.attach(late);
    expect(kinds(late)).toEqual(["config"]);
    relay.chunk(1, chunk(true, 3, 1000));
    expect(kinds(late)).toEqual(["config", "K3"]);
  });

  it("close는 모든 화면 스트림을 끝낸다", () => {
    const relay = new VideoRelay();
    const a = sink();
    relay.attach(a);
    relay.close();
    expect(a.ended).toBe(true);
    expect(relay.stats().viewers).toBe(0);
  });
});

describe("스트림 메시지", () => {
  it("여러 메시지가 붙거나 잘려 와도 경계대로 읽는다", () => {
    const bytes = Buffer.concat([
      encodeStreamMessage({ type: "config", codec: "avc1.42E01F" }, DESC),
      encodeStreamMessage({ type: "chunk", key: true, ts: 5 }, Buffer.alloc(3000, 7)),
      encodeStreamMessage({ type: "end" }, Buffer.alloc(0)),
    ]);
    const parser = createStreamParser();
    const out = [];
    for (let i = 0; i < bytes.length; i += 7) out.push(...parser.push(new Uint8Array(bytes.subarray(i, i + 7))));
    expect(out.map((m) => m.header.type)).toEqual(["config", "chunk", "end"]);
    expect(out[1]!.body.length).toBe(3000);
    expect(out[2]!.body.length).toBe(0);
  });

  it("말이 안 되는 길이를 받으면 던진다(스트림을 다시 붙이게)", () => {
    const parser = createStreamParser({ maxMessageBytes: 1024 });
    const head = Buffer.alloc(8);
    head.writeUInt32BE(10, 0);
    head.writeUInt32BE(5000, 4);
    expect(() => parser.push(new Uint8Array(head))).toThrow();
  });
});
