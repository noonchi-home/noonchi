import { useLayoutEffect, useRef, useState } from "react";
import { Item, ItemActions, ItemContent, ItemDescription, ItemHeader, ItemTitle } from "../components/ui/item";
import { LiquidGlass } from "../components/ui/liquid-glass";
import { Status } from "../components/ui/status";
import { TALK_SHOWN, type Pills, type Talk } from "./data";
import type { Rect } from "./layout";
import { useReducedMotionNow } from "./motion";
import { WORDS } from "./words";

/** 문장 한 줄 높이(px, 부품 원래 글 text-sm 줄)와 줄 사이(gap-1), 한 칸 굴리는 거리. */
export const TALK_ROW_H = 20;
export const TALK_ROW_GAP = 4;
export const TALK_ROW_STEP = TALK_ROW_H + TALK_ROW_GAP;
/** 한 칸 굴리는 시간(ms)과 맨 위 지난 줄의 흐림(opacity). */
const ROLL_MS = 260;
const TOP_FADE = 0.55;

type Line = { id: string; text: string };

/**
 * 트윈 아래쪽 메시지 상자 하나(마스코트 왼쪽, 마스코트가 옆에서 말하는 사람처럼 선다). 판은 LiquidGlass 불투명 판 + Item(sm, 부품 원래 글 크기).
 * 맨 위에 FSM 알약 셋(Status: 상태·트리거·액션, 긴 트리거는 한 줄로 자른다). 모드는 마스코트 머리 위 모드 말풍선(ModeBubble)이 보인다.
 * 그 아래 문장 칸은 최근 세 줄이 굴러간다(TalkLines). 오른쪽 아래에 이어짐 표시 ▼. 크기·자리(layout.ts bubble)는 정해져 있어 글 길이가 바꾸지 않는다.
 * 원래 생각(추론)은 오지 않는다(data.ts talkOf). 트윈·폰 칸 가림판(z-40)보다 위(z-50)에 있다. 보기만 한다: 마우스를 받지 않는다.
 */
export function TalkBox({ talk, box }: { talk: Talk | null; box: Rect }) {
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
            {talk?.fsm && <FsmPills pills={talk.fsm} />}
          </ItemHeader>
          <TalkLines lines={talk?.lines ?? []} />
        </ItemContent>
        <ItemActions data-talk-more aria-hidden="true" className="self-end">{WORDS.more}</ItemActions>
      </Item>
    </LiquidGlass>
  );
}

const sameLines = (a: Line[], b: Line[]) => a.length === b.length && a.every((l, i) => l.id === b[i]!.id && l.text === b[i]!.text);

/** 받은 줄(next)이 지금 줄(now) 끝에 새 줄만 붙인 것이면 그 새 줄들, 아니면(끼어듦·빠짐·바뀜) null. 같으면 []. */
function appended(now: Line[], next: Line[]): Line[] | null {
  if (sameLines(now, next)) return [];
  const fresh = next.filter((l) => !now.some((x) => x.id === l.id));
  if (!fresh.length) return null;
  const kept = next.slice(0, next.length - fresh.length);
  if (!next.slice(kept.length).every((l, i) => l.id === fresh[i]!.id)) return null;
  return sameLines(kept, now.slice(now.length - kept.length)) ? fresh : null;
}

/**
 * 문장 칸: 최근 세 줄(TALK_SHOWN). 가장 새 줄이 맨 아래(진하게 ItemTitle), 위 두 줄은 지난 줄(흐리게 ItemDescription, 맨 위 줄은 더 흐리게). 줄마다 한 줄로 자른다.
 * 새 줄이 끝에 붙으면 한 칸씩 굴린다: 세 줄이 한 줄 높이만큼 위로 올라가고 맨 위 줄은 사라지며 새 줄이 아래에서 떠오른다(transform·opacity만, 합성기).
 * 굴리는 사이에 또 온 줄은 차례를 기다렸다가 하나씩 굴린다(겹치거나 건너뛰지 않음). 끝에 붙지 않은 바뀜(안전 알림이 최신 줄로 남고 그 앞에 끼어듦 등)은
 * 굴리지 않고 바로 바꾸고 가장 새 줄만 떠오르게 한다. 움직임 줄이기면 바로 바꾼다.
 */
