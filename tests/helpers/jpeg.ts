// 시험·속도 재기용 JPEG 한 장: 고정 자료 PNG(tests/fixtures/twin-pixels/hub-1920.png)를 폰 엔진 프레임 크기로 이어 붙여 만든다.
import { fileURLToPath } from "node:url";
import jpeg from "jpeg-js";
import { readPng } from "./png.js";

const PNG = fileURLToPath(new URL("../fixtures/twin-pixels/hub-1920.png", import.meta.url));

export function fixtureJpeg(width = 360, height = 640, quality = 80): Buffer {
  const png = readPng(PNG);
  const data = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const [r, g, b] = png.pixels[(y % png.height) * png.width + (x % png.width)]!;
    data.set([r, g, b, 255], (y * width + x) * 4);
  }
  return Buffer.from(jpeg.encode({ data, width, height }, quality).data);
}
