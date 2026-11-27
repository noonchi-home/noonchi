// 밤 반성 보기: 하루 마치기가 시작되면(day.closing 참) 0단계(지금 FSM 그림)로 들어가고, 끝나면(closing 거짓) 그날 반성 자료(GET /api/reflection/<날>)를 받아
// 단계 순간을 차례로 재생한 뒤 끝 순간 뒤 라이브 보기로 돌아간다. 자료를 받지 못하면(오류 응답 포함) 실패 순간 하나다.
// ?view=reflection&day=YYYY-MM-DD면 그 날을 받아 재생하고 끝 순간에 머문다(화면 찍기).
import { useEffect, useRef, useState } from "react";
import type { DayView, FsmGraphData, ReflectionDetail } from "../../../src/contract/reflection.ts";
import { api } from "../lib/api";
import { failedMoment, reflectionMoments, startMoment, type ReflectionMoment, type ReflectionPlace } from "./reflection";

interface ViewState { day: string; dayAtStart: DayView | null; moments: ReflectionMoment[]; index: number; stay: boolean; fetch: boolean }
const NO_PLACE: ReflectionPlace = { shapes: [], table: null, sink: null };

export function useReflectionView(o: { day: DayView | null; replay: string | null; place: ReflectionPlace | null; graph: FsmGraphData | null }): {
  moment: ReflectionMoment | null; moments: ReflectionMoment[]; active: boolean; dayAtStart: DayView | null;
} {
  const [s, setS] = useState<ViewState | null>(null);
  const graph = useRef(o.graph);
  graph.current = o.graph;
  const place = useRef(o.place);
  place.current = o.place;
  const dayNow = useRef(o.day);
  dayNow.current = o.day;
  const wasClosing = useRef(false);

  useEffect(() => {
    if (o.replay) setS({ day: o.replay, dayAtStart: null, moments: [], index: 0, stay: true, fetch: true });
  }, [o.replay]);

  const closing = !!o.day?.closing;
  useEffect(() => {
    const d = dayNow.current;
    if (closing && !wasClosing.current && d) {
      setS({ day: d.today, dayAtStart: d, moments: [startMoment(graph.current)], index: 0, stay: false, fetch: false });
      // 그날 판단이 없으면 대시보드가 받은 FSM 그림(habit)이 없다: 서버의 그날 FSM 그림을 0단계에 쓴다
      if (!graph.current) {
        const day = d.today;
        api<ReflectionDetail>(`/api/reflection/${day}`).then((r) => {
          if (!r.ok || !r.json) return;
          const start = startMoment(r.json.graph);
          setS((x) => (x && x.day === day && !x.fetch && x.moments.length === 1 && x.moments[0]!.step === 0 ? { ...x, moments: [start] } : x));
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
    const fail = () => [failedMoment(graph.current, false)];
    api<ReflectionDetail>(`/api/reflection/${fetching}`)
      .then((r) => (r.ok && r.json ? reflectionMoments(r.json, place.current ?? NO_PLACE) : fail()), fail)
      .then((moments) => { if (live) setS((x) => (x && x.day === fetching ? { ...x, fetch: false, moments, index: 0 } : x)); });
    return () => { live = false; };
  }, [fetching]);

  useEffect(() => {
    if (!s || s.fetch) return;
    const m = s.moments[s.index];
    if (!m || !Number.isFinite(m.holdMs)) return;
    const t = setTimeout(() => setS((x) => {
      if (!x) return x;
      if (x.index + 1 < x.moments.length) return { ...x, index: x.index + 1 };
      return x.stay ? x : null;
    }), m.holdMs);
    return () => clearTimeout(t);
  }, [s]);

  return { moment: s?.moments[s.index] ?? null, moments: s?.moments ?? [], active: s !== null, dayAtStart: s?.dayAtStart ?? null };
}
