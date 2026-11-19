// 엔진 프레임 메모리 고리(기본 20초, 100ms 간격이면 약 200장). 디스크에 쓰지 않는다. 직전 프레임과 SHA-256이 같으면 새 프레임으로 넣지 않는다
// (멈춘 카메라가 같은 사진을 보내면 새로 본 것이 아니다). 붙잡은 장면을 다시 보낸 프레임(held)만 resendAfterMs 간격마다 넣는다.
// 가장 새 프레임보다 keepMs 넘게 앞서 찍힌 프레임(늦게 온 프레임)도 넣지 않는다.
import { createHash } from "node:crypto";
import type { EngineFrame } from "../contract/observe.js";


export const sha256 = (b: Buffer): string => createHash("sha256").update(b).digest("hex");

/** 촬영 시각(src/shared/capture-time.ts): 표시 장면(src/phone/server.ts)도 같은 규칙이다. */
export { captureTime } from "../shared/capture-time.js";

export class FrameRing {
  private list: EngineFrame[] = [];
  private lastSha: string | null = null;
  private duplicates = 0;
  constructor(private readonly keepMs = 20_000) {}

  /** 버린 중복 수. */
  get dropped(): number {
    return this.duplicates;
  }

  /** 넣으면 added. 직전 프레임과 같은 사진이면 duplicate, 고리 범위보다 앞서 찍혔으면 stale(둘 다 넣지 않음).
   *  resendAfterMs: 붙잡은 장면 다시 보내기. 같은 사진이어도 가장 새 프레임보다 이만큼 뒤에 찍혔으면 넣는다. */
  push(f: EngineFrame, opts: { resendAfterMs?: number } = {}): "added" | "duplicate" | "stale" {
    const newest = this.list.at(-1)?.capturedAtMs;
    const resend = opts.resendAfterMs !== undefined && newest !== undefined && f.capturedAtMs - newest >= opts.resendAfterMs;
    if (f.sha256 === this.lastSha && !resend) {
      this.duplicates++;
      return "duplicate";
    }
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
