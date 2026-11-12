// YOLO26-seg 출력 풀기: 감지 하나의 마스크 계수 32개와 프로토 [32, 160, 160]으로 그 물체 모양(0/1 그림)을 만들고,
// 모양의 바깥 테두리 상자와 바닥 점을 원본 사진 픽셀로 낸다. 프로토 한 칸은 640 레터박스의 4px이다.
// 모양은 Ultralytics처럼 모델 상자 안에서만 본다(상자로 자름). 화면에는 Mask를 그대로 보낸다(비트는 base64).

export type Box = [number, number, number, number];
export interface Size { width: number; height: number }
/** 레터박스 자리: 원본 픽셀 = (레터박스 픽셀 − pad) / ratio. */
export interface LetterboxPlace { ratio: number; padX: number; padY: number }

/** 물체 모양: 프로토 격자(160×160, 레터박스 4px = 1칸)에서 그 물체 상자만 잘라 낸 0/1 그림. */
export interface Mask {
  /** 원본 사진 픽셀에서 이 그림이 덮는 자리 [x, y, w, h]. 사진 밖으로 나갈 수 있다(자르지 않음). */
  at: Box;
  /** 그림 크기(칸). 모양을 못 만든 감지는 0. */
  cols: number;
  rows: number;
  /** 줄 순서 비트(1 = 물체, 바이트 안에서는 높은 비트부터), base64. 길이 ceil(cols*rows/8). */
  bits: string;
}

/** 프로토 한 변(칸), 한 칸의 레터박스 픽셀, 마스크 계수 수. */
export const PROTO = 160, STRIDE = 4, COEFFS = 32;
/** 1인 칸이 이보다 적으면 모양으로 보지 않는다. */
const MIN_CELLS = 4;

function pack(cells: Uint8Array): string {
  const bytes = Buffer.alloc(Math.ceil(cells.length / 8));
  for (let i = 0; i < cells.length; i++) if (cells[i]) bytes[i >> 3]! |= 0x80 >> (i & 7);
  return bytes.toString("base64");
}

/** 비트 풀기: 칸마다 0·1(줄 순서, cols × rows). */
export function maskCells(m: Mask): Uint8Array {
  const bytes = Buffer.from(m.bits, "base64");
  const cells = new Uint8Array(m.cols * m.rows);
  for (let i = 0; i < cells.length; i++) cells[i] = (bytes[i >> 3]! >> (7 - (i & 7))) & 1;
  return cells;
}

/** 상자를 한 칸으로 꽉 채운 모양(시험 대역이 쓴다). */
export const fullMask = (box: Box): Mask => ({ at: [box[0], box[1], box[2], box[3]], cols: 1, rows: 1, bits: pack(Uint8Array.of(1)) });
/** 모양 없음(1인 칸이 4칸 미만이었던 감지). */
export const emptyMask = (box: Box): Mask => ({ at: [box[0], box[1], box[2], box[3]], cols: 0, rows: 0, bits: "" });
/** 상자 아랫변 가운데. */
export const boxFoot = (box: Box): [number, number] => [box[0] + box[2] / 2, box[1] + box[3]];

/** 감지 하나의 모양. coeffs 32개 · protos [32, 160, 160] · lbBox 레터박스 픽셀 [x, y, w, h](자르기 전 모델 상자).
 *  box는 1인 칸의 바깥 테두리(원본 픽셀, 사진 끝에서 자름), foot은 가장 아래 1인 줄의 x 가운데와 그 줄 아래 끝. 1인 칸이 4칸 미만이면 null. */
export function maskOf(coeffs: Float32Array, protos: Float32Array, lbBox: Box, lb: LetterboxPlace, image: Size): { mask: Mask; box: Box; foot: [number, number] } | null {
  // 상자를 프로토 칸으로(바깥으로 반올림), 격자 안으로 자름
  const c0 = Math.max(0, Math.floor(lbBox[0] / STRIDE)), r0 = Math.max(0, Math.floor(lbBox[1] / STRIDE));
  const c1 = Math.min(PROTO, Math.ceil((lbBox[0] + lbBox[2]) / STRIDE)), r1 = Math.min(PROTO, Math.ceil((lbBox[1] + lbBox[3]) / STRIDE));
  const cols = c1 - c0, rows = r1 - r0;
  if (cols <= 0 || rows <= 0) return null;
  // 칸 → 원본 픽셀
  const px = (c: number) => (c * STRIDE - lb.padX) / lb.ratio, py = (r: number) => (r * STRIDE - lb.padY) / lb.ratio;
  // 0이 아닌 계수만 곱한다
  const used: number[] = [];
  for (let k = 0; k < COEFFS; k++) if (coeffs[k] !== 0) used.push(k);
  const plane = PROTO * PROTO;
  const cells = new Uint8Array(cols * rows);
  let n = 0, minC = cols, maxC = -1, minR = rows, maxR = -1;
  for (let r = 0; r < rows; r++) {
    // 가운데가 사진 밖(레터박스 채움)인 칸은 물체가 아니다
    const y = py(r + r0 + 0.5);
    if (y < 0 || y >= image.height) continue;
    for (let c = 0; c < cols; c++) {
      const x = px(c + c0 + 0.5);
      if (x < 0 || x >= image.width) continue;
      const p = (r + r0) * PROTO + (c + c0);
      let v = 0;
      for (const k of used) v += coeffs[k]! * protos[k * plane + p]!;
      if (v <= 0) continue; // sigmoid(v) > 0.5
      cells[r * cols + c] = 1;
      n++;
      if (c < minC) minC = c;
      if (c > maxC) maxC = c;
      if (r < minR) minR = r;
      if (r > maxR) maxR = r;
    }
  }
  if (n < MIN_CELLS) return null;
  const clipX = (v: number) => Math.min(image.width, Math.max(0, v)), clipY = (v: number) => Math.min(image.height, Math.max(0, v));
  const x1 = clipX(px(c0 + minC)), x2 = clipX(px(c0 + maxC + 1));
  const y1 = clipY(py(r0 + minR)), y2 = clipY(py(r0 + maxR + 1));
  // 바닥 점: 가장 아래 1인 줄에서 1인 칸의 왼쪽 끝과 오른쪽 끝 사이 가운데
  let left = cols, right = -1;
  for (let c = 0; c < cols; c++) if (cells[maxR * cols + c]) { if (c < left) left = c; right = c; }
  return {
    mask: { at: [px(c0), py(r0), (cols * STRIDE) / lb.ratio, (rows * STRIDE) / lb.ratio], cols, rows, bits: pack(cells) },
    box: [x1, y1, x2 - x1, y2 - y1],
    foot: [clipX(px(c0 + (left + right + 1) / 2)), y2],
  };
}
