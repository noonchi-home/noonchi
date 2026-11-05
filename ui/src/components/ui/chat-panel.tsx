// 21st.dev「Chat Panel」(id 23601, theshanelevine/chat)의 모양: 머리줄 + 고정 높이 대화 영역 + 아래 입력칸.
// 데모 상태·영어 글은 지우고 틀만 남겼다. 색은 유리 토큰(styles.css)만 쓴다.
import { ArrowUp } from "lucide-react";
import { useRef, type FormEvent, type ReactNode, type Ref } from "react";
import { cn } from "../../lib/utils";

/** 패널 틀: 머리줄(제목·동작), 스크롤되는 가운데, 아래 입력. */
export function ChatShell({ title, actions, children, footer, scrollRef, className }: {
  title: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  scrollRef?: Ref<HTMLDivElement>;
  className?: string;
}) {
  return (
    <div className={cn("flex h-full min-h-0 flex-col overflow-hidden", className)}>
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-glass-line px-3 py-2">
        <div className="flex min-w-0 items-center gap-2 text-sm font-medium text-ink">{title}</div>
        <div className="flex items-center gap-1">{actions}</div>
      </div>
      <div ref={scrollRef} className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-3 pb-2 pt-3 [overflow-anchor:none]">{children}</div>
      {footer && <div className="mt-auto shrink-0 p-2">{footer}</div>}
    </div>
  );
}

/** 사용자가 보낸 말: 오른쪽 정렬 부드러운 덩어리. */
export function UserBubble({ children, icon }: { children: ReactNode; icon?: ReactNode }) {
  return (
    <div className="flex justify-end pl-10">
      <div className="flex items-start gap-1.5 rounded-xl bg-field-strong px-3 py-1.5 text-[13px] leading-[1.4] text-ink">
        {icon}
        <span className="break-words">{children}</span>
      </div>
    </div>
  );
}

/** 작은 동작 버튼(머리줄). */
export function IconButton({ label, onClick, children, text }: { label: string; onClick: () => void; children: ReactNode; text?: string }) {
  return (
    <button
      type="button"
      aria-label={text ? undefined : label}
      onClick={onClick}
      className="flex h-7 items-center justify-center gap-1 rounded-lg px-1.5 text-xs text-ink-dim transition-colors hover:bg-field hover:text-ink"
    >
      {children}
      {text && <span>{text}</span>}
    </button>
  );
}

/** 입력칸 + 보내기(위 화살표). 칸 아무 곳이나 누르면 입력으로 간다. */
export function Composer({ value, onChange, onSubmit, disabled, placeholder, label, sendLabel, inputRef }: {
  value: string;
  onChange: (v: string) => void;
  onSubmit: (v: string) => void;
  disabled?: boolean;
  placeholder: string;
  label: string;
  sendLabel: string;
  inputRef?: React.RefObject<HTMLInputElement | null>;
}) {
  const own = useRef<HTMLInputElement>(null);
  const input = inputRef ?? own;
  const canSend = !disabled && value.trim().length > 0;
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (canSend) onSubmit(value);
  };
  return (
    <form onSubmit={submit} autoComplete="off">
      <div
        role="presentation"
        onClick={() => input.current?.focus()}
        className="flex cursor-text items-center gap-2 rounded-xl border border-glass-line bg-field p-2 pl-3 transition-colors focus-within:border-ink-dim"
      >
        <input
          ref={input}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          aria-label={label}
          maxLength={2000}
          className="min-w-0 flex-1 bg-transparent text-[13px] leading-[1.4] text-ink outline-none placeholder:text-ink-dim"
        />
        <button
          type="submit"
          aria-label={sendLabel}
          disabled={!canSend}
          className={cn(
            "flex size-7 shrink-0 items-center justify-center rounded-lg transition-[background-color,color,transform] duration-200 enabled:active:scale-[0.96]",
            canSend ? "bg-ink text-glass" : "bg-field-strong text-ink-dim",
          )}
        >
          <ArrowUp className="size-4" strokeWidth={2.4} aria-hidden="true" />
        </button>
      </div>
    </form>
  );
}
