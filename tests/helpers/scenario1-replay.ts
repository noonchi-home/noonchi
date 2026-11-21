// The bag stops at the judgment input boundary. Each line names its recorded or composed source.
// Recorded cup observations are looked up by original frame id; automatic phone/device outputs never enter the bag.
import { readFileSync } from "node:fs";
import { Outbox, BusNode, type Body, type Envelope, type TopicName } from "../../src/bus/index.js";
import { Bag, replay } from "../../src/record/index.js";
import { GoalTriggers, type TriggerFacts } from "../../src/goal/triggers.js";
import { FAST_VLM_MS, loadObserveConfig, vlmStepMs } from "../../src/observe/pipeline.js";
import { NO_VIEWER_MS, viewerAt } from "../../src/goal/tv-watch.js";
import { startGoalNode } from "../../src/goal/start.js";
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
import { roomAt } from "../../src/layout/route.js";
import { loadScene } from "../../src/layout/scene.js";
import { resolveHome } from "../../src/layout/homes.js";
import { DEFAULT_TWIN_DIR } from "../../src/layout/twin-files.js";
import { LOOK_HEIGHT_M, locateZone } from "../../src/layout/stations.js";
import { WorldState } from "../../src/world/index.js";
import { fsmStep } from "../../src/brain/decision.js";
import { parsePrediction } from "../../src/brain/pam/answer.js";
import { LEARNED_FSM_MEMORY } from "../../scripts/learned-memory.js";
import type { DecisionRecord } from "../../src/contract/events.js";
import type { DeviceSpec } from "../../src/contract/devices.js";
import type { WorldView, WorldDevice, WorldObject } from "../../src/contract/world.js";
import type { Vec2 } from "../../src/contract/layout.js";
import type { CameraView, SceneObservation } from "../../src/contract/observe.js";
import { inView, ndc } from "../../src/world/place.js";
import { projectionFromFov, yawPitchQuat } from "../../ui/src/phone/core/video-math.js";
import { testTracker } from "./tracker-ports.js";
import { planContext } from "./planner.js";
import { earlyTvEvidence, LiveScenario } from "../../scripts/scenario1-live.js";
import { HistoryDb } from "../../src/brain/history/db.js";
import { historyRoutes } from "../../src/record/history.js";
import type { PlannedCommand } from "../../src/contract/phone.js";
import type { ScenarioEvent } from "../../scripts/scenario1-judge.js";

type Variant = "normal" | "back" | "brief" | "manual" | "cadence_wrong" | "lag_missing" | "lag_zero" | "arrive_early";
/** at: 촬영(또는 사건) 시각. 사진 줄(fridge·table·away·tv)은 lag가 반드시 있고, VLM 답이 at + lag에 도착한다(집 상태가 그때 바뀐다).
 *  폰 도착 줄(eye)은 depart(그 자리로 걷기 시작한 때)를 싣는다(처음 선 자리는 없음). */
type Line = { at: number; kind: string; value?: string; frame?: string; response?: object; source: string; lag?: number; depart?: number };
/** 재생에 넣은 사진: 촬영 시각(절대 ms), 그때 폰 자리(평면 m)와 사진 카메라. */
export type Photo = { at: number; phone: Vec2; look: Vec2; camera: CameraView };
/** 목련 집 장면(평면도·관찰 자리). */
export const scene = loadScene(resolveHome(DEFAULT_TWIN_DIR, "mokryeon_180b"))!;
/** 목련 집 관찰 자리·구역(twin/data/homes/mokryeon_180b/stations.json). */
export const map = scene.stations,
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
const frames: { frame: string; scene: SceneObservation; view: CameraView }[] = JSON.parse(
  readFileSync(new URL("../fixtures/replay/wide-mug-v1.json", import.meta.url), "utf8"),
);
/** 폰 카메라: 가로 시험 영상(1920×1080)을 찍은 대로 세로 시야각 40°·16:9, 높이 1.15m, 10° 아래(영상 모드 주소 fov=40·pitch=-10·h=1.15).
 *  자리에 서면 그 자리의 바라볼 곳(look_at)을 비춘다. 녹화 장(wide-mug-v1)의 투영과 같아야 한다. */
