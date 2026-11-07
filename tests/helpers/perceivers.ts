// 시험용 판정기: 함수가 판정을 정한다(null이면 실패). 지연(ms)을 줄 수 있다. 실제 판정은 src/brain/perception.ts의 VlmPerceiver.
import { normalizePerception, type PerceiveReply, type Perceiver, type RawPerception } from "../../src/brain/perception.js";
import type { Frame } from "../../src/brain/window.js";

export class ScriptedPerceiver implements Perceiver {
  constructor(
    private readonly script: (frames: readonly Frame[]) => RawPerception | null,
    private readonly delay: (ms: number) => Promise<void> = async () => {},
    private readonly latencyMs = 0,
  ) {}

  async perceive(frames: readonly Frame[]): Promise<PerceiveReply> {
    if (this.latencyMs) await this.delay(this.latencyMs);
    const raw = this.script(frames);
    return raw ? { perception: normalizePerception(raw), costUsd: 0, model: "scripted", attempts: 1 }
      : { perception: null, costUsd: 0, model: "scripted", attempts: 1, error: "대본 판정 없음" };
  }
}
