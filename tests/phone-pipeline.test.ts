import { describe, expect, it } from "vitest";
import { createFramePipeline, createSendStats, frameWidth } from "../ui/src/phone/core/pipeline.js";

describe("프레임 인코딩 큐", () => {
  it("한 번에 두 장까지, 늦게 끝난 오래된 프레임은 버린다", () => {
    const q = createFramePipeline({ maxInFlight: 2 });
    expect(q.canStart()).toBe(true);
    const a = q.start();
    const b = q.start();
    expect(q.canStart()).toBe(false);
    expect(q.finish(b)).toBe(true); // 새 프레임이 먼저 끝나면 보낸다
    expect(q.canStart()).toBe(true);
    expect(q.finish(a)).toBe(false); // 그보다 오래된 a는 순서가 뒤바뀌므로 버린다
    const c = q.start();
    q.fail(c);
    expect(q.inFlight).toBe(0);
    const d = q.start();
    expect(q.finish(d)).toBe(true);
  });
});

describe("보낸 장 수·시간 측정(최근 2초)", () => {
  it("fps, readPixels·인코딩 평균, 건너뛴 이유", () => {
    let t = 10_000;
    const s = createSendStats({ windowMs: 2000, now: () => t });
    for (let i = 0; i < 6; i++) {
      s.sent({ bytes: 20_000, readMs: 4, encodeMs: 30 });
      t += 250;
    }
    s.skipped("encoding");
    s.skipped("encoding");
    s.skipped("buffer");
    s.skipped("stale");
    const snap = s.snapshot();
    expect(snap.fps).toBeCloseTo(3); // 2초 안에 6장
    expect(snap.readMs).toBeCloseTo(4);
    expect(snap.encodeMs).toBeCloseTo(30);
    expect(snap.kbPerFrame).toBeCloseTo(19.5, 1);
    s.skipped("engine");
    expect(s.snapshot().skipped).toEqual({ encoding: 2, buffer: 1, stale: 1, engine: 1 });
    t += 5000;
    expect(s.snapshot()).toMatchObject({ fps: 0, skipped: { encoding: 0, buffer: 0, stale: 0 } });
  });
});

describe("기본 프레임 크기", () => {
  it("가로 촬영 480, 세로 360, ?w가 있으면 그것", () => {
    expect(frameWidth(null, false)).toBe(480);
    expect(frameWidth(null, true)).toBe(360);
    expect(frameWidth("640", true)).toBe(640);
    expect(frameWidth("99999", false)).toBe(1280);
    expect(frameWidth("abc", false)).toBe(480);
  });
});