const PHONE = { fovDeg: 40, aspect: 16 / 9, pitchDeg: -10, heightM: 1.15 },
  PHONE_PROJECTION = projectionFromFov(PHONE.fovDeg, PHONE.aspect);
if (frames[0]?.view.projection.some((v, i) => Math.abs(v - PHONE_PROJECTION[i]!) > 1e-9))
  throw Error("폰 카메라 투영이 녹화 장 투영과 다릅니다.");
/** 사진에 사람이 찍히는 높이(m): 앉은 사람의 몸통. 이 점이 화면 안이어야 사진에 사람이 있다(사람 수). */
const PERSON_M = 0.9;
/** 발 자리는 발(바닥 점)이 화면 아래 끝 2%보다 위에 있어야 안다(src/world/state/people.ts FEET_EDGE 0.98 → NDC y −0.96). */
const FEET_NDC_Y = -0.96;
/** 손에 든 컵: 폰을 든 사람이 컵을 카메라 앞(수평 0.45m, 높이 0.95m)에 들어 올린다(손에 있음 녹화 장처럼). 이 점이 화면 안이어야 찍힌다. */
const HAND = { aheadM: 0.45, heightM: 0.95 };
/** 폰이 선 자리(eye 줄 값): 관찰 자리, 식탁 앞(table), 싱크대 앞(sink)과 그 자리의 바라볼 곳. */
function spotOf(value: string | undefined): { position: Vec2; look: Vec2 } {
  const front = value === "table" ? table : value === "sink" ? sink : null;
  const s = front ?? map.stations.find((s) => s.id === value);
  if (!s) throw Error("없는 폰 자리 " + value);
  return { position: s.position, look: s.look_at };
}
/** p에 서서 look 쪽을 보는 폰의 엔진 프레임 카메라(src/phone/session.ts viewAt과 같은 꼴, 트윈 좌표라 theta 0). */
function cameraAt(p: Vec2, look: Vec2): CameraView {
  const yaw = Math.atan2(-(look[0] - p[0]), -(look[1] - p[1]));
  return {
    origin: [p[0], PHONE.heightM, p[1]],
    orientation: yawPitchQuat(yaw, PHONE.pitchDeg),
    theta: 0,
    projection: [...PHONE_PROJECTION],
  };
}
/** 사람이 그 사진에 어떻게 찍히나: 몸통(PERSON_M)이 화면 안이면 보임(사람 수), 발(바닥 점)까지 화면 아래 끝보다 위에 보이면 발 자리·방도 안다. */
export function personSight(camera: CameraView, p: Vec2): { visible: boolean; located: boolean } {
  const visible = inView(camera, [p[0], PERSON_M, p[1]]);
  const n = ndc(camera, [p[0], 0, p[1]]);
  return { visible, located: visible && !!n && Math.abs(n[0]) <= 1 && n[1] >= FEET_NDC_Y && n[1] <= 1 };
}
/** 폰을 든 사람이 카메라 앞에 들어 올린 컵 자리(트윈 [x, 높이, y]): 폰 자리에서 보는 쪽으로 HAND.aheadM, 높이 HAND.heightM. */
export function heldCupAt(phone: { position: Vec2; look: Vec2 }): [number, number, number] {
  const dx = phone.look[0] - phone.position[0],
    dz = phone.look[1] - phone.position[1],
    d = Math.hypot(dx, dz) || 1;
  return [phone.position[0] + (dx / d) * HAND.aheadM, HAND.heightM, phone.position[1] + (dz / d) * HAND.aheadM];
}
/** 그 자리에서 바라볼 곳을 비추는 폰의 카메라. */
export function phoneCamera(value: string | undefined): CameraView {
  const { position, look } = spotOf(value);
  return cameraAt(position, look);
}
type Stop = { at: number; value: string; depart?: number };
/** 앞 자리에서 다음 자리까지 걷는 길: 시스템이 폰에 보내는 안내 길(src/layout/walk-guide.ts plan, 문·경유점)과 같다. 길이 없으면 곧게. */
const walkMap = walkingMap(floor, scene);
function pathBetween(a: Vec2, b: Vec2): Vec2[] {
  const guide = walkMap.plan(a, b, 0.5, true);
  return guide ? [a, ...guide.remaining.map((p) => [p.position[0], p.position[2]] as Vec2)] : [a, b];
}
const pathLength = (path: readonly Vec2[]) => path.slice(1).reduce((sum, p, i) => sum + Math.hypot(p[0] - path[i]![0], p[1] - path[i]![1]), 0);
/** t(합성 기록 ms)에 폰이 있는 자리와 보는 곳. 다음 도착 줄의 출발(depart)부터 도착까지는 앞 자리에서 안내 길을 따라 같은 빠르기로 걸으며
 *  다음 경유점 쪽을 본다(영상 모드 followGuide처럼). 서 있을 때는 그 자리의 바라볼 곳을 본다. */
