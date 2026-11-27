import type { TraceRow, TraceState } from "../../../src/contract/trace.ts";

// These event labels are the fixed public vocabulary of the trace journal.
const isGoal = (row: TraceRow) => row.kind === "AGENT" && row.name === "목표 준비";
const isChoice = (row: TraceRow) => row.kind === "AGENT" && row.name === "행동 선택";
const isWait = (row: TraceRow) => row.kind === "AGENT" && row.name === "대기 판단";
const isJudge = (row: TraceRow) => row.kind === "LLM" && row.name === "FSM 판단";
/** 행동 없이 끝난 판단 활동(판단 줄·대기 줄만). */
const waitOnly = (rows: readonly TraceRow[]) => rows.some(isWait) && rows.every(row => isWait(row) || row.kind === "LLM" && row.state !== "pending");
/** 아직 답을 기다리는 판단 활동(판단 줄 하나만): 앞 대기 묶음에 붙여 매초 새 활동이 생기지 않게 한다. */
const judging = (rows: readonly TraceRow[]) => rows.every(row => isJudge(row) && row.state === "pending");
const isResult = (row: TraceRow) =>
  row.kind === "EXECUTION" && row.name === "활동 종료" && row.state !== "pending" && !row.refs.step_id;

// refs가 빈 관찰 줄(장면 해석·사용자 상태 변화·안전 상태)은 기록이 한 지켜보기 활동에 모은다.
const WATCH_NAMES = new Set(["VLM 장면 해석", "사용자 상태 변화", "안전 상태"]);
const WATCH_TITLE = "지켜보기";
const isWatch = (row: TraceRow) => WATCH_NAMES.has(row.name) && Object.values(row.refs).every(value => value == null);

const actionIn = (input: string) => input.split(" · ", 1)[0];
const sequence = (row: TraceRow) => /:(\d+)$/.exec(row.id)?.[1];

function oldestFirst(a: TraceRow, b: TraceRow): number {
  const left = sequence(a), right = sequence(b);
  // The journal's sequence is assigned once. A released anchor or a revised row keeps it.
  if (left !== undefined && right !== undefined) return Number(left) - Number(right);
  return (a.started_ms ?? a.ended_ms ?? 0) - (b.started_ms ?? b.ended_ms ?? 0);
}

export interface TraceCompletion {
  title: string;
  output: string;
  state: TraceState;
  reason?: string;
  /** 활동 종료 줄의 걸린 시간. */
  ms?: number;
}

export interface BranchRow {
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
  /** 지켜보기 활동(refs가 빈 관찰 줄만 있음). */
  watch?: boolean;
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
  // 행동 선택 줄 출력은 「일 · 배운 전이」일 수 있다: 제목은 일 이름만
  return (choice && actionIn(choice.output)) ?? rows.find(row => row.kind !== "LLM")?.name ?? rows[0]!.name;
}

function completionOf(row: TraceRow, title: string, byId: ReadonlyMap<string, TraceRow>): TraceCompletion {
  const chain = causeChain(row, byId);
  const guards = chain.filter(cause => cause.kind === "GUARDRAIL");
  const guardReason = [...new Set(guards.map(guard => guard.output))].join(" · ");
  const reason = row.state === "done"
    ? chain.find(cause => cause.state === "done" && (cause.kind === "EXECUTION" || cause.kind === "TOOL"))?.output
    : guardReason || chain.find(cause => cause.state === "failed" || cause.state === "cancelled")?.output;
  const ms = row.started_ms !== null && row.ended_ms !== null ? Math.max(0, row.ended_ms - row.started_ms) : undefined;
  return { title, output: row.output, state: row.state, reason: reason === row.output ? undefined : reason, ms };
}

function entriesOf(rows: TraceRow[], result: TraceRow | undefined, byId: ReadonlyMap<string, TraceRow>): BranchRow[] {
  const entries = rows.filter(row => !isResult(row));
  // 지금 단계는 가장 새 도구·실행 줄이다(줄은 옛것부터 온다).
  const stage = [...entries].reverse().find(row => row.kind === "TOOL" || row.kind === "EXECUTION");
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
  const roots = entries.filter(row => !nested.has(row.id));
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
  const byActivity = new Map<string, TraceRow[]>();
  for (const row of [...byId.values()].sort(oldestFirst)) {
    const group = byActivity.get(row.activity_id);
    if (group) group.push(row);
    else byActivity.set(row.activity_id, [row]);
  }
  // 행동 없는 판단이 이어지면 첫 활동 하나(대기 판단)로 묶는다. 행동을 고른 판단·다른 활동에서 끊는다
  const grouped: [string, TraceRow[]][] = [];
  let run: TraceRow[] | null = null;
  for (const [id, records] of byActivity) {
    if (waitOnly(records) || run && judging(records)) {
      if (run) run.push(...records);
      else grouped.push([id, run = [...records]]);
    } else {
      run = null;
      grouped.push([id, records]);
    }
  }
  return grouped.map(([id, records]): TraceActivity => {
    const result = records.find(isResult);
    const wait = [...records].reverse().find(row => isWait(row) && row.state === "done");
    const watchOnly = wait && records.every(row => isWait(row) || row.kind === "LLM" && (row.state !== "pending" || isJudge(row)));
    const watch = !result && records.every(isWatch);
    const title = watch ? WATCH_TITLE : watchOnly ? wait.name : activityTitle(records, result);
    return {
      id, title,
      pending: !result && records.some(row => row.state === "pending"),
      wait: watchOnly ? wait.output : undefined,
      ...(watch ? { watch } : {}),
      completion: result && completionOf(result, title, byId),
      entries: entriesOf(records, result, byId),
    };
  });
}
