// 이동 가능 점 격자: 트윈 원점 기준 step 배수 자리 가운데 걸을 수 있는 점과, 이웃 점을 x·z 축 4방향으로 잇는 이음.
// 걸을 수 있음은 walkingGeometry(walk-guide.ts)와 같다: 로봇이 갈 수 있는 방 안, 고체 밖, 벽에서 0.18m + 벽 두께 절반 밖, 가구 상자 + 0.18m 밖(식탁 의자 빼고).
// 이음은 두 점 사이 선 위(0.05m마다)가 모두 걸을 수 있고 가구 상자를 지나지 않을 때만 둔다. 트인 경계(open_edges)는 벽이 없어 이음이 그대로 지난다.
// 문은 벽 여유가 개구부를 막으므로, 개구부 가운데 점과 그 점에서 벽에 수직으로 양쪽 첫 격자 줄까지 나간 문 앞 점을 더한다.
// 문 앞 점은 같은 격자 줄의 양옆 격자 점과 잇는다. 그래서 모든 이음이 x·z 축과 나란하다(트윈 카메라에서는 두 대각선 방향).
// 브라우저도 같은 격자를 쓴다(src/layout/browser.ts, /api/scene 바닥 물건에 카탈로그 footprint가 실린다).
import type { SceneJson, Vec2 } from "../contract/layout.js";
import type { StationMap } from "../contract/stations.js";
import { roomAt } from "./route.js";
import { edgeDistance, walkingGeometry } from "./walk-guide.js";

type Geometry = ReturnType<typeof walkingGeometry>;

/** 격자 간격(m): 0.30·0.25·0.20 가운데 대기·관찰 자리, 가구 앞자리, 충전 자리, 문 양쪽이 가장 많이 한 덩어리로 이어지는 가장 큰 값(tests/walk-grid.test.ts). */
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
export function attach(grid: WalkGrid, g: Geometry, p: Vec2, maxM = LINK_M): number | null {
  return links(grid, g, p, null, false, maxM, true)[0]?.node ?? null;
}

interface Link { node: number; bend: Vec2[]; cost: number }
/** 자리와 격자 점을 곧게 잇는 가장 먼 거리(m, 걷기 안내 walk-guide.ts nearestStart와 같은 0.6m). */
const LINK_M = 0.6;

/** 자리 p와 격자 점을 잇는 길 후보: 격자 점 번호, 그 사이 꺾이는 점(square면 x·z 축과 나란한 두 구간의 꺾인 점 하나, 아니면 없음), 그 길이.
 *  p가 격자 점이면 그 점 하나. allowed가 있으면 그 점들만 본다. 이을 점이 없고 p가 가구 여유 안이면(충전 자리처럼 가구에 붙은 자리) 가구는 보지 않고 다시 찾고,
 *  p가 벽 여유 안이면(벽에 붙어 선 폰) 같은 방 안으로만 가는 선으로 다시 찾는다(걷기 안내 nearestStart처럼 벽을 넘지 않는다). 가까운 것부터, first면 첫 하나만. */
function links(grid: WalkGrid, g: Geometry, p: Vec2, allowed: Set<number> | null, square: boolean, maxM = LINK_M, first = false): Link[] {
  const ok = (i: number) => !allowed || allowed.has(i);
  const same = grid.points.findIndex((q, i) => ok(i) && Math.abs(q[0] - p[0]) < 1e-6 && Math.abs(q[1] - p[1]) < 1e-6);
  if (same >= 0) return [{ node: same, bend: [], cost: 0 }];
  const near = grid.points
    .map((q, i) => ({ i, d: Math.hypot(q[0] - p[0], q[1] - p[1]) }))
    .filter((x) => ok(x.i) && x.d <= maxM)
    .sort((a, b) => a.d - b.d);
  const reach = (pass: (a: Vec2, b: Vec2) => boolean) => {
    const out: Link[] = [];
    for (const { i, d } of near) {
      const q = grid.points[i]!;
      if (!square || Math.abs(q[0] - p[0]) < 1e-9 || Math.abs(q[1] - p[1]) < 1e-9) {
        if (pass(p, q)) out.push({ node: i, bend: [], cost: d });
      } else {
        const e = ([[q[0], p[1]], [p[0], q[1]]] as Vec2[]).find((e) => pass(p, e) && pass(e, q));
        if (e) out.push({ node: i, bend: [e], cost: Math.abs(q[0] - p[0]) + Math.abs(q[1] - p[1]) });
      }
      if (first && out.length) break;
    }
    return out;
  };
  const found = reach((a, b) => lineClear(g, a, b));
  if (found.length) return found;
  const room = roomAt(g.floor, p);
  if (!room) return [];
  if (!g.walkable(room, p) && g.walkable(room, p, undefined, false)) return reach((a, b) => lineClear(g, a, b, undefined, false));
  if (g.walkable(room, p, undefined, false)) return [];
  // 벽 여유 안: 선 위 점이 모두 같은 방 안이면 된다
  return reach((a, b) => {
    const n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / SAMPLE_M));
    for (let k = 0; k <= n; k++) if (roomAt(g.floor, [a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n]) !== room) return false;
    return true;
  });
}

