// 바닥 평면 2D 강체 변환(회전 + 이동, 크기 없음): AR 바닥 점 [x, z] → 트윈 평면 [x, y] = R(theta)·p + t.
// src/phone/align.ts Alignment와 같은 뜻이다. 순수 함수만 둔다.
//
// - fitRigid: 가중 점 짝 닫힌 꼴(2D Kabsch).
// - ransacRigid: 점 짝 둘씩 모든 조합으로 가정을 세우고 맞는 짝이 가장 많은 것을 고른 뒤 다시 푼다(결과가 늘 같다).
// - solveTerms: 점-점·점-선·각도 항을 함께 푸는 가우스-뉴턴. 무게는 Cauchy(멀리 벗어난 항일수록 덜 끈다)이고,
//   처음에는 넓게 보고 점점 좁힌다(scale 16 → 2, 반씩). 항이 적어 정해지지 않는 방향(복도 길이 방향)은
//   항들 가운데에서 시작 변환 자리를 아주 약하게 붙잡아 움직이지 않는다.
// - limitStep: 한 번에 움직이는 회전·이동(기준점에서 잰 것)을 묶는다.

export type P2 = [number, number];
export interface Rigid {
  theta: number;
  tx: number;
  ty: number;
}
export interface PointPair {
  from: P2;
  to: P2;
  w?: number;
}

/** 점 from이 점 to에 오게: r = (T·from − to) / sigma (2차원). */
export interface PointTerm { kind: "point"; from: P2; to: P2; sigma: number }
/** 점 from이 at을 지나고 법선이 normal(길이 1)인 선 위에 오게: r = normal·(T·from − at) / sigma. */
export interface LineTerm { kind: "line"; from: P2; at: P2; normal: P2; sigma: number }
/** 회전이 theta가 되게: r = wrap(T.theta − theta) / sigma. */
export interface AngleTerm { kind: "angle"; theta: number; sigma: number }
export type Term = PointTerm | LineTerm | AngleTerm;

export const IDENTITY: Rigid = { theta: 0, tx: 0, ty: 0 };

/** (−π, π]. */
export function wrapAngle(a: number): number {
  const w = Math.atan2(Math.sin(a), Math.cos(a));
  return w === -Math.PI ? Math.PI : w;
}

export function rotateVec(theta: number, [x, y]: P2): P2 {
  const c = Math.cos(theta), s = Math.sin(theta);
  return [x * c - y * s, x * s + y * c];
}

export function applyRigid(T: Rigid, p: P2): P2 {
  const [x, y] = rotateVec(T.theta, p);
  return [x + T.tx, y + T.ty];
}

export function invertRigid(T: Rigid): Rigid {
  const [x, y] = rotateVec(-T.theta, [T.tx, T.ty]);
  return { theta: -T.theta, tx: -x, ty: -y };
}

/** 두 변환의 차이: 회전(도)과 점들에서 잰 가장 큰 이동(m). */
export function rigidGap(a: Rigid, b: Rigid, at: P2[]): { rotDeg: number; shiftM: number } {
  const shiftM = Math.max(0, ...at.map((p) => {
    const pa = applyRigid(a, p), pb = applyRigid(b, p);
    return Math.hypot(pa[0] - pb[0], pa[1] - pb[1]);
  }));
  return { rotDeg: (Math.abs(wrapAngle(a.theta - b.theta)) * 180) / Math.PI, shiftM };
}

/** 가중 점 짝 → 변환. 짝이 둘 미만이거나 점이 모두 한 자리면 null. */
export function fitRigid(pairs: readonly PointPair[]): Rigid | null {
  if (pairs.length < 2) return null;
  let sw = 0, ax = 0, ay = 0, bx = 0, by = 0;
  for (const p of pairs) {
    const w = p.w ?? 1;
    sw += w;
    ax += w * p.from[0];
    ay += w * p.from[1];
    bx += w * p.to[0];
    by += w * p.to[1];
  }
  if (sw <= 0) return null;
  ax /= sw; ay /= sw; bx /= sw; by /= sw;
  let sxx = 0, sxy = 0, spread = 0;
  for (const p of pairs) {
    const w = p.w ?? 1;
    const fx = p.from[0] - ax, fy = p.from[1] - ay, tx = p.to[0] - bx, ty = p.to[1] - by;
    sxx += w * (fx * tx + fy * ty);
    sxy += w * (fx * ty - fy * tx);
    spread += w * (fx * fx + fy * fy);
  }
  if (spread < 1e-12) return null;
  const theta = Math.atan2(sxy, sxx);
  const [rx, ry] = rotateVec(theta, [ax, ay]);
  return { theta, tx: bx - rx, ty: by - ry };
}

