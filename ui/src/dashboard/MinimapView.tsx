import { useCallback, useRef, useState } from "react";
import type { ServerMessage } from "../../../src/contract/events.ts";
import { MeerkatFace, PhoneTopLine } from "../components/phone-top-line";
import { useMobileUrl } from "../lib/hub";
import { useEvents } from "../lib/use-events";
import { useHealth } from "../lib/use-health";
import { useBoxSize, type BoxSize } from "./fit";
import { MINIMAP_ASPECT, type Rect } from "./layout";
import { useFontsLoaded } from "./motion";
import { PhonePane, type PhoneSlot } from "./PhonePane";
import { useDash } from "./use-dash";
import { usePhoneCommand } from "./use-phone-command";
import { WORDS } from "./words";

/** 대시보드 주소가 비전 미니맵만 보기(?view=minimap)인가. */
export const minimapOnly = (search: string) => new URLSearchParams(search).get("view") === "minimap";

/** 창(view) 가운데에 놓은 가장 큰 16:9(MINIMAP_ASPECT) 칸. */
export function minimapBox(view: BoxSize): Rect {
  const width = Math.min(view.width, view.height * MINIMAP_ASPECT);
  const height = width / MINIMAP_ASPECT;
  return { left: (view.width - width) / 2, top: (view.height - height) / 2, width, height };
}

/**
 * 비전 미니맵만(대시보드 주소 ?view=minimap, 미니맵 녹화): 대시보드 폰 칸(PhonePane, 화면 이름 「폰 카메라」)을 창 가운데 가장 큰 16:9 칸 하나로 채운다.
 * 자료는 대시보드와 같다: health 전에는 빈 칸, 폰 서버가 켜졌으면 실시간 영상(첫 장 전에는 연결 QR), 꺼졌으면 연결 QR이고, 마스크·이름표는 /events의 seen이다.
 * 칸 위쪽에 실제 폰 위 줄(PhoneTopLine: 미어캣 얼굴 + 지금 실제 폰에 낸 명령 한 줄 /events phone_command, 실제 폰과 같은 부품·배치·글)을 둔다. 명령을 지우면(null) 명령 줄만 사라진다.
 * 폰 칸은 장면을 마스크 지연만큼 늦게 그리므로(scene-sync.ts) 명령 줄도 같은 만큼 늦게 바꿔 그 장면과 맞춘다(실제 폰은 늦추지 않는다).
 * 3D 트윈(엔진·장면·트윈 파일)·메시지 상자·시간 줄 카드·마스코트는 그리지 않는다. 글꼴이 다 뜨면 main에 data-ready를 단다(녹화가 기다린다).
 */
export function MinimapView() {
  const main = useRef<HTMLElement>(null);
  const view = useBoxSize(main);
  // 서버에 다시 붙을 때(hello)마다 health를 다시 받는다(대시보드와 같다)
  const [hellos, setHellos] = useState(0);
  const health = useHealth(hellos);
  const { seen, onMessage: toDash } = useDash();
  const [connected, setConnected] = useState<boolean | null>(null);
  const { command, onMessage: toCommand, onDelay, reset } = usePhoneCommand();
  const onMessage = useCallback((m: ServerMessage) => {
    if (m.type === "hello") setHellos((n) => n + 1);
    toCommand(m);
    toDash(m);
  }, [toDash, toCommand]);
  const onConnection = useCallback((open: boolean) => {
    setConnected(open);
    if (!open) reset();
  }, [reset]);
  useEvents(onMessage, onConnection);
  const mobileUrl = useMobileUrl(hellos);
  const phone: PhoneSlot = health?.eye ? { kind: "live", url: mobileUrl } : health || mobileUrl ? { kind: "qr", url: mobileUrl } : { kind: "none" };
  const ready = useFontsLoaded("Noto Sans KR Variable", JSON.stringify([WORDS, "0123456789"]));
  const box = minimapBox(view);
  return (
    <main ref={main} data-view="minimap" data-ready={ready || undefined} className="relative h-full w-full overflow-hidden">
      <PhonePane slot={phone} seen={seen} box={box} connected={connected} onDelay={onDelay} />
      <div data-phone-line className="pointer-events-none absolute z-50" style={{ left: box.left, top: box.top, width: box.width }}>
        <PhoneTopLine lead={<div className="flex size-12 shrink-0 items-center justify-center"><MeerkatFace /></div>} text={command} />
      </div>
    </main>
  );
}
