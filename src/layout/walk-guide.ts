import type { SceneJson, SceneObject, Vec2 } from "../contract/layout.js";
import type { TwinWalkGuide } from "../contract/phone.js";
import { floorPlanFrom, insidePolygon, sharedOpening, type FloorPlan, type Portal } from "./floor.js";
import { approach, roomAt, route } from "./route.js";

export function edgeDistance(p: Vec2, a: Vec2, b: Vec2) {
  const dx = b[0] - a[0], dz = b[1] - a[1];
  const len2 = dx * dx + dz * dz;
  const t = len2 ? Math.min(1, Math.max(0, ((p[0]-a[0])*dx + (p[1]-a[1])*dz) / len2)) : 0;
  return Math.hypot(p[0]-a[0]-t*dx, p[1]-a[1]-t*dz);
}
function segmentsCross(a:Vec2,b:Vec2,c:Vec2,d:Vec2) {
  const side=(p:Vec2,q:Vec2,r:Vec2)=>(q[0]-p[0])*(r[1]-p[1])-(q[1]-p[1])*(r[0]-p[0]);
  return side(a,b,c)*side(a,b,d)<0 && side(c,d,a)*side(c,d,b)<0;
}
export function edges(poly: Vec2[]) {
  return poly.map((a,i): [Vec2,Vec2] => [a,poly[(i+1)%poly.length]!]);
}
const clearance = 0.18;
export function walkingGeometry(scene: SceneJson, footprintOf?: (type: string)=>Vec2 | undefined) {
  const floor = floorPlanFrom(scene);
  const rooms = new Map(floor.rooms.map(r=>[r.id,r.polygon]));
  const rawWalls = (scene.plan.walls ?? []) as {id:string; a: Vec2 | null; b: Vec2 | null; polygon?: Vec2[]; thickness?: number}[];
  const solids = rawWalls.flatMap(w=>w.polygon ? [{id:w.id,polygon:w.polygon}] : []);
  const walls = rawWalls.flatMap(w=>w.a && w.b ? [{id:w.id,a:w.a,b:w.b,thickness:w.thickness??0}] :
    edges(w.polygon??[]).map(([a,b])=>({id:w.id,a,b,thickness:0})));
  const obstacles = (scene.objects as SceneObject[]).filter(o=>o.mount==="floor" && o.room && (o.plan.elevation??0)<1.8);
  const boxes=obstacles.flatMap(o=>{
    const dims=o.footprint??footprintOf?.(o.type);
    if(!dims) return [];
    const yaw=o.rotation?.[1]??(90-o.plan.facing_deg)*Math.PI/180;
    return [{p:o.plan.position,cos:Math.cos(yaw),sin:Math.sin(yaw),
      w:dims[0]*(o.scale?.[0]??1)/2+clearance,d:dims[1]*(o.scale?.[2]??1)/2+clearance}];
  });
  const walkable = (room: string,p: Vec2, opening?:{wall?:string}) => {
    if ((!opening && !insidePolygon(p,rooms.get(room)??[])) || !floor.robot.reachable.includes(room)) return false;
    if (solids.some(s=>(!opening?.wall || s.id!==opening.wall) && insidePolygon(p,s.polygon))) return false;
    if (walls.some(w=>(!opening?.wall || w.id!==opening.wall) && edgeDistance(p,w.a,w.b) < clearance+(w.thickness??0)/2)) return false;
    return !boxes.some(box=>{
      const dx=p[0]-box.p[0], dz=p[1]-box.p[1];
      return Math.abs(dx*box.cos-dz*box.sin)<box.w && Math.abs(dx*box.sin+dz*box.cos)<box.d;
    });
  };
  function furnitureClear(a:Vec2,b:Vec2) {
    return boxes.every(box=>{
      const local=(p:Vec2):Vec2=>[(p[0]-box.p[0])*box.cos-(p[1]-box.p[1])*box.sin,
        (p[0]-box.p[0])*box.sin+(p[1]-box.p[1])*box.cos];
      const start=local(a),end=local(b);
      let lo=0,hi=1;
      for(const axis of [0,1] as const){
        const half=axis===0?box.w:box.d, delta=end[axis]-start[axis];
        if(Math.abs(delta)<1e-9){if(Math.abs(start[axis])>=half) return true;continue;}
        const left=(-half-start[axis])/delta,right=(half-start[axis])/delta;
        lo=Math.max(lo,Math.min(left,right));hi=Math.min(hi,Math.max(left,right));
        if(hi<lo) return true;
      }
      return false;
    });
  }
  return {walkable,furnitureClear,rooms,walls,floor};
}
export type WalkingMap = ReturnType<typeof walkingMap>;
type Point = TwinWalkGuide["remaining"][number];
const distance = (a: Vec2, b: Vec2) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const cell = 0.15;

export function walkingMap(floor: FloorPlan, scene: SceneJson, footprint?: (type: string) => Vec2 | undefined) {
  const { walkable, furnitureClear, walls } = walkingGeometry(scene, footprint);
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
  function nearestStart(p: Vec2, inRoom: string, gates: Portal[]): Vec2 | null {
    if (clear(p,p,inRoom,gates)) return p;
    let best: Vec2 | null = null;
    let radius = 0.600001;
    for (let x=-4;x<=4;x++) for (let z=-4;z<=4;z++) {
      const offset = Math.hypot(x,z)*cell;
      if (offset >= radius) continue;
      const q: Vec2 = [p[0]+x*cell,p[1]+z*cell];
      if (room(q) !== inRoom || !clear(q,q,inRoom,gates)) continue;
      if (walls.some(w=>edgeDistance(q,w.a,w.b) < 0.18 || segmentsCross(p,q,w.a,w.b))) continue;
      best=q;
      radius=offset;
    }
    return best;
  }
  // A bearing names a doorway or standing point; it makes no claim that the straight segment is walkable.
  const bearings = new WeakSet<Point>();
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
      const gates = [lastGate,gate].filter((g):g is Portal=>!!g);
      const raw = end[i-1]!;
      const start = i===1 ? nearestStart(raw,current,gates) : raw;
      const grid = start && indoor(start,p,current,gates);
      const points = grid ?? [p];
      const firstIndex = remaining.length;
      for (let j = 0; j < points.length - 1; j++) {
        const [x,z] = points[j]!;
        remaining.push({ kind: "via", room: current, position: [x, height(current), z] });
      }
      const position: [number, number, number] = [p[0], height(next), p[1]];
      remaining.push(
        gate
          ? { kind: "portal", id: gate.id, from_room: current, to_room: next, position }
          : { kind: "stand", room: current, position }
      );
      if (!grid || start !== raw) bearings.add(remaining[firstIndex]!);
      current = next;
      lastGate = gate;
    }
    return remaining.length ? { revision: 0, near_m, remaining: remaining as TwinWalkGuide["remaining"] } : null;
  }
  return { room, plan, clear, isBearing: (point:Point)=>bearings.has(point),
    gridReachable: (a:Vec2,b:Vec2,id:string,gates:Portal[]=[])=>indoor(a,b,id,gates)!==null, gate: (id: string) => floor.portals.find((g) => g.id === id), doorRadius };
}
