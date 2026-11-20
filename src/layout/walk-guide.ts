import type { SceneJson, Vec2 } from "../contract/layout.js";
import type { TwinWalkGuide } from "../contract/phone.js";
import { sharedOpening, type FloorPlan, type Portal } from "./floor.js";
import { approach, roomAt, route } from "./route.js";
import { walkingGeometry } from "./stations.js";

export type WalkingMap = ReturnType<typeof walkingMap>;
type Point = TwinWalkGuide["remaining"][number];
const distance = (a: Vec2, b: Vec2) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const cell = 0.15;

export function walkingMap(floor: FloorPlan, scene: SceneJson, footprint?: (type: string) => Vec2 | undefined) {
  const { walkable, furnitureClear } = walkingGeometry(scene, footprint);
  const doors = (scene.plan.doors ?? []) as { id: string; width?: number; wall?: string }[];
  const height = (room: string) => scene.plan.rooms?.find((r) => r.id === room)?.floor_z ?? 0;
  const widths = new Map(doors.map((d) => [d.id, d.width ?? 0]));
  for (const portal of floor.portals) {
    if (widths.has(portal.id)) continue;
    const polygons = portal.rooms.map((id) => floor.rooms.find((r) => r.id === id)?.polygon ?? []);
    widths.set(portal.id, sharedOpening(polygons[0]!, polygons[1]!)?.len ?? 0);
  }
  const doorRadius = (portal: Portal) => (widths.get(portal.id) ?? 0) / 2 - 0.18;
  const room = (p: Vec2) => roomAt(floor, p);
  function clear(a: Vec2, b: Vec2, inRoom: string, gates: Portal[] = []) {
    if(!furnitureClear(a,b)) return false;
    const n = Math.max(1, Math.ceil(distance(a, b) / 0.06));
    for (let i = 0; i <= n; i++) {
      const p: Vec2 = [a[0] + ((b[0] - a[0]) * i) / n, a[1] + ((b[1] - a[1]) * i) / n];
      const opening = gates.find((g) => distance(p, g.point) <= Math.min(0.3, doorRadius(g)));
      if (!walkable(inRoom, p, opening ? { wall: doors.find((d) => d.id === opening.id)?.wall } : undefined))
        return false;
    }
    return true;
  }
  // Search only when the direct indoor segment is blocked. Every shortcut is tested again.
  function indoor(a: Vec2, b: Vec2, inRoom: string, gates: Portal[]): Vec2[] | null {
    const pass = (x: Vec2, y: Vec2) => clear(x, y, inRoom, gates);
    if (pass(a, b)) return [b];
    if (!pass(a, a) || !pass(b, b)) return null;
    const key = (x: number, y: number) => x + "," + y;
    type Cell = { x: number; y: number; p: Vec2; cost: number; score: number; prev: Cell | null };
    const queue: Cell[] = [{ x: 0, y: 0, p: a, cost: 0, score: distance(a, b), prev: null }];
    const best = new Map([[key(0, 0), 0]]);
    while (queue.length && best.size < 18000) {
      let first = 0;
      for (let n = 1; n < queue.length; n++) if (queue[n]!.score < queue[first]!.score) first = n;
      const v = queue[first]!;
      queue[first] = queue[queue.length - 1]!;
      queue.pop();
      if (best.get(key(v.x, v.y)) !== v.cost) continue;
      if (distance(v.p, b) <= cell * 2 && pass(v.p, b)) {
        const path: Vec2[] = [b];
        for (let at: Cell | null = v; at; at = at.prev) path.unshift(at.p);
        const out: Vec2[] = [];
        for (let n = 0; n < path.length - 1; ) {
          let j = path.length - 1;
          while (j > n + 1 && !pass(path[n]!, path[j]!)) j--;
          out.push(path[j]!);
          n = j;
        }
        return out;
      }
      for (const [dx, dy] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ] as const) {
        const x = v.x + dx,
          y = v.y + dy,
          k = key(x, y),
          cost = v.cost + cell;
        if ((best.get(k) ?? Infinity) <= cost) continue;
        const p: Vec2 = [a[0] + x * cell, a[1] + y * cell];
        if (!pass(v.p, p)) continue;
        best.set(k, cost);
        queue.push({ x, y, p, cost, score: cost + distance(p, b), prev: v });
      }
    }
    return null;
  }
  function plan(from: Vec2, target: Vec2, near_m: number, exact: boolean, hint?: Vec2[]): TwinWalkGuide | null {
    const path = route(floor, from, target);
    const origin = room(from);
    if (!path || !origin) return null;
    let current: string = origin;
    const end = exact ? path : approach(path);
    if (end.length !== path.length) return null;
    // Legs are cumulative. Only an unchanged segment with the same portals and endpoint can supply the stand.
    if (hint && hint.length === end.length && hint.every((p, i) => distance(p, end[i]!) < 0.01) && !exact)
      end[end.length - 1] = hint[hint.length - 1]!;
    const remaining: Point[] = [];
    let lastGate: Portal | undefined;
    for (let i = 1; i < end.length; i++) {
      const p = end[i]!,
        last = i === end.length - 1;
      const gate = last ? undefined : floor.portals.find((g) => g.point === p && g.rooms.includes(current!));
      if (!last && (!gate || doorRadius(gate) <= 0)) return null;
      const next: string = gate?.rooms.find((r) => r !== current) ?? current;
      if (last && (room(p) !== current || !walkable(current, p))) return null;
      const points = indoor(
        end[i - 1]!,
        p,
        current,
        [lastGate, gate].filter((g): g is Portal => !!g)
      );
      if (!points) return null;
      for (const via of points.slice(0, -1))
        remaining.push({ kind: "via", room: current, position: [via[0], height(current), via[1]] });
      const position: [number, number, number] = [p[0], height(next), p[1]];
      remaining.push(
        gate
          ? { kind: "portal", id: gate.id, from_room: current, to_room: next, position }
          : { kind: "stand", room: current, position }
      );
      current = next;
      lastGate = gate;
    }
    return remaining.length ? { revision: 0, near_m, remaining: remaining as TwinWalkGuide["remaining"] } : null;
  }
  return { room, plan, clear, gate: (id: string) => floor.portals.find((g) => g.id === id), doorRadius };
}
