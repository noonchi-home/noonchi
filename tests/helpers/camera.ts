// 시험 카메라와 사진: 트윈 (0, 1.5, 0)에서 45° 아래로 숙인 90° 정사각 투영(열 우선). tests/world-place.test.ts와 같은 카메라다.
// 사진은 jpeg-js로 만든 회색 바탕에 흰 네모(밝기는 번호마다 달라 고리의 같은 사진 버림에 걸리지 않는다).
import jpeg from "jpeg-js";
import type { CameraView, EngineFrame } from "../../src/contract/observe.js";
import { sha256 } from "../../src/observe/ring.js";
import { pixelOf } from "../../src/world/place.js";

type Box = [number, number, number, number];
const P = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, -1.0002, -1, 0, 0, -0.020002, 0];
const mul = (a: number[], b: number[]) => [a[3]! * b[0]! + a[0]! * b[3]! + a[1]! * b[2]! - a[2]! * b[1]!, a[3]! * b[1]! - a[0]! * b[2]! + a[1]! * b[3]! + a[2]! * b[0]!, a[3]! * b[2]! + a[0]! * b[1]! - a[1]! * b[0]! + a[2]! * b[3]!, a[3]! * b[3]! - a[0]! * b[0]! - a[1]! * b[1]! - a[2]! * b[2]!];
const tilt = [Math.sin(-Math.PI / 8), 0, 0, Math.cos(-Math.PI / 8)];

/** yaw만큼 돈 카메라(−π/2면 +x를 본다). */
export const cameraAt = (yaw: number): CameraView => ({
  origin: [0, 1.5, 0], orientation: mul([0, Math.sin(yaw / 2), 0, Math.cos(yaw / 2)], tilt) as [number, number, number, number], theta: 0, projection: P,
});
/** origin(트윈 [x, 높이, y])에서 target을 그림 가운데로 바라보는 카메라(같은 90° 투영, theta 0). target이 바로 아래면 yaw는 0이다. */
export function viewLooking(origin: [number, number, number], target: [number, number, number]): CameraView {
  const dx = target[0] - origin[0], dy = target[1] - origin[1], dz = target[2] - origin[2];
  const yaw = Math.atan2(-dx, -dz);
  const pitch = Math.atan2(dy, Math.hypot(dx, dz));
  const q = mul([0, Math.sin(yaw / 2), 0, Math.cos(yaw / 2)], [Math.sin(pitch / 2), 0, 0, Math.cos(pitch / 2)]) as [number, number, number, number];
  return { origin, orientation: q, theta: 0, projection: P };
}
/** 그 카메라를 보는 방향 축으로 deg만큼 돌린 카메라(폰을 옆으로 돌림). */
export function rolled(view: CameraView, deg: number): CameraView {
  const a = (deg * Math.PI) / 180;
  return { ...view, orientation: mul(view.orientation, [0, 0, Math.sin(a / 2), Math.cos(a / 2)]) as [number, number, number, number] };
}
/** 컵 원기둥(바닥 가운데 c, 반지름 r, 높이 h)을 그 카메라로 찍은 상자 [x, y, w, h](LOOK_SIZE 픽셀). */
export function cylinderBox(view: CameraView, c: [number, number, number], r: number, h: number, size = LOOK_SIZE): [number, number, number, number] {
  const pts: [number, number][] = [];
  for (let k = 0; k < 32; k++) {
    const a = (k / 32) * Math.PI * 2;
    for (const y of [0, h]) pts.push(pixelOf(view, [c[0] + r * Math.cos(a), c[1] + y, c[2] + r * Math.sin(a)], size)!);
  }
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)];
}
/** +x를 보는 카메라: 그림 가운데 광선이 바닥 (1.5, 0, 0)과 높이 0.9의 (0.6, 0.9, 0)을 지난다. */
export const LOOK_VIEW = cameraAt(-Math.PI / 2);
/** 반대(−x)를 보는 카메라: LOOK_VIEW 앞 자리는 시야 밖이다. */
export const AWAY_VIEW = cameraAt(Math.PI / 2);
export const LOOK_SIZE = { width: 480, height: 360 };
/** 그 카메라를 찍은 폰 눈(카메라 자리): 관찰 흐름에 엔진 프레임과 함께 넣는다. */
export const eyeOfView = (view: CameraView) => ({ position: [view.origin[0], view.origin[2]] as [number, number], height_m: view.origin[1], yaw_deg: 0, pitch_deg: 0, tracking: "ok" as const, at: "2026-11-18T00:00:00.000Z" });
/** LOOK_VIEW를 찍은 폰 눈(트윈 (0, 0), 높이 1.5): 관찰 흐름에 엔진 프레임과 함께 넣는다(장면 VLM 새 물건은 폰 눈을 아는 사진에서만 확정한다). */
export const LOOK_EYE = { position: [0, 0] as [number, number], height_m: 1.5, yaw_deg: -90, pitch_deg: -45, tracking: "ok" as const, at: "2026-11-18T00:00:00.000Z" };

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
