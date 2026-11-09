// 초점 고리 그리기. 화면(capture.js)과 JPEG 인코딩 워커(encoder-worker.js)가 함께 쓴다(DOM 없음).
// 색·굵기는 src/design/tokens.ts(원본 src/design/tokens.json): 영상 위 표시는 세 겹(바깥 숯색, 흰 테, brand 심)이라 어떤 바탕에서도 보인다.

import { font, twin } from "../../../../src/design/tokens.ts";

const focus = twin.phoneFocus;
const canvasFont = font.canvas;

/** 이름표 글꼴: 묶은 Noto Sans KR Variable(화면은 @font-face, 워커는 FontFace로 넣는다). */
export function markFont(width) {
  return `bold ${Math.max(12, Math.round(width / 40))}px ${canvasFont}`;
}

/** 초점 고리(화면 안)·가장자리 화살표(화면 밖)와 이름표. ctx는 CanvasRenderingContext2D 또는 OffscreenCanvas 것. */
export function drawMarks(ctx, marks, width, height) {
  const r = Math.max(12, width * 0.05);
  // 심 굵기는 화면 폭에 맞추고, 흰 테·숯색은 그 비율대로 바깥에 두른다
  const core = Math.max(focus.ring.width, width / 160);
  const k = core / focus.ring.width;
  const casing = core + 2 * focus.casing.width * k;
  const edge = casing + 2 * focus.edge.width * k;
  ctx.save();
  ctx.font = markFont(width);
  ctx.textAlign = "center";
  for (const m of marks) {
    const x = m.u * width;
    const y = m.v * height;
    if (m.off) {
      const a = (m.angle * Math.PI) / 180;
      const path = () => {
        ctx.beginPath();
        ctx.moveTo(x + Math.cos(a) * r, y + Math.sin(a) * r);
        ctx.lineTo(x + Math.cos(a + 2.5) * r * 0.7, y + Math.sin(a + 2.5) * r * 0.7);
        ctx.lineTo(x + Math.cos(a - 2.5) * r * 0.7, y + Math.sin(a - 2.5) * r * 0.7);
        ctx.closePath();
      };
      path();
      ctx.lineWidth = edge - core;
      ctx.strokeStyle = focus.edge.color;
      ctx.stroke();
      ctx.lineWidth = casing - core;
      ctx.strokeStyle = focus.casing.color;
      ctx.stroke();
      ctx.fillStyle = focus.offscreenArrow;
      ctx.fill();
    } else {
      for (const [w, c] of [[edge, focus.edge.color], [casing, focus.casing.color], [core, focus.ring.color]]) {
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.lineWidth = w;
        ctx.strokeStyle = c;
        ctx.stroke();
      }
    }
    const label = m.label;
    const tw = ctx.measureText(label).width + 10;
    const ty = Math.min(height - 4, y + r + 18);
    ctx.fillStyle = focus.labelBg;
    ctx.fillRect(x - tw / 2, ty - 15, tw, 20);
    ctx.fillStyle = focus.labelText;
    ctx.fillText(label, x, ty);
  }
  ctx.restore();
}

