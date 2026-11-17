// 시험용 물체 모양(YOLO 세그 마스크 모양, src/contract/observe.ts Mask): 사진 위 돌린 네모를 2px 칸으로 칠한다.
// 중력 좌표(옆 s·위 u, 폰을 phi만큼 돌려 든 사진)로 놓은 물건을 사진 픽셀로 옮겨 만든다.
import type { Detection, Mask } from "../../src/contract/observe.js";

type Pt = [number, number];
const CELL = 2;

function pack(cells: Uint8Array): string {
  const bytes = Buffer.alloc(Math.ceil(cells.length / 8));
  for (let i = 0; i < cells.length; i++) if (cells[i]) bytes[i >> 3]! |= 0x80 >> (i & 7);
  return bytes.toString("base64");
}

/** 사진 위 돌린 네모(가운데 c, 긴 축 단위 벡터 a, 길이 len, 폭 wid)의 마스크와 그 바깥 상자. */
export function rectMask(c: Pt, a: Pt, len: number, wid: number): { mask: Mask; box: Detection["box"] } {
  const b: Pt = [-a[1], a[0]];
  const hx = (Math.abs(a[0]) * len + Math.abs(b[0]) * wid) / 2, hy = (Math.abs(a[1]) * len + Math.abs(b[1]) * wid) / 2;
  const x0 = c[0] - hx, y0 = c[1] - hy;
  const cols = Math.max(1, Math.ceil((2 * hx) / CELL)), rows = Math.max(1, Math.ceil((2 * hy) / CELL));
  const cells = new Uint8Array(cols * rows);
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (let r = 0; r < rows; r++) {
    for (let k = 0; k < cols; k++) {
      const p: Pt = [x0 + (k + 0.5) * CELL - c[0], y0 + (r + 0.5) * CELL - c[1]];
      if (Math.abs(p[0] * a[0] + p[1] * a[1]) > len / 2 || Math.abs(p[0] * b[0] + p[1] * b[1]) > wid / 2) continue;
      cells[r * cols + k] = 1;
      minX = Math.min(minX, x0 + k * CELL); maxX = Math.max(maxX, x0 + (k + 1) * CELL);
      minY = Math.min(minY, y0 + r * CELL); maxY = Math.max(maxY, y0 + (r + 1) * CELL);
    }
  }
  return { mask: { at: [x0, y0, cols * CELL, rows * CELL], cols, rows, bits: pack(cells) }, box: [minX, minY, maxX - minX, maxY - minY] };
}

/** 폰을 phi(°)만큼 돌려 든 사진: 중력 좌표(옆 s, 위 u, 사진 가운데 둘레)를 사진 픽셀로. down은 그 사진에 비친 중력 아래 방향. */
export function tilted(phiDeg: number, center: Pt = [240, 180]) {
  const f = (phiDeg * Math.PI) / 180;
  const down: Pt = [Math.sin(f), Math.cos(f)];
  const up: Pt = [-down[0], -down[1]];
  const side: Pt = [Math.cos(f), -Math.sin(f)];
  const px = (s: number, u: number): Pt => [center[0] + s * side[0] + u * up[0], center[1] + s * side[1] + u * up[1]];
  /** 중력 좌표의 가운데(s, u)에 긴 축이 수직에서 alpha(°)만큼 기운 네모. */
  const thing = (s: number, u: number, len: number, wid: number, alphaDeg: number) => {
    const al = (alphaDeg * Math.PI) / 180;
    const a: Pt = [Math.sin(al) * side[0] + Math.cos(al) * up[0], Math.sin(al) * side[1] + Math.cos(al) * up[1]];
    return { ...rectMask(px(s, u), a, len, wid), center: px(s, u) };
  };
  return { down, px, thing };
}
