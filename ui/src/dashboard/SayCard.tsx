import { useLayoutEffect, useRef, useState } from "react";
import { Item, ItemContent } from "../components/ui/item";
import { LiquidGlass } from "../components/ui/liquid-glass";
import type { Rect } from "./layout";
import { EASE } from "./motion";

/** 말이 바뀔 때: 앞 말이 사라지는 시간, 새 말이 떠오르기 전 기다림과 떠오르는 시간(ms, 디자인 토큰 motion slow 300). */
const OUT_MS = 200;
const IN_DELAY = 100;
const IN_MS = 300;

/**
 * 트윈 아래쪽 마스코트 말풍선: 꼬리 없는 카드 하나(LiquidGlass 불투명 판 + Item say: 글 16px 굵게 가운데). 자리 box(layout.ts)는 마스코트 왼쪽이다.
 * 그 단계 말(say: 지켜보는 동안은 지금 보는 것, 그다음은 정한 것·실제 폰에 낸 명령·끝낸 일)을 보인다.
 * 크기는 정해져 있다: 글은 두 줄 높이 안에서 두 줄까지 자르므로 말 길이가 자리를 바꾸지 않는다.
 * 말이 바뀌면 앞 말은 opacity로 사라지고 새 말은 opacity·transform으로 떠오른다(합성기). animate가 아니면 바로 바꾼다.
 * 트윈·폰 칸 가림판(z-40)보다 위(z-50)에 있다. 보기만 한다: 마우스를 받지 않는다.
 */
export function SayCard({ say, box, animate }: { say: string; box: Rect; animate: boolean }) {
  const [lines, setLines] = useState<{ now: string; before: string | null; n: number }>({ now: say, before: null, n: 0 });
  if (lines.now !== say) setLines({ now: say, before: lines.now, n: lines.n + 1 });
  const nowRef = useRef<HTMLParagraphElement>(null);
  const beforeRef = useRef<HTMLParagraphElement>(null);
  useLayoutEffect(() => {
    if (lines.n === 0 || !animate) return;
    const out = beforeRef.current?.animate?.([{ opacity: 1 }, { opacity: 0 }], { duration: OUT_MS, easing: "ease-out", fill: "forwards" });
    const into = nowRef.current?.animate?.(
      [{ opacity: 0, transform: "translateY(6px)" }, { opacity: 1, transform: "translateY(0)" }],
      { delay: IN_DELAY, duration: IN_MS, easing: EASE, fill: "backwards" },
    );
    return () => { out?.cancel(); into?.cancel(); };
  }, [lines.n]); // 움직임 설정이 바뀌는 것만으로는 다시 띄우지 않는다

  return (
    <LiquidGlass
      mode="opaque"
      radius={16}
      data-say-card
      className="pointer-events-none absolute z-50"
      style={{ left: box.left, top: box.top, width: box.width, height: box.height }}
    >
      <Item size="say" className="size-full flex-nowrap">
        <ItemContent className="min-w-0">
          <div data-say className="relative grid h-[2lh] items-center">
            {lines.before !== null && (
              <p key={lines.n - 1} ref={beforeRef} data-say-line aria-hidden="true" className="line-clamp-2 break-keep [grid-area:1/1]">
                {lines.before}
              </p>
            )}
            <p key={lines.n} ref={nowRef} data-say-line className="line-clamp-2 break-keep [grid-area:1/1]">
              {lines.now}
            </p>
          </div>
        </ItemContent>
      </Item>
    </LiquidGlass>
  );
}
