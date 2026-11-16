import { useLayoutEffect, useRef, useState } from "react";
import { Status } from "../components/ui/status";
import { ThoughtBubble } from "../components/ui/thought-bubble";
import type { Thought } from "./data";
import type { Rect } from "./layout";
import { EASE } from "./motion";
import { WORDS } from "./words";

/** 생각이 바뀔 때: 앞 생각이 사라지는 시간, 새 생각이 떠오르기 전 기다림과 떠오르는 시간(ms, 말풍선 카드와 같다). */
const OUT_MS = 200;
const IN_DELAY = 100;
const IN_MS = 300;

const keyOf = (t: Thought) => JSON.stringify([t.lines.seen, t.lines.why, t.state, t.habit, t.assist, t.action]);

/**
 * 생각 두 줄과 그 아래 칩. 글 칸 높이(100px)는 정해져 있다.
 * 이름표 칩 「본 것」·「그래서」(Status) 옆에 줄마다 한 문장(두 줄까지, 넘으면 말줄임)을 놓는다.
 * 칩: 앞 칩은 배운 규칙이 있으면 「습관 · 상태」(상태를 모르면 「습관 · 배운 규칙」), 아니면 아는 상태일 때만 「상태 · …」. 뒤 칩은 「눈치·코치 · 행동 이름」.
 */
function Lines({ thought }: { thought: Thought }) {
  return (
    <>
      <div data-thought-text className="h-[100px]">
        <dl className="grid grid-cols-[auto_minmax(0,1fr)] items-start gap-x-2 gap-y-1">
          <dt><Status data-thought-label>{WORDS.seen}</Status></dt>
          <dd data-thought-line="seen" className="line-clamp-2 h-[2lh] break-keep">{thought.lines.seen}</dd>
          <dt><Status data-thought-label>{WORDS.why}</Status></dt>
          <dd data-thought-line="why" className="line-clamp-2 h-[2lh] break-keep">{thought.lines.why}</dd>
        </dl>
      </div>
      <div data-thought-chips className="mt-2 flex h-[26px] min-w-0 items-center gap-1.5 overflow-hidden">
        {(thought.habit || thought.state !== null) && (
          <Status data-thought-state className="min-w-0 shrink">
            <span className="truncate">{thought.habit ? `${WORDS.habit} · ${thought.state ?? WORDS.learnedRule}` : `${WORDS.state} · ${thought.state}`}</span>
          </Status>
        )}
        <Status variant="brand" data-thought-action className="min-w-0 shrink">
          <span className="truncate">{`${WORDS[thought.assist]} · ${thought.action}`}</span>
        </Status>
      </div>
    </>
  );
}

/**
 * 마스코트 위 생각 말풍선(ThoughtBubble: 둥근 말풍선 + 마스코트로 이어지는 꼬리 점 둘). 생각 두 줄(본 것·그래서)과 칩 둘(상태·판단)을 보인다.
 * 말풍선 카드(마스코트가 사람에게 한 말, 꼬리 없는 유리 카드)와 모양이 다르다.
 * 자리 box·꼬리 tail(layout.ts, 화면 px)과 크기는 정해져 있다: 글 길이·단계가 크기를 바꾸지 않는다.
 * PAM이 대기(thought null)면 숨긴다: 칸은 그대로 두고 opacity·transform으로만 사라지고, 마지막 생각 글은 사라지는 동안 그대로 둔다.
 * 생각이 바뀌면(정리 중 두 줄에 그 판단의 두 줄이 온 것도) 앞 것은 opacity로 사라지고 새것은 opacity·transform으로 떠오른다(합성기). animate가 아니면 바로 바꾼다.
 * 보기만 한다: 마우스를 받지 않는다. 트윈 위(z-50)에 있다.
 */
export function ThoughtCard({ thought, box, tail, animate }: { thought: Thought | null; box: Rect; tail: Rect[]; animate: boolean }) {
  const [s, setS] = useState<{ key: string | null; now: Thought | null; before: Thought | null; n: number; shown: boolean }>(
    () => ({ key: thought ? keyOf(thought) : null, now: thought, before: null, n: 0, shown: thought !== null }),
  );
  const key = thought ? keyOf(thought) : null;
  if (thought && key !== s.key) setS({ key, now: thought, before: s.shown ? s.now : null, n: s.n + 1, shown: true });
  else if ((thought !== null) !== s.shown) setS({ ...s, before: null, shown: thought !== null });
  const nowRef = useRef<HTMLDivElement>(null);
  const beforeRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (s.n === 0 || !animate) return;
    const out = beforeRef.current?.animate?.([{ opacity: 1 }, { opacity: 0 }], { duration: OUT_MS, easing: "ease-out", fill: "forwards" });
    const into = beforeRef.current ? nowRef.current?.animate?.(
      [{ opacity: 0, transform: "translateY(6px)" }, { opacity: 1, transform: "translateY(0)" }],
      { delay: IN_DELAY, duration: IN_MS, easing: EASE, fill: "backwards" },
    ) : undefined;
    return () => { out?.cancel(); into?.cancel(); };
  }, [s.n]); // 움직임 설정이 바뀌는 것만으로는 다시 띄우지 않는다
  const height = Math.max(box.height, ...tail.map((d) => d.top + d.height - box.top));

  return (
    <div
      data-thought={s.shown ? "shown" : "hidden"}
      aria-hidden={!s.shown}
      className="pointer-events-none absolute z-50 transition-[opacity,transform] duration-300 will-change-[opacity,transform] motion-reduce:transition-none"
      style={{ left: box.left, top: box.top, width: box.width, height, opacity: s.shown ? 1 : 0, transform: s.shown ? "translateY(0px)" : "translateY(6px)" }}
    >
      <ThoughtBubble className="w-full max-w-full" style={{ height: box.height }}>
        <div data-thought-body className="grid min-w-0">
          {s.before !== null && (
            <div key={s.n - 1} ref={beforeRef} data-thought-item aria-hidden="true" className="min-w-0 [grid-area:1/1]">
              <Lines thought={s.before} />
            </div>
          )}
          {s.now !== null && (
            <div key={s.n} ref={nowRef} data-thought-item className="min-w-0 [grid-area:1/1]">
              <Lines thought={s.now} />
            </div>
          )}
        </div>
      </ThoughtBubble>
      {tail.map((d, i) => (
        <div key={i} data-thought-dot className="absolute" style={{ left: d.left - box.left, top: d.top - box.top, width: d.width, height: d.height }}>
          <ThoughtBubble shape="dot" className="max-w-full" style={{ width: d.width, height: d.height }} />
        </div>
      ))}
    </div>
  );
}
