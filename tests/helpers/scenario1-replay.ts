// The bag stops at the judgment input boundary. Each line names its recorded or composed source.
// Recorded cup observations are looked up by original frame id; automatic phone/device outputs never enter the bag.
import { readFileSync } from "node:fs";
import { Outbox, BusNode, type Body, type Envelope, type TopicName } from "../../src/bus/index.js";
import { Bag, replay } from "../../src/record/index.js";
import { GoalTriggers, type TriggerFacts } from "../../src/goal/triggers.js";
import { NO_VIEWER_MS, YOLO_NO_VIEWER_MS, viewerAt } from "../../src/goal/tv-watch.js";
import { startGoalNode } from "../../src/goal/start.js";
import { managerRoutes } from "../../src/manage/node.js";
import { PlanHub } from "../../src/act/hub.js";
import { checkPlan } from "../../src/act/check.js";
import { tasksFor } from "../../src/act/tasks.js";
import { deviceRunner } from "../../src/act/devices.js";
import { PlanDraft, resubmit } from "../../src/agent/planTools.js";
import { memoryApprovals } from "../../src/agent/approval.js";
import { Policy } from "../../src/agent/policy.js";
import { MemoryHub, SignalHub } from "../../src/devices/index.js";
import { roomAt } from "../../src/layout/route.js";
import { LOOK_HEIGHT_M, locateZone } from "../../src/layout/stations.js";
import { WORLD_TICK_MS, WorldState } from "../../src/world/index.js";
import { fsmStep } from "../../src/brain/decision.js";
import { parsePrediction } from "../../src/brain/pam/answer.js";
import { LEARNED_FSM_MEMORY } from "../../scripts/learned-memory.js";
import type { DecisionRecord } from "../../src/contract/events.js";
import type { DeviceSpec } from "../../src/contract/devices.js";
import type { WorldView, WorldDevice, WorldObject } from "../../src/contract/world.js";
import type { Vec2 } from "../../src/contract/layout.js";
import type { CameraView, SceneObservation } from "../../src/contract/observe.js";
import { inView } from "../../src/world/place.js";
import { testTracker } from "./tracker-ports.js";
import {
  OBSERVE, PHONE, VLM_LAG_MIN_MS, VLM_STEP_MS, POSE_MS, WALK_MPS, cameraAt, center, fact, floor, heldCupAt, map, nextVlmCapture, pathBetween, pathLength, personSight, scene, walkMap, walkProblem,
} from "./home-realism.js";
export { guideBetween, heldCupAt, map, personSight, scene, walkProblem } from "./home-realism.js";
import { planContext } from "./planner.js";
import { earlyTvEvidence, LiveScenario } from "../../scripts/scenario1-live.js";
import { HistoryDb, calendarDay } from "../../src/brain/history/db.js";
import { historyRoutes } from "../../src/record/history.js";
import type { PlannedCommand } from "../../src/contract/phone.js";
import type { ScenarioEvent } from "../../scripts/scenario1-judge.js";

export type Variant = "normal" | "back" | "brief" | "manual" | "cadence_wrong" | "lag_missing" | "lag_zero" | "arrive_early" | "pam_seated";
/** at: 촬영(또는 사건) 시각. 사진 줄(fridge·table·away·tv)은 lag가 반드시 있고, VLM 답이 at + lag에 도착한다(집 상태가 그때 바뀐다).
 *  폰 도착 줄(eye)은 depart(그 자리로 걷기 시작한 때)를 싣는다(처음 선 자리는 없음). */
type Line = { at: number; kind: string; value?: string; frame?: string; response?: object; source: string; lag?: number; depart?: number };
/** 재생에 넣은 사진: 촬영 시각(절대 ms), 그때 폰 자리(평면 m)와 사진 카메라. */
export type Photo = { at: number; phone: Vec2; look: Vec2; camera: CameraView };
const table = map.surface_fronts.find((f) => f.surface_id.startsWith("dining_table"))!,
  sink = map.surface_fronts.find((f) => f.surface_id.startsWith("sink_counter"))!;
const cupId = "cup_1",
  tvId = "tv_62442cb3",
  fridgeId = "fridge_bbc363a3";
const tasks = tasksFor("noonchi"),
  epoch = { boot: "composed", home: "mokryeon_180b#1" };
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
let raw = readFileSync(new URL("../fixtures/scenario1/judgment-composed.ndjson", import.meta.url), "utf8")
  .trim()
  .split(/\r?\n/)
  .map((s) => JSON.parse(s));
if (raw[0].kind !== "metadata" || !raw[0].name.includes("composed"))
  throw new Error("합성 자료 머리말이 없습니다.");
