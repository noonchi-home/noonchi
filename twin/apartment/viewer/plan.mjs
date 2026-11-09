// three.js ↔ 평면도 좌표, 방 경계 상자, 정사영 화면 맞추기, 배치 내보내기. 순수 함수다.
//
// 계약(1절): 평면도 (x, y) → three.js (x, h, y). facing_deg는 0 = 동(+x), 90 = 남(+y).
// three.js rotation.y = -(facing_deg - 90)도. 에셋 로컬 정면은 three.js +Z다.

const DEG = Math.PI / 180;

export const planToThree = ([x, y], h = 0) => [x, h, y];
export const threeToPlan = ([x, , z]) => [x, z];

export const facingToYaw = (facingDeg) => (90 - facingDeg) * DEG;

export function yawToFacing(yaw) {
  const deg = 90 - yaw / DEG;
  const wrapped = ((deg % 360) + 360) % 360;
  return Math.abs(wrapped - 360) < 1e-9 ? 0 : wrapped;
}

// 쿼터니언 [x, y, z, w]로 돌린 로컬 정면(+Z)의 수평 방향 각. Euler XYZ 분해와 달리 ±90°를 넘어도 맞다.
export function yawOfQuaternion([x, y, z, w]) {
  const fx = 2 * (x * z + w * y);
  const fz = 1 - 2 * (x * x + y * y);
  return Math.atan2(fx, fz);
}

const round = (v, digits) => {
  const f = 10 ** digits;
  const r = Math.round(v * f) / f;
  return Object.is(r, -0) ? 0 : r;
};

const angleGap = (a, b) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));

// 옮긴 interactive 객체만 placement.json 형식으로. poses: id → {position: [x,y,z], quaternion: [x,y,z,w]}
export function placementExport(objects, poses, eps = 1e-5) {
  const items = [];
  for (const o of objects) {
    const pose = poses.get(o.id);
    if (!o.interactive || !pose) continue;
    const yaw = yawOfQuaternion(pose.quaternion);
    const moved = Math.hypot(pose.position[0] - o.position[0], pose.position[2] - o.position[2]) > eps
      || angleGap(yaw, o.rotation[1]) > eps;
    if (!moved) continue;
    const [px, py] = threeToPlan(pose.position);
    items.push({ id: o.id, position: [round(px, 3), round(py, 3)], facing_deg: round(yawToFacing(yaw), 1) % 360 });
  }
  return { items };
}

export function polygonBounds(polygon) {
  const xs = polygon.map((p) => p[0]);
  const ys = polygon.map((p) => p[1]);
  const min = [Math.min(...xs), Math.min(...ys)];
  const max = [Math.max(...xs), Math.max(...ys)];
  return { min, max, center: [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2] };
}

// 방 경계 상자(three.js): 바닥(floor_z)부터 천장까지
export function roomBox(room, ceiling) {
  const { min, max } = polygonBounds(room.polygon);
  return { min: [min[0], room.floor_z ?? 0, min[1]], max: [max[0], ceiling, max[1]] };
}

const sub = (a, b) => a.map((v, i) => v - b[i]);
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a) => {
  const l = Math.hypot(...a);
  return a.map((v) => v / l);
};

// direction(바라보는 점 → 카메라)으로 상자를 볼 때 화면에 맞는 정사영 세로 길이와 중심
export function fitOrtho(box, direction, aspect, margin = 1.15) {
  const d = norm(direction);
  const right = norm(cross([0, 1, 0], d));
  const up = cross(d, right);
  const center = box.min.map((v, i) => (v + box.max[i]) / 2);
  let w = 0;
  let h = 0;
  for (const x of [box.min[0], box.max[0]]) {
    for (const y of [box.min[1], box.max[1]]) {
      for (const z of [box.min[2], box.max[2]]) {
        const rel = sub([x, y, z], center);
        w = Math.max(w, Math.abs(dot(rel, right)) * 2);
        h = Math.max(h, Math.abs(dot(rel, up)) * 2);
      }
    }
  }
  return { center, height: Math.max(h, w / aspect) * margin };
}
