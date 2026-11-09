// 방 CCTV 시점: 방 다각형(평면도 좌표, 벽 중심선)에서 천장 모서리 카메라 자리와 바라볼 점을 고른다. 순수 함수다.
//
// 후보는 볼록한 꼭짓점마다 두 벽에서 inset만큼 들어간 점과 긴 벽의 가운데다. 방 안 격자점 가운데 시선이
// 다각형 변(벽)과 키 큰 가구(obstacles)를 넘지 않고 가로 화각 안에 드는 점이 가장 많은 후보를 고른다.
// L자 방은 두 팔이 다 보이는 모서리가, 옷장·상부장이 차지한 모서리는 다른 모서리가 이긴다.
// 가전(targets)의 정면이 카메라 쪽을 보면 가점을 준다. 켜짐·꺼짐은 TV 화면·표시등처럼 정면에서 보이기 때문이다.
// obstacles: [{min: [x, y], max: [x, y], top}] 평면도 좌표 상자와 윗면 높이(m)
// targets: [{p: [x, y], front: [fx, fy]}] 가전 자리와 정면 단위 벡터(평면도 좌표)

import { insidePolygon } from "./walls.mjs";

const DEG = Math.PI / 180;

function signedArea(poly) {
  let s = 0;
  for (let i = 0; i < poly.length; i++) {
    const [x1, y1] = poly[i];
    const [x2, y2] = poly[(i + 1) % poly.length];
    s += x1 * y2 - x2 * y1;
  }
  return s / 2;
}

// 변 i(꼭짓점 i → i+1)의 단위 방향과 방 안쪽 법선
function edges(poly) {
  const ccw = signedArea(poly) > 0;
  return poly.map(([x1, y1], i) => {
    const [x2, y2] = poly[(i + 1) % poly.length];
    const len = Math.hypot(x2 - x1, y2 - y1) || 1;
    const d = [(x2 - x1) / len, (y2 - y1) / len];
    return { a: [x1, y1], b: [x2, y2], d, n: ccw ? [-d[1], d[0]] : [d[1], -d[0]] };
  });
}

function distanceToSegment([px, py], [ax, ay], [bx, by]) {
  const vx = bx - ax;
  const vy = by - ay;
  const t = Math.max(0, Math.min(1, ((px - ax) * vx + (py - ay) * vy) / (vx * vx + vy * vy || 1)));
  return Math.hypot(px - (ax + t * vx), py - (ay + t * vy));
}

const wallDistance = (p, poly) => Math.min(...edges(poly).map((e) => distanceToSegment(p, e.a, e.b)));

const orient = ([ax, ay], [bx, by], [cx, cy]) => (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);

// 두 선분이 서로를 확실히 가로지르는가(끝점이 닿기만 하는 것은 빼고)
function crosses(p1, p2, q1, q2, eps = 1e-9) {
  const d1 = orient(q1, q2, p1);
  const d2 = orient(q1, q2, p2);
  const d3 = orient(p1, p2, q1);
  const d4 = orient(p1, p2, q2);
  return ((d1 > eps && d2 < -eps) || (d1 < -eps && d2 > eps)) && ((d3 > eps && d4 < -eps) || (d3 < -eps && d4 > eps));
}

const rectEdges = ({ min: [x0, y0], max: [x1, y1] }) => [
  [[x0, y0], [x1, y0]], [[x1, y0], [x1, y1]], [[x1, y1], [x0, y1]], [[x0, y1], [x0, y0]],
];

const insideRect = ([x, y], { min, max }, pad = 0) =>
  x > min[0] - pad && x < max[0] + pad && y > min[1] - pad && y < max[1] + pad;

/**
 * from에서 to가 벽(다각형 변)과 키 큰 가구(윗면 >= blockTop)에 가리지 않고 보이는가. 둘 다 방 안의 점이다.
 * 천장 카메라가 바닥을 보는 것이라 낮은 가구(소파·서랍장)는 막지 않는다고 본다.
 */
export function lineOfSight(from, to, poly, obstacles = [], blockTop = 1.6) {
  if (!edges(poly).every((e) => !crosses(from, to, e.a, e.b))) return false;
  return obstacles.every((o) => o.top < blockTop || rectEdges(o).every(([a, b]) => !crosses(from, to, a, b)));
}

/** 방 안 격자점(step 간격, 벽에서 margin 이상 떨어진 점) */
export function roomSamples(poly, step = 0.25, margin = 0.15) {
  const xs = poly.map((p) => p[0]);
  const ys = poly.map((p) => p[1]);
  const pts = [];
  for (let x = Math.min(...xs) + step / 2; x < Math.max(...xs); x += step) {
    for (let y = Math.min(...ys) + step / 2; y < Math.max(...ys); y += step) {
      const p = [Math.round(x * 1e6) / 1e6, Math.round(y * 1e6) / 1e6];
      if (insidePolygon(p, poly) && wallDistance(p, poly) >= margin) pts.push(p);
    }
  }
  return pts;
}

