import { describe, expect, it } from "vitest";
import { FrameRing, captureTime, sha256, type EngineFrame } from "../src/observe/ring.js";

const frame = (id: string, at: number, body = id): EngineFrame => ({ id, capturedAtMs: at, latestAtMs: at, jpeg: Buffer.from(body), sha256: sha256(Buffer.from(body)), width: 1, height: 1, eye: null, view: null });

describe("프레임 고리", () => {
  it("최근 20초만 두고 촬영 시각 순서로 둔다", () => {
    const r = new FrameRing();
    r.push(frame("a", 0)); r.push(frame("c", 21_000)); r.push(frame("b", 10_000));
    expect(r.frames().map((f) => f.id)).toEqual(["b", "c"]);
  });
  it("VLM 창은 빠른 프레임(vlm: false)을 빼고 VLM 프레임만 고른다", () => {
    const r = new FrameRing();
    for (let i = 0; i <= 100; i++) r.push({ ...frame(`f${i}`, i * 100), vlm: i % 20 === 0 });
    const last = r.frames().at(-1)!;
    expect(r.window(last, 5, 10_000).map((f) => f.id)).toEqual(["f20", "f40", "f60", "f80", "f100"]);
    // 지금 프레임이 빠른 프레임이어도 그 프레임은 넣는다(앞 장은 VLM 프레임만)
    r.push({ ...frame("f101", 10_100), vlm: false });
    expect(r.window(r.frames().at(-1)!, 3, 10_000).map((f) => f.id)).toEqual(["f80", "f100", "f101"]);
  });
  it("직전 프레임과 같은 사진이면 버리고 센다", () => {
    const r = new FrameRing();
    expect(r.push(frame("a", 0, "same"))).toBe("added");
    expect(r.push(frame("b", 1000, "same"))).toBe("duplicate");
    expect(r.dropped).toBe(1);
    expect(r.get("b")).toBeUndefined();
  });
  it("가장 새 프레임보다 20초 넘게 앞선 프레임은 넣지 않고 stale", () => {
    const r = new FrameRing();
    r.push(frame("a", 30_000));
    expect(r.push(frame("b", 9_999))).toBe("stale");
    expect(r.push(frame("c", 10_000))).toBe("added");
    expect(r.frames().map((f) => f.id)).toEqual(["c", "a"]);
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
