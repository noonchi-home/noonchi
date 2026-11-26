import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useState } from "react";
import type { TraceRow, TraceState } from "../../../src/contract/trace.ts";
import { Conversation, ConversationContent } from "../components/ui/conversation";
import { ScrollToBottom } from "../components/ui/scroll-to-bottom";
import { Status, StatusIndicator } from "../components/ui/status";
import { Trace, TraceGroup, TraceStep, type TraceStatus } from "../components/ui/trace-group";
import type { MarkTone } from "./trace-marks";
import { traceActivities, type BranchRow, type TraceActivity, type TraceCompletion } from "./trace-tree";

const foldAfterMs = 2000;
const STATUS: Record<TraceState, TraceStatus> = { pending: "running", done: "done", failed: "error", cancelled: "cancelled" };

const span = (row: TraceRow) =>
  row.started_ms !== null && row.ended_ms !== null ? Math.max(0, row.ended_ms - row.started_ms) : undefined;

/** 끝난 활동에 남은 대기 줄은 더 진행하지 않으니 시간을 재지 않는다. */
const stepStatus = (row: TraceRow, running: boolean): TraceStatus =>
  row.state === "pending" && !running ? "pending" : STATUS[row.state];

function detailOf(row: TraceRow, guard?: string): string {
  const io = `${row.input} → ${row.output}`;
  return guard ? `${io} · 관련 안전 개입 · ${guard}` : io;
}

function groupStatus(activity: TraceActivity, completion: TraceCompletion | undefined, running: boolean): TraceStatus {
  if (completion) return STATUS[completion.state];
  if (running) return "running";
  const last = activity.entries.at(-1)?.row;
  return last ? STATUS[last.state] : "done";
}

interface SeenActivity {
  completion?: TraceCompletion;
  openUntil?: number;
}

function observedActivities(previous: ReadonlyMap<string, SeenActivity>, activities: readonly TraceActivity[], now: number) {
  const next = new Map<string, SeenActivity>();
  let changed = activities.length !== previous.size;
  for (const { id, completion } of activities) {
    const old = previous.get(id);
    if (old?.completion || old && !completion) next.set(id, old);
    else {
      // Completed groups in the first replay snapshot are already history.
      next.set(id, { completion, openUntil: old && completion ? now + foldAfterMs : undefined });
      changed = true;
    }
  }
  return changed ? next : previous;
}

function useSeenActivities(activities: readonly TraceActivity[]) {
  const [seen, setSeen] = useState<ReadonlyMap<string, SeenActivity>>(() =>
    observedActivities(new Map(), activities, Date.now()));
  useLayoutEffect(() => {
    const now = Date.now();
    setSeen(previous => observedActivities(previous, activities, now));
  }, [activities]);

  const nextExpiry = Math.min(...Array.from(seen.values(), activity => activity.openUntil ?? Infinity));
  useEffect(() => {
    if (!Number.isFinite(nextExpiry)) return;
    const timer = setTimeout(() => {
      const now = Math.max(Date.now(), nextExpiry);
      setSeen(previous => new Map([...previous].map(([id, activity]) => [
        id, activity.openUntil !== undefined && activity.openUntil <= now
          ? { completion: activity.completion } : activity,
      ])));
    }, Math.max(0, nextExpiry - Date.now()));
    return () => clearTimeout(timer);
  }, [nextExpiry]);
  return seen;
}

/** 줄 이름. 지금 트윈에 그린 줄이면 그 트윈 표시와 같은 색 점(21st.dev Status 점)을 붙인다. */
function StepLabel({ row, tone }: { row: TraceRow; tone?: MarkTone }) {
  return tone ? <>{row.name} <Status data-twin-dot variant={tone}><StatusIndicator /></Status></> : row.name;
}

