// 시나리오 2 합성 재생(침실 1 책상): 실제 노드(goal·manager·act)를 가상 시계로 돌리고, 집과 폰을 든 사람·사용자·VLM은 닫힌 고리로 흉내 낸다.
// 실제 조건(CLAUDE.md 「합성 재생 시험은 실제 시스템과 같은 조건으로 만든다」, 공용 조각 tests/helpers/home-realism.ts):
//  - 폰은 명령을 듣고 REACT_MS 뒤 그 명령이 보낸 안내 길(guide)만 WALK_MPS로 걷는다. 안내가 없으면(보류) 서 있는다. 서 있으면 그 명령의 비출 곳·대상을, 걸으면 다음 경유점을 본다.
//  - VLM은 엔진 프레임(100ms)마다 그때 시스템 간격(빠름 1초·보통 2초, act의 fastVlm)으로 찍고, 답은 촬영 뒤 1.5~1.9초에 온다. 사진에는 그때 폰 카메라 화면 안의 사람·컵·물병만 든다.
//  - World State는 집 상태 노드처럼 바뀐 것이 있을 때만 rev를 올리고 250ms마다 같은 rev로 다시 내며, 새 집 사진은 /world/household_photo로도 낸다.
//  - 부르는 말(「클로이드!」)은 에이전트가 request_task로 넘긴 말 부탁, PAM 답은 배운 화살표를 고른 판단으로 넣는다(모델 자리의 합성 입력).
import { BusNode, MemoryBus, Outbox, VirtualClock, type Body } from "../../src/bus/index.js";
import { settle } from "../../src/record/replay.js";
import { historyRoutes } from "../../src/record/history.js";
import { recordBrainLog } from "../../src/brain/history/recorder.js";
import { GoalTriggers } from "../../src/goal/triggers.js";
import { startGoalNode } from "../../src/goal/start.js";
import { managerRoutes } from "../../src/manage/node.js";
import { PlanHub } from "../../src/act/hub.js";
import { checkPlan } from "../../src/act/check.js";
import { CALL_ACTION, WATER_ACTION, tasksFor } from "../../src/act/tasks.js";
import { PlanDraft } from "../../src/agent/planTools.js";
import { memoryApprovals } from "../../src/agent/approval.js";
import { roomAt } from "../../src/layout/route.js";
import { LOOK_HEIGHT_M, locateZone } from "../../src/layout/stations.js";
import { WORLD_TICK_MS } from "../../src/world/index.js";
import { inView } from "../../src/world/place.js";
import { fsmStep, type FsmMemory } from "../../src/brain/decision.js";
import { findRoutines, routineEdge, type HelpRoutine } from "../../src/brain/history/routines.js";
import type { HistoryDb } from "../../src/brain/history/db.js";
import type { DecisionRecord } from "../../src/contract/events.js";
import type { HelpRecord } from "../../src/contract/history.js";
import type { PlannedCommand, PlannedCommandMessage } from "../../src/contract/phone.js";
import type { Vec2 } from "../../src/contract/layout.js";
import type { WorldObject, WorldView } from "../../src/contract/world.js";
import { testTracker } from "./tracker-ports.js";
import { callSteps, planContext, waterSteps } from "./planner.js";
import { textFromWorld } from "../../src/world/text.js";
import { PHONE, POSE_MS, REACT_MS, VLM_STEP_MS, WALK_MPS, cameraAt, center, fact, floor, heldCupAt, map, nextVlmCapture, personSight, scene, walkMap } from "./home-realism.js";

import type { S2Event, S2Kind } from "../../scripts/scenario2-judge.js";
export type { S2Event, S2Kind } from "../../scripts/scenario2-judge.js";

