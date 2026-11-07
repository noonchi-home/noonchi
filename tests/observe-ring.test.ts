import { describe, expect, it } from "vitest";
import { FrameRing, captureTime, sha256, type EngineFrame } from "../src/observe/ring.js";

const frame = (id: string, at: number, body = id): EngineFrame => ({ id, capturedAtMs: at, latestAtMs: at, jpeg: Buffer.from(body), sha256: sha256(Buffer.from(body)), width: 1, height: 1, eye: null, view: null });

describe("프레임 고리", () => {
  it("최근 20초만 두고 촬영 시각 순서로 둔다", () => {
    const r = new FrameRing();
    r.push(frame("a", 0)); r.push(frame("c", 21_000)); r.push(frame("b", 10_000));
    expect(r.frames().map((f) => f.id)).toEqual(["b", "c"]);
  });
  it("직전 프레임과 같은 사진이면 버리고 센다", () => {
    const r = new FrameRing();
    expect(r.push(frame("a", 0, "same"))).toBe(true);
    expect(r.push(frame("b", 1000, "same"))).toBe(false);
    expect(r.dropped).toBe(1);
    expect(r.get("b")).toBeUndefined();
  });
});

describe("captureTime", () => {
  it("폰 동기 시각이 있으면 오차만큼 이른 시각(가장 이른 가능 시각)", () => {
    expect(captureTime({ receivedAtMs: 10_000, capturedAt: 9_900, timeErrMs: 30 })).toEqual({ atMs: 9_870, latestMs: 9_930, source: "phone" });
  });
  it("받은 시각보다 늦을 수 없다", () => {
    expect(captureTime({ receivedAtMs: 10_000, capturedAt: 10_500, timeErrMs: 10 })).toMatchObject({ atMs: 10_000, latestMs: 10_000 });
  });
  it("동기 정보가 없거나 오차가 없으면 받은 시각(received)", () => {
    expect(captureTime({ receivedAtMs: 10_000, capturedAt: 9_900 })).toEqual({ atMs: 10_000, latestMs: 10_000, source: "received" });
    expect(captureTime({ receivedAtMs: 10_000 })).toEqual({ atMs: 10_000, latestMs: 10_000, source: "received" });
  });
});
