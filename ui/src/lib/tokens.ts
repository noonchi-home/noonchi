// 디자인 토큰(src/design/tokens.json, feat/design-system과 같은 원본)의 TS 값. 지도 SVG처럼 class로 칠할 수 없는 그림의 색·굵기를 여기서 읽는다.
import { alias, color, overlayLine, twin, viz } from "../../../src/design/tokens.json";

type ColorName = keyof typeof color;
type AliasName = keyof typeof alias;
/** {ref: 토큰 이름} 꼴의 값(굵기·불투명도가 붙기도 한다). */
export type Ref = { ref: string; width?: number; opacity?: number };
export type Paint = { color: string; width: number; opacity: number };

/** 토큰 이름 → hex. 별칭(twin-edge 등)은 가리키는 토큰을 따라간다. */
export function hex(name: string): string {
  if (name in color) return color[name as ColorName].value;
  if (name in alias) return hex(alias[name as AliasName].ref);
  throw new Error(`없는 색 토큰: ${name}`);
}

/** {ref, width?, opacity?} → 색·굵기·불투명도(없으면 0·1). */
export const paint = (r: Ref): Paint => ({ color: hex(r.ref), width: r.width ?? 0, opacity: r.opacity ?? 1 });

/** 트윈·지도 위 표시 토큰(경로·목적지·클로이드·확인 점·말풍선). */
export const TWIN = twin;
/** 메시지 상자 FSM 카드 선·원 테·빨간 점 토큰(카드 바탕 위 한 겹). */
export const FSM = viz.fsm;
/** 트윈·지도 위 선 세 겹(바깥 숯색, 흰 테, 심) 규칙. */
export const OVERLAY = overlayLine;
