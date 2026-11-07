// JPEG 인코딩 워커. 크롬의 canvas.toBlob은 메인 스레드가 한가할 때(idle) 인코딩을 시작하는데, WebXR AR 중에는
// 페이지 화면을 그리지 않아 한가한 틈이 거의 없다. 그래서 화면을 터치해야 프레임이 나가고 끊겨 보였다.
// 워커의 OffscreenCanvas는 메인 스레드 일정과 따로 돌므로 AR 중에도 바로 인코딩된다.
// 초점 이름표 글꼴: 워커에는 페이지의 @font-face가 없어서 묶은 Noto Sans KR Variable 조각을 FontFace로 넣고, 그릴 글자의 조각을 받은 뒤 그린다.

import { faces, family } from "./fonts/faces.js";
import { drawMarks, markFont } from "./marks.js";

let canvas = null;
let ctx = null;
let fontsAdded = false;

/** 이름표 글자에 맞는 글꼴 조각을 받는다(unicode-range로 고른다). 못 받으면 대체 글꼴로 그린다. */
async function loadFont(marks, width) {
  const text = marks.map((m) => m.label).join("");
  if (!text || !self.fonts || typeof FontFace !== "function") return;
  if (!fontsAdded) {
    for (const f of faces) {
      self.fonts.add(new FontFace(family, `url(${new URL(`./fonts/${f.src}`, import.meta.url)}) format("woff2")`, { weight: "100 900", unicodeRange: f.unicodeRange }));
    }
    fontsAdded = true;
  }
  await self.fonts.load(markFont(width), text).catch(() => {});
}

self.onmessage = async (event) => {
  const { id, pixels, width, height, quality, marks } = event.data;
  try {
    await loadFont(marks ?? [], width);
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
