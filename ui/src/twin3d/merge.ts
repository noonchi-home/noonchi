// 정적 메시 합치기(스파이크 docs/twin3d-spike/main.mjs 666~707줄): 같은 재질·같은 속성 묶음의 메시를 월드 좌표로 하나로 합치고 원래 메시는 숨긴다.
// 옮길 물건을 떼면(detach) 그 물건 메시가 든 무리만 그 메시를 빼고 다시 합치고, 뗀 메시는 다시 보인다.
import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

interface Group { key: string; mat: THREE.Material; keys: string[]; list: THREE.Mesh[]; mesh: THREE.Mesh | null }

export class StaticMerge {
  private readonly groups = new Map<string, Group>();
  private readonly groupOf = new Map<THREE.Mesh, Group>();
  private readonly owned = new Map<string, THREE.Mesh[]>();
  private readonly detached = new Set<string>();
  /** 합치지 못한 메시(필요한 속성이 없음): 그대로 그린다. */
  private loose = 0;

  constructor(
    private readonly scene: THREE.Object3D,
    private readonly meshes: THREE.Mesh[],
    private readonly ownerOf: (m: THREE.Mesh) => string | null,
  ) {}

  build(): { before: number; after: number } {
    for (const m of this.meshes) {
      const mat = m.material as THREE.Material & { map?: THREE.Texture | null; lightMap?: THREE.Texture | null };
      const keys = ["position", ...(mat.map ? ["uv"] : []), ...(mat.lightMap ? ["uv1"] : [])];
      if (Array.isArray(m.material) || keys.some((k) => !m.geometry.attributes[k])) { this.loose++; continue; }
      const key = `${mat.uuid}|${keys.join(",")}`;
      let g = this.groups.get(key);
      if (!g) { g = { key, mat, keys, list: [], mesh: null }; this.groups.set(key, g); }
      g.list.push(m);
      this.groupOf.set(m, g);
      const id = this.ownerOf(m);
      if (id) this.owned.set(id, [...(this.owned.get(id) ?? []), m]);
    }
    for (const g of this.groups.values()) this.rebuild(g);
    return { before: this.meshes.length, after: this.groups.size + this.loose };
  }

  /** 물건 id의 메시를 합친 메시에서 뺀다. 바뀐 무리 수(다시 합침 또는 지움). 이미 뗀 물건·합친 적 없는 물건이면 0. */
  detach(id: string): number {
    if (this.detached.has(id)) return 0;
    const mine = this.owned.get(id) ?? [];
    this.detached.add(id);
    const touched = new Set<Group>();
    for (const m of mine) {
      const g = this.groupOf.get(m);
      if (!g) continue;
      g.list = g.list.filter((x) => x !== m);
      this.groupOf.delete(m);
      m.visible = true;
      touched.add(g);
    }
    for (const g of touched) this.rebuild(g);
    return touched.size;
  }

  /** 물건 id의 메시가 든 합친 메시(첫 무리). 뗀 물건이면 null. */
  mergedOf(id: string): THREE.Mesh | null {
    for (const m of this.owned.get(id) ?? []) {
      const g = this.groupOf.get(m);
      if (g?.mesh) return g.mesh;
    }
    return null;
  }

  private rebuild(g: Group): void {
    if (g.mesh) {
      this.scene.remove(g.mesh);
      g.mesh.geometry.dispose();
      g.mesh = null;
    }
    if (!g.list.length) { this.groups.delete(g.key); return; }
    const geos = g.list.map((m) => {
      const geo = new THREE.BufferGeometry();
      for (const k of g.keys) geo.setAttribute(k, m.geometry.attributes[k]!.clone());
      geo.setIndex(m.geometry.index ? m.geometry.index.clone() : [...Array(m.geometry.attributes.position!.count).keys()]);
      m.updateWorldMatrix(true, false);
      return geo.applyMatrix4(m.matrixWorld);
    });
    const geo = mergeGeometries(geos, false);
    for (const x of geos) x.dispose();
    if (!geo) { for (const m of g.list) m.visible = true; return; }
    const mesh = new THREE.Mesh(geo, g.mat);
    mesh.name = `merged_${g.mat.name}`;
    mesh.matrixAutoUpdate = false;
    this.scene.add(mesh);
    mesh.updateMatrixWorld(true);
    for (const m of g.list) m.visible = false;
    g.mesh = mesh;
  }
}
