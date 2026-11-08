// 폰 AR 위 그림(components.json F5·F13 「그림(규칙 밖)」): 가운데 조준점과 초점 고리·화면 밖 화살표·이름표를 canvas에 그린다.
// 모양·크기는 옮기기 전 phone.css와 같다. 조준점 28px(심 3px, 안팎 흰 테 2px·숯색 1px), 맞으면 가운데 점(지름 10px)을 채운다.
// 초점 고리 64px(심 3px brand), 1.2초마다 1.12배로 숨쉬고(움직임 줄이기면 멈춤), 4px 아래 이름표 「클로이드 주목 · 이름」.
// 화면 밖이면 그쪽을 가리키는 세모(22×28px). 고리(또는 세모)+이름표 묶음의 가운데가 그 점이다(옛 DOM 배치와 같음).
// 이름표는 화면 가장자리 8px 안으로 민다(가장자리 화살표의 이름표가 잘리지 않게). 화면 안 고리는 물건 자리에 두고 이름표만 민다.
// 화면 밖 화살표 묶음은 덮개가 가리는 자리를 비킨다: 위 상태 줄(64px), 큰 단추 줄(가로 오른쪽 96px, 세로 아래 88px).
// 세로 화면에서는 위 줄(말풍선·알림·사진 요청, canvas 아래)과 엄지 자리(canvas 위)가 화면 폭을 다 쓰므로, 그릴 때 잰 두 칸(overlayEdges)의
// 아래·위 8px 밖에 둔다. 그래야 화살표가 말풍선 글을 가리지 않고 엄지 자리에 깔리지 않는다. 가로에서는 두 칸이 조준점 옆 반쪽이라 재지 않는다.
// 조준점은 맨 위에 그린다. 고리·이름표가 화면 가운데에 와도 조준점을 가리지 않는다.
import { radius, type } from "../../../src/design/tokens.json";
import { font, twin } from "../../../src/design/tokens.ts";
import type { Box } from "./layout-check";
import type { FocusMark } from "./state";

const F = twin.phoneFocus;
const RETICLE_PX = 28;
const RING_PX = 64;
const GAP_PX = 4;
/** 이름표가 화면 가장자리에서 떨어지는 거리. 화면 밖 화살표의 이름표도 잘리지 않게 이 안으로 민다. */
const EDGE_PX = 8;
/** 옛 CSS 세모 상자: 왼쪽 테두리 22px + 오른쪽 투명 14px, 높이 28px. */
const ARROW = { box: 36, height: 28, tip: 22 };
const LABEL = { padX: 8, padY: 2, size: type["body-sm"].size.phone, line: type["body-sm"].lineHeight.phone, weight: type["body-sm"].weight, radius: radius["radius-lg"] };
/** 덮개 칸이 화면 위·아래에서 차지한 길이(CSS px): top은 위 줄 아래 끝 y, bottom은 화면 높이에서 엄지 자리 위 끝 y를 뺀 값. 칸이 비거나 없으면 0. */
export interface Edges { top: number; bottom: number }
const NO_EDGES: Edges = { top: 0, bottom: 0 };

/** 화면 밖 화살표 묶음이 비키는 가장자리(CSS px). 가로: 위 상태 줄 64, 오른쪽 큰 단추 줄 96, 나머지 8.
 * 세로: 위는 상태 줄 64와 위 줄 아래 8px 중 큰 쪽, 아래는 큰 단추 줄 88과 엄지 자리 위 8px 중 큰 쪽, 옆은 8. */
export function arrowInsets(size: { width: number; height: number }, edges: Edges = NO_EDGES) {
  return size.width > size.height
    ? { top: 64, right: 96, bottom: EDGE_PX, left: EDGE_PX }
    : { top: Math.max(64, edges.top + EDGE_PX), right: EDGE_PX, bottom: Math.max(88, edges.bottom + EDGE_PX), left: EDGE_PX };
}