function phoneAt(stops: readonly Stop[], t: number): { position: Vec2; look: Vec2 } {
  const i = Math.max(0, stops.findLastIndex((s) => s.at <= t));
  const here = stops[i]!,
    next = stops[i + 1];
  if (next?.depart !== undefined && t >= next.depart) {
    const path = pathBetween(spotOf(here.value).position, spotOf(next.value).position);
    const k = next.at > next.depart ? Math.min(1, (t - next.depart) / (next.at - next.depart)) : 1;
    let left = pathLength(path) * k;
    for (let j = 1; j < path.length; j++) {
      const a = path[j - 1]!,
        b = path[j]!,
        d = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (left <= d || j === path.length - 1) {
        const f = d > 0 ? Math.min(1, left / d) : 1;
        return { position: [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f], look: f < 1 ? b : path.at(-1)! };
      }
      left -= d;
    }
  }
  return spotOf(here.value);
}
const base = Date.UTC(2026, 10, 20, 12);
/** 재생 길이(ms)와 폰 자세 간격(ms, ui/src/phone/core/ar.js SEND_MS). */
const REPLAY_MS = 100000,
  POSE_MS = 100,
  /** 폰을 든 사람의 걷기(m/s, ui/src/phone/core/video-ar.js WALK_MPS). */
  WALK_MPS = 0.8;
function makeBag(bag: Bag, variant: Variant): { left: number | null; photos: Photo[]; arrivals: { at: number; value: string; depart?: number }[] } {
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
  const patch = raw.find((row) => row.kind === "variant" && row.name === variant);
  const source: Line[] = raw.filter(
    (row) => Number.isFinite(row.at) && row.at < (patch?.replace_from ?? Infinity),
  );
  for (const r of patch?.rows ?? []) source.push({ ...r, source: patch.source });
  // 실제 폰은 자세를 100ms마다 보낸다(ui/src/phone/core/ar.js SEND_MS): 서 있으면 그 자리, 걷는 동안은 걷는 자리(phoneAt)
  const eyes = source.filter((r) => r.kind === "eye").sort((a, b) => a.at - b.at);
  const stops: Stop[] = eyes.map((e) => ({ at: e.at, value: e.value!, ...(e.depart !== undefined ? { depart: e.depart } : {}) }));
  const eyeAt = new Set(eyes.map((e) => e.at));
  for (let t = (eyes[0]?.at ?? 0) + POSE_MS; t < REPLAY_MS; t += POSE_MS)
    if (!eyeAt.has(t)) source.push({ at: t, kind: "pose", source: "composed phone pose stream" });
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
    if (r.kind === "eye") {
      const pos = spotOf(r.value).position;
      world.eye = eyeOf(r.at);
      world.at_ms = at;
      put("/world/state", "world", { rev: ++rev, view: world }, at);
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
      const activity = dining
        ? observedDrink
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
    world.at_ms = arrive;
    world.frame_ms = at;
    // 집 상태 노드는 새 집 사진마다 그 사진을 /world/household_photo(RELIABLE)로도 낸다(src/world/node.ts)
    if (world.household_photo && world.household_photo.serial !== sentPhoto) {
      sentPhoto = world.household_photo.serial;
      put("/world/household_photo", "world", { photo: structuredClone(world.household_photo) }, arrive);
    }
    put("/world/state", "world", { rev: ++rev, view: world }, arrive);
  }
  return { left, photos, arrivals: stops.map((e) => ({ at: base + e.at, value: e.value, ...(e.depart !== undefined ? { depart: base + e.depart } : {}) })) };
}

