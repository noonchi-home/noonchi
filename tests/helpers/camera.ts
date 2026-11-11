// 시험 카메라와 사진: 트윈 (0, 1.5, 0)에서 45° 아래로 숙인 90° 정사각 투영(열 우선). tests/world-place.test.ts와 같은 카메라다.
// 사진은 jpeg-js로 만든 회색 바탕에 흰 네모(밝기는 번호마다 달라 고리의 같은 사진 버림에 걸리지 않는다).
import jpeg from "jpeg-js";
import type { CameraView } from "../../src/phone/session.js";
import { sha256, type EngineFrame } from "../../src/observe/ring.js";

type Box = [number, number, number, number];
const P = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, -1.0002, -1, 0, 0, -0.020002, 0];
const mul = (a: number[], b: number[]) => [a[3]! * b[0]! + a[0]! * b[3]! + a[1]! * b[2]! - a[2]! * b[1]!, a[3]! * b[1]! - a[0]! * b[2]! + a[1]! * b[3]! + a[2]! * b[0]!, a[3]! * b[2]! + a[0]! * b[1]! - a[1]! * b[0]! + a[2]! * b[3]!, a[3]! * b[3]! - a[0]! * b[0]! - a[1]! * b[1]! - a[2]! * b[2]!];
const tilt = [Math.sin(-Math.PI / 8), 0, 0, Math.cos(-Math.PI / 8)];

/** yaw만큼 돈 카메라(−π/2면 +x를 본다). */
export const cameraAt = (yaw: number): CameraView => ({
  origin: [0, 1.5, 0], orientation: mul([0, Math.sin(yaw / 2), 0, Math.cos(yaw / 2)], tilt) as [number, number, number, number], theta: 0, projection: P,
});
/** +x를 보는 카메라: 그림 가운데 광선이 바닥 (1.5, 0, 0)과 높이 0.9의 (0.6, 0.9, 0)을 지난다. */
export const LOOK_VIEW = cameraAt(-Math.PI / 2);
/** 반대(−x)를 보는 카메라: LOOK_VIEW 앞 자리는 시야 밖이다. */
export const AWAY_VIEW = cameraAt(Math.PI / 2);
export const LOOK_SIZE = { width: 480, height: 360 };

/** 밝기가 i마다 다른 회색(60~139)에 흰 네모(rects, 픽셀 [x, y, w, h])를 그린 LOOK_SIZE JPEG. */
export function frameJpeg(i: number, rects: readonly Box[] = []): Buffer {
  const { width, height } = LOOK_SIZE;
  const data = Buffer.alloc(width * height * 4);
  const gray = 60 + ((i * 17) % 80);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const white = rects.some(([rx, ry, rw, rh]) => x >= rx && x < rx + rw && y >= ry && y < ry + rh);
      const o = (y * width + x) * 4;
      data[o] = data[o + 1] = data[o + 2] = white ? 255 : gray;
      data[o + 3] = 255;
    }
  }
  return Buffer.from(jpeg.encode({ data, width, height }, 90).data);
}

/** 고리에 넣을 엔진 프레임(기본 LOOK_VIEW, LOOK_SIZE, frameJpeg(번호)). */
export function engineFrame(id: string, atMs: number, o: { view?: CameraView | null; jpeg?: Buffer } = {}): EngineFrame {
  const img = o.jpeg ?? frameJpeg(Number(id.replace(/\D/g, "")) || 0);
  return { id, capturedAtMs: atMs, latestAtMs: atMs, jpeg: img, sha256: sha256(img), ...LOOK_SIZE, eye: null, view: o.view === undefined ? LOOK_VIEW : o.view };
}
