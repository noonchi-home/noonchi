// @vitest-environment node
// 정적 메시 합치기: 같은 재질을 하나로 합치고, 옮길 물건을 떼면 그 물건 메시만 다시 보인다.
import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { StaticMerge } from "../../src/twin/3d/merge";

const mat = new THREE.MeshBasicMaterial({ name: "wood" });
const part = (name: string, x: number) => { const m = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), mat); m.name = name; m.position.x = x; return m; };
function home() {
  const root = new THREE.Group();
  const sofa = new THREE.Group(); sofa.name = "sofa_1"; sofa.add(part("sofa_1_body", 0), part("sofa_1_arm", 1));
  const table = new THREE.Group(); table.name = "table_1"; table.add(part("table_1_top", 5));
  root.add(sofa, table);
  root.updateMatrixWorld(true);
  return { root, meshes: [...sofa.children, ...table.children] as THREE.Mesh[] };
}
const owner = (m: THREE.Mesh) => m.parent?.name ?? null;

describe("정적 메시 합치기", () => {
  it("같은 재질 메시를 하나로 합치고 원래 메시는 숨긴다", () => {
    const { root, meshes } = home();
    const merge = new StaticMerge(root, meshes, owner);
    expect(merge.build()).toEqual({ before: 3, after: 1 });
    expect(meshes.every((m) => !m.visible)).toBe(true);
    expect(merge.mergedOf("sofa_1")!.geometry.attributes.position!.count).toBe(72);
  });
  it("옮길 물건을 떼면 그 물건 메시만 보이고 합친 메시에서 빠진다", () => {
    const { root, meshes } = home();
    const merge = new StaticMerge(root, meshes, owner);
    merge.build();
    expect(merge.detach("sofa_1")).toBe(1);
    expect(meshes.filter((m) => m.visible).map((m) => m.name)).toEqual(["sofa_1_body", "sofa_1_arm"]);
    expect(merge.mergedOf("table_1")!.geometry.attributes.position!.count).toBe(24);
    expect(merge.detach("sofa_1")).toBe(0);
  });
});
