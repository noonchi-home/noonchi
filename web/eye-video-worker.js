// 클로이드의 눈 표시 영상 워커: 대시보드가 넘긴 OffscreenCanvas에 H.264를 풀어 그린다(eye-video.js runDecoder).
// 메인 스레드가 3D 트윈으로 바빠도 영상은 여기서 계속 돈다. 보일 화면(영상/MJPEG)과 통계만 메인으로 보낸다.

import { runDecoder } from "./eye-video.js";

self.onmessage = ({ data }) => {
  if (data.type !== "start") return;
  if (typeof VideoDecoder !== "function" || typeof EncodedVideoChunk !== "function") {
    console.warn("[eye-video] 이 브라우저 워커에는 VideoDecoder가 없어요. MJPEG로 보여요");
    return;
  }
  runDecoder({
    canvas: data.canvas,
    url: data.url,
    onMode: (mode) => self.postMessage({ type: "mode", mode }),
    onStats: (stats) => self.postMessage({ type: "stats", stats }),
  });
};
