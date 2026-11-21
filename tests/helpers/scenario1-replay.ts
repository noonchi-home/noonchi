// The bag stops at the judgment input boundary. Each line names its recorded or composed source.
// Recorded cup observations are looked up by original frame id; automatic phone/device outputs never enter the bag.
import { readFileSync } from "node:fs";
import { Outbox, BusNode, type Body, type Envelope, type TopicName } from "../../src/bus/index.js";
import { Bag, replay } from "../../src/record/index.js";
import { GoalTriggers, type TriggerFacts } from "../../src/goal/triggers.js";
import { FAST_VLM_MS, loadObserveConfig, vlmStepMs } from "../../src/observe/pipeline.js";
import { RoomWatch } from "../../src/goal/room-watch.js";
import { TvWatch, viewerAt } from "../../src/goal/tv-watch.js";
import { goalRoutes } from "../../src/goal/node.js";
import { managerRoutes } from "../../src/manage/node.js";
import { PlanHub } from "../../src/act/hub.js";
import { checkPlan } from "../../src/act/check.js";
import { tasksFor } from "../../src/act/tasks.js";
import { deviceRunner } from "../../src/act/devices.js";
import { PlanDraft, resubmit } from "../../src/agent/planTools.js";
import { memoryApprovals } from "../../src/agent/approval.js";
import { walkingMap } from "../../src/layout/walk-guide.js";
import { Policy } from "../../src/agent/policy.js";
import { MemoryHub, SignalHub } from "../../src/devices/index.js";
import { floorPlanFrom } from "../../src/layout/floor.js";
import { loadScene } from "../../src/layout/scene.js";
import { resolveHome } from "../../src/layout/homes.js";
import { DEFAULT_TWIN_DIR } from "../../src/layout/twin-files.js";
import { locateZone } from "../../src/layout/stations.js";
import { WorldState } from "../../src/world/index.js";
import { fsmStep } from "../../src/brain/decision.js";
import { parsePrediction } from "../../src/brain/pam/answer.js";
import { LEARNED_FSM_MEMORY } from "../../scripts/learned-memory.js";
import type { DecisionRecord } from "../../src/contract/events.js";
import type { DeviceSpec } from "../../src/contract/devices.js";
import type { WorldView, WorldDevice, WorldObject } from "../../src/contract/world.js";
import type { Vec2 } from "../../src/contract/layout.js";
import type { SceneObservation } from "../../src/contract/observe.js";
import { testTracker } from "./tracker-ports.js";
import { planContext } from "./planner.js";
import { LiveScenario } from "../../scripts/scenario1-live.js";
import { HistoryDb } from "../../src/brain/history/db.js";
import { historyRoutes } from "../../src/record/history.js";
import type { PlannedCommand } from "../../src/contract/phone.js";
import type { ScenarioEvent } from "../../scripts/scenario1-judge.js";

type Variant = "normal" | "back" | "brief" | "manual" | "cadence_wrong";
/** at: 촬영(또는 사건) 시각. lag가 있는 사진 줄은 VLM 답이 at + lag에 도착한다(집 상태가 그때 바뀐다). */
type Line = { at: number; kind: string; value?: string; frame?: string; response?: object; source: string; lag?: number };
/** 재생에 넣은 사진: 촬영 시각(절대 ms)과 VLM 지연을 실은 줄인가. */
type Photo = { at: number; lagged: boolean };
const scene = loadScene(resolveHome(DEFAULT_TWIN_DIR, "mokryeon_180b"))!;
const map = scene.stations,
  floor = floorPlanFrom(scene);
const table = map.surface_fronts.find((f) => f.surface_id.startsWith("dining_table"))!,
  sink = map.surface_fronts.find((f) => f.surface_id.startsWith("sink_counter"))!;
const cupId = "cup_1",
  tvId = "tv_62442cb3",
  fridgeId = "fridge_bbc363a3";
const tasks = tasksFor("noonchi"),
  epoch = { boot: "composed", home: "mokryeon_180b#1" };
