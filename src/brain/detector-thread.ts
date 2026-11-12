// YOLO 워커 스레드 본체(detector-worker.mjs가 불러온다). onnxruntime-node의 추론(run)은 부른 스레드를 막아서,
// 같은 스레드에서 초당 12장을 돌리면 VLM 응답 처리까지 밀린다(이 PC: VLM 판정 1.7~1.9초 → 4초, 근거가 3초를 넘어 모두 모름).
// 그래서 JPEG 풀기·레터박스·감지·관절 추론을 이 스레드에서 한다.
// 닫기는 {close: true}로 받는다: 진행 중인 추론을 마치고 세션을 놓은 뒤 스스로 끝낸다(강제 종료보다 onnxruntime 정리가 안전).

import { parentPort, workerData } from "node:worker_threads";
import { OnnxDetector, type DetectorSpec } from "./detector.js";

const { spec } = workerData as { spec: DetectorSpec };
const port = parentPort!;
try {
  const det = await OnnxDetector.create(spec);
  let running: Promise<void> = Promise.resolve();
  port.on("message", (m: { id?: number; jpeg?: Uint8Array; close?: true }) => {
    if (m.close) {
      void running.then(() => det.close()).finally(() => port.close());
      return;
    }
    const { id, jpeg } = m as { id: number; jpeg: Uint8Array };
    running = running.then(async () => {
      try {
        port.postMessage({ id, result: await det.detect(Buffer.from(jpeg.buffer, jpeg.byteOffset, jpeg.byteLength)) });
      } catch (e) {
        port.postMessage({ id, error: (e as Error).message });
      }
    });
  });
  port.postMessage({ ready: det.name, pose: det.pose, provider: det.provider, decoder: det.decoder });
} catch (e) {
  port.postMessage({ failed: (e as Error).message });
}
