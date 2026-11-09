// @vitest-environment node
// 구운 재질: 빛 지도가 있는 정적 메시 = MeshBasicMaterial × 빛 지도, 벽 윗면 = 단색, 창·난간 = 반투명 단색, 발광 재질은 그대로.
import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { scene3d } from "../../../src/design/tokens.ts";
import { bakeMaterials } from "../../src/twin3d/materials";

const withUv1 = () => {
  const g = new THREE.BoxGeometry(1, 1, 1);
  g.setAttribute("uv1", g.attributes.uv!.clone());
  return g;
};
const mesh = (name: string, material: THREE.Material, geometry: THREE.BufferGeometry = withUv1()) => {
  const m = new THREE.Mesh(geometry, material);
  m.name = name;
  return m;
};

function tree() {
  const wood = new THREE.Texture();
  const glow = new THREE.MeshStandardMaterial({ name: "lamp_glow", emissive: new THREE.Color(1, 0.8, 0.5), emissiveIntensity: 2 });
  const parts = {
    seat: mesh("sofa_1_seat", new THREE.MeshStandardMaterial({ name: "fabric", map: wood })),
    cap: mesh("wall_E01_cap", new THREE.MeshStandardMaterial({ name: "wall_cap" })),
    window: mesh("win_1_glass", new THREE.MeshStandardMaterial({ name: "glass" }), new THREE.BoxGeometry(1, 1, 0.01)),
    rail: mesh("pre_rail_win_1_pane", new THREE.MeshStandardMaterial({ name: "pre_rail_glass" }), new THREE.BoxGeometry(1, 1, 0.01)),
    lamp: mesh("lamp_1_shade", glow),
  };
  const root = new THREE.Group();
  root.add(...Object.values(parts));
  return { root, parts, wood, glow };
}

const manifest = {
  nodes: { sofa_1_seat: "lm0", wall_E01_cap: "lm0", lamp_1_shade: "lm0" },
  transparent: ["win_1_glass"],
};

describe("구운 재질", () => {
  it("구운 메시·벽 윗면·유리·발광을 가르고 센다", () => {
    const { root, parts, wood, glow } = tree();
    const maps = { lm0: { tex: new THREE.Texture(), intensity: 5.3 } };
    expect(bakeMaterials(root, manifest, maps, { aniso: 4 })).toEqual({ baked: 1, cap: 1, glass: 2, glow: 1, live: 0 });
    const seat = parts.seat.material as THREE.MeshBasicMaterial;
    expect(seat).toBeInstanceOf(THREE.MeshBasicMaterial);
    expect(seat.lightMap).toBe(maps.lm0.tex);
    expect(seat.lightMapIntensity).toBe(5.3);
    expect(seat.map).toBe(wood);
    expect(wood.anisotropy).toBe(4);
    const cap = parts.cap.material as THREE.MeshBasicMaterial;
    expect(cap).toBeInstanceOf(THREE.MeshBasicMaterial);
    expect(cap.color.getHexString()).toBe(new THREE.Color(scene3d.wallCap).getHexString());
    const win = parts.window.material as THREE.MeshBasicMaterial;
    expect([win.transparent, win.opacity]).toEqual([true, 0.88]);
    expect((parts.rail.material as THREE.MeshBasicMaterial).opacity).toBe(0.22);
    expect(parts.lamp.material).toBe(glow);
  });
  it("같은 재질·같은 빛 지도면 구운 재질 하나를 같이 쓴다", () => {
    const fabric = new THREE.MeshStandardMaterial({ name: "fabric" });
    const a = mesh("chair_1_seat", fabric);
    const b = mesh("chair_2_seat", fabric);
    const root = new THREE.Group();
    root.add(a, b);
    bakeMaterials(root, { nodes: { chair_1_seat: "lm0", chair_2_seat: "lm0" }, transparent: [] }, { lm0: { tex: new THREE.Texture(), intensity: 5 } }, { aniso: 4 });
    expect(a.material).toBe(b.material);
    expect(a.userData.baked).toBe(true);
  });
});