/** 꺾을 때 더하는 길이(m): 같은 길이 길 가운데 덜 꺾이는 길을 고른다(계단 모양 대신 ㄱ자). */
const TURN_M = 1e-3;
const adjacency = new WeakMap<WalkGrid, [number, number, number][][]>();
/** 점마다 [이웃 점, 이음 길이, 방향(0 +x, 1 −x, 2 +z, 3 −z)]. */
function neighbours(grid: WalkGrid): [number, number, number][][] {
  let adj = adjacency.get(grid);
  if (adj) return adj;
  adj = grid.points.map(() => []);
  const dir = (a: Vec2, b: Vec2) => (Math.abs(b[0] - a[0]) >= Math.abs(b[1] - a[1]) ? (b[0] > a[0] ? 0 : 1) : b[1] > a[1] ? 2 : 3);
  for (const [a, b] of grid.edges) {
    const [p, q] = [grid.points[a]!, grid.points[b]!];
    const d = Math.hypot(p[0] - q[0], p[1] - q[1]);
    adj[a]!.push([b, d, dir(p, q)]);
    adj[b]!.push([a, d, dir(q, p)]);
  }
  adjacency.set(grid, adj);
  return adj;
}

/** 출발 후보들에서 도착 후보들까지 이음을 따라 가장 짧은 길(꺾일 때 TURN_M을 더한 Dijkstra). allowed가 있으면 그 점들만 지난다.
 *  [출발 후보, 점 번호 목록, 도착 후보]. 없으면 null. */
function shortest(grid: WalkGrid, starts: Link[], ends: Link[], allowed: Set<number> | null): [Link, number[], Link] | null {
  const adj = neighbours(grid);
  const goal = new Map(ends.map((e) => [e.node, e]));
  // 상태 = 점 번호 × 5 + 들어온 방향(4는 출발)
  const cost = new Map<number, number>();
  const prev = new Map<number, number>();
  const origin = new Map<number, Link>();
  const heap: [number, number][] = [];
  const push = (x: [number, number]) => {
    heap.push(x);
    for (let i = heap.length - 1; i > 0; ) {
      const p = (i - 1) >> 1;
      if (heap[p]![0] <= heap[i]![0]) break;
      [heap[i], heap[p]] = [heap[p]!, heap[i]!];
      i = p;
    }
  };
  const pop = () => {
    const top = heap[0]!, last = heap.pop()!;
    if (heap.length) {
      heap[0] = last;
      for (let i = 0; ; ) {
        const [l, r] = [2 * i + 1, 2 * i + 2];
        let m = i;
        if (l < heap.length && heap[l]![0] < heap[m]![0]) m = l;
        if (r < heap.length && heap[r]![0] < heap[m]![0]) m = r;
        if (m === i) break;
        [heap[i], heap[m]] = [heap[m]!, heap[i]!];
        i = m;
      }
    }
    return top;
  };
  for (const s of starts) {
    const key = s.node * 5 + 4;
    if (s.cost < (cost.get(key) ?? Infinity)) {
      cost.set(key, s.cost);
      origin.set(key, s);
      push([s.cost, key]);
    }
  }
  let best: { total: number; key: number } | null = null;
  const done = new Set<number>();
  while (heap.length) {
    const [c, key] = pop();
    if (best && c >= best.total) break;
    if (done.has(key)) continue;
    done.add(key);
    const [u, came] = [Math.floor(key / 5), key % 5];
    const end = goal.get(u);
    if (end && (!best || c + end.cost < best.total)) best = { total: c + end.cost, key };
    for (const [v, d, dir] of adj[u]!) {
      if (allowed && !allowed.has(v)) continue;
      const next = v * 5 + dir;
      const nc = c + d + (came !== 4 && came !== dir ? TURN_M : 0);
      if (nc < (cost.get(next) ?? Infinity)) {
        cost.set(next, nc);
        prev.set(next, key);
        push([nc, next]);
      }
    }
  }
  if (!best) return null;
  const keys = [best.key];
  while (prev.has(keys[0]!)) keys.unshift(prev.get(keys[0]!)!);
  return [origin.get(keys[0]!)!, keys.map((k) => Math.floor(k / 5)), goal.get(Math.floor(best.key / 5))!];
}

/** 꺾이는 점만 남긴다: 겹친 점, 앞뒤 점과 한 줄 위인 가운데 점, 갔다 되돌아오는 점(앞앞 점과 같은 점)을 뺀다. */
function corners(line: Vec2[]): Vec2[] {
  const same = (a: Vec2, b: Vec2) => Math.abs(a[0] - b[0]) < 1e-9 && Math.abs(a[1] - b[1]) < 1e-9;
  const out: Vec2[] = [];
  for (const p of line) {
    const last = out.at(-1);
    if (last && same(last, p)) continue;
    const before = out.at(-2);
    if (before && same(before, p)) {
      out.pop();
      continue;
    }
    if (before && last) {
      const cross = (last[0] - before[0]) * (p[1] - before[1]) - (last[1] - before[1]) * (p[0] - before[0]);
      if (Math.abs(cross) < 1e-9) out.pop();
    }
    out.push(p);
  }
  return out;
}