/** 합성 기록을 만드는 scripts/scenario1-compose.ts가 만든 줄로 바꿔 재생한다(시험은 쓰지 않는다: 시험은 기록 파일만 읽는다). */
export function useComposedRows(rows: Record<string, unknown>[]): void {
  if (rows[0]?.kind !== "metadata") throw new Error("합성 자료 머리말이 없습니다.");
  raw = rows as typeof raw;
}
/** 폰이 그 자리들을 차례로 걸을 때 구간마다 걷는 시간(ms): 안내 길(문·경유점)을 영상 모드 걷기 빠르기로(합성 기록 도착 검사와 같은 셈). 첫 자리는 처음 선 곳. */
export function composedWalkMs(values: readonly string[]): number[] {
  const legs = legsOf(values.map((value, i) => ({ at: i, value })));
  return legs.slice(1).map((l) => Math.ceil(pathLength(l.path) / WALK_MPS * 1000));
}
/** 재생 뒤(합성 기록 검사 전) 본 것: 차례(trace), 폰에 보낸 가기 명령, 틱마다 빠른 VLM 간격(fast). 시각은 합성 기록 ms. */
export type ReplaySeen = { trace: ScenarioEvent[]; goes: { at: number; target: string }[]; fastAt: [number, boolean][] };
const frames: { frame: string; scene: SceneObservation; view: CameraView }[] = JSON.parse(
  readFileSync(new URL("../fixtures/replay/wide-mug-v1.json", import.meta.url), "utf8"),
);
/** 폰이 선 자리(eye 줄 값): 관찰 자리, 식탁 앞(table), 싱크대 앞(sink)과 그 자리의 바라볼 곳. */
function spotOf(value: string | undefined): { position: Vec2; look: Vec2 } {
  const front = value === "table" ? table : value === "sink" ? sink : null;
  const s = front ?? map.stations.find((s) => s.id === value);
  if (!s) throw Error("없는 폰 자리 " + value);
  return { position: s.position, look: s.look_at };
}
/** 그 자리에서 바라볼 곳을 비추는 폰의 카메라. */
export function phoneCamera(value: string | undefined): CameraView {
  const { position, look } = spotOf(value);
  return cameraAt(position, look);
}
type Stop = { at: number; value: string; depart?: number };
/** t(합성 기록 ms)에 폰이 있는 자리와 보는 곳. 다음 도착 줄의 출발(depart)부터 도착까지는 앞 자리에서 안내 길을 따라 같은 빠르기로 걸으며
 *  다음 경유점 쪽을 본다(영상 모드 followGuide처럼). 서 있을 때는 그 자리의 바라볼 곳을 본다. */
