// 기본 보기 벽·자르기(스파이크 docs/twin3d-spike/main.mjs 296~387줄, 벽 보기 auto 하나): 안쪽 면이 카메라를 향한 바깥벽만 세우고
// 나머지 벽 위쪽은 숨긴다. 낮춘 벽의 문(문틀과 열리거나 닫힌 문짝)·창, 키 큰 가구(view.clip)는 자르기 높이(cut)에서 자르고 단면을 스텐실 뚜껑으로 어둡게 칠한다.
// 키 큰 가구는 자른 자리에 몸통 색 뚜껑을 덮어 꽉 찬 가구로 보이고, 낮춘 벽의 창은 그 자리 낮은 유리 난간이다.
import * as THREE from "three";
import { cameraHeading, collectWalls, cutAction, upperVisible } from "@viewer/walls.mjs";
import { scene3d } from "../../../../src/design/tokens.ts";
import type { Manifest } from "./materials";
import type { OrthoCamera } from "./projection";
import { placeCamera, viewTarget } from "./view";

/** 자른 가구 속(뒷면) = 몸통 색 × 이 값(구운 빛 없이 그늘 정도). */
const INSIDE = 0.62;
/** 자른 가구 뚜껑 = 몸통 색 × 이 값(위에서 빛을 받는 윗면 정도). */
const LID = 0.9;
/** 뚜껑은 자르기 높이보다 이만큼 위(m): 자른 판 끝과 겹쳐 깜박이지 않게. */
const LID_LIFT = 0.002;

export interface PlanWall { id: string; kind?: string; faces?: { room?: string; normal: number[] }[] }
/** 서버 장면(/api/scene)에서 쓰는 칸만. */
export interface SceneData {
  plan: {
    walls: PlanWall[];
    doors?: { id: string; wall?: string; kind?: string }[];
    windows?: { id: string; wall?: string }[];
    wall_cut_height?: number;
  };
  objects: SceneEntry[];
}
export interface SceneEntry {
  id: string;
  category?: string;
  mount?: string;
  plan?: { wall?: string | null; elevation?: number } | null;
  attrs?: Record<string, unknown[]>;
  states?: Record<string, unknown>;
  state?: Record<string, unknown>;
}

const LID_SECTION = new THREE.Matrix4();

/**
 * 뚜껑의 세계 행렬: 가구 로컬 바닥 자리(판, 로컬 y 0)를 가구의 세로축을 따라 세계 y = 높이 평면에 옮긴 자리, 곧 가구와 그 평면이
 * 실제로 만나는 단면이다. 세계 점 = 가구 행렬 · (x, t, z), t는 그 점의 세계 y가 높이가 되는 로컬 y(x·z의 일차식)라 행렬 하나로 된다.
 * 편집기로 옮기거나(바닥 높이가 다른 방) 돌리거나 기울여도 맞고, 행렬만 다시 쓰고 새 객체를 만들지 않는다.
 * 가구가 그 평면과 만나지 않으면(세로축이 수평에 가깝거나, 바닥 자리 네 모서리의 단면 높이가 몸통 로컬 높이 box 밖) 숨긴다.
 * 보일지는 lid.userData.on(기본 보기에서 자르는가)과 만남을 함께 본다. 숨김은 visible만 바꾼다.
 */
function levelLid(lid: THREE.Object3D, height: number, box: THREE.Box3): void {
  const fit = () => {
    const parent = lid.parent;
    if (!parent) return;
    const e = parent.matrixWorld.elements; // 열 우선: 세계 y = e[1]·x + e[5]·y + e[9]·z + e[13]
    let meets = Math.abs(e[5]!) >= 1e-6;
    if (meets) {
      const a = -e[1]! / e[5]!, c = -e[9]! / e[5]!, d = (height - e[13]!) / e[5]!;
      for (const x of [box.min.x, box.max.x]) for (const z of [box.min.z, box.max.z]) {
        const at = a * x + c * z + d; // 이 모서리에서 단면이 지나는 몸통 로컬 높이
        if (at < box.min.y - 1e-6 || at > box.max.y + 1e-6) meets = false;
      }
      LID_SECTION.set(1, 0, 0, 0, a, 1, c, d, 0, 0, 1, 0, 0, 0, 0, 1);
      lid.matrixWorld.multiplyMatrices(parent.matrixWorld, LID_SECTION);
      lid.matrixWorldNeedsUpdate = false;
    }
    lid.visible = lid.userData.on === true && meets;
  };
  lid.matrixAutoUpdate = false;
  lid.updateMatrixWorld = () => { fit(); };
  lid.updateWorldMatrix = (updateParents: boolean) => {
    if (updateParents) lid.parent?.updateWorldMatrix(true, false);
    fit();
  };
}

