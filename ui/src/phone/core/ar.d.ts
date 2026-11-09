// ar.js의 형.
import type { PhoneLink } from "./link.js";
import type { FocusMark } from "./marks.js";

export interface ArState {
  on: boolean;
  epoch: string | null;
  hitPoint: number[] | null;
  /** 조준점이 hit-test 점이 아니라 어림 바닥 점. */
  hitEstimated: boolean;
  lastFloor: number[] | null;
  limited: boolean;
  size: string;
  encoder: string;
}
export interface ArHooks {
  onStart(): void;
  onEnd(): void;
  /** hit: 조준점이 바닥에 닿음. estimated: 그 점이 어림 바닥(hit-test 점이 없음). */
  onHit(hit: boolean, estimated: boolean): void;
  onMarks(marks: FocusMark[]): void;
  onPerf(): void;
  note(text: string): void;
}
export interface FocusTargetAr { id: string; label: string; ar: [number, number, number] }
export interface PhoneAr {
  readonly state: ArState;
  start(overlay: object): Promise<void>;
  stop(): void;
  requestPhoto(): void;
  setEngineMs(ms: unknown): void;
  setFocus(targets: FocusTargetAr[] | undefined, ttlMs: number | undefined): void;
  perf(): { fps: string; detail: string };
}
export function newEpoch(): string;
export function createAr(opts: { link: PhoneLink; params: URLSearchParams; hooks: ArHooks; deps?: Record<string, unknown> }): PhoneAr;
