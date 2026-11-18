"use client";

// 21st.dev「Timeline」(id 28289, abui/timeline) 받은 코드.
// 바꾼 것: 안 쓰는 기능을 뺐다: 끌어 옮기기(@dnd-kit DndContext·센서·useDraggable·useDroppable·DragOverlay, tunnel-rat 끌기 그림, 떨굴 자리 그림자 TimelineDropGhost, 떨굴 검사·칸 맞춤 snap,
// onSlotPositionChange·onValidateDrop), 마우스 시각 표시(TimelineMouseIndicator), 칸 누르기(onSlotClick), 확대(percentageInView), 가로 스크롤(overflow-auto → overflow-hidden),
// 칸 최소 너비 60px(짧은 단계가 다음 단계를 덮는다), 칸의 transition-all·cursor·hover 링·끌기 상태, TimelineGrid·TimelineSlotContent, console.log, Slot(asChild).
// 데이터 연결: 시각 단위 시:분(startHour·endHour·"14:30", 분당 px) → ms 시각(초당 px). 보이는 때는 지금(now)에서 spanSeconds 앞까지이고 지금이 오른쪽 끝이다.
// 눈금은 초다: tickSeconds마다 굵은 선과 머리 글(tickLabel, 「N초 전」), 그 1/4마다 옅은 선(받은 코드의 시·15분 선). 칸(slot)은 from·to ms(to가 없으면 지금까지).
// 지금 선(TimelineCurrentTime)은 1분마다 도는 자기 시계 대신 받은 now를 쓰고, 오른쪽 끝이라 이름표를 선 왼쪽(right-0)에 붙인다. 선이 오른쪽 테두리에 묻히지 않게 줄 칸 끝에서 TIMELINE_END_GAP px 띄운다. 이름표 글은 받은 글(nowLabel) 하나다(「Now: 14:30」의 시각은 뺐다).
// 떨굴 구간(TimelineDropRegion)은 구간 표시(TimelineRegion: 두 끝 선·옅은 바탕·이름표)로 쓴다: 이름표는 구간 위 끝 대신 머리 줄 아래 두 줄의 가운데(top-[calc(50%+12px)])에 얹고,
// 카드 끝에 걸리면 그 끝에 맞추며, 끝 선 위에 그린다(맨 뒤 차례).
// 메시지 상자와 같은 높이(128)에 눈금 줄과 두 줄이 들게 여백만 줄였다(글 크기는 그대로): 머리 줄 h-12 → h-6, 구간 이름표 px-3 py-1.5 → px-2 py-0.5.
// 줄 머리 글 자리 열 너비 기본 112 → 64. 머리 줄 열 이름(columnLabel) 기본 "Row" → 없음. 줄 이름(TimelineRowLabel)은 받은 예시 코드(demoCode)의 renderRowHeader 글(px-4 py-1, font-medium text-sm)이다.
// 토큰 색: accent → brand, accent-foreground → on-brand, 지금 선·이름표 바탕 secondary → foreground(이름표 글 foreground → background), 판·머리 바탕 background → card(트윈 위에 얹는 카드), border·muted-foreground 그대로.
// 칸 색은 tone(plain 카드 바탕·테, muted 옅은 바탕, brand 빨강)이다.
// 모서리·그림자: 판(timeline-grid)에 rounded-lg·shadow-sm(대시보드 카드 틀 Card와 같은 토큰)을 단다.
// 구간 이름표 size gap(굵게 font-bold, 글 크기는 받은 text-sm 그대로)을 더했다(2026-11-19 사용자 「글자가 너무 크더라 초나오는거」로 22px을 뺐다).
// 원래 글 크기: text-sm(14px). 받은 코드의 머리 열 이름·떨굴 구간 이름표가 text-sm, 시 글·칸 글·지금 이름표가 text-xs다. 더 큰 글은 npm run lint(scripts/lint-ui-type.ts)가 막는다.
import * as React from "react";
import { createContext, useContext, useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

/* ============================================================================
 * TYPES & INTERFACES
 * ========================================================================== */

export interface TimelineSlotData {
  id: string;
  rowId: string;
  /** 시작 ms(보이는 때보다 앞이면 왼쪽 끝부터). */
  from: number;
  /** 끝 ms. null이면 지금까지. */
  to: number | null;
}

export interface TimelineRowData {
  id: string;
  label: string;
}

export interface TimelineConfig {
  /** 보이는 때 길이(초): 지금에서 이만큼 앞이 왼쪽 끝이다. */
  spanSeconds: number;
  /** 굵은 눈금 간격(초). 옅은 눈금은 그 1/4. */
  tickSeconds?: number;
  columnWidth?: number;
}

/* ============================================================================
 * CONTEXT
 * ========================================================================== */

type TimelineContextValue = {
  config: TimelineConfig;
  /** 지금(ms): 오른쪽 끝. */
  now: number;
  /** 왼쪽 끝 시각(ms). */
  start: number;
  pixelsPerSecond: number;
  timelineWidth: number;
  timelineRef: React.RefObject<HTMLDivElement | null>;
};

const TimelineContext = createContext<TimelineContextValue | null>(null);

function useTimeline() {
  const context = useContext(TimelineContext);
  if (!context) {
    throw new Error("Timeline components must be used within TimelineProvider");
  }
  return context;
}

/* ============================================================================
 * UTILITIES
 * ========================================================================== */

/** 지금 선을 줄 칸 오른쪽 끝에서 띄우는 만큼(px). */
export const TIMELINE_END_GAP = 6;

/** ms 시각 → 줄 칸 안 x(px, 왼쪽 끝 0). */
export const timeToX = (t: number, start: number, pixelsPerSecond: number): number => ((t - start) / 1000) * pixelsPerSecond;

/* ============================================================================
 * TIMELINE PROVIDER
 * ========================================================================== */

interface TimelineProviderProps {
  children: React.ReactNode;
  config: TimelineConfig;
  now: number;
  /** 잴 수 없을 때(그리기 전·시험) 쓰는 줄 칸 너비(px, 열 너비 뺀 것). */
  fallbackWidth?: number;
  style?: React.CSSProperties;
  className?: string;
}

export function TimelineProvider({
  children,
  config,
  now,
  fallbackWidth = 0,
  style,
  className,
}: TimelineProviderProps) {
  const [viewportWidth, setViewportWidth] = useState(0);

  const timelineRef = useRef<HTMLDivElement>(null);

  const columnWidth = config.columnWidth || 64;

  // Measure viewport
  useEffect(() => {
    const measure = () => {
      if (timelineRef.current) {
        setViewportWidth(timelineRef.current.clientWidth - columnWidth - TIMELINE_END_GAP);
      }
    };

    measure();
    window.addEventListener("resize", measure);
    const timeout = setTimeout(measure, 100);

    return () => {
      window.removeEventListener("resize", measure);
      clearTimeout(timeout);
    };
  }, [columnWidth]);

  // Calculate timeline dimensions
  const width = viewportWidth > 0 ? viewportWidth : fallbackWidth;
  const pixelsPerSecond = width > 0 ? width / config.spanSeconds : 10;
  const timelineWidth = config.spanSeconds * pixelsPerSecond;

  const contextValue: TimelineContextValue = {
    config,
    now,
    start: now - config.spanSeconds * 1000,
    pixelsPerSecond,
    timelineWidth,
    timelineRef,
  };

  return (
    <TimelineContext.Provider value={contextValue}>
      <div
        data-slot="timeline-wrapper"
        style={
          {
            "--timeline-column-width": `${columnWidth}px`,
            "--timeline-width": `${timelineWidth}px`,
            "--timeline-pixels-per-second": pixelsPerSecond,
            ...style,
          } as React.CSSProperties
        }
        className={cn("relative w-full", className)}
      >
        {children}
      </div>
    </TimelineContext.Provider>
  );
}

/* ============================================================================
 * TIMELINE (Main Container)
 * ========================================================================== */

interface TimelineProps {
  children: React.ReactNode;
  className?: string;
}

export function Timeline({ children, className }: TimelineProps) {
  const { timelineRef } = useTimeline();

  return (
    <div className="relative h-full w-full">
      <div
        ref={timelineRef}
        data-slot="timeline-grid"
        className={cn(
          "relative h-full overflow-hidden rounded-lg border bg-card text-card-foreground shadow-sm",
          className,
        )}
      >
        {children}
      </div>
    </div>
  );
}

/* ============================================================================
 * TIMELINE HEADER
 * ========================================================================== */

interface TimelineHeaderProps {
  className?: string;
  columnLabel?: React.ReactNode;
  /** 지금에서 몇 초 앞인 눈금 → 머리 글. */
  tickLabel: (secondsAgo: number) => React.ReactNode;
}

export function TimelineHeader({
  className,
  columnLabel = null,
  tickLabel,
}: TimelineHeaderProps) {
  const { config, pixelsPerSecond } = useTimeline();
  const tick = config.tickSeconds || 10;

  // Generate tick markers (지금에서 tick초씩 앞으로)
  const tickMarkers = [];
  for (let ago = tick; ago < config.spanSeconds; ago += tick) {
    tickMarkers.push({
      ago,
      label: tickLabel(ago),
      position: (config.spanSeconds - ago) * pixelsPerSecond,
    });
  }

  return (
    <div
      data-slot="timeline-header"
      className={cn("sticky top-0 z-10 bg-card border-b", className)}
    >
      <div className="flex h-6">
        <div
          data-slot="timeline-header-column"
          className="sticky left-0 w-[var(--timeline-column-width)] bg-card border-r flex items-center px-4 font-semibold text-sm z-1"
        >
          {columnLabel}
        </div>
        <div data-slot="timeline-header-markers" className="relative flex-1">
          {tickMarkers.map((marker) => (
            <div
              key={marker.ago}
              data-slot="timeline-hour-marker"
              className="absolute top-0 bottom-0 flex items-center pl-2 text-xs text-muted-foreground"
              style={{ left: `${marker.position}px` }}
            >
              {marker.label}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ============================================================================
 * TIMELINE ROW
 * ========================================================================== */

interface TimelineRowProps {
  row: TimelineRowData;
  children?: React.ReactNode;
  renderRowHeader?: (row: TimelineRowData) => React.ReactNode;
  className?: string;
}

export function TimelineRow({
  row,
  children,
  renderRowHeader,
  className,
}: TimelineRowProps) {
  const { config, pixelsPerSecond, timelineWidth } = useTimeline();
  const tick = config.tickSeconds || 10;

  // Generate grid markers (지금에서 tick초씩, 그 1/4마다 옅은 선)
  const tickMarkers = [];
  for (let ago = 0; ago <= config.spanSeconds; ago += tick) {
    tickMarkers.push({
      ago,
      position: (config.spanSeconds - ago) * pixelsPerSecond,
    });
  }

  const quarterMarkers = [];
  for (let ago = tick / 4; ago < config.spanSeconds; ago += tick / 4) {
    if (ago % tick !== 0) {
      quarterMarkers.push({
        position: (config.spanSeconds - ago) * pixelsPerSecond,
      });
    }
  }

  return (
    <div
      data-slot="timeline-row"
      data-row={row.id}
      className={cn("flex border-b h-12", className)}
    >
      {/* Row label column */}
      <div
        data-slot="timeline-row-label"
        className="sticky left-0 w-[var(--timeline-column-width)] bg-inherit border-r flex items-center px-0 z-[5]"
      >
        {renderRowHeader ? renderRowHeader(row) : row.label}
      </div>

      {/* Timeline grid */}
      <div
        data-slot="timeline-row-grid"
        className="relative flex-1"
        style={{ width: `${timelineWidth}px` }}
      >
        {/* Grid lines */}
        {quarterMarkers.map((marker, idx) => (
          <div
            key={`quarter-${idx}`}
            data-slot="timeline-grid-line-quarter"
            className="absolute top-0 bottom-0 w-px bg-border/30"
            style={{ left: `${marker.position}px` }}
          />
        ))}
        {tickMarkers.map((marker) => (
          <div
            key={marker.ago}
            data-slot="timeline-grid-line-hour"
            className="absolute top-0 bottom-0 w-px bg-border"
            style={{ left: `${marker.position}px` }}
          />
        ))}

        {/* Slots */}
        {children}
      </div>
    </div>
  );
}

/* ============================================================================
 * TIMELINE SLOT
 * ========================================================================== */

export type TimelineSlotTone = "plain" | "muted" | "brand";
const SLOT_TONE: Record<TimelineSlotTone, string> = {
  plain: "border bg-card text-card-foreground",
  muted: "bg-muted text-muted-foreground",
  brand: "bg-brand text-on-brand",
};

interface TimelineSlotProps {
  slot: TimelineSlotData;
  children?: React.ReactNode;
  tone?: TimelineSlotTone;
  className?: string;
}

export function TimelineSlot({
  slot,
  children,
  tone = "plain",
  className,
}: TimelineSlotProps) {
  const { now, start, pixelsPerSecond } = useTimeline();

  // 보이는 때(왼쪽 끝 ~ 지금) 안 부분만
  const left = timeToX(Math.max(slot.from, start), start, pixelsPerSecond);
  const right = timeToX(Math.min(slot.to ?? now, now), start, pixelsPerSecond);
  const width = right - left;
  if (!(width > 0)) return null;

  return (
    <div
      data-slot="timeline-slot-wrap"
      className="absolute"
      style={{ left: `${left}px`, width: `${width}px`, top: 0, bottom: 0 }}
    >
      <div
        data-slot="timeline-slot"
        data-tone={tone}
        className={cn(
          "absolute inset-1 rounded overflow-hidden shadow-md",
          SLOT_TONE[tone],
          className,
        )}
      >
        {children}
      </div>
    </div>
  );
}

/* ============================================================================
 * TIMELINE SLOT PRIMITIVES (for content composition)
 * ========================================================================== */

type TimelineSlotLabelProps = React.ComponentProps<"div">;

export function TimelineSlotLabel({
  className,
  ...props
}: TimelineSlotLabelProps) {
  return (
    <div
      data-slot="timeline-slot-label"
      className={cn("font-medium truncate text-xs", className)}
      {...props}
    />
  );
}

/** 줄 머리 글(받은 예시 코드의 renderRowHeader 글). */
export function TimelineRowLabel({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div className="px-4 py-1">
      <div data-slot="timeline-row-name" className={cn("font-medium text-sm", className)} {...props} />
    </div>
  );
}

/* ============================================================================
 * TIMELINE INDICATORS
 * ========================================================================== */

const REGION_LABEL = {
  default: "",
  gap: "font-bold",
} as const;

interface TimelineRegionProps {
  from: number;
  to: number;
  label: React.ReactNode;
  size?: keyof typeof REGION_LABEL;
}

export function TimelineRegion({
  from,
  to,
  label,
  size = "default",
}: TimelineRegionProps) {
  const { config, start, now, pixelsPerSecond, timelineWidth } = useTimeline();
  const columnWidth = config.columnWidth || 64;

  const a = Math.max(from, start);
  const b = Math.min(to, now);
  if (!(b > a)) return null;
  const startPosition = timeToX(a, start, pixelsPerSecond) + columnWidth;
  const endPosition = timeToX(b, start, pixelsPerSecond) + columnWidth;
  const width = endPosition - startPosition;
  // 이름표가 카드 끝에 걸리면 그 끝에 맞춘다(가운데 대신)
  const edge = 48;
  const align = endPosition > columnWidth + timelineWidth - edge ? "right-0" : startPosition < columnWidth + edge ? "left-0" : "left-1/2 -translate-x-1/2";

  return (
    <div
      data-slot="timeline-drop-region"
      className="absolute top-0 bottom-0 pointer-events-none z-[12]"
      style={{ left: `${startPosition}px`, width: `${width}px` }}
    >
      <div className="absolute inset-0 bg-brand/[0.07]" />
      <div className="absolute top-0 bottom-0 left-0 w-0.5 bg-brand" />
      <div className="absolute top-0 bottom-0 right-0 w-0.5 bg-brand" />
      <div data-slot="timeline-region-label" className={cn("absolute top-[calc(50%+12px)] -translate-y-1/2 bg-brand text-on-brand px-2 py-0.5 rounded text-sm font-semibold whitespace-nowrap shadow-md", align, REGION_LABEL[size])}>
        {label}
      </div>
    </div>
  );
}

interface TimelineCurrentTimeProps {
  className?: string;
  nowLabel: React.ReactNode;
}

export function TimelineCurrentTime({
  className,
  nowLabel,
}: TimelineCurrentTimeProps) {
  const { config, pixelsPerSecond } = useTimeline();
  const columnWidth = config.columnWidth || 64;

  // 지금은 오른쪽 끝이다
  const position = config.spanSeconds * pixelsPerSecond + columnWidth - 2;

  return (
    <div
      data-slot="timeline-current-time"
      className={cn(
        "absolute top-0 bottom-0 w-0.5 bg-foreground pointer-events-none z-[15]",
        className,
      )}
      style={{ left: `${position}px` }}
    >
      <div className="absolute top-0 right-0 bg-foreground text-background px-2 py-1 rounded text-xs font-medium whitespace-nowrap shadow-md z-50">
        {nowLabel}
      </div>
    </div>
  );
}

/* ============================================================================
 * EXPORTS
 * ========================================================================== */

export { useTimeline };

export default Timeline;
