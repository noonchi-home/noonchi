// 초점 고리 그리기. 화면(capture.js)과 JPEG 인코딩 워커(encoder-worker.js)가 함께 쓴다(DOM 없음).

const FOCUS_COLOR = "#2f6fde";

/** 초점 고리(화면 안)·가장자리 화살표(화면 밖)와 이름표. ctx는 CanvasRenderingContext2D 또는 OffscreenCanvas 것. */
export function drawMarks(ctx, marks, width, height) {
  const r = Math.max(12, width * 0.05);
  ctx.save();
  ctx.lineWidth = Math.max(3, width / 160);
  ctx.font = `bold ${Math.max(12, Math.round(width / 40))}px system-ui, sans-serif`;
  ctx.textAlign = "center";
  for (const m of marks) {
    const x = m.u * width;
    const y = m.v * height;
    ctx.strokeStyle = FOCUS_COLOR;
    ctx.fillStyle = FOCUS_COLOR;
    if (m.off) {
      const a = (m.angle * Math.PI) / 180;
      ctx.beginPath();
      ctx.moveTo(x + Math.cos(a) * r, y + Math.sin(a) * r);
      ctx.lineTo(x + Math.cos(a + 2.5) * r * 0.7, y + Math.sin(a + 2.5) * r * 0.7);
      ctx.lineTo(x + Math.cos(a - 2.5) * r * 0.7, y + Math.sin(a - 2.5) * r * 0.7);
      ctx.closePath();
      ctx.fill();
    } else {
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.stroke();
    }
    const label = m.label;
    const tw = ctx.measureText(label).width + 10;
    const ty = Math.min(height - 4, y + r + 18);
    ctx.fillStyle = "rgb(0 0 0 / 0.6)";
    ctx.fillRect(x - tw / 2, ty - 15, tw, 20);
    ctx.fillStyle = "#fff";
    ctx.fillText(label, x, ty);
  }
  ctx.restore();
}