type Leg = { from:Vec2; target:Vec2; end:Vec2; path:Vec2[] };
const preparedLegs = new WeakMap<readonly Stop[],Leg[]>();
function legsOf(stops:readonly Stop[]):Leg[] {
  const prepared=preparedLegs.get(stops);
  if (prepared) return prepared;
  let from=spotOf(stops[0]!.value).position;
  const legs:Leg[]=[];
  for (const s of stops) {
    const target=spotOf(s.value).position;
    const path=[...(pathBetween(from,target) ?? [from,target])];
    const front=s.value==="table"?table:s.value==="sink"?sink:null;
    const last=path.at(-2);
    let end=target;
    if (last && front) {
      // 가구 앞에서는 도착 반경에 들어서서 멈춘다. 다음 명령으로 바뀐 뒤 설 자리 중심까지 계속 걷지 않는다.
      const length=Math.hypot(last[0]-target[0],last[1]-target[1]);
      const k=length ? Math.min(1,(front.near_m-0.001)/length) : 0;
      end=[target[0]+(last[0]-target[0])*k,target[1]+(last[1]-target[1])*k];
      path[path.length-1]=end;
    }
    legs.push({from,target,end,path});
    from=end;
  }
  preparedLegs.set(stops,legs);
  return legs;
}
function phoneAt(stops: readonly Stop[], t: number): { position: Vec2; look: Vec2 } {
  const i=Math.max(0,stops.findLastIndex(s=>s.at<=t));
  const next=stops[i+1], legs=legsOf(stops);
  if (next?.depart !== undefined && t >= next.depart) {
    const path=legs[i+1]!.path;
    let left=pathLength(path)*Math.min(1,(t-next.depart)/Math.max(1,next.at-next.depart));
    for (let j=1;j<path.length;j++) {
      const a=path[j-1]!, b=path[j]!, d=Math.hypot(b[0]-a[0],b[1]-a[1]);
      if (left<=d || j===path.length-1) {
        const f=d ? Math.min(1,left/d) : 1;
        return {position:[a[0]+(b[0]-a[0])*f,a[1]+(b[1]-a[1])*f],look:b};
      }
      left-=d;
    }
  }
  return {position:legs[i]!.end,look:spotOf(stops[i]!.value).look};
}
const base = Date.UTC(2026, 10, 20, 12);
/** 재생 길이(ms): 100초, 기록 마지막 줄이 그보다 늦으면 그 5초 뒤까지. */
const replayMs = () => Math.max(100000, ...raw.filter((r) => Number.isFinite(r.at)).map((r) => r.at + 5000));
/** 그 변형의 합성 기록 줄(시각이 있는 줄, 변형 줄로 바꾼 뒤). 차례는 파일 차례다. */
export function variantLines(variant: Variant): Line[] {
  const patch = raw.find((row) => row.kind === "variant" && row.name === variant);
  const source: Line[] = raw.filter(
    // 변형은 replace_from부터(replace_until이 있으면 그 전까지만) 원래 줄을 그 변형 줄로 바꾼다
    (row) => Number.isFinite(row.at) && !(row.at >= (patch?.replace_from ?? Infinity) && row.at < (patch?.replace_until ?? Infinity)),
  );
  for (const r of patch?.rows ?? []) source.push({ ...r, source: patch.source });
  return source;
}
function makeBag(bag: Bag, variant: Variant): {
  left: number | null;
  photos: Photo[];
  arrivals: { at: number; value: string; depart?: number }[];
  states: { at: number; rev: number; serial: number | null }[];
} {
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
    serial = 0,
    /** 마지막으로 /world/household_photo로 낸 집 사진 serial. */
    sentPhoto = 0;
  function put<N extends TopicName>(topic: N, node: Envelope<N>["header"]["node"], body: Body<N>, at: number) {
    bag.write(
      { topic, key: "_", header: { node, seq: ++seq, stamp: at, inst: "composed-1", ...epoch }, body },
      at,
    );
  }
  // rev는 집 상태가 바뀐 변화(물건·사람 보임·방·하는 일·가전)가 있을 때만 오른다(src/world/node.ts emit). 사진·폰 눈만 바뀐 상태는 같은 rev로 낸다
  let lastSig = "";
  const states: { at: number; rev: number; serial: number | null }[] = [];
  const publishState = (at: number) => {
    const sig = JSON.stringify([
      world.objects.map((o) => [o.id, o.status, o.surface, o.surface_part ?? null, o.facts.place?.value ?? null]),
      [world.person.visible, world.person.count, world.person.room, world.person.facts.activity?.value ?? null],
      world.devices.map((d) => [d.id, d.state]),
    ]);
    if (sig !== lastSig) {
      rev++;
      lastSig = sig;
    }
    put("/world/state", "world", { rev, view: world }, at);
    states.push({ at, rev, serial: world.household_photo?.serial ?? null });
  };
  const source = variantLines(variant);
  // 실제 폰은 자세를 100ms마다 보낸다(ui/src/phone/core/ar.js SEND_MS): 서 있으면 그 자리, 걷는 동안은 걷는 자리(phoneAt)
  const eyes = source.filter((r) => r.kind === "eye").sort((a, b) => a.at - b.at);
  const stops: Stop[] = eyes.map((e) => ({ at: e.at, value: e.value!, ...(e.depart !== undefined ? { depart: e.depart } : {}) }));
  const eyeAt = new Set(eyes.map((e) => e.at));
  const REPLAY_MS = replayMs();
  for (let t = (eyes[0]?.at ?? 0) + POSE_MS; t < REPLAY_MS; t += POSE_MS)
    if (!eyeAt.has(t)) source.push({ at: t, kind: "pose", source: "composed phone pose stream" });
  // 집 상태 노드는 바뀐 것이 없어도 WORLD_TICK_MS(250ms)마다 같은 rev로 상태를 다시 낸다(src/world/node.ts): 그때 폰 눈이 새것이다
  for (let t = 0; t < REPLAY_MS; t += WORLD_TICK_MS) source.push({ at: t, kind: "tick", source: "world node 250 ms republish" });
  let left: number | null = null;
  const photos: Photo[] = [];
  // YOLO 프레임(100ms마다, 지연 없음): 줄이 말하는 사람이 그 촬영 시각부터 다음 줄까지 그 자리에 있거나 없다.
  // 떠남 줄(left)은 자리를 뜬 때라 아직 화면 안을 걷는다: 화면에서 사라진 때는 그 뒤 첫 빈 사진의 촬영 시각으로 둔다
  // 집 상태 노드는 사람이 있던 자리(발 자리)가 화면 안인데 사용자를 못 본 구간을 World State 사람의 vacant로 낸다(src/world/state/objects.ts)
  const presence = source.filter((r) => ["tv", "table", "fridge", "away"].includes(r.kind)).sort((a, b) => a.at - b.at)
    .map((r) => ({ at: r.at, there: r.kind !== "away" && r.value !== "empty" }));
  const vacantSince = (t: number): number | null => {
    let since: number | null = null;
    for (const e of presence) {
      if (e.at > t) break;
      since = e.there ? null : since ?? e.at;
    }
    return since;
  };
  const yoloVacancy = (t: number) => {
    const since = vacantSince(t), p = world.person.position;
    if (since === null || !p) return undefined;
    const phone = phoneAt(stops, t);
    return inView(cameraAt(phone.position, phone.look), [p[0], 0.9, p[1]]) ? { since_ms: base + since, position: p, room: world.person.room } : undefined;
  };
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
    if (r.kind === "pose") {
      put("/phone/pose", "phone", { quality: "usable", position: phoneAt(stops, r.at).position, pose_gen: 1, observed_ms: at }, at);
      continue;
    }
    // World State의 폰 눈: 그때 폰 자리와 보는 쪽
    const eyeOf = (t: number) => {
      const { position, look } = phoneAt(stops, t);
      return {
        position,
        room: roomAt(floor, position),
        room_label: null,
        at_ms: base + t,
        height_m: PHONE.heightM,
        // 평면 x축에서 잰 보는 쪽 각(src/shared/geometry.ts toTwin과 같은 규칙, 0~360)
        yaw_deg: ((Math.atan2(look[1] - position[1], look[0] - position[0]) * 180) / Math.PI + 360) % 360,
        pitch_deg: PHONE.pitchDeg,
      };
    };
    if (r.kind === "tick") {
      world.eye = eyeOf(r.at);
      world.at_ms = at;
      world.frame_ms = at;
      world.person = { ...world.person, vacant: yoloVacancy(r.at) };
      publishState(at);
      continue;
    }
    if (r.kind === "eye") {
      const pos = phoneAt(stops, r.at).position;
      world.eye = eyeOf(r.at);
      world.at_ms = at;
      world.frame_ms = at;
      publishState(at);
      // 도착한 자세 하나, 그 뒤는 100ms마다(아래 자세 줄): 실제 폰보다 빨리 도착을 확인하지 않게
      put("/phone/pose", "phone", { quality: "usable", position: pos, pose_gen: 1, observed_ms: at }, at);
      continue;
    }
    if (r.kind === "pam") {
      const parsed = parsePrediction(JSON.stringify(r.response), tasks, {
        memory: LEARNED_FSM_MEMORY,
        lastState: "drinking",
      });
      if (!parsed.prediction) throw Error(parsed.errors.join(" "));
      // 한 재생에 PAM 줄이 여럿일 수 있다(변형 pam_seated): 줄 시각으로 판단마다 다른 id·차례 번호
      const d: DecisionRecord = {
        id: `pam:${r.at}`,
        seq: r.at,
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
    if (["fridge", "table", "away", "tv"].includes(r.kind)) {
      // 답 지연은 실제 VLM 범위 안이어야 한다: 1초 미만(촬영 순간 도착 포함)이나 시간 초과(VLM_TIMEOUT_MS) 넘음은 실제로 오지 않는 답이다
      if (!(typeof r.lag === "number" && r.lag >= VLM_LAG_MIN_MS && r.lag <= OBSERVE.vlmTimeoutMs))
        throw Error(`합성 기록 사진 ${r.at}ms의 VLM 답 지연(lag ${r.lag})이 ${VLM_LAG_MIN_MS}~${OBSERVE.vlmTimeoutMs}ms 밖입니다.`);
      // 줄은 집에서 실제로 일어난 일(사람·컵 자리)이고, 사진에는 그때 폰 카메라 화면 안에 든 것만 찍힌다
      const phone = phoneAt(stops, r.at);
      const camera = cameraAt(phone.position, phone.look);
      const seen = (p: Vec2, h: number) => inView(camera, [p[0], h, p[1]]);
      photos.push({ at, phone: phone.position, look: phone.look, camera });
      world.eye = eyeOf(r.at);
      const record = r.frame ? frames.find((f) => f.frame === r.frame) : null;
      if (r.frame && !record) throw Error("없는 녹화 장 " + r.frame);
      const facts = record?.scene.observations ?? [];
      const place = facts.find(
        (o) => o.object_id === "v1" && ["on_table", "in_hand", "in_sink"].includes(o.state),
      )?.state;
      const dining = r.kind === "table",
        zone = dining ? "dining_seat" : r.kind === "fridge" ? "fridge_front" : "sofa_watch",
        pos = center(zone),
        room = map.zones.find((z) => z.id === zone)!.room,
        there = r.kind !== "away" && r.value !== "empty",
        // 발 자리는 발이 화면 아래 끝보다 위에 보일 때만 안다(아니면 사진에는 사람 수만)
        sight = personSight(camera, pos),
        visible = there && sight.visible,
        located = there && sight.located,
        seated = r.value !== "standing" && r.kind !== "fridge";
      if (place) {
        const onSink = place === "in_sink",
          held = place === "in_hand",
          front = onSink ? sink : table;
        // 손에 든 컵은 폰을 든 사람이 카메라 앞에 들어 올린 자리, 아니면 그 면 위. 그 자리가 화면 안이어야 사진에 찍힌다
        const spot: [number, number, number] = held ? heldCupAt(phone) : [front.look_at[0], 0.8, front.look_at[1]];
        if (seen([spot[0], spot[2]], spot[1])) {
          const cup: WorldObject = {
            id: cupId,
            cls: "cup",
            position: spot,
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
      }
      const was = world.person.visible;
      const observedDrink = facts.some((f) => f.object_id === "d1" && f.state === "drinking");
      // 식탁 줄 값 resting: 컵을 내려놓고 앉아 쉬는 사람(VLM 「쉬거나 자는 중」, 2026-11-25 예시 녹화)
      const activity = dining
        ? r.value === "resting"
          ? "resting"
          : observedDrink
          ? "drinking"
          : world.person.facts.activity?.value
        : r.kind === "tv"
        ? "watching_tv"
        : undefined;
      world.person = {
        ...world.person,
        answered_ms: visible ? at : null,
        visible,
        count: visible ? 1 : 0,
        since_ms: was === visible ? world.person.since_ms : at,
        last_seen_ms: visible ? at : world.person.last_seen_ms,
        // 방·발 자리는 발이 보일 때만 바뀐다. 안 보여도 마지막으로 본 발 자리와 그 방·시각을 남긴다(src/contract/world.ts WorldPerson)
        room: located ? room : world.person.room,
        room_label: located ? (room === "kitchen" ? "주방" : "거실") : world.person.room_label,
        position: located ? pos : world.person.position,
        position_ms: located ? at : world.person.position_ms,
        holding: [],
        facts: visible && activity ? { activity: fact(activity, at) } : {},
      };
      // 합성 VLM 근거: 배치된 가전 가운데가 그 촬영의 화면에 들어올 때만 같은 촬영 시각의 설비 사실을 넣는다.
      world.fixtures = [];
      for (const [id,cls,facet,value] of [[fridgeId,"refrigerator","open",fridge.state.includes("door_open") ? "open" : "closed"],[tvId,"tv","screen","screen_on"]] as const) {
        const place = floor.objects.get(id);
        if (!place || !seen(place.position, 1)) continue;
        world.fixtures.push({id:cls+"_"+place.room, cls, room:place.room,room_label:null,device:id,
          first_seen_ms:at,last_seen_ms:at,answered_ms:at,facts:{[facet]:fact(value,at)}});
      }
      const table_ = table.look_at;
      world.household_photo = {
        serial: ++serial,
        id: "photo-" + serial,
        at_ms: at,
        answered_ms: arrive,
        proof: {
          camera,
          seats: "clear",
          person_count: visible ? 1 : 0,
          dining_food: dining && seen(table_, 0.8) ? "yes" : "unknown",
          person: located ? { room, position: pos, seated, attention: dining ? "elsewhere" : r.kind === "tv" ? "toward_tv" : "unknown" } : null,
        },
      };
      // 사람 자취(person_trail): 한 사람의 발이 보인 사진의 자리만 마지막 둘까지 남는다(src/world/state/people.ts)
      if (located) world.person_trail = [...(world.person_trail ?? []).slice(-1), { room, position: pos, at_ms: at }];
    }
    // 상태를 내는 때(답이 들어온 때)의 폰 눈과 엔진 프레임(엔진 프레임은 100ms마다라 거의 지금이다)
    world.eye = eyeOf(arrival(r));
    world.at_ms = arrive;
    world.frame_ms = arrive;
    // 집 상태 노드는 새 집 사진마다 그 사진을 /world/household_photo(RELIABLE)로도 낸다(src/world/node.ts)
    if (world.household_photo && world.household_photo.serial !== sentPhoto) {
      sentPhoto = world.household_photo.serial;
      put("/world/household_photo", "world", { photo: structuredClone(world.household_photo) }, arrive);
    }
    publishState(arrive);
  }
  return { left, photos, states, arrivals: stops.map((e) => ({ at: base + e.at, value: e.value, ...(e.depart !== undefined ? { depart: base + e.depart } : {}) })) };
}

/** 그 변형의 합성 기록으로 낸 World State(낸 때, rev, 집 사진 번호). */
export function composedStates(variant: Variant) {
  return makeBag(Bag.open(":memory:"), variant).states;
}
/** 그 변형의 합성 기록으로 만든 사진들(촬영 시각·폰 자리·카메라). */
export function composedPhotos(variant: Variant): Photo[] {
  return makeBag(Bag.open(":memory:"), variant).photos;
}

export async function replayScenario(
  variant: Variant,
  recording?: (v: ReturnType<LiveScenario["judge"]>) => void,
  worldReceived?: (at: number, rev: number, power: string) => void,
  seen?: (s: ReplaySeen) => void,
): Promise<ScenarioEvent[]> {
  const bag = Bag.open(":memory:"),
    trace: ScenarioEvent[] = [];
  const db = HistoryDb.open(":memory:"),
    live = new LiveScenario(scene);
  const received: PlannedCommand[] = [];
  /** 폰에 보낸 가기 명령(보낸 시각, 목적지 id). */
  const goes: { at: number; target: string; key:string; index:number; guide: PlannedCommand["guide"] | null }[] = [];
  const updates: {at:number; key:string|null; guide:PlannedCommand["guide"]|null}[]=[];
  let walking: {id:string;key:string} | null=null;
  let resolveDecision: (d: DecisionRecord) => DecisionRecord = (d) => d;
  // 녹화한 World State의 TV 전원은 재생 중 허브 전원을 따른다(실제 집 상태 노드는 /device/changes로 기기 상태를 바꾼다)
  let powerNow: "on" | "off" = "on";
  let powerRev = 0;
  const powerHistory: {at: number; power:"on" | "off"}[] = [];
  let lastRecorded: {view:WorldView; rev:number} | null = null;
  const mappedRevs = new Map<number,number>();
  function withPower(view:WorldView, rev:number): Body<"/world/state"> {
    const fixtures = view.fixtures.map(f => {
      if (f.device !== tvId || !f.facts.screen) return f;
      const at = f.facts.screen.at_ms;
      const power = powerHistory.findLast(change => change.at <= at)?.power ?? "on";
      return {...f, facts:{...f.facts, screen:{...f.facts.screen, value:power === "on" ? "screen_on" : "screen_off"}}};
    });
    return {rev:rev + powerRev, view:{...view, fixtures, devices:view.devices.map(d => d.id === tvId ?
      {...d,state:[powerNow],status:powerNow === "on" ? "켜짐" : "꺼짐"} : d)}};
  }
  // 재생 틱마다 그때 관찰 흐름이 VLM 사진 간격을 1초로 줄일지(vlmFast)를 남긴다
  const fastAt: [number, boolean][] = [];
  try {
    const { left, photos, arrivals } = makeBag(bag, variant);
    if (raw[0].learned_discard) db.cupAnswers.seedDemo(raw[0].home);
    await replay({
      bag,
      resolveDecision: (d) => resolveDecision(d.request_rev == null ? d : {...d, request_rev:mappedRevs.get(d.request_rev) ?? d.request_rev}),
      resolveWorld: (view, rev) => {
        lastRecorded = {view,rev};
        mappedRevs.set(rev, rev + powerRev);
        return withPower(view, rev);
      },
      from: base,
      to: base + replayMs(),
      topics: ["/world/state", "/world/household_photo", "/brain/decision", "/phone/pose", "/device/changes"],
      launch: async (bus, clock) => {
        const node = (name: "manager" | "act" | "devices" | "recorder" | "world") =>
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
          manager = node("manager");
        const device = node("devices"),
          recorder = node("recorder"), worldNode = node("world");
        const worldOut = new Outbox(worldNode, {clock, log:m=>{throw Error(m);}});
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
        const triggers = new GoalTriggers(locateZone, () => 0, VLM_STEP_MS);
        // 재생 기록(trace)의 빈 구역·돌아옴만 보는 따로 된 계기(시스템 계기의 상태를 건드리지 않는다)
        const seenZone = new GoalTriggers(locateZone, () => 0, VLM_STEP_MS);
        managerRoutes(manager, clock);
        let world: WorldView,
          rev = 0,
          facts: TriggerFacts | null = null;
        // 목표 노드: 실제 서버와 같은 src/goal/start.ts(World State 구독 노드에서 250ms 타이머·새 rev마다 조건 사실 → TV 규칙 → 사용자 찾기)
        const goalNode = await startGoalNode({
          bus,
          epoch,
          clock,
          log: (m) => {
            throw Error(m);
          },
          triggers,
          portals: floor.portals,
          dayOf: (ms) => calendarDay(ms, 540),
          map: () => map,
          viewers: () => [tvId],
          // src/server/home/act.ts goals.publish의 checkingVisit와 같은 값
          checking: () => {
            const g = tracker.goal();
            return g?.status === "checking" && g.meal && g.object && g.checking_ms != null && g.check_until_ms != null
              ? { id: g.id, since: g.checking_ms, until: g.check_until_ms, cup: g.object, surface: g.meal.surface }
              : null;
          },
          onFacts: (f) => {
            facts = f;
          },
          afterTick: () => {
            if (world) tracker.updateGoal();
          },
        });
        const tv = goalNode.tv;
        const hub = new SignalHub(new MemoryHub([tvSpec], { [tvId]: { power: "on" } }));
        const power = () => hub.powerStamp(tvId)!;
        tv.observe(tvId, power());
        // src/server/home/observe.ts처럼 기기 상태가 바뀔 때마다 지금 전원 기록을 TV 규칙에 알린다(/device/changes note.power).
        // 구독이 있어야 허브가 직접 끈 전원도 기록한다(src/devices/hub/signals.ts emit).
        hub.subscribe(s => {
          const stamp = hub.powerStamp(s.id)!;
          tv.observe(s.id, stamp);
          if (s.id !== tvId || stamp.power === powerNow) return;
          powerNow = stamp.power === "on" ? "on" : "off";
          powerHistory.push({at:clock.now(), power:powerNow});
          powerRev++;
          if (lastRecorded) worldOut.push("/world/state",withPower({...lastRecorded.view,at_ms:clock.now()},lastRecorded.rev));
        });
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
        const walk = walkMap;
        const station = (id: string) => {
          const s = map.stations.find((s) => s.id === id);
          return s
            ? {
                id,
                label: s.name,
                position: [s.position[0], 0, s.position[1]] as [number, number, number],
                look: {
                  label: map.zones.filter((z) => s.observes_zone_ids.includes(z.id)).map((z) => z.name).join("·") || null,
                  position: [s.look_at[0], LOOK_HEIGHT_M, s.look_at[1]] as [number, number, number],
                },
              }
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
            goalNode.out.push("/brain/goal_changes", { goal: g });
            if (g.status === "armed" && g.prep === "ready") add("ready", g.object ?? "");
            if (g.status === "checking") add("checking", g.object ?? "");
            if (g.reason === "back") add("back");
          },
          toPhone: (m) => {
            out.push("/act/phone_changes", { cmd: m });
            if (m.type === "command_clear") {
              if (walking && (m.id === undefined || m.id === walking.id)) {
                updates.push({at:clock.now(),key:null,guide:null});
                walking=null;
              }
              return;
            }
            if (m.type !== "command") return;
            const walkKey=JSON.stringify([m.id,m.step]);
            const next=m.kind==="go" ? {id:m.id,key:walkKey} : null;
            if (next || walking) updates.push({at:clock.now(),key:next?.key??null,guide:next?m.guide??null:null});
            walking=next;
            received.push(m);
            const key = JSON.stringify([m.id, m.step]);
            if (heard.has(key)) return;
            heard.add(key);
            // 같은 명령을 안내만 바꿔 다시 보낸 것은 새 명령이 아니다
            if (m.kind === "go" && m.target?.id) goes.push({ at: clock.now(), target: m.target.id, key, index:updates.length, guide: m.guide ?? null });
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
        // 빈 구간 근거를 넣은 촬영·프레임 시각: 돌아옴은 그 뒤에 찍힌 앉아 보는 사진이어야 한다(YOLO 근거면 늦게 온 앞 사진이 아직 앉아 봄이다)
        let emptyAt = Infinity;
        let firstEmpty = false,
          emptySince: number | null = null;
        const tick = () => {
          if (!world) return;
          const now = clock.now();
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
          // 실제 act 노드(World State 구독 노드 startWorldMirror)는 새 rev에만 판단을 돌린다. 같은 rev로 다시 낸 상태는 보기만 새로 한다(250ms 틱이 돈다)
          const fresh = next !== rev || world === undefined;
          world = view;
          rev = next;
          live.sample(view);
          worldReceived?.(clock.now()-base,next,view.devices.find(d=>d.id===tvId)!.state[0]!);
          // 빈 시청 구역은 그 구역 전체가 보이는 사진에서만 안다(TV 규칙과 같은 사실). 빈 구간 첫 촬영(empty)과
          // 그 구간이 NO_VIEWER_MS 이어진 촬영(vacant)을 촬영 시각 자리에 넣는다
          const zone = seenZone.evaluateTriggers(view, next, map, clock.now());
          const shot = view.household_photo?.at_ms;
          const atShot = (kind: ScenarioEvent["kind"], t: number, by?: "yolo") => {
            const i = trace.findIndex((x) => x.at > t - base);
            trace.splice(i < 0 ? trace.length : i, 0, { kind, at: t - base, id: tvId, ...(by ? { by } : {}) });
          };
          // YOLO 근거(TV 규칙과 같은 사실 yoloVacant): 시청 자리에 있던 사용자를 못 본 구간의 시작(empty)과 YOLO_NO_VIEWER_MS를 넘긴 엔진 프레임(vacant)
          const yolo = zone.yoloVacant?.("living", YOLO_NO_VIEWER_MS) ?? null;
          if (!firstEmpty && yolo !== null && view.person.vacant && trace.some((e) => e.kind === "watch")) {
            atShot("empty", view.person.vacant.since_ms, "yolo");
            atShot("vacant", yolo, "yolo");
            firstEmpty = true;
            emptyAt = yolo;
          }
          const vacancy = zone.read({ kind: "noViewer", room: "living", ms: 0 });
          if (vacancy.value !== true) emptySince = null;
          else if (emptySince === null && shot !== undefined) emptySince = shot;
          if (!firstEmpty && emptySince !== null && shot !== undefined && trace.some((e) => e.kind === "watch") &&
            zone.read({ kind: "noViewer", room: "living", ms: NO_VIEWER_MS }).value === true) {
            atShot("empty", emptySince);
            atShot("vacant", shot);
            firstEmpty = true;
            emptyAt = shot;
          }
          if (firstEmpty && shot !== undefined && shot > emptyAt && zone.read({ kind: "postureAttention", target: tvId, posture: "seated" }).value === true && !trace.some((e) => e.kind === "viewer_returned"))
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
          if (!fresh) return;
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
        return [manager, goalNode.mirror.node, act, device, recorder, worldNode];
      },
    });
    seen?.({ trace: [...trace], goes: goes.map((g) => ({ at: g.at - base, target: g.target })), fastAt: fastAt.map(([t, f]): [number, boolean] => [t - base, f]) });
    // 합성 기록이 실제와 어긋난 곳을 모아 가장 이른 것을 알린다(뒤의 어긋남은 앞 어긋남 때문에 생길 수 있다)
    const wrong: { at: number; text: string }[] = [];
    // 폰은 그 자리로 보낸 가기 명령을 받은 뒤 출발(depart)하고, 앞 자리에서 안내 길로 걸어도 걸리는 시간(영상 모드 걷기 초당 WALK_MPS) 뒤에 도착한다(첫 자리는 처음 선 곳)
    const legs = legsOf(arrivals);
    arrivals.forEach((e, i) => {
      if (i === 0) return;
      const prev = arrivals[i - 1]!;
      const target = e.value === "table" ? table.surface_id : e.value === "sink" ? sink.surface_id : e.value;
      // 안내 길(문·경유점)을 따라 걷는 길이
      const {from,target:to,path} = legs[i]!;
      const walkMs = Math.ceil(pathLength(path) / WALK_MPS * 1000);
      // 앞 걷기를 시작한 뒤 보낸 명령만 이 걷기의 명령이다(같은 자리로 갔던 옛 명령이 아니다)
      const since = prev.depart ?? prev.at;
      const sent = e.depart === undefined ? undefined : goes.filter((g) => g.target === target && g.at > since && g.at <= e.depart!).at(-1);
      if (e.depart === undefined || !sent || e.depart < sent.at + 1500 || e.at - e.depart < walkMs)
        wrong.push({
          at: e.depart ?? e.at,
          text:
            `합성 기록 폰 출발 ${e.depart === undefined ? "없음" : e.depart - base + "ms"}·도착 ${e.at - base}ms(${e.value})가 ` +
            `가기 명령(${sent ? sent.at - base + "ms" : "없음"}) 뒤 출발, 걷는 시간 ${walkMs}ms 뒤 도착이 아닙니다. ` +
            `보낸 가기 명령: ${goes.map((g) => `${g.target}@${g.at - base}`).join(", ")}`,
        });
      // 폰은 그 명령이 보낸 안내 길(문·경유점)을 걷는다: 안내가 없거나(보류) 걸은 길과 다르면 벽을 지나간 걸음일 수 있다
      const changes = sent ? updates.slice(sent.index).filter(u => u.at < e.at)
        .map(u=>({at:u.at,remaining:u.key === sent.key ? u.guide : null})) : [];
      const walk = sent ? walkProblem(from, to, sent.guide, changes, e.depart, e.at, pathLength(path)) : null;
      if (walk) wrong.push({ at: e.depart ?? e.at, text: `합성 기록 폰이 ${e.value}까지 걸은 길이 가기 명령(${sent!.at - base}ms)의 안내 길과 다릅니다: ${walk}.` });
    });
    // 사진은 앞 사진 뒤 실제 VLM 간격의 촬영이어야 한다(합성 기록이 시스템보다 자주·드물게 찍지 않게)
    const fastWhen = (t: number) => fastAt.findLast(([at]) => at <= t)?.[1] ?? false;
    const cadence = photos.findIndex((p, i) => i > 0 && p.at !== nextVlmCapture(photos[i - 1]!.at, fastWhen));
    if (cadence > 0) {
      const p = photos[cadence]!,
        prev = photos[cadence - 1]!,
        want = nextVlmCapture(prev.at, fastWhen);
      wrong.push({
        at: Math.min(p.at, want),
        text: `합성 기록 사진 ${p.at - base}ms가 VLM 간격과 다릅니다: 앞 사진 ${prev.at - base}ms 뒤 ${want - base}ms여야 합니다.`,
      });
    }
    const first = wrong.sort((a, b) => a.at - b.at)[0];
    if (first) throw Error(first.text);
    // 기록·촬영한 사람이 아는 떠난 때와, 시스템이 받은 사진에서 찾은 대기 전 끔→켬 근거를 차례 자리에 넣는다
    const insert = (e: ScenarioEvent) => {
      const i = trace.findIndex((x) => x.at > e.at);
      trace.splice(i < 0 ? trace.length : i, 0, e);
    };
    if (left !== null) insert({ kind: "left", at: left - base });
    const absolute = trace.map((e) => ({ ...e, at: e.at + base }));
    // 실영상 판정과 같이 기록 DB의 집 사진 줄로 매긴 뒤(judge) 그 사진으로 근거를 찾는다
    const verdict = live.judge(db.list({ limit: 5000 }), received, left);
    for (const e of earlyTvEvidence(absolute, live.photoSamples())) insert({ ...e, at: e.at - base });
    recording?.(verdict);
    return trace;
  } finally {
    db.close();
    bag.close();
  }
}
