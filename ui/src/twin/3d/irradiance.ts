// 하늘 사진(등장방형 HDR, RGBA 4칸)의 방향별 조도와 반구광 색.
export type V3 = [number, number, number];

type Dir = "up" | "down" | "px" | "nx" | "pz" | "nz";
const DIRS: Record<Dir, V3> = { up: [0, 1, 0], down: [0, -1, 0], px: [1, 0, 0], nx: [-1, 0, 0], pz: [0, 0, 1], nz: [0, 0, -1] };

/** 방향별 조도(코사인 가중): 위, 아래, 수평 4방향 평균. */
export function irradiance(img: { data: ArrayLike<number>; width: number; height: number }): { up: V3; down: V3; horiz: V3 } {
  const { data: px, width: w, height: h } = img;
  const acc = Object.fromEntries((Object.keys(DIRS) as Dir[]).map((k) => [k, [0, 0, 0]])) as Record<Dir, V3>;
  for (let j = 0; j < h; j++) {
    const lat = Math.PI / 2 - (Math.PI * (j + 0.5)) / h;
    const dw = Math.cos(lat) * ((2 * Math.PI) / w) * (Math.PI / h);
    for (let i = 0; i < w; i++) {
      const phi = ((i + 0.5) / w) * 2 * Math.PI - Math.PI;
      const d: V3 = [Math.cos(lat) * Math.cos(phi), Math.sin(lat), Math.cos(lat) * Math.sin(phi)];
      const k = (j * w + i) * 4;
      for (const name of Object.keys(DIRS) as Dir[]) {
        const n = DIRS[name];
        const c = Math.max(0, n[0] * d[0] + n[1] * d[1] + n[2] * d[2]) * dw;
        if (c > 0) for (let ch = 0; ch < 3; ch++) acc[name][ch] += px[k + ch] * c;
      }
    }
  }
  const horiz = [0, 1, 2].map((ch) => (acc.px[ch] + acc.nx[ch] + acc.pz[ch] + acc.nz[ch]) / 4) as V3;
  return { up: acc.up, down: acc.down, horiz };
}

/** 반구광: 하늘 = 위 × 세기, 아래 = (2·수평 − 위) × 세기(음수면 0). 반구광은 수평 면에 (위 + 아래) / 2를 준다. */
export function hemisphere(irr: { up: V3; down: V3; horiz: V3 }, envK: number): { sky: V3; ground: V3 } {
  const k = (v: number) => Math.round(v * envK * 1e4) / 1e4;
  return { sky: irr.up.map(k) as V3, ground: irr.horiz.map((h, i) => k(Math.max(0, 2 * h - irr.up[i]!))) as V3 };
}
