import {
  Blinds, Bot, Box, Brain, Camera, ChevronDown, ChevronUp, CircleCheck, Coffee, Crosshair, Droplet, Eye, Footprints, Hourglass, List, Lock, LockOpen,
  MapPin, MessageSquare, MessagesSquare, Pause, Play, Power, Save, ScanSearch, Search, ShieldCheck, SlidersHorizontal, Smartphone, Square, SquarePen,
  Thermometer, TriangleAlert, Undo2, Wrench, type LucideIcon,
} from "lucide-react";
import { useLayoutEffect, useRef, useState } from "react";
import { ChatShell, Composer, IconButton, UserBubble } from "../components/ui/chat-panel";
import { CallState, TimelineSummary, ToolTimeline, type CallStatus, type TimelineItem } from "../components/ui/tool-timeline";
import { cn } from "../lib/utils";
import { observedOf, RESULT_LABELS, resultOf, targetOf, toolLabel } from "./labels";
import { STATE_LABELS, type PendingCard, type Step, type Turn, type TurnState } from "./turns";
import type { Chat } from "./use-chat";

const TOOL_ICON: Record<string, LucideIcon> = {
  list_rooms: List, list_devices: List, find_devices: Search, get_state: Eye, turn_on: Power, turn_off: Power, set_level: SlidersHorizontal,
  set_climate: Thermometer, set_covering: Blinds, lock: Lock, unlock: LockOpen, start: Play, stop: Square, set_valve: Droplet,
  find_objects: Search, move_object: Box, add_object: Box, remove_object: Box, find_object_types: Search, save_layout: Save, confirm: ShieldCheck,
};
/** 글 줄 아이콘: 답·초점·승인 결과는 label로, 두뇌 단계는 mark로. */
const LINE_ICON: Record<string, LucideIcon> = {
  답: MessageSquare, 초점: Crosshair, 취소: Undo2, "승인 후 실행": CircleCheck, "승인 실패": TriangleAlert, "찍은 자리": MapPin,
  use: Coffee, away: Footprints, request: Camera, answer: Eye, decide: Brain, confirm: ScanSearch, act: Bot, result: CircleCheck,
  wait: Pause, cancel: Undo2, stale: Hourglass, error: TriangleAlert, phone: Smartphone, would: Bot,
};
const RESULT_STATUS = { ok: "done", wait: "wait", fail: "error" } as const;
const TURN_STATUS: Record<TurnState, CallStatus> = { busy: "running", ok: "done", wait: "wait", fail: "error", cancel: "idle" };
const icon = (I: LucideIcon) => <I className="size-3.5" aria-hidden="true" />;

function toItem(turn: Turn, s: Step, i: number): TimelineItem {
  const id = `${turn.id}-${i}`;
  if (s.kind === "action") {
    const a = s.action;
    const target = targetOf(a);
    const result = resultOf(a);
    return {
      kind: "call", id, icon: icon(TOOL_ICON[a.tool] ?? Wrench), title: target ? `${toolLabel(a.tool)} · ${target}` : toolLabel(a.tool),
      sub: observedOf(a), status: RESULT_STATUS[result], statusLabel: RESULT_LABELS[result],
      detail: a.reason ? <p><span className="mr-1 text-ink">생각</span><span>{a.reason}</span></p> : undefined,
    };
  }
  const I = LINE_ICON[s.mark ?? s.label] ?? MessageSquare;
  return { kind: "note", id, icon: <I className="size-3" aria-hidden="true" />, label: s.label === "답" ? undefined : s.label || undefined, text: s.text, tone: s.label === "답" ? "answer" : s.tone };
}

function Pending({ p, chat }: { p: PendingCard; chat: Chat }) {
  const done = { busy: "처리 중…", ok: "승인함", fail: "실패", cancel: "취소함" } as const;
  return (
    <div role="group" aria-label="승인 요청" className={cn("rounded-lg border p-2.5 text-xs", p.status === "open" ? "border-unknown/50 bg-unknown/10" : "border-glass-line bg-field")}>
      <p className="text-ink">{`${p.deviceLabel ? `${p.deviceLabel}: ` : ""}${p.reason}`}</p>
      <div className="mt-2 flex gap-1.5">
        {p.status === "open" ? (
          <>
            <button type="button" onClick={() => void chat.confirm(p.token)} className="rounded-md bg-ink px-3 py-1 font-medium text-glass hover:opacity-90">승인</button>
            <button type="button" onClick={() => void chat.cancel(p.token)} className="rounded-md border border-glass-line px-3 py-1 text-ink hover:bg-field">취소</button>
          </>
        ) : (
          <span className="text-ink-dim">{done[p.status]}</span>
        )}
      </div>
    </div>
  );
}

