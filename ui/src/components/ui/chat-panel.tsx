"use client";

// 21st.dev「Chat Panel」(id 23601, theshanelevine/chat) 받은 코드.
// 바꾼 것: 고정 크기(h-[288px] max-w-95) 대신 패널을 채운다. 머리줄 탭·동작 단추·대화 영역을 밖에서 넣는다. 입력칸(composer)은 뺐다.
// 토큰(ink·surface·line·field·hover, rounded-card·shadow-card)은 styles.css에 만든 이 테마 값으로 둔다.
import type { ReactNode, Ref } from "react";

/* ─────────────────────────────────────────────────────────
 * CHAT — panel with tabs and a fixed conversation region.
 * ───────────────────────────────────────────────────────── */

export function Section({
  label,
  sub,
  time,
  body,
  resolving,
}: {
  label: string;
  sub?: string;
  time?: string;
  body: ReactNode;
  resolving?: boolean;
}) {
  return (
    <div
      className="flex w-full flex-col gap-1.5 transition-[opacity,filter,transform] duration-400"
      style={{
        opacity: resolving ? 0.55 : 1,
        filter: resolving ? "blur(0.5px)" : "blur(0)",
        transform: resolving ? "scale(0.985)" : "scale(1)",
        transformOrigin: "top left",
        transitionTimingFunction: "cubic-bezier(0.23, 1, 0.32, 1)",
        animation: "fade-up 400ms cubic-bezier(0.23,1,0.32,1) both",
      }}
    >
      <div className="flex items-center gap-1 text-[12px] leading-[1.3]">
        <span className="font-medium text-ink">{label}</span>
        {sub && <span className="text-ink-2">{sub}</span>}
        {time && <span className="text-ink">{time}</span>}
      </div>
      <div className="text-[13px] leading-normal text-ink">{body}</div>
    </div>
  );
}

/** 머리줄 오른쪽 작은 동작 단추. */
export function ChatAction({ label, onClick, children, expanded }: { label: string; onClick: () => void; children: ReactNode; expanded?: boolean }) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-expanded={expanded}
      onClick={onClick}
      className="flex size-6 items-center justify-center rounded-[6px] text-ink-3
        transition-colors duration-100 hover:bg-hover hover:text-ink-2"
    >
      {children}
    </button>
  );
}

/** 대화 영역: 고정 영역이라 카드 모양이 바뀌지 않는다. */
export function ChatRegion({ children, scrollRef }: { children: ReactNode; scrollRef?: Ref<HTMLDivElement> }) {
  return (
    <div ref={scrollRef} className="flex min-h-0 flex-1 flex-col gap-2.5 overflow-y-auto px-3 pt-2.5 pb-1 [overflow-anchor:none]">
      {children}
    </div>
  );
}

export default function ChatPanel({ tabs, actions, children }: { tabs: ReactNode; actions?: ReactNode; children?: ReactNode }) {
  return (
    <div className="flex h-full w-full flex-col self-start overflow-hidden rounded-card bg-surface shadow-card">
      {/* header — tabs + actions */}
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-line p-1.5">
        <div className="flex min-w-0 flex-1 items-center">{tabs}</div>
        <div className="flex items-center gap-1">{actions}</div>
      </div>

      {/* conversation — fixed region so the card never changes shape */}
      {children}
    </div>
  );
}
