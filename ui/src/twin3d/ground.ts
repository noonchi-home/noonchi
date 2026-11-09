// 구운 땅 그림자(스파이크 docs/twin3d-spike/main.mjs 391~401줄, studio.bake.ground): 그림자 세기 그림을 검은 판의 alphaMap으로.
// 화면 = 바탕 × (1 − 세기 × strength). 판은 집 바닥보다 조금 아래에 깔고 맨 먼저 그린다.
import * as THREE from "three";
import { scene3d } from "../../../src/design/tokens.ts";
import type { Manifest } from "./materials";

export function bakedGround(g: Manifest["ground"], tex: THREE.Texture): THREE.Mesh {
  tex.colorSpace = THREE.NoColorSpace;
  tex.flipY = g.flipY;
  tex.needsUpdate = true;
  // 색이 아니라 어둡게 하는 판이라 검정 토큰(scene3d.groundShade)이다
  const shade = new THREE.Color(scene3d.groundShade);
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(g.x[1] - g.x[0], g.z[1] - g.z[0]).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ color: shade, alphaMap: tex, transparent: true, opacity: g.strength, depthWrite: false, toneMapped: false }));
  mesh.position.set((g.x[0] + g.x[1]) / 2, g.y - 0.002, (g.z[0] + g.z[1]) / 2);
  mesh.renderOrder = -1;
  mesh.name = "ground_shadow";
  return mesh;
}
