// 반성 보기(use-reflection.ts): closing이면 0단계(지금 FSM 그림), 끝나면 반성 자료를 받아 차례로 재생하고 끝 순간 뒤 라이브 보기로 돌아간다.
// 자료를 받지 못하면(오류 응답) 지금 FSM 그림에 실패 순간 하나, 대시보드가 받은 FSM 그림이 없으면 서버의 그날 그림을 0단계에 쓴다.
import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HOLD } from "../../src/dashboard/reflection";
import { useReflectionView } from "../../src/dashboard/use-reflection";

const day = (closing: boolean, shift: number) => ({ today: shift ? "2026-11-28" : "2026-11-27", real_today: "2026-11-27", shift, finish: true, closing });
const GRAPH = { states: ["drinking"], edges: [{ from: "drinking", to: "*", action: "사용자에게 물어보기" }] };
const DETAIL = { ok: true, day: "2026-11-27", state: "failed", rejected: false, at_ms: 1, before: null, after: null, graph: GRAPH, after_graph: null, chunks: [], did: [], candidates: [], dropped: [], checks: [], learned: [], skipped_to: null, window_s: 300, rate_min: 0.75, alpha: 0.001 };
const place = { shapes: [], table: null, sink: null };
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

type P = { d: ReturnType<typeof day>; graph?: typeof GRAPH | null };
const view = (o: { fetch: (url: string, n: number) => Response; graph?: typeof GRAPH | null }) => {
  const fetched: string[] = [];
  vi.stubGlobal("fetch", async (url: string) => { fetched.push(url); return o.fetch(url, fetched.length); });
  const hook = renderHook((p: P) => useReflectionView({ day: p.d, replay: null, place, graph: p.graph === undefined ? GRAPH : p.graph }), { initialProps: { d: day(false, 0), graph: o.graph } as P });
  return { ...hook, fetched };
};

describe("반성 보기", () => {
  it("closing → 0단계, 끝 → 자료 받아 재생 → 끝 순간 뒤 나옴. 재생 중에도 누른 날을 든다", async () => {
    vi.useFakeTimers();
    const { result, rerender, fetched } = view({ fetch: () => new Response(JSON.stringify(DETAIL)) });
    expect(result.current.active).toBe(false);
    rerender({ d: day(true, 0) });
    expect(result.current).toMatchObject({ active: true, moment: { step: 0, pane: { states: ["drinking"] } }, dayAtStart: { shift: 0, closing: true } });
    rerender({ d: day(false, 1) });
    await act(async () => { await vi.advanceTimersByTimeAsync(10); });
    expect(fetched).toEqual(["/api/reflection/2026-11-27", "/api/reflection/2026-11-27"]);
    expect(result.current).toMatchObject({ moment: { step: 7 }, dayAtStart: { today: "2026-11-27" } });
    await act(async () => { await vi.advanceTimersByTimeAsync(HOLD.failed + 10); });
    expect(result.current).toMatchObject({ active: false, dayAtStart: null });
  });

  it("순간이 여럿인 자료는 머무는 시간마다 다음 순간으로 넘어가 끝 순간 뒤 나온다", async () => {
    vi.useFakeTimers();
    const done = { ...DETAIL, state: "done", after: { version: 2, applies_day: "2026-11-28" },
      chunks: [{ start: "08:10:00", end: "08:20:00", state: "drinking", room: "kitchen" }, { start: "09:00:00", end: "09:10:00", state: null, room: "living" }] };
    const { result, rerender } = view({ fetch: () => new Response(JSON.stringify(done)) });
    rerender({ d: day(true, 0) });
    rerender({ d: day(false, 1) });
    await act(async () => { await vi.advanceTimersByTimeAsync(10); });
    const seen: number[] = [];
    for (let i = 0; i < 10 && result.current.active; i++) {
      seen.push(result.current.moment!.step);
      await act(async () => { await vi.advanceTimersByTimeAsync(result.current.moment!.holdMs + 10); });
    }
    expect(seen).toEqual([1, 1, 2, 3, 7]);
    expect(result.current.active).toBe(false);
  });

  it("자료 대신 오류 응답(500)이 오면 지금 FSM 그림에 「반성 실패」 순간이다", async () => {
    vi.useFakeTimers();
    const { result, rerender } = view({ fetch: () => new Response(JSON.stringify({ ok: false, error: "서버 오류" }), { status: 500 }) });
    rerender({ d: day(true, 0) });
    rerender({ d: day(false, 0) });
    await act(async () => { await vi.advanceTimersByTimeAsync(10); });
    expect(result.current.moment).toMatchObject({ step: 7, pane: { step: "반성 실패", states: ["drinking"] } });
  });

  it("대시보드가 받은 FSM 그림이 전날 판본이어도 0단계는 서버의 그날 FSM 그림이고, 자료를 못 받으면 실패 칸도 그 그림이다", async () => {
    vi.useFakeTimers();
    const today = { ...DETAIL, state: "none", graph: { states: ["cooking", "away"], edges: [{ from: "away", to: "cooking", action: null }] } };
    const { result, rerender } = view({ fetch: (_url, n) => (n === 1 ? new Response(JSON.stringify(today)) : new Response(JSON.stringify({ ok: false, error: "서버 오류" }), { status: 500 })) });
    rerender({ d: day(true, 0) });
    expect(result.current.moment).toMatchObject({ step: 0, pane: { states: ["drinking"] } });
    await act(async () => { await vi.advanceTimersByTimeAsync(10); });
    expect(result.current.moment).toMatchObject({ step: 0, pane: { states: ["cooking", "away"] } });
    rerender({ d: day(false, 1) });
    await act(async () => { await vi.advanceTimersByTimeAsync(10); });
    expect(result.current.moment).toMatchObject({ step: 7, pane: { step: "반성 실패", states: ["cooking", "away"] } });
  });

  it("대시보드가 받은 FSM 그림이 없으면 하루 마치기를 시작할 때 서버의 그날 FSM 그림을 0단계에 쓴다", async () => {
    vi.useFakeTimers();
    const none = { ...DETAIL, state: "none", graph: { states: ["cooking", "away"], edges: [{ from: "away", to: "cooking", action: null }] } };
    const { result, rerender, fetched } = view({ fetch: () => new Response(JSON.stringify(none)), graph: null });
    rerender({ d: day(true, 0), graph: null });
    await act(async () => { await vi.advanceTimersByTimeAsync(10); });
    expect(fetched).toEqual(["/api/reflection/2026-11-27"]);
    expect(result.current.moment).toMatchObject({ step: 0, pane: { states: ["cooking", "away"] } });
  });
});
