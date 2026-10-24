import { describe, expect, it } from "vitest";
import { encodeFramePacket, parseFramePacket, type FrameHeader } from "../src/phone/packet.js";

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 0xff, 0xd9]);

describe("frame packet", () => {
  it("헤더와 JPEG를 그대로 주고받는다", () => {
    const header: FrameHeader = { kind: "photo", width: 1920, height: 1440, position: [1, 1.4, 2], orientation: [0, 0, 0, 1], tracking: "ok" };
    expect(parseFramePacket(encodeFramePacket(header, JPEG))).toEqual({ header, jpeg: JPEG });
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
