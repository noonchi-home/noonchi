// 톤: Blender AgX High Contrast 흉내(스파이크 docs/twin3d-spike/main.mjs 49~79줄). AgX 로그 공간에서 대비 1.4·채도 0.95, 중간 회색 기준.
// three의 CustomToneMapping 자리를 한 번만 바꾼다(렌더러는 toneMapping = CustomToneMapping).
import * as THREE from "three";

const EMPTY = "vec3 CustomToneMapping( vec3 color ) { return color; }";
const AGX_HIGH_CONTRAST = `vec3 CustomToneMapping( vec3 color ) {
      const mat3 AgXInsetMatrix = mat3(
        vec3( 0.856627153315983, 0.137318972929847, 0.11189821299995 ),
        vec3( 0.0951212405381588, 0.761241990602591, 0.0767994186031903 ),
        vec3( 0.0482516061458583, 0.101439036467562, 0.811302368396859 ) );
      const mat3 AgXOutsetMatrix = mat3(
        vec3( 1.1271005818144368, - 0.1413297634984383, - 0.14132976349843826 ),
        vec3( - 0.11060664309660323, 1.157823702216272, - 0.11060664309660294 ),
        vec3( - 0.016493938717834573, - 0.016493938717834257, 1.2519364065950405 ) );
      const float AgxMinEv = - 12.47393;
      const float AgxMaxEv = 4.026069;
      color *= toneMappingExposure;
      color = LINEAR_SRGB_TO_LINEAR_REC2020 * color;
      color = AgXInsetMatrix * color;
      color = max( color, 1e-10 );
      color = log2( color );
      color = ( color - AgxMinEv ) / ( AgxMaxEv - AgxMinEv );
      float pivot = ( log2( 0.18 ) - AgxMinEv ) / ( AgxMaxEv - AgxMinEv );
      color = ( color - pivot ) * 1.4 + pivot;
      float luma = dot( color, vec3( 0.2126, 0.7152, 0.0722 ) );
      color = mix( vec3( luma ), color, 0.95 );
      color = clamp( color, 0.0, 1.0 );
      color = agxDefaultContrastApprox( color );
      color = AgXOutsetMatrix * color;
      color = pow( max( vec3( 0.0 ), color ), vec3( 2.2 ) );
      color = LINEAR_REC2020_TO_LINEAR_SRGB * color;
      return clamp( color, 0.0, 1.0 );
    }`;

let installed = false;

/** CustomToneMapping을 AgX High Contrast 흉내로 바꾼다. 두 번째부터는 아무것도 하지 않는다. */
export function installAgxHighContrast(): boolean {
  if (installed) return false;
  const chunk = THREE.ShaderChunk.tonemapping_pars_fragment;
  if (!chunk.includes(EMPTY)) throw new Error("three tonemapping_pars_fragment: CustomToneMapping slot not found");
  THREE.ShaderChunk.tonemapping_pars_fragment = chunk.replace(EMPTY, AGX_HIGH_CONTRAST);
  installed = true;
  return true;
}