function ActivitySteps({ activity, running, live, onTwin }: { activity: TraceActivity; running: boolean; live: boolean; onTwin?: ReadonlyMap<string, MarkTone> }) {
  // 모델 줄(depth 1)은 바로 앞 도구 줄 아래에 접어 넣는다.
  const roots: { entry: BranchRow; children: BranchRow[] }[] = [];
  for (const entry of activity.entries) {
    if (entry.depth === 1 && roots.length) roots.at(-1)!.children.push(entry);
    else roots.push({ entry, children: [] });
  }
  return roots.map(({ entry: { row, current, guard }, children }) => (
    <TraceStep key={row.id} data-row={row.id} data-kind={row.kind} data-depth={0} data-current={current && live || undefined}
      data-on-twin={onTwin?.has(row.id) || undefined}
      status={stepStatus(row, running)} label={<StepLabel row={row} tone={onTwin?.get(row.id)} />} detail={detailOf(row, guard)} durationMs={span(row)}
      defaultOpen={children.length ? true : undefined}>
      {children.length ? <Trace density="compact">
        {children.map(({ row: child, current: childCurrent }) =>
          <TraceStep key={child.id} data-row={child.id} data-kind={child.kind} data-depth={1}
            data-current={childCurrent && live || undefined} data-on-twin={onTwin?.has(child.id) || undefined} status={stepStatus(child, running)}
            label={<StepLabel row={child} tone={onTwin?.get(child.id)} />} detail={detailOf(child)} durationMs={span(child)} />)}
      </Trace> : undefined}
    </TraceStep>
  ));
}

/**
 * Agent Trace: 옛 활동이 위, 새 활동이 아래. 바닥에 있으면 새 줄을 따라가고, 위로 올리면 멈추고 알약으로 새 활동 수를 알린다.
 * onTwin: 지금 트윈에 그린 줄(data-on-twin)과 그 표시 색. 그 줄 이름 옆에 같은 색 점을 둔다.
 */
export const TraceTable = memo(function TraceTable({ rows, onTwin }: { rows: readonly TraceRow[]; onTwin?: ReadonlyMap<string, MarkTone> }) {
  const activities = useMemo(() => traceActivities(rows), [rows]);
  const seen = useSeenActivities(activities);
  const [opened, setOpened] = useState<ReadonlyMap<string, boolean>>(() => new Map());
  const toggle = useCallback((id: string, open: boolean) => setOpened(previous => new Map(previous).set(id, open)), []);
  return (
    <Conversation anchor={false} className="h-full">
      <ConversationContent label="Agent Trace" className="max-w-none gap-0 px-2.5 pt-4 pb-2 sm:px-2.5">
        <Trace aria-label="Trace">
          {activities.map(activity => {
            const previous = seen.get(activity.id);
            const completion = activity.completion ?? previous?.completion;
            const folded = !!completion && previous?.openUntil === undefined;
            const running = activity.pending && !completion;
            const latest = activity.entries.at(-1)?.row;
            const now = running ? activity.entries.filter(entry => entry.current).at(-1)?.row ?? latest : undefined;
            const summary = completion
              ? [completion.reason, completion.output].filter(Boolean).join(" · ")
              : activity.wait ?? (activity.watch && latest ? `${latest.name} · ${latest.output}` : undefined);
            const auto = !folded && !activity.wait && !activity.watch;
            return <TraceGroup key={activity.id} data-slot="message" data-activity={activity.id}
              status={groupStatus(activity, completion, running)} title={completion?.title ?? activity.title}
              current={now && `${now.name} · ${now.input}`} summary={summary} durationMs={completion?.ms}
              open={opened.get(activity.id) ?? auto} onOpenChange={open => toggle(activity.id, open)}>
              <ActivitySteps activity={activity} running={running} live={!completion} onTwin={onTwin} />
            </TraceGroup>;
          })}
          {activities.length === 0 && <li>아직 기록된 활동이 없어요.</li>}
        </Trace>
      </ConversationContent>
      <ScrollToBottom when="away" />
    </Conversation>
  );
});
