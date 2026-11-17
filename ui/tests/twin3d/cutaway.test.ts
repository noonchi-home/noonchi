// @vitest-environment node
// 기본 보기에서 세우는 벽(안쪽 면이 카메라를 향한 바깥벽)이 굽기 때 빛을 막은 벽과 같다. 다르면 구운 그림자가 화면과 맞지 않는다.
import * as THREE from "three";
import { describe, expect, it } from "vitest";
import manifest from "../../../twin/homes/mokryeon_180b/bake/manifest.json";
import scene from "../../../twin/homes/mokryeon_180b/scene.json";
import { applyDefaultView, raisedWalls, viewHeading, type SceneData } from "../../src/twin/3d/cutaway";
import { MOKRYEON_MAP_CAMERA } from "../../src/twin/3d/projection";

describe("기본 보기 벽", () => {
  it("카메라 수평 방향은 [0.7071, 0.7071]이다", () => {
    expect(viewHeading(MOKRYEON_MAP_CAMERA).map((v) => Number(v.toFixed(4)))).toEqual([0.7071, 0.7071]);
  });
  it("세우는 벽 = 굽기 가리개 벽", () => {
    expect(raisedWalls(scene.plan.walls, viewHeading(MOKRYEON_MAP_CAMERA))).toEqual([...manifest.light.occluders.walls].sort());
  });
});

describe("자른 재질", () => {
  // 자른 메시마다 재질을 따로 복사하면 그림마다 재질을 282번 바꾼다(목련 180B). 같은 원래 재질이면 자른 재질 하나를 함께 쓴다.
  it("원래 재질이 같은 메시는 자른 재질 하나를 함께 쓴다", () => {
    const shared = new THREE.MeshBasicMaterial({ name: "wood" });
    const other = new THREE.MeshBasicMaterial({ name: "metal" });
    const box = new THREE.BoxGeometry(1, 1, 1);
    const shelf = new THREE.Group();
    shelf.name = "shelf";
    const parts = [new THREE.Mesh(box, shared), new THREE.Mesh(box, shared), new THREE.Mesh(box, other)];
    shelf.add(...parts);
    const root = new THREE.Group();
    root.add(shelf);
    const scene3 = new THREE.Scene();
    scene3.add(root);
    applyDefaultView({
      root, scene: scene3, cut: 1.05, target: new THREE.Vector3(), heading: [0.7071, 0.7071],
      data: { plan: { walls: [] }, objects: [{ id: "shelf" }] } as unknown as SceneData,
      view: { clip: ["shelf"], hide: [], rails: {} } as unknown as Parameters<typeof applyDefaultView>[0]["view"],
      find: (id) => root.getObjectByName(id) ?? null,
    });
    const [a, b, c] = parts.map((p) => p.material as THREE.MeshBasicMaterial);
    expect(a!.clippingPlanes).toHaveLength(1);
    expect(a).not.toBe(shared);
    expect(b).toBe(a);
    expect(c).not.toBe(a);
    expect(c!.clippingPlanes).toHaveLength(1);
  });
});

