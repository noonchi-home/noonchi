// 평면도 위 바닥 경로: 방은 다각형, 방 사이는 문·트인 경계(포털)로 잇는다. 같은 방 안은 곧은 선으로 본다.
// 실제 로봇 경로가 아니라 「어디로 갈지」를 보여 주는 선이다. task planner가 경로를 보내면 그것을 쓴다.
import type { XZ } from "../contract/plan.js";
import { floorPlanFrom, type FloorPlan } from "./floor.js";

export { floorPlanFrom };

const dist = (a: XZ, b: XZ) => Math.hypot(a[0] - b[0], a[1] - b[1]);

export function roomAt(fp: FloorPlan, [x, z]: XZ): string | null {
  for (const r of fp.rooms) {
    let inside = false;
    for (let i = 0, j = r.polygon.length - 1; i < r.polygon.length; j = i++) {
      const [xi, zi] = r.polygon[i]!;
      const [xj, zj] = r.polygon[j]!;
      if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
    }
    if (inside) return r.id;
  }
  return null;
}

/** 점이 있는 방의 id와 이름. 이름은 트윈 방 목록(rooms)에서 찾고, 목록에 없는 방은 id. 집 밖이면 null. */
export function roomNamedAt(fp: FloorPlan, rooms: readonly { id: string; label: string }[]): (p: XZ) => { id: string; label: string } | null {
  const names = new Map(rooms.map((r) => [r.id, r.label]));
  return (p) => {
    const id = roomAt(fp, p);
    return id ? { id, label: names.get(id) ?? id } : null;
  };
}

/** 시작·끝 점과 포털을 마디로 둔 최단 거리(다익스트라). 두 마디가 같은 방에 있으면 잇는다. 시작점을 모르면 null. */
export function route(fp: FloorPlan, from: XZ | null, to: XZ): XZ[] | null {
  if (!from) return null;
  const startRoom = roomAt(fp, from);
  const endRoom = roomAt(fp, to);
  if (!startRoom || !endRoom) return null;
  if (startRoom === endRoom) return [from, to];
  if (!fp.robot.reachable.includes(endRoom)) return null;
  const ok = new Set([...fp.robot.reachable, startRoom, endRoom]);
  const nodes: { point: XZ; rooms: string[] }[] = [
    { point: from, rooms: [startRoom] },
    { point: to, rooms: [endRoom] },
    ...fp.portals.filter((p) => ok.has(p.rooms[0]) && ok.has(p.rooms[1])).map((p) => ({ point: p.point, rooms: [...p.rooms] })),
  ];
  const best = nodes.map(() => Infinity);
  const prev = nodes.map(() => -1);
  const done = nodes.map(() => false);
  best[0] = 0;
  for (;;) {
    let u = -1;
    for (let i = 0; i < nodes.length; i++) if (!done[i] && best[i]! < Infinity && (u < 0 || best[i]! < best[u]!)) u = i;
    if (u < 0 || u === 1) break;
    done[u] = true;
    for (let v = 0; v < nodes.length; v++) {
      if (done[v] || !nodes[u]!.rooms.some((r) => nodes[v]!.rooms.includes(r))) continue;
      const d = best[u]! + dist(nodes[u]!.point, nodes[v]!.point);
      if (d < best[v]!) { best[v] = d; prev[v] = u; }
    }
  }
  if (best[1] === Infinity) return null;
  const out: XZ[] = [];
  for (let i = 1; i >= 0; i = prev[i]!) out.unshift(nodes[i]!.point);
  return out;
}

/** 마지막 구간을 stopM만큼 줄인다(목적지 물건 앞에서 멈추기). 구간이 stopM보다 짧으면 그 구간을 뺀다. */
export function approach(path: XZ[], stopM: number): XZ[] {
  if (path.length < 2) return path;
  const a = path[path.length - 2]!;
  const b = path[path.length - 1]!;
  const len = dist(a, b);
  if (len <= stopM) return path.slice(0, -1);
  const t = (len - stopM) / len;
  const round = (n: number) => Math.round(n * 1000) / 1000;
  return [...path.slice(0, -1), [round(a[0] + (b[0] - a[0]) * t), round(a[1] + (b[1] - a[1]) * t)]];
}