/** VLM 사진 간격(src/observe/pipeline.ts frame.vlm): 앞 VLM 촬영 prev 뒤 엔진 프레임마다 보고, 처음으로 「그때 간격(빠름 1초·보통 2초)」 이상 지난 프레임.
 *  fast(t)는 그 시각의 src/server/home/observe.ts vlmFast와 같은 값이다. */
function nextVlmCapture(prev: number, fast: (t: number) => boolean): number {
  for (let t = prev + FAST_VLM_MS; ; t += OBSERVE.engineMs) if (t - prev >= (fast(t) ? FAST_VLM_MS : VLM_STEP_MS)) return t;
}
const OBSERVE = loadObserveConfig({}),
  VLM_STEP_MS = vlmStepMs(OBSERVE),
  /** 합성 기록 VLM 답 지연의 아래 끝(ms): 잰 평균은 nano 1.6초, mini 1.8초다. */
  VLM_LAG_MIN_MS = 1000;

/** 그 변형의 합성 기록으로 만든 사진들(촬영 시각·폰 자리·카메라). */
export function composedPhotos(variant: Variant): Photo[] {
  return makeBag(Bag.open(":memory:"), variant).photos;
}

export async function replayScenario(
  variant: Variant,
  recording?: (v: ReturnType<LiveScenario["judge"]>) => void,
): Promise<ScenarioEvent[]> {
  const bag = Bag.open(":memory:"),
    trace: ScenarioEvent[] = [];
  const db = HistoryDb.open(":memory:"),
    live = new LiveScenario(scene);
  const received: PlannedCommand[] = [];
  /** 폰에 보낸 가기 명령(보낸 시각, 목적지 id). */
  const goes: { at: number; target: string }[] = [];
  let resolveDecision: (d: DecisionRecord) => DecisionRecord = (d) => d;
  // 녹화한 World State의 TV 전원은 재생 중 허브 전원을 따른다(실제 집 상태 노드는 /device/changes로 기기 상태를 바꾼다)
  let tvPower: () => "on" | "off" = () => "on";
  // 재생 틱마다 그때 관찰 흐름이 VLM 사진 간격을 1초로 줄일지(vlmFast)를 남긴다
  const fastAt: [number, boolean][] = [];
  try {
    const { left, photos, arrivals } = makeBag(bag, variant);
    if (raw[0].learned_discard) db.cupAnswers.seedDemo(raw[0].home);
    await replay({
      bag,
      resolveDecision: (d) => resolveDecision(d),
      resolveWorld: (view) => ({
        ...view,
        devices: view.devices.map((d) =>
          d.id === tvId ? { ...d, state: [tvPower()], status: tvPower() === "on" ? "켜짐" : "꺼짐" } : d,
        ),
      }),
      from: base,
      to: base + REPLAY_MS,
      topics: ["/world/state", "/world/household_photo", "/brain/decision", "/phone/pose", "/device/changes"],
      launch: async (bus, clock) => {
        const node = (name: "manager" | "act" | "devices" | "recorder") =>
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
        tvPower = () => (power().power === "on" ? "on" : "off");
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
            if (m.type !== "command") return;
            received.push(m);
            const key = JSON.stringify([m.id, m.step]);
            if (heard.has(key)) return;
            heard.add(key);
            // 같은 명령을 안내만 바꿔 다시 보낸 것은 새 명령이 아니다
            if (m.kind === "go" && m.target?.id) goes.push({ at: clock.now(), target: m.target.id });
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
          world = view;
          rev = next;
          live.sample(view);
          // 빈 시청 구역은 그 구역 전체가 보이는 사진에서만 안다(TV 규칙과 같은 사실). 빈 구간 첫 촬영(empty)과
          // 그 구간이 NO_VIEWER_MS 이어진 촬영(vacant)을 촬영 시각 자리에 넣는다
          const zone = seenZone.evaluateTriggers(view, next, map, clock.now());
          const shot = view.household_photo?.at_ms;
          const atShot = (kind: ScenarioEvent["kind"], t: number) => {
            const i = trace.findIndex((x) => x.at > t - base);
            trace.splice(i < 0 ? trace.length : i, 0, { kind, at: t - base, id: tvId });
          };
          const vacancy = zone.read({ kind: "noViewer", room: "living", ms: 0 });
          if (vacancy.value !== true) emptySince = null;
          else if (emptySince === null && shot !== undefined) emptySince = shot;
          if (!firstEmpty && emptySince !== null && shot !== undefined && trace.some((e) => e.kind === "watch") &&
            zone.read({ kind: "noViewer", room: "living", ms: NO_VIEWER_MS }).value === true) {
            atShot("empty", emptySince);
            atShot("vacant", shot);
            firstEmpty = true;
          }
          if (firstEmpty && zone.read({ kind: "postureAttention", target: tvId, posture: "seated" }).value === true && !trace.some((e) => e.kind === "viewer_returned"))
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
        return [manager, goalNode.mirror.node, act, device, recorder];
      },
    });
    // 합성 기록이 실제와 어긋난 곳을 모아 가장 이른 것을 알린다(뒤의 어긋남은 앞 어긋남 때문에 생길 수 있다)
    const wrong: { at: number; text: string }[] = [];
    // 폰은 그 자리로 보낸 가기 명령을 받은 뒤 출발(depart)하고, 앞 자리에서 안내 길로 걸어도 걸리는 시간(영상 모드 걷기 초당 WALK_MPS) 뒤에 도착한다(첫 자리는 처음 선 곳)
    arrivals.forEach((e, i) => {
      if (i === 0) return;
      const prev = arrivals[i - 1]!;
      const target = e.value === "table" ? table.surface_id : e.value === "sink" ? sink.surface_id : e.value;
      // 안내 길(문·경유점)을 따라 걷는 길이
      const walkMs = Math.ceil((pathLength(pathBetween(spotOf(prev.value).position, spotOf(e.value).position)) / WALK_MPS) * 1000);
      // 앞 걷기를 시작한 뒤 보낸 명령만 이 걷기의 명령이다(같은 자리로 갔던 옛 명령이 아니다)
      const since = prev.depart ?? prev.at;
      const sent = e.depart === undefined ? undefined : goes.filter((g) => g.target === target && g.at > since && g.at <= e.depart!).at(-1);
      if (e.depart === undefined || !sent || e.at - e.depart < walkMs)
        wrong.push({
          at: e.depart ?? e.at,
          text:
            `합성 기록 폰 출발 ${e.depart === undefined ? "없음" : e.depart - base + "ms"}·도착 ${e.at - base}ms(${e.value})가 ` +
            `가기 명령(${sent ? sent.at - base + "ms" : "없음"}) 뒤 출발, 걷는 시간 ${walkMs}ms 뒤 도착이 아닙니다. ` +
            `보낸 가기 명령: ${goes.map((g) => `${g.target}@${g.at - base}`).join(", ")}`,
        });
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