/** 방 room 안 격자 점과 그 방에 난 문의 개구부 가운데 점(폰 안내의 방 안 길은 이 점들만 지난다). */
function roomNodes(grid: WalkGrid, g: Geometry, room: string): Set<number> {
  const nodes = new Set<number>();
  grid.points.forEach((p, i) => {
    if (roomAt(g.floor, p) === room) nodes.add(i);
  });
  for (const d of grid.doors) if (g.floor.portals.find((x) => x.id === d.id)?.rooms.includes(room)) nodes.add(d.center);
  return nodes;
}

export interface RouteOptions {
  /** 이 방 안 격자 점만 지난다(폰 안내의 방 안 길). */
  room?: string;
  /** 처음·끝 자리와 격자 점 사이도 x·z 축과 나란한 구간으로 잇는다(계획 선·트윈 원뿔). 아니면 0.6m 안 곧은 선 하나(폰 안내: 모든 경유점이 격자 점). */
  square?: boolean;
}

/** from에서 to까지 격자 길: 두 자리를 0.6m 안 이을 수 있는 격자 점에 붙이고(attach와 같은 규칙), 이음을 따라 가장 짧은 길(같은 길이면 덜 꺾이는 길)을 찾아
 *  꺾이는 점만 남긴다. [from, …꺾이는 점, to]. 두 자리가 붙이는 거리(0.6m) 안이고 곧게(square면 x·z 축과 나란한 두 구간으로) 이을 수 있으면 격자를 거치지 않는다.
 *  그 밖에는 아무 각도로 건너뛰지 않는다. 붙일 점이 없거나 두 점이 이어지지 않으면 null. */
export function gridRoute(grid: WalkGrid, g: Geometry, from: Vec2, to: Vec2, opts: RouteOptions = {}): Vec2[] | null {
  if (Math.abs(from[0] - to[0]) < 1e-9 && Math.abs(from[1] - to[1]) < 1e-9) return [from];
  const allowed = opts.room ? roomNodes(grid, g, opts.room) : null;
  const square = opts.square ?? false;
  if (Math.hypot(to[0] - from[0], to[1] - from[1]) <= LINK_M) {
    const bends: Vec2[][] = !square || Math.abs(to[0] - from[0]) < 1e-9 || Math.abs(to[1] - from[1]) < 1e-9 ? [[]] : [[[to[0], from[1]]], [[from[0], to[1]]]];
    for (const bend of bends) {
      const line = [from, ...bend, to];
      if (line.slice(1).every((p, i) => lineClear(g, line[i]!, p))) return line;
    }
  }
  const found = shortest(grid, links(grid, g, from, allowed, square), links(grid, g, to, allowed, square), allowed);
  if (!found) return null;
  const [a, nodes, b] = found;
  return corners([from, ...a.bend, ...nodes.map((i) => grid.points[i]!), ...[...b.bend].reverse(), to]);
}

/** 걷기 길 자료: 격자와 그 판정, 서는 자리(가구 앞자리·방 대기 자리). 계획 선(src/agent/planShape.ts)이 쓴다. */
export interface WalkWay {
  grid: WalkGrid;
  geometry: Geometry;
  /** 가구 id → 가구 앞자리(stations.json surface_fronts). */
  fronts: Map<string, Vec2>;
  /** 방 id → 그 방 대기 자리(stations.json roles standby, 방마다 처음 것). */
  standby: Map<string, Vec2>;
}

/** 장면(바닥 물건 footprint, stations)에서 걷기 길 자료를 만든다. */
export function walkWay(scene: SceneJson & { stations?: StationMap }, footprintOf?: (type: string) => Vec2 | undefined): WalkWay {
  const geometry = walkingGeometry(scene, footprintOf);
  const fronts = new Map((scene.stations?.surface_fronts ?? []).map((f) => [f.surface_id, f.position] as [string, Vec2]));
  const standby = new Map<string, Vec2>();
  for (const s of scene.stations?.stations ?? []) if (s.roles.includes("standby") && !standby.has(s.room)) standby.set(s.room, s.position);
  return { grid: walkGrid(geometry, WALK_STEP), geometry, fronts, standby };
}

/** 이동 목적지: 가구 앞자리, 없으면 그 방 대기 자리, 없으면 near에서 가장 가까운 격자 점(격자 점은 모두 가구 상자 + 여유 밖이다). 격자 점이 없으면 null. */
export function moveStop(way: WalkWay, objectId: string | undefined, room: string | null | undefined, near: Vec2): Vec2 | null {
  const front = objectId ? way.fronts.get(objectId) : undefined;
  if (front) return front;
  const standby = room ? way.standby.get(room) : undefined;
  if (standby) return standby;
  let best: Vec2 | null = null;
  for (const q of way.grid.points)
    if (!best || Math.hypot(q[0] - near[0], q[1] - near[1]) < Math.hypot(best[0] - near[0], best[1] - near[1])) best = q;
  return best;
}
