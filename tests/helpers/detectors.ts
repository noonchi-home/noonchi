// 시험용 감지기: 함수가 감지(와 관절)를 정한다. 실제 감지기는 src/brain/detector.ts의 OnnxDetector·WorkerDetector.
import type { DetectResult, Detection, Detector, Pose } from "../../src/brain/detector.js";

export class ScriptedDetector implements Detector {
  readonly name = "scripted";
  readonly pose: string | null;
  /** poses: 관절 대본. 없으면 관절을 내지 않고, undefined를 돌려주면 그 프레임은 관절을 돌리지 않은 것. */
  constructor(private readonly script: (jpegBytes: Buffer) => Detection[], private readonly poses?: (jpegBytes: Buffer) => Pose[] | undefined) {
    this.pose = poses ? "scripted-pose" : null;
  }

  async detect(jpegBytes: Buffer): Promise<DetectResult> {
    const r: DetectResult = { detections: this.script(jpegBytes), ms: 0, width: 0, height: 0 };
    const poses = this.poses?.(jpegBytes);
    return poses ? { ...r, poses, poseMs: 0 } : r;
  }
}
