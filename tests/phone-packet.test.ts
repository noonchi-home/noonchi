import { describe, expect, it } from "vitest";
import { encodeFramePacket, parseFramePacket, parsePacket, type FrameHeader, type VideoHeader } from "../src/phone/packet.js";

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 0xff, 0xd9]);

describe("frame packet", () => {
  it("헤더와 JPEG를 그대로 주고받는다", () => {
    const header: FrameHeader = { kind: "photo", width: 1920, height: 1440, position: [1, 1.4, 2], orientation: [0, 0, 0, 1], tracking: "ok" };
    expect(parseFramePacket(encodeFramePacket(header, JPEG))).toEqual({ header, jpeg: JPEG });
  });

  it("엔진 프레임의 held(붙잡은 장면 다시 보내기)는 true만 받아 그대로 넘긴다", () => {
    const header: FrameHeader = { kind: "engine", width: 480, height: 360, captured_at: 1000, time_err_ms: 0, held: true };
    expect(parseFramePacket(encodeFramePacket(header, JPEG))).toEqual({ header, jpeg: JPEG });
    expect(parseFramePacket(encodeFramePacket({ ...header, held: false } as never, JPEG))).toMatchObject({ error: expect.stringContaining("held") });
  });

  it("짧은 패킷·깨진 헤더·JPEG 아님·잘못된 크기는 이유를 준다", () => {
    expect(parseFramePacket(Buffer.from([0, 0]))).toEqual({ error: "패킷이 너무 짧습니다" });
    const broken = Buffer.concat([Buffer.from([0, 0, 0, 3]), Buffer.from("{x}"), JPEG]);
    expect(parseFramePacket(broken)).toEqual({ error: "헤더 JSON을 읽지 못했습니다" });
    expect(parseFramePacket(encodeFramePacket({ kind: "frame", width: 640, height: 480 }, Buffer.from([1, 2])))).toEqual({ error: "JPEG가 아닙니다" });
    expect(parseFramePacket(encodeFramePacket({ kind: "frame", width: 0, height: 480 }, JPEG))).toMatchObject({ error: expect.stringContaining("헤더") });
  });

  it("헤더 길이가 실제보다 길면 거절한다", () => {
    const lying = Buffer.concat([Buffer.from([0, 0, 0x10, 0]), Buffer.from("{}")]);
    expect(parseFramePacket(lying)).toEqual({ error: "헤더 길이가 맞지 않습니다" });
  });
});

describe("표시 영상 패킷", () => {
  const AVCC = Buffer.from([1, 0x42, 0xe0, 0x1f, 0xff]);
  const CHUNK = Buffer.from([0, 0, 0, 2, 0x65, 0x88]);

  it("video_config·video는 영상 헤더와 본문으로, frame·photo는 JPEG로 나눈다", () => {
    const config: VideoHeader = { kind: "video_config", codec: "avc1.42E01F", width: 592, height: 1280 };
    expect(parsePacket(encodeFramePacket(config, AVCC))).toEqual({ video: config, data: AVCC });
    const chunk: VideoHeader = { kind: "video", key: true, ts: 33_333, width: 592, height: 1280 };
    expect(parsePacket(encodeFramePacket(chunk, CHUNK))).toEqual({ video: chunk, data: CHUNK });
    const frame: FrameHeader = { kind: "frame", width: 360, height: 780 };
    expect(parsePacket(encodeFramePacket(frame, JPEG))).toEqual({ header: frame, jpeg: JPEG });
  });

  it("영상 청크는 엔진 프레임처럼 서버 시계 촬영 시각(captured_at)과 오차(time_err_ms)를 실을 수 있다", () => {
    const chunk: VideoHeader = { kind: "video", key: false, ts: 66_666, width: 592, height: 1280, captured_at: 1_763_600_000_123, time_err_ms: 4 };
    expect(parsePacket(encodeFramePacket(chunk, CHUNK))).toEqual({ video: chunk, data: CHUNK });
    expect(parsePacket(encodeFramePacket({ ...chunk, time_err_ms: -1 } as VideoHeader, CHUNK))).toMatchObject({ error: expect.stringContaining("time_err_ms") });
  });

  it("설정의 description은 비어도 되고, 청크는 비면 안 된다", () => {
    const config: VideoHeader = { kind: "video_config", codec: "avc1.42E01F", width: 592, height: 1280 };
    expect(parsePacket(encodeFramePacket(config, Buffer.alloc(0)))).toEqual({ video: config, data: Buffer.alloc(0) });
    expect(parsePacket(encodeFramePacket({ kind: "video", key: false, ts: 1, width: 592, height: 1280 }, Buffer.alloc(0))))
      .toEqual({ error: "영상 청크가 비었습니다" });
  });

  it("코덱 이름·키 표시·시각이 없거나 이상하면 거절한다", () => {
    const bad = (h: object) => parsePacket(encodeFramePacket(h as VideoHeader, CHUNK));
    expect(bad({ kind: "video_config", width: 592, height: 1280 })).toMatchObject({ error: expect.stringContaining("codec") });
    expect(bad({ kind: "video_config", codec: "avc1\"><script>", width: 592, height: 1280 })).toMatchObject({ error: expect.stringContaining("codec") });
    expect(bad({ kind: "video", ts: 1, width: 592, height: 1280 })).toMatchObject({ error: expect.stringContaining("key") });
    expect(bad({ kind: "video", key: true, ts: -1, width: 592, height: 1280 })).toMatchObject({ error: expect.stringContaining("ts") });
  });

  it("디코더 설정(description)은 64KB까지만 받는다", () => {
    const config: VideoHeader = { kind: "video_config", codec: "avc1.42E01F", width: 592, height: 1280 };
    expect(parsePacket(encodeFramePacket(config, Buffer.alloc(64 * 1024)))).toMatchObject({ video: config });
    expect(parsePacket(encodeFramePacket(config, Buffer.alloc(64 * 1024 + 1)))).toEqual({ error: "디코더 설정이 너무 큽니다" });
  });

  it("parseFramePacket은 영상 패킷을 JPEG로 받지 않는다", () => {
    expect(parseFramePacket(encodeFramePacket({ kind: "video", key: true, ts: 0, width: 592, height: 1280 }, CHUNK)))
      .toEqual({ error: "JPEG 패킷이 아닙니다" });
  });
});
