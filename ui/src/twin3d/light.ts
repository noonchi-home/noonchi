// 실시간 빛: 반구광 + 해 하나(그림자 지도 없음). 구운 정적 메시는 MeshBasicMaterial이라 이 빛을 받지 않고, 가전·문 같은 실시간 메시만 받는다.
// 반구광 값은 하늘 사진에서 미리 셈한 집별 값(ui/scripts/bake-light.ts → homes/<집>.light.json), 해는 manifest.light.sun.
import * as THREE from "three";
import mokryeon from "./homes/mokryeon_180b.light.json";
import type { Manifest } from "./materials";

type V3 = [number, number, number];
export interface HomeLight { hemisphere: { sky: V3; ground: V3 } }
export const HOME_LIGHTS: Record<string, HomeLight> = { mokryeon_180b: mokryeon as unknown as HomeLight };

export function addLights(scene: THREE.Object3D, o: { light: HomeLight; sun: Manifest["light"]["sun"]; target: THREE.Vector3 }) {
  const { sky, ground } = o.light.hemisphere;
  const hemi = new THREE.HemisphereLight(new THREE.Color(...sky), new THREE.Color(...ground), 1);
  hemi.name = "hemi";
  const sun = new THREE.DirectionalLight(new THREE.Color(...o.sun.color), o.sun.intensity);
  sun.name = "sun";
  sun.castShadow = false;
  sun.position.copy(o.target).addScaledVector(new THREE.Vector3(...o.sun.direction).normalize(), 25);
  sun.target.position.copy(o.target);
  scene.add(hemi, sun, sun.target);
  return { hemi, sun };
}