const fact = (value: string, at: number) => ({ value, at_ms: at, since_ms: at, certainty: "confirmed" as const });
function center(id: string): Vec2 {
  const ps = map.zones.find((z) => z.id === id)!.polygon;
  return ps.reduce<Vec2>((p, q) => [p[0] + q[0] / ps.length, p[1] + q[1] / ps.length], [0, 0]);
}
const tvSpec: DeviceSpec = {
  id: tvId,
  label: "거실 TV",
  room: "living",
  roomLabel: "거실",
  kind: "tv",
  twinType: "tv",
  matterDeviceType: "BasicVideoPlayerDevice",
  capabilities: ["onoff"],
  sensors: [],
  twinAttrs: { power: ["off", "on"] },
};
const raw = readFileSync(new URL("../fixtures/scenario1/judgment-composed.ndjson", import.meta.url), "utf8")
  .trim()
  .split(/\r?\n/)
  .map((s) => JSON.parse(s));
if (raw[0].kind !== "metadata" || !raw[0].name.includes("composed"))
  throw new Error("합성 자료 머리말이 없습니다.");
const frames: { frame: string; scene: SceneObservation }[] = JSON.parse(
  readFileSync(new URL("../fixtures/replay/wide-mug-v1.json", import.meta.url), "utf8"),
);
const base = Date.UTC(2026, 10, 20, 12);
function makeBag(bag: Bag, variant: Variant): { left: number | null; photos: Photo[] } {
  const world = new WorldState({
    devices: () => [],
    surfaces: () => [],
    floorAt: () => 0,
    roomAt: () => ({ id: "living", label: "거실" }),
  }).view(base);
  const fridge: WorldDevice = {
    id: fridgeId,
    kind: "fridge",
    label: "냉장고",
    status: "닫힘",
    state: ["door_closed"],
    history: [],
    changed_ms: base,
    event_ms: null,
    started_ms: null,
    remaining_min: null,
    active: false,
  };
  const tv = { ...fridge, id: tvId, kind: "tv", label: "거실 TV", status: "켜짐", state: ["on"] } as WorldDevice;
  world.devices = [fridge, tv];
  let seq = 0,
    rev = 0,
    serial = 0;
  function put<N extends TopicName>(topic: N, node: Envelope<N>["header"]["node"], body: Body<N>, at: number) {
    bag.write(
      { topic, key: "_", header: { node, seq: ++seq, stamp: at, inst: "composed-1", ...epoch }, body },
      at,
    );
  }
  const patch = raw.find((row) => row.kind === "variant" && row.name === variant);
  const source: Line[] = raw.filter(
    (row) => Number.isFinite(row.at) && row.at < (patch?.replace_from ?? Infinity),
  );
  for (const r of patch?.rows ?? []) source.push({ ...r, source: patch.source });
  let left: number | null = null;
  const photos: Photo[] = [];
  // 집 상태는 도착 차례로 쌓는다: 늦게 온 VLM 답은 그 사이 사건 뒤에 들어간다(사진 시각은 촬영 시각 그대로)
  const arrival = (r: Line) => r.at + (r.lag ?? 0);
  for (const r of source.sort((a, b) => arrival(a) - arrival(b) || a.at - b.at)) {
    const at = base + r.at,
      arrive = base + arrival(r);
    if (r.kind === "left") {
      left = at;
      continue;
    }
    if (r.kind === "manual_off") {
      const manual = new MemoryHub([tvSpec], { [tvId]: { power: "off" } });
      put(
        "/device/changes",
        "devices",
        {
          id: tvId,
          state: manual.get(tvId)!,
          note: { kind: "tv", power: { power: "off", generation: 1, command_id: null } },
        },
        at,
      );
      continue;
    }
    if (r.kind === "eye") {
      const pos =
        r.value === "table"
          ? table.position
          : r.value === "sink"
          ? sink.position
          : map.stations.find((s) => s.id === r.value)!.position;
      world.eye = {
        position: pos,
        room: r.value === "sink" || r.value === "kitchen_entry" ? "kitchen" : "living",
        room_label: null,
        at_ms: at,
        height_m: 1.3,
        yaw_deg: 0,
        pitch_deg: 0,
      };
      world.at_ms = at;
      put("/world/state", "world", { rev: ++rev, view: world }, at);
      for (const delay of [0, 80, 160])
        put(
          "/phone/pose",
          "phone",
          { quality: "usable", position: pos, pose_gen: 1, observed_ms: at + delay },
          at + delay,
        );
      continue;
    }
    if (r.kind === "pam") {
      const parsed = parsePrediction(JSON.stringify(r.response), tasks, {
        memory: LEARNED_FSM_MEMORY,
        lastState: "drinking",
      });
      if (!parsed.prediction) throw Error(parsed.errors.join(" "));
      const d: DecisionRecord = {
        id: "pam:1",
        seq: 1,
        atMs: at,
        request_rev: rev,
        finalTime: new Date(at).toISOString(),
        textSent: "",
        tasks,
        status: "valid",
        action: parsed.selected_action,
        prediction: parsed.prediction,
        fsm: fsmStep(LEARNED_FSM_MEMORY, parsed.prediction),
        memoryVersion: 1,
        world: { objects: [], person_visible: true, yolo_missing: 0, vlm_missing: 0 },
      };
      put("/brain/decision", "brain", { decision: d, at_ms: at, rev, assist: "noonchi", check: { ok: true } }, at);
      continue;
    }
    if (r.kind === "fridge_open") {
      fridge.state = ["door_open"];
      fridge.history.push({ at_ms: at, attr: "door", from: "closed", to: "open" });
      fridge.changed_ms = at;
      fridge.event_ms = at;
      fridge.status = "열림";
    }
    if (["table", "away", "tv"].includes(r.kind)) {
      photos.push({ at, lagged: r.lag !== undefined });
      const record = r.frame ? frames.find((f) => f.frame === r.frame) : null;
      if (r.frame && !record) throw Error("없는 녹화 장 " + r.frame);
      const facts = record?.scene.observations ?? [];
      const place = facts.find(
        (o) => o.object_id === "v1" && ["on_table", "in_hand", "in_sink"].includes(o.state),
      )?.state;
      if (place) {
        const onSink = place === "in_sink",
          held = place === "in_hand",
          front = onSink ? sink : table;
        const cup: WorldObject = {
          id: cupId,
          cls: "cup",
          position: [...front.look_at.slice(0, 1), 0.8, front.look_at[1]] as [number, number, number],
          surface: held ? null : front.surface_id,
          surface_label: onSink ? "싱크대" : "식탁",
          surface_part: onSink ? "basin" : undefined,
          room: front.room,
          status: "present",
          first_seen_ms: world.objects[0]?.first_seen_ms ?? at,
          last_seen_ms: at,
          last_in_view_ms: at,
          error_m: 0.05,
          facts: { place: fact(place, at) },
          answered_ms: null,
          closer_hold: false,
          devices: [],
          followed_by: null,
        };
        world.objects = [cup];
      }
      const was = world.person.visible,
        visible = r.kind !== "away" && r.value !== "empty";
      const dining = r.kind === "table",
        pos = center(dining ? "dining_seat" : "sofa_watch"),
        seated = r.value !== "standing";
      const observedDrink = facts.some((f) => f.object_id === "d1" && f.state === "drinking");
      const activity = dining ? (observedDrink ? "drinking" : world.person.facts.activity?.value) : "watching_tv";
      world.person = {
        ...world.person,
        answered_ms: visible ? at : null,
        visible,
        count: visible ? 1 : 0,
        since_ms: was === visible ? world.person.since_ms : at,
        last_seen_ms: visible ? at : world.person.last_seen_ms,
        room: "living",
        room_label: "거실",
        position: visible ? pos : null,
        position_ms: visible ? at : null,
        holding: [],
        facts: visible && activity ? { activity: fact(activity, at) } : {},
      };
      world.household_photo = {
        serial: ++serial,
        id: "photo-" + serial,
        at_ms: at,
        proof: {
          camera: {
            origin: [7, 1.2, 16],
            orientation: [0, 0, 0, 1],
            theta: 0,
            projection: [0.6, 0, 0, 0, 0, 0.6, 0, 0, 0, 0, -1, -1, 0, 0, -0.2, 0],
          },
          seats: "clear",
          person_count: visible ? 1 : 0,
          dining_food: dining ? "yes" : "unknown",
          person: visible
            ? { room: "living", position: pos, seated, attention: dining ? "elsewhere" : "toward_tv" }
            : null,
        },
      };
      if (r.kind === "away")
        world.person_trail = [
          { room: "living", position: center("dining_seat"), at_ms: at - 1000 },
          { room: "living", position: [9.4, 5.5], at_ms: at - 500 },
        ];
    }
    world.at_ms = arrive;
    world.frame_ms = at;
    put("/world/state", "world", { rev: ++rev, view: world }, arrive);
  }
  return { left, photos };
}

