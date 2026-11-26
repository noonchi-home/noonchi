import { NO_VIEWER_MS, YOLO_NO_VIEWER_MS } from "../src/goal/tv-watch.js";

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
    // 끄기를 정한 빈 사진(촬영 시각): 빈 구간 첫 촬영(empty)부터 NO_VIEWER_MS 넘게 이어져야 끌 수 있다
    | "vacant"
    | "tv_off"
    | "tv_off_ack"
    | "tv_on"
    | "tv_on_ack"
    | "manual_off"
    | "back"
    | "unexpected"
    | "find_cup"
    | "in_sink"
    | "viewer_returned"
    // 대기 전 끔→켬의 근거 사진(촬영 시각): 끄기 전 시청 구역이 비기 시작한 사진, 다시 켜기 전 앉아 보는 사진(scripts/scenario1-live.ts earlyTvEvidence)
    | "early_empty"
    | "early_vacant"
    | "early_viewer"
    // 기록 DB에서 집 사진 serial이 빠짐: 그 사이 사진의 근거를 몰라 판정할 수 없다
    | "photo_gap";
  at: number;
  id?: string;
  command?: string;
  /** 빈 구간 근거(empty·vacant·early_empty·early_vacant)가 YOLO 프레임이면 yolo(시청 자리가 화면 안인데 사용자를 못 봄, YOLO_NO_VIEWER_MS). 없으면 VLM 사진(NO_VIEWER_MS). */
  by?: "yolo";
}
/** 빈 구간이 끄기에 넉넉한가: VLM 사진은 NO_VIEWER_MS, YOLO 프레임은 YOLO_NO_VIEWER_MS 이어져야 한다. */
const longEnough = (empty: ScenarioEvent, vacant: ScenarioEvent) => vacant.at - empty.at >= (vacant.by === "yolo" ? YOLO_NO_VIEWER_MS : NO_VIEWER_MS);
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
  "vacant",
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
 *  같은 TV를 끄고 허브가 확인한 뒤, 다시 켜고 허브가 확인한 묶음이어야 한다. 끄기 전에는 촬영 시각으로 NO_VIEWER_MS 넘게 이어진 빈 사진이
 *  (빈 구간 첫 촬영 early_empty, 끄기를 정한 마지막 빈 촬영 early_vacant),
 *  다시 켜기 전에는 끈 뒤 찍힌 앉아 보는 사진이(early_viewer) 있어야 한다. 틀리면 early_tv:<까닭>. */
function earlyTv(early: readonly ScenarioEvent[], proof: readonly ScenarioEvent[]): string | null {
  for (let i = 0; i < early.length; i++) {
    const e = early[i]!,
      off = early[i - (i % 4)]!;
    if (e.kind !== TV_CYCLE[i % 4]) return "early_tv:" + e.kind;
    if (e.kind.endsWith("_ack") && (e.id !== early[i - 1]!.id || !e.command || e.command !== early[i - 1]!.command))
      return "early_tv:unconfirmed";
    if (e.kind === "tv_on" && e.id !== off.id) return "early_tv:wrong_tv";
    const since = early[i - (i % 4) - 1]?.at ?? -Infinity;
    if (
      e.kind === "tv_off" &&
      !proof.some(
        (p) =>
          p.kind === "early_empty" &&
          p.id === e.id &&
          p.at > since &&
          proof.some((v) => v.kind === "early_vacant" && v.id === e.id && v.at <= e.at && v.by === p.by && longEnough(p, v)),
      )
    )
      return "early_tv:no_vacancy";
    if (e.kind === "tv_on" && !proof.some((p) => p.kind === "early_viewer" && p.id === e.id && p.at > early[i - 1]!.at && p.at <= e.at))
      return "early_tv:no_viewer";
  }
  return early.length % 4 === 0 ? null : early.length % 4 === 2 ? "early_tv:not_back_on" : "early_tv:unconfirmed";
}

export function judgeScenario1(trace: readonly ScenarioEvent[]) {
  const seen = new Map<ScenarioEvent["kind"], ScenarioEvent>();
  const standbyAt = trace.find((e) => e.kind === "standby")?.at ?? Infinity;
  const isEarly = (e: ScenarioEvent) => e.at < standbyAt && TV_POWER.has(e.kind);
  const early = trace.filter(isEarly);
  const proof = trace.filter((e) => e.kind === "early_empty" || e.kind === "early_vacant" || e.kind === "early_viewer");
  let firstMismatch: string | null = trace.some((e) => e.kind === "photo_gap") ? "photo_gap" : earlyTv(early, proof);
  let previous = -Infinity;
  let next = 0;
  const manuallyOff = new Set<string | undefined>();
  for (const e of trace) {
    if (e.kind === "manual_off") manuallyOff.add(e.id);
    if (e.kind === "tv_on" && manuallyOff.has(e.id)) {
      firstMismatch = "manual_off_then_on";
      break;
    }
    if (e.kind === "manual_off" || e.kind === "photo_gap" || isEarly(e) || proof.includes(e)) continue;
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
    // 빈 사진 한 장의 답이 늦게 와 바로 끈 것은 빈 구간이 아니다: 촬영 시각으로 이어진 빈 구간이 NO_VIEWER_MS 이상이어야 한다
    if (e.kind === "tv_off" && !firstMismatch && !longEnough(seen.get("empty")!, seen.get("vacant")!)) firstMismatch = "no_vacancy:tv_off";
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