export interface RansacResult {
  T: Rigid;
  /** 맞는 짝 번호. */
  inliers: number[];
  /** 맞는 짝의 거리 RMS(m). */
  rmsM: number;
}

const residual = (T: Rigid, p: PointPair) => {
  const q = applyRigid(T, p.from);
  return Math.hypot(q[0] - p.to[0], q[1] - p.to[1]);
};

/** 점 짝 RANSAC. 두 점 거리가 minSpanM보다 짧거나 AR·트윈 거리 차이가 2·inlierM을 넘는 조합은 가정으로 쓰지 않는다. 가정이 없으면 null. */
export function ransacRigid(pairs: readonly PointPair[], opts: { inlierM: number; minSpanM?: number }): RansacResult | null {
  const minSpan = opts.minSpanM ?? 0.5;
  let best: { inliers: number[]; cost: number } | null = null;
  for (let i = 0; i < pairs.length; i++) {
    for (let j = i + 1; j < pairs.length; j++) {
      const a = pairs[i]!, b = pairs[j]!;
      const df = Math.hypot(b.from[0] - a.from[0], b.from[1] - a.from[1]);
      const dt = Math.hypot(b.to[0] - a.to[0], b.to[1] - a.to[1]);
      if (df < minSpan || dt < minSpan || Math.abs(df - dt) > 2 * opts.inlierM) continue;
      const T = fitRigid([a, b]);
      if (!T) continue;
      const inliers: number[] = [];
      let cost = 0;
      pairs.forEach((p, k) => {
        const r = residual(T, p);
        if (r <= opts.inlierM) {
          inliers.push(k);
          cost += r * r;
        }
      });
      if (!best || inliers.length > best.inliers.length || (inliers.length === best.inliers.length && cost < best.cost)) best = { inliers, cost };
    }
  }
  if (!best) return null;
  const T = fitRigid(best.inliers.map((k) => pairs[k]!))!;
  const inliers = pairs.map((p, k) => (residual(T, p) <= opts.inlierM ? k : -1)).filter((k) => k >= 0);
  const final = inliers.length >= 2 ? fitRigid(inliers.map((k) => pairs[k]!)) ?? T : T;
  const rms = Math.sqrt(inliers.reduce((s, k) => s + residual(final, pairs[k]!) ** 2, 0) / Math.max(1, inliers.length));
  return { T: final, inliers, rmsM: rms };
}

export interface SolveOptions {
  /** 바깥 반복 수(기본 12). */
  iterations?: number;
  /** Cauchy 무게의 마지막 폭(시그마 단위, 기본 2). 처음 폭은 16이고 반복마다 반씩 줄인다. */
  scale?: number;
  /** 정해지지 않는 방향을 붙잡는 힘: 항들 가운데 자리 시그마(m)·회전 시그마(rad). 기본 20m·1rad. */
  stayM?: number;
  stayRad?: number;
}

export interface SolveResult {
  T: Rigid;
  /** 마지막 무게로 잰 항마다 정규화 잔차(시그마 단위). 각도 항 포함, 붙잡는 항은 뺀다. */
  residuals: number[];
}

/** 3×3 대칭 연립방정식. 특이하면 null. */
function solve3(A: number[], b: number[]): number[] | null {
  const m = [[A[0]!, A[1]!, A[2]!, b[0]!], [A[3]!, A[4]!, A[5]!, b[1]!], [A[6]!, A[7]!, A[8]!, b[2]!]];
  for (let c = 0; c < 3; c++) {
    let p = c;
    for (let r = c + 1; r < 3; r++) if (Math.abs(m[r]![c]!) > Math.abs(m[p]![c]!)) p = r;
    if (Math.abs(m[p]![c]!) < 1e-15) return null;
    [m[c], m[p]] = [m[p]!, m[c]!];
    for (let r = 0; r < 3; r++) {
      if (r === c) continue;
      const f = m[r]![c]! / m[c]![c]!;
      for (let k = c; k < 4; k++) m[r]![k]! -= f * m[c]![k]!;
    }
  }
  return [m[0]![3]! / m[0]![0]!, m[1]![3]! / m[1]![1]!, m[2]![3]! / m[2]![2]!];
}

