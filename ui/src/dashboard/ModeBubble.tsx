import { useState } from "react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "../components/ui/tooltip";
import { mascotPoint, type PageLayout } from "./layout";
import type { MascotImage } from "../lib/mascot-image";
import { WORDS } from "./words";

/** 머리 꼭대기에서 말풍선 끝까지(px). */
const HEAD_GAP = 6;

/**
 * 마스코트 머리 바로 위 모드 말풍선: 지금 모드(눈치 모드 brand 바탕, 코치 모드 ok 바탕)를 21st.dev Tooltip(화살표 끝이 머리 위)으로 늘 띄운다.
 * 모드는 서버가 한 곳에서 정해 보낸 지금 행동 모드(mode 메시지, src/act/mode.ts)이고, 받기 전이면 눈치 모드다.
 * 마스코트는 늘 왼쪽을 보도록 단추 가운데 축으로 뒤집혀 있어 머리 자리도 그 축으로 뒤집는다. 보기만 한다: 마우스를 받지 않는다.
 */
export function ModeBubble({ mode, layout, mascot }: { mode: "noonchi" | "coach" | null; layout: PageLayout; mascot: Pick<MascotImage, "x0" | "headTop"> }) {
  const [box, setBox] = useState<HTMLDivElement | null>(null);
  const now = mode ?? "noonchi";
  const head = mascotPoint(layout, mascot, mascot.headTop);
  const x = 2 * (layout.mascot.left + layout.mascot.width / 2) - head.x;
  return (
    <TooltipProvider delayDuration={0}>
      <div ref={setBox} data-mode-bubble={now} className="pointer-events-none absolute z-50 h-0 w-0" style={{ left: x, top: head.y - HEAD_GAP }}>
        <Tooltip open>
          <TooltipTrigger asChild><span aria-hidden="true" className="block size-0" /></TooltipTrigger>
          {box && (
            <TooltipContent container={box} side="top" sideOffset={0} avoidCollisions={false} showArrow tone={now} className="pointer-events-none w-max max-w-none motion-reduce:animate-none">
              <span data-mode-text>{WORDS.mode[now]}</span>
            </TooltipContent>
          )}
        </Tooltip>
      </div>
    </TooltipProvider>
  );
}
