// 가까이 보기 자르기(src/observe/pipeline.ts closer): 트윈 자리 → 엔진 프레임 픽셀 → 프레임 1/zoom 크기 상자(그림 안으로 붙임) → 잘라 프레임 크기로 키운 사진,
// 그 사진의 상자 → 엔진 프레임 픽셀. 키운 사진 한 장을 감지기와 VLM이 같이 본다.
import jpeg from "jpeg-js";

export type Box = [number, number, number, number];
type Size = { width: number; height: number };
/** 가까이 볼 곳: id·이름과 트윈 자리 [x, 높이, y]. */
export interface LookSpot { id: string; label: string; position: [number, number, number] }
export const CLOSER_ZOOM = 2;
/** 대상 점이 이만큼(NDC) 화면 밖이어도 사진 안으로 본다(자르는 상자는 그림 안으로 붙인다). */
export const LOOK_MARGIN = 0.25;
/** 잘라 본 상자 경계에서 이만큼(엔진 프레임 픽셀) 안쪽에 닿은 상자는 잘린 상자라 자리·같은 물건 맞추기에 쓰지 않는다. */
export const CROP_EDGE_PX = 4;

export function cropBox(center: [number, number], size: Size, zoom = CLOSER_ZOOM): Box {
  const w = Math.round(size.width / zoom), h = Math.round(size.height / zoom);
  const x = Math.min(size.width - w, Math.max(0, Math.round(center[0] - w / 2)));
  const y = Math.min(size.height - h, Math.max(0, Math.round(center[1] - h / 2)));
  return [x, y, w, h];
}

/** 잘라 키운 사진(out 크기)의 상자 → 엔진 프레임 픽셀. */
export function toFrameBox(box: Box, crop: Box, out: Size): Box {
  const sx = crop[2] / out.width, sy = crop[3] / out.height;
  return [crop[0] + box[0] * sx, crop[1] + box[1] * sy, box[2] * sx, box[3] * sy];
}

/** 엔진 프레임 픽셀 상자 → 잘라 키운 사진(out 크기) 픽셀(toFrameBox의 거꾸로). 잘라 낸 칸 밖은 그 사진 안으로 붙인다. */
export function toCropBox(box: Box, crop: Box, out: Size): Box {
  const sx = out.width / crop[2], sy = out.height / crop[3];
  const x0 = Math.max(0, (box[0] - crop[0]) * sx), y0 = Math.max(0, (box[1] - crop[1]) * sy);
  const x1 = Math.min(out.width, (box[0] + box[2] - crop[0]) * sx), y1 = Math.min(out.height, (box[1] + box[3] - crop[1]) * sy);
  return [x0, y0, Math.max(0, x1 - x0), Math.max(0, y1 - y0)];
}

/** 잘라 키운 사진(out 크기)의 점 → 엔진 프레임 픽셀. */
export function toFramePoint(point: [number, number], crop: Box, out: Size): [number, number] {
  return [crop[0] + point[0] * (crop[2] / out.width), crop[1] + point[1] * (crop[3] / out.height)];
}

/** 잘라 키운 사진의 감지 → 엔진 프레임 픽셀: 상자·바닥 점·마스크 자리(at)를 같이 옮긴다(마스크 칸은 그대로). */
export function toFrameDetection<T extends { box: Box; foot: [number, number]; mask: { at: Box } }>(d: T, crop: Box, out: Size): T {
  return { ...d, box: toFrameBox(d.box, crop, out), foot: toFramePoint(d.foot, crop, out), mask: { ...d.mask, at: toFrameBox(d.mask.at, crop, out) } };
}

/** 엔진 프레임 픽셀 상자가 잘라 본 상자 경계 CROP_EDGE_PX 안에 닿는가. */
export function onCropEdge(box: Box, crop: Box, px = CROP_EDGE_PX): boolean {
  return box[0] <= crop[0] + px || box[1] <= crop[1] + px || box[0] + box[2] >= crop[0] + crop[2] - px || box[1] + box[3] >= crop[1] + crop[3] - px;
}

/** 쌍선형(픽셀 가운데 기준, 끝은 붙임)으로 crop을 out 크기로 키운 JPEG. JPEG 크기가 out과 다르면 던진다(헤더와 다른 사진). */
export function cropJpeg(src: Buffer, crop: Box, out: Size, quality = 90): Buffer {
  const img = jpeg.decode(src, { useTArray: true, formatAsRGBA: true });
  if (img.width !== out.width || img.height !== out.height) throw new Error(`사진 크기가 헤더와 다릅니다(${img.width}×${img.height})`);
  const [cx, cy, cw, ch] = crop;
  const dst = new Uint8Array(out.width * out.height * 4);
  const at = (x: number, y: number) => ((cy + y) * img.width + cx + x) * 4;
  for (let y = 0; y < out.height; y++) {
    const fy = Math.min(ch - 1, Math.max(0, (y + 0.5) * (ch / out.height) - 0.5));
    const y0 = Math.floor(fy), y1 = Math.min(ch - 1, y0 + 1), wy = fy - y0;
    for (let x = 0; x < out.width; x++) {
      const fx = Math.min(cw - 1, Math.max(0, (x + 0.5) * (cw / out.width) - 0.5));
      const x0 = Math.floor(fx), x1 = Math.min(cw - 1, x0 + 1), wx = fx - x0;
      const a = at(x0, y0), b = at(x1, y0), c = at(x0, y1), d = at(x1, y1), o = (y * out.width + x) * 4;
      for (let k = 0; k < 3; k++) {
        const top = img.data[a + k]! + (img.data[b + k]! - img.data[a + k]!) * wx;
        const bottom = img.data[c + k]! + (img.data[d + k]! - img.data[c + k]!) * wx;
        dst[o + k] = Math.round(top + (bottom - top) * wy);
      }
      dst[o + 3] = 255;
    }
  }
  return Buffer.from(jpeg.encode({ data: dst, width: out.width, height: out.height }, quality).data);
}
