// 엔진 프레임(분석용 사진) 보내기 차례: 서버가 알린 간격(engine_ms, 기본 100ms)마다, 밀리면 건너뛰고 쌓지 않는다.
import { describe, expect, it } from "vitest";
import { engineStep, grabOnce } from "../src/phone/core/engine.js";

/** 그림 틀(rAF)을 tickMs마다 durationMs 동안 돌리며 엔진 프레임 차례를 본다. busy(now)가 참이면 앞 엔진 프레임이 아직 인코딩 중이다. */
function run(tickMs: number, durationMs: number, intervalMs: number, o: { busy?: (now: number) => boolean; buffered?: (now: number) => number } = {}) {
  let last: number | null = null;
  const out: { at: number; action: string }[] = [];
  for (let k = 0; k * tickMs < durationMs; k++) {
    const now = k * tickMs;
    const step = engineStep({ last, now, intervalMs, canStart: !(o.busy?.(now) ?? false), buffered: o.buffered?.(now) ?? 0, maxBuffered: 512 * 1024 });
    last = step.last;
    if (step.action !== "wait") out.push({ at: Math.round(now), action: step.action });
  }
  return out;
}
const sends = (list: { action: string }[]) => list.filter((x) => x.action === "send").length;

describe("엔진 프레임 차례(engineStep)", () => {
  it("engine_ms 100이면 1초 동안 10장 나간다. 그림 틀이 16.7ms·33.3ms여도 간격이 밀리지 않는다", () => {
    expect(sends(run(1000 / 60, 1000, 100))).toBe(10);
    expect(sends(run(1000 / 60, 2000, 100))).toBe(20);
    expect(sends(run(1000 / 30, 1000, 100))).toBe(10);
    // 간격이 2초면 지금처럼 2초에 한 장
    expect(run(20, 6000, 2000).map((x) => x.at)).toEqual([0, 2000, 4000]);
  });

  it("간격이 0이거나 없으면 보내지 않는다(서버가 관찰 흐름을 안 켬)", () => {
    expect(run(1000 / 60, 1000, 0)).toEqual([]);
  });

  it("앞 엔진 프레임이 아직 인코딩 중이면 그 차례는 건너뛰고 쌓지 않는다: 풀린 뒤에도 한꺼번에 내보내지 않는다", () => {
    // 300~650ms 동안 인코딩이 밀린다
    const out = run(20, 1000, 100, { busy: (now) => now >= 300 && now < 650 });
    expect(out.filter((x) => x.action === "encoding").map((x) => x.at)).toEqual([300, 400, 500, 600]);
    expect(out.filter((x) => x.action === "send").map((x) => x.at)).toEqual([0, 100, 200, 700, 800, 900]);
  });

  it("보낼 것이 와이파이에 쌓여 있으면 그 차례를 건너뛴다", () => {
    const out = run(20, 500, 100, { buffered: (now) => (now >= 200 && now < 350 ? 600 * 1024 : 0) });
    expect(out.map((x) => [x.at, x.action])).toEqual([[0, "send"], [100, "send"], [200, "buffer"], [300, "buffer"], [400, "send"]]);
  });

  it("오래 멈췄다 돌아오면(탭 전환) 밀린 차례를 몰아서 보내지 않는다", () => {
    let last: number | null = null;
    const at = (now: number) => {
      const s = engineStep({ last, now, intervalMs: 100, canStart: true, buffered: 0, maxBuffered: 1 });
      last = s.last;
      return s.action;
    };
    expect([at(0), at(100), at(5000), at(5016), at(5033), at(5100)]).toEqual(["send", "send", "send", "wait", "wait", "send"]);
  });
});

describe("한 그림 틀의 사진 잡기(grabOnce)", () => {
  const grabber = () => {
    const calls: string[] = [];
    const grab = (width: number, height: number) => {
      calls.push(`${width}x${height}`);
      return new Uint8Array(width * height * 4).fill(calls.length);
    };
    return { grab, calls };
  };

  it("표시용 사진과 엔진 프레임이 같은 그림 틀에서 둘 다 때가 됐고 크기가 같으면 grab은 한 번만 한다. 픽셀 버퍼는 따로다(워커로 넘어가므로)", () => {
    const g = grabber();
    const [engine, frame] = grabOnce(g.grab, [{ width: 4, height: 2 }, { width: 4, height: 2 }]);
    expect(g.calls).toEqual(["4x2"]);
    expect(engine!.pixels).toEqual(frame!.pixels);
    expect(engine!.pixels.buffer).not.toBe(frame!.pixels.buffer);
    expect(engine!.readMs).toBeGreaterThanOrEqual(0);
    expect(frame!.readMs).toBe(0); // 다시 읽지 않았다
  });

  it("크기가 다르면 따로 잡는다. 하나만 때가 됐으면 그것만 잡는다", () => {
    const g = grabber();
    const [a, b] = grabOnce(g.grab, [{ width: 4, height: 2 }, { width: 8, height: 4 }]);
    expect(g.calls).toEqual(["4x2", "8x4"]);
    expect([a!.pixels.length, b!.pixels.length]).toEqual([32, 128]);
    const one = grabber();
    expect(grabOnce(one.grab, [null, { width: 4, height: 2 }]).map((x) => x?.pixels.length ?? null)).toEqual([null, 32]);
    expect(one.calls).toEqual(["4x2"]);
  });
});
