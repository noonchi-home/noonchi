// 21st.dev「AI Agent Tool Call Timeline」(id 37517, dhxwhy/agent-tool-timeline-chat-input)의 모양:
// 세로 선(레일) + 단계마다 아이콘 칸·제목·상태 칩, 펼치면 자세히. 끝난 뒤에는 요약 버튼으로 접고 편다.
// 데모 데이터·시계·영어 글은 지우고 틀만 남겼다. 색은 유리 토큰만 쓴다.
import { Check, ChevronDown, Workflow } from "lucide-react";
import { useId, useState, type ReactNode } from "react";
import { cn } from "../../lib/utils";

export type CallStatus = "running" | "done" | "wait" | "error" | "idle";

const CHIP: Record<CallStatus, string> = {
  running: "bg-field-strong text-ink animate-pulse",
  done: "bg-on/15 text-on",
  wait: "bg-unknown/20 text-unknown",
  error: "bg-alert/20 text-alert",
  idle: "bg-field text-ink-dim",
};

/** 상태 칩: 완료는 체크, 실패는 느낌표. */
export function CallState({ status, label }: { status: CallStatus; label: string }) {
  return (
    <span data-call-status={status} className={cn("inline-flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium leading-3", CHIP[status])}>
      {status === "done" && <Check className="size-2.5" aria-hidden="true" />}
      {status === "error" && <span aria-hidden="true">!</span>}
      {label}
    </span>
  );
}

export type TimelineItem =
  | { kind: "call"; id: string; icon: ReactNode; title: string; sub?: string; status: CallStatus; statusLabel: string; detail?: ReactNode }
  | { kind: "note"; id: string; icon: ReactNode; label?: string; text: string; tone?: "fail" | "wait" | "answer" };

function CallRow({ item }: { item: Extract<TimelineItem, { kind: "call" }> }) {
  const [open, setOpen] = useState(false);
  const detailId = useId();
  const head = (
    <>
      <div className="min-w-0 flex-1">
        <span className="block truncate text-xs font-medium leading-4 text-ink">{item.title}</span>
        {item.sub && <span className={cn("mt-0.5 block text-[11px] leading-4", item.status === "error" ? "text-alert" : "text-ink-dim")}>{item.sub}</span>}
      </div>
      <CallState status={item.status} label={item.statusLabel} />
      {item.detail && <ChevronDown aria-hidden="true" className={cn("size-3 shrink-0 text-ink-dim transition-transform", open && "rotate-180")} />}
    </>
  );
  return (
    <li data-step="call" className="relative flex items-start gap-2.5">
      <span className={cn("relative z-10 mt-1 flex size-8 shrink-0 items-center justify-center rounded-lg border bg-glass text-ink-dim backdrop-blur", item.status === "running" ? "border-ink-dim text-ink" : "border-glass-line")}>
        {item.icon}
      </span>
      <div className={cn("min-w-0 flex-1 overflow-hidden rounded-lg border", item.status === "error" ? "border-alert/40" : "border-glass-line", item.status === "running" ? "bg-field-strong" : "bg-field")}>
        {item.detail ? (
          <button type="button" aria-expanded={open} aria-controls={detailId} onClick={() => setOpen(!open)} className="flex w-full items-center gap-2 px-2.5 py-2 text-left hover:bg-field">
            {head}
          </button>
        ) : (
          <div className="flex w-full items-center gap-2 px-2.5 py-2">{head}</div>
        )}
        {item.detail && (
          <div id={detailId} hidden={!open} className="border-t border-glass-line px-2.5 py-2 text-[11px] leading-4 text-ink-dim">{item.detail}</div>
        )}
      </div>
    </li>
  );
}

function NoteRow({ item }: { item: Extract<TimelineItem, { kind: "note" }> }) {
  return (
    <li data-step="note" className="relative flex items-start gap-2.5">
      <span className="relative z-10 flex size-8 shrink-0 items-center justify-center text-ink-dim">
        <span className="flex size-6 items-center justify-center rounded-full border border-glass-line bg-glass backdrop-blur">{item.icon}</span>
      </span>
      <p className={cn(
        "min-w-0 flex-1 pt-1.5 text-xs leading-5",
        item.tone === "answer" ? "text-[13px] text-ink" : item.tone === "fail" ? "text-alert" : item.tone === "wait" ? "text-unknown" : "text-ink-dim",
      )}>
        {item.label && <b className="mr-1 font-medium text-ink">{item.label}</b>}
        {item.text}
      </p>
    </li>
  );
}

/** 단계 목록. 레일은 아이콘 칸 가운데를 지난다. */
export function ToolTimeline({ items, label }: { items: TimelineItem[]; label: string }) {
  if (items.length === 0) return null;
  return (
    <div className="relative">
      <div aria-hidden="true" className="absolute bottom-4 left-[15px] top-4 w-px bg-glass-line" />
      <ol aria-label={label} className="relative space-y-1.5">
        {items.map((item) => (item.kind === "call" ? <CallRow key={item.id} item={item} /> : <NoteRow key={item.id} item={item} />))}
      </ol>
    </div>
  );
}

/** 접힌 단계 요약 버튼. */
export function TimelineSummary({ open, onToggle, text }: { open: boolean; onToggle: () => void; text: string }) {
  return (
    <button
      type="button"
      aria-expanded={open}
      onClick={onToggle}
      className="inline-flex items-center gap-2 rounded-lg border border-glass-line bg-field px-2.5 py-1 text-[11px] text-ink-dim transition-colors hover:bg-field-strong hover:text-ink"
    >
      <Workflow className="size-3.5" aria-hidden="true" />
      <span>{text}</span>
      <ChevronDown className={cn("size-3 transition-transform", open && "rotate-180")} aria-hidden="true" />
    </button>
  );
}
