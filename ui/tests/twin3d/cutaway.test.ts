// @vitest-environment node
// 기본 보기에서 세우는 벽(안쪽 면이 카메라를 향한 바깥벽)이 굽기 때 빛을 막은 벽과 같다. 다르면 구운 그림자가 화면과 맞지 않는다.
import * as THREE from "three";
import { describe, expect, it } from "vitest";
import manifest from "../../../twin/homes/mokryeon_180b/bake/manifest.json";
import scene from "../../../twin/homes/mokryeon_180b/scene.json";
import { applyDefaultView, raisedWalls, viewHeading, type SceneData } from "../../src/twin3d/cutaway";
import { MOKRYEON_MAP_CAMERA } from "../../src/twin3d/projection";

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
