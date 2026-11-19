// 폰이 보내는 화면 프레임 위 명령 대상 표시. 화면(capture.js)과 JPEG 인코딩 워커(encoder-worker.js)가 함께 쓴다(DOM 없음).
// 실제 폰 화면과 같은 그림이다(../draw.ts drawTargets, 칸 없음): 화면 안 대상은 아무것도 그리지 않고(고리·이름표 없음), 화면 밖 대상은 그쪽 방향 세모만.
// (2026-11-19 사용자 「동그란 원 너무 거슬리는데」 「컵 위에 주방·식당 싱크대는 왜 표시되는 거야?」: 영상 모드는 폰 자세를 흉내 내 화면 안 대상 자리가 영상과 어긋난다)

import { font } from "../../../../src/design/tokens.ts";
import { drawTargets } from "../draw.ts";

const canvasFont = font.canvas;

/** 이름표 글꼴: 묶은 Noto Sans KR Variable(화면은 @font-face, 워커는 FontFace로 넣는다). */
export function markFont(width) {
  return `bold ${Math.max(12, Math.round(width / 40))}px ${canvasFont}`;
}

/** 명령 대상 표시(실제 폰 화면과 같은 drawTargets, 칸 없음). ctx는 CanvasRenderingContext2D 또는 OffscreenCanvas 것. 크기는 프레임 픽셀. */
export function drawMarks(ctx, marks, width, height) {
  ctx.save();
  drawTargets(ctx, { width, height }, marks);
  ctx.restore();
}
