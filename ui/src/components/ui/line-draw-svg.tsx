"use client";

// 21st.dev「Line Draw SVG」(id 18352, pulkitxm/line-draw-svg) 받은 코드.
// 바꾼 것: gsap 그리기 움직임(trigger scroll·hover·mount, strokeDasharray·strokeDashoffset, duration·ease·scrub·start·end)과 hover 상태, <title>을 뺐다. 보기만 하는 트윈 위 판이라 쓰지 않고, 남기면 점선이 된다.
// viewBox는 0 0 100 100 대신 0 0 width height(구운 보기 그림 픽셀)이고, 선 굵기는 strokeScale(그림 px당 화면 px의 역수)을 곱한다.
// 색만 토큰으로: stroke currentColor + text-violet-500 → tone(트윈 표시 토큰 twin.*). 트윈 위 세 겹(바깥 숯색·흰 테·심)을 지키게 길 tone은 같은 path를 edge·casing·core로 세 번 그린다.
// 방 tone은 dimRoom(칠함)·roomEdge(선). 표시 tone(destination·checkDot·cloid)은 circle 프리셋을 at 가운데·토큰 반지름으로 겹쳐 그리고, cloid는 머리 방향(heading 프리셋)을 angle만큼 돌린다.
// 다른 프리셋(arrow·diamond·heart·star)을 뺐다.
// 원래 글 크기: 없음. 받은 코드에 글 크기가 없다. 글 크기를 넣으면 npm run lint(scripts/lint-ui-type.ts)가 막는다.
import { paint, TWIN, type Paint } from "@/lib/tokens";
import { cn } from "@/lib/utils";

/** 가운데 (x, y) 반지름 r 원(받은 circle 프리셋 "M50 5 A45 45 0 1 1 49.99 5"를 가운데·반지름으로). */
const circle = (x: number, y: number, r: number) => `M${x} ${y - r} A${r} ${r} 0 1 1 ${x - r * 0.0002} ${y - r} Z`;
/** 머리 방향 화살촉(오른쪽을 본다, 길이 단위 1). */
const HEADING = [[7.5, 0], [-4, -5.5], [-1.5, 0], [-4, 5.5]] as const;

export type LineTone = "route" | "routeAhead" | "routePassed" | "roomEdge" | "dimRoom" | "destination" | "checkDot" | "cloid";
/** 확인한 것 점 가운데 색: 켜짐·꺼짐·경고·모름(말풍선 번호와 같다), 물건. */
export type MarkTone = "on" | "off" | "alert" | "unknown" | "object";

type Layer = { d: string; fill?: Paint; stroke?: Paint; width?: number };

const MARK: Record<MarkTone, Paint> = {
  on: paint(TWIN.bubble.numberFill.on), off: paint(TWIN.bubble.numberFill.off), alert: paint(TWIN.bubble.numberFill.alert),
  unknown: paint(TWIN.bubble.numberFill.unknown), object: paint(TWIN.bubble.objectDot),
};

/** 길 세 겹: 바깥 숯색, 흰 테, 심. */
function lineLayers(d: string, line: typeof TWIN.route): Layer[] {
  const edge = paint(line.edge), casing = paint(line.casing), core = paint(line.core);
  return [{ d, stroke: edge, width: edge.width }, { d, stroke: casing, width: casing.width }, { d, stroke: core, width: line.width }];
}

function layersOf(tone: LineTone, d: string, [x, y]: [number, number], k: number, mark: MarkTone, angle: number): Layer[] {
  switch (tone) {
    case "route": return lineLayers(d, TWIN.route);
    case "routeAhead": return lineLayers(d, TWIN.routeAhead);
    case "routePassed": return lineLayers(d, TWIN.routePassed);
    case "roomEdge": { const e = paint(TWIN.roomEdge); return [{ d, stroke: e, width: e.width }]; }
    case "dimRoom": return [{ d, fill: paint(TWIN.dimRoom) }];
    case "destination": {
      const D = TWIN.destination;
      const casing = paint(D.casing), edge = paint(D.edge);
      return [
        { d: circle(x, y, 24 * k), fill: paint(D.halo) },
        { d: circle(x, y, (11 + D.ringWidth / 2 + casing.width + edge.width) * k), fill: edge },
        { d: circle(x, y, (11 + D.ringWidth / 2 + casing.width) * k), fill: casing },
        { d: circle(x, y, 11 * k), fill: paint(D.core), stroke: paint(D.ring), width: D.ringWidth },
        { d: circle(x, y, 4.5 * k), fill: paint(D.dot) },
      ];
    }
    case "checkDot": {
      const ring = paint(TWIN.checkDot.ring);
      return [{ d: circle(x, y, 8 * k), fill: paint(TWIN.checkDot.core), stroke: ring, width: ring.width }, { d: circle(x, y, 4.5 * k), fill: MARK[mark] }];
    }
    case "cloid": {
      const C = TWIN.cloid;
      const casing = paint(C.casing), edge = paint(C.edge);
      const a = (angle * Math.PI) / 180;
      const head = HEADING.map(([u, v]) => `${x + (u * Math.cos(a) - v * Math.sin(a)) * k},${y + (u * Math.sin(a) + v * Math.cos(a)) * k}`);
      return [
        { d: circle(x, y, 20 * k), fill: paint(C.halo) },
        { d: circle(x, y, (12 + casing.width + edge.width) * k), fill: edge },
        { d: circle(x, y, (12 + casing.width) * k), fill: casing },
        { d: circle(x, y, 12 * k), fill: paint(C.fill) },
        { d: `M${head.join("L")}Z`, fill: paint(C.heading) },
      ];
    }
  }
}

interface LineDrawSvgProps {
  /** SVG path d(그림 픽셀). 길·방 tone에 쓴다. */
  path?: string;
  tone?: LineTone;
  /** 표시 tone의 가운데(그림 픽셀). */
  at?: [number, number];
  /** checkDot 가운데 색. */
  mark?: MarkTone;
  /** cloid 머리 방향(그림 위 각도, 오른쪽 0 시계 +). */
  angle?: number;
  className?: string;
  width?: number;
  height?: number;
  /** 선 굵기·표시 크기 배율(그림 px당 화면 px의 역수). */
  strokeScale?: number;
}

export function LineDrawSvg({
  path = "",
  tone = "route",
  at = [0, 0],
  mark = "object",
  angle = 0,
  className,
  width = 120,
  height = 120,
  strokeScale = 1,
}: LineDrawSvgProps) {
  const layers = layersOf(tone, path, at, strokeScale, mark, angle);
  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className={cn("overflow-visible", className)}
      aria-hidden={true}
    >
      {layers.map((l, i) => (
        <path
          key={i}
          d={l.d}
          fill={l.fill ? l.fill.color : "none"}
          fillOpacity={l.fill ? l.fill.opacity : undefined}
          stroke={l.stroke ? l.stroke.color : "none"}
          strokeOpacity={l.stroke ? l.stroke.opacity : undefined}
          strokeWidth={l.stroke ? (l.width ?? 0) * strokeScale : undefined}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ))}
    </svg>
  );
}

export default LineDrawSvg;
