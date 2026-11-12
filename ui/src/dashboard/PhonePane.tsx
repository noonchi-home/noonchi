import { Hand, Hourglass, Workflow } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import tokens from "../../../src/design/tokens.json";
import { Avatar, AvatarFallback } from "../components/ui/avatar";
import { Item, ItemContent, ItemDescription, ItemGroup, ItemMedia, ItemSeparator, ItemTitle } from "../components/ui/item";
import { LiquidGlass } from "../components/ui/liquid-glass";
import { QRCode } from "../components/ui/qr-code";
import { Status } from "../components/ui/status";
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

/** FSM 카드 유리 tint: glass-soft 토큰(surface 0.6). 영상이 비쳐 보이고, 유리 위 글을 ink만 두면 검정 영상 위에서도 4.5:1을 넘는다. */
const CARD_TINT = tokens.colorRgba["glass-soft"].alpha;
/** 연결 QR 크기(px): 영상 칸 너비·높이 중 짧은 쪽에서 양쪽 여백(p-6)을 뺀 만큼. */
const QR_PAD = 48;
const QR_MIN = 96;

/**
 * 폰 연결 QR과 그 아래 할 일 한 줄·주소(Item). 폰 영상이 없을 때 영상 칸 자리에 보인다.
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
    <div className="flex size-full flex-col items-center justify-center gap-4 p-6">
      <QRCode value={url} size={size} variant="squares" aria-label="폰 연결 QR" className="shrink-0" />
      <Item size="sm" className="w-auto min-w-0">
        <ItemContent className="min-w-0">
          <ItemTitle>폰 카메라로 찍으세요</ItemTitle>
          <ItemDescription className="break-all">{url}</ItemDescription>
        </ItemContent>
      </Item>
    </div>
  );
}

/**
 * FSM 카드 안: PAM이 본 관찰 한 문장과 도출한 행동(Item sm 두 줄). 이름(FSM·행동)은 불투명 칩(Status), 값은 ink 글(ItemTitle)이라
 * 영상이 비치는 유리 위에서도 읽힌다. 글은 부품 원래 크기(값 text-sm, 칩 text-xs) 한 줄이고 넘치면 자른다.
 */
function Decision({ observation, action }: { observation: string | null; action: string }) {
  const waiting = action === WORDS.wait;
  const I = waiting ? Hourglass : Hand;
  return (
    <ItemGroup data-decision className="size-full justify-center">
      <Item size="sm" data-fsm="" className="flex-nowrap py-1.5">
        <ItemMedia>
          <Avatar className="size-7" aria-hidden="true">
            <AvatarFallback><Workflow className="size-4" /></AvatarFallback>
          </Avatar>
        </ItemMedia>
        <ItemContent className="min-w-0 flex-row items-center gap-2">
          <Status className="shrink-0">{WORDS.fsm}</Status>
          <ItemTitle className="block min-w-0 truncate">{observation ?? WORDS.noObservation}</ItemTitle>
        </ItemContent>
      </Item>
      <ItemSeparator />
      <Item size="sm" data-action={action} className="flex-nowrap py-1.5">
        <ItemMedia>
          <Avatar className="size-7" aria-hidden="true">
            <AvatarFallback tone={waiting ? undefined : "brand"}><I className="size-4" /></AvatarFallback>
          </Avatar>
        </ItemMedia>
        <ItemContent className="min-w-0 flex-row items-center gap-2">
          <Status className="shrink-0">{WORDS.action}</Status>
          <ItemTitle className="block min-w-0 truncate">{action}</ItemTitle>
        </ItemContent>
      </Item>
    </ItemGroup>
  );
}

/**
 * 대시보드 폰 칸(화면 이름 「폰 카메라」, 판은 트윈과 함께 쓰는 한 판). 트윈 오른쪽에서 화면 높이를 다 쓰는 세로 9:16 칸이고 너비는 width(layout.ts)다. 실제 폰은 세로로 든다.
 * 칸을 다 채우는 영상 칸에 폰에서 온 영상을 잘리지 않게(contain) 깔고 그 위에 물체 모양(마스크, MaskLayer)과 이름·신뢰도(Status)를 그린다. 네모 테두리는 그리지 않는다.
 * 가로 영상이 오면 위아래를 비우고 다 보인다. 관찰과 도출한 행동은 영상 안 위쪽에 끝에서 띄운 둥근 유리 카드(LiquidGlass glass-soft, 자리 card)로 띄운다:
 * 영상이 비쳐 보이고, 마스크와 이름표는 카드 아래에만 그려 카드가 가리지 않는다. FSM 카드와 마스크는 영상이 보일 때만(image, 또는 live 첫 장 뒤) 그린다.
 * 영상이 없으면(qr) 영상 칸 자리에 칸에 맞춘 연결 QR을 보이고, live는 첫 장이 오기 전까지 영상 위에 연결 QR을 둔다. 폰 주소가 없으면 QR 대신 지금 상태 한 줄이다.
 * 폰 서버 상태를 아직 모르면(none) 빈 칸이다.
 * 영상 종류·자료와 상관없이 크기가 바뀌지 않는다. 보기만 한다.
 */
export function PhonePane({ slot, seen, observation, action, width, card, connected }: {
  slot: PhoneSlot;
  /** 마지막 물체 모양(seen) 저장소. 마스크 층만 듣는다. */
  seen: SeenStore;
  observation: string | null;
  action: string;
  /** 칸 너비(px). */
  width: number;
  /** FSM 카드 자리(영상 칸 왼쪽 위 기준 px). */
  card: Rect;
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
    <section aria-label="폰 카메라" data-phone className="relative h-full min-h-0 shrink-0" style={{ width }}>
      <div ref={video} data-video className="pointer-events-none relative size-full overflow-hidden">
        {slot.kind === "image" && (
          <img src={slot.src} alt="폰 카메라 영상" draggable={false} className="absolute inset-0 size-full select-none object-contain will-change-transform" />
        )}
        {live && <EyeVideo connected={connected} onShown={setShown} />}
        {visible ? (
          <>
            <MaskLayer seen={seen} fallback={image} size={size} ceiling={card.top + card.height} />
            <div data-fsm-card className="absolute" style={{ left: card.left, top: card.top, width: card.width, height: card.height }}>
              <LiquidGlass radius={16} tint={CARD_TINT} className="size-full">
                <Decision observation={observation} action={action} />
              </LiquidGlass>
            </div>
          </>
        ) : slot.kind === "none" ? null : (
          <ConnectQr url={slot.url} live={live} slot={size} />
        )}
      </div>
    </section>
  );
}
