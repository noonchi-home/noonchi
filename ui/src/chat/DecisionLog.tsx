import {
  Blinds, Bot, Box, Brain, ChevronDown, ChevronUp, CircleCheck, Crosshair, Droplet, Eye, List, ListChecks, Lock, LockOpen,
  MapPin, MessageSquare, Monitor, Pause, Play, Plug, Power, Save, ScanSearch, Search, ShieldCheck, SlidersHorizontal, Smartphone, Square, Thermometer, TriangleAlert,
  Undo2, Wrench, type LucideIcon,
} from "lucide-react";
import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { Alert, AlertAction, AlertTitle } from "../components/ui/alert";
import { AssistantTabPanel, AssistantTabsList, Tabs, type AssistantTab } from "../components/ui/assistant-tabs";
import {
  ChainOfThought, ChainOfThoughtContent, ChainOfThoughtStep, ChainOfThoughtStepContent, ChainOfThoughtStepTitle, ChainOfThoughtTrigger,
  type ChainOfThoughtStepStatus,
} from "../components/ui/chain-of-thought";
import ChatPanel, { ChatAction, ChatRegion, Section } from "../components/ui/chat-panel";
import ImagePreview from "../components/ui/image-preview";
import { Item, ItemActions, ItemContent, ItemMedia, ItemTitle } from "../components/ui/item";
import { Status } from "../components/ui/status";
import { AgentToolTimeline, CallState, TimelineEmpty, type AgentCallStatus, type AgentToolCall } from "../components/ui/tool-timeline";
import { cn } from "../lib/utils";
import { DECISION_DETAIL, errorLine, factLine, LOG_KIND, memoryLabel, objectLine, observedOf, stepKind, targetOf, toolLabel, worldLine } from "./labels";
import { STATE_LABELS, type DecisionDetail, type PendingCard, type Step, type Turn, type TurnState } from "./turns";

export type LogView = "log" | "phone";

const TABS: AssistantTab[] = [
  { value: "log", label: "판단 기록", icon: ListChecks },
  { value: "phone", label: "폰 화면", icon: Smartphone },
];

const TOOL_ICON: Record<string, LucideIcon> = {
  list_rooms: List, list_devices: List, find_devices: Search, get_state: Eye, turn_on: Power, turn_off: Power, set_level: SlidersHorizontal,
  set_climate: Thermometer, set_covering: Blinds, lock: Lock, unlock: LockOpen, start: Play, stop: Square, set_valve: Droplet,
  find_objects: Search, move_object: Box, add_object: Box, remove_object: Box, find_object_types: Search, save_layout: Save, confirm: ShieldCheck,
};
/** 글 줄 아이콘: 초점·승인 결과는 label로, 관찰 기록 줄은 기록 종류(mark)로. */
const LINE_ICON: Record<string, LucideIcon> = {
  초점: Crosshair, 취소: Undo2, "승인 후 실행": CircleCheck, "승인 실패": TriangleAlert, "찍은 자리": MapPin,
  observe: Eye, world_change: ScanSearch, decision: Brain, execution: Play, link: Plug, trigger: Pause, reflection: Bot,
};
const TURN_CALL: Record<TurnState, AgentCallStatus> = { busy: "running", ok: "done", wait: "wait", fail: "error", cancel: "queued" };
const PENDING: Record<PendingCard["status"], { status: AgentCallStatus; label: string; alert: "warning" | "success" | "error" | "default" }> = {
  open: { status: "wait", label: "폰에서 승인 대기", alert: "warning" }, ok: { status: "done", label: "승인함", alert: "success" },
  fail: { status: "error", label: "실패", alert: "error" }, cancel: { status: "queued", label: "취소함", alert: "default" },
};
/** 저절로 접히고 펼칠 때(사용자가 누르지 않았을 때)는 움직임 없이 바뀐다. */
const STILL = "data-[state=closed]:animate-none data-[state=open]:animate-none";
/** 움직임 줄이기 설정이면 펼침도 움직이지 않는다. */
const CALM = "motion-reduce:animate-none";
const WHO: Record<Turn["source"], { icon: LucideIcon; text: string }> = {
  phone: { icon: Smartphone, text: "거주자 · 폰" }, brain: { icon: Bot, text: "클로이드 · 관찰과 판단" }, other: { icon: Monitor, text: "다른 화면" },
};

