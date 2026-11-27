// 「FSM 바뀜」 칸 그림 자리(순수 함수): 상태 원 자리, 화살표 모양과 칩 자리.
// 어느 상태로든 가는 화살표(to "*", 묻기·컵 치우기)는 「자리에 없음」 원으로 그린다(사용자 확정 2026-11-27, 코드의 "*"는 어느 상태로든이다).
// 원·고리·칩 자리가 칸 안에 들도록 타원 반지름에서 고리 몫과 칩 높이를 뺀다.

export const ANY = "*";
export const AWAY = "away";
export interface Spot { id: string; x: number; y: number; r: number }
export interface Bend { key: string; path: string; label: [number, number] }

type P = [number, number];
const add = (a: P, b: P): P => [a[0] + b[0], a[1] + b[1]];
const sub = (a: P, b: P): P => [a[0] - b[0], a[1] - b[1]];
const mul = (a: P, k: number): P => [a[0] * k, a[1] * k];
const unit = (a: P): P => { const l = Math.hypot(a[0], a[1]); return l ? [a[0] / l, a[1] / l] : [0, -1]; };
const rot = (a: P, t: number): P => [a[0] * Math.cos(t) - a[1] * Math.sin(t), a[0] * Math.sin(t) + a[1] * Math.cos(t)];
const f = (n: number) => Number(n.toFixed(1));
const pt = (p: P) => `${f(p[0])} ${f(p[1])}`;

/** 칩 줄(세로로 쌓인 Status) 높이의 절반(px): 칩 자리가 칸 위아래에서 이만큼 떨어진다. */
export const CHIP_HALF = 26;
/** 같은 쌍 화살표가 휘는 폭(px, 한 칸). */
const BEND = 72;
/** 화살촉 길이(px)·벌어진 각(rad). */
const HEAD = 12, HEAD_T = 0.45;
/** 제자리 고리 조절점 거리(원 반지름 배수): lane마다 0.5씩 멀어진다. */
const loopReach = (lane: number) => 2 + 0.5 * lane;

/** 화살표 끝 상태: 어느 상태로든(*)은 자리에 없음 원. */
export const endOf = (to: string) => (to === ANY ? AWAY : to);

/** 상태 원 자리: 기억 차례로 타원 위 12시부터 시계 방향. loops는 한 원에 붙는 제자리 고리 수의 상한(자리를 그만큼 비운다). */
export function spotsOf(states: readonly string[], box: { width: number; height: number }, loops = 2): Spot[] {
  const r = Math.min(72, Math.max(44, Math.min(box.width, box.height) / 12));
  const reach = Math.max(1, r * loopReach(Math.max(0, loops - 1)));
  const rx = Math.max(0, box.width / 2 - reach - 24);
  const ry = Math.max(0, box.height / 2 - reach - 24 - CHIP_HALF);
  const n = states.length;
  return states.map((id, i) => {
    const t = -Math.PI / 2 + (2 * Math.PI * i) / Math.max(1, n);
    return { id, r, x: box.width / 2 + (n > 1 ? rx * Math.cos(t) : 0), y: box.height / 2 + (n > 1 ? ry * Math.sin(t) : 0) };
  });
}

/** 같은 (출발, 도착) 쌍 안 차례(0부터, 0은 곧은 선). 반대 방향 화살표가 있는 쌍은 1부터라 두 방향이 서로 다른 쪽으로 휜다. */
export function lanesOf(edges: readonly { from: string; to: string }[]): number[] {
  const seen = new Map<string, number>();
  const pair = (a: string, b: string) => JSON.stringify([a, b]);
  const both = new Set(edges.filter((e) => e.from !== e.to && edges.some((x) => x.from === e.to && x.to === e.from)).map((e) => pair(e.from, e.to)));
  return edges.map((e) => {
    const key = pair(e.from, e.to);
    const i = seen.get(key) ?? 0;
    seen.set(key, i + 1);
    return both.has(key) ? i + 1 : i;
  });
}

const head = (end: P, dir: P) => {
  const d = unit(dir);
  return ` M ${pt(sub(end, mul(rot(d, HEAD_T), HEAD)))} L ${pt(end)} L ${pt(sub(end, mul(rot(d, -HEAD_T), HEAD)))}`;
};

/** 화살표 path(원 테두리에서 테두리까지, 끝에 화살촉)와 칩 자리. lane 0은 곧은 선, 1·2…는 번갈아 양쪽으로 휜다(홀수는 가는 방향 왼쪽).
 *  제자리면 원 바깥(칸 가운데 반대쪽)에 고리. */
export function bendOf(key: string, a: Spot, b: Spot, lane: number, center: [number, number]): Bend {
  const A: P = [a.x, a.y];
  if (a.id === b.id) {
    const o = unit(sub(A, center));
    const p1 = add(A, mul(rot(o, -HEAD_T), a.r)), p2 = add(A, mul(rot(o, HEAD_T), a.r));
    const c1 = add(A, mul(rot(o, -0.3), a.r * loopReach(lane))), c2 = add(A, mul(rot(o, 0.3), a.r * loopReach(lane)));
    return { key, path: `M ${pt(p1)} C ${pt(c1)} ${pt(c2)} ${pt(p2)}${head(p2, sub(p2, c2))}`, label: add(A, mul(o, a.r * (1.9 + 0.4 * lane))) };
  }
  const B: P = [b.x, b.y];
  const mid = mul(add(A, B), 0.5);
  const left: P = (() => { const d = unit(sub(B, A)); return [d[1], -d[0]]; })();
  const side = lane % 2 === 1 ? 1 : -1;
  const c = lane === 0 ? mid : add(mid, mul(left, side * BEND * Math.ceil(lane / 2)));
  const s = add(A, mul(unit(sub(c, A)), a.r)), e = add(B, mul(unit(sub(c, B)), b.r));
  const label = add(add(mul(s, 0.25), mul(c, 0.5)), mul(e, 0.25));
  return { key, path: `M ${pt(s)} Q ${pt(c)} ${pt(e)}${head(e, sub(e, c))}`, label };
}

export const circlePath = (s: Spot) => `M ${f(s.x - s.r)} ${f(s.y)} a ${f(s.r)} ${f(s.r)} 0 1 0 ${f(2 * s.r)} 0 a ${f(s.r)} ${f(s.r)} 0 1 0 ${f(-2 * s.r)} 0`;
