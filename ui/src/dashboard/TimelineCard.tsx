import { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  Timeline, TIMELINE_END_GAP, TimelineCurrentTime, TimelineHeader, TimelineProvider, TimelineRegion, TimelineRow, TimelineRowLabel, TimelineSlot, TimelineSlotLabel, timeToX, useTimeline,
} from "../components/ui/timeline";
import { useReducedMotionNow } from "./motion";
import type { TimelineData, TimelineRow as RowId } from "./timeline";
import { WORDS } from "./words";

/** 보이는 때(초): 지금에서 30초 앞이 왼쪽 끝이다. 실제 영상(2026-11-18 wide-glass n2)에서 목표를 세운 때 → 첫 명령이 15초라 첫 명령 때 그 이야기가 다 보인다. */
export const TIMELINE_SPAN_S = 30;
/** 굵은 눈금과 「N초 전」 간격(초). */
export const TIMELINE_TICK_S = 10;
const COLUMN_W = 64;
/** 지금을 옮기는 간격(ms): 초당 약 12px이라 0.2초에 2px쯤. 움직임 줄이기면 1초. */
const TICK_MS = 200;
const REDUCED_TICK_MS = 1000;
const ROWS: { id: RowId; label: string }[] = [
  { id: "person", label: WORDS.timeline.rows.person },
  { id: "guess", label: WORDS.timeline.rows.guess },
  { id: "robot", label: WORDS.timeline.rows.robot },
];

/** 지금(ms): fixed가 있으면 그것(가짜 단계 화면), 없으면 every ms마다 브라우저 시계(서버 시각과 같은 실제 시각, clock.ts). */
function useNow(fixed: number | undefined, every: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (fixed !== undefined) return;
    setNow(Date.now());
    const id = window.setInterval(() => setNow(Date.now()), every);
    return () => window.clearInterval(id);
  }, [fixed, every]);
  return fixed ?? now;
}

/** 예상 줄 글: 목표를 세운 때에 붙이고, 지금 선을 넘으면 지금 선에 끝을 맞춘다(글 너비를 잰다). */
function Caption({ at, text }: { at: number; text: string }) {
  const { start, pixelsPerSecond, timelineWidth } = useTimeline();
  const box = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(0);
  useLayoutEffect(() => { setW(box.current?.offsetWidth ?? 0); }, [text]);
  const x = Math.max(0, Math.min(timeToX(at, start, pixelsPerSecond), timelineWidth - w - 4));
  return (
    <div ref={box} data-timeline-caption className="absolute top-0.5 whitespace-nowrap" style={{ left: x }}>
      <TimelineSlotLabel tone="brand">{text}</TimelineSlotLabel>
    </div>
  );
}

/**
 * 시간 줄 카드(21st.dev Timeline): 사람 · 예상 · 로봇 세 줄과 오른쪽 끝 지금 선. 지금에서 TIMELINE_SPAN_S초 앞까지 보이고 지금이 흐르면 구간이 왼쪽으로 간다.
 * 사람 줄은 사람 상태, 예상 줄은 미리 세운 목표(세움 · 준비됨 테)와 그 글, 로봇 줄은 계획 단계(지금 단계 빨강)와 지켜봄이다(timeline.ts).
 * 사람이 떠난 때 → 첫 명령은 세 줄을 가로지르는 구간과 큰 「N.N초」다. 첫 판단 전(data null)이면 카드가 없다. 보기만 한다.
 * now가 있으면 그 때로 멈춘 채 그린다(가짜 단계 화면).
 */
export function TimelineCard({ data, box, className, style, now: fixed }: {
  data: TimelineData | null;
  box: { width: number; height: number };
  /** 놓는 자리 class(배치 class만). */
  className?: string;
  /** 화면 위 자리(left·top). */
  style?: { left?: number; top?: number };
  now?: number;
}) {
  const reduced = useReducedMotionNow();
  const now = useNow(fixed, reduced ? REDUCED_TICK_MS : TICK_MS);
  if (!data) return null;
  return (
    <div data-timeline-card className={className} style={{ ...style, width: box.width, height: box.height }}>
      <TimelineProvider
        config={{ spanSeconds: TIMELINE_SPAN_S, tickSeconds: TIMELINE_TICK_S, columnWidth: COLUMN_W }} now={now} fallbackWidth={Math.max(0, box.width - COLUMN_W - 2 - TIMELINE_END_GAP)} className="h-full"
      >
        <Timeline>
          <TimelineHeader tickLabel={WORDS.timeline.ago} />
          {ROWS.map((r) => (
            <TimelineRow key={r.id} row={{ id: r.id, label: r.label }} renderRowHeader={(x) => <TimelineRowLabel>{x.label}</TimelineRowLabel>}>
              {data.spans.filter((x) => x.row === r.id).map((x) => (
                <TimelineSlot key={x.id} slot={{ id: x.id, rowId: r.id, from: x.from, to: x.to }} tone={x.tone} className={r.id === "guess" ? "top-5" : undefined}>
                  {x.text && <div className="px-2 py-1"><TimelineSlotLabel>{x.text}</TimelineSlotLabel></div>}
                </TimelineSlot>
              ))}
              {r.id === "guess" && data.caption && <Caption at={data.caption.at} text={data.caption.text} />}
            </TimelineRow>
          ))}
          {data.gap && <TimelineRegion from={data.gap.from} to={data.gap.to} label={data.gap.text} size="gap" />}
          <TimelineCurrentTime nowLabel={WORDS.timeline.now} />
        </Timeline>
      </TimelineProvider>
    </div>
  );
}
