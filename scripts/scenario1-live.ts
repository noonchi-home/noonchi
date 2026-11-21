/** Observe the same home that is playing the video. No recorded command or result is fed to the home. */
import type { HistoryRow } from "../src/contract/history.js";
import type { SceneJson } from "../src/contract/layout.js";
import type { StationMap } from "../src/contract/stations.js";
import type { WorldView } from "../src/contract/world.js";
import { floorLookup } from "../src/layout/home-plan.js";
import { floorPlanFrom } from "../src/layout/floor.js";
import { locateZone } from "../src/layout/stations.js";
import { GoalTriggers } from "../src/goal/triggers.js";
import { judgeScenario1, scenarioRank, type ScenarioEvent } from "./scenario1-judge.js";

type Scene = SceneJson & { stations: StationMap };
type Received = { id: string; step: string; kind?: string; target?: { id: string } | null };
type Sample = { at: number; tv: string; empty: boolean; watching: boolean };
export const SCENARIO_KINDS = ["household", "decision", "goal", "plan", "robot"];

export class LiveScenario {
  private readonly map: StationMap;
  private readonly triggers: GoalTriggers;
  private readonly sinks: Set<string>;
  private photos: Sample[] = [];
  private cups: ScenarioEvent[] = [];
  private lastPhoto = -1;
  private lastSink = new Set<string>();
  constructor(scene: Scene) {
    this.map = scene.stations;
    this.triggers = new GoalTriggers(locateZone, floorLookup(scene.plan.rooms ?? []), 2000);
    this.sinks = new Set([...floorPlanFrom(scene).objects.values()].filter((p) => p.basin).map((p) => p.id));
  }
  sample(w: WorldView) {
    const at = w.household_photo?.at_ms;
    if (at !== undefined && at > this.lastPhoto) {
      this.lastPhoto = at;
      // Evaluate each captured photo at its capture time, independently of polling delay.
      const f = this.triggers.evaluateTriggers(w, w.household_photo!.serial, this.map, at);
      for (const [tv, room] of f.tvRooms ?? [])
        this.photos.push({
          at,
          tv,
          empty: f.read({ kind: "noViewer", room, ms: 0 }).value === true,
          watching: f.read({ kind: "postureAttention", target: tv, posture: "seated" }).value === true,
        });
    }
    const sink = new Set<string>();
    for (const o of w.objects)
      if (
        o.status === "present" &&
        o.surface &&
        this.sinks.has(o.surface) &&
        (o.surface_part === "basin" || o.facts.place?.value === "in_sink")
      ) {
        sink.add(o.id);
        if (!this.lastSink.has(o.id)) this.cups.push({ kind: "in_sink", at: o.last_seen_ms, id: o.id });
      }
    this.lastSink = sink;
  }
  /** leftAt: 시청자가 실제로 떠난 서버 시각(영상 시각 --left를 옮긴 값). 없으면 left 단계가 빠져 실패한다. */
  judge(history: readonly HistoryRow[], received: readonly Received[], leftAt: number | null) {
    const events: ScenarioEvent[] = [];
    if (leftAt !== null) events.push({ kind: "left", at: leftAt });
    const seen = new Set<string>();
    const delivered = new Set(received.map((c) => JSON.stringify([c.id, c.step, c.kind, c.target?.id])));
    let cupPlan: string | null = null;
    const add = (kind: ScenarioEvent["kind"], at: number, id?: string, command?: string) =>
      events.push({ kind, at, id, command });
    const one = (kind: ScenarioEvent["kind"], at: number, id?: string) => {
      if (!seen.has(kind)) {
        seen.add(kind);
        add(kind, at, id);
      }
    };
    const rows = [...history].sort((a, b) => a.at_ms - b.at_ms || a.id - b.id);
    let checking: number | null = null,
      goalId: string | null = null,
      cup: string | undefined,
      table: string | undefined;
    let watchDecision: number | null = null;
    for (const row of rows) {
      const d = (row.data ?? {}) as Record<string, unknown>,
        at = row.at_ms,
        id = row.subject ?? undefined;
      if (row.kind === "goal" && d.status === "armed" && d.prep === "ready" && d.object && d.surface) {
        if (goalId && row.subject !== goalId) add("unexpected", at);
        goalId = row.subject;
        cup = String(d.object);
        table = String(d.surface);
        one("ready", at, cup);
      }
      if (row.kind === "goal" && row.subject === goalId && d.status === "checking") {
        checking ??= at;
        one("checking", at, String(d.object));
      }
      if (row.kind === "goal" && d.drop === "back" && row.subject === goalId) add("back", at);
      if (
        row.kind === "decision" &&
        checking !== null &&
        at >= checking &&
        d.status === "valid" &&
        !d.late &&
        d.source !== "speech" &&
        d.goal === true &&
        (d.fsm as { state?: string } | null)?.state === "watching_tv"
      )
        watchDecision ??= at;
      if (row.kind === "household" && d.event === "phone") {
        const step = String(d.step),
          target = String(d.target);
        if (!delivered.has(JSON.stringify([id, step, d.kind, target]))) continue;
        const key = JSON.stringify([id, step]);
        if (seen.has(key)) continue;
        seen.add(key);
        if (d.kind === "go") {
          if (target === this.map.kitchen_entry && id?.startsWith("visit:")) add("kitchen", at, target);
          else if (target === this.map.meal_watch && id?.startsWith("visit:")) add("meal_watch", at, target);
          else if (this.map.stations.some((s) => s.id === target && s.roles.includes("standby")))
            add(
              id?.startsWith("dock:") ? "return" : id?.startsWith("visit:") ? "search" : "unexpected",
              at,
              target,
            );
          else if (target === table) {
            cupPlan = row.subject;
            add("table_go", at, target);
          } else add(id === cupPlan && this.sinks.has(target) ? "sink_go" : "unexpected", at, target);
        } else
          add(id === cupPlan && (d.kind === "pick" || d.kind === "place") ? d.kind : "unexpected", at, target);
      }
      if (row.kind === "plan" && id === cupPlan && d.status === "done") one("plan_done", at);
      if (row.kind === "robot" && d.state === "standby") one("standby", at);
      if (row.kind === "household" && (d.event === "power_request" || d.event === "power_confirm")) {
        const power = d.power,
          cmd = typeof d.command_id === "string" ? d.command_id : undefined;
        if (!cmd) {
          if (power === "off") add("manual_off", at, id);
          continue;
        }
        if (power === "off" || power === "on")
          add(
            d.event === "power_request"
              ? power === "off"
                ? "tv_off"
                : "tv_on"
              : power === "off"
              ? "tv_off_ack"
              : "tv_on_ack",
            at,
            id,
            cmd,
          );
      }
    }
    if (watchDecision !== null) add("watch", watchDecision);
    const place = events.find((e) => e.kind === "place");
    const sink = this.cups.find((e) => e.id === cup && place && e.at >= place.at);
    if (sink) events.push(sink);
    const standby = events.find((e) => e.kind === "standby");
    if (standby) {
      const off = events.find((e) => e.kind === "tv_off");
      const tv = off?.id ?? this.photos.at(-1)?.tv;
      const before = this.photos.filter((p) => p.tv === tv && p.at >= standby.at && (!off || p.at <= off.at));
      const first = before[before.findLastIndex((p) => !p.empty) + 1];
      if (first) add("empty", first.at, tv);
      const ack = events.find((e) => e.kind === "tv_off_ack");
      const again = this.photos.find((p) => p.tv === tv && ack && p.at > ack.at && p.watching);
      if (again) add("viewer_returned", again.at, tv);
    }
    // Questions may have no target. Check the phone's own record as well as dispatch receipts.
    if (received.some((c) => !["go", "pick", "place"].includes(c.kind ?? "") && !c.step.startsWith("done:")))
      add("unexpected", rows.at(-1)?.at_ms ?? 0);
    const sorted = events.sort((a, b) => a.at - b.at || scenarioRank(a.kind) - scenarioRank(b.kind));
    return { ...judgeScenario1(sorted), events: sorted };
  }
}
