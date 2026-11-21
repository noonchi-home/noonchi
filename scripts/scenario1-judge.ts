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
    | "left"
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
  // 시청자가 실제로 떠난 때(합성 기록의 left 줄, 실영상은 --left 영상 시각). 시스템이 아니라 기록·촬영한 사람이 준다.
  "left",
  "empty",
  "tv_off",
  "tv_off_ack",
  "viewer_returned",
  "tv_on",
  "tv_on_ack",
] as const;

export const scenarioRank = (kind: ScenarioEvent["kind"]) => order.findIndex((k) => k === kind);

const TV_POWER = new Set<ScenarioEvent["kind"]>(["tv_off", "tv_off_ack", "tv_on", "tv_on_ack"]);
const TV_CYCLE = ["tv_off", "tv_off_ack", "tv_on", "tv_on_ack"] as const;

/** 대기 자리 도착 전 TV 끔→켬: 식탁에서 소파로 걷는 동안 시청 구역이 2초 비면 끄고, 앉아 보면 다시 켠다(2026-11-21 사용자 결정).
 *  같은 TV를 끄고 허브가 확인한 뒤, 다시 켜고 허브가 확인한 묶음이어야 한다. 틀리면 early_tv:<까닭>. */
function earlyTv(early: readonly ScenarioEvent[]): string | null {
  for (let i = 0; i < early.length; i++) {
    const e = early[i]!,
      off = early[i - (i % 4)]!;
    if (e.kind !== TV_CYCLE[i % 4]) return "early_tv:" + e.kind;
    if (e.kind.endsWith("_ack") && (e.id !== early[i - 1]!.id || !e.command || e.command !== early[i - 1]!.command))
      return "early_tv:unconfirmed";
    if (e.kind === "tv_on" && e.id !== off.id) return "early_tv:wrong_tv";
  }
  return early.length % 4 === 0 ? null : early.length % 4 === 2 ? "early_tv:not_back_on" : "early_tv:unconfirmed";
}

export function judgeScenario1(trace: readonly ScenarioEvent[]) {
  const seen = new Map<ScenarioEvent["kind"], ScenarioEvent>();
  const standbyAt = trace.find((e) => e.kind === "standby")?.at ?? Infinity;
  const isEarly = (e: ScenarioEvent) => e.at < standbyAt && TV_POWER.has(e.kind);
  const early = trace.filter(isEarly);
  let firstMismatch: string | null = earlyTv(early);
  let previous = -Infinity;
  let next = 0;
  const manuallyOff = new Set<string | undefined>();
  for (const e of trace) {
    if (e.kind === "manual_off") manuallyOff.add(e.id);
    if (e.kind === "tv_on" && manuallyOff.has(e.id)) {
      firstMismatch = "manual_off_then_on";
      break;
    }
    if (e.kind === "manual_off" || isEarly(e)) continue;
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
  // TV 끄기 5초는 시청자가 떠난 때부터 잰다(2026-11-21 사용자 결정)
  const leftToOffMs = elapsed("left", "tv_off");
  if (!firstMismatch && leftToOffMs !== null && leftToOffMs > 5000) firstMismatch = "late:tv_off";
  if (!firstMismatch && next < order.length) firstMismatch = "missing:" + order[next];
  return {
    passed: firstMismatch === null,
    firstMismatch,
    tvConfirmToCupCommandMs: elapsed("watch", "table_go"),
    leftToOffMs,
    noViewerToOffMs: elapsed("empty", "tv_off"),
    noViewerToAckMs: elapsed("empty", "tv_off_ack"),
    earlyTvCycles: Math.floor(early.length / 4),
  };
}
