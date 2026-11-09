// 단계 바뀜 판정(measure-switch.mjs가 쓴다). 크롬 없이 시험할 수 있게 따로 둔다.
// 바뀌기 0.1초 앞부터 0.8초 뒤까지 바뀜마다 따로 본다: 한 간격이라도 그림 세 개 길이(60Hz에서 50ms)를 넘거나, 창 안 그림이 기대의 90% 밑이거나,
// 주 스레드 일 하나가 50ms를 넘으면 그 바뀜은 실패다. 모든 바뀜을 합한 떨군 그림 몫도 5% 이하여야 한다.

/**
 * 바뀜 하나를 보는 창(바뀐 때 기준 ms). 바뀌기 앞 React 그리기, 지도 카메라 380ms 움직임, 다 옮긴 뒤 말풍선·이름표가 떠오르는 때까지.
 */
export const WIN = { before: 100, after: 800 };
/** 창 길이를 적지 않은 옛 결과의 창. */
const OLD_WIN = { before: 100, after: 500 };

export const LIMITS = {
  /** 한 간격의 상한(그림 몇 개 길이). 3이면 그림 둘까지 떨궈도 된다. */
  maxGapFrames: 3,
  /** 창 안 그림 수의 하한(기대 그림 수에 대한 몫). */
  minFrameShare: 0.9,
  /** 모든 바뀜을 합한 떨군 그림 몫의 상한. */
  maxDropShare: 0.05,
  /** 주 스레드 일 하나의 상한(ms). */
  maxTask: 50,
};

/** 단계가 바뀌는 때(처음 그린 때 기준 ms): 단계 길이마다, 잴 시간(초) 안에서. */
export function stepEdges(seconds, stepMs) {
  const edges = [];
  for (let t = stepMs; t < seconds * 1000; t += stepMs) edges.push(t);
  return edges;
}

/** 그림 간격이 그림 몇 개 길이인지(반올림). 33ms는 2, 50ms는 3, 233ms는 14. */
export const gapFrames = (gap, vsync) => Math.max(1, Math.round(gap / vsync));

/** 바뀐 때 t 둘레 창과 겹치는 그림 간격들. 창 끝에 걸친 간격은 얼마나 길든 넣는다. raf는 그림 시각(오름차순). */
export function gapsAround(raf, t, win = WIN) {
  const a = t - win.before;
  const b = t + win.after;
  const gaps = [];
  for (let i = 1; i < raf.length; i++) {
    if (raf[i] < a) continue;
    if (raf[i - 1] > b) break;
    gaps.push(raf[i] - raf[i - 1]);
  }
  return gaps;
}

/** 창 안에서 세는 그림 수(창과 겹치는 간격 수)의 기대치: 모든 간격이 vsync면 창 길이 ÷ vsync + 1. */
export const expectedFrames = (vsync, win = WIN) => Math.round((win.before + win.after) / vsync) + 1;

/** 바뀜 하나의 떨군 그림 수: 간격마다 (간격 ÷ vsync − 1). 간격 목록이 없는 옛 결과는 기대 그림 수 − 센 그림 수. */
export function droppedFrames(page, vsync, win = WIN) {
  if (Array.isArray(page.gaps)) return page.gaps.reduce((s, g) => s + gapFrames(g, vsync) - 1, 0);
  return Math.max(0, expectedFrames(vsync, win) - page.frames);
}

/** 바뀜 하나 판정. 실패 까닭 목록을 돌려준다(비면 통과). traceLongest는 trace로 잰 주 스레드 가장 긴 일(ms). */
export function judgeSwitch(page, vsync, { traceLongest = 0, limits = LIMITS, win = WIN } = {}) {
  const fails = [];
  const worst = gapFrames(page.worstGap, vsync);
  if (worst > limits.maxGapFrames) {
    fails.push(`가장 긴 간격 ${page.worstGap}ms = 그림 ${worst}개 길이 > ${limits.maxGapFrames}개`);
  }
  const expected = expectedFrames(vsync, win);
  if (page.frames < expected * limits.minFrameShare) {
    fails.push(`그림 ${page.frames}개 < 기대 ${expected}개의 ${Math.round(limits.minFrameShare * 100)}%`);
  }
  const task = Math.max(page.longTask ?? 0, traceLongest);
  if (task > limits.maxTask) fails.push(`가장 긴 일 ${Math.round(task)}ms > ${limits.maxTask}ms`);
  return fails;
}

/** 실행 하나 판정: 바뀜마다 판정하고, 떨군 그림을 모두 합한 몫도 본다. 결과에 적힌 창(win)으로 잰다. */
export function judgeRun(result, limits = LIMITS) {
  const { vsync } = result;
  const win = result.win ?? OLD_WIN;
  let dropped = 0;
  let expected = 0;
  let worstTask = 0;
  const switches = result.switches.map((s) => {
    const traceLongest = s.trace?.longest ?? 0;
    const d = droppedFrames(s.page, vsync, win);
    dropped += d;
    expected += expectedFrames(vsync, win);
    worstTask = Math.max(worstTask, s.page.longTask ?? 0, traceLongest);
    return { n: s.n, dropped: d, fails: judgeSwitch(s.page, vsync, { traceLongest, limits, win }) };
  });
  const fails = [];
  if (switches.length === 0) fails.push("바뀜을 하나도 못 쟀어요");
  for (const s of switches) if (s.fails.length) fails.push(`#${s.n} ${s.fails.join(", ")}`);
  const share = expected ? dropped / expected : 0;
  if (share > limits.maxDropShare) fails.push(`떨군 그림 ${(share * 100).toFixed(1)}% > ${(limits.maxDropShare * 100).toFixed(1)}%`);
  return { ok: fails.length === 0, fails, switches, dropped, expected, worstTask };
}
