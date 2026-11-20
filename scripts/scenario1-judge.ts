export interface ScenarioEvent {
  kind:
    | "kitchen"
    | "meal_watch"
    | "ready"
    | "checking"
    | "search"
    | "watch"
    | "table_go"
    | "pick"
    | "sink_go"
    | "place"
    | "plan_done"
    | "return"
    | "standby"
    | "empty"
    | "tv_off"
    | "tv_off_ack"
    | "tv_on"
    | "tv_on_ack"
    | "manual_off"
    | "back"
    | "unexpected"
    | "find_cup"
    | "in_sink"
    | "viewer_returned";
  at: number;
  id?: string;
  command?: string;
}
const order = [
  "kitchen",
  "meal_watch",
  "ready",
  "checking",
  "search",
  "watch",
  "table_go",
  "pick",
  "sink_go",
  "place",
  "in_sink",
  "plan_done",
  "return",
  "standby",
  "empty",
  "tv_off",
  "tv_off_ack",
  "viewer_returned",
  "tv_on",
  "tv_on_ack",
] as const;

export const scenarioRank = (kind: ScenarioEvent["kind"]) => order.findIndex((k) => k === kind);

export function judgeScenario1(trace: readonly ScenarioEvent[]) {
  const seen = new Map<ScenarioEvent["kind"], ScenarioEvent>();
  let firstMismatch: string | null = null;
  let previous = -Infinity;
  let next = 0;
  const manuallyOff = new Set<string | undefined>();
  for (const e of trace) {
    if (e.kind === "manual_off") manuallyOff.add(e.id);
    if (e.kind === "tv_on" && manuallyOff.has(e.id)) {
      firstMismatch = "manual_off_then_on";
      break;
    }
    if (e.kind === "manual_off") continue;
    if (firstMismatch) continue;
    if (!Number.isFinite(e.at) || e.at < previous) {
      firstMismatch = "out_of_order:" + e.kind;
      continue;
    }
    previous = e.at;
    if (e.kind !== order[next]) {
      firstMismatch = "unexpected:" + e.kind;
      continue;
    }
    if (
      (e.kind === "checking" || e.kind === "pick" || e.kind === "in_sink") &&
      (!e.id || e.id !== seen.get("ready")?.id)
    )
      firstMismatch = "wrong_cup:" + e.kind;
    if (e.kind === "place" && (!e.id || e.id !== seen.get("sink_go")?.id)) firstMismatch = "wrong_sink";
    if (e.kind === "tv_off" && seen.get("empty")?.id && e.id !== seen.get("empty")?.id) firstMismatch = "wrong_tv";
    if (e.kind === "tv_on" && e.id !== seen.get("tv_off")?.id) firstMismatch = "wrong_tv";
    if (e.kind === "tv_on_ack" || e.kind === "tv_off_ack") {
      const sent = seen.get(e.kind === "tv_on_ack" ? "tv_on" : "tv_off");
      if (!sent || !sent.id || !sent.command || sent.id !== e.id || sent.command !== e.command)
        firstMismatch = "unconfirmed:" + e.kind;
    }
    seen.set(e.kind, e);
    next++;
  }
  const elapsed = (first: ScenarioEvent["kind"], last: ScenarioEvent["kind"]) => {
    const a = seen.get(first),
      b = seen.get(last);
    return a && b ? b.at - a.at : null;
  };
  const noViewerToOffMs = elapsed("empty", "tv_off");
  if (!firstMismatch && noViewerToOffMs !== null && noViewerToOffMs > 5000) firstMismatch = "late:tv_off";
  if (!firstMismatch && next < order.length) firstMismatch = "missing:" + order[next];
  return {
    passed: firstMismatch === null,
    firstMismatch,
    tvConfirmToCupCommandMs: elapsed("watch", "table_go"),
    noViewerToOffMs,
    noViewerToAckMs: elapsed("empty", "tv_off_ack"),
  };
}
