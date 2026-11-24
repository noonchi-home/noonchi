import type { TraceRow } from "../../../src/contract/trace.ts";

// These event labels are the fixed public vocabulary of the trace journal.
const isGoal = (row: TraceRow) => row.kind === "AGENT" && row.name === "목표 준비";
const isChoice = (row: TraceRow) => row.kind === "AGENT" && row.name === "행동 선택";
const isWait = (row: TraceRow) => row.kind === "AGENT" && row.name === "대기 판단";
const isResult = (row: TraceRow) =>
  row.kind === "EXECUTION" && row.name === "활동 종료" && row.state !== "pending" && !row.refs.step_id;

const actionIn = (input: string) => input.split(" · ", 1)[0];
const sequence = (row: TraceRow) => /:(\d+)$/.exec(row.id)?.[1];

function newestFirst(a: TraceRow, b: TraceRow): number {
  const left = sequence(a), right = sequence(b);
  // The journal's sequence is assigned once. A released anchor or a revised row keeps it.
  if (left !== undefined && right !== undefined) return Number(right) - Number(left);
  return (b.started_ms ?? b.ended_ms ?? 0) - (a.started_ms ?? a.ended_ms ?? 0);
}

export interface TraceCompletion {
  title: string;
  output: string;
  reason?: string;
}

interface BranchRow {
  row: TraceRow;
  depth: 0 | 1;
  current: boolean;
  last: boolean;
  opensBranch?: boolean;
  continuesRoot?: boolean;
  guard?: string;
}

export interface TraceActivity {
  id: string;
  title: string;
  pending: boolean;
  wait?: string;
  completion?: TraceCompletion;
  entries: BranchRow[];
}

function causeChain(row: TraceRow, byId: ReadonlyMap<string, TraceRow>): TraceRow[] {
  const chain: TraceRow[] = [];
  const seen = new Set([row.id]);
  let current = row;
  while (current.cause_id) {
    const cause = byId.get(current.cause_id);
    if (!cause || seen.has(cause.id)) break;
    if (cause.activity_id !== row.activity_id && cause.kind !== "GUARDRAIL") break;
    chain.push(cause);
    if (cause.activity_id !== row.activity_id) break;
    seen.add(cause.id);
    current = cause;
  }
  return chain;
}

function activityTitle(rows: readonly TraceRow[], result?: TraceRow): string {
  const goal = rows.find(isGoal);
  const choice = rows.find(row => isChoice(row) && row.state === "done" && row.output !== row.name);
  if (result && result.input !== "도움 시도") return actionIn(result.input);
  if (goal && goal.input !== "확인된 습관 · 대상") return actionIn(goal.input);
  return choice?.output ?? rows.find(row => row.kind !== "LLM")?.name ?? rows[0]!.name;
}

function completionOf(row: TraceRow, title: string, byId: ReadonlyMap<string, TraceRow>): TraceCompletion {
  const chain = causeChain(row, byId);
  const guards = chain.filter(cause => cause.kind === "GUARDRAIL");
  const guardReason = [...new Set(guards.map(guard => guard.output))].join(" · ");
  const reason = row.state === "done"
    ? chain.find(cause => cause.state === "done" && (cause.kind === "EXECUTION" || cause.kind === "TOOL"))?.output
    : guardReason || chain.find(cause => cause.state === "failed" || cause.state === "cancelled")?.output;
  return { title, output: row.output, reason: reason === row.output ? undefined : reason };
}

function entriesOf(rows: TraceRow[], result: TraceRow | undefined, byId: ReadonlyMap<string, TraceRow>): BranchRow[] {
  const entries = rows.filter(row => !isResult(row));
  const stage = entries.find(row => row.kind === "TOOL" || row.kind === "EXECUTION");
  const children = new Map<string, TraceRow[]>();
  const nested = new Set<string>();
  const live = (row: TraceRow) => !result && (row.state === "pending" || (row.id === stage?.id && row.kind === "TOOL"));
  for (const row of entries) {
    const parent = row.cause_id && byId.get(row.cause_id);
    if (row.kind !== "LLM" || !parent || parent.kind !== "TOOL" || parent.activity_id !== row.activity_id) continue;
    // The journal can replay a bounded subset. Only a present, acyclic parent owns this branch.
    if (causeChain(parent, byId).some(cause => cause.id === row.id)) continue;
    if (!live(parent) && row.state === "pending") continue;
    nested.add(row.id);
    if (live(parent)) children.set(parent.id, [...(children.get(parent.id) ?? []), row]);
  }
  const roots = entries.filter(row => !nested.has(row.id)).sort((a, b) => Number(live(b)) - Number(live(a)));
  return roots.flatMap((row, index): BranchRow[] => {
    const branch = children.get(row.id) ?? [];
    const last = index === roots.length - 1;
    const cause = row.cause_id && byId.get(row.cause_id);
    const guard = cause && cause.kind === "GUARDRAIL" && cause.activity_id !== row.activity_id ? cause.output : undefined;
    return [
      { row, depth: 0, current: live(row), last, opensBranch: branch.length > 0, guard },
      ...branch.map((child, childIndex): BranchRow => ({
        row: child, depth: 1, current: child.state === "pending",
        last: childIndex === branch.length - 1, continuesRoot: !last,
      })),
    ];
  });
}

export function traceActivities(rows: readonly TraceRow[]): TraceActivity[] {
  const byId = new Map<string, TraceRow>();
  for (const row of rows) {
    const old = byId.get(row.id);
    if (!old || row.rev > old.rev && !(old.state !== "pending" && row.state === "pending")) byId.set(row.id, row);
  }
  const grouped = new Map<string, TraceRow[]>();
  for (const row of [...byId.values()].reverse().sort(newestFirst)) {
    const group = grouped.get(row.activity_id);
    if (group) group.push(row);
    else grouped.set(row.activity_id, [row]);
  }
  return [...grouped].map(([id, records]): TraceActivity => {
    const result = records.find(isResult);
    const wait = records.find(row => isWait(row) && row.state === "done");
    const watchOnly = wait && records.every(row => row === wait || row.kind === "LLM" && row.state !== "pending");
    const title = watchOnly ? wait.name : activityTitle(records, result);
    return {
      id, title,
      pending: !result && records.some(row => row.state === "pending"),
      wait: watchOnly ? wait.output : undefined,
      completion: result && completionOf(result, title, byId),
      entries: entriesOf(records, result, byId),
    };
  }).sort((a, b) => Number(b.pending) - Number(a.pending));
}
