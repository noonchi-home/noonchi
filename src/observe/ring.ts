// 엔진 프레임 메모리 고리(기본 20초). 디스크에 쓰지 않는다. 직전 프레임과 SHA-256이 같으면 새 프레임으로 넣지 않는다.
import { createHash } from "node:crypto";
import type { EyePose } from "../contract/events.js";
import type { CameraView } from "../phone/session.js";

export interface EngineFrame {
  id: string;
  /** 촬영 시각(가장 이른 가능 시각, captureTime). */
  capturedAtMs: number;
  /** 가장 늦은 가능 촬영 시각. */
  latestAtMs: number;
  jpeg: Buffer;
  sha256: string;
  width: number;
  height: number;
  /** 그 순간 트윈 눈 자세(맞추기 전 null). */
  eye: EyePose | null;
  /** 그 순간 카메라(맞추기 전·투영 없음이면 null). */
  view: CameraView | null;
}

export const sha256 = (b: Buffer): string => createHash("sha256").update(b).digest("hex");

/** 촬영 시각 범위: 동기 정보가 있으면 [captured_at − 오차, captured_at + 오차], 없으면 받은 시각 하나. 받은 시각보다 늦을 수 없다.
 *  폰이 NTP식 clock 핑으로 서버 시계에 맞춘 captured_at과 오차 time_err_ms를 보낸다. atMs(이른 쪽)를 촬영 시각으로 쓴다. */
export function captureTime(meta: { receivedAtMs: number; capturedAt?: number; timeErrMs?: number }): { atMs: number; latestMs: number; source: "phone" | "received" } {
  const { capturedAt, timeErrMs } = meta;
  if (typeof capturedAt === "number" && Number.isFinite(capturedAt) && typeof timeErrMs === "number" && Number.isFinite(timeErrMs) && timeErrMs >= 0) {
    const latestMs = Math.min(meta.receivedAtMs, Math.round(capturedAt + timeErrMs));
    return { atMs: Math.min(latestMs, Math.round(capturedAt - timeErrMs)), latestMs, source: "phone" };
  }
  return { atMs: meta.receivedAtMs, latestMs: meta.receivedAtMs, source: "received" };
}

export class FrameRing {
  private list: EngineFrame[] = [];
  private lastSha: string | null = null;
  private duplicates = 0;
  constructor(private readonly keepMs = 20_000) {}

  /** 버린 중복 수. */
  get dropped(): number {
    return this.duplicates;
  }

  /** 직전 프레임과 같은 사진이면 넣지 않고 false. */
  push(f: EngineFrame): boolean {
    if (f.sha256 === this.lastSha) {
      this.duplicates++;
      return false;
    }
    this.lastSha = f.sha256;
    let i = this.list.length;
    while (i > 0 && this.list[i - 1]!.capturedAtMs > f.capturedAtMs) i--;
    this.list.splice(i, 0, f);
    const newest = this.list.at(-1)!.capturedAtMs;
    this.list = this.list.filter((x) => newest - x.capturedAtMs <= this.keepMs);
    return true;
  }

  get(id: string): EngineFrame | undefined {
    return this.list.find((f) => f.id === id);
  }

  frames(): readonly EngineFrame[] {
    return this.list;
  }
}
