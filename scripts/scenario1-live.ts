/** Observe the same home that is playing the video. No recorded command or result is fed to the home. */
import type { HistoryRow } from "../src/contract/history.js";
import type { SceneJson } from "../src/contract/layout.js";
import type { StationMap } from "../src/contract/stations.js";
import type { HouseholdPhoto, WorldDevice, WorldView } from "../src/contract/world.js";
import { floorLookup } from "../src/layout/home-plan.js";
import { floorPlanFrom } from "../src/layout/floor.js";
import { locateZone } from "../src/layout/stations.js";
import { GoalTriggers } from "../src/goal/triggers.js";
import { judgeScenario1, scenarioRank, type ScenarioEvent } from "./scenario1-judge.js";

type Scene = SceneJson & { stations: StationMap };
type Received = { id: string; step: string; kind?: string; target?: { id: string } | null };
/** at: 촬영 시각, arrived: 그 사진의 VLM 답이 집 상태에 들어온 시각(집 사진 answered_ms. 없으면 그 기록 줄의 시각). */
type Sample = { at: number; arrived: number; tv: string; empty: boolean; watching: boolean };
export const SCENARIO_KINDS = ["household", "decision", "goal", "plan", "robot"];

export class LiveScenario {
  private readonly map: StationMap;
  private readonly floor: (p: [number, number]) => number;
  private readonly sinks: Set<string>;
  private photos: Sample[] = [];
  private cups: ScenarioEvent[] = [];
  /** 마지막으로 읽은 World State의 가전(시청 구역을 지켜볼 TV를 찾는다). */
  private devices: WorldDevice[] = [];
  private lastSink = new Set<string>();
  constructor(scene: Scene) {
    this.map = scene.stations;
    this.floor = floorLookup(scene.plan.rooms ?? []);
    this.sinks = new Set([...floorPlanFrom(scene).objects.values()].filter((p) => p.basin).map((p) => p.id));
  }
  /** 읽은 World State: 가전과 싱크대 안 컵만 본다. 집 사진은 1초마다 읽으면 1초 간격 사진을 건너뛸 수 있어 기록 줄(judge)로만 매긴다. */
  sample(w: WorldView) {
    this.devices = w.devices;
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
    events.push(...this.photosFrom(rows));
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
      // 대기 자리 도착 전 끔→켬(식탁에서 소파로 걷는 동안)은 판정 함수가 따로 본다. 여기서는 대기 뒤 끄기만 쓴다
      const off = events.find((e) => e.kind === "tv_off" && e.at >= standby.at);
      const tv = off?.id ?? this.photos.at(-1)?.tv;
      // 끌 때 시스템이 가진 사진(그때까지 들어온 것)을 촬영 차례로: 빈 구간 첫 촬영과 끄기를 정한 마지막 빈 촬영
      const before = this.photos.filter((p) => p.tv === tv && p.at >= standby.at && (!off || p.arrived <= off.at)).sort((a, b) => a.at - b.at);
      const first = before[before.findLastIndex((p) => !p.empty) + 1];
      if (first) add("empty", first.at, tv);
      if (first && before.at(-1)!.empty) add("vacant", before.at(-1)!.at, tv);
      const ack = events.find((e) => e.kind === "tv_off_ack" && e.at >= standby.at);
      const again = this.photos.find((p) => p.tv === tv && ack && p.at > ack.at && p.watching);
      if (again) add("viewer_returned", again.at, tv);
    }
    // Questions may have no target. Check the phone's own record as well as dispatch receipts.
    if (received.some((c) => !["go", "pick", "place"].includes(c.kind ?? "") && !c.step.startsWith("done:")))
      add("unexpected", rows.at(-1)?.at_ms ?? 0);
    events.push(...earlyTvEvidence(events, this.photos));
    const sorted = events.sort((a, b) => a.at - b.at || scenarioRank(a.kind) - scenarioRank(b.kind));
    return { ...judgeScenario1(sorted), events: sorted };
  }

  /** 기록 DB의 집 사진 줄(사진마다 한 줄, src/record/machines.ts)을 serial 차례로 매긴다(촬영 시각, 비었나, 앉아 보나).
   *  serial이 빠졌으면 그 사이 사진의 근거를 모르므로 photo_gap을 낸다. */
  private photosFrom(rows: readonly HistoryRow[]): ScenarioEvent[] {
    const triggers = new GoalTriggers(locateZone, this.floor, 2000);
    const list = new Map<number, { photo: HouseholdPhoto; at: number }>();
    for (const r of rows) {
      const d = (r.data ?? {}) as { event?: string; photo?: HouseholdPhoto };
      if (r.kind === "household" && d.event === "photo" && d.photo) list.set(d.photo.serial, { photo: d.photo, at: r.at_ms });
    }
    const gaps: ScenarioEvent[] = [];
    this.photos = [];
    let last: number | null = null;
    for (const [serial, { photo, at }] of [...list].sort((a, b) => a[0] - b[0])) {
      if (last !== null && serial !== last + 1) gaps.push({ kind: "photo_gap", at });
      last = serial;
      const arrived = photo.answered_ms ?? at;
      const view = { at_ms: arrived, objects: [], devices: this.devices, person_trail: [], household_photo: photo } as unknown as WorldView;
      // 촬영 시각으로 매긴다(읽은 때와 상관없이)
      const f = triggers.evaluateTriggers(view, serial, this.map, photo.at_ms);
      for (const [tv, room] of f.tvRooms ?? [])
        this.photos.push({
          at: photo.at_ms,
          arrived,
          tv,
          empty: f.read({ kind: "noViewer", room, ms: 0 }).value === true,
          watching: f.read({ kind: "postureAttention", target: tv, posture: "seated" }).value === true,
        });
    }
    return gaps;
  }

  /** 마지막 judge가 기록 줄에서 매긴 집 사진마다의 시청 구역(촬영 시각, 비었나, 앉아 보나). */
  photoSamples(): readonly Sample[] {
    return this.photos;
  }
}

