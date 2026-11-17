import { useRef } from "react";
import { Item, ItemActions, ItemContent, ItemDescription, ItemHeader, ItemTitle } from "../components/ui/item";
import { LiquidGlass } from "../components/ui/liquid-glass";
import { Status } from "../components/ui/status";
import type { Pills, Talk } from "./data";
import type { Rect } from "./layout";
import { useFadeIn, useReducedMotionNow } from "./motion";
import { WORDS } from "./words";

/**
 * 트윈 아래쪽 메시지 상자 하나(마스코트 왼쪽, 마스코트가 옆에서 말하는 사람처럼 선다). 판은 LiquidGlass 불투명 판 + Item(sm, 부품 원래 글 크기).
 * 맨 위에 지금 돕는 방식(설정 화면 이름, mode)과 FSM 알약 셋(Status: 상태·트리거·액션, 긴 트리거는 한 줄로 자른다). 그 아래 다듬은 생각·한 일 두 줄까지: 지난 줄은 흐리게(ItemDescription),
 * 최신 줄은 진하게(ItemTitle), 줄마다 한 줄로 자른다. 오른쪽 아래에 이어짐 표시 ▼. 크기·자리(layout.ts bubble)는 정해져 있어 글 길이가 바꾸지 않는다.
 * 원래 생각(추론)은 오지 않는다(data.ts talkOf). 트윈·폰 칸 가림판(z-40)보다 위(z-50)에 있다. 보기만 한다: 마우스를 받지 않는다.
 * 새 줄이 오면 그 줄만 opacity로 떠오른다(합성기, 움직임 줄이기면 바로 보인다).
 */
export function TalkBox({ talk, box, mode }: { talk: Talk | null; box: Rect; mode: string }) {
  const lines = talk?.lines ?? [];
  const newRef = useRef<HTMLDivElement>(null);
  const reduced = useReducedMotionNow();
  useFadeIn(newRef, lines.at(-1)?.id ?? "", !reduced, 0);
  return (
    <LiquidGlass
      mode="opaque"
      radius={16}
      data-talk
      className="pointer-events-none absolute z-50"
      style={{ left: box.left, top: box.top, width: box.width, height: box.height }}
    >
      <Item size="sm" className="size-full flex-nowrap items-start">
        <ItemContent className="min-w-0">
          <ItemHeader className="min-w-0 justify-start">
            <ItemTitle data-talk-mode className="shrink-0">{mode}</ItemTitle>
            {talk?.fsm && <FsmPills pills={talk.fsm} />}
          </ItemHeader>
          <div data-talk-lines className="flex min-w-0 flex-col gap-1">
            {lines.map((l, i) => (i === lines.length - 1
              ? <ItemTitle key={l.id} ref={newRef} data-talk-line="new" className="min-w-0 max-w-full"><span className="truncate">{l.text}</span></ItemTitle>
              : <ItemDescription key={l.id} data-talk-line="old" className="truncate">{l.text}</ItemDescription>))}
          </div>
        </ItemContent>
        <ItemActions data-talk-more aria-hidden="true" className="self-end">{WORDS.more}</ItemActions>
      </Item>
    </LiquidGlass>
  );
}

/** FSM 알약 셋: 「상태 · …」·「트리거 · …」·「액션 · …」(Status). 트리거만 줄어들며 한 줄로 자른다. */
function FsmPills({ pills }: { pills: Pills }) {
  return (
    <>
      <Status variant="default" data-talk-pill="state">{`${WORDS.pill.state} · ${pills.state}`}</Status>
      <Status variant="default" data-talk-pill="trigger" className="min-w-0 shrink"><span className="truncate">{`${WORDS.pill.trigger} · ${pills.trigger}`}</span></Status>
      <Status variant="brand" data-talk-pill="action">{`${WORDS.pill.action} · ${pills.action}`}</Status>
    </>
  );
}
