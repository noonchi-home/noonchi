// 이동 가능 점 격자: 트윈 원점 기준 step 배수 자리 가운데 걸을 수 있는 점과, 이웃 점을 x·z 축 4방향으로 잇는 이음.
// 걸을 수 있음은 walkingGeometry(walk-guide.ts)와 같다: 로봇이 갈 수 있는 방 안, 고체 밖, 벽에서 0.18m + 벽 두께 절반 밖, 가구 상자 + 0.18m 밖.
// 이음은 두 점 사이 선 위(0.05m마다)가 모두 걸을 수 있고 가구 상자를 지나지 않을 때만 둔다. 트인 경계(open_edges)는 벽이 없어 이음이 그대로 지난다.
// 문은 벽 여유가 개구부를 막으므로, 개구부 가운데 점과 그 점에서 벽에 수직으로 양쪽 첫 격자 줄까지 나간 문 앞 점을 더한다.
// 문 앞 점은 같은 격자 줄의 양옆 격자 점과 잇는다. 그래서 모든 이음이 x·z 축과 나란하다(트윈 카메라에서는 두 대각선 방향).
// 브라우저도 같은 격자를 쓴다(src/layout/browser.ts, /api/scene 바닥 물건에 카탈로그 footprint가 실린다).
import type { Vec2 } from "../contract/layout.js";
import { roomAt } from "./route.js";
import { edgeDistance, type walkingGeometry } from "./walk-guide.js";

type Geometry = ReturnType<typeof walkingGeometry>;

/** 격자 간격(m): 0.30·0.25·0.20 가운데 대기·관찰 자리, 가구 앞자리, 충전 자리, 문 양쪽이 가장 많이 한 덩어리로 이어지는 가장 큰 값(tests/walk-grid.test.ts).
 *  한양목련은 세 값 모두 주방 쪽만 끊겨(식탁·의자·그릇장 둘레 여유 길이 3cm) 0.30이다. */
export const WALK_STEP = 0.3;

export interface WalkGrid {
  step: number;
  /** 앞 lattice개는 격자 점(step 배수 자리), 그 뒤는 문 점이다. */
  points: Vec2[];
  lattice: number;
  edges: [number, number][];
  /** 문마다 개구부 가운데 점(center)과 양쪽 문 앞 점(sides, 격자 점과 겹치면 그 격자 점) 번호. */
  doors: { id: string; center: number; sides: number[] }[];
}

const SAMPLE_M = 0.05;
const CLEARANCE_M = 0.18;
const round = (v: number) => Math.round(v * 1e6) / 1e6;
const onStep = (v: number, step: number) => Math.abs(v / step - Math.round(v / step)) < 1e-6;

/** a→b 선 위를 걸을 수 있는가. opening이면 그 문 벽 여유를 빼고, 방 다각형 대신 두 끝 방에서 본다(문 개구부를 지나는 선).
 *  furniture=false면 가구는 보지 않는다(가구 여유 안에서 나오는 첫 걸음). */
function lineClear(g: Geometry, a: Vec2, b: Vec2, opening?: { wall: string }, furniture = true): boolean {
  if (furniture && !g.furnitureClear(a, b)) return false;
  const ends = [roomAt(g.floor, a), roomAt(g.floor, b)].filter((r): r is string => r !== null);
  const n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / SAMPLE_M));
  for (let k = 0; k <= n; k++) {
    const p: Vec2 = [a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n];
    const room = roomAt(g.floor, p);
    const ok = opening
      ? ends.some((r) => g.walkable(r, p, opening, furniture))
      : room ? g.walkable(room, p, undefined, furniture) : ends.some((r) => g.walkable(r, p, {}, furniture));
    if (!ok) return false;
  }
  return true;
}

