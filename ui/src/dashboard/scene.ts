// 트윈 위 표시 고르기(순수 함수, 시안 A 그대로). 카메라와 상자 크기 → 확인한 것의 화면 자리, 지금 이동 구간의 남은 길,
// 띄울 기기 말풍선(최근 것만, 지금 갈 길을 가리지 않고, 겹치면 최신 것만), 밝힌 방 이름표 자리.
// 가린 자리(blocked: 지도 위에 얹은 마스코트 말풍선·마스코트)에 걸리는 말풍선은 빼고, 이름표는 비켜 둔다.
// 클로이드 3D 원뿔 자리·목적지 표시 둘레(keep)는 말풍선이 덮지 않게 BubbleLayer가 판을 옆·아래로 옮긴다.
import type { Check } from "../checks/checks";
import type { ScreenPoint } from "../twin/use-anchors";
import type { BoxSize } from "./fit";
import type { TwinFrame } from "./frame";
import type { RoomShape } from "./home";
import { legOf, toScreen, type Camera, type Px } from "./camera";
import { BUBBLE_BOX, clearOfRoute, recentChecks, spread, thingId } from "./checks";
import { avoidBoxes, LABEL, placeLabel, type Box } from "./labels";
import type { Rect } from "../bubbles/place";

export type { Box } from "./labels";

/** 방 이름표 하나의 크기(px, 대략). */
export const LABEL_BOX = LABEL;
/** 목적지 표시 둘레 반지름(px, LineDrawSvg destination 바깥 원). */
const TARGET_R = 24;
/** 말풍선이 겹친다고 볼 꼬리 끝 사이(px). */
const SPREAD = { dx: 168, dy: 70 };

const same = (a: Px, b: Px) => Math.abs(a[0] - b[0]) < 0.5 && Math.abs(a[1] - b[1]) < 0.5;
const hit = (a: Box, b: Box) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;

export interface MapScene {
  /** 확인한 것 id → 상자 안 자리(상자 안이면 visible). */
  points: Map<string, ScreenPoint>;
  /** 지금 이동 중인 구간의 남은 길(그림 픽셀). 이동 중이 아니면 빈 배열. */
  legAhead: Px[];
  /** 기기 말풍선을 띄울 확인. */
  checks: Check[];
  /** 밝힌 방 이름표(상자 안 가운데 자리). */
  labels: { id: string; label: string; at: { x: number; y: number } }[];
  /** 말풍선이 덮지 않을 클로이드 3D 원뿔 자리(꼭짓점 공 ~ 넓은 끝)·목적지 표시 둘레(상자 px). */
  keep: Rect[];
}

/** 지금 이동 중인 구간의 남은 길: 남은 길에서 그 구간 끝 점까지. */
export function legAheadOf(frame: TwinFrame): Px[] {
  const leg = legOf(frame);
  if (!leg?.now) return [];
  const end = frame.route.points[leg.to];
  const at = end ? frame.route.ahead.findIndex((p) => same(p, end)) : -1;
  return at < 0 ? frame.route.ahead : frame.route.ahead.slice(0, at + 1);
}

/** 그림 픽셀 상자 → 상자 px 상자. */
const screenBox = (cam: Camera, size: BoxSize, b: Box): Box => {
  const a = toScreen(cam, size, [b.x0, b.y0]), c = toScreen(cam, size, [b.x1, b.y1]);
  return { x0: a.x, y0: a.y, x1: c.x, y1: c.y };
};

/** 꼬리 끝(p) 위 기기 말풍선 자리(px, 대략). */
const bubbleBox = (p: { x: number; y: number }): Box => ({ x0: p.x - BUBBLE_BOX.w / 2, y0: p.y - BUBBLE_BOX.h, x1: p.x + BUBBLE_BOX.w / 2, y1: p.y + 9 });