/** 단계 시각(시:분:초). 모르면 없음. */
function clock(at: string): string | undefined {
  const d = new Date(at);
  return Number.isNaN(d.getTime()) ? undefined : d.toLocaleTimeString("ko-KR", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function callsOf(turn: Turn): AgentToolCall[] {
  return turn.steps.flatMap((s, i): AgentToolCall[] => {
    if (s.kind !== "action") return [];
    const a = s.action;
    const I = TOOL_ICON[a.tool] ?? Wrench;
    const target = targetOf(a);
    return [{
      id: `${turn.id}-${i}`, kind: stepKind(a.tool), icon: <I className="size-3.5" aria-hidden="true" />,
      title: target ? `${toolLabel(a.tool)} · ${target}` : toolLabel(a.tool),
      status: a.needsConfirmation ? "wait" : a.ok ? "done" : "error", time: clock(a.at), detail: observedOf(a),
    }];
  });
}

type Thought = { key: string; icon: ReactNode; title: string; text: string; status: ChainOfThoughtStepStatus; detail?: DecisionDetail };

/** 생각 단계: 행동마다 그 이유, 그리고 초점·승인 결과 줄. 관찰과 판단 카드는 기록 줄 전부. */
function thoughtsOf(turn: Turn): Thought[] {
  const out = turn.steps.flatMap((s: Step, i): Thought[] => {
    const key = `${turn.id}-t${i}`;
    if (s.kind === "action") {
      if (!s.action.reason) return [];
      const I = TOOL_ICON[s.action.tool] ?? Wrench;
      return [{ key, icon: <I className="size-4" aria-hidden="true" />, title: toolLabel(s.action.tool), text: s.action.reason, status: "completed" }];
    }
    if (s.label === "답" || s.label === "찍은 자리") return [];
    const I = LINE_ICON[s.mark ?? s.label] ?? MessageSquare;
    const title = s.mark ? LOG_KIND[s.mark as keyof typeof LOG_KIND] ?? s.mark : s.label || "단계";
    return [{ key, icon: <I className="size-4" aria-hidden="true" />, title, text: s.text, status: s.tone === "fail" ? "error" : "completed", ...(s.detail ? { detail: s.detail } : {}) }];
  });
  if (turn.state === "busy" && out.length) out[out.length - 1] = { ...out[out.length - 1]!, status: "active" };
  return out;
}

/** 판단 줄: 누르면 그 판단에 쓴 근거(보낸 관찰 텍스트, 판단할 때 World State, 참조한 기억 판본)를 펼친다. 보기만 한다. 21st.dev Chain of Thought 하나 + Chat Panel Section. */
function DecisionRow({ text, detail }: { text: string; detail: DecisionDetail }) {
  const { world } = detail;
  return (
    <ChainOfThought defaultOpen={false} autoCloseOnAllComplete={false} disableShimmer>
      <ChainOfThoughtTrigger label={text} />
      <ChainOfThoughtContent role="region" aria-label={DECISION_DETAIL.region} className={cn("flex flex-col gap-3", CALM)}>
        <Section label={DECISION_DETAIL.text} body={<pre className="m-0 max-h-48 overflow-auto whitespace-pre-wrap break-words">{detail.text_sent}</pre>} />
        <Section label={DECISION_DETAIL.world} body={(
          <div className="flex flex-col gap-2">
            {world.objects.map((o) => (
              <Section key={o.id} label={objectLine(o)} body={(
                <ul className="m-0 list-none p-0">
                  {Object.entries(o.facts).map(([facet, f]) => <li key={facet}>{factLine(f)}</li>)}
                  <li>{errorLine(o.error_m)}</li>
                </ul>
              )} />
            ))}
            <p className="m-0">{worldLine(world)}</p>
          </div>
        )} />
        <Section label={DECISION_DETAIL.memory} body={memoryLabel(detail.memory_version)} />
      </ChainOfThoughtContent>
    </ChainOfThought>
  );
}

function Who({ turn }: { turn: Turn }) {
  const { icon: I, text } = WHO[turn.source];
  return (
    <Item size="sm" className="mb-3 flex-nowrap">
      <ItemMedia><I className="size-3.5" aria-hidden="true" /></ItemMedia>
      <ItemContent className="min-w-0"><ItemTitle className="min-w-0 truncate">{text}</ItemTitle></ItemContent>
      <ItemActions><CallState status={TURN_CALL[turn.state]} reduced label={turn.label ?? STATE_LABELS[turn.state]} /></ItemActions>
    </Item>
  );
}

function Thinking({ turn, open, auto, onOpen }: { turn: Turn; open: boolean; auto: boolean; onOpen: (open: boolean) => void }) {
  const thoughts = thoughtsOf(turn);
  if (thoughts.length === 0) return null;
  const label = turn.source === "brain" ? turn.label ?? STATE_LABELS[turn.state] : turn.state === "busy" ? "생각 중" : `생각 ${thoughts.length}개`;
  return (
    <ChainOfThought open={open} onOpenChange={onOpen} disableShimmer className="mb-4">
      <ChainOfThoughtTrigger label={label} icon={<Brain className="size-4 shrink-0" aria-hidden="true" />} />
      <ChainOfThoughtContent className={cn(auto && STILL, CALM)}>
        {thoughts.map((t) => (
          <ChainOfThoughtStep key={t.key} status={t.status} hasContent autoCloseOnComplete={false}>
            <ChainOfThoughtStepTitle icon={t.icon}>{t.title}</ChainOfThoughtStepTitle>
            <ChainOfThoughtStepContent className={CALM}>
              {t.detail ? <DecisionRow text={t.text} detail={t.detail} /> : t.text}
            </ChainOfThoughtStepContent>
          </ChainOfThoughtStep>
        ))}
      </ChainOfThoughtContent>
    </ChainOfThought>
  );
}

function Approval({ p }: { p: PendingCard }) {
  const { status, label, alert } = PENDING[p.status];
  return (
    <Alert role="group" aria-label="승인 요청" variant={alert} className="mt-3">
      <Smartphone aria-hidden="true" />
      <AlertTitle>{`${p.deviceLabel ? `${p.deviceLabel}: ` : ""}${p.reason}`}</AlertTitle>
      <AlertAction><CallState status={status} reduced label={label} /></AlertAction>
    </Alert>
  );
}

function TurnCard({ turn, latest, thinking, steps, onThinking, onSteps }: {
  turn: Turn; latest: boolean; thinking?: boolean; steps?: boolean; onThinking: (open: boolean) => void; onSteps: (open: boolean) => void;
}) {
  const brain = turn.source === "brain";
  const after = (
    <>
      {turn.now && (turn.now.seen || turn.now.judged) && (
        <div className="mt-1 flex flex-col gap-2.5">
          {turn.now.seen && <Section label="지금" body={turn.now.seen} />}
          {turn.now.judged && <Section label="판정" body={turn.now.judged} />}
        </div>
      )}
      {turn.pending.map((p) => <Approval key={p.token} p={p} />)}
      {turn.photo && (
        <div className="mt-3">
          <ImagePreview src={turn.photo} alt="클로이드의 눈 사진" className="max-h-48" />
        </div>
      )}
    </>
  );
  return (
    <article data-turn={turn.id} data-state={turn.state} data-source={turn.source}>
      <AgentToolTimeline
        status={turn.state === "busy" ? "running" : "done"}
        calls={callsOf(turn)}
        prompt={brain ? undefined : turn.ask || undefined}
        answer={brain ? "" : turn.answer}
        answerLabel={(
          <Status className="mr-1.5 inline-flex align-middle">
            <MessageSquare className="size-3" aria-hidden="true" />{turn.source === "phone" ? "폰에 답함" : "답함"}
          </Status>
        )}
        head={<Who turn={turn} />}
        thought={<Thinking turn={turn} open={thinking ?? latest} auto={thinking === undefined} onOpen={onThinking} />}
        after={after}
        activityOpen={steps ?? latest}
        onActivityOpenChange={onSteps}
      />
    </article>
  );
}

/**
 * 오른쪽 판단 기록 패널(보기만 한다). 요청마다 카드: 누가·들은 말, 생각, 확인·행동 단계, 폰으로 돌려준 답, 폰 승인 대기.
 * 머리줄 알약 탭으로 판단 기록과 폰 화면을 바꾼다. 마지막 카드만 펼쳐 두고, 접으면 머리줄만 남는다.
 */
export function DecisionLog({ turns, view, onView, phone }: { turns: Turn[]; view: LogView; onView: (view: LogView) => void; phone: ReactNode }) {
  const [open, setOpen] = useState(true);
  const [thinking, setThinking] = useState<Record<string, boolean>>({});
  const [steps, setSteps] = useState<Record<string, boolean>>({});
  const scroll = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const el = scroll.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [turns, open, view]);

  return (
    <section
      aria-label="판단 기록"
      data-panel
      className={cn(
        "absolute right-3 top-16 z-50 w-[380px] max-w-[calc(100%-1.5rem)] min-[1440px]:top-3 max-sm:relative max-sm:inset-auto max-sm:max-w-full",
        open && "bottom-3 max-sm:min-h-0 max-sm:flex-1",
      )}
    >
        <Tabs value={view} onValueChange={(v) => onView(v as LogView)} className="h-full">
          <ChatPanel
            tabs={<AssistantTabsList tabs={TABS} value={view} />}
            actions={(
              <ChatAction label={open ? "판단 기록 접기" : "판단 기록 펴기"} expanded={open} onClick={() => setOpen(!open)}>
                {open ? <ChevronUp size={15} strokeWidth={2} aria-hidden="true" /> : <ChevronDown size={15} strokeWidth={2} aria-hidden="true" />}
              </ChatAction>
            )}
          >
            {open && (
              <>
                <AssistantTabPanel value="log" className="flex min-h-0 flex-1 flex-col">
                  <ChatRegion scrollRef={scroll}>
                    {turns.length === 0 ? (
                      <TimelineEmpty
                        icons={[Smartphone, Brain, Search, Power].map((I, i) => <I key={i} className="size-3.5" />)}
                        title="폰에서 클로이드에게 말해 보세요."
                      />
                    ) : turns.map((t, i) => (
                      <TurnCard
                        key={t.id} turn={t} latest={i === turns.length - 1} thinking={thinking[t.id]} steps={steps[t.id]}
                        onThinking={(v) => setThinking((m) => ({ ...m, [t.id]: v }))}
                        onSteps={(v) => setSteps((m) => ({ ...m, [t.id]: v }))}
                      />
                    ))}
                  </ChatRegion>
                </AssistantTabPanel>
                <AssistantTabPanel value="phone" className="flex min-h-0 flex-1 flex-col">{phone}</AssistantTabPanel>
              </>
            )}
          </ChatPanel>
        </Tabs>
    </section>
  );
}
