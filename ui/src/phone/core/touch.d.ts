// touch.js의 형(테스트에서 TypeScript로 부른다).
export type TouchResult =
  | { state: "sampling" }
  | { state: "done"; point: [number, number, number]; floor: [number, number, number] | null }
  | { state: "failed"; reason: string };
export function createTouchSampler(opts: { start: number; windowMs?: number; minSamples?: number; maxGapMs?: number; maxSpreadM?: number }): {
  add(time: number, position: number[], tracking: "ok" | "limited", floor: number[] | null): void;
  result(now: number): TouchResult & { point?: number[]; floor?: number[] | null; reason?: string };
};
export const FLOOR_MIN_DROP_M: number;
export function floorCandidate(
  position: number[] | null, orientation: number[] | null, viewer: number[] | null,
): number[] | null;
export const HOLD_HEIGHT_M: number;
export const FLOOR_MAX_DROP_M: number;
export const AIM_MAX_M: number;
export function floorRayPoint(viewer: number[], orientation: number[], floorY: number, maxM?: number): number[] | null;
export function floorPlaneY(viewerY: number, localFloorY: number | null | undefined): number;
export interface AimPoint { point: number[]; orientation: number[] | null; estimated: boolean }
export function aimPoint(opts: {
  hit: number[] | null; hitOrientation: number[] | null;
  viewer: number[] | null; viewerOrientation: number[] | null; localFloorY: number | null | undefined;
}): AimPoint | null;
