import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { MeerkatFace, PhoneTopLine } from "../components/phone-top-line";
import { Item, ItemContent, ItemDescription, ItemTitle } from "../components/ui/item";
import { LiquidGlass } from "../components/ui/liquid-glass";
import { QRCode } from "../components/ui/qr-code";
import { EyeVideo } from "./EyeVideo";
import { useBoxSize, type BoxSize } from "./fit";
import type { Rect } from "./layout";
import { MaskLayer } from "./MaskLayer";
import type { SeenStore } from "./masks";
import { createSceneSync } from "./scene-sync";
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
 * 대시보드 폰 칸(화면 이름 「폰 카메라」). command를 받으면 영상 위에 실제 폰의 명령 줄을 겹친다.
 * 미니맵 녹화에서는 창 전체를 영상에 쓰고 MinimapView가 실제 폰 위 줄을 겹쳐 놓는다.
 * 보이는 영상 크기(가짜 단계 그림 또는 실시간 H.264·MJPEG, 그 전에는 마지막 seen의 프레임 크기)를 onVideoSize로 알린다. 영상이 없으면 null이다.
 * 칸을 다 채우는 영상 칸에 폰에서 온 영상을 잘리지 않게(contain) 깔아 세로 영상이 높이 상한에 걸리면 양옆을 비우고, 그 위에 물체 모양(마스크, MaskLayer)과 이름·신뢰도(Status)를 그린다.
 * 네모 테두리는 그리지 않는다. 마스크는 영상이 보일 때만(image, 또는 live 첫 장 뒤) 그린다.
 * 영상이 없으면(qr) 영상 칸 자리에 칸에 맞춘 연결 QR을 보이고, live는 첫 장이 오기 전까지 영상 위에 연결 QR을 둔다. 폰 주소가 없으면 QR 대신 지금 상태 한 줄이다.
 * 폰 서버 상태를 아직 모르면(none) 빈 칸이다.
 * 실시간 영상은 장면·마스크 짝을 맞춘다(scene-sync.ts): 장면을 마스크 지연만큼 늦게 그리고, 그린 장면마다 그 촬영 시각의 마스크를 얹는다. onDelay로 그 지연을 알린다.
 * 실제 폰이 인코딩한 방향 세모는 영상에 이미 들어 있다. 칸은 마우스를 받지 않는다.
 */
export function PhonePane({ slot, seen, box, connected, command, onVideoSize, onDelay }: {
  slot: PhoneSlot;
  /** 마지막 물체 모양(seen) 저장소. 마스크 층만 듣는다. */
  seen: SeenStore;
  /** 칸 자리(화면 px). */
  box: Rect;
  /** 서버와 실시간으로 이어져 있는가(다시 붙으면 실시간 영상도 다시 붙인다). */
  connected: boolean | null;
  /** 일반 대시보드의 공개 폰 명령. null은 명령이 없는 상태, 생략은 녹화용 영상만 보기다. */
  command?: string | null;
  /** 보이는 영상 크기(안 보이면 null)가 생기거나 바뀌면 부른다. */
  onVideoSize?: (size: BoxSize | null) => void;
  /** 실시간 장면을 늦게 그리는 시간(ms, 마스크 지연만큼)이 바뀌면 부른다. */
  onDelay?: (ms: number) => void;
}) {
  const video = useRef<HTMLDivElement>(null);
  const size = useBoxSize(video);
  const live = slot.kind === "live";
  // 장면·마스크 짝: 서버 seen을 받는 대로 넣고, 그린 장면마다 그 시각의 마스크를 고른다
  const sync = useMemo(() => createSceneSync(seen), [seen]);
  useEffect(() => seen.subscribe(() => { const e = seen.get(); if (e) sync.mask(e); }), [seen, sync]);
  const tellDelay = useRef(onDelay);
  tellDelay.current = onDelay;
  useEffect(() => sync.onDelay((ms) => tellDelay.current?.(ms)), [sync]);
  const [shown, setShown] = useState(false);
  // 폰 서버 영상이 없어지면 다시 첫 장을 기다린다
  useEffect(() => { if (!live) setShown(false); }, [live]);
  const visible = slot.kind === "image" || (live && shown);
  const image = slot.kind === "image" ? { width: slot.width, height: slot.height } : null;
  // 실시간 영상 크기(EyeVideo가 알린다)와 마지막 seen의 프레임 크기(글로 들어 크기가 바뀔 때만 다시 그린다)
  const [streamed, setStreamed] = useState<BoxSize | null>(null);
  useEffect(() => { if (!live) setStreamed(null); }, [live]);
  const frameKey = useSyncExternalStore(seen.subscribe, () => { const f = seen.get()?.frame; return f ? `${f.width}x${f.height}` : ""; }, () => "");
  const [vw, vh] = image ? [image.width, image.height] : !visible ? [0, 0] : streamed ? [streamed.width, streamed.height] : frameKey.split("x").map(Number);
  const report = useRef(onVideoSize);
  report.current = onVideoSize;
  useEffect(() => { report.current?.(vw! > 0 && vh! > 0 ? { width: vw!, height: vh! } : null); }, [vw, vh]);
  const content = (
        <div ref={video} data-video className="relative size-full overflow-hidden">
          {slot.kind === "image" && (
            <img src={slot.src} alt="폰 카메라 영상" draggable={false} className="absolute inset-0 size-full select-none object-contain will-change-transform" />
          )}
          {live && <EyeVideo connected={connected} onShown={setShown} onSize={setStreamed} sync={sync} />}
          {visible ? <MaskLayer seen={live ? sync.store : seen} fallback={image} size={size} ceiling={0} /> : slot.kind === "none" ? null : <ConnectQr url={slot.url} live={live} slot={size} />}
          {command !== undefined && slot.kind !== "none" && <div data-phone-line className="absolute inset-x-0 top-0 z-50">
            <PhoneTopLine lead={<MeerkatFace />} text={command} />
          </div>}
        </div>
  );
  return (
    <section aria-label="폰 카메라" data-phone className="pointer-events-none absolute z-50" style={{ left: box.left, top: box.top, width: box.width, height: box.height }}>
      {command !== undefined ? content : <LiquidGlass mode="opaque" radius={16} className="size-full">{content}</LiquidGlass>}
    </section>
  );
}
