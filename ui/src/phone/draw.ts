// 폰 AR 위 그림(components.json F5·F13 「그림(규칙 밖)」): 가운데 조준점과 초점 고리·화면 밖 화살표·이름표를 canvas에 그린다.
// 모양·크기는 옮기기 전 phone.css와 같다. 조준점 28px(심 3px, 안팎 흰 테 2px·숯색 1px), 맞으면 가운데 점(지름 10px)을 채운다.
// 초점 고리 64px(심 3px brand), 1.2초마다 1.12배로 숨쉬고(움직임 줄이기면 멈춤), 4px 아래 이름표 「클로이드 주목 · 이름」.
// 화면 밖이면 그쪽을 가리키는 세모(22×28px). 고리(또는 세모)+이름표 묶음의 가운데가 그 점이다(옛 DOM 배치와 같음).
// 이름표는 화면 가장자리 8px 안으로 민다(가장자리 화살표의 이름표가 잘리지 않게).
import { radius, type } from "../../../src/design/tokens.json";
import { font, twin } from "../../../src/design/tokens.ts";
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
const PULSE_MS = 1200;
const PULSE = 0.12;

export const labelFont = `${LABEL.weight} ${LABEL.size}px ${font.canvas}`;
export const markLabel = (label: string) => `클로이드 주목 · ${label}`;
export interface OverlayScene { hit: boolean; marks: FocusMark[] }

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

function drawArrow(ctx: CanvasRenderingContext2D, x: number, y: number, angle: number) {
  const a = (angle * Math.PI) / 180;
  const half = ARROW.box / 2;
  const pts: [number, number][] = [[-half, -ARROW.height / 2], [ARROW.tip - half, 0], [-half, ARROW.height / 2]];
  const at = ([px, py]: [number, number]) => [x + px * Math.cos(a) - py * Math.sin(a), y + px * Math.sin(a) + py * Math.cos(a)] as const;
  const [p0, p1, p2] = pts.map(at);
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

function drawMark(ctx: CanvasRenderingContext2D, m: FocusMark, size: { width: number; height: number }, now: number, reduced: boolean) {
  const x = m.u * size.width;
  const y = m.v * size.height;
  const boxH = m.off ? ARROW.height : RING_PX;
  const labelH = LABEL.line + 2 * LABEL.padY;
  const top = y - (boxH + GAP_PX + labelH) / 2;
  const cy = top + boxH / 2;
  if (m.off) drawArrow(ctx, x, cy, m.angle);
  else rings(ctx, x, cy, RING_PX / 2 - F.ring.width / 2, F.ring.width, F.ring.color, pulse(now, reduced));
  const text = markLabel(m.label);
  ctx.font = labelFont;
  const w = ctx.measureText(text).width + 2 * LABEL.padX;
  const ly = top + boxH + GAP_PX;
  const lx = Math.max(EDGE_PX, Math.min(x - w / 2, size.width - EDGE_PX - w));
  ctx.beginPath();
  ctx.roundRect(lx, ly, w, labelH, LABEL.radius);
  ctx.fillStyle = F.labelBg;
  ctx.fill();
  ctx.fillStyle = F.labelText;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, lx + w / 2, ly + labelH / 2);
}

/** 한 장 그리기: 지우고, 조준점, 그 위에 초점 표시(옛 DOM 순서와 같다). size는 CSS px. */
export function drawOverlay(ctx: CanvasRenderingContext2D, size: { width: number; height: number }, scene: OverlayScene, now: number, reduced: boolean): void {
  ctx.clearRect(0, 0, size.width, size.height);
  drawReticle(ctx, size.width / 2, size.height / 2, scene.hit);
  for (const m of scene.marks) drawMark(ctx, m, size, now, reduced);
}
