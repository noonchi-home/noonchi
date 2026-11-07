import { describe, expect, it } from "vitest";
import { engineDue } from "../web/phone/engine.js";
import { encodeFramePacket, parsePacket } from "../src/phone/packet.js";

describe("엔진 프레임", () => {
  it("간격이 지나야 보낸다", () => {
    expect(engineDue(null, 0, 1000)).toBe(true);
    expect(engineDue(0, 999, 1000)).toBe(false);
    expect(engineDue(0, 1000, 1000)).toBe(true);
  });
  it("engine 패킷은 투영 행렬 16개와 촬영 시각을 싣는다", () => {
    const projection = Array.from({ length: 16 }, (_, i) => (i % 5 === 0 ? 1 : 0));
    const p = parsePacket(encodeFramePacket({ kind: "engine", width: 480, height: 360, position: [0, 1.5, 0], orientation: [0, 0, 0, 1], captured_at: 1000, time_err_ms: 5, projection }, Buffer.from([0xff, 0xd8, 1])));
    expect("header" in p && p.header).toMatchObject({ kind: "engine", projection });
    expect("error" in parsePacket(encodeFramePacket({ kind: "engine", width: 480, height: 360, projection: [1, 2] } as never, Buffer.from([0xff, 0xd8])))).toBe(true);
  });
});
