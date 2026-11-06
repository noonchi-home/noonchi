// 폰 기준점(twin-home 벽 대기 맞춤): 3D에서 누른 벽을 평면도 벽의 방 쪽 면 위 점으로 붙이고, 표시할 핀을 만든다.
// 폰은 실제 그 벽 면에 윗모서리를 대므로 점은 벽 중심선이 아니라 방 쪽 면에 있어야 한다.
// 면은 scene.json plan.walls의 faces(방과 맞닿은 면만)에서 고르므로 바깥벽의 바깥 면은 고르지 않는다.
// DOM·three 없이 node --test로 검사한다.

const finite = (v) => typeof v === "number" && Number.isFinite(v);
const round = (v) => Math.round(v * 1000) / 1000;

/** 벽 노드 id(조각이면 I05_0, I05-a …) → 평면도 벽. 없으면 null. */
export function planWallOf(id, planWalls) {
  const walls = planWalls ?? [];
  return walls.find((w) => w.id === id)
    ?? walls.find((w) => id.length > w.id.length && id.startsWith(w.id) && "_-.".includes(id[w.id.length]))
    ?? null;
}

/** 누른 면의 방향 힌트(평면 [x, y]). 세로 면이면 그 면 법선, 윗면(잘라 보기 높이의 단면)이면 카메라 쪽. */
export function wallHint(normal, heading) {
  const [nx, ny, nz] = normal;
  return Math.abs(ny) > 0.5 ? [heading[0], heading[1]] : [nx, nz];
}

/** 점을 선분 a→b 위로(끝 밖이면 끝으로). [점, 거리²]. 길이가 없으면 null. */
function project(point, [ax, ay], [bx, by]) {
  const dx = bx - ax, dy = by - ay;
  const len2 = dx * dx + dy * dy;
  if (!(len2 > 1e-12)) return null;
  const t = Math.min(1, Math.max(0, ((point[0] - ax) * dx + (point[1] - ay) * dy) / len2));
  const q = [ax + dx * t, ay + dy * t];
  return [q, (q[0] - point[0]) ** 2 + (q[1] - point[1]) ** 2];
}

/** 고체(샤프트·기둥) 다각형에서 바깥 법선이 face와 같은 변 중 가장 가까운 변 위 점. */
function snapToSolid(point, polygon, face) {
  if (polygon.length < 3 || !polygon.every((p) => Array.isArray(p) && finite(p[0]) && finite(p[1]))) return null;
  const area = polygon.reduce((sum, p, i) => {
    const q = polygon[(i + 1) % polygon.length];
    return sum + p[0] * q[1] - q[0] * p[1];
  }, 0);
  let best = null;
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i], b = polygon[(i + 1) % polygon.length];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (!(len > 1e-9)) continue;
    const out = [Math.sign(area) * (b[1] - a[1]) / len, -Math.sign(area) * (b[0] - a[0]) / len];
    if (out[0] * face.normal[0] + out[1] * face.normal[1] < 0.99) continue;
    const hit = project(point, a, b);
    if (hit && (!best || hit[1] < best[1])) best = hit;
  }
  return best ? [round(best[0][0]), round(best[0][1])] : null;
}

/** 누른 점(평면) → 벽 방 쪽 면 위 점 {position, room, normal}. hint와 같은 쪽 면, 벽 끝 밖이면 끝으로.
 *  고체(a·b 대신 polygon)는 그 면과 같은 방향인 변 위로 붙인다. */
export function snapToWall(point, wall, hint) {
  if (!wall) return null;
  const faces = (wall.faces ?? []).filter((f) => Array.isArray(f.normal) && f.normal.every(finite));
  if (!faces.length) return null;
  const face = faces.reduce((best, f) => (f.normal[0] * hint[0] + f.normal[1] * hint[1]
    > best.normal[0] * hint[0] + best.normal[1] * hint[1] ? f : best));
  let position = null;
  if (Array.isArray(wall.a) && Array.isArray(wall.b) && finite(wall.thickness)) {
    const hit = project(point, wall.a, wall.b);
    const half = wall.thickness / 2;
    if (hit) position = [round(hit[0][0] + face.normal[0] * half), round(hit[0][1] + face.normal[1] * half)];
  } else if (Array.isArray(wall.polygon)) {
    position = snapToSolid(point, wall.polygon, face);
  }
  return position ? { position, room: face.room, normal: [...face.normal] } : null;
}

export function planDistance(a, b) {
  return Math.hypot(b[0] - a[0], b[1] - a[1]);
}

/** twin-home 기준점 [{id, label, position}] → 핀 [{id, text, position}]. 쓸 수 없는 것은 뺀다. */
export function touchMarkers(points) {
  return (Array.isArray(points) ? points : [])
    .filter((p) => p && typeof p.id === "string" && Array.isArray(p.position) && p.position.length >= 2 && p.position.slice(0, 2).every(finite))
    .map((p) => ({ id: p.id, text: `${p.id} · ${p.label ?? ""}`.trim(), position: [p.position[0], p.position[1]] }));
}
