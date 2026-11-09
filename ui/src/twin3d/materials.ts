// 구운 재질(스파이크 docs/twin3d-spike/main.mjs 143~185줄): 정적 메시 = MeshBasicMaterial(색·그림 × 빛 지도, uv 채널 1),
// 벽 윗면 = 어두운 단색, 창·난간 유리 = 밝은 반투명 단색, 발광 재질은 그대로, 나머지는 실시간 재질 그대로.
// 색은 토큰(scene3d)만 쓴다.
import * as THREE from "three";
import { scene3d } from "../../../src/design/tokens.ts";

/** 구운 자산 목록(/twin/bake/manifest.json). 쓰는 칸만. */
export interface Manifest {
  home: string;
  glb: string;
  channel: number;
  lightmaps: { name: string; file: string; webp: string; intensity: number; size: number }[];
  /** 메시(또는 그 부모) 이름 → 빛 지도 이름 */
  nodes: Record<string, string>;
  /** 물건 id → 움직이는 부품 이름(가전·문) */
  dynamic: Record<string, string[]>;
  /** 창 유리 메시(또는 부모) 이름 */
  transparent: string[];
  light: {
    sun: { direction: [number, number, number]; intensity: number; color: [number, number, number] };
    environment: { hdri: string; intensity: number };
    occluders: { walls: string[]; cut: number };
  };
  /** 기본 보기: clip = 잘라 열린 상자로 보이는 키 큰 가구, hide = 낮춘 벽에 높이 걸린 물건, rails = 낮춘 벽의 창 → 난간 노드 */
  view: { clip: string[]; hide: string[]; rails: Record<string, string> };
  ground: { file: string; size: number; x: [number, number]; z: [number, number]; y: number; strength: number; flipY: boolean };
}

export type Lightmaps = Record<string, { tex: THREE.Texture; intensity: number }>;
export interface MaterialCount { baked: number; cap: number; glass: number; glow: number; live: number }

type AnyMat = THREE.Material & {
  color?: THREE.Color; map?: THREE.Texture | null; emissive?: THREE.Color; emissiveIntensity?: number; emissiveMap?: THREE.Texture | null;
};

/** 빛 지도 그림 설정: flipY 없음, sRGB, uv 채널 = manifest.channel, 밉맵 없음, 선형 거르기. */
export function asLightmap(tex: THREE.Texture, channel: number, name: string): THREE.Texture {
  Object.assign(tex, {
    flipY: false, colorSpace: THREE.SRGBColorSpace, channel, generateMipmaps: false,
    minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, name,
  });
  tex.needsUpdate = true;
  return tex;
}

const isCap = (m: THREE.Material) => m.name === "wall_cap" || m.name === "solid_core";
const glowing = (m: AnyMat) =>
  !!m.emissive && (m.emissiveIntensity ?? 0) > 0 && (m.emissive.r + m.emissive.g + m.emissive.b > 0 || !!m.emissiveMap);

/**
 * 나무 안 메시 재질을 구운 재질로 바꾼다. 구운 메시·벽 윗면은 userData.baked = true(정적 합치기 후보), userData.atlas = 빛 지도 이름.
 * 재질 그림(나무결·타일)은 비등방 거르기를 aniso로. 빛 지도는 밉맵 없는 선형 그대로.
 */
export function bakeMaterials(root: THREE.Object3D, manifest: Pick<Manifest, "nodes" | "transparent">, maps: Lightmaps, o: { aniso: number }): MaterialCount {
  const nodes = new Map(Object.entries(manifest.nodes));
  const glass = new Set(manifest.transparent);
  const capMat = new THREE.MeshBasicMaterial({ name: "cap", color: scene3d.wallCap, toneMapped: false });
  const windowGlass = new THREE.MeshBasicMaterial({
    name: "window_glass", color: scene3d.windowGlass.color, transparent: true, opacity: scene3d.windowGlass.opacity,
    depthWrite: false, toneMapped: false, side: THREE.DoubleSide,
  });
  const railGlass = new THREE.MeshBasicMaterial({
    name: "rail_glass", color: scene3d.railGlass.color, transparent: true, opacity: scene3d.railGlass.opacity,
    depthWrite: false, toneMapped: false, side: THREE.DoubleSide,
  });
  const bakedMats = new Map<string, THREE.MeshBasicMaterial>();
  const bakedMat = (own: AnyMat, atlas: string) => {
    const key = `${own.uuid}|${atlas}`;
    let mat = bakedMats.get(key);
    if (!mat) {
      const lm = maps[atlas]!;
      mat = new THREE.MeshBasicMaterial({
        name: `${own.name}@${atlas}`, ...(own.color ? { color: own.color } : {}), map: own.map ?? null,
        lightMap: lm.tex, lightMapIntensity: lm.intensity, side: own.side, alphaTest: own.alphaTest,
      });
      bakedMats.set(key, mat);
    }
    return mat;
  };
  const count: MaterialCount = { baked: 0, cap: 0, glass: 0, glow: 0, live: 0 };
  root.traverse((n) => {
    if (!(n instanceof THREE.Mesh)) return;
    const parent = n.parent && !(n.parent instanceof THREE.Mesh) ? n.parent.name : undefined;
    const atlas = nodes.get(n.name) ?? (parent !== undefined ? nodes.get(parent) : undefined);
    const own = [n.material].flat()[0] as AnyMat;
    const inGlass = glass.has(n.name) || (parent !== undefined && glass.has(parent));
    n.userData.atlas = atlas ?? null;
    if (atlas && maps[atlas] && isCap(own)) { n.material = capMat; n.userData.baked = true; count.cap++; return; }
    if (atlas && maps[atlas] && n.geometry.attributes.uv1 && !own.transparent && !inGlass) {
      if (glowing(own)) { count.glow++; return; }
      n.material = bakedMat(own, atlas);
      n.userData.baked = true;
      count.baked++;
      return;
    }
    if (own.name === "pre_rail_glass") { n.material = railGlass; count.glass++; return; }
    if (inGlass) { n.material = windowGlass; count.glass++; return; }
    if (own.transparent) count.glass++;
    else count.live++;
  });
  root.traverse((n) => {
    if (!(n instanceof THREE.Mesh)) return;
    for (const m of [n.material].flat() as AnyMat[]) if (m.map && m.map.anisotropy !== o.aniso) { m.map.anisotropy = o.aniso; m.map.needsUpdate = true; }
  });
  return count;
}
