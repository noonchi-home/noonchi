import { ChevronUp, Eye } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { HealthView } from "../../../src/contract/events.ts";
import { Button } from "../components/ui/button";
import { Item, ItemContent, ItemDescription, ItemTitle } from "../components/ui/item";
import { LiquidGlass } from "../components/ui/liquid-glass";
import { QRCode } from "../components/ui/qr-code";
import { attachEyeVideo, type EyeMode } from "./eye-video";
import { pickPhoneUrl } from "./phone-url";

const streamUrl = () => `/api/eye/stream?t=${Date.now()}`;

/** 안내 한 줄(21st.dev Basic Item). */
const Line = ({ text }: { text: string }) => (
  <Item size="sm" className="justify-center"><ItemContent className="items-center"><ItemTitle>{text}</ItemTitle></ItemContent></Item>
);

/** 폰이 아직 화면을 보내지 않을 때: 맨 앞 폰 주소 QR(찍으면 바로 시작), 한 줄, 주소는 작게. */
function Waiting({ health }: { health: HealthView | null }) {
  if (!health) return <div className="size-48" />;
  if (!health.eye) return <Line text="폰 서버가 꺼져 있어요." />;
  const { best } = pickPhoneUrl(health.phone_urls);
  if (!best) return <Line text="폰에서 AR을 시작하세요." />;
  return (
    <div className="flex flex-col items-center gap-2">
      <QRCode value={best} variant="squares" aria-label="폰 접속 QR" className="size-48" />
      <Item size="sm" className="max-w-48 justify-center">
        <ItemContent className="items-center">
          <ItemTitle>폰 카메라로 찍으세요</ItemTitle>
          <ItemDescription className="break-all text-center">{best}</ItemDescription>
        </ItemContent>
      </Item>
    </div>
  );
}

/**
 * 폰 카메라 화면만 보이는 자리. H.264 표시 영상이 오면 canvas(일꾼이 그림), 아니면 MJPEG <img>.
 * 첫 장이 오기 전에는 폰 접속 QR을 보인다. large면 놓인 자리를 채운다(판단 기록 패널의 폰 화면 탭).
 */
export function EyeBody({ health, connected, large }: { health: HealthView | null; connected?: boolean | null; large?: boolean }) {
  const live = !!health?.eye;
  const [src, setSrc] = useState(streamUrl);
  const [shown, setShown] = useState(false);
  const [mode, setMode] = useState<EyeMode>("jpeg");
  const videoBox = useRef<HTMLDivElement>(null);
  const img = useRef<HTMLImageElement>(null);
  const retry = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const wasConnected = useRef(connected);

  // 서버가 다시 떴으면(연결이 끊겼다 붙음) 끊긴 MJPEG 스트림도 다시 붙인다
  useEffect(() => {
    if (connected && wasConnected.current === false) setSrc(streamUrl());
    wasConnected.current = connected;
  }, [connected]);

  // H.264: canvas는 한 번만 일꾼에 넘길 수 있어서 붙일 때마다 새로 만든다
  useEffect(() => {
    const box = videoBox.current;
    if (!live || !box) return;
    const canvas = document.createElement("canvas");
    canvas.className = "h-full w-full object-contain";
    canvas.setAttribute("aria-label", "폰 카메라 실시간 영상");
    box.append(canvas);
    const video = attachEyeVideo({
      canvas,
      onMode: (m) => {
        setMode(m);
        if (m === "video") setShown(true);
      },
    });
    return () => { video.close(); canvas.remove(); };
  }, [live]);

  // 스트림은 첫 장이 와야 크기가 생긴다(브라우저마다 load가 늦을 수 있어 크기로도 본다)
  useEffect(() => {
    if (!live) return;
    const sized = setInterval(() => { if ((img.current?.naturalWidth ?? 0) > 0) setShown(true); }, 1000);
    return () => { clearInterval(sized); clearTimeout(retry.current); };
  }, [live]);

  return (
    <>
      {live && (
        <figure hidden={!shown} className={large ? "m-0 h-full min-h-0 flex-1" : "m-0"}>
          <div className={large ? "relative h-full w-full" : "relative h-96 w-56"}>
            <div ref={videoBox} hidden={mode !== "video"} className="absolute inset-0" />
            <img
              ref={img}
              src={src}
              alt="폰 카메라 실시간 화면"
              hidden={mode === "video"}
              className="absolute inset-0 h-full w-full object-contain"
              onLoad={() => setShown(true)}
              onError={() => { clearTimeout(retry.current); retry.current = setTimeout(() => setSrc(streamUrl()), 2000); }}
            />
          </div>
        </figure>
      )}
      {!shown && <div className={large ? "flex flex-1 items-center justify-center p-6" : "w-56 px-4 pb-4 pt-9"}><Waiting health={health} /></div>}
    </>
  );
}

/**
 * 왼쪽 위 작은 창. 판은 21st.dev Liquid Glass(판 16px, tint 0.9)다. 접으면 눈 단추 알약(tint 0.6)만 남고 화면 받기를 멈춘다.
 * 640px보다 좁으면 대시보드의 쌓기 상자 안에서 제자리(relative)에 놓여 판단 기록 위에 선다.
 */
export function EyeWindow({ health, connected }: { health: HealthView | null; connected?: boolean | null }) {
  const [open, setOpen] = useState(true);
  return (
    <section aria-label="클로이드의 눈" className="absolute left-3 top-16 z-50 min-[1440px]:top-3 max-sm:relative max-sm:inset-auto max-sm:self-start">
      {open ? (
        <LiquidGlass radius={16} contentClassName="relative">
          <EyeBody health={health} connected={connected} />
          <Button variant="secondary" size="icon" aria-label="눈 창 접기" aria-expanded onClick={() => setOpen(false)} className="absolute right-1.5 top-1.5 h-7 w-7">
            <ChevronUp className="size-4" aria-hidden="true" />
          </Button>
        </LiquidGlass>
      ) : (
        <LiquidGlass tint={0.6} contentClassName="p-1">
          <Button variant="ghost" size="sm" aria-label="눈 창 펴기" aria-expanded={false} onClick={() => setOpen(true)} className="gap-1.5">
            <Eye className="size-4" aria-hidden="true" />클로이드의 눈
          </Button>
        </LiquidGlass>
      )}
    </section>
  );
}
