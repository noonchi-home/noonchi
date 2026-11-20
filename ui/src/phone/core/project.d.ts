// project.js의 형(테스트에서 TypeScript로 부른다).
export type Mat4 = ArrayLike<number>;
export interface Projected { u: number; v: number; behind: boolean; inside: boolean }
import type { FocusMark } from "../state";
export type { FocusMark } from "../state";
export function project(point: [number, number, number], projection: Mat4, view: Mat4): Projected;
export function toEdge(p: { u: number; v: number }, margin?: number): { u: number; v: number; angle: number };
export function focusMarks(targets: { id: string; label: string; ar: [number, number, number]; walking?: boolean; stand?: boolean }[], projection: Mat4, view: Mat4): FocusMark[];
