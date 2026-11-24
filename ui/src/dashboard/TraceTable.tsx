import { memo, useEffect, useLayoutEffect, useMemo, useState } from "react";
import type { TraceRow } from "../../../src/contract/trace.ts";
import { Table, TableBody, TableHeader, TableRow } from "../components/ui/table";
import { TraceActivityRow, TraceNameCell } from "../components/ui/trace-tree-cell";
import { traceActivities, type TraceActivity, type TraceCompletion } from "./trace-tree";

const columns = ["KIND", "NAME", "INPUT", "OUTPUT", "LATENCY"];
const cell = "px-1 py-1.5 text-left align-top sm:px-2";
const foldAfterMs = 2000;

function latency(row: TraceRow): string {
  if (row.started_ms !== null && row.ended_ms !== null) return `${Math.round(row.ended_ms - row.started_ms)} ms`;
  return row.state === "pending" ? "대기 중" : "—";
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

export const TraceTable = memo(function TraceTable({ rows }: { rows: readonly TraceRow[] }) {
  const activities = useMemo(() => traceActivities(rows), [rows]);
  const seen = useSeenActivities(activities);
  return (
    <Table aria-label="Trace" className="min-w-[350px] table-fixed">
      <colgroup>
        <col className="w-[16%]" /><col className="w-[29%]" /><col className="w-[19%]" />
        <col className="w-[21%]" /><col className="w-[15%]" />
      </colgroup>
      <TableHeader>
        <TableRow>{columns.map(label => <th key={label} scope="col" className={`${cell} whitespace-nowrap`}>{label}</th>)}</TableRow>
      </TableHeader>
      {activities.map(activity => {
        const previous = seen.get(activity.id);
        const completion = activity.completion ?? previous?.completion;
        const folded = !!completion && previous?.openUntil === undefined;
        const running = activity.pending && !completion;
        return <TableBody key={activity.id}>
          <TraceActivityRow title={completion?.title ?? activity.title} running={running}
            outcome={completion?.output ?? activity.wait ?? (running ? "진행 중" : undefined)}
            reason={folded ? completion.reason : undefined} />
          {!folded && !activity.wait && activity.entries.map(({ row, depth, current, last, opensBranch, continuesRoot, guard }) =>
            <TableRow key={row.id} className="trace-entry" data-depth={depth} data-current={current && !completion}>
              <td className={`${cell} [overflow-wrap:anywhere]`}>{row.kind}</td>
              <TraceNameCell className={`${cell} [overflow-wrap:anywhere]`} last={last} opensBranch={opensBranch}
                continuesRoot={continuesRoot} guard={guard}>{row.name}</TraceNameCell>
              <td className={`${cell} [overflow-wrap:anywhere]`}>{row.input}</td>
              <td className={`${cell} [overflow-wrap:anywhere]`}>{row.output}</td>
              <td className={cell}>{latency(row)}</td>
            </TableRow>,
          )}
        </TableBody>;
      })}
      {activities.length === 0 && <TableBody>
        <TableRow><td colSpan={5} className={cell}>아직 기록된 활동이 없어요.</td></TableRow>
      </TableBody>}
    </Table>
  );
});