/** 낮춘 벽 w1 하나와 그 벽의 여닫이문 door_1(문틀 + 회전축 leaf 아래 문짝), 키 큰 옷장 wardrobe_1(흰 몸통 + 오크 문)을 기본 보기로 놓는다. */
function lowered() {
  const root = new THREE.Group();
  const wall = new THREE.Group();
  wall.name = "wall_w1";
  root.add(wall);
  const door = new THREE.Group();
  door.name = "door_1";
  const frame = new THREE.Mesh(new THREE.BoxGeometry(0.9, 2.1, 0.15), new THREE.MeshBasicMaterial({ name: "frame" }));
  frame.position.y = 1.05;
  const leaf = new THREE.Group();
  leaf.userData.part = "leaf";
  leaf.rotation.y = Math.PI / 2; // 열린 문짝
  const leafBody = new THREE.Mesh(new THREE.BoxGeometry(0.8, 2.0, 0.04), new THREE.MeshBasicMaterial({ name: "leaf" }));
  leafBody.position.set(0.4, 1.0, 0);
  leaf.add(leafBody);
  door.add(frame, leaf);
  const wardrobe = new THREE.Group();
  wardrobe.name = "wardrobe_1";
  wardrobe.position.set(3, 0, 2);
  wardrobe.rotation.y = Math.PI / 2;
  const white = new THREE.MeshBasicMaterial({ name: "white_laminate", color: 0xf0eee8 });
  const carcass = new THREE.Mesh(new THREE.BoxGeometry(1.8, 2.3, 0.6), white);
  carcass.name = "wardrobe_1_carcass";
  carcass.position.y = 1.15;
  const doorPanel = new THREE.Mesh(new THREE.BoxGeometry(1.8, 2.2, 0.02), new THREE.MeshBasicMaterial({ name: "oak", color: 0xb08050 }));
  doorPanel.position.set(0, 1.12, -0.31);
  wardrobe.add(carcass, doorPanel);
  root.add(door, wardrobe);
  const scene3 = new THREE.Scene();
  scene3.add(root);
  root.updateMatrixWorld(true);
  applyDefaultView({
    root, scene: scene3, cut: 1.05, target: new THREE.Vector3(), heading: [0.7071, 0.7071],
    data: {
      plan: { walls: [{ id: "w1", kind: "interior", faces: [] }], doors: [{ id: "door_1", wall: "w1", kind: "swing" }] },
      objects: [{ id: "door_1", mount: "opening", plan: { wall: "w1" } }, { id: "wardrobe_1", mount: "floor" }],
    } as unknown as SceneData,
    view: { clip: ["wardrobe_1"], hide: [], rails: {} } as unknown as Parameters<typeof applyDefaultView>[0]["view"],
    find: (id) => root.getObjectByName(id) ?? null,
  });
  root.updateMatrixWorld(true);
  return { leaf, leafBody, frame, wardrobe, white };
}

describe("낮춘 벽의 문짝", () => {
  // 2026-11-17 사용자: 문짝을 숨기면 문틀 기둥만 남아 문이 없는 것처럼 보인다. 벽·문틀처럼 자르기 높이에서 잘라 보인다
  it("열린 문짝도 숨기지 않고 자르기 높이에서 자른다. 단면은 문짝 색 뒷면, 스텐실 뚜껑은 문틀만", () => {
    const { leaf, leafBody, frame } = lowered();
    expect(leaf.visible).toBe(true);
    expect((leafBody.material as THREE.Material).clippingPlanes).toHaveLength(1);
    // 욕실문처럼 구멍·유리 판이 있는 문짝은 닫힌 몸이 아니라 스텐실 뚜껑이 문짝 위에 검은 띠로 번진다(2026-11-17 대시보드 사진)
    expect(leafBody.children.filter((c) => c.userData.isStencil)).toHaveLength(0);
    expect(leafBody.children.filter((c) => c.userData.isInside && c.visible)).toHaveLength(1);
    // 문 전체 자르기가 문짝 뒷면 메시에 스텐실을 다시 달면 같은 검은 띠가 생긴다
    const inside = leafBody.children.find((c) => c.userData.isInside)!;
    expect(inside.children.filter((c) => c.userData.isStencil)).toHaveLength(0);
    expect(frame.children.filter((c) => c.userData.isStencil && c.visible)).toHaveLength(2);
  });
});

describe("자른 키 큰 가구 뚜껑", () => {
  // 자른 옷장·수납장·신발장이 속 빈 상자로 보였다: 자르기 높이에 몸통 색 뚜껑을 덮어 꽉 찬 가구로 보인다
  it("자르기 높이 바로 위에 가구 바닥 자리를 덮는 몸통 색 뚜껑이 있다", () => {
    const { wardrobe, white } = lowered();
    const lids = wardrobe.children.filter((c): c is THREE.Mesh => c instanceof THREE.Mesh && c.userData.isLid === true);
    expect(lids).toHaveLength(1);
    const box = new THREE.Box3().setFromObject(lids[0]!);
    expect(box.min.y).toBeCloseTo(1.052, 3);
    expect(box.max.y).toBeCloseTo(1.052, 3);
    // 옷장은 90° 돌아 있어 폭 1.8 m가 z, 깊이 0.62 m(몸통 + 문)가 x로 간다
    expect(box.max.z - box.min.z).toBeCloseTo(1.8, 3);
    expect(box.max.x - box.min.x).toBeCloseTo(0.62, 3);
    expect(lids[0]!.visible).toBe(true);
    const mat = lids[0]!.material as THREE.MeshBasicMaterial;
    expect(mat.color.getHex()).toBe(white.color.clone().multiplyScalar(0.9).getHex());
  });
});

