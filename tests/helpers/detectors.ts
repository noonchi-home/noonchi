// 시험용 감지기: 함수가 감지를 정한다. 실제 감지기는 src/brain/detector.ts의 YoloxDetector·WorkerDetector.
import type { DetectResult, Detection, Detector } from "../../src/brain/detector.js";

export class ScriptedDetector implements Detector {
  readonly name = "scripted";
  constructor(private readonly script: (jpegBytes: Buffer) => Detection[]) {}

  async detect(jpegBytes: Buffer): Promise<DetectResult> {
    return { detections: this.script(jpegBytes), ms: 0, width: 0, height: 0 };
  }
}
