"use client";

// 21st.dev「Line Draw SVG」(id 18352, pulkitxm/line-draw-svg) 받은 코드.
// 바꾼 것: 안 쓰는 기능을 뺐다: gsap 그리기 움직임(trigger scroll·hover·mount, strokeDasharray·strokeDashoffset, duration·ease·scrub·start·end), hover 상태, <title>, 프리셋 다섯, strokeClassName.
// 데이터 연결: viewBox 0 0 100 100 → 0 0 width height(path가 구운 보기 그림 픽셀이다).
// 토큰 색: stroke currentColor·text-violet-500 → tone 토큰 색(트윈 표시 토큰 twin.*, FSM 카드 토큰 viz.fsm, 메시지 상자 꼬리 viz.talkTail)과 그 진하기, fill none → 방 어둡게(dimRoom)·상자 꼬리(talkTail)만 토큰 색 칠함(토큰 색 고침으로 사용자 허용 2026-11-09).
// 모서리: 선 끝·꺾임을 둥글게(strokeLinecap·strokeLinejoin round).
// 원래 글 크기: 없음. 받은 코드에 글 크기가 없다. 글 크기를 넣으면 npm run lint(scripts/lint-ui-type.ts)가 막는다.
import { FSM, paint, TALK_TAIL, TWIN, type Paint } from "@/lib/tokens";
import { cn } from "@/lib/utils";

const D = TWIN.destination;
const C = TWIN.cloid;
const N = TWIN.bubble.numberFill;

/** 선 색 토큰. */
const TONES = {
  routeEdge: paint(TWIN.route.edge), routeCasing: paint(TWIN.route.casing), routeCore: paint(TWIN.route.core),
  routeAheadEdge: paint(TWIN.routeAhead.edge), routeAheadCasing: paint(TWIN.routeAhead.casing), routeAheadCore: paint(TWIN.routeAhead.core),
  routePassedEdge: paint(TWIN.routePassed.edge), routePassedCasing: paint(TWIN.routePassed.casing), routePassedCore: paint(TWIN.routePassed.core),
  roomEdge: paint(TWIN.roomEdge), dimRoom: paint(TWIN.dimRoom),
  destinationHalo: paint(D.halo), destinationEdge: paint(D.edge), destinationCasing: paint(D.casing), destinationCore: paint(D.core),
  destinationRing: paint(D.ring), destinationDot: paint(D.dot),
  checkDotCore: paint(TWIN.checkDot.core), checkDotRing: paint(TWIN.checkDot.ring),
  markOn: paint(N.on), markOff: paint(N.off), markAlert: paint(N.alert), markUnknown: paint(N.unknown), markObject: paint(TWIN.bubble.objectDot),
  cloidHalo: paint(C.halo), cloidEdge: paint(C.edge), cloidCasing: paint(C.casing), cloidFill: paint(C.fill), cloidHeading: paint(C.heading),
  fsmEdge: paint(FSM.edge), fsmOut: paint(FSM.out), fsmTaken: paint(FSM.taken), fsmRing: paint(FSM.ring), fsmDot: paint(FSM.dot),
  talkTail: paint(TALK_TAIL.fill), talkTailEdge: paint(TALK_TAIL.edge),
} satisfies Record<string, Paint>;

export type LineTone = keyof typeof TONES;

interface LineDrawSvgProps {
  /** SVG path d(그림 픽셀). */
  path?: string;
  /** 선 색 토큰. dimRoom은 칠한다. */
  tone?: LineTone;
  className?: string;
  width?: number;
  height?: number;
  strokeWidth?: number;
}

export function LineDrawSvg({
  path = "",
  tone = "routeCore",
  className,
  width = 120,
  height = 120,
  strokeWidth = 2,
}: LineDrawSvgProps) {
  const p = TONES[tone];
  const fill = tone === "dimRoom" || tone === "talkTail";
  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className={cn("overflow-visible", className)}
      aria-hidden={true}
    >
      <path
        d={path}
        fill={fill ? p.color : "none"}
        fillOpacity={fill ? p.opacity : undefined}
        stroke={fill ? "none" : p.color}
        strokeOpacity={fill ? undefined : p.opacity}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export default LineDrawSvg;