describe("자른 키 큰 가구 뚜껑이 가구를 따라간다", () => {
  // 편집기에서 수납장을 현관(바닥 -0.1 m)에서 방(0 m)으로 옮기거나 노드가 기울어도 뚜껑은 세계 좌표 자르기 높이에 수평으로 남는다
  const lidOf = (wardrobe: THREE.Object3D) => wardrobe.children.find((c): c is THREE.Mesh => c instanceof THREE.Mesh && c.userData.isLid === true)!;
  it("가구를 옮기고 돌리고 기울여도 뚜껑은 자르기 높이에서 가구의 실제 단면과 맞는다", () => {
    const { wardrobe } = lowered();
    const lid = lidOf(wardrobe);
    const { geometry, material } = lid;
    wardrobe.position.set(4, -0.1, 2.5);
    wardrobe.rotation.set(0.08, 0.6, 0.05); // 편집기로 옮기고 돌린 기운 노드
    wardrobe.updateMatrixWorld(true);
    // 기대 단면: 가구 로컬 바닥 자리(몸통 + 문, x ±0.9, z -0.32~0.3)의 네 세로 모서리가 세계 y = 1.052와 만나는 점
    const corners = ([[-0.9, -0.32], [0.9, -0.32], [0.9, 0.3], [-0.9, 0.3]] as const).map(([x, z]) => {
      const a = new THREE.Vector3(x, 0, z).applyMatrix4(wardrobe.matrixWorld);
      const b = new THREE.Vector3(x, 1, z).applyMatrix4(wardrobe.matrixWorld);
      return a.clone().lerp(b, (1.052 - a.y) / (b.y - a.y));
    });
    const pos = lid.geometry.getAttribute("position");
    const got = Array.from({ length: pos.count }, (_, i) => new THREE.Vector3().fromBufferAttribute(pos, i).applyMatrix4(lid.matrixWorld));
    expect(got).toHaveLength(4);
    for (const p of got) expect(p.y).toBeCloseTo(1.052, 6);
    for (const want of corners) expect(Math.min(...got.map((p) => p.distanceTo(want)))).toBeLessThan(1e-6);
    // 기울면 단면이 바닥 자리 위에서 옆으로 옮겨 간다(0.08 rad × 1.15 m ≈ 9 cm)
    const footprint = new THREE.Vector3(0, 0, -0.01).applyMatrix4(wardrobe.matrixWorld);
    const center = got.reduce((s, p) => s.add(p), new THREE.Vector3()).multiplyScalar(1 / 4);
    expect(Math.hypot(center.x - footprint.x, center.z - footprint.z)).toBeGreaterThan(0.08);
    // 따라가며 새 지오메트리·재질을 만들지 않는다
    expect(lid.geometry).toBe(geometry);
    expect(lid.material).toBe(material);
  });
  it("가구가 자르기 높이와 만나지 않거나 일부만 걸치면 뚜껑을 숨기고(부분 단면은 만들지 않음), 다시 다 만나면 보인다", () => {
    const { wardrobe } = lowered();
    const lid = lidOf(wardrobe);
    const { geometry, material } = lid;
    const at = (y: number, tilt: number) => {
      wardrobe.position.set(3, y, 2);
      wardrobe.rotation.set(tilt, Math.PI / 2, 0);
      wardrobe.updateMatrixWorld(true);
      return lid.visible;
    };
    expect(at(0, Math.PI / 2)).toBe(false); // 세로축이 수평
    expect(at(-1.5, 0)).toBe(false); // 윗면 0.8 m < 1.052 m
    expect(at(1.2, 0)).toBe(false); // 바닥 1.2 m > 1.052 m
    expect(at(-1.25, 0.3)).toBe(false); // 기울어 절단면이 윗면 한쪽에만 걸친다: 일부만 걸치면 뚜껑을 숨긴다
    expect(at(0, 0)).toBe(true);
    expect(lid.geometry).toBe(geometry);
    expect(lid.material).toBe(material);
  });
});