/** 덮개 뿌리에서 위 줄(data-phone-zone=top)·엄지 자리(thumb)를 재서 Edges를 만든다. 그리기 전에 부른다. */
export function overlayEdges(root: ParentNode | null, height: number): Edges {
  const rect = (zone: string) => {
    const r = root?.querySelector(`[data-phone-zone=${zone}]`)?.getBoundingClientRect();
    return r && r.height > 0 ? r : null;
  };
  const top = rect("top");
  const thumb = rect("thumb");
  return { top: top ? top.bottom : 0, bottom: thumb ? height - thumb.top : 0 };
}
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(v, hi));
const PULSE_MS = 1200;
const PULSE = 0.12;

export const labelFont = `${LABEL.weight} ${LABEL.size}px ${font.canvas}`;
export const markLabel = (label: string) => `클로이드 주목 · ${label}`;
export interface OverlayScene { hit: boolean; marks: FocusMark[] }
/** 그린 화면 밖 화살표 묶음(세모+이름표) 하나의 자리(CSS px). 배치 검사가 덮개 칸과 겹치는지 본다. */
export interface ArrowBox { name: string; box: Box }

/** 숨쉬기 배율: 0.6초 동안 1 → 1.12, 다음 0.6초 동안 1.12 → 1(ease-in-out). 움직임 줄이기면 1. */
export function pulse(now: number, reduced: boolean): number {
  if (reduced) return 1;
  const t = (now % PULSE_MS) / (PULSE_MS / 2);
  const p = t <= 1 ? t : 2 - t;
  return 1 + (PULSE * (1 - Math.cos(Math.PI * p))) / 2;
}

/** canvas를 화면 크기 × 화소 비율로 맞추고 CSS px로 그리게 한다. */
export function fitCanvas(canvas: HTMLCanvasElement, width: number, height: number, dpr: number): CanvasRenderingContext2D | null {
  const w = Math.round(width * dpr);
  const h = Math.round(height * dpr);
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
  const ctx = canvas.getContext("2d");
  ctx?.setTransform(dpr, 0, 0, dpr, 0, 0);
  return ctx;
}

/** 세 겹 고리: 심 가운데 반지름 r, 심 굵기 w, 안팎으로 흰 테·숯색. k는 숨쉬기 배율. */
function rings(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, w: number, core: string, k = 1) {
  const R = r * k;
  const h = (w * k) / 2;
  const c = F.casing.width * k;
  const e = F.edge.width * k;
  const layers: [number, number, string][] = [
    [R + h + c + e / 2, e, F.edge.color],
    [R - h - c - e / 2, e, F.edge.color],
    [R + h + c / 2, c, F.casing.color],
    [R - h - c / 2, c, F.casing.color],
    [R, w * k, core],
  ];
  for (const [rr, lw, col] of layers) {
    ctx.beginPath();
    ctx.arc(x, y, rr, 0, Math.PI * 2);
    ctx.lineWidth = lw;
    ctx.strokeStyle = col;
    ctx.stroke();
  }
}

function drawReticle(ctx: CanvasRenderingContext2D, x: number, y: number, hit: boolean) {
  const core = hit ? F.aim.hit : F.aim.miss;
  rings(ctx, x, y, RETICLE_PX / 2 - F.ring.width / 2, F.ring.width, core);
  if (!hit) return;
  // 맞춤: 가운데 점(지름 10px)을 흰 테 1px·숯색 1px로 두른다
  for (const [r, c] of [[7, F.edge.color], [6, F.casing.color], [5, core]] as const) {
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = c;
    ctx.fill();
  }
}

/** 세모 꼭짓점 셋: (x, y)가 가운데, angle(도) 쪽을 가리킨다. */
function arrowPoints(x: number, y: number, angle: number): (readonly [number, number])[] {
  const a = (angle * Math.PI) / 180;
  const half = ARROW.box / 2;
  const pts: [number, number][] = [[-half, -ARROW.height / 2], [ARROW.tip - half, 0], [-half, ARROW.height / 2]];
  return pts.map(([px, py]) => [x + px * Math.cos(a) - py * Math.sin(a), y + px * Math.sin(a) + py * Math.cos(a)] as const);
}

