// 실제 폰 AR 위 그림(components.json F5·F13 「그림(규칙 밖)」): 조준점과 명령 대상 쪽 세모를 canvas에 그린다. 이름표는 없다.
// 조준점은 물건 자리 맞추기 때만(scene.aim): 28px(심 3px, 안팎 흰 테 2px·숯색 1px), 맞으면 가운데 점(지름 10px)을 채운다. 맨 위에 그린다.
// 색은 못 맞춤 aim.miss, 맞춤 aim.hit, 어림 바닥에 닿음 aim.estimated(모양은 맞춤과 같다).
// 명령 대상: 화면 안이면 그리지 않는다(고리 없음). 화면 밖이면 그쪽을 가리키는 세모(22×28px) 하나.
// 화면 밖 세모는 덮개 칸을 비킨다: 그릴 때 잰 위 줄(미어캣·명령) 아래 8px부터 엄지 자리 위 8px까지, 옆은 화면 가장자리 8px 안(가로·세로 같다).
// 화면 안이어도 대상이 위 줄·엄지 자리 칸에 가리거나 칸 가장자리 NEAR_PANEL 안이면 그 칸 가장자리에 그쪽(위·아래)을 가리키는 세모를 그린다.
import { twin } from "../../../src/design/tokens.ts";
import type { Box } from "./layout-check";
import type { FocusMark } from "./state";

const F = twin.phoneFocus;
const RETICLE_PX = 28;
/** 대상이 칸 가장자리에서 이만큼(px) 안이면 칸에 가린 것으로 보고 세모를 그린다. */
const NEAR_PANEL = 20 + F.casing.width + F.edge.width;
const EDGE_PX = 8;
/** 옛 CSS 세모 상자: 왼쪽 테두리 22px + 오른쪽 투명 14px, 높이 28px. */
const ARROW = { box: 36, height: 28, tip: 22 };
/** 덮개 칸이 화면 위·아래에서 차지한 길이(CSS px): top은 위 줄 아래 끝 y, bottom은 화면 높이에서 엄지 자리 위 끝 y를 뺀 값. 칸이 비거나 없으면 0. */
export interface Edges { top: number; bottom: number }
const NO_EDGES: Edges = { top: 0, bottom: 0 };

/** 화면 밖 세모가 비키는 가장자리(CSS px): 위는 위 줄 아래 8px, 아래는 엄지 자리 위 8px(칸이 없으면 화면 가장자리 8px), 옆은 8px. */
export function arrowInsets(edges: Edges = NO_EDGES) {
  return { top: edges.top + EDGE_PX, right: EDGE_PX, bottom: edges.bottom + EDGE_PX, left: EDGE_PX };
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

export interface OverlayScene { aim: boolean; hit: boolean; hitEstimated: boolean; marks: FocusMark[] }
/** 그린 세모 하나의 자리(CSS px). 배치 검사가 덮개 칸과 겹치는지 본다. */
export interface ArrowBox { name: string; box: Box }
/** 그린 것: 화면 밖(또는 칸에 가린) 대상 쪽 세모. */
export interface Drawn { arrows: ArrowBox[] }

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

/** 세 겹 고리(조준점): 심 가운데 반지름 r, 심 굵기 w, 안팎으로 흰 테·숯색. */
function rings(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, w: number, core: string) {
  const R = r;
  const h = w / 2;
  const c = F.casing.width;
  const e = F.edge.width;
  const layers: [number, number, string][] = [
    [R + h + c + e / 2, e, F.edge.color],
    [R - h - c - e / 2, e, F.edge.color],
    [R + h + c / 2, c, F.casing.color],
    [R - h - c / 2, c, F.casing.color],
    [R, w, core],
  ];
  for (const [rr, lw, col] of layers) {
    ctx.beginPath();
    ctx.arc(x, y, rr, 0, Math.PI * 2);
    ctx.lineWidth = lw;
    ctx.strokeStyle = col;
    ctx.stroke();
  }
}

function drawReticle(ctx: CanvasRenderingContext2D, x: number, y: number, hit: boolean, estimated: boolean) {
  const core = !hit ? F.aim.miss : estimated ? F.aim.estimated : F.aim.hit;
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

/** 화면 밖 세모를 그리고 그 자리(테두리까지)를 돌려준다. */
function drawArrow(ctx: CanvasRenderingContext2D, m: FocusMark, size: { width: number; height: number }, edges: Edges): Box {
  const edge = arrowInsets(edges);
  const x = clamp(m.u * size.width, edge.left + ARROW.box / 2, size.width - edge.right - ARROW.box / 2);
  const y = clamp(m.v * size.height, edge.top + ARROW.box / 2, size.height - edge.bottom - ARROW.box / 2);
  const pts = arrowPoints(x, y, m.angle);
  const [p0, p1, p2] = pts;
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
  const line = F.casing.width + F.edge.width;
  return {
    left: Math.min(...pts.map((p) => p[0])) - line,
    top: Math.min(...pts.map((p) => p[1])) - line,
    right: Math.max(...pts.map((p) => p[0])) + line,
    bottom: Math.max(...pts.map((p) => p[1])) + line,
  };
}

/** 화면 안 대상이 덮개 칸에 가리면(칸 가장자리 NEAR_PANEL 안 포함) 그 칸 쪽 각도(위 -90, 아래 90), 아니면 null. 칸이 없으면(0) 보지 않는다. */
function underPanel(y: number, height: number, edges: Edges): number | null {
  if (edges.top > 0 && y - NEAR_PANEL < edges.top) return -90;
  if (edges.bottom > 0 && y + NEAR_PANEL > height - edges.bottom) return 90;
  return null;
}

/** 한 장 그리기: 지우고, 화면 밖이거나 칸에 가린 명령 대상 쪽 세모(화면 안이면 그리지 않음), 맨 위에 조준점(aim일 때만). size·edges는 CSS px.
 * 그린 세모의 자리를 돌려준다. */
export function drawOverlay(ctx: CanvasRenderingContext2D, size: { width: number; height: number }, scene: OverlayScene, edges: Edges = NO_EDGES): Drawn {
  ctx.clearRect(0, 0, size.width, size.height);
  const drawn: Drawn = { arrows: [] };
  for (const m of scene.marks) {
    const toward = m.off ? m.angle : underPanel(m.v * size.height, size.height, edges);
    if (toward !== null) drawn.arrows.push({ name: m.label, box: drawArrow(ctx, { ...m, angle: toward }, size, edges) });
  }
  if (scene.aim) drawReticle(ctx, size.width / 2, size.height / 2, scene.hit, scene.hitEstimated);
  return drawn;
}
