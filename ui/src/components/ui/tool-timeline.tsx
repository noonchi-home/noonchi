"use client";

// 21st.dev「AI Agent Tool Call Timeline Chat Input」(id 37517, dhxwhy/agent-tool-timeline-chat-input) 받은 코드.
// 바꾼 것: 입력 폼(textarea·보내기·멈춤)은 뺐다. 요청 하나가 카드 한 장이라 높이를 채우지 않고 안쪽 스크롤도 없다(판단 기록 패널이 스크롤한다).
// 도구 이름 줄은 단계 종류(확인·행동), 걸린 시간 칸은 단계 시각, 자세히는 결과 글이다. 아이콘은 밖에서 넣는다.
// 카드 위 머리(누가)·생각(thought)·아래(승인 대기·사진) 자리를 더했다. 영어 글은 한국어로 바꿨다.
// 글 크기 text-[9px]~[11px] → caption, text-xs → label, text-[13px]·text-sm → body-sm 토큰(줄 높이도 토큰). CallState는 className을 받는다.
// 「진행 중」 반짝임(CallState)은 끈다: 판단 기록이 CallState에 reduced를 늘 넘긴다. 2026-11-08 사용자 결정, 반짝임이 화면 바꾸기를 멈추게 했다.
import * as React from "react";
import { Check, ChevronDown, Workflow } from "lucide-react";
import { cn } from "@/lib/utils";

export type AgentToolStatus = "idle" | "running" | "answering" | "done";
export type AgentCallStatus = "queued" | "running" | "done" | "error" | "wait";
export type AgentToolCall = {
  id: string;
  /** 단계 종류(확인·행동). */
  kind: string;
  icon: React.ReactNode;
  title: string;
  status: AgentCallStatus;
  /** 단계 시각. */
  time?: string;
  /** 결과 글. */
  detail?: string;
};
export type AgentToolTimelineProps = {
  status?: AgentToolStatus;
  calls?: AgentToolCall[];
  answer?: string;
  /** 답 앞에 붙는 작은 표시(어디로 돌려준 답인지). */
  answerLabel?: React.ReactNode;
  prompt?: string;
  /** 카드 맨 위(누가·상태). */
  head?: React.ReactNode;
  /** 들은 말과 단계 사이(생각). */
  thought?: React.ReactNode;
  /** 답 뒤(승인 대기·사진). */
  after?: React.ReactNode;
  /** Keeps settled calls open under the summary. Omit to let the summary toggle them. */
  activityOpen?: boolean;
  onActivityOpenChange?: (open: boolean) => void;
  className?: string;
  ref?: React.ComponentProps<"div">["ref"];
};

const EMPTY_CALLS: AgentToolCall[] = [];
const EASE = "cubic-bezier(0.22, 1, 0.36, 1)";
export const CALL_LABEL: Record<AgentCallStatus, string> = { queued: "대기", running: "진행 중", done: "완료", error: "실패", wait: "승인 대기" };

export function CallState({ status, reduced, label, className }: { status: AgentCallStatus; reduced: boolean; label?: string; className?: string }) {
  const element = React.useRef(null as HTMLSpanElement | null);
  React.useEffect(() => {
    const target = element.current;
    if (status !== "running" || reduced || !target) return;
    let disposed = false;
    let animation = null as Animation | null;
    queueMicrotask(() => {
      if (disposed || typeof target.animate !== "function") return;
      animation = target.animate([{ backgroundPosition: "100% 0" }, { backgroundPosition: "0% 0" }], { duration: 1400, iterations: Infinity, easing: "linear" });
    });
    return () => { disposed = true; animation?.cancel(); };
  }, [status, reduced]);
  return (
    <span data-call-status={status} className={cn("inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-caption font-medium", status === "error" ? "bg-foreground text-background" : "bg-muted text-muted-foreground", className)}>
      {status === "done" && <Check className="size-2.5" aria-hidden="true" />}
      {status === "error" && <span aria-hidden="true">!</span>}
      <span ref={element} data-running-shimmer={status === "running" ? "" : undefined} className={status === "running" && !reduced ? "bg-[linear-gradient(90deg,var(--color-muted-foreground)_0%,var(--color-muted-foreground)_35%,var(--color-foreground)_50%,var(--color-muted-foreground)_65%,var(--color-muted-foreground)_100%)] bg-[length:250%_100%] bg-clip-text text-transparent" : ""}>
        {label ?? CALL_LABEL[status]}
      </span>
    </span>
  );
}

