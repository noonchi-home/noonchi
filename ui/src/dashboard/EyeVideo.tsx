import { useEffect, useRef, useState } from "react";
import { attachEyeVideo, type EyeMode, type EyeVideo as EyeVideoHandle } from "./panels/eye-video";
import type { SceneSync } from "./scene-sync";

const streamUrl = () => `/api/eye/stream?t=${Date.now()}`;

/**
 * 대시보드 폰 칸의 폰 서버 실시간 영상. H.264 표시 영상이 오면 canvas(일꾼이 그림), 아니면 MJPEG <img>. 둘 다 칸을 다 채우고 잘리지 않게(contain) 보인다.
 * 감싸는 상자는 칸을 덮고(absolute inset-0) 크기를 정하지 않는다. 첫 장이 오기 전에는 숨기고, 첫 장이 오면(<img> load·그림 크기 생김·H.264 영상 모드) onShown(true).
 * 보이는 영상 크기(H.264 표시 영상 크기, MJPEG면 그림 크기)가 생기거나 바뀌면 onSize로 알린다(미니맵이 그 비율을 따른다).
 * 서버가 다시 떴으면(연결이 끊겼다 붙음) 끊긴 MJPEG 스트림도 다시 붙이고, 스트림이 끊기면 2초 뒤 다시 붙인다.
 * sync(장면·마스크 짝, scene-sync.ts)가 있으면 canvas 장면이 올 때·그릴 때마다 그 촬영 시각을 알리고, sync가 정한 지연만큼 장면을 늦게 그린다.
 * 그린 장면의 촬영 시각은 data-scene-at에 둔다(미니맵 녹화가 읽는다). MJPEG로 돌아가면 sync를 처음으로 돌린다.
 */
export function EyeVideo({ connected, onShown, onSize, sync }: {
  connected: boolean | null; onShown: (shown: boolean) => void; onSize?: (size: { width: number; height: number } | null) => void; sync?: SceneSync;
}) {
  const [src, setSrc] = useState(streamUrl);
  const [shown, setShown] = useState(false);
  const [mode, setMode] = useState<EyeMode>("jpeg");
  const videoBox = useRef<HTMLDivElement>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const handle = useRef<EyeVideoHandle | null>(null);
  const syncRef = useRef(sync);
  syncRef.current = sync;
  const img = useRef<HTMLImageElement>(null);
  const retry = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const wasConnected = useRef(connected);
  const report = useRef(onShown);
  report.current = onShown;
  const reportSize = useRef(onSize);
  reportSize.current = onSize;
  // 두 길(H.264 canvas, MJPEG 그림)의 크기. 지금 보이는 쪽 것을 알린다
  const sizes = useRef<{ video: { width: number; height: number } | null; jpeg: { width: number; height: number } | null }>({ video: null, jpeg: null });
  const modeRef = useRef<EyeMode>("jpeg");
  const tell = () => reportSize.current?.(modeRef.current === "video" ? sizes.current.video ?? sizes.current.jpeg : sizes.current.jpeg);
  const readImg = () => {
    const el = img.current;
    if (!el || el.naturalWidth <= 0 || el.naturalHeight <= 0) return;
    const was = sizes.current.jpeg;
    if (was?.width === el.naturalWidth && was.height === el.naturalHeight) return;
    sizes.current.jpeg = { width: el.naturalWidth, height: el.naturalHeight };
    tell();
  };
  const show = () => { readImg(); setShown(true); };

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
        modeRef.current = m;
        setMode(m);
        if (m === "video") setShown(true);
        else syncRef.current?.reset();
        tell();
      },
      onSize: (size) => { sizes.current.video = size; tell(); },
      onFrame: (at) => { if (at !== null) syncRef.current?.frame(at); },
      onShown: (at) => {
        syncRef.current?.shown(at);
        const el = wrap.current;
        if (!el) return;
        if (at === null) delete el.dataset.sceneAt;
        else el.dataset.sceneAt = String(at);
      },
    });
    handle.current = video;
    video.setDelay(syncRef.current?.delayMs() ?? 0);
    return () => { handle.current = null; video.close(); canvas.remove(); };
  }, []);

  // 마스크 지연이 바뀌면 영상 일꾼에 알린다
  useEffect(() => {
    if (!sync) return;
    handle.current?.setDelay(sync.delayMs());
    return sync.onDelay((ms) => handle.current?.setDelay(ms));
  }, [sync]);

  // 스트림은 첫 장이 와야 크기가 생긴다(브라우저마다 load가 늦을 수 있어 크기로도 본다)
  useEffect(() => {
    const sized = setInterval(() => { if ((img.current?.naturalWidth ?? 0) > 0) { readImg(); setShown(true); } }, 1000);
    return () => { clearInterval(sized); clearTimeout(retry.current); };
  }, []);

  return (
    <div ref={wrap} data-eye-video hidden={!shown} className="absolute inset-0">
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
