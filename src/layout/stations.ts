import { z } from "zod";
import type { SceneJson, Vec2 } from "../contract/layout.js";
import type { StationMap } from "../contract/stations.js";
import { insidePolygon } from "./home-plan.js";
import { edgeDistance, edges, walkingGeometry, walkingMap } from "./walk-guide.js";

const point = z.tuple([z.number(), z.number()]);
const name = z.string().trim().min(1);
const keys = z.array(name);
const station = z.strictObject({
  id: name, name, room: name, roles: z.array(z.enum(["standby","observe"])).nonempty(),
  position: point, look_at: point, surfaces: keys, rooms: keys, observes_zone_ids: keys.default([]),
});
const shape = z.strictObject({
  version: z.literal(1), stations: z.array(station), kitchen_entry: name.nullable().default(null), meal_watch: name.nullable().default(null),
  zones: z.array(z.strictObject({id: name, name, room: name, polygon: z.array(point).min(3)})).default([]),
  surface_fronts: z.array(z.strictObject({surface_id: name, room: name, position: point, look_at: point, near_m: z.number().positive()})).default([]),
});

function crossing(a: Vec2,b: Vec2,c: Vec2,d: Vec2) {
  const side = (u: Vec2,v: Vec2,w: Vec2) => (v[0]-u[0])*(w[1]-u[1])-(v[1]-u[1])*(w[0]-u[0]);
  return (side(a,b,c)*side(a,b,d)<0 && side(c,d,a)*side(c,d,b)<0)
    || Math.min(edgeDistance(a,c,d),edgeDistance(b,c,d),edgeDistance(c,a,b),edgeDistance(d,a,b)) < 1e-8;
}
/** A fresh point outside all named zones is distinct from an uncertain boundary. */
export function locateZone(map: StationMap, room: string | null, p: Vec2 | null, marginM: number): string | false | null {
  if (!p || !room || !Number.isFinite(marginM) || marginM < 0) return null;
  const candidates = map.zones.filter(z => z.room === room);
  if (candidates.some(z=>edges(z.polygon).some(([a,b])=>edgeDistance(p,a,b)<=marginM))) return null;
  const inside = candidates.filter(z=>insidePolygon(p,z.polygon));
  return inside.length === 1 ? inside[0]!.id : inside.length === 0 ? false : null;
}
export function zoneAt(map: StationMap, room: string | null, p: Vec2 | null, marginM: number): string | null {
  return locateZone(map,room,p,marginM) || null;
}
export function standbyFor(map: StationMap, room: string) {
  return map.stations.find(s => s.room===room && s.roles.includes("standby")) ?? null;
}
function unique(values: string[]) {
  if (new Set(values).size !== values.length) throw new Error("같은 자리 이름이나 항목이 둘 있어요.");
}
export function validateStations(raw: unknown, scene: SceneJson, footprintOf?: (type: string)=>Vec2 | undefined): StationMap {
  const map = shape.parse(raw);
  const {walkable,rooms,walls,floor} = walkingGeometry(scene, footprintOf);
  unique([...map.stations.map(s=>s.id),...map.zones.map(z=>z.id)]);
  unique(map.surface_fronts.map(f=>f.surface_id));
  unique(map.stations.filter(s=>s.roles.includes("standby")).map(s=>s.room));
  for (const z of map.zones) {
    const polygon = rooms.get(z.room) ?? [];
    const sides = edges(z.polygon);
    if (z.polygon.some(p=>!insidePolygon(p,polygon)) ||
        sides.some(([a,b],i)=>edgeDistance(a,b,b)<1e-8 || edges(polygon).some(([c,d])=>crossing(a,b,c,d)) ||
          sides.some(([c,d],j)=>j>i+1 && !(i===0 && j===sides.length-1) && crossing(a,b,c,d))) ||
        Math.abs(sides.reduce((sum,[a,b])=>sum+a[0]*b[1]-a[1]*b[0],0))<1e-8)
      throw new Error(z.name+" 구역의 꼭짓점을 확인해 주세요.");
  }
  for (const p of [...map.stations,...map.surface_fronts]) {
    if (!walkable(p.room,p.position) || !floor.rooms.some(r=>insidePolygon(p.look_at,r.polygon)) ||
        Math.hypot(p.position[0]-p.look_at[0],p.position[1]-p.look_at[1])<1e-6)
      throw new Error(("id" in p ? p.id : p.surface_id)+"의 설 자리와 바라볼 곳을 다시 골라 주세요.");
  }
  for (const s of map.stations) {
    for (const list of [s.roles,s.surfaces,s.rooms,s.observes_zone_ids]) unique(list);
    for (const zone of map.zones.filter(z=>s.observes_zone_ids.includes(z.id))) {
      if (insidePolygon(s.position,zone.polygon) || edges(zone.polygon).some(([a,b])=>edgeDistance(s.position,a,b)<1e-8))
        throw new Error(s.name+"의 설 자리는 관찰 구역 밖에 두세요.");
    }
    if (s.rooms.some(r=>!rooms.has(r)) || s.surfaces.some(id=>!floor.objects.has(id)) ||
        s.observes_zone_ids.some(id=>!map.zones.some(z=>z.id===id && (z.room===s.room || s.rooms.includes(z.room)))))
      throw new Error(s.name+"에서 볼 방·가구·구역을 확인해 주세요.");
  }
  const grid = map.surface_fronts.length ? walkingMap(floor,scene,footprintOf) : null;
  for (const front of map.surface_fronts) {
    const target = floor.objects.get(front.surface_id);
    if (target?.room!==front.room || walls.some(w=>crossing(front.position,target.basin??target.position,w.a,w.b)))
      throw new Error("같은 방에서 가구를 쓸 수 있는 앞자리를 골라 주세요.");
    const gates=floor.portals.filter(g=>g.rooms.includes(front.room));
    const stations=map.stations.filter(s=>s.room===front.room);
    if (!gates.some(g=>grid!.gridReachable(front.position,g.point,front.room,[g])) &&
        !stations.some(s=>grid!.gridReachable(front.position,s.position,front.room)))
      throw new Error(front.surface_id+" 앞에 걸어갈 수 있는 통로가 없어요.");
  }
  for (const id of [map.meal_watch,map.kitchen_entry])
    if (id && !map.stations.some(s=>s.id===id && s.roles.includes("observe"))) throw new Error("관찰 자리를 골라 주세요.");
  return map;
}
