// 트윈 위 표시(길·목적지·확인한 것 점)를 21st.dev Line Draw SVG 여러 장으로 겹쳐 그릴 자리와 굵기(순수 함수). 클로이드는 엔진의 3D 원뿔(twin/3d/eye.ts)이다.
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

/** 선분 a→c가 상자(b) 안을 지나는 구간 [t0, t1](0~1). 안을 지나지 않으면(테두리만 스쳐도) null. */
function spanIn(a: Px, c: Px, b: Box): [number, number] | null {
  let t0 = 0, t1 = 1;
  for (const [p, d, lo, hi] of [[a[0], c[0] - a[0], b.x0, b.x1], [a[1], c[1] - a[1], b.y0, b.y1]] as const) {
    if (d === 0) { if (p <= lo || p >= hi) return null; continue; }
    const [u, v] = [(lo - p) / d, (hi - p) / d];
    t0 = Math.max(t0, Math.min(u, v));
    t1 = Math.min(t1, Math.max(u, v));
  }
  return t1 - t0 > 1e-9 ? [t0, t1] : null;
}

/** 꺾은선에서 상자(b, 그림 px) 안에 든 부분을 뺀 조각들: 상자에 들어가는 자리에서 끊고 나가는 자리부터 다시 잇는다. 다 안이면 빈 배열. */
export function outsideBox(pts: Px[], b: Box): Px[][] {
  const out: Px[][] = [];
  let cur: Px[] = [];
  const add = (p: Px) => { const l = cur.at(-1); if (!l || l[0] !== p[0] || l[1] !== p[1]) cur.push(p); };
  const end = () => { if (cur.length > 1) out.push(cur); cur = []; };
  for (let i = 0; i + 1 < pts.length; i++) {
    const [a, c] = [pts[i]!, pts[i + 1]!];
    const span = spanIn(a, c, b);
    if (!span) { add(a); add(c); continue; }
    const at = (t: number): Px => [a[0] + (c[0] - a[0]) * t, a[1] + (c[1] - a[1]) * t];
    if (span[0] > 0) { add(a); add(at(span[0])); }
    end();
    if (span[1] < 1) { add(at(span[1])); add(c); }
  }
  end();
  return out;
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