function drawArrow(ctx: CanvasRenderingContext2D, x: number, y: number, angle: number) {
  const [p0, p1, p2] = arrowPoints(x, y, angle);
  ctx.beginPath();
  ctx.moveTo(p0![0], p0![1]);
  ctx.lineTo(p1![0], p1![1]);
  ctx.lineTo(p2![0], p2![1]);
  ctx.closePath();
  ctx.lineJoin = "round";
  ctx.lineWidth = 2 * (F.casing.width + F.edge.width);
  ctx.strokeStyle = F.edge.color;
  ctx.stroke();
  ctx.lineWidth = 2 * F.casing.width;
  ctx.strokeStyle = F.casing.color;
  ctx.stroke();
  ctx.fillStyle = F.offscreenArrow;
  ctx.fill();
}

/** 표시 하나를 그린다. 화면 밖 화살표면 세모+이름표 묶음의 자리를 돌려준다(세모는 테두리 굵기만큼 넓힌다). */
function drawMark(ctx: CanvasRenderingContext2D, m: FocusMark, size: { width: number; height: number }, now: number, reduced: boolean, edges: Edges): Box | null {
  const boxH = m.off ? ARROW.height : RING_PX;
  const labelH = LABEL.line + 2 * LABEL.padY;
  const groupH = boxH + GAP_PX + labelH;
  const edge = m.off ? arrowInsets(size, edges) : { top: EDGE_PX, right: EDGE_PX, bottom: EDGE_PX, left: EDGE_PX };
  const x = m.off ? clamp(m.u * size.width, edge.left + ARROW.box / 2, size.width - edge.right - ARROW.box / 2) : m.u * size.width;
  const y = m.off ? clamp(m.v * size.height, edge.top + groupH / 2, size.height - edge.bottom - groupH / 2) : m.v * size.height;
  const top = y - groupH / 2;
  const cy = top + boxH / 2;
  if (m.off) drawArrow(ctx, x, cy, m.angle);
  else rings(ctx, x, cy, RING_PX / 2 - F.ring.width / 2, F.ring.width, F.ring.color, pulse(now, reduced));
  const text = markLabel(m.label);
  ctx.font = labelFont;
  const w = ctx.measureText(text).width + 2 * LABEL.padX;
  const ly = clamp(top + boxH + GAP_PX, edge.top, size.height - edge.bottom - labelH);
  const lx = Math.max(edge.left, Math.min(x - w / 2, size.width - edge.right - w));
  ctx.beginPath();
  ctx.roundRect(lx, ly, w, labelH, LABEL.radius);
  ctx.fillStyle = F.labelBg;
  ctx.fill();
  ctx.fillStyle = F.labelText;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, lx + w / 2, ly + labelH / 2);
  if (!m.off) return null;
  const pts = arrowPoints(x, cy, m.angle);
  const line = F.casing.width + F.edge.width;
  return {
    left: Math.min(lx, ...pts.map((p) => p[0] - line)),
    top: Math.min(ly, ...pts.map((p) => p[1] - line)),
    right: Math.max(lx + w, ...pts.map((p) => p[0] + line)),
    bottom: Math.max(ly + labelH, ...pts.map((p) => p[1] + line)),
  };
}

/** 한 장 그리기: 지우고, 초점 표시, 맨 위에 조준점(이름표가 조준점 자리에 와도 조준점이 보인다). size·edges는 CSS px.
 * 그린 화면 밖 화살표 묶음의 자리를 돌려준다(화면 안 고리는 넣지 않는다). */
export function drawOverlay(ctx: CanvasRenderingContext2D, size: { width: number; height: number }, scene: OverlayScene, now: number, reduced: boolean, edges: Edges = NO_EDGES): ArrowBox[] {
  ctx.clearRect(0, 0, size.width, size.height);
  const arrows: ArrowBox[] = [];
  for (const m of scene.marks) {
    const box = drawMark(ctx, m, size, now, reduced, edges);
    if (box) arrows.push({ name: m.label, box });
  }
  drawReticle(ctx, size.width / 2, size.height / 2, scene.hit);
  return arrows;
}
