// 집 평면 색인(순수 함수): 서버 장면(/api/scene)의 방 다각형·바닥 높이와 물건 자리 → 방 찾기, 물건이 든 방, 방마다 구운 보기 그림 위 모양.
// 평면 [x, z] 미터. 그림 픽셀은 twin3d/projection.ts planToPixel(구운 보기 카메라)로 바꾼다.
import type { XZ } from "../../../src/contract/plan.ts";
import { pathOf, planToPixel, polygonToPixels, type OrthoCamera } from "../twin3d/projection";

export interface HomeRoom { id: string; label: string; floor: number; polygon: XZ[] }

/** 기본 보기에서 벽을 자른 높이(m). 방 모양을 이 높이까지 세워서 어둡게 칠한다. */
export const WALL_CUT_M = 1.05;

type Px = [number, number];

/** 평면 점이 든 방 id(src/plan/route.ts roomAt과 같은 짝수 교차 규칙). 없으면 null. */
export function roomAt([x, z]: XZ, rooms: HomeRoom[]): string | null {
  for (const r of rooms) {
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

/** 화면 넓이 부호(+면 화면에서 시계 방향, v가 아래로 커지므로). */
const signedArea = (pts: Px[]) => pts.reduce((a, [u, v], i) => { const [u2, v2] = pts[(i + 1) % pts.length]!; return a + (u * v2 - u2 * v); }, 0) / 2;
const clockwise = (pts: Px[]) => (signedArea(pts) < 0 ? [...pts].reverse() : pts);

/**
 * 방 하나의 그림 위 모양: 바닥 다각형, 잘린 벽 높이의 윗면 다각형, 그 사이 옆면 사각형들.
 * path는 모두 시계 방향으로 맞춘 하위 경로라 fill-rule nonzero로 칠하면 합집합이 된다.
 */
export interface RoomShape { id: string; label: string; floor: Px[]; top: Px[]; sides: Px[][]; path: string; center: Px }

export function roomShape(room: HomeRoom, cam: OrthoCamera, height = WALL_CUT_M): RoomShape {
  const floor = polygonToPixels(cam, room.polygon, room.floor);
  const top = polygonToPixels(cam, room.polygon, height);
  const sides = floor.map((p, i) => [p, floor[(i + 1) % floor.length]!, top[(i + 1) % top.length]!, top[i]!] as Px[]);
  const path = [floor, top, ...sides].map((pts) => pathOf(clockwise(pts))).join("");
  const cx = room.polygon.reduce((a, p) => a + p[0], 0) / room.polygon.length;
  const cz = room.polygon.reduce((a, p) => a + p[1], 0) / room.polygon.length;
  return { id: room.id, label: room.label, floor, top, sides, path, center: planToPixel(cam, [cx, cz], room.floor) };
}

/** 여러 방을 한 path로(합집합). 어둡게 칠할 방들, 밝힐 방들 모두 이것으로 그린다. */
export function roomsPath(ids: Iterable<string>, shapes: RoomShape[]): string {
  const want = new Set(ids);
  return shapes.filter((s) => want.has(s.id)).map((s) => s.path).join("");
}

/** 밝힐 방을 뺀 나머지 방 id. */
export const otherRooms = (bright: string[], shapes: RoomShape[]) => shapes.map((s) => s.id).filter((id) => !bright.includes(id));

export interface HomeIndex {
  rooms: HomeRoom[];
  shapes: RoomShape[];
  /** 평면 자리가 있는 물건(가전 포함): 든 방, 평면 자리, 이름. */
  objects: Map<string, { room: string | null; position: XZ; name: string }>;
  roomAt(p: XZ): string | null;
  /** 물건이 든 방: 장면의 room, 없으면 평면 자리로 찾은 방. 모르는 물건이면 null. */
  roomOf(id: string): string | null;
}

type SceneObject = { id?: unknown; name?: unknown; room?: unknown; plan?: { position?: unknown } };
const isXZ = (p: unknown): p is XZ => Array.isArray(p) && p.length === 2 && p.every((v) => typeof v === "number");

/** 서버 장면 → 집 평면 색인. 방 모양은 구운 보기 카메라(cam) 그림 픽셀이다. */
export function homeIndexOf(scene: { plan: { rooms?: { id: string; label?: string; polygon?: XZ[]; floor_z?: number }[] }; objects: unknown[] }, cam: OrthoCamera): HomeIndex {
  const rooms: HomeRoom[] = (scene.plan.rooms ?? [])
    .filter((r) => (r.polygon?.length ?? 0) >= 3)
    .map((r) => ({ id: r.id, label: r.label ?? r.id, floor: r.floor_z ?? 0, polygon: r.polygon! }));
  const shapes = rooms.map((r) => roomShape(r, cam));
  const objects: HomeIndex["objects"] = new Map();
  for (const raw of scene.objects as SceneObject[]) {
    const position = raw.plan?.position;
    if (typeof raw.id !== "string" || !isXZ(position)) continue;
    objects.set(raw.id, { room: typeof raw.room === "string" ? raw.room : null, position, name: typeof raw.name === "string" && raw.name ? raw.name : raw.id });
  }
  const at = (p: XZ) => roomAt(p, rooms);
  return {
    rooms, shapes, objects,
    roomAt: at,
    roomOf: (id) => { const o = objects.get(id); return o ? o.room ?? at(o.position) : null; },
  };
}
