// 트윈 위 표시(길·목적지·확인한 것 점·클로이드)를 21st.dev Line Draw SVG 여러 장으로 겹쳐 그릴 자리와 굵기(순수 함수).
// 한 장은 path 하나를 토큰 색 선으로 그린다. 칠한 원은 반지름 r/2 원을 굵기 r로 그려 만든다. 크기는 화면 px이고 k(그림 px당 화면 px의 역수)를 곱한다.
import type { LineTone } from "../components/ui/line-draw-svg";
import { paint, TWIN } from "../lib/tokens";
import type { Px } from "./camera";

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

/** 머리 방향 화살촉 테두리(오른쪽을 본다, 길이 단위 1). 굵은 선으로 그려 속이 찬다. */
const HEADING = [[5.8, 0], [-2.8, -3.9], [-1, 0], [-2.8, 3.9]] as const;

export function cloidLayers([x, y]: Px, angle: number, k: number): Layer[] {
  const C = TWIN.cloid;
  const casing = paint(C.casing).width, edge = paint(C.edge).width;
  const a = (angle * Math.PI) / 180;
  const head = HEADING.map(([u, v]) => `${x + (u * Math.cos(a) - v * Math.sin(a)) * k},${y + (u * Math.sin(a) + v * Math.cos(a)) * k}`);
  return [
    disk("cloidHalo", [x, y], 20 * k),
    disk("cloidEdge", [x, y], (12 + casing + edge) * k),
    disk("cloidCasing", [x, y], (12 + casing) * k),
    disk("cloidFill", [x, y], 12 * k),
    { tone: "cloidHeading", d: `M${head.join("L")}Z`, width: 3.2 * k },
  ];
}
