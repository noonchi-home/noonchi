// 바닥 평면 2D 강체 변환(회전 + 이동, 크기 없음) 풀이: 점 짝 닫힌 꼴, RANSAC, 점-점·점-선 가우스-뉴턴, 한 걸음 묶기.
import { describe, expect, it } from "vitest";
import {
  applyRigid, fitRigid, limitStep, ransacRigid, rigidGap, solveTerms, wrapAngle, type P2, type Rigid, type Term,
} from "../src/phone/sync/rigid.js";

const deg = (d: number) => (d * Math.PI) / 180;
const TRUE: Rigid = { theta: deg(37), tx: 4.2, ty: -1.3 };
/** 같은 씨앗이면 같은 수열(시험을 늘 같게). */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}
const gauss = (r: () => number) => Math.sqrt(-2 * Math.log(r() + 1e-12)) * Math.cos(2 * Math.PI * r());
const inv = (T: Rigid): Rigid => {
  const c = Math.cos(-T.theta), s = Math.sin(-T.theta);
  return { theta: -T.theta, tx: -(c * T.tx - s * T.ty), ty: -(s * T.tx + c * T.ty) };
};

describe("fitRigid", () => {
  it("잡음 없는 점 짝이면 정확히 돌려준다", () => {
    const from: P2[] = [[0, 0], [3, 1], [-2, 4], [5, -3]];
    const T = fitRigid(from.map((p) => ({ from: p, to: applyRigid(TRUE, p) })))!;
    expect(T.theta).toBeCloseTo(TRUE.theta, 9);
    expect(T.tx).toBeCloseTo(TRUE.tx, 9);
    expect(T.ty).toBeCloseTo(TRUE.ty, 9);
  });

  it("점 하나뿐이거나 모두 같은 자리면 null", () => {
    expect(fitRigid([{ from: [1, 1], to: [2, 2] }])).toBeNull();
    expect(fitRigid([{ from: [1, 1], to: [2, 2] }, { from: [1, 1], to: [2, 2] }])).toBeNull();
  });

  it("무게가 큰 짝을 더 따른다", () => {
    const pairs = [
      { from: [0, 0] as P2, to: [0, 0] as P2, w: 100 },
      { from: [4, 0] as P2, to: [4, 0] as P2, w: 100 },
      { from: [0, 4] as P2, to: [0.5, 4] as P2, w: 1 },
    ];
    const T = fitRigid(pairs)!;
    expect(Math.abs(T.theta)).toBeLessThan(deg(0.5));
  });
});

describe("ransacRigid", () => {
  it("짝 30%가 틀려도 맞는 짝만 골라 2cm 안으로 푼다", () => {
    const r = rng(7);
    const pairs = Array.from({ length: 20 }, (_, i) => {
      const from: P2 = [r() * 10 - 5, r() * 8 - 4];
      const to = applyRigid(TRUE, from);
      const bad = i % 10 < 3;
      return { from, to: (bad ? [to[0] + 2 + r() * 3, to[1] - 2 - r() * 2] : [to[0] + 0.01 * gauss(r), to[1] + 0.01 * gauss(r)]) as P2 };
    });
    const out = ransacRigid(pairs, { inlierM: 0.2 })!;
    expect(out.inliers.length).toBe(14);
    expect(rigidGap(out.T, TRUE, [[0, 0], [5, 4], [-5, -4]]).shiftM).toBeLessThan(0.02);
  });

  it("두 점 사이 거리가 AR과 트윈에서 다르면 그 짝으로 가정을 세우지 않는다", () => {
    const pairs = [{ from: [0, 0] as P2, to: [0, 0] as P2 }, { from: [3, 0] as P2, to: [5, 0] as P2 }];
    expect(ransacRigid(pairs, { inlierM: 0.3 })).toBeNull();
  });
});

