// 클로이드의 눈 표시 영상 일꾼: 대시보드가 넘긴 OffscreenCanvas에 H.264를 풀어 그린다(eye-video.ts runDecoder).
// 메인 스레드가 3D 트윈으로 바빠도 영상은 여기서 계속 돈다. 보일 화면(영상/MJPEG)과 통계만 메인으로 보낸다.

import { runDecoder } from "./eye-video";

const scope = self as unknown as { onmessage: ((e: MessageEvent<{ type: string; canvas: OffscreenCanvas; url: string }>) => void) | null; postMessage(m: unknown): void };

scope.onmessage = ({ data }) => {
  if (data.type !== "start") return;
  if (typeof VideoDecoder !== "function" || typeof EncodedVideoChunk !== "function") {
    console.warn("[eye-video] 이 브라우저 일꾼에는 VideoDecoder가 없어요. MJPEG로 보여요");
    return;
  }
  runDecoder({
    canvas: data.canvas,
    url: data.url,
    onMode: (mode) => scope.postMessage({ type: "mode", mode }),
    onStats: (stats) => scope.postMessage({ type: "stats", stats }),
  });
};