/** 움직임 줄이기 설정을 따른다. */
export function useReducedMotion() {
  const [reduced, setReduced] = React.useState(true);
  React.useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduced(media.matches);
    update(); media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  return reduced;
}

/** 비어 있을 때: 단계 아이콘 줄과 할 일 한 줄. */
export function TimelineEmpty({ icons, title }: { icons: React.ReactNode[]; title: string }) {
  return (
    <div data-empty className="flex min-h-56 flex-col items-center justify-center gap-5 text-center">
      <div className="flex items-center gap-2 text-muted-foreground" aria-hidden="true">
        {icons.map((icon, index) => <React.Fragment key={index}>{index > 0 && <span className="h-px w-3 bg-border" />}<span className="flex size-10 items-center justify-center rounded-xl border border-border bg-muted/40">{icon}</span></React.Fragment>)}
      </div>
      <div><p className="text-body-sm font-medium">{title}</p></div>
    </div>
  );
}

/** Host-driven tool activity. No tools or requests are executed. */
export function AgentToolTimeline({
  status = "idle", calls = EMPTY_CALLS, answer = "", answerLabel, prompt, head, thought, after, activityOpen, onActivityOpenChange, className = "", ref,
}: AgentToolTimelineProps) {
  const [expanded, setExpanded] = React.useState(false);
  const [openCall, setOpenCall] = React.useState(null as string | null);
  const reduced = useReducedMotion();
  const list = React.useRef(null as HTMLOListElement | null);
  const rail = React.useRef(null as HTMLDivElement | null);
  const railHeight = React.useRef(0);
  const region = React.useId();
  const settled = calls.length > 0 && calls.every((call) => call.status === "done" || call.status === "error" || call.status === "wait");
  const compact = settled && (status === "answering" || status === "done");
  const open = activityOpen ?? expanded;
  const showCalls = !compact || open;
  const ids = calls.map((call) => call.id).join("\u001f");
  const summary = `단계 ${calls.length}개`;
  const lastSentence = [...answer.matchAll(/[.!?。！？](?=\s|$)|\n/g)].at(-1);
  const spokenAnswer = status === "done" ? answer : answer.slice(0, lastSentence ? lastSentence.index + 1 : 0).trim();
  const latest = calls.at(-1);

  React.useEffect(() => {
    if (status === "idle" || status === "running") { setExpanded(false); setOpenCall(null); }
  }, [status]);

  React.useLayoutEffect(() => {
    const rows = list.current;
    const line = rail.current;
    if (!rows || !line) { railHeight.current = 0; return; }
    const previous = railHeight.current;
    const height = line.getBoundingClientRect().height;
    railHeight.current = height;
    if (reduced) return;
    let disposed = false;
    const animations: Animation[] = [];
    queueMicrotask(() => {
      if (disposed) return;
      const fresh = [...rows.querySelectorAll("[data-tool-call]")].filter((row) => !(row as HTMLElement).dataset.entered);
      fresh.forEach((row, index) => {
        (row as HTMLElement).dataset.entered = "true";
        animations.push(row.animate([{ opacity: 0, transform: "translateY(16px)" }, { opacity: 1, transform: "translateY(0px)" }], { duration: 420, delay: index * 65, easing: EASE, fill: "backwards" }));
      });
      if (height > 0 && Math.abs(height - previous) > 1) animations.push(line.animate([{ transform: `scaleY(${previous / height})` }, { transform: "scaleY(1)" }], { duration: 420, easing: EASE }));
    });
    return () => { disposed = true; animations.forEach((animation) => animation.cancel()); };
  }, [ids, reduced]);

  return (
    <div ref={ref} data-slot="agent-tool-timeline" data-state={status} className={`flex w-full flex-col overflow-hidden rounded-2xl border border-border bg-card text-foreground shadow-xl shadow-primary/5 ${className}`}>
      <div data-transcript className="p-4">
        {head}
        {prompt && <div data-question className="mb-4 ml-auto w-fit max-w-[94%] rounded-xl rounded-br-sm bg-muted px-3 py-2 text-label"><p className="break-words">{prompt}</p></div>}
        {thought}
        {(calls.length > 0 || status === "running") && (
          <div data-activity>
            {compact ? (
              <button type="button" data-summary aria-expanded={showCalls} aria-controls={region} onClick={() => { if (activityOpen === undefined) setExpanded(!open); onActivityOpenChange?.(!open); }} className="mb-2 inline-flex items-center gap-2 rounded-lg border border-border bg-muted/40 px-2.5 py-1.5 text-caption outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring">
                <Workflow className="size-3.5" aria-hidden="true" /><span>{summary}</span><ChevronDown className={`size-3 text-muted-foreground transition-transform duration-200 motion-reduce:transition-none ${showCalls ? "rotate-180" : ""}`} aria-hidden="true" />
              </button>
            ) : <div data-live-heading className="mb-3 flex items-center gap-2 text-caption font-medium uppercase tracking-widest text-muted-foreground"><Workflow className="size-3.5" aria-hidden="true" /> 단계 <span className="ml-auto font-mono text-caption normal-case tracking-normal">{calls.length ? `${calls.length}개` : "준비 중…"}</span></div>}
            <div id={region} data-timeline-body aria-hidden={!showCalls} inert={!showCalls} className={`grid transition-[grid-template-rows,opacity] duration-300 motion-reduce:transition-none ${showCalls ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"}`}>
              <div className="relative min-h-0 overflow-hidden">
                <div ref={rail} data-timeline-rail aria-hidden="true" className="absolute bottom-5 left-[15px] top-5 w-px origin-top bg-border" />
                <ol ref={list} aria-label="단계" className="relative space-y-2">
                  {calls.map((call, index) => {
                    const detailOpen = openCall === call.id;
                    const detailId = `${region}-detail-${index}`;
                    return (
                      <li key={call.id} data-tool-call={call.id} data-status={call.status} className="relative flex items-start gap-3">
                        <span className={`relative z-10 mt-3 flex size-8 shrink-0 items-center justify-center rounded-lg border bg-card ${call.status === "running" ? "border-primary/40 text-foreground" : "border-border text-muted-foreground"}`}>{call.icon}</span>
                        <div className={`min-w-0 flex-1 overflow-hidden rounded-lg border ${call.status === "error" ? "border-primary/30 border-dashed" : "border-border"} ${call.status === "running" ? "bg-primary/5" : "bg-background/40"}`}>
                          <button type="button" data-call-toggle={call.id} disabled={!call.detail} aria-expanded={call.detail ? detailOpen : undefined} aria-controls={call.detail ? detailId : undefined} onClick={() => setOpenCall(detailOpen ? null : call.id)} className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left outline-none enabled:hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring">
                            <div className="min-w-0 flex-1">
                              <span className="flex items-center gap-1.5 text-caption text-muted-foreground"><span className="font-mono">{call.kind}</span></span>
                              <span className="mt-0.5 flex items-center gap-1 text-label font-medium"><span className="truncate">{call.title}</span>{call.detail && <ChevronDown aria-hidden="true" className={`size-3 shrink-0 text-muted-foreground transition-transform motion-reduce:transition-none ${detailOpen ? "rotate-180" : ""}`} />}</span>
                            </div>
                            <div className="flex min-w-[54px] shrink-0 flex-col items-end gap-1">
                              <CallState status={call.status} reduced={reduced} />
                              <span data-duration aria-hidden="true" className="font-mono text-caption tabular-nums text-muted-foreground">{call.time ?? "—"}</span>
                            </div>
                          </button>
                          {call.detail && <div id={detailId} data-call-detail={call.id} role="region" aria-label={`${call.title} 결과`} hidden={!detailOpen} className="border-t border-border bg-muted/30 px-2.5 py-2"><pre className="whitespace-pre-wrap break-all font-mono text-caption text-muted-foreground">{call.detail}</pre></div>}
                        </div>
                      </li>
                    );
                  })}
                </ol>
              </div>
            </div>
          </div>
        )}
        {(status === "answering" || status === "done") && answer && <div data-answer role="region" aria-label="폰으로 돌려준 답" aria-live="off" className="mt-3 whitespace-pre-line break-words text-body-sm">{answerLabel}{answer}{status === "answering" && <span data-answer-cursor aria-hidden="true" className="ml-1 inline-block h-3 w-1 translate-y-0.5 rounded-full bg-primary motion-safe:animate-pulse" />}</div>}
        {after}
      </div>
      <div data-announcement role="status" aria-live="polite" aria-atomic="true" className="sr-only">{status === "running" ? latest ? `${latest.title}: ${CALL_LABEL[latest.status]}` : "단계 준비 중" : spokenAnswer}</div>
    </div>
  );
}

export default AgentToolTimeline;
