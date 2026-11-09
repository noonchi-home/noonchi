// switch-judge.mjs 타입(시험에서 쓴다).
export interface SwitchPage { frames: number; worstGap: number; gaps?: number[]; longTask?: number }
export interface Limits { maxGapFrames: number; minFrameShare: number; maxDropShare: number; maxTask: number }
export const WIN: { before: number; after: number };
export const LIMITS: Limits;
export function stepEdges(seconds: number, stepMs: number): number[];
export function gapsAround(raf: number[], t: number, win?: { before: number; after: number }): number[];
export function gapFrames(gap: number, vsync: number): number;
export function expectedFrames(vsync: number, win?: { before: number; after: number }): number;
export function droppedFrames(page: SwitchPage, vsync: number, win?: { before: number; after: number }): number;
export function judgeSwitch(page: SwitchPage, vsync: number, opts?: { traceLongest?: number; limits?: Limits; win?: { before: number; after: number } }): string[];
export function judgeRun(
  result: { vsync: number; win?: { before: number; after: number }; switches: { n: number; page: SwitchPage; trace: { longest: number } | null }[] },
  limits?: Limits,
): { ok: boolean; fails: string[]; switches: { n: number; dropped: number; fails: string[] }[]; dropped: number; expected: number; worstTask: number };