/** 구운 보기 카메라의 수평 방향(평면도 x, y = three x, z). */
export function viewHeading(v: OrthoCamera): [number, number] {
  const cam = new THREE.OrthographicCamera();
  placeCamera(cam, v, { cx: v.width / 2, cy: v.height / 2, scale: 1 }, { width: v.width, height: v.height });
  return cameraHeading(cam.position.toArray(), viewTarget(v).toArray());
}

/** 기본 보기(auto)에서 위쪽까지 세우는 벽 id(정렬). */
export function raisedWalls(planWalls: PlanWall[], heading: [number, number]): string[] {
  return planWalls.filter((w) => upperVisible(w, { mode: "auto", heading })).map((w) => w.id).sort();
}

type Mats = THREE.Material | THREE.Material[];
const flat = (m: Mats) => [m].flat();

export function applyDefaultView(o: {
  root: THREE.Object3D;
  scene: THREE.Object3D;
  data: SceneData;
  view: Manifest["view"];
  heading: [number, number];
  cut: number;
  /** 단면 뚜껑 판의 가운데(three 좌표). */
  target: THREE.Vector3;
  find: (id: string) => THREE.Object3D | null;
}): { raised: string[]; actions: Record<string, number>; uppers: THREE.Object3D[]; rails: THREE.Object3D[] } {
  const { root, scene, data, view, heading, cut, target, find } = o;
  const walls = collectWalls(root, data.plan.walls);
  const upperByWall = new Map(walls.map((w) => [w.id, upperVisible(w as PlanWall, { mode: "auto", heading })]));
  for (const w of walls) if (w.upper) w.upper.visible = upperByWall.get(w.id)!;
  const wallOf = new Map<string, string>();
  for (const d of [...(data.plan.doors ?? []), ...(data.plan.windows ?? [])]) if (d.wall) wallOf.set(d.id, d.wall);

  const cutPlane = new THREE.Plane(new THREE.Vector3(0, -1, 0), cut);
  // 단면 뚜껑(스텐실): 자른 메시의 뒷면 +1·앞면 -1을 세고, 자르기 높이의 큰 판을 0이 아닌 곳에만 칠한다(three.js clipping stencil 예제와 같은 방식).
  const stencilMat = (side: THREE.Side, op: THREE.StencilOp) => new THREE.MeshBasicMaterial({
    side, clippingPlanes: [cutPlane], colorWrite: false, depthWrite: false, depthTest: false,
    stencilWrite: true, stencilFunc: THREE.AlwaysStencilFunc, stencilFail: op, stencilZFail: op, stencilZPass: op,
  });
  const stencilBack = stencilMat(THREE.BackSide, THREE.IncrementWrapStencilOp);
  const stencilFront = stencilMat(THREE.FrontSide, THREE.DecrementWrapStencilOp);
  const capPlane = new THREE.Mesh(new THREE.PlaneGeometry(400, 400).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({
    name: "cap_plane", color: scene3d.wallCap, toneMapped: false, stencilWrite: true, stencilRef: 0, stencilFunc: THREE.NotEqualStencilFunc,
    stencilFail: THREE.ReplaceStencilOp, stencilZFail: THREE.ReplaceStencilOp, stencilZPass: THREE.ReplaceStencilOp,
  }));
  capPlane.position.set(target.x, cut, target.z);
  capPlane.renderOrder = 2;
  capPlane.name = "cap_plane";
  scene.add(capPlane);

  const clipState = new Map<THREE.Mesh, { orig: Mats; clipped: Mats; marks: THREE.Mesh[] }>();
  // 자른 재질은 원래 재질마다 하나: 메시마다 복사하면 그릴 때 재질을 메시 수만큼 바꾼다
  const clippedMats = new Map<string, THREE.Material>();
  const clippedOf = (x: THREE.Material) => {
    let c = clippedMats.get(x.uuid);
    if (!c) { c = Object.assign(x.clone(), { clippingPlanes: [cutPlane] }); clippedMats.set(x.uuid, c); }
    return c;
  };
  const setClipped = (node: THREE.Object3D, on: boolean, stencil = true) => {
    node.traverse((m) => {
      // 뒷면·뚜껑 메시는 자기 자른 재질이 있고 스텐실을 세면 안 된다(닫힌 몸이 아니다)
      if (!(m instanceof THREE.Mesh) || m.userData.isStencil || m.userData.isInside || m.userData.isLid) return;
      let st = clipState.get(m);
      if (!st && !on) return;
      if (!st) {
        const orig = m.material as Mats;
        const clipped = flat(orig).map(clippedOf);
        const solid = stencil && !flat(orig).some((x) => x.transparent);
        const marks = solid ? [stencilBack, stencilFront].map((mat) => {
          const s = new THREE.Mesh(m.geometry, mat);
          s.userData.isStencil = true;
          s.renderOrder = 1;
          s.name = `${m.name}_stencil`;
          m.add(s);
          return s;
        }) : [];
        st = { orig, clipped: Array.isArray(orig) ? clipped : clipped[0]!, marks };
        clipState.set(m, st);
      }
      m.material = on ? st.clipped : st.orig;
      for (const s of st.marks) s.visible = on;
    });
  };
  // 자른 키 큰 가구는 속이 보이는 열린 상자: 뒷면을 몸통 색(그늘 정도로 어둡게)으로 그린다
  const insideMats = new Map<string, THREE.MeshBasicMaterial>();
  const insideOf = (m: THREE.Material) => {
    let mat = insideMats.get(m.uuid);
    if (!mat) {
      const own = m as THREE.Material & { color?: THREE.Color; map?: THREE.Texture | null };
      mat = new THREE.MeshBasicMaterial({ name: `${m.name}_inside`, map: own.map ?? null, side: THREE.BackSide, clippingPlanes: [cutPlane] });
      if (own.color) mat.color.copy(own.color);
      mat.color.multiplyScalar(INSIDE);
      insideMats.set(m.uuid, mat);
    }
    return mat;
  };
  const insides = new Map<THREE.Mesh, THREE.Mesh>();
  const setInside = (node: THREE.Object3D, on: boolean) => {
    node.traverse((m) => {
      if (!(m instanceof THREE.Mesh) || m.userData.isStencil || m.userData.isInside) return;
      if (!insides.has(m) && on) {
        const mats = flat(m.material as Mats);
        if (mats.some((x) => x.transparent)) return;
        const inner = new THREE.Mesh(m.geometry, Array.isArray(m.material) ? mats.map(insideOf) : insideOf(mats[0]!));
        inner.userData.isInside = true;
        inner.name = `${m.name}_inside`;
        m.add(inner);
        insides.set(m, inner);
      }
      const inner = insides.get(m);
      if (inner) inner.visible = on;
    });
  };

  // 자른 키 큰 가구 뚜껑: 가구 로컬 경계 상자(자식 메시 전부)의 바닥 자리를 자르기 높이 바로 위에서 덮는 판.
  // 색은 몸통(이름이 _carcass, 없으면 가장 큰 메시) 재질 색. 문·손잡이가 뚜껑 아래에 있어 위에서 보면 꽉 찬 가구다
  const lids = new Map<THREE.Object3D, THREE.Mesh>();
  const setLid = (node: THREE.Object3D, on: boolean) => {
    if (!lids.has(node) && on) {
      node.updateWorldMatrix(true, true);
      const inv = node.matrixWorld.clone().invert();
      const box = new THREE.Box3();
      let body: THREE.Mesh | null = null;
      let bodyScore = -1;
      node.traverse((m) => {
        if (!(m instanceof THREE.Mesh) || m.userData.isStencil || m.userData.isInside || m.userData.isLid) return;
        m.geometry.computeBoundingBox();
        const b = m.geometry.boundingBox!.clone().applyMatrix4(inv.clone().multiply(m.matrixWorld));
        box.union(b);
        const size = b.getSize(new THREE.Vector3());
        const score = m.name.endsWith("_carcass") ? Infinity : size.x * size.y * size.z;
        if (score > bodyScore) { body = m; bodyScore = score; }
      });
      const own = body ? flat((body as THREE.Mesh).material as Mats)[0] as THREE.Material & { color?: THREE.Color; map?: THREE.Texture | null } : null;
      if (box.isEmpty() || !own) return;
      const mat = new THREE.MeshBasicMaterial({ name: `${own.name}_lid`, map: own.map ?? null });
      if (own.color) mat.color.copy(own.color);
      mat.color.multiplyScalar(LID);
      const size = box.getSize(new THREE.Vector3());
      // 판은 가구 로컬 바닥 자리(가운데 포함)에 두고 높이는 0: 세계 행렬을 그릴 때마다 levelLid가 자르기 높이에 맞춘다
      const geo = new THREE.PlaneGeometry(size.x, size.z).rotateX(-Math.PI / 2).translate((box.min.x + box.max.x) / 2, 0, (box.min.z + box.max.z) / 2);
      const lid = new THREE.Mesh(geo, mat);
      lid.userData.isLid = true;
      lid.name = `${node.name}_lid`;
      lid.userData.on = on;
      levelLid(lid, cut + LID_LIFT, box);
      node.add(lid);
      lids.set(node, lid);
    }
    const lid = lids.get(node);
    if (lid) { lid.userData.on = on; lid.updateMatrixWorld(); }
  };

  const tallClip = new Set(view.clip);
  const doorIds = new Set((data.plan.doors ?? []).map((d) => d.id));
  const hideIds = new Set(view.hide);
  const railOf = new Map<string, THREE.Object3D>();
  for (const [win, name] of Object.entries(view.rails ?? {})) {
    const n = root.getObjectByName(name);
    if (n) railOf.set(win, n);
  }
  const actions: Record<string, number> = {};
  for (const e of data.objects) {
    const node = find(e.id);
    if (!node) continue;
    let act: string = cutAction(e, upperByWall, cut, wallOf);
    if (tallClip.has(e.id)) act = "clip";
    if (hideIds.has(e.id) && e.plan?.wall && upperByWall.get(e.plan.wall) === false) act = "hide"; // 낮춘 벽에 높이 걸린 가전도
    const rail = railOf.get(e.id);
    if (rail) { // 낮춘 벽의 창: 창을 숨기고 그 자리 낮은 유리 난간
      rail.visible = act === "clip";
      if (act === "clip") act = "rail";
    }
    node.visible = act !== "hide" && act !== "rail";
    if (tallClip.has(e.id)) {
      setClipped(node, act === "clip", false);
      setInside(node, act === "clip");
      setLid(node, act === "clip");
    } else {
      // 낮춘 벽의 문은 문틀·문짝(열림·닫힘 모두)을 함께 자른다. 문짝(여닫이 leaf·미닫이 panel)은 구멍·유리 판이 있어 닫힌 몸이
      // 아니므로 스텐실 뚜껑 대신 뒷면을 문짝 색으로 칠한다(먼저 정한 메시별 자르기 상태를 문 전체 자르기가 그대로 쓴다)
      if (doorIds.has(e.id)) node.traverse((n) => {
        if (n.userData?.part === "leaf" || n.userData?.part === "panel") { setClipped(n, act === "clip", false); setInside(n, act === "clip"); }
      });
      setClipped(node, act === "clip");
    }
    actions[act] = (actions[act] ?? 0) + 1;
  }
  return {
    raised: walls.filter((w) => upperByWall.get(w.id)).map((w) => w.id).sort(),
    actions,
    uppers: walls.flatMap((w) => (w.upper ? [w.upper as unknown as THREE.Object3D] : [])),
    rails: [...railOf.values()],
  };
}