/** 점이 다각형 안인가(짝수 교차). */
function within([u, v]: Px, poly: Px[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [ui, vi] = poly[i]!;
    const [uj, vj] = poly[j]!;
    if (vi > v !== vj > v && u < ((uj - ui) * (v - vi)) / (vj - vi) + ui) inside = !inside;
  }
  return inside;
}

/**
 * 방 이름표를 둘 가운데 자리 후보(상자 px): 방 가운데, 그다음 방 가운데에서 상자 가운데 쪽으로 1/4·1/2·3/4 옮긴 자리 중 방 바닥 안인 것.
 * 거실처럼 큰 방은 가운데가 상자 밖이거나 말풍선 카드 밑이어도 보이는 방 안에 이름표를 둔다.
 */
function labelSpots(r: RoomShape, cam: Camera, size: BoxSize): { x: number; y: number }[] {
  const c = toScreen(cam, size, r.center);
  const out = [c];
  for (const t of [0.25, 0.5, 0.75]) {
    const p = { x: c.x + (size.width / 2 - c.x) * t, y: c.y + (size.height / 2 - c.y) * t };
    const img: Px = [cam.cx + (p.x - size.width / 2) / cam.scale, cam.cy + (p.y - size.height / 2) / cam.scale];
    if (within(img, r.floor)) out.push(p);
  }
  return out;
}

/** checks는 확인 목록(대시보드 거르기 뒤), shapes는 방 모양(그림 픽셀). */
export function mapScene(frame: TwinFrame, checks: Check[], shapes: RoomShape[], size: BoxSize, cam: Camera, blocked: Box[] = [], legAhead: Px[] = legAheadOf(frame)): MapScene {
  const points = new Map<string, ScreenPoint>();
  for (const mark of frame.marks) {
    const p = toScreen(cam, size, mark.px);
    points.set(mark.id, { ...p, visible: cam.scale > 0 && p.x >= 0 && p.y >= 0 && p.x <= size.width && p.y <= size.height });
  }
  // 말풍선: 최근에 확인한 것 중 지금 갈 길을 가리지 않는 것만, 겹치면 최신 것만, 가린 자리 밑이면 뺀다
  const legScreen = legAhead.map((q): Px => { const s = toScreen(cam, size, q); return [s.x, s.y]; });
  const shown = spread(clearOfRoute(recentChecks(checks), points, legScreen), points, SPREAD.dx, SPREAD.dy)
    .filter((c) => { const p = points.get(thingId(c)); return !p || !blocked.some((b) => hit(bubbleBox(p), b)); });
  // 클로이드 3D 원뿔이 상자에서 차지하는 자리(꼭짓점 공 ~ 넓은 끝)
  const cone = frame.robot && cam.scale > 0 ? screenBox(cam, size, frame.robot.body) : null;
  // 방 이름표: 밝힌 방만, 말풍선·목적지·클로이드 원뿔·가린 자리를 피해서
  const labels: MapScene["labels"] = [];
  if (cam.scale > 0) {
    const bubbleAt = shown.flatMap((c) => { const p = points.get(thingId(c)); return p ? [p] : []; });
    const dots = frame.target ? [toScreen(cam, size, frame.target)] : [];
    const avoid = [...avoidBoxes(bubbleAt, dots), ...(cone ? [cone] : []), ...blocked];
    for (const r of shapes) {
      if (!frame.rooms.includes(r.id)) continue;
      let at: { x: number; y: number } | null = null;
      for (const c of labelSpots(r, cam, size)) if ((at = placeLabel(c, avoid, size))) break;
      if (at) labels.push({ id: r.id, label: r.label, at });
    }
  }
  const keep: Rect[] = [];
  if (cone) keep.push({ left: cone.x0, top: cone.y0, right: cone.x1, bottom: cone.y1 });
  if (frame.target && cam.scale > 0) {
    const p = toScreen(cam, size, frame.target);
    keep.push({ left: p.x - TARGET_R, top: p.y - TARGET_R, right: p.x + TARGET_R, bottom: p.y + TARGET_R });
  }
  return { points, legAhead, checks: shown, labels, keep };
}
