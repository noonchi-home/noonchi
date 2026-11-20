// scene.json(twin-studio 집 산출물) → 경로 찾기에 쓰는 평면도. 좌표는 plan과 같은 [x, z] 미터.
import type { XZ } from "../contract/plan.js";

/** 평면 점이 다각형 안인지(짝홀 규칙). */
export function insidePolygon([x, y]: XZ, poly: number[][]): boolean {
  let hit = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i]!, [xj, yj] = poly[j]!;
    if ((yi! > y) !== (yj! > y) && x < ((xj! - xi!) * (y - yi!)) / (yj! - yi!) + xi!) hit = !hit;
  }
  return hit;
}

export interface Portal { id: string; rooms: [string, string]; point: XZ }
export interface FloorPlan {
  rooms: { id: string; polygon: XZ[] }[];
  portals: Portal[];
  /** basin: 싱크볼 가운데(장면 물건 anchors.basin, 평면도 점). 싱크볼이 있는 싱크대만. */
  objects: Map<string, { id: string; type: string; room: string | null; position: XZ; basin?: XZ }>;
  /** 로봇·충전대 물건이 없으면 position은 null(자리를 지어내지 않는다). */
  robot: { position: XZ | null; room: string | null; reachable: string[] };
}

type Room = { id: string; polygon: XZ[]; floor_z?: number };
type Scene = {
  plan?: { rooms?: Room[]; doors?: { id: string; position: XZ; connects: string[] }[]; open_edges?: [string, string][]; robot?: { dock?: string; reachable_rooms?: string[] } };
  objects?: { id: string; type: string; room?: string | null; plan?: { position?: XZ }; anchors?: { basin?: unknown } }[];
};

const EPS = 0.06;

/** 두 다각형이 맞닿은 변들 중 가장 길게 겹치는 구간의 가운데. 없으면 null. */
export function sharedEdgeMidpoint(a: XZ[], b: XZ[]): XZ | null {
  return sharedOpening(a,b)?.mid??null;
}
export function sharedOpening(a:XZ[],b:XZ[]):{mid:XZ;len:number}|null {
  let best: { len: number; mid: XZ } | null = null;
  const segs = (p: XZ[]) => p.map((q, i) => [q, p[(i + 1) % p.length]!] as [XZ, XZ]);
  for (const [p1, p2] of segs(a)) {
    const dx = p2[0] - p1[0];
    const dz = p2[1] - p1[1];
    const len = Math.hypot(dx, dz);
    if (len < EPS) continue;
    const ux = dx / len;
    const uz = dz / len;
    for (const [q1, q2] of segs(b)) {
      const off = (q: XZ) => Math.abs((q[0] - p1[0]) * uz - (q[1] - p1[1]) * ux);
      if (off(q1) > EPS || off(q2) > EPS) continue;
      const t = (q: XZ) => (q[0] - p1[0]) * ux + (q[1] - p1[1]) * uz;
      const lo = Math.max(0, Math.min(t(q1), t(q2)));
      const hi = Math.min(len, Math.max(t(q1), t(q2)));
      if (hi - lo > EPS && (!best || hi - lo > best.len)) {
        const m = (lo + hi) / 2;
        best = { len: hi - lo, mid: [Math.round((p1[0] + ux * m) * 1000) / 1000, Math.round((p1[1] + uz * m) * 1000) / 1000] };
      }
    }
  }
  return best;
}

/** reachable_rooms가 없는 집: 바닥 높이가 0이고(단차 있는 발코니·현관 제외) 욕실이 아닌 방. */
export function defaultReachable(rooms: Room[]): string[] {
  return rooms.filter((r) => (r.floor_z ?? 0) === 0 && !r.id.startsWith("bath")).map((r) => r.id);
}

export function floorPlanFrom(scene: unknown): FloorPlan {
  const s = scene as Scene;
  const rooms = s.plan?.rooms ?? [];
  const byId = new Map(rooms.map((r) => [r.id, r]));
  const portals: Portal[] = [];
  for (const d of s.plan?.doors ?? []) {
    const [a, b] = d.connects;
    if (a && b && byId.has(a) && byId.has(b)) portals.push({ id: d.id, rooms: [a, b], point: d.position });
  }
  for (const [a, b] of s.plan?.open_edges ?? []) {
    const mid = byId.has(a) && byId.has(b) ? sharedEdgeMidpoint(byId.get(a)!.polygon, byId.get(b)!.polygon) : null;
    if (mid) portals.push({ id: `open:${a}:${b}`, rooms: [a, b], point: mid });
  }
  const objects: FloorPlan["objects"] = new Map();
  const xz = (v: unknown): v is XZ => Array.isArray(v) && v.length === 2 && v.every((n) => typeof n === "number" && Number.isFinite(n));
  for (const o of s.objects ?? []) {
    if (!o.plan?.position) continue;
    const basin = o.anchors?.basin;
    objects.set(o.id, { id: o.id, type: o.type, room: o.room ?? null, position: o.plan.position, ...(xz(basin) ? { basin: [basin[0], basin[1]] as XZ } : {}) });
  }
  const dockId = s.plan?.robot?.dock;
  const start = [...objects.values()].find((o) => o.type === "robot") ?? (dockId ? objects.get(dockId) : undefined);
  return {
    rooms: rooms.map((r) => ({ id: r.id, polygon: r.polygon })), portals, objects,
    robot: { position: start?.position ?? null, room: start?.room ?? null, reachable: s.plan?.robot?.reachable_rooms ?? defaultReachable(rooms) },
  };
}
