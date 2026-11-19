// 클로이드의 눈 표시 영상 일꾼: 대시보드가 넘긴 OffscreenCanvas에 H.264(또는 H.264가 없을 때의 화면 프레임 JPEG)를 풀어 그린다(eye-video.ts runDecoder).
// 메인 스레드가 3D 트윈으로 바빠도 영상은 여기서 계속 돈다. 보일 화면(영상/MJPEG)·통계·장면 시각(왔을 때·그렸을 때)만 메인으로 보내고,
// 메인이 보낸 지연(delay, 마스크 지연만큼)으로 장면을 들고 있다가 그린다.

import { runDecoder, type EyeWorkerMessage } from "./eye-video";

type FromMain = { type: "start"; canvas: OffscreenCanvas; url: string } | { type: "delay"; ms: number };
const scope = self as unknown as { onmessage: ((e: MessageEvent<FromMain>) => void) | null; postMessage(m: EyeWorkerMessage): void };

let decoder: ReturnType<typeof runDecoder> | null = null;
let delay = 0;

scope.onmessage = ({ data }) => {
  if (data.type === "delay") {
    delay = data.ms;
    decoder?.setDelay(delay);
    return;
  }
  if (data.type !== "start") return;
  if ((typeof VideoDecoder !== "function" || typeof EncodedVideoChunk !== "function") && typeof createImageBitmap !== "function") {
    console.warn("[eye-video] 이 브라우저 일꾼에는 VideoDecoder가 없어요. MJPEG로 보여요");
    return;
  }
  decoder = runDecoder({
    canvas: data.canvas,
    url: data.url,
    onMode: (mode) => scope.postMessage({ type: "mode", mode }),
    onStats: (stats) => scope.postMessage({ type: "stats", stats }),
    onFrame: (at) => scope.postMessage({ type: "frame", at }),
    onShown: (at) => scope.postMessage({ type: "shown", at }),
  });
  decoder.setDelay(delay);
};
