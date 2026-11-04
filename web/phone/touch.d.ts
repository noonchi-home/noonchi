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