const DESK = "desk_small_ce7e768b", FRIDGE = "fridge_bbc363a3", SINK = "sink_counter_kitchen";
const epoch = { boot: "composed-s2", home: "mokryeon_180b#1" };
const tasks = tasksFor("noonchi");
const deskFront = map.surface_fronts.find((f) => f.surface_id === DESK)!;
const sinkFront = map.surface_fronts.find((f) => f.surface_id === SINK)!;
const seat = center("desk_seat");
/** 책상 트윈 면(src/world/place.ts surfacesFromLayout: 배치 이름·자리, 윗면 높이는 책상 보통 높이). 사진에 윗면 가운데가 들면 집 상태 노드가 본 면으로 적는다. */
const DESK_SURFACE = { id: DESK, label: "침실 1 책상", room: "bed_sw", center: [floor.objects.get(DESK)!.position[0], floor.objects.get(DESK)!.position[1]] as [number, number], top: 0.75 };
const living = map.stations.find((s) => s.id === "living_standby")!;
/** VLM 답 지연(ms): 잰 평균 nano 1.6초·mini 1.8초 근처를 돈다. */
const LAGS = [1600, 1800, 1500, 1900, 1700];
/** 폰을 든 사람이 집기·놓기·따르기를 마치는 데 드는 때(ms)와 사용자가 질문에 답하기까지(ms), PAM 답 지연(ms). */
const HAND_MS = 3000, POUR_MS = 4000, ANSWER_MS = 2000, PAM_MS = 1500;
/** 집 시간대(서울)의 그날 HH:MM:SS → ms. */
export const kstMs = (day: string, hms: string) => Date.parse(`${day}T${hms}+09:00`);

/** 그날 기억에 화살표가 든 도움 습관(서버 src/server/home/observe.ts routines와 같은 거르기). */
export function adoptedRoutines(db: HistoryDb, memory: FsmMemory, now: number): HelpRoutine[] {
  const helps = db.list({ since: now - 30 * 86_400_000, until: now, kinds: ["help"], limit: Number.MAX_SAFE_INTEGER });
  return findRoutines(helps, db.offsetMinutes).filter((r) => memory.states.some((s) => s.next.some((e) => e.action === r.action && e.on === routineEdge(r).on)));
}

/** 하루를 돌린다. mode call: callAt에 「클로이드!」. habit: 부르지 않는다(습관 시각에 목표 노드가 확인하러 간다).
 *  until: 이 시각까지(또는 도움 기록 뒤 복귀를 마칠 때까지). 돌려주는 것: 재생 기록과 도움 기록. 도움 기록은 db help 줄에도 남긴다. */
