import { useEffect, useRef, useState } from "react";
import { Item, ItemContent, ItemDescription, ItemTitle } from "../components/ui/item";
import { LiquidGlass } from "../components/ui/liquid-glass";
import { QRCode } from "../components/ui/qr-code";
import { EyeVideo } from "./EyeVideo";
import { useBoxSize } from "./fit";
import type { Rect } from "./layout";
import { MaskLayer } from "./MaskLayer";
import type { SeenStore } from "./masks";
import { WORDS } from "./words";

/**
 * 대시보드 폰 칸 영상 자리에 놓을 것. none: 폰 서버 상태를 아직 모른다(빈 칸). qr: 폰 영상이 없다(폰 서버 꺼짐).
 * live: 폰 서버의 실시간 영상(첫 장 전에는 url 연결 QR). image: 그림 한 장(가짜 단계용, 그림 픽셀 크기).
 */
export type PhoneSlot = { kind: "none" } | { kind: "qr"; url: string } | { kind: "live"; url: string } | { kind: "image"; src: string; width: number; height: number };

/** 연결 QR 크기(px): 영상 칸 너비·높이 중 짧은 쪽(가로 칸이라 높이)에서 양쪽 여백(p-6)을 뺀 만큼. */
const QR_PAD = 48;
const QR_MIN = 96;

/**
 * 폰 연결 QR과 그 오른쪽 할 일 한 줄·주소(Item). 가로 칸이라 옆으로 나란히 둔다. 폰 영상이 없을 때 영상 칸 자리에 보인다.
 * 주소가 없으면 지금 상태 한 줄(Item sm): 폰 서버가 꺼졌으면 「폰 서버가 꺼져 있어요.」, 켜졌으면(live) 「폰에서 AR을 시작하세요.」.
 */
function ConnectQr({ url, live, slot }: { url: string; live: boolean; slot: { width: number; height: number } }) {
  if (!url) {
    return (
      <div className="flex size-full items-center justify-center p-6">
        <Item size="sm" className="w-auto min-w-0">
          <ItemContent className="min-w-0">
            <ItemTitle>{live ? WORDS.startAr : WORDS.phoneOff}</ItemTitle>
          </ItemContent>
        </Item>
      </div>
    );
  }
  const size = Math.max(QR_MIN, Math.floor(Math.min(slot.width, slot.height) - QR_PAD));
  return (
    <div className="flex size-full items-center justify-center gap-4 p-6">
      <QRCode value={url} size={size} variant="squares" aria-label="폰 연결 QR" className="shrink-0" />
      <Item size="sm" className="w-auto min-w-0 shrink">
        <ItemContent className="min-w-0">
          <ItemTitle>폰 카메라로 찍으세요</ItemTitle>
          <ItemDescription className="break-all">{url}</ItemDescription>
        </ItemContent>
      </Item>
    </div>
  );
}

/**
 * 비전 미니맵(대시보드 폰 칸, 화면 이름 「폰 카메라」). 트윈 오른쪽 위에 얹은 가로 16:9 칸(자리 box, layout.ts)이고 둥근 불투명 판(LiquidGlass) 하나다. 실제 폰은 세로로 든다.
 * 칸을 다 채우는 영상 칸에 폰에서 온 영상을 잘리지 않게(contain) 깔아 세로 영상이면 양옆을 비우고, 그 위에 물체 모양(마스크, MaskLayer)과 이름·신뢰도(Status)를 그린다.
 * 네모 테두리는 그리지 않는다. 마스크는 영상이 보일 때만(image, 또는 live 첫 장 뒤) 그린다.
 * 영상이 없으면(qr) 영상 칸 자리에 칸에 맞춘 연결 QR을 보이고, live는 첫 장이 오기 전까지 영상 위에 연결 QR을 둔다. 폰 주소가 없으면 QR 대신 지금 상태 한 줄이다.
 * 폰 서버 상태를 아직 모르면(none) 빈 칸이다.
 * 영상 종류·자료와 상관없이 크기가 바뀌지 않는다. 보기만 한다: 마우스를 받지 않는다. 트윈 위(z-50)에 있다.
 */
export function PhonePane({ slot, seen, box, connected }: {
  slot: PhoneSlot;
  /** 마지막 물체 모양(seen) 저장소. 마스크 층만 듣는다. */
  seen: SeenStore;
  /** 칸 자리(화면 px). */
  box: Rect;
  /** 서버와 실시간으로 이어져 있는가(다시 붙으면 실시간 영상도 다시 붙인다). */
  connected: boolean | null;
}) {
  const video = useRef<HTMLDivElement>(null);
  const size = useBoxSize(video);
  const live = slot.kind === "live";
  const [shown, setShown] = useState(false);
  // 폰 서버 영상이 없어지면 다시 첫 장을 기다린다
  useEffect(() => { if (!live) setShown(false); }, [live]);
  const visible = slot.kind === "image" || (live && shown);
  const image = slot.kind === "image" ? { width: slot.width, height: slot.height } : null;
  return (
    <section aria-label="폰 카메라" data-phone className="pointer-events-none absolute z-50" style={{ left: box.left, top: box.top, width: box.width, height: box.height }}>
      <LiquidGlass mode="opaque" radius={16} className="size-full">
        <div ref={video} data-video className="relative size-full overflow-hidden">
          {slot.kind === "image" && (
            <img src={slot.src} alt="폰 카메라 영상" draggable={false} className="absolute inset-0 size-full select-none object-contain will-change-transform" />
          )}
          {live && <EyeVideo connected={connected} onShown={setShown} />}
          {visible ? <MaskLayer seen={seen} fallback={image} size={size} ceiling={0} /> : slot.kind === "none" ? null : <ConnectQr url={slot.url} live={live} slot={size} />}
        </div>
      </LiquidGlass>
    </section>
  );
}
