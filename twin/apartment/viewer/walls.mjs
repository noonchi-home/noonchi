// 벽 보기 판정(자동·전체·낮춤, 방 초점)과 벽에 딸린 객체 숨기기·자르기. 순수 함수다.
//
// 벽 면 법선은 평면도 좌표 [nx, ny]이고 방 안쪽을 향한다. three.js로는 (nx, 0, ny)다.
// 안쪽 면 법선이 카메라 쪽(수평 내적 > 0.3)이면 그 벽은 방의 '뒤쪽 벽'이라 세워도 방을 가리지 않는다.

import { parseProp } from "./scene.mjs";

export const FACING_THRESHOLD = 0.3;

// 바라보는 점 → 카메라의 수평 단위 벡터(평면도 x, y = three.js x, z). 바로 위면 [0, 0].
export function cameraHeading(position, target) {
  const dx = position[0] - target[0];
  const dz = position[2] - target[2];
  const len = Math.hypot(dx, dz);
  return len < 1e-9 ? [0, 0] : [dx / len, dz / len];
}

export function facesCamera(face, heading, threshold = FACING_THRESHOLD) {
  const [nx, ny] = face.normal;
  return nx * heading[0] + ny * heading[1] > threshold;
}

// mode: auto | full | low. focus: 초점 방 id(없으면 null). 낮춤은 사용자가 고른 방식이라 초점보다 앞선다.
export function upperVisible(wall, { mode = "auto", heading, focus = null }) {
  if (mode === "full") return true;
  if (mode === "low") return false;
  const faces = wall.faces ?? [];
  if (wall.kind === "exterior" && faces.some((f) => facesCamera(f, heading))) return true;
  return Boolean(focus) && faces.some((f) => f.room === focus && facesCamera(f, heading));
}

export function wallVisibility(walls, options) {
  return new Map(walls.map((w) => [w.id, upperVisible(w, options)]));
}

// 잘라 보는 평면에서는 통로를 보이되, 문과 붙박이 옷장의 형상은 온전히 남긴다.
export function furnitureAction(entry, doorIds) {
  if (entry.type === "dining_chair") return "hide";
  if (doorIds.has(entry.id) || /^wardrobe(?:_\d+)?$/.test(entry.type ?? "")) return "none";
  return null;
}

// 평면도 벽 id의 위쪽이 보이는지. 벽이 조각(I05_0, I05-a …)으로 나뉘었으면 한 조각이라도 보이면 보인다.
// 모르는 벽이면 undefined.
function wallUpper(upperByWall, wall) {
  if (upperByWall.has(wall)) return upperByWall.get(wall);
  const pieces = [...upperByWall].filter(([id]) => id.length > wall.length && id.startsWith(wall)
    && "_-.".includes(id[wall.length]));
  return pieces.length ? pieces.some(([, shown]) => shown) : undefined;
}

// 위쪽이 숨은 벽에 딸린 객체: 'hide'(숨김) | 'clip'(잘라 보기 높이에서 자름) | 'none'
// - 계약: 벽 걸이 장식(아래쪽 높이 > 잘라 보기 높이)은 숨긴다. 가전은 상태를 봐야 하므로 그대로 둔다.
// - 뷰어 확장: 같은 높이의 벽 걸이 가구·설비(상부장·거울장)도 숨기고, 잘라 보기 높이를 걸치는
//   문·창(opening)과 커튼(벽 걸이)은 그 높이에서 자른다. 낮춘 벽 위로 튀어나오지 않게 하려는 것이다.
// - 상태가 있는 객체(블라인드 등)는 가전처럼 숨기지 않는다. 잘라도 아래쪽이 남아 상태가 보인다.
export function cutAction(entry, upperByWall, cutHeight, wallOf = new Map()) {
  if (entry.category === "appliances") return "none";
  if (entry.mount !== "wall" && entry.mount !== "opening") return "none";
  const wall = entry.plan?.wall ?? wallOf.get(entry.id);
  if (!wall || wallUpper(upperByWall, wall) !== false) return "none";
  if (entry.mount === "wall" && (entry.plan?.elevation ?? 0) > cutHeight) {
    return Object.keys(entry.states ?? {}).length ? "none" : "hide";
  }
  return "clip";
}