/** 한 항의 잔차와 야코비안 줄(theta, tx, ty). */
function rows(T: Rigid, t: Term): { r: number[]; J: number[][] } {
  if (t.kind === "angle") return { r: [wrapAngle(T.theta - t.theta) / t.sigma], J: [[1 / t.sigma, 0, 0]] };
  const [rx, ry] = rotateVec(T.theta, t.from);
  const p: P2 = [rx + T.tx, ry + T.ty];
  const d: P2 = [-ry, rx]; // dp/dtheta
  if (t.kind === "point") {
    const s = 1 / t.sigma;
    return { r: [(p[0] - t.to[0]) * s, (p[1] - t.to[1]) * s], J: [[d[0] * s, s, 0], [d[1] * s, 0, s]] };
  }
  const s = 1 / t.sigma;
  const [nx, ny] = t.normal;
  return { r: [(nx * (p[0] - t.at[0]) + ny * (p[1] - t.at[1])) * s], J: [[(nx * d[0] + ny * d[1]) * s, nx * s, ny * s]] };
}

/** 점-점·점-선·각도 항을 함께 푼다(T0에서 시작). 항이 없으면 T0. */
export function solveTerms(T0: Rigid, terms: readonly Term[], opts: SolveOptions = {}): SolveResult {
  const iterations = opts.iterations ?? 12;
  const last = opts.scale ?? 2;
  const froms = terms.flatMap((t) => (t.kind === "angle" ? [] : [t.from]));
  const center: P2 = froms.length ? [froms.reduce((s, p) => s + p[0], 0) / froms.length, froms.reduce((s, p) => s + p[1], 0) / froms.length] : [0, 0];
  const stay: Term[] = [
    { kind: "point", from: center, to: applyRigid(T0, center), sigma: opts.stayM ?? 20 },
    { kind: "angle", theta: T0.theta, sigma: opts.stayRad ?? 1 },
  ];
  let T = { ...T0 };
  let scale = Math.max(16, last);
  for (let it = 0; it < iterations; it++) {
    const A = new Array<number>(9).fill(0), g = [0, 0, 0];
    for (const [k, t] of [...terms, ...stay].entries()) {
      const { r, J } = rows(T, t);
      const norm = Math.hypot(...r);
      // 붙잡는 항은 늘 무게 1, 나머지는 Cauchy
      const w = k >= terms.length ? 1 : 1 / (1 + (norm / scale) ** 2);
      for (let i = 0; i < r.length; i++) {
        const j = J[i]!;
        for (let a = 0; a < 3; a++) {
          g[a]! += w * j[a]! * r[i]!;
          for (let b = 0; b < 3; b++) A[a * 3 + b]! += w * j[a]! * j[b]!;
        }
      }
    }
    const step = solve3(A, g.map((v) => -v));
    if (!step) break;
    T = { theta: wrapAngle(T.theta + step[0]!), tx: T.tx + step[1]!, ty: T.ty + step[2]! };
    const small = Math.abs(step[0]!) < 1e-7 && Math.hypot(step[1]!, step[2]!) < 1e-6;
    if (small && scale <= last) break;
    scale = Math.max(last, scale / 2);
  }
  return { T, residuals: terms.map((t) => Math.hypot(...rows(T, t).r)) };
}

/** from → to로 가되 회전은 maxRotDeg, 기준점 at의 이동은 maxShiftM까지만. 넘으면 그만큼만 간다(clamped). */
export function limitStep(from: Rigid, to: Rigid, opts: { maxShiftM: number; maxRotDeg: number; at: P2 }): { T: Rigid; clamped: boolean } {
  const dTheta = wrapAngle(to.theta - from.theta);
  const pf = applyRigid(from, opts.at), pt = applyRigid(to, opts.at);
  const shift = Math.hypot(pt[0] - pf[0], pt[1] - pf[1]);
  const rotDeg = (Math.abs(dTheta) * 180) / Math.PI;
  const f = Math.min(1, rotDeg > 1e-9 ? opts.maxRotDeg / rotDeg : 1, shift > 1e-9 ? opts.maxShiftM / shift : 1);
  if (f >= 1) return { T: { ...to }, clamped: false };
  const theta = wrapAngle(from.theta + f * dTheta);
  const target: P2 = [pf[0] + f * (pt[0] - pf[0]), pf[1] + f * (pt[1] - pf[1])];
  const [rx, ry] = rotateVec(theta, opts.at);
  return { T: { theta, tx: target[0] - rx, ty: target[1] - ry }, clamped: true };
}
