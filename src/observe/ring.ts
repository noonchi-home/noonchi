// 엔진 프레임 메모리 고리(기본 20초, 100ms 간격이면 약 200장). 디스크에 쓰지 않는다. 직전 프레임과 SHA-256이 같으면 새 프레임으로 넣지 않는다.
// 가장 새 프레임보다 keepMs 넘게 앞서 찍힌 프레임(늦게 온 프레임)도 넣지 않는다.
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
  /** 가까이 보기로 잘라 키운 사진이면 잘라 낸 자리(원래 엔진 프레임 픽셀 [x, y, w, h]). 고리에는 넣지 않고 VLM 풀에만 간다. */
  crop?: [number, number, number, number];
  /** 이 프레임을 VLM·기록·가까이 보기에 쓰는가. false면 YOLO만 돌리는 빠른 프레임이다. 없으면 VLM 프레임. */
  vlm?: boolean;
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

  /** 넣으면 added. 직전 프레임과 같은 사진이면 duplicate, 고리 범위보다 앞서 찍혔으면 stale(둘 다 넣지 않음). */
  push(f: EngineFrame): "added" | "duplicate" | "stale" {
    if (f.sha256 === this.lastSha) {
      this.duplicates++;
      return "duplicate";
    }
    const newest = this.list.at(-1)?.capturedAtMs;
    if (newest !== undefined && newest - f.capturedAtMs > this.keepMs) return "stale";
    this.lastSha = f.sha256;
    let i = this.list.length;
    while (i > 0 && this.list[i - 1]!.capturedAtMs > f.capturedAtMs) i--;
    this.list.splice(i, 0, f);
    const last = this.list.at(-1)!.capturedAtMs;
    this.list = this.list.filter((x) => last - x.capturedAtMs <= this.keepMs);
    return "added";
  }

  get(id: string): EngineFrame | undefined {
    return this.list.find((f) => f.id === id);
  }

  frames(): readonly EngineFrame[] {
    return this.list;
  }

  /** VLM 창: frame과 그보다 앞서 찍힌 VLM 프레임 가운데 가장 새 count장(frame 포함), 오래된 것부터. frame보다 spanMs 이상 앞선 프레임과 빠른 프레임은 뺀다. */
  window(frame: EngineFrame, count: number, spanMs: number): EngineFrame[] {
    const before = this.list.filter((f) => f !== frame && f.vlm !== false && f.capturedAtMs <= frame.capturedAtMs && frame.capturedAtMs - f.capturedAtMs < spanMs);
    return [...before.slice(Math.max(0, before.length - (Math.max(1, count) - 1))), frame];
  }
}
