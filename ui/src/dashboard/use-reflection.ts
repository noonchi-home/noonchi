// 밤 반성 보기: 하루 마치기가 시작되면(day.closing 참) 0단계(지금 FSM 그림)로 들어가고, 끝나면(closing 거짓) 그날 반성 자료(GET /api/reflection/<날>)를 받아
// 단계 순간을 차례로 재생한 뒤 끝 순간 뒤 라이브 보기로 돌아간다. 자료를 받지 못하면(오류 응답 포함) 실패 순간 하나다.
// ?view=reflection&day=YYYY-MM-DD면 그 날을 받아 재생하고 끝 순간에 머문다(화면 찍기).
// 단계 순간은 받은 자료와 트윈 자리(place)로 그때그때 만든다: 자료가 트윈보다 먼저 와도 트윈이 뜨면 맞출 곳·표시가 생긴다.
import { useEffect, useMemo, useRef, useState } from "react";
import type { DayView, FsmGraphData, ReflectionDetail } from "../../../src/contract/reflection.ts";
import { api } from "../lib/api";
import { failedMoment, reflectionMoments, startMoment, type ReflectionMoment, type ReflectionPlace } from "./reflection";

/** base: 자료 전 순간(0단계·실패). detail이 있으면 그것으로 순간을 만든다. */
interface ViewState { day: string; dayAtStart: DayView | null; base: ReflectionMoment[]; detail: ReflectionDetail | null; index: number; stay: boolean; fetch: boolean }
const NO_PLACE: ReflectionPlace = { shapes: [], table: null, sink: null };

export function useReflectionView(o: { day: DayView | null; replay: string | null; place: ReflectionPlace | null; graph: FsmGraphData | null }): {
  moment: ReflectionMoment | null; moments: ReflectionMoment[]; active: boolean; dayAtStart: DayView | null;
} {
  const [s, setS] = useState<ViewState | null>(null);
  const graph = useRef(o.graph);
  graph.current = o.graph;
  const dayNow = useRef(o.day);
  dayNow.current = o.day;
  const wasClosing = useRef(false);

  useEffect(() => {
    if (o.replay) setS({ day: o.replay, dayAtStart: null, base: [], detail: null, index: 0, stay: true, fetch: true });
  }, [o.replay]);

  const closing = !!o.day?.closing;
  useEffect(() => {
    const d = dayNow.current;
    if (closing && !wasClosing.current && d) {
      setS({ day: d.today, dayAtStart: d, base: [startMoment(graph.current)], detail: null, index: 0, stay: false, fetch: false });
      // 그날 판단이 없으면 대시보드가 받은 FSM 그림(habit)이 없다: 서버의 그날 FSM 그림을 0단계에 쓴다
      if (!graph.current) {
        const day = d.today;
        api<ReflectionDetail>(`/api/reflection/${day}`).then((r) => {
          if (!r.ok || !r.json) return;
          const start = startMoment(r.json.graph);
          setS((x) => (x && x.day === day && !x.fetch && !x.detail && x.base[0]?.step === 0 ? { ...x, base: [start] } : x));
        }, () => {});
      }
    }
    if (!closing && wasClosing.current) setS((x) => x && { ...x, fetch: true });
    wasClosing.current = closing;
  }, [closing]);

  const fetching = s?.fetch ? s.day : null;
  useEffect(() => {
    if (!fetching) return;
    let live = true;
    const fail = () => ({ base: [failedMoment(graph.current, false)], detail: null });
    api<ReflectionDetail>(`/api/reflection/${fetching}`)
      .then((r) => (r.ok && r.json ? { base: [], detail: r.json } : fail()), fail)
      .then((got) => { if (live) setS((x) => (x && x.day === fetching ? { ...x, ...got, fetch: false, index: 0 } : x)); });
    return () => { live = false; };
  }, [fetching]);

  const moments = useMemo(() => (!s ? [] : s.detail ? reflectionMoments(s.detail, o.place ?? NO_PLACE) : s.base), [s, o.place]);
  useEffect(() => {
    if (!s || s.fetch) return;
    const m = moments[s.index];
    if (!m || !Number.isFinite(m.holdMs)) return;
    const count = moments.length;
    const t = setTimeout(() => setS((x) => {
      if (!x) return x;
      if (x.index + 1 < count) return { ...x, index: x.index + 1 };
      return x.stay ? x : null;
    }), m.holdMs);
    return () => clearTimeout(t);
  }, [s, moments]);

  return { moment: s ? moments[s.index] ?? null : null, moments, active: s !== null, dayAtStart: s?.dayAtStart ?? null };
}