/** 대기 자리 도착 전 TV 끔→켬마다 근거 사진을 찾는다(촬영 시각, 판정 scripts/scenario1-judge.ts earlyTv).
 *  early_empty: 그 끄기 전 마지막으로 사람이 보인 사진 다음의 빈 사진(빈 구간의 시작). early_vacant: 끄기 전에 들어온 빈 구간의 마지막 촬영(끄기를 정한 사진).
 *  early_viewer: 끈 확인 뒤 찍혀 다시 켜기 전에 온 앉아 보는 사진. */
export function earlyTvEvidence(events: readonly ScenarioEvent[], photos: readonly Sample[]): ScenarioEvent[] {
  const standby = events.find((e) => e.kind === "standby")?.at ?? Infinity;
  const out: ScenarioEvent[] = [];
  for (const off of events.filter((e) => e.kind === "tv_off" && e.at < standby)) {
    // 끌 때 시스템이 가진 사진(그때까지 들어온 것)만 본다: 촬영은 앞서도 늦게 온 답은 그 판단의 근거가 아니다
    const seen = photos.filter((p) => p.tv === off.id && p.arrived <= off.at).sort((a, b) => a.at - b.at);
    const first = seen[seen.findLastIndex((p) => !p.empty) + 1];
    if (first?.empty) {
      out.push({ kind: "early_empty", at: first.at, id: off.id });
      out.push({ kind: "early_vacant", at: seen.at(-1)!.at, id: off.id });
    }
    const ack = events.find((e) => e.kind === "tv_off_ack" && e.id === off.id && e.at >= off.at);
    const on = events.find((e) => e.kind === "tv_on" && e.id === off.id && ack && e.at >= ack.at && e.at < standby);
    const back = ack && on && photos.find((p) => p.tv === off.id && p.watching && p.at > ack.at && p.arrived <= on.at);
    if (back) out.push({ kind: "early_viewer", at: back.at, id: off.id });
  }
  return out;
}