export async function replayDay(o: {
  db: HistoryDb; day: string; mode: "call" | "habit"; start: number; until: number; callAt?: number; memory: FsmMemory;
}): Promise<{ events: S2Event[]; records: HelpRecord[] }> {
  const events: S2Event[] = [];
  const records: HelpRecord[] = [];
  const clock = new VirtualClock(o.start);
  const bus = new MemoryBus({ warn: () => {}, clock });
  const fail = (m: string) => { throw Error(m); };
  const node = (name: "manager" | "act" | "world" | "phone" | "brain" | "recorder") => new BusNode({ bus, name, epoch, clock, log: fail });
  const act = node("act"), manager = node("manager"), worldNode = node("world"), phoneNode = node("phone"), brainNode = node("brain"), recorder = node("recorder");
  // 기록 노드: 기계 줄(계획·실행·판단)을 기록 DB에 남긴다(밤 반성이 읽는다)
  historyRoutes(recorder, o.db, { now: () => clock.now(), machinesOnly: true });
  const out = new Outbox(act, { clock, log: fail });
  const add = (kind: S2Kind, extra: Partial<S2Event> = {}) => events.push({ kind, at: clock.now(), ...extra });
  managerRoutes(manager, clock);
  // ── 집(사실), 폰을 든 사람, 사용자 ──
  const truth = {
    cup: { where: "sink" as "sink" | "hand" | "desk", water: false },
    bottle: { where: "fridge" as "fridge" | "hand" | "counter" },
  };
  const phone: { position: Vec2; look: Vec2; walk: { path: Vec2[]; start: number; look: Vec2 } | null } = {
    position: [...living.position] as Vec2, look: [...living.look_at] as Vec2, walk: null,
  };
  const pending: { at: number; run: () => void }[] = [];
  const later = (ms: number, run: () => void) => pending.push({ at: clock.now() + ms, run });
  const pathLen = (p: Vec2[]) => p.slice(1).reduce((s, q, i) => s + Math.hypot(q[0] - p[i]![0], q[1] - p[i]![1]), 0);
  const phoneAt = (t: number): { position: Vec2; look: Vec2 } => {
    const w = phone.walk;
    if (!w || t < w.start) return { position: phone.position, look: phone.look };
    let left = ((t - w.start) / 1000) * WALK_MPS;
    for (let j = 1; j < w.path.length; j++) {
      const a = w.path[j - 1]!, b = w.path[j]!, d = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (left <= d) { const f = d > 0 ? left / d : 1; return { position: [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f], look: b }; }
      left -= d;
    }
    return { position: w.path.at(-1)!, look: w.look };
  };
  // ── World State(집 상태 노드 흉내) ──
  const world: WorldView = {
    at_ms: o.start, objects: [], person: { visible: false, since_ms: null, last_seen_ms: null, count: 0, room: null, room_label: null, position: null, position_ms: null, near: [], holding: [], answered_ms: null, facts: {} },
    fixtures: [], devices: [], eye: null, frame_ms: null, vlm_missing: 0, yolo_missing: 0,
  };
  let rev = 0, lastSig = "", serial = 0;
  const publishState = async () => {
    const sig = JSON.stringify([world.objects.map((x) => [x.id, x.status, x.surface, x.facts.place?.value ?? null, x.facts.contents?.value ?? null]),
      [world.person.visible, world.person.count, world.person.room, world.person.facts.activity?.value ?? null]]);
    if (sig !== lastSig) { rev++; lastSig = sig; }
    await worldNode.publish("/world/state", { rev, view: structuredClone(world) } as Body<"/world/state">);
  };
  const eyeNow = () => {
    const { position, look } = phoneAt(clock.now());
    return { position, room: roomAt(floor, position), room_label: null, at_ms: clock.now(), height_m: PHONE.heightM,
      yaw_deg: ((Math.atan2(look[1] - position[1], look[0] - position[0]) * 180) / Math.PI + 360) % 360, pitch_deg: PHONE.pitchDeg };
  };
  // ── VLM: 엔진 프레임마다 그때 간격으로 찍고 답은 지연 뒤 ──
  let lastShot = -Infinity, shots = 0, fast = false;
  const answers: { at: number; shot: () => void }[] = [];
  const capture = (t: number) => {
    const ph = phoneAt(t), camera = cameraAt(ph.position, ph.look);
    const seen = (p: [number, number, number]) => inView(camera, p);
    const sight = personSight(camera, seat);
    const cupAt: [number, number, number] = truth.cup.where === "hand" ? heldCupAt(ph) : truth.cup.where === "desk" ? [deskFront.look_at[0], 0.78, deskFront.look_at[1]] : [sinkFront.look_at[0], 0.92, sinkFront.look_at[1]];
    const cupSeen = truth.cup.where === "hand" || seen(cupAt);
    const bottleSeen = truth.bottle.where === "hand" ? true : truth.bottle.where === "counter" ? seen([sinkFront.look_at[0], 0.95, sinkFront.look_at[1] + 0.2]) : false;
    const lag = LAGS[shots++ % LAGS.length]!;
    const deskSeen = roomAt(floor, ph.position) === DESK_SURFACE.room && seen([DESK_SURFACE.center[0], DESK_SURFACE.top, DESK_SURFACE.center[1]]);
    const snap = { cup: { ...truth.cup }, bottle: { ...truth.bottle }, cupAt, cupSeen, bottleSeen, sight, camera, deskSeen };
    answers.push({ at: t + lag, shot: () => {
      const at = t, now = clock.now();
      const objs = world.objects.filter((x) => !(x.cls === "cup" && snap.cupSeen) && !(x.cls === "bottle" && snap.bottleSeen));
      const base = { error_m: 0.05, status: "present" as const, answered_ms: now, devices: [], closer_hold: false, followed_by: null, last_in_view_ms: at };
      if (snap.cupSeen) {
        const surface = snap.cup.where === "desk" ? DESK : snap.cup.where === "sink" ? SINK : null;
        objs.push({ ...base, id: "cup_1", cls: "cup", position: snap.cupAt, surface, surface_label: surface === DESK ? "책상" : surface ? "싱크대" : null, room: surface === DESK ? "bed_sw" : "kitchen",
          first_seen_ms: world.objects.find((x) => x.id === "cup_1")?.first_seen_ms ?? at, last_seen_ms: at,
          facts: { place: fact(snap.cup.where === "hand" ? "in_hand" : "on_table", at), contents: fact(snap.cup.water ? "has_contents" : "empty", at) } } as WorldObject);
      }
      if (snap.bottleSeen) objs.push({ ...base, id: "bottle_1", cls: "bottle", position: snap.bottle.where === "hand" ? heldCupAt(phoneAt(at)) : [sinkFront.look_at[0], 0.95, sinkFront.look_at[1] + 0.2],
        surface: snap.bottle.where === "counter" ? SINK : null, surface_label: snap.bottle.where === "counter" ? "싱크대" : null, room: "kitchen",
        first_seen_ms: at, last_seen_ms: at, facts: { place: fact(snap.bottle.where === "hand" ? "in_hand" : "on_table", at) } } as WorldObject);
      world.objects = objs;
      // 집 상태 노드처럼(src/world/state/world.ts noteSurfaces) 사진에 책상 윗면 가운데가 들면 본 면으로 적는다
      if (snap.deskSeen) world.surfaces_seen = [{ id: DESK_SURFACE.id, label: DESK_SURFACE.label, room: DESK_SURFACE.room, center: DESK_SURFACE.center, seen_ms: at }];
      const visible = snap.sight.visible, was = world.person.visible;
      // 집 상태 노드의 기록 줄(사람 보임·하는 일): 밤 반성의 하루 기록이 된다
      if (visible !== was) o.db.add("detection", now, visible ? "사람 보임" : "사람 안 보임");
      if (visible && world.person.facts.activity?.value !== "using_laptop") o.db.add("world", now, "사람 노트북 쓰는 중");
      world.person = { ...world.person, visible, count: visible ? 1 : 0, answered_ms: now, since_ms: was === visible ? world.person.since_ms : at,
        last_seen_ms: visible ? at : world.person.last_seen_ms,
        room: snap.sight.located ? "bed_sw" : world.person.room, room_label: snap.sight.located ? "침실 1" : world.person.room_label,
        position: snap.sight.located ? seat : world.person.position, position_ms: snap.sight.located ? at : world.person.position_ms,
        // 집 상태 노드처럼 사람 사실은 안 보여도 마지막 값을 남긴다
        facts: visible ? { activity: fact("using_laptop", at) } : world.person.facts };
      serial++;
      world.household_photo = { serial, id: `photo-${serial}`, at_ms: at, answered_ms: now,
        proof: { camera: snap.camera, seats: "clear", person_count: visible ? 1 : 0, dining_food: "unknown",
          person: snap.sight.located ? { room: "bed_sw", position: seat, seated: true, attention: "elsewhere" } : null } };
      if (snap.sight.located) world.person_trail = [...(world.person_trail ?? []).slice(-1), { room: "bed_sw", position: seat, at_ms: at }];
      void worldNode.publish("/world/household_photo", { photo: structuredClone(world.household_photo) });
      add("photo");
      photoSeen();
    } });
  };
  // ── PAM(습관 날): 관찰 글(src/world/text.ts)에 노트북 쓰는 중과 「책상 위 마실 것 없음」이 있으면 배운 화살표로 물 한 잔 가져다주기
  //    (실제 PAM이 이 두 줄로 그 화살표를 고른다: 2026-11-22 실제 모델 4/4, 마실 것 없음 줄이 없으면 0/4) ──
  let pamSent = false, decSeq = 0;
  const photoSeen = () => {
    if (o.mode !== "habit" || pamSent) return;
    const textSent = textFromWorld(world, [], { nowMs: clock.now(), offsetMinutes: 540 });
    if (!/\[지속\] 사람 노트북 쓰는 중/.test(textSent) || !/\[지속\] 침실 1 책상 위 마실 것 없음/.test(textSent)) return;
    const st = map.stations.find((s) => s.id === "desk_watch")!;
    if (Math.hypot(phone.position[0] - st.position[0], phone.position[1] - st.position[1]) > 0.6 || phone.walk) return;
    const state = o.memory.states.find((s) => s.id === "studying");
    const next = state?.next.findIndex((e) => e.action === WATER_ACTION) ?? -1;
    if (!state || next < 0) return;
    pamSent = true;
    later(PAM_MS, () => {
      const prediction = { observation: "사용자가 책상에서 노트북으로 공부하고 있고 책상 위에 마실 물이 없다.", reasoning: "평소 이 시간에 물을 찾는다.", task_index: tasks.indexOf(WATER_ACTION), state: "studying", from: "studying", next_index: next };
      const d: DecisionRecord = { id: `pam-${++decSeq}`, seq: decSeq, atMs: clock.now(), request_rev: rev, finalTime: new Date(clock.now()).toISOString(), textSent, tasks,
        status: "valid", action: WATER_ACTION, prediction, fsm: fsmStep(o.memory, prediction), memoryVersion: 2,
        world: { objects: [], person_visible: true, yolo_missing: 0, vlm_missing: 0 } };
      add("water", { via: "pam", learned: d.fsm?.learned });
      void brainNode.publish("/brain/decision", { decision: d, at_ms: clock.now(), rev, assist: "noonchi", check: { ok: true } });
    });
  };
  // ── 실행 쪽(act): 실제 실행 추적 ──
  const plans = new PlanHub(floor, (m) => { if (m.type === "plan") out.push("/act/log", { type: "plan", plan: m.plan }); }, () => new Date(clock.now()).toISOString());
  const ids = { fridge: FRIDGE, sink: SINK, desk: DESK, cup: "cup_1" };
  const station = (id: string) => {
    const s = map.stations.find((x) => x.id === id);
    return s ? { id, label: s.name, position: [s.position[0], 0, s.position[1]] as [number, number, number],
      look: { label: map.zones.filter((z) => s.observes_zone_ids.includes(z.id)).map((z) => z.name).join("·") || null, position: [s.look_at[0], LOOK_HEIGHT_M, s.look_at[1]] as [number, number, number] } } : null;
  };
  const walk = walkMap;
  let tracker!: ReturnType<typeof testTracker>;
  let walking: { step: string; revision: number | null } | null = null;
  /** 그 가기 명령의 안내 길(guide.remaining)을 지금 자리에서 점 차례대로 곧게 걷는다. 안내에 없는 점은 걷지 않는다. */
  const follow = (c: PlannedCommand) => {
    if (!c.guide) return;
    walking = { step: c.step, revision: c.guide.revision ?? null };
    const path: Vec2[] = [phoneAt(clock.now()).position, ...c.guide.remaining.map((p): Vec2 => [p.position[0], p.position[2]])];
    const aim = c.target!.look ?? c.target!.position;
    phone.walk = { path, start: clock.now(), look: [aim[0], aim[2]] };
    const mine = phone.walk;
    later(Math.ceil((pathLen(path) / WALK_MPS) * 1000), () => {
      if (phone.walk !== mine) return;
      phone.position = path.at(-1)!;
      phone.look = mine.look;
      phone.walk = null;
    });
  };
  const onCommand = (m: PlannedCommandMessage) => {
    if (m.type !== "command") return;
    const c = m as PlannedCommand;
    // 걷는 중인 가기 명령의 안내가 바뀌었으면 새 안내를 따른다
    if (c.kind === "go" && walking?.step === c.step && c.guide && (c.guide.revision ?? null) !== walking.revision && phone.walk) follow(c);
    if (seen.has(c.step)) return;
    seen.add(c.step);
    const target = c.target?.id;
    if (c.kind === "go") {
      add(c.id.startsWith("dock:") ? "return" : c.id.startsWith("habit:") || c.id.startsWith("visit:") ? "visit_go" : "go", { target });
      // 명령을 듣고 REACT_MS 뒤 그 명령의 안내 길만 걷는다(없으면 서 있는다). 안내가 바뀌어 다시 오면(followGuide처럼) 지금 자리에서 새 안내를 걷는다
      later(REACT_MS, () => follow(c));
      return;
    }
    if (c.choices.some((x) => x.id === "water")) {
      add("ask", { text: c.text });
      later(ANSWER_MS, () => {
        add("answer", { text: "물 한 잔만 가져다줘" });
        tracker.onHeard("물 한 잔만 가져다줘", { kind: "command", id: c.id, step: c.step, pending: [] });
      });
      return;
    }
    if (c.kind === "pick") {
      add("pick", { target: c.text });
      later(HAND_MS, () => {
        if (/물병/.test(c.text)) truth.bottle.where = "hand";
        else { truth.cup.where = "hand"; truth.bottle.where = "counter"; }
      });
    } else if (c.kind === "do") {
      add("do", { text: c.text });
      later(POUR_MS, () => { truth.cup.water = true; });
    } else if (c.kind === "place") {
      add("place", { target });
      later(HAND_MS, () => { truth.cup.where = "desk"; });
    }
  };
  const seen = new Set<string>();
  // ── 목표 노드: 실제 서버와 같은 함수(습관 시각 계기 포함) ──
  const triggers = new GoalTriggers(locateZone, () => 0, VLM_STEP_MS);
  const goalNode = await startGoalNode({
    bus, epoch, clock, log: fail, triggers, portals: floor.portals, map: () => map, viewers: () => [], checking: () => null,
    routines: () => o.mode === "habit" ? adoptedRoutines(o.db, o.memory, clock.now()) : [], offsetMinutes: 540,
    afterTick: () => { if (world.eye) tracker.updateGoal(); },
  });
  let worldSeen: WorldView = world, worldRev = 0;
  tracker = testTracker({
    approvals: memoryApprovals(), clock, plans, world: () => worldSeen, floor: () => floor, planGapMs: 0, offsetMinutes: 540, tasks: () => tasks,
    habit: () => ({ kind: "fsm", state: "studying", version: 2, memory: o.memory }),
    planner: async (d) => new PlanDraft(planContext({ decision: d, world: worldSeen, floor })).submit({ steps: d.action === CALL_ACTION ? callSteps(DESK) : waterSteps(ids) }),
    check: (d, plan, seenSince) => checkPlan({ decision: d, plan, world: worldSeen, tasks, nowMs: clock.now(), staleMs: 3000, mode: "test", seenSince }),
    locate: (id) => { const f = floor.objects.get(id); if (!f) return undefined; const p = f.basin ?? f.position; return { label: id === DESK ? "책상" : id === SINK ? "싱크대" : id === FRIDGE ? "냉장고" : id, position: [p[0], 0.8, p[1]] }; },
    walking: () => walk,
    stations: { map: () => map, rev: () => worldRev, target: station, result: (r) => out.push("/act/directive_result", r) },
    phoneReady: () => true,
    toPhone: (m) => { out.push("/act/phone_changes", { cmd: m }); onCommand(m); },
    emit: (e) => { recordBrainLog(o.db, e); if (e.type === "execution" && e.state === "done") add("done", { text: e.plan_id }); },
    thought: (text) => { if (text.startsWith("평소")) add("habit_visit", { text }); },
    help: (r) => { records.push(r); o.db.add("help", r.at_ms, r.text, { subject: r.action, data: r }); add("record", { text: r.text, via: r.via }); },
    onSpeech: (d) => { if (d.action === WATER_ACTION) add("water", { via: d.via ?? "speech" }); },
  });
  const tick = () => {
    tracker.tick();
    fast = tracker.fastVlm();
    const f = tracker.machineFacts();
    const r = tracker.robotTransition({ ...f, observing: false }, clock.now());
    if (r) out.push("/robot/changes", r);
    out.push("/act/work", { ...tracker.workContext(), at_ms: clock.now(), active: f.active, goal: null, plan: null, phoneBusy: tracker.visitPhoneBusy(), mode: "noonchi", tasks });
  };
  act.on("/world/state", async ({ view, rev: next }) => {
    const fresh = next !== worldRev;
    worldSeen = view;
    worldRev = next;
    if (!fresh) return;
    tick();
    await tracker.idle();
  });
  act.on("/phone/pose", (p) => { if ("position" in p && p.position) { tracker.onEye(p.position); plans.onEye(p.position); tracker.onNavigationReading(p); tick(); } });
  act.on("/manager/order", async (order) => { tracker.onOrder(order.input.decision, order.gate, order.resumed, order.input.check); await tracker.idle(); });
  act.on("/manager/directive", (d) => tracker.onDirective(d));
  act.every(250, tick);
  const nodes = [manager, goalNode.mirror.node, act, worldNode, phoneNode, brainNode, recorder];
  try {
    for (const n of nodes) await n.prepare();
    for (const n of nodes) n.start();
    const barrier = () => settle(bus, nodes);
    let lastTick = -Infinity;
    for (let t = o.start; t <= o.until; t += POSE_MS) {
      await clock.advanceTo(t, barrier);
      await barrier();
      if (o.callAt !== undefined && t === o.callAt) { add("call", { text: "클로이드!" }); tracker.onRequest({ task: CALL_ACTION, heard: "클로이드!", atMs: t, afterSeq: 0 }); await tracker.idle(); }
      for (const p of pending.filter((x) => x.at <= t)) { pending.splice(pending.indexOf(p), 1); p.run(); }
      // 엔진 프레임(OBSERVE.engineMs)마다 그때 간격이 지났으면 VLM 촬영
      if (lastShot === -Infinity || t >= nextVlmCapture(lastShot, () => fast)) { lastShot = t; capture(t); }
      for (const a of answers.filter((x) => x.at <= t)) { answers.splice(answers.indexOf(a), 1); a.shot(); }
      world.eye = eyeNow();
      world.at_ms = t;
      world.frame_ms = t;
      if (t - lastTick >= WORLD_TICK_MS) { lastTick = t; await publishState(); }
      await phoneNode.publish("/phone/pose", { quality: "usable", position: phoneAt(t).position, pose_gen: 1, observed_ms: t });
      await barrier();
      if (records.length && events.some((e) => e.kind === "return") && !phone.walk && pending.length === 0 && t > (events.findLast((e) => e.kind === "return")?.at ?? 0) + 20_000) break;
    }
    return { events, records };
  } finally {
    for (const n of nodes) await n.stop().catch(() => {});
    await bus.close();
  }
}