// 모서리 후보(corner = 꼭짓점 번호)와 1.5 m 넘는 벽의 가운데 후보(corner = 꼭짓점 수 + 변 번호)
function candidates(poly, inset) {
  const es = edges(poly);
  const ccw = signedArea(poly) > 0;
  const out = [];
  for (let i = 0; i < poly.length; i++) {
    const prev = es[(i - 1 + poly.length) % poly.length];
    const next = es[i];
    const turn = prev.d[0] * next.d[1] - prev.d[1] * next.d[0];
    if (ccw ? turn <= 1e-9 : turn >= -1e-9) continue; // 오목한(안으로 꺾인) 꼭짓점은 벽 모서리를 바라보게 된다
    const [vx, vy] = poly[i];
    out.push({ corner: i, p: [vx + inset * (prev.n[0] + next.n[0]), vy + inset * (prev.n[1] + next.n[1])] });
  }
  es.forEach((e, i) => {
    if (Math.hypot(e.b[0] - e.a[0], e.b[1] - e.a[1]) < 1.5) return;
    const mid = [(e.a[0] + e.b[0]) / 2, (e.a[1] + e.b[1]) / 2];
    out.push({ corner: poly.length + i, p: [mid[0] + inset * e.n[0], mid[1] + inset * e.n[1]] });
  });
  return out.filter((c) => insidePolygon(c.p, poly) && wallDistance(c.p, poly) >= inset * 0.6);
}

/**
 * 방의 CCTV 카메라 자리. three.js 좌표(x, 높이, 평면도 y)로 돌려준다.
 * - position: 천장(ceiling)에서 drop만큼 아래, 모서리에서 inset만큼 들어간 점
 * - target: 보이는 격자점들의 가운데 방향으로 그 평균 거리만큼 간 점, 높이 targetHeight
 * - coverage: 방 격자점 가운데 가리지 않고 가로 화각(hfovDeg) 안에 드는 비율
 */
export function cctvPose(room, {
  ceiling = 2.3, drop = 0.08, inset = 0.35, hfovDeg = 115, targetHeight = 0.4, step = 0.25, obstacles = [], blockTop = 1.6,
  targets = [], frontBonus = 0.08,
} = {}) {
  const poly = room.polygon;
  const tall = obstacles.filter((o) => o.top >= blockTop);
  // 키 큰 가구 밑 바닥은 어디서도 안 보이므로 세지 않는다
  const samples = roomSamples(poly, step).filter((s) => !tall.some((o) => insideRect(s, o)));
  const half = (hfovDeg / 2) * DEG;
  const clearTop = ceiling - drop - 0.4; // 이보다 높은 가구 위·안에는 카메라를 두지 않는다
  const free = candidates(poly, inset).filter((c) => !obstacles.some((o) => o.top >= clearTop && insideRect(c.p, o, 0.15)));
  let best = null;
  for (const c of free) {
    const seen = samples.filter((s) => lineOfSight(c.p, s, poly, tall, blockTop));
    if (!seen.length) continue;
    const mean = [seen.reduce((a, s) => a + s[0], 0) / seen.length, seen.reduce((a, s) => a + s[1], 0) / seen.length];
    const len = Math.hypot(mean[0] - c.p[0], mean[1] - c.p[1]) || 1;
    const dir = [(mean[0] - c.p[0]) / len, (mean[1] - c.p[1]) / len];
    const inView = seen.filter(([x, y]) => {
      const dx = x - c.p[0];
      const dy = y - c.p[1];
      return Math.acos(Math.max(-1, Math.min(1, (dx * dir[0] + dy * dir[1]) / (Math.hypot(dx, dy) || 1)))) <= half;
    });
    const reach = inView.reduce((a, [x, y]) => a + Math.hypot(x - c.p[0], y - c.p[1]), 0) / (inView.length || 1);
    const fronts = targets.filter(({ p, front }) => {
      const dx = c.p[0] - p[0];
      const dy = c.p[1] - p[1];
      const len = Math.hypot(dx, dy) || 1;
      const ang = Math.acos(Math.max(-1, Math.min(1, (-dx * dir[0] - dy * dir[1]) / len)));
      return (dx * front[0] + dy * front[1]) / len > 0.3 && ang <= half && lineOfSight(c.p, p, poly, tall, blockTop);
    }).length;
    // 가전 정면 하나가 바닥 8 %만큼 값진다. 같으면 더 멀리 보는 쪽
    const score = inView.length + fronts * frontBonus * samples.length + reach * 1e-3;
    if (!best || score > best.score) best = { score, c, dir, reach, count: inView.length, fronts };
  }
  if (!best) {
    // 후보가 없는 아주 작은 방: 가운데 천장에서 바로 아래를 본다
    const [x, y] = samples[0] ?? poly[0];
    return { position: [x, ceiling - drop, y], target: [x + 0.01, 0, y], coverage: samples.length ? 1 : 0, fronts: 0, corner: -1 };
  }
  const dist = Math.min(Math.max(best.reach, 1.0), 6.0);
  const round = (v) => Math.round(v * 1e4) / 1e4;
  return {
    position: [round(best.c.p[0]), round(ceiling - drop), round(best.c.p[1])],
    target: [round(best.c.p[0] + best.dir[0] * dist), targetHeight, round(best.c.p[1] + best.dir[1] * dist)],
    coverage: samples.length ? Math.round((best.count / samples.length) * 1000) / 1000 : 0,
    fronts: best.fronts,
    corner: best.c.corner,
  };
}