function TurnCard({ turn, open, onToggle, chat }: { turn: Turn; open: boolean; onToggle: () => void; chat: Chat }) {
  const items = turn.steps.map((s, i) => toItem(turn, s, i));
  const count = turn.steps.filter((s) => !(s.kind === "line" && s.label === "답")).length;
  const source = turn.source === "phone" ? <Smartphone className="mt-0.5 size-3.5 shrink-0 text-ink-dim" aria-label="폰에서 말함" />
    : turn.source === "brain" ? <Bot className="mt-0.5 size-3.5 shrink-0 text-ink-dim" aria-label="클로이드 두뇌" />
    : turn.photo ? <Camera className="mt-0.5 size-3.5 shrink-0 text-ink-dim" aria-hidden="true" /> : undefined;
  return (
    <article data-turn={turn.id} data-state={turn.state} data-source={turn.source} className="flex flex-col gap-2">
      <UserBubble icon={source}>{turn.ask}</UserBubble>
      <div className="flex flex-wrap items-center gap-2">
        <CallState status={TURN_STATUS[turn.state]} label={turn.label ?? STATE_LABELS[turn.state]} />
        {count > 0 && <TimelineSummary open={open} onToggle={onToggle} text={`단계 ${count}개`} />}
      </div>
      {turn.now && (turn.now.seen || turn.now.judged) && (
        <dl className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5 rounded-lg bg-field px-2.5 py-1.5 text-[11px] text-ink-dim">
          {turn.now.seen && <><dt className="text-ink">지금</dt><dd>{turn.now.seen}</dd></>}
          {turn.now.judged && <><dt className="text-ink">판정</dt><dd>{turn.now.judged}</dd></>}
        </dl>
      )}
      {open ? <ToolTimeline items={items} label="단계" /> : turn.answer && <p className="text-[13px] leading-5 text-ink">{turn.answer}</p>}
      {turn.pending.map((p) => <Pending key={p.token} p={p} chat={chat} />)}
      {turn.photo && (
        <a href={turn.photo} target="_blank" rel="noopener">
          <img src={turn.photo} alt="클로이드의 눈 사진" className="max-h-48 rounded-lg" />
        </a>
      )}
    </article>
  );
}

/** 오른쪽 유리 패널: 요청마다 카드(단계 타임라인·답·승인), 아래 입력·추천. 접으면 머리줄만 남는다. */
export function ChatPanel({ chat, suggestions }: { chat: Chat; suggestions: string[] }) {
  const [open, setOpen] = useState(true);
  const [draft, setDraft] = useState("");
  const [toggled, setToggled] = useState<Record<string, boolean>>({});
  const scroll = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const { turns } = chat;

  useLayoutEffect(() => {
    const el = scroll.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [turns, open]);

  const send = async (text: string) => {
    setDraft("");
    await chat.send(text);
    input.current?.focus();
  };
  const fold = (
    <IconButton label={open ? "대화 접기" : "대화 펴기"} onClick={() => setOpen(!open)}>
      {open ? <ChevronUp className="size-4" aria-hidden="true" /> : <ChevronDown className="size-4" aria-hidden="true" />}
    </IconButton>
  );
  const title = <><MessagesSquare className="size-4 text-ink-dim" aria-hidden="true" /><h2>대화</h2></>;

  return (
    <section
      aria-label="대화"
      className={cn("glass absolute right-3 top-16 z-50 w-[380px] max-w-[calc(100%-1.5rem)] overflow-hidden text-ink min-[1440px]:top-3", open && "bottom-3")}
    >
      {!open ? (
        <div className="flex items-center justify-between gap-2 px-3 py-2 text-sm font-medium">
          <div className="flex items-center gap-2">{title}</div>
          {fold}
        </div>
      ) : (
        <ChatShell
          title={title}
          scrollRef={scroll}
          actions={<>
            <IconButton label="새 대화" text="새 대화" onClick={() => { chat.reset(); setToggled({}); }}><SquarePen className="size-3.5" aria-hidden="true" /></IconButton>
            {fold}
          </>}
          footer={
            <div className="flex flex-col gap-2">
              {suggestions.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {suggestions.map((s) => (
                    <button key={s} type="button" disabled={chat.busy} onClick={() => void send(s)}
                      className="rounded-full border border-glass-line bg-field px-2.5 py-1 text-[11px] text-ink-dim transition-colors enabled:hover:bg-field-strong enabled:hover:text-ink disabled:opacity-40">
                      {s}
                    </button>
                  ))}
                </div>
              )}
              <Composer value={draft} onChange={setDraft} onSubmit={(v) => void send(v)} disabled={chat.busy} inputRef={input}
                placeholder="클로이드에게 요청하기" label="클로이드에게 보낼 말" sendLabel="보내기" />
            </div>
          }
        >
          {turns.length === 0 && <p className="text-[13px] text-ink-dim">{chat.restarted ? "새 대화를 시작했어요." : "클로이드에게 말로 요청해 보세요."}</p>}
          {turns.map((t, i) => {
            const last = i === turns.length - 1;
            const isOpen = toggled[t.id] ?? (last || t.state === "busy" || t.state === "wait");
            return <TurnCard key={t.id} turn={t} open={isOpen} chat={chat} onToggle={() => setToggled((m) => ({ ...m, [t.id]: !isOpen }))} />;
          })}
        </ChatShell>
      )}
    </section>
  );
}
