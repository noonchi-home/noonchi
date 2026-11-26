import type { SceneJson, SceneObject, Vec2 } from "../contract/layout.js";
import type { TwinWalkGuide } from "../contract/phone.js";
import type { StationMap } from "../contract/stations.js";
import { floorPlanFrom, insidePolygon, sharedOpening, type FloorPlan, type Portal } from "./floor.js";
import { approach, roomAt, route } from "./route.js";
import { gridRoute, walkWay } from "./walk-grid.js";

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
/** 걷기 장애물이 아닌 바닥 가구: 식탁 의자는 밀고 지나간다고 본다(한양목련은 의자를 막으면 주방과 거실 사이 길이 끊긴다). */
export const WALK_THROUGH_TYPES: ReadonlySet<string> = new Set(["dining_chair"]);
export function walkingGeometry(scene: SceneJson, footprintOf?: (type: string)=>Vec2 | undefined) {
  const floor = floorPlanFrom(scene);
  const rooms = new Map(floor.rooms.map(r=>[r.id,r.polygon]));
  const rawWalls = (scene.plan.walls ?? []) as {id:string; a: Vec2 | null; b: Vec2 | null; polygon?: Vec2[]; thickness?: number}[];
  const solids = rawWalls.flatMap(w=>w.polygon ? [{id:w.id,polygon:w.polygon}] : []);
  const walls = rawWalls.flatMap(w=>w.a && w.b ? [{id:w.id,a:w.a,b:w.b,thickness:w.thickness??0}] :
    edges(w.polygon??[]).map(([a,b])=>({id:w.id,a,b,thickness:0})));
  const obstacles = (scene.objects as SceneObject[]).filter(o=>o.mount==="floor" && o.room && (o.plan.elevation??0)<1.8 && !WALK_THROUGH_TYPES.has(o.type));
  const boxes=obstacles.flatMap(o=>{
    const dims=o.footprint??footprintOf?.(o.type);
    if(!dims) return [];
    const yaw=o.rotation?.[1]??(90-o.plan.facing_deg)*Math.PI/180;
    return [{p:o.plan.position,cos:Math.cos(yaw),sin:Math.sin(yaw),
      w:dims[0]*(o.scale?.[0]??1)/2+clearance,d:dims[1]*(o.scale?.[2]??1)/2+clearance}];
  });
  /** furniture=false: 벽·방만 본다(가구 칸이 막혀 길을 못 찾을 때 벽을 지나지 않는 길을 고르는 데 쓴다). */
  const walkable = (room: string,p: Vec2, opening?:{wall?:string}, furniture = true) => {
    if ((!opening && !insidePolygon(p,rooms.get(room)??[])) || !floor.robot.reachable.includes(room)) return false;
    if (solids.some(s=>(!opening?.wall || s.id!==opening.wall) && insidePolygon(p,s.polygon))) return false;
    if (walls.some(w=>(!opening?.wall || w.id!==opening.wall) && edgeDistance(p,w.a,w.b) < clearance+(w.thickness??0)/2)) return false;
    return !furniture || !boxes.some(box=>{
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
  /** 문(벽에 난 개구부): 문 점은 floor.portals의 같은 id 점이다. 걸을 때 이 벽 여유는 문 개구부에서만 뺀다(walkable opening). */
  const doors = ((scene.plan.doors ?? []) as {id:string; wall?:string; width?:number}[]).map(d=>({id:d.id,wall:d.wall,width:d.width??0}));
  return {walkable,furnitureClear,rooms,walls,floor,doors};
}
export type WalkingMap = ReturnType<typeof walkingMap>;
type Point = TwinWalkGuide["remaining"][number];
const distance = (a: Vec2, b: Vec2) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const cell = 0.15;

export function walkingMap(floor: FloorPlan, scene: SceneJson, footprint?: (type: string) => Vec2 | undefined) {
  // 걷기 길 자료(격자·가구 앞자리·방 대기 자리)는 계획 선과 같은 walkWay로 만든다: 방 안 길은 같은 이동 가능 점 격자를 따르고(경유점은 모두 격자 점),
  // 폰 안내의 이동 목적지도 같은 moveStop으로 정한다(src/act/track/core.ts walk)
  const way = walkWay(scene as SceneJson & { stations?: StationMap }, footprint);
  const { geometry, grid } = way;
  const { walkable, furnitureClear, walls } = geometry;
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
  /** p가 그 문의 문간인가: 문 점 가까이(원래 규칙), 또는 문이 난 벽을 따라 문 점에서 doorRadius 안이고 그 벽의 여유 폭 안(문 앞에서 곧게 들어서는 길).
   *  문 점 둘레만 보면 벽 여유 폭(0.18m + 벽 두께 절반)이 문 원보다 넓어 문 앞에서 문까지 곧게 갈 수 없었다(곧은 선이 벽을 지나는 안내가 됐다). */
  function inDoorway(p: Vec2, g: Portal): boolean {
    const r = doorRadius(g);
    if (distance(p, g.point) <= Math.min(0.3, r)) return true;
    const wallId = doors.find((d) => d.id === g.id)?.wall;
    if (!wallId || r <= 0) return false;
    return walls.some((w) => {
      if (w.id !== wallId) return false;
      const dx = w.b[0] - w.a[0], dz = w.b[1] - w.a[1], len = Math.hypot(dx, dz);
      if (!len) return false;
      const along = (q: Vec2) => ((q[0] - w.a[0]) * dx + (q[1] - w.a[1]) * dz) / len;
      return edgeDistance(g.point, w.a, w.b) < 0.05 && Math.abs(along(p) - along(g.point)) <= r && edgeDistance(p, w.a, w.b) <= clearance + (w.thickness ?? 0) / 2 + 0.02;
    });
  }
  function clear(a: Vec2, b: Vec2, inRoom: string, gates: Portal[] = [], furniture = true) {
    if(furniture && !furnitureClear(a,b)) return false;
    const n = Math.max(1, Math.ceil(distance(a, b) / 0.06));
    for (let i = 0; i <= n; i++) {
      const p: Vec2 = [a[0] + ((b[0] - a[0]) * i) / n, a[1] + ((b[1] - a[1]) * i) / n];
      const opening = gates.find((g) => inDoorway(p, g));
      if (!walkable(inRoom, p, opening ? { wall: doors.find((d) => d.id === opening.id)?.wall } : undefined, furniture))
        return false;
    }
    return true;
  }
  /** 방 안 a → b 길의 경유점과 b. 격자 길(그 방 격자 점만, 꺾이는 점만)이다. furniture=false(가구 칸으로 길이 막힌 뒤 벽만 보는 길)는 아래 looseIndoor. */
  function indoor(a: Vec2, b: Vec2, inRoom: string, gates: Portal[], furniture = true): Vec2[] | null {
    if (!furniture) return looseIndoor(a, b, inRoom, gates);
    const way = gridRoute(grid, geometry, a, b, { room: inRoom });
    return way ? way.slice(1) : null;
  }
  // 가구를 보지 않는 길(길 없음 처리): 곧은 선이 막혔을 때만 시작점 기준 0.15m 칸을 찾고, 건너뛰기마다 다시 본다.
  function looseIndoor(a: Vec2, b: Vec2, inRoom: string, gates: Portal[]): Vec2[] | null {
    const furniture = false;
    const pass = (x: Vec2, y: Vec2) => clear(x, y, inRoom, gates, furniture);
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
  /** 문 앞 자리: 그 방 쪽에서 문 점까지 벽을 지나지 않고 곧게 갈 수 있는 점(문 점에서 0.5m). 가구는 보지 않는다. */
  function doorFront(gate: Portal, inRoom: string, gates: Portal[], from: Vec2): Vec2 | null {
    let best: Vec2 | null = null;
    for (let k = 0; k < 16; k++) {
      const q: Vec2 = [gate.point[0] + 0.5 * Math.cos((k * Math.PI) / 8), gate.point[1] + 0.5 * Math.sin((k * Math.PI) / 8)];
      if (room(q) !== inRoom || !clear(q, gate.point, inRoom, gates, false)) continue;
      if (!best || distance(q, from) < distance(best, from)) best = q;
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
    // 물건 앞 설 자리(approach)가 가구 여유 폭 안이면 0.6m 안에서 설 수 있는 가장 가까운 점으로 옮긴다(냉장고처럼 앞 자리가 없는 물건).
    if (!exact) {
      const n = end.length - 1, at = end[n]!, inRoom = room(at);
      if (inRoom && !walkable(inRoom, at)) {
        let best: Vec2 | null = null;
        for (let x = -12; x <= 12; x++)
          for (let z = -12; z <= 12; z++) {
            const q: Vec2 = [Math.round((at[0] + x * 0.05) * 1000) / 1000, Math.round((at[1] + z * 0.05) * 1000) / 1000];
            if (distance(q, at) > 0.6 || (best && distance(q, at) >= distance(best, at))) continue;
            if (room(q) === inRoom && walkable(inRoom, q)) best = q;
          }
        if (best) end[n] = best;
      }
    }
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
      // 폰이 문간에 서 있으면(그 문을 넣어야 설 수 있는 벽 여유 안) 격자 길은 문을 보지 않아 벽 여유를 지나는 문 앞 경유점을 낸다: 문을 넣고 곧게 갈 수 있으면 곧은 선이다
      const doorway = i === 1 && start === raw && !clear(raw, raw, current) && clear(raw, p, current, gates);
      let grid = doorway ? [p] : start && indoor(start,p,current,gates);
      // 가구 칸으로 길이 막히면 벽만 보는 길을, 그것도 없으면 문 앞 자리를 지난다: 곧은 선이 벽을 지나는 안내를 내지 않는다.
      // 이 점들은 가구를 지날 수 있어 모두 bearing이다(지나는 곧은 선을 걸을 수 있다고 하지 않는다).
      let loose = false;
      if (!grid) {
        grid = indoor(start ?? raw, p, current, gates, false);
        if (!grid && gate) {
          const front = doorFront(gate, current, gates, start ?? raw);
          if (front) grid = [front, p];
        }
        loose = !!grid;
      }
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
      if (loose) for (let k = firstIndex; k < remaining.length; k++) bearings.add(remaining[k]!);
      else if (!grid || start !== raw) bearings.add(remaining[firstIndex]!);
      current = next;
      lastGate = gate;
    }
    return remaining.length ? { revision: 0, near_m, remaining: remaining as TwinWalkGuide["remaining"] } : null;
  }
  return { room, plan, clear, way, isBearing: (point:Point)=>bearings.has(point),
    gridReachable: (a:Vec2,b:Vec2,id:string,gates:Portal[]=[])=>indoor(a,b,id,gates)!==null, gate: (id: string) => floor.portals.find((g) => g.id === id), doorRadius,
    /** 실제 문 개구부 절반 폭(문 폭 / 2, 트인 경계는 맞닿은 길이 / 2): 문 점에서 이 거리 안으로 방 경계를 건너면 문으로 지난 것이다. */
    openingHalf: (portal: Portal) => (widths.get(portal.id) ?? 0) / 2 };
}
