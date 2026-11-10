// 트윈 위 표시(길·목적지·확인한 것 점)를 21st.dev Line Draw SVG 여러 장으로 겹쳐 그릴 자리와 굵기(순수 함수). 클로이드는 엔진의 3D 인형·원뿔(twin3d/eye.ts)이다.
// 한 장은 path 하나를 토큰 색 선으로 그린다. 칠한 원은 반지름 r/2 원을 굵기 r로 그려 만든다. 크기는 화면 px이고 k(그림 px당 화면 px의 역수)를 곱한다.
import type { LineTone } from "../components/ui/line-draw-svg";
import { paint, TWIN } from "../lib/tokens";
import type { Px } from "./camera";
import type { Box } from "./labels";

export type Layer = { tone: LineTone; d: string; width: number };
/** 확인한 것 점 가운데 색: 켜짐·꺼짐·경고·모름(말풍선 번호와 같다), 물건. */
export type MarkTone = "on" | "off" | "alert" | "unknown" | "object";

const MARK: Record<MarkTone, LineTone> = { on: "markOn", off: "markOff", alert: "markAlert", unknown: "markUnknown", object: "markObject" };

/** 가운데 (x, y) 반지름 r 원. */
const circle = ([x, y]: Px, r: number) => `M${x} ${y - r}A${r} ${r} 0 1 1 ${x} ${y + r}A${r} ${r} 0 1 1 ${x} ${y - r}Z`;
/** 반지름 r 칠한 원. */
const disk = (tone: LineTone, at: Px, r: number): Layer => ({ tone, d: circle(at, r / 2), width: r });
/** 반지름 r, 굵기 w 고리. */
const ring = (tone: LineTone, at: Px, r: number, w: number): Layer => ({ tone, d: circle(at, r), width: w });

/** 밝히지 않는 방 어둡게(칠함). */
export const dimLayer = (d: string): Layer => ({ tone: "dimRoom", d, width: 0 });
/** 밝힌 방 테두리. */
export const roomEdgeLayer = (d: string, k: number): Layer => ({ tone: "roomEdge", d, width: paint(TWIN.roomEdge).width * k });

/** 길 세 겹: 바깥 숯색, 흰 테, 심. */
export function lineLayers(kind: "route" | "routeAhead" | "routePassed", d: string, k: number): Layer[] {
  const line = TWIN[kind];
  return [
    { tone: `${kind}Edge`, d, width: paint(line.edge).width * k },
    { tone: `${kind}Casing`, d, width: paint(line.casing).width * k },
    { tone: `${kind}Core`, d, width: line.width * k },
  ];
}

/** 꺾은선 앞쪽에서 상자(b, 그림 px) 안에 든 부분을 뺀다: 상자를 처음 나가는 자리부터 그린다. 다 안이면 빈 배열. */
export function leaveBox(pts: Px[], b: Box): Px[] {
  const inside = ([u, v]: Px) => u > b.x0 && u < b.x1 && v > b.y0 && v < b.y1;
  if (!pts.length || !inside(pts[0]!)) return pts;
  for (let i = 1; i < pts.length; i++) {
    if (inside(pts[i]!)) continue;
    // 안(a)에서 밖(c)으로 가는 선분이 상자 테두리를 지나는 자리
    const [a, c] = [pts[i - 1]!, pts[i]!];
    const du = c[0] - a[0], dv = c[1] - a[1];
    const tu = du > 0 ? (b.x1 - a[0]) / du : du < 0 ? (b.x0 - a[0]) / du : Infinity;
    const tv = dv > 0 ? (b.y1 - a[1]) / dv : dv < 0 ? (b.y0 - a[1]) / dv : Infinity;
    const t = Math.min(1, Math.max(0, Math.min(tu, tv)));
    return [[a[0] + du * t, a[1] + dv * t], ...pts.slice(i)];
  }
  return [];
}

export function destinationLayers(at: Px, k: number): Layer[] {
  const D = TWIN.destination;
  const casing = paint(D.casing).width, edge = paint(D.edge).width;
  return [
    disk("destinationHalo", at, 24 * k),
    disk("destinationEdge", at, (11 + D.ringWidth / 2 + casing + edge) * k),
    disk("destinationCasing", at, (11 + D.ringWidth / 2 + casing) * k),
    disk("destinationCore", at, 11 * k),
    ring("destinationRing", at, 11 * k, D.ringWidth * k),
    disk("destinationDot", at, 4.5 * k),
  ];
}

export function checkDotLayers(at: Px, mark: MarkTone, k: number): Layer[] {
  return [
    disk("checkDotCore", at, 8 * k),
    ring("checkDotRing", at, 8 * k, paint(TWIN.checkDot.ring).width * k),
    disk(MARK[mark], at, 4.5 * k),
  ];
}
