// 「FSM 바뀜」 칸: 밤 반성 동안 Agent Trace 자리에 사람 상태 FSM 그림을 그린다. 그리기는 RelationGraph.tsx와 같다(선 LineDrawSvg, 이름·칩 Status).
// 실선은 지금 FSM 화살표, 점선은 후보(채택되지 않으면 회색). 어느 상태로든(*) 화살표는 「자리에 없음」 원으로 간다.
// 자리는 fsm-graph.ts, 단계마다 무엇을 그릴지는 reflection.ts가 정한다.
import { useLayoutEffect, useRef, useState } from "react";
import { LineDrawSvg, type LineTone } from "../components/ui/line-draw-svg";
import { Status, StatusIndicator, StatusLabel } from "../components/ui/status";
import { ANY, AWAY, bendOf, circlePath, endOf, lanesOf, spotsOf } from "./fsm-graph";
import type { FsmPaneState, PaneTone } from "./reflection";
import { RW } from "./reflection-words";

const LINE: Record<PaneTone, LineTone> = { current: "routeAheadEdge", candidate: "routeCore", adopted: "routeCore", rejected: "routePassedCore" };
const CHIP: Record<PaneTone, "default" | "brand" | "success"> = { current: "default", candidate: "brand", adopted: "success", rejected: "default" };
const nameOf = (id: string) => RW.stateName[id] ?? RW.newState;

export function FsmPane({ pane }: { pane: FsmPaneState }) {
  const box = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 842, height: 988 });
  useLayoutEffect(() => {
    const el = box.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const resize = new ResizeObserver(([entry]) => {
      if (entry && entry.contentRect.width > 0 && entry.contentRect.height > 0) setSize({ width: entry.contentRect.width, height: entry.contentRect.height });
    });
    resize.observe(el);
    return () => resize.disconnect();
  }, []);
  // 어느 상태로든 화살표가 있으면 자리에 없음 원이 늘 있다
  const states = pane.edges.some((e) => e.to === ANY) && !pane.states.includes(AWAY) ? [...pane.states, AWAY] : pane.states;
  const spots = spotsOf(states, size);
  const at = new Map(spots.map((s) => [s.id, s]));
  const ends = pane.edges.map((e) => ({ from: e.from, to: endOf(e.to) }));
  const lanes = lanesOf(ends);
  const center: [number, number] = [size.width / 2, size.height / 2];
  const lines = pane.edges.flatMap((e, i) => {
    const a = at.get(e.from), b = at.get(ends[i]!.to);
    return a && b ? [{ e, to: b.id, bend: bendOf(e.key, a, b, lanes[i]!, center) }] : [];
  });
  const svg = { width: size.width, height: size.height, className: "absolute inset-0 h-full w-full" };
  return (
    <div className="relative flex h-full w-full flex-col">
      <div className="p-3"><Status variant="brand"><StatusIndicator live={pane.step === RW.step.start} /><StatusLabel>{pane.step}</StatusLabel></Status></div>
      <div ref={box} role="img" aria-label={states.map(nameOf).join(", ")} className="relative min-h-0 flex-1 overflow-hidden">
        {spots.map((s) => <div key={`o:${s.id}`} data-state={s.id} className="pointer-events-none absolute inset-0"><LineDrawSvg {...svg} path={circlePath(s)} tone="routeAheadEdge" strokeWidth={1.5} /></div>)}
        {lines.map(({ e, to, bend }) => (
          <div key={e.key} data-edge={e.key} data-to={to} data-line={e.line} data-tone={e.tone} className="pointer-events-none absolute inset-0">
            <LineDrawSvg {...svg} path={bend.path} tone={LINE[e.tone]} dashed={e.line === "dashed"} strokeWidth={e.tone === "current" ? 1.5 : 2.5} />
          </div>
        ))}
        {spots.map((s) => <div key={`n:${s.id}`} className="absolute -translate-x-1/2 -translate-y-1/2" style={{ left: s.x, top: s.y }}><Status>{nameOf(s.id)}</Status></div>)}
        {lines.filter(({ e }) => e.chips.length).map(({ e, bend }) => (
          <div key={`c:${e.key}`} data-chips={e.key} className="absolute flex -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-1" style={{ left: bend.label[0], top: bend.label[1] }}>
            {e.chips.map((c) => <Status key={c} variant={CHIP[e.tone]}>{c}</Status>)}
          </div>
        ))}
      </div>
    </div>
  );
}
