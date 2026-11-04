// 폰 프레임 고리 버퍼와 판정 창 고르기. 시각은 촬영 시각(ms)이다(폰이 안 주면 받은 시각).

import type { WindowConfig } from "./config.js";

export interface Frame {
  id: string;
  capturedAtMs: number;
  jpeg: Buffer;
}

/** 촬영 시각 순서로 두고, 최신에서 keepMs보다 오래된 사진을 버린다. */
export class FrameBuffer {
  private list: Frame[] = [];

  constructor(private readonly keepMs: number) {}

  push(frame: Frame): void {
    let i = this.list.length;
    while (i > 0 && this.list[i - 1]!.capturedAtMs > frame.capturedAtMs) i--;
    this.list.splice(i, 0, frame);
    const newest = this.list.at(-1)!.capturedAtMs;
    this.list = this.list.filter((f) => newest - f.capturedAtMs <= this.keepMs);
  }

  frames(): readonly Frame[] {
    return this.list;
  }

  latest(): Frame | undefined {
    return this.list.at(-1);
  }
}

/** target 이하에서 가장 최근 사진(floor 이상). 없으면 undefined. */
export function frameAtOrBefore(frames: readonly Frame[], target: number, floor: number): Frame | undefined {
  for (let i = frames.length - 1; i >= 0; i--) {
    const f = frames[i]!;
    if (f.capturedAtMs <= target) return f.capturedAtMs >= floor ? f : undefined;
  }
  return undefined;
}

/** 최신 1장 + stepMs 간격 이전 사진(spanMs 안, 최대 maxFrames-1장). 오래된 것부터, 중복 없이. */
export function selectWindow(frames: readonly Frame[], cfg: WindowConfig): Frame[] {
  const latest = frames.at(-1);
  if (!latest) return [];
  const floor = latest.capturedAtMs - cfg.spanMs;
  const picked = new Map<string, Frame>([[latest.id, latest]]);
  for (let k = 1; k < cfg.maxFrames; k++) {
    const target = latest.capturedAtMs - k * cfg.stepMs;
    if (target < floor) break;
    const f = frameAtOrBefore(frames, target, floor);
    if (f) picked.set(f.id, f);
  }
  return [...picked.values()].sort((a, b) => a.capturedAtMs - b.capturedAtMs);
}
