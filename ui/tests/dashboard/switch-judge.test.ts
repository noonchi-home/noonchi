// @vitest-environment node
// 단계 바뀜 재기(scripts/measure-switch.mjs)의 판정: 바뀜마다 따로 보고, 한 번 길게 멈춘 것도 실패로 잡는다.
import { describe, expect, it } from "vitest";
import { droppedFrames, expectedFrames, gapsAround, judgeRun, judgeSwitch, stepEdges, WIN } from "../../scripts/switch-judge.mjs";

const V = 16.7;
/** 창(앞 0.1초 ~ 뒤 0.8초) 안 그림 간격: 보통 vsync, 몇 개만 길다. */
const pageOf = (long: number[] = [], extra: Partial<{ longTask: number }> = {}) => {
  const gaps = [...long];
  let span = long.reduce((s, g) => s + g, 0);
  while (span < WIN.before + WIN.after + V / 2) { gaps.push(V); span += V; }
  return { frames: gaps.length, gaps, worstGap: Math.max(...gaps), longTask: extra.longTask ?? 0 };
};

describe("잴 때", () => {
  it("단계가 바뀌는 때마다 잰다: 처음 그린 때부터 단계 길이마다, 잴 시간 안에서", () => {
    expect(stepEdges(10, 4000)).toEqual([4000, 8000]);
    expect(stepEdges(24, 4000)).toEqual([4000, 8000, 12000, 16000, 20000]);
    expect(stepEdges(4, 4000)).toEqual([]);
  });
});

describe("바뀜 하나 판정", () => {
  it("창은 바뀌기 0.1초 앞부터 움직임이 끝나고 판을 다시 그리는 0.8초 뒤까지다. 나와야 할 그림은 창 길이 ÷ vsync + 1개다", () => {
    expect(WIN).toEqual({ before: 100, after: 800 });
    expect(expectedFrames(V)).toBe(55);
    expect(pageOf().frames).toBe(55);
  });

  it("창 끝에 걸친 긴 간격도 센다", () => {
    const raf = [...Array.from({ length: 30 }, (_, i) => 4000 + i * V), 4539, 4722, ...Array.from({ length: 30 }, (_, i) => 4739 + i * V)];
    const gaps = gapsAround(raf, 4110);
    expect(Math.max(...gaps)).toBeCloseTo(183, 0);
    const late = [...Array.from({ length: 50 }, (_, i) => 4000 + i * V), 4000 + 49 * V + 300, ...Array.from({ length: 10 }, (_, i) => 4000 + 49 * V + 300 + (i + 1) * V)];
    expect(Math.max(...gapsAround(late, 4100))).toBeCloseTo(300, 0);
  });

  it("창 앞에 걸친 긴 간격도 센다", () => {
    const raf = [3700, 4100, ...Array.from({ length: 60 }, (_, i) => 4100 + (i + 1) * V)];
    expect(gapsAround(raf, 4100)[0]).toBe(400);
  });

  it("한 그림만 늦은 보통 바뀜은 통과한다", () => {
    expect(judgeSwitch(pageOf([33.4]), V)).toEqual([]);
    expect(judgeSwitch(pageOf([50]), V)).toEqual([]);
  });

  it("0.25초 한 번 멈추면 주 스레드 일이 짧아도 실패다", () => {
    const fails = judgeSwitch(pageOf([250]), V);
    expect(fails.join(" ")).toMatch(/가장 긴 간격 250ms/);
  });

  it("그림 네 개 길이(66.7ms) 간격은 실패다", () => {
    expect(judgeSwitch(pageOf([66.7]), V).join(" ")).toMatch(/가장 긴 간격/);
  });

  it("긴 간격이 없어도 창 안 그림이 기대의 90% 밑이면 실패다", () => {
    const fails = judgeSwitch(pageOf([33.4, 33.4, 33.4, 33.4, 33.4, 33.4]), V);
    expect(fails.join(" ")).toMatch(/그림 49개/);
  });

  it("주 스레드 일이 50ms를 넘으면 실패다", () => {
    expect(judgeSwitch(pageOf([], { longTask: 80 }), V).join(" ")).toMatch(/가장 긴 일 80ms/);
    expect(judgeSwitch(pageOf(), V, { traceLongest: 60 }).join(" ")).toMatch(/가장 긴 일 60ms/);
  });

  it("떨군 그림은 간격 ÷ vsync − 1로 센다. 간격 목록이 없는 옛 결과는 기대 그림 수에서 뺀다", () => {
    expect(droppedFrames(pageOf([33.4, 50, 250]), V)).toBe(1 + 2 + 14);
    expect(droppedFrames({ frames: 50, worstGap: 51 }, V)).toBe(5);
  });

  it("옛 결과도 판정한다: 리허설 넣기 전 첫 바뀜(233ms, 그림 17개)과 마지막 통과 실행의 66.7ms", () => {
    expect(judgeSwitch({ frames: 17, worstGap: 233.1, longTask: 0 }, V, { traceLongest: 13 })).toHaveLength(2);
    expect(judgeSwitch({ frames: 52, worstGap: 66.7, longTask: 0 }, V)).toHaveLength(1);
    expect(judgeSwitch({ frames: 54, worstGap: 33.4, longTask: 0 }, V)).toEqual([]);
  });
});

describe("실행 하나 판정", () => {
  const run = (pages: ReturnType<typeof pageOf>[]) => ({ vsync: V, win: WIN, switches: pages.map((page, i) => ({ n: i + 1, page, trace: null })) });

  it("바뀔 때마다 0.25초씩 멈추면 합한 몫이 낮아도 실패다", () => {
    const r = judgeRun(run(Array.from({ length: 15 }, () => pageOf([250]))));
    expect(r.ok).toBe(false);
    expect(r.switches.every((s) => s.fails.length > 0)).toBe(true);
  });

  it("15번 중 한 번만 멈춰도 실패다", () => {
    const pages = Array.from({ length: 15 }, (_, i) => pageOf(i === 0 ? [233.1] : [33.4]));
    const r = judgeRun(run(pages));
    expect(r.ok).toBe(false);
    expect(r.switches.filter((s) => s.fails.length > 0).map((s) => s.n)).toEqual([1]);
  });

  it("바뀜마다 한 그림씩 늦는 실행은 통과하고, 떨군 그림 몫은 기대 그림 수로 나눈다", () => {
    const r = judgeRun(run(Array.from({ length: 15 }, () => pageOf([33.4]))));
    expect(r.ok).toBe(true);
    expect(r.dropped).toBe(15);
    expect(r.expected).toBe(15 * 55);
  });

  it("창 길이를 적지 않은 옛 결과(창 0.6초)는 그 창으로 판정한다", () => {
    const old = { vsync: V, switches: [{ n: 1, page: { frames: 36, worstGap: 33.4, longTask: 0 }, trace: null }] };
    expect(judgeRun(old).ok).toBe(true);
    expect(judgeRun(old).expected).toBe(37);
  });

  it("바뀜을 하나도 못 쟀으면 실패다", () => {
    expect(judgeRun(run([])).ok).toBe(false);
  });
});
