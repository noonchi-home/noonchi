// aim.js의 형(테스트에서 TypeScript로 부른다).
export const FLOOR_MIN_DROP_M: number;
export const HOLD_HEIGHT_M: number;
export const FLOOR_MAX_DROP_M: number;
export const AIM_MAX_M: number;
export function floorRayPoint(viewer: number[], orientation: number[], floorY: number, maxM?: number): number[] | null;
export function floorPlaneY(viewerY: number, localFloorY: number | null | undefined): number;
export function planeNormal(orientation: number[]): [number, number, number];
export interface AimPoint { point: number[]; orientation: number[] | null; estimated: boolean }
export function aimPoint(opts: {
  hit: number[] | null; hitOrientation: number[] | null;
  viewer: number[] | null; viewerOrientation: number[] | null; localFloorY: number | null | undefined;
}): AimPoint | null;
