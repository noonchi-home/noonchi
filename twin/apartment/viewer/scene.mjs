// scene.json으로 아파트를 다시 짓고 검사하는 데 쓰는 순수 함수. three.js 없이 Node에서 테스트한다.
//
// scene.json의 변환은 three.js 공간(Y-up, m)이고 회전은 Euler 'XYZ'(라디안)다.
// 개별 GLB의 최상위 노드는 항등 변환이므로, 감싸는 Group에 이 값을 한 번만 넣는다.

const isVec3 = (v) => Array.isArray(v) && v.length === 3 && v.every(Number.isFinite);

export function applyTransform(object, entry) {
  const { position, rotation, scale } = entry;
  if (!isVec3(position) || !isVec3(rotation) || !isVec3(scale)) {
    throw new Error(`${entry.id}: position·rotation·scale은 숫자 3개여야 합니다`);
  }
  object.position.set(...position);
  object.rotation.set(...rotation, "XYZ");
  object.scale.set(...scale);
  return object;
}

// three.js Matrix4.compose와 같은 열 우선 16개 배열. 회전 행렬은 Rx · Ry · Rz.
export function composeMatrix(position, rotation, scale) {
  const [a, b, c] = rotation;
  const [ca, sa, cb, sb, cc, sc] = [Math.cos(a), Math.sin(a), Math.cos(b), Math.sin(b), Math.cos(c), Math.sin(c)];
  const r = [
    [cb * cc, -cb * sc, sb],
    [ca * sc + sa * sb * cc, ca * cc - sa * sb * sc, -sa * cb],
    [sa * sc - ca * sb * cc, sa * cc + ca * sb * sc, ca * cb],
  ];
  const [sx, sy, sz] = scale;
  const [tx, ty, tz] = position;
  return [
    r[0][0] * sx, r[1][0] * sx, r[2][0] * sx, 0,
    r[0][1] * sy, r[1][1] * sy, r[2][1] * sy, 0,
    r[0][2] * sz, r[1][2] * sz, r[2][2] * sz, 0,
    tx, ty, tz, 1,
  ];
}

export function matrixDiff(a, b) {
  let max = 0;
  for (let i = 0; i < 16; i += 1) max = Math.max(max, Math.abs(a[i] - b[i]));
  return max;
}

// 클릭한 메시에서 위로 올라가며 scene.json id가 있는 객체를 찾는다. 고정 객체(interactive=false)는 고르지 않는다.
export function findPickable(object) {
  for (let node = object; node; node = node.parent) {
    if (node.userData && node.userData.id !== undefined) {
      return node.userData.interactive ? node : null;
    }
  }
  return null;
}

export function uniqueAssets(objects) {
  return [...new Set(objects.map((o) => o.asset))];
}

const stem = (path) => path.split("/").pop().replace(/\.glb$/, "");

// 개별 GLB(gltf.scene)에서 파일 이름과 같은 최상위 노드를 꺼낸다.
export function assetRoot(gltfScene, assetPath) {
  const name = stem(assetPath);
  const root = gltfScene.children.find((child) => child.name === name);
  if (!root) throw new Error(`${assetPath}: 최상위 노드 ${name}이 없습니다`);
  return root;
}

// GLB extras는 Blender custom property라서 객체일 수도, JSON 문자열일 수도 있다.
export function parseProp(value) {
  if (value && typeof value === "object") return value;
  if (typeof value !== "string") return null;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

// GLB·전체 GLB 경로의 기준: scene.json이 있는 폴더
export function baseUrlOf(sceneUrl) {
  return sceneUrl.slice(0, sceneUrl.lastIndexOf("/") + 1);
}

// 불러온 뒤 위치 대조에 쓸 apartment_complete.glb 주소. 스튜디오 검사(?debug=1)에서만 준다.
// 화면(twin-home 대시보드·설정·embed)은 이 파일을 받지 않는다: twin-home 집 산출물에는 없다.
export function completeCheckUrl(base, search) {
  return new URLSearchParams(search).has("debug") ? `${base}apartment_complete.glb` : null;
}

function* walk(node) {
  yield node;
  for (const child of node.children ?? []) yield* walk(child);
}

// 상태 정의: scene.json 객체의 states가 먼저, 없으면 GLB 루트의 states_json(문자열)
export function statesOf(entry, node) {
  if (entry.states && Object.keys(entry.states).length) return entry.states;
  if (node) {
    for (const n of walk(node)) {
      const parsed = parseProp(n.userData?.states_json);
      if (parsed && Object.keys(parsed).length) return parsed;
    }
  }
  return {};
}

// 빌더가 아직 없어 회색 상자로 지은 인스턴스인지(GLB 루트 extras.placeholder). scene.json 방식은 감싼 Group 아래
// GLB 루트에, 전체 GLB 방식은 인스턴스 루트에 붙어 있다.
export function isPlaceholder(node) {
  if (!node) return false;
  for (const n of walk(node)) if (n.userData?.placeholder) return true;
  return false;
}

export function statefulEntries(objects) {
  return objects.filter((o) => o.states && Object.keys(o.states).length > 0);
}

// 평면도 방 순서대로 묶는다. 평면도에 없는 방은 끝의 '기타'로 모은다.
export function groupByRoom(entries, rooms) {
  const groups = rooms.map((r) => ({ id: r.id, label: r.label ?? r.id, items: [] }));
  const byId = new Map(groups.map((g) => [g.id, g]));
  const other = { id: null, label: "기타", items: [] };
  for (const e of entries) (byId.get(e.room) ?? other).items.push(e);
  return [...groups, other].filter((g) => g.items.length);
}

export function isIdentity(node, eps = 1e-9) {
  const { position: p, quaternion: q, scale: s } = node;
  return Math.hypot(p.x, p.y, p.z) <= eps
    && Math.abs(q.x) <= eps && Math.abs(q.y) <= eps && Math.abs(q.z) <= eps && Math.abs(Math.abs(q.w) - 1) <= eps
    && Math.abs(s.x - 1) <= eps && Math.abs(s.y - 1) <= eps && Math.abs(s.z - 1) <= eps;
}

// 인스턴스 노드 찾기: extras id(→ userData.id)를 먼저, 없으면 이름(= id)으로
export function indexNodes(root, objects) {
  const found = new Map();
  const byName = new Map();
  for (const n of walk(root)) {
    const id = n.userData?.id;
    if (id !== undefined && !found.has(id)) found.set(id, n);
    if (n.name && !byName.has(n.name)) byName.set(n.name, n);
  }
  for (const o of objects) if (!found.has(o.id) && byName.has(o.id)) found.set(o.id, byName.get(o.id));
  return found;
}

// 전체 GLB 인스턴스의 월드 행렬(matrixOf(id))과 scene.json 변환의 가장 큰 차이
export function maxDeviation(objects, matrixOf) {
  let max = 0;
  const missing = [];
  for (const o of objects) {
    const m = matrixOf(o.id);
    if (!m) { missing.push(o.id); continue; }
    max = Math.max(max, matrixDiff(m, composeMatrix(o.position, o.rotation, o.scale)));
  }
  return { max, missing };
}
