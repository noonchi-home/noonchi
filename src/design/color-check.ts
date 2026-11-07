// 색 검사 함수 하나에: WCAG 2.2 대비, 반투명 겹침, 햇빛 반사, CIEDE2000 색 차이, 색약 모의(Machado 2009, 심함 1.0).
// tests/design-contrast.test.ts가 tokens.json contrast 표를 이 함수로 다시 잰다.

export type Rgb = readonly [number, number, number];
type Color = string | Rgb;

/** "#rrggbb" → [r, g, b](0~255). 배열은 그대로. */
export function rgb(c: Color): Rgb {
  if (typeof c !== "string") return c;
  const h = c.replace(/^#/, "");
  if (!/^[0-9a-f]{6}$/i.test(h)) throw new Error(`색 ${c}는 #rrggbb가 아니에요`);
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

const lin = (v: number) => { const c = v / 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
const delin = (v: number) => { const c = Math.min(1, Math.max(0, v)); return 255 * (c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055); };

/** 상대 휘도(WCAG). */
export function luminance(c: Color): number {
  const [r, g, b] = rgb(c).map(lin) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG 대비(1~21). */
export function contrast(a: Color, b: Color): number {
  const [x, y] = [luminance(a), luminance(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

/** 햇빛 반사: 화면 흰색의 glare만큼(0.1 = 10%) 두 휘도에 더한 대비. */
export function glareContrast(a: Color, b: Color, glare: number): number {
  const [x, y] = [luminance(a) + glare, luminance(b) + glare];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

/** fg를 alpha만큼 bg 위에 겹친 색(반올림 없음). */
export function over(fg: Color, alpha: number, bg: Color): Rgb {
  const [f, b] = [rgb(fg), rgb(bg)];
  return [0, 1, 2].map((i) => alpha * f[i]! + (1 - alpha) * b[i]!) as unknown as Rgb;
}

/**
 * 트윈·지도·폰 영상 위 세 겹 표시(가운데 심, 흰 테, 바깥 숯색)의 바탕 대비.
 * 흰 테는 casing을 opacity만큼 바탕 위에 겹친 색이다. 셋 중 가장 큰 값이 3:1을 넘으면 보인다.
 */
export function unitContrast(core: Color, bg: Color, o: { casing: Color; opacity: number; edge: Color }): { core: number; casing: number; edge: number } {
  return { core: contrast(core, bg), casing: contrast(over(o.casing, o.opacity, bg), bg), edge: contrast(o.edge, bg) };
}

/** sRGB → CIE Lab(D65). */
function lab(c: Color): [number, number, number] {
  const [r, g, b] = rgb(c).map(lin) as [number, number, number];
  const x = (0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047;
  const y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  const z = (0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883;
  const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  return [116 * f(y) - 16, 500 * (f(x) - f(y)), 200 * (f(y) - f(z))];
}

const rad = (d: number) => (d * Math.PI) / 180;
const deg = (r: number) => (r * 180) / Math.PI;

/** CIEDE2000 색 차이(Sharma 2005). 10 이상이면 한눈에 다르다. */
export function deltaE2000(a: Color, b: Color): number {
  const [L1, a1, b1] = lab(a);
  const [L2, a2, b2] = lab(b);
  const Cb = (Math.hypot(a1, b1) + Math.hypot(a2, b2)) / 2;
  const G = 0.5 * (1 - Math.sqrt(Cb ** 7 / (Cb ** 7 + 25 ** 7)));
  const [a1p, a2p] = [(1 + G) * a1, (1 + G) * a2];
  const [C1p, C2p] = [Math.hypot(a1p, b1), Math.hypot(a2p, b2)];
  const hue = (bb: number, ap: number) => ((deg(Math.atan2(bb, ap)) % 360) + 360) % 360;
  const [h1p, h2p] = [hue(b1, a1p), hue(b2, a2p)];
  const dLp = L2 - L1;
  const dCp = C2p - C1p;
  let dhp = h2p - h1p;
  if (dhp > 180) dhp -= 360;
  else if (dhp < -180) dhp += 360;
  const dHp = 2 * Math.sqrt(C1p * C2p) * Math.sin(rad(dhp / 2));
  const Lbp = (L1 + L2) / 2;
  const Cbp = (C1p + C2p) / 2;
  const hbp = Math.abs(h1p - h2p) <= 180 ? (h1p + h2p) / 2 : (h1p + h2p + 360) / 2;
  const T = 1 - 0.17 * Math.cos(rad(hbp - 30)) + 0.24 * Math.cos(rad(2 * hbp)) + 0.32 * Math.cos(rad(3 * hbp + 6)) - 0.2 * Math.cos(rad(4 * hbp - 63));
  const dTheta = 30 * Math.exp(-(((hbp - 275) / 25) ** 2));
  const Rc = 2 * Math.sqrt(Cbp ** 7 / (Cbp ** 7 + 25 ** 7));
  const Sl = 1 + (0.015 * (Lbp - 50) ** 2) / Math.sqrt(20 + (Lbp - 50) ** 2);
  const Sc = 1 + 0.045 * Cbp;
  const Sh = 1 + 0.015 * Cbp * T;
  const Rt = -Math.sin(rad(2 * dTheta)) * Rc;
  return Math.sqrt((dLp / Sl) ** 2 + (dCp / Sc) ** 2 + (dHp / Sh) ** 2 + Rt * (dCp / Sc) * (dHp / Sh));
}

/** Machado, Oliveira, Fernandes 2009 색약 모의 행렬(심함 1.0, 선형 RGB). */
const MACHADO = {
  protan: [[0.152286, 1.052583, -0.204868], [0.114503, 0.786281, 0.099216], [-0.003882, -0.048116, 1.051998]],
  deutan: [[0.367322, 0.860646, -0.227968], [0.280085, 0.672501, 0.047413], [-0.01182, 0.04294, 0.968881]],
} as const;

/** 적색맹(protan)·녹색맹(deutan)이 보는 색(0~255, 반올림 없음). */
export function simulate(c: Color, kind: keyof typeof MACHADO): Rgb {
  const l = rgb(c).map(lin);
  const m = MACHADO[kind];
  return m.map((row) => delin(row[0] * l[0]! + row[1] * l[1]! + row[2] * l[2]!)) as unknown as Rgb;
}