/** VLM 사진 간격(src/observe/pipeline.ts frame.vlm): 앞 VLM 촬영 prev 뒤 엔진 프레임마다 보고, 처음으로 「그때 간격(빠름 1초·보통 2초)」 이상 지난 프레임.
 *  fast(t)는 그 시각의 src/server/home/observe.ts vlmFast와 같은 값이다. */
function nextVlmCapture(prev: number, fast: (t: number) => boolean): number {
  for (let t = prev + FAST_VLM_MS; ; t += OBSERVE.engineMs) if (t - prev >= (fast(t) ? FAST_VLM_MS : VLM_STEP_MS)) return t;
}
const OBSERVE = loadObserveConfig({}),
  VLM_STEP_MS = vlmStepMs(OBSERVE);

export async function replayScenario(
  variant: Variant,
  recording?: (v: ReturnType<LiveScenario["judge"]>) => void,
): Promise<ScenarioEvent[]> {
  const bag = Bag.open(":memory:"),
    trace: ScenarioEvent[] = [];
  const db = HistoryDb.open(":memory:"),
    live = new LiveScenario(scene);
  const received: PlannedCommand[] = [];
  let resolveDecision: (d: DecisionRecord) => DecisionRecord = (d) => d;
  // 재생 틱마다 그때 관찰 흐름이 VLM 사진 간격을 1초로 줄일지(vlmFast)를 남긴다
  const fastAt: [number, boolean][] = [];
  try {
    const { left, photos } = makeBag(bag, variant);
    if (raw[0].learned_discard) db.cupAnswers.seedDemo(raw[0].home);
    await replay({
      bag,
      resolveDecision: (d) => resolveDecision(d),
      from: base,
      to: base + 30000,
      topics: ["/world/state", "/brain/decision", "/phone/pose", "/device/changes"],
      launch: async (bus, clock) => {
        const node = (name: "manager" | "act" | "goal" | "devices" | "recorder") =>
          new BusNode({
            bus,
            name,
            epoch,
            clock,
            log: (m) => {
              throw Error(m);
            },
          });
        const act = node("act"),
          goal = node("goal"),
          manager = node("manager");
        const device = node("devices"),
          recorder = node("recorder");
        const deviceOut = new Outbox(device, {
          clock,
          log: (m) => {
            throw Error(m);
          },
        });
        historyRoutes(recorder, db, { now: () => clock.now(), machinesOnly: true });
        const out = new Outbox(act, {
          clock,
          log: (m) => {
            throw Error(m);
          },
        });
        const intents = new Outbox(goal, {
          clock,
          log: (m) => {
            throw Error(m);
          },
        });
        const triggers = new GoalTriggers(locateZone, () => 0, VLM_STEP_MS);
        const tv = new TvWatch((i) => intents.push("/goal/intent", i));
        const rooms = new RoomWatch((i) => intents.push("/goal/intent", i), floor.portals);
        managerRoutes(manager, clock);
        goalRoutes(goal, clock, triggers, rooms, tv);
        let world: WorldView,
          rev = 0,
          facts: TriggerFacts | null = null;
        const hub = new SignalHub(new MemoryHub([tvSpec], { [tvId]: { power: "on" } }));
        const power = () => hub.powerStamp(tvId)!;
        tv.observe(tvId, power());
        // src/server/home/observe.ts처럼 기기 상태가 바뀔 때마다 지금 전원 기록을 TV 규칙에 알린다(/device/changes note.power).
        // 구독이 있어야 허브가 직접 끈 전원도 기록한다(src/devices/hub/signals.ts emit).
        hub.subscribe((s) => tv.observe(s.id, hub.powerStamp(s.id)!));
        const add = (kind: ScenarioEvent["kind"], id?: string, command?: string) =>
          trace.push({ kind, at: clock.now() - base, id, command });
        let powerSeq = 0;
        hub.onPowerIntent = (id, value, command) => {
          deviceOut.push("/device/power_intent", {
            id: "power:" + ++powerSeq,
            device_id: id,
            value,
            origin: command ? "automation" : "unknown",
            command_id: command,
            at_ms: clock.now(),
          });
          if (command) add(value === "on" ? "tv_on" : "tv_off", id, command);
          else if (value === "off") add("manual_off", id);
        };
        hub.onPowerStamp = (state) => {
          const stamp = hub.powerStamp(state.id)!;
          tv.observe(state.id, stamp);
          if (stamp.command_id && stamp.power)
            add(stamp.power === "on" ? "tv_on_ack" : "tv_off_ack", state.id, stamp.command_id);
        };
        const plans = new PlanHub(
          floor,
          (m) => {
            if (m.type === "plan") out.push("/act/log", { type: "plan", plan: m.plan });
          },
          () => new Date(clock.now()).toISOString(),
        );
        const discardLeftover = () => db.cupAnswers.allowDiscard(raw[0].home,
          db.cupAnswers.demoResident(raw[0].home, world.person.count));
        const context = (d: DecisionRecord) => ({
          ...planContext({ decision: d, world, floor }),
          topLook: true as const,
          discardLeftover: discardLeftover(),
        });
        const walk = walkingMap(floor, scene);
        const station = (id: string) => {
          const s = map.stations.find((s) => s.id === id);
          return s
            ? { id, label: s.name, position: [s.position[0], 0, s.position[1]] as [number, number, number] }
            : null;
        };
        const heard = new Set<string>();
        const tracker = testTracker({
          approvals: memoryApprovals(),
          walking: () => walk,
          clock,
          plans,
          world: () => world,
          floor: () => floor,
          planGapMs: 0,
          offsetMinutes: 0,
          tasks: () => tasks,
          habit: () => ({ kind: "fsm", state: "drinking", version: 1, memory: LEARNED_FSM_MEMORY }),
          meal: () => facts?.meal,
          planner: async (d, _signal, ahead) =>
            new PlanDraft({ ...context(d), ahead }).submit({
              steps: raw.find((row) => row.kind === "plan_response").steps,
            }),
          reuse: (d, plan, rename) => resubmit(plan, context(d), rename),
          check: (d, plan, seenSince) =>
            checkPlan({
              decision: d,
              plan,
              world,
              tasks,
              nowMs: clock.now(),
              staleMs: 3000,
              mode: "test",
              seenSince,
            }),
          locate: (id) => {
            const f = floor.objects.get(id);
            if (!f) return undefined;
            const pos = f.basin ?? f.position;
            return {
              label: id === table.surface_id ? "식탁" : id === sink.surface_id ? "싱크대" : id,
              position: [pos[0], 0.8, pos[1]],
            };
          },
          discardLeftover,
          stations: {
            map: () => map,
            rev: () => rev,
            target: station,
            choose: async (job) => job.candidates.find((id) => id === "living_standby") ?? null,
            tvAllowed: (job) => tv.permits(job, viewerAt(facts, tvId, clock.now()), power(), clock.now()),
            result: (r) => out.push("/act/directive_result", r),
          },
          devices: deviceRunner(hub, new Policy()),
          phoneReady: () => true,
          onGoal: (g) => {
            intents.push("/brain/goal_changes", { goal: g });
            if (g.status === "armed" && g.prep === "ready") add("ready", g.object ?? "");
            if (g.status === "checking") add("checking", g.object ?? "");
            if (g.reason === "back") add("back");
          },
          toPhone: (m) => {
            out.push("/act/phone_changes", { cmd: m });
            if (m.type !== "command") return;
            received.push(m);
            const key = JSON.stringify([m.id, m.step]);
            if (heard.has(key)) return;
            heard.add(key);
            const id = m.target?.id;
            if (m.kind === "go") {
              const kind =
                id === map.kitchen_entry
                  ? "kitchen"
                  : id === map.meal_watch
                  ? "meal_watch"
                  : id === table.surface_id
                  ? "table_go"
                  : id === sink.surface_id
                  ? "sink_go"
                  : id === "living_standby"
                  ? m.id.startsWith("dock:")
                    ? "return"
                    : "search"
                  : m.id.startsWith("find:")
                  ? "find_cup"
                  : "unexpected";
              add(kind, id);
            } else if (m.kind === "pick" || m.kind === "place") add(m.kind, id);
            else if (m.choices?.length || m.kind === "do") add("unexpected", m.text);
          },
          emit: (e) => {
            if (e.type === "execution" && e.state === "done") add("plan_done");
          },
        });
        resolveDecision = (d) => {
          const action = tracker.goalTrigger(d);
          return action ? { ...d, action, goal: true } : d;
        };
        let firstEmpty = false;
        const tick = () => {
          if (!world) return;
          const now = clock.now();
          world.devices.find((d) => d.kind === "tv")!.state = [power().power === "on" ? "on" : "off"];
          facts = triggers.evaluateTriggers(world, rev, map, now);
          const g = tracker.goal();
          const checking =
            g?.status === "checking" && g.meal
              ? {
                  id: g.id,
                  since: g.checking_ms!,
                  until: g.check_until_ms!,
                  cup: g.object!,
                  surface: g.meal.surface,
                }
              : null;
          rooms.tick({
            now,
            rev,
            map,
            facts,
            checking,
            personSeen: world.person.visible,
            cupSeen: world.objects.some((o) => o.id === checking?.cup && o.last_seen_ms >= checking.since),
          });
          tv.tick(tvId, viewerAt(facts, tvId, now), rev, now);
          tracker.updateGoal();
          tracker.tick();
          // src/server/home/observe.ts vlmFast와 같은 식
          fastAt.push([now, tracker.fastVlm() || tv.watching()]);
          const f = tracker.machineFacts(),
            v = tracker.goal();
          const robot = tracker.robotTransition({ ...f, observing: false }, now);
          if (robot) out.push("/robot/changes", robot);
          if (robot?.state === "standby") add("standby");
          out.push("/act/work", {
            ...tracker.workContext(),
            at_ms: now,
            active: f.active,
            goal: v
              ? {
                  id: v.id,
                  action: v.action,
                  status: v.status,
                  prep: v.prep,
                  reason: v.reason,
                  gone_ms: v.gone_ms,
                }
              : null,
            plan: null,
            phoneBusy: tracker.visitPhoneBusy(),
            mode: "noonchi",
            tasks,
          });
        };
        act.on("/world/state", async ({ view, rev: next }) => {
          const was = world?.person.visible;
          world = view;
          rev = next;
          live.sample(view);
          if (
            world.household_photo?.proof?.person_count === 0 &&
            trace.some((e) => e.kind === "watch") &&
            !firstEmpty
          ) {
            add("empty");
            firstEmpty = true;
          }
          if (
            firstEmpty &&
            view.household_photo?.proof?.person?.attention === "toward_tv" &&
            !trace.some((e) => e.kind === "viewer_returned")
          )
            add("viewer_returned");
          if (view.objects[0]?.surface_part === "basin" && !trace.some((e) => e.kind === "in_sink"))
            add("in_sink", view.objects[0].id);
          if (was && !view.person.visible)
            tracker.onWorld([
              {
                kind: "person_gone",
                at_ms: clock.now(),
                subject: "person",
                text: "사람 안 보임",
                meaningful: true,
              },
            ]);
          tick();
          await tracker.idle();
        });
        act.on("/phone/pose", (p) => {
          if ("position" in p && p.position) {
            tracker.onEye(p.position);
            plans.onEye(p.position);
            tracker.onNavigationReading(p);
            tick();
          }
        });
        act.on("/brain/decision", (b) => {
          if (b.decision.fsm?.state === "watching_tv") add("watch");
        });
        act.on("/manager/order", async (order) => {
          tracker.onOrder(order.input.decision, order.gate, order.resumed, order.input.check);
          await tracker.idle();
        });
        act.on("/manager/directive", (d) => tracker.onDirective(d));
        act.on("/device/changes", async (d) => {
          if (d.note.power?.command_id === null && d.note.power.power === "off") {
            await hub.command(tvId, { type: "off" });
          }
        });
        act.every(250, tick);
        return [manager, goal, act, device, recorder];
      },
    });
    // 지연을 실은 사진은 앞 사진 뒤 실제 VLM 간격의 촬영이어야 한다(합성 기록이 시스템보다 자주·드물게 찍지 않게)
    const fastWhen = (t: number) => fastAt.findLast(([at]) => at <= t)?.[1] ?? false;
    photos.forEach((p, i) => {
      if (!p.lagged || i === 0) return;
      const want = nextVlmCapture(photos[i - 1]!.at, fastWhen);
      if (p.at !== want)
        throw Error(`합성 기록 사진 ${p.at - base}ms가 VLM 간격과 다릅니다: 앞 사진 ${photos[i - 1]!.at - base}ms 뒤 ${want - base}ms여야 합니다.`);
    });
    if (left !== null) {
      const i = trace.findIndex((e) => e.at > left - base);
      trace.splice(i < 0 ? trace.length : i, 0, { kind: "left", at: left - base });
    }
    recording?.(live.judge(db.list({ limit: 5000 }), received, left));
    return trace;
  } finally {
    db.close();
    bag.close();
  }
}