// 천장 객체(mount=ceiling)는 그 방에 초점을 맞췄거나 '천장 보기'일 때만 보인다.
export function ceilingVisible(entry, { focus = null, showCeiling = false }) {
  if (entry.mount !== "ceiling") return true;
  return showCeiling || (Boolean(focus) && entry.room === focus);
}

// 점이 다각형 안에 있는가(짝홀 규칙). polygon: [[x, y], ...] 평면도 좌표
export function insidePolygon([x, y], polygon) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, yi] = polygon[i];
    const [xj, yj] = polygon[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export const OPENING_PROBE = 0.1; // 벽면에서 맞닿은 방을 찾으러 더 나가는 거리(m)

// 문·창(mount = opening) id → 맞닿은 방 id 목록. Blender stage.opening_rooms와 같다:
// 문의 connects, 객체 room, 그리고 벽 두께 양쪽으로 OPENING_PROBE만큼 더 나간 점(facing_deg 방향과 반대)이
// 든 방. 사이벽 창(서재 창)은 양쪽 방에 맞닿는다.
export function openingRooms(plan, objects) {
  const thickness = new Map((plan.walls ?? []).map((w) => [w.id, w.thickness]));
  const connects = new Map((plan.doors ?? []).map((d) => [d.id, d.connects ?? []]));
  const result = new Map();
  for (const entry of objects) {
    if (entry.mount !== "opening") continue;
    const rooms = new Set(connects.get(entry.id) ?? []);
    if (entry.room) rooms.add(entry.room);
    const [x, y] = entry.plan?.position ?? [];
    if (Number.isFinite(x) && Number.isFinite(y)) {
      const reach = (thickness.get(entry.plan?.wall) || 0.2) / 2 + OPENING_PROBE;
      const a = ((entry.plan?.facing_deg ?? 0) * Math.PI) / 180;
      for (const sign of [1, -1]) {
        const p = [x + sign * reach * Math.cos(a), y + sign * reach * Math.sin(a)];
        const room = (plan.rooms ?? []).find((r) => insidePolygon(p, r.polygon ?? []));
        if (room) rooms.add(room.id);
      }
    }
    result.set(entry.id, [...rooms]);
  }
  return result;
}

// 초점 방만 보기(isolate): 초점이 있으면 다른 방의 객체를 숨긴다. 옆방의 높은 가구(옷장 등)가 낮춘 벽 너머로
// 초점 방을 가리지 않게 하려는 것이다. 구조(벽·바닥)와 초점 방에 맞닿은 문·창(connects = openingRooms)은 남긴다.
export function focusVisible(entry, { focus = null, isolate = false, connects = new Map() }) {
  if (!focus || !isolate || entry.category === "structure" || !entry.room) return true;
  return entry.room === focus || (connects.get(entry.id) ?? []).includes(focus);
}

// 이름 끝이 lower/upper(Blender .001 → 001, GLTFLoader 중복 → _1)이거나 part 라벨이 같은 자식
const PART_NAME = { lower: /lower(_?\d+)?$/i, upper: /upper(_?\d+)?$/i };

function* walk(node) {
  yield node;
  for (const child of node.children ?? []) yield* walk(child);
}

export function findWallParts(wallNode) {
  const result = { lower: null, upper: null };
  const nodes = [...walk(wallNode)].slice(1);
  for (const key of ["lower", "upper"]) {
    result[key] = nodes.find((n) => n.userData?.part === key)
      ?? nodes.find((n) => PART_NAME[key].test(n.name ?? "")) ?? null;
  }
  return result;
}

// 벽 조각 노드(wall_<id>): extras.wall이 있으면 그것, 없으면 scene.json plan.walls의 같은 id
export function collectWalls(root, planWalls = []) {
  const planById = new Map(planWalls.map((w) => [w.id, w]));
  const found = [];
  const seen = new Set();
  for (const node of walk(root)) {
    let info = parseProp(node.userData?.wall);
    if (!info) {
      const match = /^wall_(.+)$/.exec(node.name ?? "");
      info = match ? planById.get(match[1]) : null;
    }
    if (!info || seen.has(info.id)) continue;
    seen.add(info.id);
    const { lower, upper } = findWallParts(node);
    found.push({ id: info.id, kind: info.kind, faces: info.faces ?? planById.get(info.id)?.faces ?? [], node, lower, upper });
  }
  return found;
}