export function walkGrid(g: Geometry, step: number): WalkGrid {
  const points: Vec2[] = [];
  const edges: [number, number][] = [];
  const index = new Map<string, number>();
  const key = (i: number, j: number) => `${i},${j}`;
  const corners = g.floor.rooms.flatMap((r) => r.polygon);
  const [x0, x1] = [Math.min(...corners.map((p) => p[0])), Math.max(...corners.map((p) => p[0]))];
  const [z0, z1] = [Math.min(...corners.map((p) => p[1])), Math.max(...corners.map((p) => p[1]))];
  for (let i = Math.ceil(x0 / step); i * step <= x1; i++)
    for (let j = Math.ceil(z0 / step); j * step <= z1; j++) {
      const p: Vec2 = [round(i * step), round(j * step)];
      const room = roomAt(g.floor, p);
      if (!room || !g.walkable(room, p)) continue;
      index.set(key(i, j), points.length);
      points.push(p);
    }
  const lattice = points.length;
  const cell = (p: Vec2) => [Math.round(p[0] / step), Math.round(p[1] / step)] as const;
  for (let a = 0; a < lattice; a++) {
    const [i, j] = cell(points[a]!);
    for (const [di, dj] of [[1, 0], [0, 1]] as const) {
      const b = index.get(key(i + di, j + dj));
      if (b !== undefined && lineClear(g, points[a]!, points[b]!)) edges.push([a, b]);
    }
  }

  const doors: WalkGrid["doors"] = [];
  const reachable = new Set(g.floor.robot.reachable);
  for (const gate of g.floor.portals) {
    // 로봇이 갈 수 있는 두 방을 잇는 문만(욕실·발코니로 난 문은 끝이 막힌 점이 된다)
    if (!gate.rooms.every((r) => reachable.has(r))) continue;
    const door = g.doors.find((d) => d.id === gate.id);
    if (!door?.wall) continue;
    const wall = g.walls.find((w) => w.id === door.wall && edgeDistance(gate.point, w.a, w.b) < 0.05);
    if (!wall) continue;
    const [dx, dz] = [wall.b[0] - wall.a[0], wall.b[1] - wall.a[1]];
    // 축과 나란한 벽의 문만: 문 앞 점에서 격자 줄을 따라 잇는다
    if (Math.min(Math.abs(dx), Math.abs(dz)) > 1e-6) continue;
    const along = Math.abs(dx) > Math.abs(dz) ? 0 : 1;
    const normal = 1 - along;
    const margin = CLEARANCE_M + wall.thickness / 2;
    const center = gate.point;
    const sides: number[] = [];
    const added: Vec2[] = [];
    /** [문 앞 점 자리(added 번호), 격자 점 번호] */
    const pending: [number, number][] = [];
    for (const s of [1, -1]) {
      const edge = center[normal] + s * margin;
      const line = round((s > 0 ? Math.ceil(edge / step - 1e-9) : Math.floor(edge / step + 1e-9)) * step);
      const front: Vec2 = normal === 0 ? [line, center[1]] : [center[0], line];
      const room = roomAt(g.floor, front);
      if (!room || !g.walkable(room, front) || !lineClear(g, front, center, { wall: door.wall })) continue;
      if (onStep(center[along], step)) {
        const at = index.get(key(...cell(front)));
        if (at !== undefined) sides.push(at);
        continue;
      }
      // 격자 밖 문 앞 점: 같은 격자 줄의 양옆 격자 점과 잇는다
      const slot = added.length;
      added.push(front);
      for (const k of [Math.floor(center[along] / step), Math.ceil(center[along] / step)]) {
        const q: Vec2 = normal === 0 ? [line, round(k * step)] : [round(k * step), line];
        const at = index.get(key(...cell(q)));
        if (at !== undefined && lineClear(g, front, q)) pending.push([slot, at]);
      }
      sides.push(-(slot + 1));
    }
    if (!sides.length) continue;
    const base = points.length;
    points.push(...added, center);
    const node = (v: number) => (v < 0 ? base + (-v - 1) : v);
    for (const [slot, at] of pending) edges.push([base + slot, at]);
    const centerAt = points.length - 1;
    const sideAt = sides.map(node);
    for (const s of sideAt) edges.push([s, centerAt]);
    doors.push({ id: gate.id, center: centerAt, sides: sideAt });
  }
  return { step, points, lattice, edges, doors };
}

/** 점마다 덩어리 번호(이음으로 이어진 점끼리 같은 번호). */
export function gridParts(grid: WalkGrid): number[] {
  const parent = grid.points.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i]!)));
  for (const [a, b] of grid.edges) parent[find(a)] = find(b);
  return grid.points.map((_, i) => find(i));
}

/** 자리 p를 붙일 격자 점: maxM 안에서 p와 곧게 이어 걸을 수 있는 가장 가까운 점. 그런 점이 없고 p가 가구 여유 안이면(충전 자리처럼 가구에 붙은 자리)
 *  가구는 보지 않고 벽·방만 보고 가장 가까운 점(걷기 안내 walk-guide.ts nearestStart와 같은 0.6m). 없으면 null. */
export function attach(grid: WalkGrid, g: Geometry, p: Vec2, maxM = 0.6): number | null {
  const near = grid.points
    .map((q, i) => ({ i, d: Math.hypot(q[0] - p[0], q[1] - p[1]) }))
    .filter((x) => x.d <= maxM)
    .sort((a, b) => a.d - b.d);
  for (const { i } of near) if (lineClear(g, p, grid.points[i]!)) return i;
  const room = roomAt(g.floor, p);
  if (room && !g.walkable(room, p) && g.walkable(room, p, undefined, false))
    for (const { i } of near) if (lineClear(g, p, grid.points[i]!, undefined, false)) return i;
  return null;
}
