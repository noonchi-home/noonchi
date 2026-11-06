// 캡처 한 장의 통계: 집 마스크 안 픽셀의 밝기 분포·채도·차지 비율. 레퍼런스 분석 4.5절과 같은 잣대.
export interface ShotStats {
  p5: number; p50: number; p95: number; std: number;
  dark: number; bright: number; clipped: number; saturation: number;
  houseFrac: number;
  bbox: { x0: number; y0: number; x1: number; y1: number } | null;
  bboxFill: { w: number; h: number };
}
type Px = Uint8Array | Uint8ClampedArray;

/** 3D 마스크: 캔버스 크기 비트(위 행부터, 1픽셀 1비트 base64)와 사진 안 캔버스 자리(CSS px, 배율 1). */
export interface MaskBits { width: number; height: number; bits: string; left?: number; top?: number }

/** 캔버스 마스크를 사진 크기로 펼친다. 캔버스 밖(위 막대 등)은 0. */
export function maskFromBits(m: MaskBits, width: number, height: number): Uint8Array {
  const left = Math.round(m.left ?? 0), top = Math.round(m.top ?? 0);
  if (left < 0 || top < 0 || left + m.width > width || top + m.height > height) {
    throw new Error(`마스크 ${m.width}×${m.height}(자리 ${left},${top})가 사진 ${width}×${height}를 벗어나요`);
  }
  const bits = Buffer.from(m.bits, "base64");
  const mask = new Uint8Array(width * height);
  for (let y = 0; y < m.height; y++) for (let x = 0; x < m.width; x++) {
    const i = y * m.width + x;
    mask[(top + y) * width + left + x] = (bits[i >> 3]! >> (i & 7)) & 1;
  }
  return mask;
}

/** 배경색과 다른 픽셀 = 집(시험·참고용. 실제 캡처는 3D 마스크를 쓴다). */
export function maskFromBg(px: Px, width: number, height: number, bg: [number, number, number], tol = 12): Uint8Array {
  const m = new Uint8Array(width * height);
  for (let i = 0; i < width * height; i++) m[i] = Math.max(Math.abs(px[i * 4]! - bg[0]), Math.abs(px[i * 4 + 1]! - bg[1]), Math.abs(px[i * 4 + 2]! - bg[2])) > tol ? 1 : 0;
  return m;
}

export function shotStats(px: Px, width: number, height: number, mask: Uint8Array): ShotStats {
  const lum: number[] = [];
  let sat = 0;
  let x0 = width, y0 = height, x1 = -1, y1 = -1;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    if (!mask[y * width + x]) continue;
    const i = (y * width + x) * 4;
    const r = px[i]!, g = px[i + 1]!, b = px[i + 2]!;
    lum.push(Math.round(0.2126 * r + 0.7152 * g + 0.0722 * b));
    const mx = Math.max(r, g, b);
    sat += mx === 0 ? 0 : (mx - Math.min(r, g, b)) / mx;
    x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y);
  }
  const n = lum.length;
  if (!n) return { p5: 0, p50: 0, p95: 0, std: 0, dark: 0, bright: 0, clipped: 0, saturation: 0, houseFrac: 0, bbox: null, bboxFill: { w: 0, h: 0 } };
  const sorted = [...lum].sort((a, b) => a - b);
  const q = (p: number) => sorted[Math.min(n - 1, Math.floor(p * (n - 1)))]!;
  const mean = lum.reduce((a, b) => a + b, 0) / n;
  const std = Math.sqrt(lum.reduce((a, v) => a + (v - mean) ** 2, 0) / n);
  const frac = (f: (v: number) => boolean) => lum.filter(f).length / n;
  return {
    p5: q(0.05), p50: q(0.5), p95: q(0.95), std: Math.round(std * 10) / 10,
    dark: frac((v) => v < 60), bright: frac((v) => v > 220), clipped: frac((v) => v >= 250),
    saturation: Math.round((sat / n) * 1000) / 1000,
    houseFrac: n / (width * height),
    bbox: { x0, y0, x1, y1 },
    bboxFill: { w: (x1 - x0 + 1) / width, h: (y1 - y0 + 1) / height },
  };
}

/** 점마다 둘레 (2r+1)² 픽셀 평균 색. */
export function sampleColors(px: Px, width: number, points: [number, number][], r = 1): [number, number, number][] {
  const height = px.length / 4 / width;
  return points.map(([cx, cy]) => {
    const acc = [0, 0, 0]; let n = 0;
    for (let y = Math.max(0, cy - r); y <= Math.min(height - 1, cy + r); y++) for (let x = Math.max(0, cx - r); x <= Math.min(width - 1, cx + r); x++) {
      const i = (y * width + x) * 4; acc[0] += px[i]!; acc[1] += px[i + 1]!; acc[2] += px[i + 2]!; n++;
    }
    return acc.map((v) => Math.round(v / n)) as [number, number, number];
  });
}
