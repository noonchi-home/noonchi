import { useEffect, useRef, useState } from "react";
import { attachEyeVideo, type EyeMode } from "../panels/eye-video";

const streamUrl = () => `/api/eye/stream?t=${Date.now()}`;

/**
 * 대시보드 폰 칸의 폰 서버 실시간 영상. H.264 표시 영상이 오면 canvas(일꾼이 그림), 아니면 MJPEG <img>. 둘 다 칸을 다 채우고 잘리지 않게(contain) 보인다.
 * 감싸는 상자는 칸을 덮고(absolute inset-0) 크기를 정하지 않는다. 첫 장이 오기 전에는 숨기고, 첫 장이 오면(<img> load·그림 크기 생김·H.264 영상 모드) onShown(true).
 * 서버가 다시 떴으면(연결이 끊겼다 붙음) 끊긴 MJPEG 스트림도 다시 붙이고, 스트림이 끊기면 2초 뒤 다시 붙인다.
 */
export function EyeVideo({ connected, onShown }: { connected: boolean | null; onShown: (shown: boolean) => void }) {
  const [src, setSrc] = useState(streamUrl);
  const [shown, setShown] = useState(false);
  const [mode, setMode] = useState<EyeMode>("jpeg");
  const videoBox = useRef<HTMLDivElement>(null);
  const img = useRef<HTMLImageElement>(null);
  const retry = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const wasConnected = useRef(connected);
  const report = useRef(onShown);
  report.current = onShown;
  const show = () => setShown(true);

  useEffect(() => { if (shown) report.current(true); }, [shown]);

  useEffect(() => {
    if (connected && wasConnected.current === false) setSrc(streamUrl());
    wasConnected.current = connected;
  }, [connected]);

  // H.264: canvas는 한 번만 일꾼에 넘길 수 있어서 붙일 때마다 새로 만든다
  useEffect(() => {
    const box = videoBox.current;
    if (!box) return;
    const canvas = document.createElement("canvas");
    canvas.className = "size-full object-contain";
    canvas.setAttribute("aria-label", "폰 카메라 영상");
    box.append(canvas);
    const video = attachEyeVideo({
      canvas,
      onMode: (m) => {
        setMode(m);
        if (m === "video") setShown(true);
      },
    });
    return () => { video.close(); canvas.remove(); };
  }, []);

  // 스트림은 첫 장이 와야 크기가 생긴다(브라우저마다 load가 늦을 수 있어 크기로도 본다)
  useEffect(() => {
    const sized = setInterval(() => { if ((img.current?.naturalWidth ?? 0) > 0) setShown(true); }, 1000);
    return () => { clearInterval(sized); clearTimeout(retry.current); };
  }, []);

  return (
    <div data-eye-video hidden={!shown} className="absolute inset-0">
      <div ref={videoBox} hidden={mode !== "video"} className="absolute inset-0" />
      <img
        ref={img}
        src={src}
        alt="폰 카메라 영상"
        hidden={mode === "video"}
        draggable={false}
        className="absolute inset-0 size-full select-none object-contain will-change-transform"
        onLoad={show}
        onError={() => { clearTimeout(retry.current); retry.current = setTimeout(() => setSrc(streamUrl()), 2000); }}
      />
    </div>
  );
}