describe("solveTerms", () => {
  /** 네모 방 4×3 벽(안쪽 법선)에 맞을 AR 점: 정답 변환의 역으로 옮긴 벽 위 점. */
  const room = (n: number, noise: number, seed: number): Term[] => {
    const r = rng(seed);
    const walls: { a: P2; b: P2; n: P2 }[] = [
      { a: [0, 0], b: [4, 0], n: [0, 1] }, { a: [4, 0], b: [4, 3], n: [-1, 0] }, { a: [4, 3], b: [0, 3], n: [0, -1] }, { a: [0, 3], b: [0, 0], n: [1, 0] },
    ];
    const back = inv(TRUE);
    return Array.from({ length: n }, (_, i) => {
      const w = walls[i % 4]!;
      const s = r();
      const p: P2 = [w.a[0] + (w.b[0] - w.a[0]) * s + w.n[0] * noise * gauss(r), w.a[1] + (w.b[1] - w.a[1]) * s + w.n[1] * noise * gauss(r)];
      return { kind: "line", from: applyRigid(back, p), at: w.a, normal: w.n, sigma: 0.05 } satisfies Term;
    });
  };

  it("점-선 항만으로 0.4m·12° 어긋난 시작에서 정답으로 간다", () => {
    const start: Rigid = { theta: TRUE.theta + deg(12), tx: TRUE.tx + 0.3, ty: TRUE.ty - 0.25 };
    const { T } = solveTerms(start, room(80, 0.01, 3), { iterations: 20 });
    const gap = rigidGap(T, TRUE, [[0, 0], [4, 3]]);
    expect(gap.shiftM).toBeLessThan(0.01);
    expect(gap.rotDeg).toBeLessThan(0.2);
  });

  it("복도(한 방향 벽)에서는 벽 길이 방향으로 움직이지 않는다", () => {
    const back = inv(TRUE);
    const terms: Term[] = Array.from({ length: 40 }, (_, i) => {
      const y = i % 2 ? 2 : 0;
      const p: P2 = [(i / 40) * 8, y];
      return { kind: "line", from: applyRigid(back, p), at: [0, y], normal: [0, y ? -1 : 1], sigma: 0.05 };
    });
    // 시작: 길이 방향(x)으로 0.5m, 수직(y)으로 0.2m, 3° 어긋남
    const start: Rigid = { theta: TRUE.theta + deg(3), tx: TRUE.tx + 0.5, ty: TRUE.ty + 0.2 };
    const { T } = solveTerms(start, terms, { iterations: 20 });
    const probe: P2 = applyRigid(back, [4, 1]);
    const got = applyRigid(T, probe), was = applyRigid(start, probe);
    expect(Math.abs(got[1] - 1)).toBeLessThan(0.01); // 수직은 맞는다
    expect(Math.abs(wrapAngle(T.theta - TRUE.theta))).toBeLessThan(deg(0.1));
    expect(Math.abs(got[0] - was[0])).toBeLessThan(0.05); // 길이 방향은 시작 그대로
  });

  it("Huber로 먼 이상치 몇 개에 끌려가지 않는다", () => {
    const terms = room(80, 0.01, 5);
    const back = inv(TRUE);
    for (let i = 0; i < 8; i++) terms.push({ kind: "line", from: applyRigid(back, [1 + i * 0.3, 0.6]), at: [0, 0], normal: [0, 1], sigma: 0.05 });
    const { T } = solveTerms(TRUE, terms, { iterations: 20 });
    expect(rigidGap(T, TRUE, [[0, 0], [4, 3]]).shiftM).toBeLessThan(0.03);
  });

  it("점-점과 점-선 항을 함께 푼다", () => {
    const back = inv(TRUE);
    const terms: Term[] = [
      ...room(40, 0.005, 9),
      { kind: "point", from: applyRigid(back, [1, 1]), to: [1, 1], sigma: 0.2 },
    ];
    const { T } = solveTerms({ ...TRUE, tx: TRUE.tx + 0.2 }, terms);
    expect(rigidGap(T, TRUE, [[0, 0], [4, 3]]).shiftM).toBeLessThan(0.01);
  });
});

describe("limitStep", () => {
  it("한 번에 움직이는 양을 묶는다(기준점에서 잰 이동, 회전)", () => {
    const from: Rigid = { theta: 0, tx: 0, ty: 0 };
    const to: Rigid = { theta: deg(20), tx: 2, ty: 0 };
    const out = limitStep(from, to, { maxShiftM: 0.3, maxRotDeg: 5, at: [0, 0] });
    const gap = rigidGap(from, out.T, [[0, 0]]);
    expect(out.clamped).toBe(true);
    expect(gap.rotDeg).toBeLessThanOrEqual(5.0001);
    expect(gap.shiftM).toBeLessThanOrEqual(0.3001);
    expect(limitStep(from, { theta: deg(1), tx: 0.1, ty: 0 }, { maxShiftM: 0.3, maxRotDeg: 5, at: [0, 0] }).clamped).toBe(false);
  });
});
