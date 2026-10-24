// JPEG 인코딩 워커. 크롬의 canvas.toBlob은 메인 스레드가 한가할 때(idle) 인코딩을 시작하는데, WebXR AR 중에는
// 페이지 화면을 그리지 않아 한가한 틈이 거의 없다. 그래서 화면을 터치해야 프레임이 나가고 끊겨 보였다.
// 워커의 OffscreenCanvas는 메인 스레드 일정과 따로 돌므로 AR 중에도 바로 인코딩된다.

import { drawMarks } from "./marks.js";

let canvas = null;
let ctx = null;

self.onmessage = async (event) => {
  const { id, pixels, width, height, quality, marks } = event.data;
  try {
    if (!canvas || canvas.width !== width || canvas.height !== height) {
      canvas = new OffscreenCanvas(width, height);
      ctx = canvas.getContext("2d");
    }
    ctx.putImageData(new ImageData(new Uint8ClampedArray(pixels), width, height), 0, 0);
    drawMarks(ctx, marks ?? [], width, height);
    const blob = await canvas.convertToBlob({ type: "image/jpeg", quality });
    self.postMessage({ id, blob });
  } catch (error) {
    self.postMessage({ id, error: String(error?.message ?? error) });
  }
};
