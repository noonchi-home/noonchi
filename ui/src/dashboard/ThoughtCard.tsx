import { useState } from "react";
import { AnimatedList, AnimatedListItem } from "../components/ui/animated-list";
import { Status } from "../components/ui/status";
import { ThoughtBubble } from "../components/ui/thought-bubble";
import { THOUGHT_SHOWN, type Thought } from "./data";
import type { Rect } from "./layout";
import { WORDS } from "./words";

/** 칩: 앞 칩은 배운 규칙이 있으면 「습관 · 상태」(상태를 모르면 「습관 · 배운 규칙」), 아니면 아는 상태일 때만 「상태 · …」. 뒤 칩은 행동이 있을 때만 「눈치·코치 · 행동 이름」. */
function Chips({ thought }: { thought: Thought }) {
  return (
    <div data-thought-chips className="mt-2 flex h-[26px] min-w-0 items-center gap-1.5 overflow-hidden">
      {(thought.habit || thought.state !== null) && (
        <Status data-thought-state className="min-w-0 shrink">
          <span className="truncate">{thought.habit ? `${WORDS.habit} · ${thought.state ?? WORDS.learnedRule}` : `${WORDS.state} · ${thought.state}`}</span>
        </Status>
      )}
      {thought.action !== null && (
        <Status variant="brand" data-thought-action className="min-w-0 shrink">
          <span className="truncate">{`${WORDS[thought.assist]} · ${thought.action}`}</span>
        </Status>
      )}
    </div>
  );
}

/**
 * 마스코트 위 생각 말풍선(ThoughtBubble: 둥근 말풍선 + 마스코트로 이어지는 꼬리 점 둘). 짧은 생각 메시지가 카톡처럼 쌓인 목록과 그 아래 칩 둘(상태·판단)을 보인다.
 * 메시지 목록은 21st.dev Animated List다: 새 메시지는 아래에서 떠오르고(opacity·transform), 앞 메시지는 같은 요소 그대로 위로 올라가며(layout position, transform),
 * 넘친 오래된 것은 위로 사라진다. 목록 높이(layout.ts THOUGHT_LIST, 메시지 셋)는 정해져 있고 아래에 붙으며 넘친 위쪽은 가린다.
 * 말풍선 카드(마스코트가 사람에게 한 말, 꼬리 없는 유리 카드)와 모양이 다르다.
 * 자리 box·꼬리 tail(layout.ts, 화면 px)과 크기는 정해져 있다: 글 길이·메시지 수·단계가 크기를 바꾸지 않는다.
 * 메시지가 없으면(thought null) 숨긴다: 칸은 그대로 두고 opacity·transform으로만 사라지고, 마지막 메시지는 사라지는 동안 그대로 둔다.
 * 보기만 한다: 마우스를 받지 않는다. 트윈 위(z-50)에 있다.
 */
export function ThoughtCard({ thought, box, tail }: { thought: Thought | null; box: Rect; tail: Rect[] }) {
  const [kept, setKept] = useState<Thought | null>(thought);
  if (thought && thought !== kept) setKept(thought);
  const shown = thought ?? kept;
  const height = Math.max(box.height, ...tail.map((d) => d.top + d.height - box.top));

  return (
    <div
      data-thought={thought ? "shown" : "hidden"}
      aria-hidden={!thought}
      className="pointer-events-none absolute z-50 transition-[opacity,transform] duration-300 will-change-[opacity,transform] motion-reduce:transition-none"
      style={{ left: box.left, top: box.top, width: box.width, height, opacity: thought ? 1 : 0, transform: thought ? "translateY(0px)" : "translateY(6px)" }}
    >
      <ThoughtBubble className="w-full max-w-full" style={{ height: box.height }}>
        <div data-thought-body className="flex min-w-0 flex-col">
          {/* 높이 154px = layout.ts THOUGHT_LIST(메시지 셋) */}
          <AnimatedList data-thought-list className="h-[154px] justify-end overflow-hidden">
            {(shown?.messages ?? []).slice(-THOUGHT_SHOWN).map((m, i) => (
              <AnimatedListItem key={m.id} index={i} data-thought-message className="shrink-0 break-keep">{m.text}</AnimatedListItem>
            ))}
          </AnimatedList>
          {shown && <Chips thought={shown} />}
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