function TalkLines({ lines }: { lines: Line[] }) {
  const reduced = useReducedMotionNow();
  /** 그리는 줄과 지금 움직임: rest 멈춤, roll 한 칸 굴림(맨 앞 줄이 사라질 줄), grow 줄이 세 줄보다 적어 붙이기만, swap 바로 바꿈. */
  const [view, setView] = useState<{ rows: Line[]; phase: "rest" | "roll" | "grow" | "swap" }>({ rows: lines, phase: "rest" });
  /** 굴리기를 다 마치면 될 줄(받은 줄)과 차례를 기다리는 새 줄. */
  const settled = useRef<Line[]>(lines);
  const queue = useRef<Line[]>([]);
  const listRef = useRef<HTMLDivElement>(null);
  const anims = useRef<Animation[]>([]);
  const stop = () => {
    for (const a of anims.current) a.cancel();
    anims.current = [];
  };

  // 받은 줄이 바뀜: 끝에 붙은 새 줄은 차례에 넣고, 그 밖은 바로 바꾼다
  useLayoutEffect(() => {
    const added = appended(settled.current, lines);
    if (added && added.length === 0) return;
    settled.current = lines;
    if (added && !reduced) {
      queue.current.push(...added);
      if (view.phase === "rest") next();
      return;
    }
    stop();
    queue.current = [];
    setView({ rows: lines, phase: reduced ? "rest" : "swap" });
  }, [lines, reduced]); // eslint-disable-line react-hooks/exhaustive-deps

  /** 차례를 기다리는 줄 하나를 붙인다(세 줄이 차 있으면 굴린다). */
  function next() {
    const line = queue.current.shift();
    if (!line) return;
    setView((v) => ({ rows: [...v.rows, line], phase: v.rows.length >= TALK_SHOWN ? "roll" : "grow" }));
  }

  // 움직임: 굴리기·붙이기·바꾸기가 끝나면 사라질 줄을 빼고 다음 차례로
  useLayoutEffect(() => {
    if (view.phase === "rest") {
      stop();
      if (queue.current.length) return next();
      // 다 굴렸으면 받은 줄 그대로(받은 줄이 세 줄보다 적으면 앞의 지난 줄은 뺀다)
      if (!sameLines(view.rows, settled.current)) setView({ rows: settled.current, phase: "rest" });
      return;
    }
    const list = listRef.current;
    const rows = list ? [...list.querySelectorAll<HTMLElement>("[data-talk-line]")] : [];
    const done = () => setView((v) => ({ rows: v.phase === "roll" ? v.rows.slice(1) : v.rows, phase: "rest" }));
    if (!list || typeof list.animate !== "function" || rows.length === 0) { done(); return; }
    const timing: KeyframeAnimationOptions = { duration: ROLL_MS, easing: "ease-out", fill: "forwards" };
    const a: Animation[] = [];
    if (view.phase === "roll") {
      // 세 줄이 한 칸 위로: 사라질 맨 위 줄은 흐려지고, 가운데 줄은 맨 위 흐림으로
      a.push(list.animate([{ transform: `translateY(${TALK_ROW_STEP}px)` }, { transform: "translateY(0px)" }], timing));
      a.push(rows[0]!.animate([{ opacity: TOP_FADE }, { opacity: 0 }], timing));
      a.push(rows[1]!.animate([{ opacity: 1 }, { opacity: TOP_FADE }], timing));
    }
    // 새 줄은 아래에서 떠오른다
    a.push(rows.at(-1)!.animate([{ opacity: 0 }, { opacity: 1 }], timing));
    anims.current = a;
    let live = true;
    Promise.all(a.map((x) => x.finished)).then(() => { if (live) done(); }, () => {});
    return () => { live = false; };
  }, [view]); // eslint-disable-line react-hooks/exhaustive-deps

  // 줄의 몫: 맨 아래가 가장 새 줄, 그 위 둘은 지난 줄(맨 위가 더 흐리다). 굴리는 동안 맨 앞 줄은 사라질 줄이다
  const n = view.rows.length;
  return (
    <div className="min-w-0 overflow-hidden" style={{ height: TALK_SHOWN * TALK_ROW_H + (TALK_SHOWN - 1) * TALK_ROW_GAP }}>
      <div ref={listRef} data-talk-lines className="flex h-full min-w-0 flex-col justify-end gap-1">
        {view.rows.map((l, i) => {
          const fromEnd = n - 1 - i;
          if (fromEnd === 0) {
            return <ItemTitle key={l.id} data-talk-line="new" className="h-5 min-w-0 max-w-full shrink-0"><span className="truncate">{l.text}</span></ItemTitle>;
          }
          return (
            <ItemDescription key={l.id} data-talk-line="old" className="h-5 shrink-0 truncate" style={{ opacity: fromEnd >= 2 ? TOP_FADE : 1 }}>
              {l.text}
            </ItemDescription>
          );
        })}
      </div>
    </div>
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
