// 토픽 표(ROS 2 토픽·QoS처럼): 이름, QoS(SENSOR·STATE·RELIABLE), 몸 모양(zod), 열쇠, 순서 기준, 보내는 노드, 사진 칸.
// 토픽을 더할 때는 이 표 하나에 더한다. qos가 없으면 satisfies에서 타입 오류다. 사진(jpeg_b64)이 든 토픽은 SENSOR만.
// 몸 모양은 그 토픽을 옮기는 묶음에서 실제 모양으로 바꾼다(그 전에는 객체인지와 순서 칸만 본다).
// 실제 모양으로 바꾼 토픽은 계약(src/contract)의 타입과 같은지 아래 Assert로 tsc가 본다(한쪽만 바꾸면 tsc 실패).
import { z } from "zod";
import { PHOTO_MAX_RMS_PX, PHOTO_MIN_MATCHES } from "../shared/photo-alignment.js";
import { CHECK_TEXT } from "../act/labels.js";
import { ConditionSchema } from "../world/condition-schema.js";
import type { DecisionRecord } from "../contract/events.js";
import type { AssistanceOutcome } from "../contract/assistance-outcome.js";
import type { BeerEvent } from "../contract/beer.js";
import type { PlanAhead, PlanResult } from "../contract/plan-work.js";
import type { WorldObject } from "../contract/world.js";
import type { DeviceState } from "../contract/devices.js";
import type { PersonMessage, SeenEvent } from "../contract/events.js";
import type { GoalState, ManagerState, RobotState, SafetyState, Timed } from "../contract/machines.js";
import type { BrainGoalMsg } from "../contract/goal.js";
import type { PlanView } from "../contract/plan.js";
import type { SceneInput, VlmMissing, WorldChange, WorldChangeKind, WorldChangesMsg, WorldCloserMsg, WorldInput, WorldStateMsg, WorldView, YoloMissing } from "../contract/world.js";
import { CLASSES, SCENE_STATES, type DetLabel } from "../world/vocab.js";

export const NODES = ["phone", "perception", "world", "brain", "act", "goal", "manager", "devices", "recorder", "localize"] as const;
export type NodeName = (typeof NODES)[number];
export type Qos = { kind: "sensor"; depth: number; record?: boolean } | { kind: "state" } | { kind: "reliable" };
/** 낡음을 보는 기준: 근거 시각(observed_ms 칸), 상태 판본(rev 칸), 발행 시각(머리 stamp), 없음. */
export type Order = "observed_ms" | "rev" | "stamp" | null;
export interface TopicSpec<B = unknown> {
  qos: Qos;
  body: z.ZodType<B>;
  key: (b: B) => string;
  order: Order;
  from: readonly NodeName[];
  /** 사진 칸 이름(녹화에서 뺀다). SENSOR 토픽만. */
  photo?: string;
}

/** 사진 base64 글 상한(≈ 512KB JPEG). */
export const MAX_FRAME_B64 = 700_000;
const B64 = /^[A-Za-z0-9+/]*={0,2}$/;
const obj = z.looseObject({});
const observed = z.looseObject({ observed_ms: z.number().finite() });
const frame = z.looseObject({
  jpeg_b64: z.string().max(MAX_FRAME_B64).regex(B64), width: z.number().int().positive(), height: z.number().int().positive(), observed_ms: z.number().finite(),
});
const one = () => "_";
const by = (k: string) => (b: Record<string, unknown>) => String(b[k] ?? "_");

// 묶음 2: 인식·집 상태 토픽의 실제 모양. 사진 칸(jpeg·jpeg_b64)은 strict라 거절된다.
const at = z.number().finite();
const id = z.string().min(1);
const rev = z.number().int().nonnegative();
const unitBox = z.strictObject({ x: z.number().finite(), y: z.number().finite(), w: z.number().finite(), h: z.number().finite() });
/** VLM 물건 목록 하나(VLM이 답한 번호·종류·사진 비율 상자, 같은 물건 감지 번호). */
const sceneObject = z.strictObject({ id: z.string(), cls: z.string(), box: unitBox, det: z.string().nullable() });
const scene = z.strictObject({
  household: z.strictObject({
    seats: z.enum(["clear","obscured","unknown"]),
    people: z.array(z.strictObject({id:z.string().nullable(), attention:z.enum(["toward_tv","elsewhere","unknown"])})),
    dining_food: z.enum(["yes","no","unknown"]),
  }).optional(),
  scene: z.string(), observations: z.array(z.strictObject({ object_id: z.string(), state: z.enum(SCENE_STATES) })), objects: z.array(sceneObject).optional(), summary: z.string(),
});
const VLM_MISSING = ["cap", "timeout", "format", "error", "stale"] as const satisfies readonly VlmMissing[];
const YOLO_MISSING = ["cap", "error", "stale"] as const satisfies readonly YoloMissing[];
const label = z.custom<DetLabel>((v) => typeof v === "string" && Object.hasOwn(CLASSES, v) && (CLASSES as Record<string, { role: string }>)[v]!.role !== "scene");
const box = z.tuple([at, at, at, at]);
const mask = z.strictObject({ at: box, cols: z.number().int().nonnegative(), rows: z.number().int().nonnegative(), bits: z.string().regex(B64) });
// YOLO 임시 갈래의 모양(VLM 전용으로 바뀔 자리). 모든 칸이 strict라 사진 바이트 칸(jpeg·jpeg_b64·sha256)은 어느 자리에서든 거절된다.
const detection = { label, score: z.number(), box, cls: z.number().int(), mask, foot: z.tuple([at, at]) };
const camera = z.strictObject({ origin: z.tuple([at, at, at]), orientation: z.tuple([at, at, at, at]), theta: at, projection: z.array(at) });
const eyePose = z.strictObject({ position: z.tuple([at, at]), height_m: at, yaw_deg: at, pitch_deg: at });
const frameMeta = z.strictObject({
  id, capturedAtMs: at, latestAtMs: at, width: z.number().int().positive(), height: z.number().int().positive(), eye: eyePose.nullable(), view: camera.nullable(),
  crop: box.optional(), vlm: z.boolean().optional(), fresh_position:z.boolean().optional(),
});
const pose = z.strictObject({ score: z.number(), box, keypoints: z.array(z.tuple([at, at, at])) });
const closerPass = z.strictObject({
  frameId: id, capturedAtMs: at, view: camera, width: z.number().int().positive(), height: z.number().int().positive(), dets: z.array(z.strictObject({ ...detection, edge: z.boolean() })),
});
const size = { width: z.number().int().positive(), height: z.number().int().positive() };
/** 장면 VLM 답을 받은 사진의 카메라·크기·폰 눈 자리. */
const sceneLook = z.strictObject({
  localized_position: z.tuple([at, at, at]).optional(), fresh: z.boolean().optional(), person_ids: z.array(id).optional(),
  view: camera, ...size, eye: z.tuple([at, at]).nullable().optional(), dets: z.array(z.strictObject({ id: z.string(), box, foot: z.tuple([at, at]).optional() })).optional(),
});
/** 가까이 본 그 장의 카메라·크기·자른 자리. */
const closerAt = z.strictObject({ view: camera, ...size, crop: box });
/** /perception/scene: VLM 답 갈래 다섯(집 상태 입력의 주인)과 YOLO 임시 갈래 넷(VLM 전용으로 바뀔 자리). */
const sceneInput = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("scene"), frame_id: id, observed_ms: at, from_ms: at.optional(), scene, look: sceneLook.optional() }),
  z.strictObject({ kind: z.literal("missing"), frame_id: id, observed_ms: at, missing: z.enum(VLM_MISSING) }),
  z.strictObject({ kind: z.literal("closer_scene"), look: id, frame_id: id, observed_ms: at, scene, at: closerAt }),
  z.strictObject({ kind: z.literal("closer_end"), look: id }),
  z.strictObject({ kind: z.literal("top"), object_id: id, frame_id: id, observed_ms: at, value: z.enum(["empty", "has_contents"]) }),
  z.strictObject({ kind: z.literal("eye"), eye: eyePose.nullable(), at_ms: at }),
  z.strictObject({ kind: z.literal("frame"), frame: frameMeta, dets: z.array(z.strictObject(detection)), poses: z.array(pose).optional() }),
  z.strictObject({ kind: z.literal("yolo_missing"), frame_id: id, observed_ms: at, yolo: z.enum(YOLO_MISSING), vlm: z.enum(VLM_MISSING).optional() }),
  z.strictObject({ kind: z.literal("closer_merge"), look: id, passes: z.array(closerPass), from: id }),
]);
/** /perception/detections: 대시보드 미니맵 물체 모양(표시용, 집 상태 노드는 받지 않는다). */
const seen = z.strictObject({
  observed_ms: at, frame_id: id, frame: z.strictObject({ width: z.number().int().positive(), height: z.number().int().positive() }),
  shapes: z.array(z.strictObject({
    label, score: z.number(), mask,
  })),
});
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isNum = (v: unknown) => typeof v === "number" && Number.isFinite(v);
/** 최상위 칸이 이 표의 칸뿐인가(사진 칸 jpeg·jpeg_b64 같은 모르는 칸이 없다). */
const onlyKeys = (v: Record<string, unknown>, keys: ReadonlySet<string>) => Object.keys(v).every((k) => keys.has(k));
const VIEW_KEYS = ["at_ms", "objects", "sightings", "person", "fixtures", "devices", "eye", "frame_ms", "vlm_missing", "yolo_missing", "person_trail", "household_photo", "surfaces_seen"] as const satisfies readonly (keyof WorldView)[];
const VIEW_KEY_SET: ReadonlySet<string> = new Set(VIEW_KEYS);
const floorPosition = z.tuple([at,at]);
const trailPoint = z.strictObject({position:floorPosition, room:z.string().nullable(), at_ms:at});
const householdPhoto = z.strictObject({id, at_ms:at, serial:rev, cap_from_ms:at.optional(), answered_ms:at.optional(), proof:z.strictObject({
  localized_fixtures:z.array(id).optional(), localized_position:z.tuple([at, at, at]).optional(), camera, seats:z.enum(["clear","obscured","unknown"]), person_count:z.int().nonnegative(), dining_food:z.enum(["yes","no","unknown"]),
  person:z.strictObject({position:floorPosition,room:z.string().nullable(),seated:z.boolean().nullable(),attention:z.enum(["toward_tv","elsewhere","unknown"])}).nullable(),
}).nullable()});
const personTrail = z.array(trailPoint).max(2);
const surfacesSeen = z.array(z.strictObject({ id, label: z.string(), room: z.string().nullable(), center: floorPosition, seen_ms: at }));
/** /world/state의 보기는 집 상태 노드 하나가 타입으로 만든 18KB 객체라 깊이는 보지 않는다(지나기마다 세 번 검사하므로 지연 예산).
 *  최상위 칸은 다 있고(후보 자리 sightings는 있을 때만) 그 칸뿐인지(사진 칸 없음)와 칸의 종류만 본다. */
const view = z.custom<WorldView>((v) => isObj(v) && onlyKeys(v, VIEW_KEY_SET) && isNum(v.at_ms) && Array.isArray(v.objects) && (v.sightings === undefined || Array.isArray(v.sightings)) && isObj(v.person) && Array.isArray(v.fixtures)
  && (v.household_photo === undefined || householdPhoto.safeParse(v.household_photo).success)
  && (v.person_trail === undefined || personTrail.safeParse(v.person_trail).success)
  && (v.surfaces_seen === undefined || surfacesSeen.safeParse(v.surfaces_seen).success)
  && Array.isArray(v.devices) && (v.eye === null || isObj(v.eye)) && (v.frame_ms === null || isNum(v.frame_ms)) && isNum(v.vlm_missing) && isNum(v.yolo_missing));
const worldState = z.strictObject({ rev, view });
const CHANGE_KINDS = [
  "appeared", "gone", "out_of_view", "back_in_view", "state", "person_appeared", "person_gone", "person_state", "person_room", "fixture", "device", "vlm", "vlm_missing", "yolo_missing", "heard",
] as const satisfies readonly WorldChangeKind[];
const worldChanges = z.strictObject({ rev, changes: z.array(z.strictObject({ kind: z.enum(CHANGE_KINDS), at_ms: at, subject: z.string(), text: z.string(), meaningful: z.boolean() })) });
const worldInput = z.union([
  z.strictObject({ kind: z.enum(["guard", "contents"]), id, on: z.boolean(), at_ms: at }),
  z.strictObject({ kind: z.literal("focus"), id: id.nullable(), focus: z.strictObject({ step: z.enum(["pick", "place", "carry"]), spot: z.tuple([at, at]).nullable() }).nullable(), at_ms: at }),
  z.strictObject({ kind: z.literal("link"), from: id, to: id, at_ms: at }),
]);
const heard = z.strictObject({ text: z.string(), observed_ms: at });
/** /world/closer: 가까이 보기 한 번의 VLM 합치기 뒤 최종 id 표. */
const worldCloser = z.strictObject({ look: id, ids: z.record(z.string(), z.string()) });
const DEVICE_KEYS = ["id", "online", "twin", "matter", "updatedAt", "signal", "readback", "vision"] as const satisfies readonly (keyof DeviceState)[];
const DEVICE_KEY_SET: ReadonlySet<string> = new Set(DEVICE_KEYS);
/** /device/changes: 기기 상태(허브가 만든 값이라 최상위 칸만 본다: 꼭 있는 칸과 그 칸뿐인지)와 기록용 메모(첫 상태·이름·종류). */
const deviceChange = z.strictObject({
  id, state: z.custom<DeviceState>((v) => isObj(v) && onlyKeys(v, DEVICE_KEY_SET) && typeof v.id === "string" && typeof v.online === "boolean" && isObj(v.twin) && isObj(v.matter) && typeof v.updatedAt === "string"),
  note: z.strictObject({ initial: z.boolean().optional(), label: z.string().optional(), kind: z.string().optional(),
    power: z.strictObject({power:z.enum(["on","off"]).nullable(),generation:rev,command_id:id.nullable()}).optional() }),
});
/** /brain/goal·/brain/goal_changes: 미리 세운 목표 하나. 계획 보기는 실행 추적이 타입으로 만든 객체라 깊이 보지 않는다(최상위 id·steps만). */
const xyz = z.tuple([at, at, at]);
const lookSpot = z.strictObject({ id, label: z.string(), position: xyz });
const lookRequest = z.discriminatedUnion("kind", [
  z.strictObject({ req: id, kind: z.literal("cancel") }),
  z.strictObject({ req: id, kind: z.literal("ready_top"), object_id: id, since: at, until: at }),
  z.strictObject({ req: id, kind: z.literal("ready_spot"), position: xyz, since: at, until: at }),
  z.strictObject({ req: id, kind: z.literal("closer"), spot: lookSpot, since: at.optional(), until: at }),
  z.strictObject({ req: id, kind: z.literal("top"), spot: lookSpot, since: at, until: at }),
]);
const closerResult = z.discriminatedUnion("ok", [
  z.strictObject({ ok: z.literal(false), why: z.enum(["no_fresh_frames", "vlm_busy", "no_view", "out_of_view", "no_detector", "aborted", "closed", "error", "world_timeout"]) }),
  z.strictObject({ ok: z.literal(true), frame_id: id, captured_at_ms: at, crop: box, frames: z.number().int(), summary: z.string().nullable(),
    vlm: z.enum(["ok", "aborted", "no_fresh_frames", ...VLM_MISSING]), found: z.array(z.strictObject({ id: id.nullable(), cls: label, score: at, facts: z.array(z.string()), via: z.literal("vlm").optional() })),
    top: z.array(z.strictObject({ frame_id: id, kept: z.boolean(), why: z.enum(["moved", "vlm_missing", "not_visible", "no_contents", "no_vessel", "crowded"]).optional() })).optional() }),
]);
const lookResult = z.strictObject({ req: id, observed_ms: at, result: z.union([z.boolean(), closerResult]) });
const walkPosition = z.tuple([at,at,at]);
const walkPoint = z.discriminatedUnion("kind",[
  z.strictObject({kind:z.literal("portal"),id,from_room:id,to_room:id,position:walkPosition}),
  z.strictObject({kind:z.enum(["via","stand"]),room:id,position:walkPosition}),
]);
const walkGuide = z.strictObject({pose_gen:rev.optional(),revision:rev,near_m:z.number().positive(),remaining:z.tuple([walkPoint],walkPoint)})
  .refine(g=>g.remaining.every((p,i)=>(p.kind==="stand")===(i===g.remaining.length-1)));
const navigationPose = z.union([z.strictObject({observed_ms:at}),z.strictObject({observed_ms:at,pose_gen:rev,quality:z.enum(["usable","unavailable"]),
  position:z.tuple([at,at]).nullable(),error_m:z.number().nonnegative().optional()})]);
const phoneCommand = z.strictObject({ revision: rev.optional(), cmd: z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("command_clear"), id: id.optional() }),
  z.strictObject({ type: z.literal("command"), id, step: id, text: z.string(), vision: z.string().nullable(),
    choices: z.array(z.strictObject({ id, label: z.string() })), speak: z.boolean(),
    speech_id: z.strictObject({ boot: z.string().min(1), homeEpoch: z.string().min(1), publisher: z.string().min(1), revision: rev }).optional(),
    target: z.strictObject({ id, label: z.string(), position: z.tuple([at, at, at]), look: z.tuple([at, at, at]).optional() }).nullable(),
    guide: walkGuide.nullable().optional(), kind: z.enum(["go", "pick", "place", "do"]).optional(), near_m: z.number().positive().optional(),
    view: z.literal("above").optional(), grade: z.enum(["question", "safety"]).optional() }),
]) });
const claimKind = z.enum(["safety", "approval", "dialog", "plan", "peek"]);
const phoneClaim = z.strictObject({ claim_id: id, kind: claimKind.nullable(), since_ms: at });
const phoneOwner = z.strictObject({ owner: z.strictObject({ claim_id: id, kind: claimKind }).nullable() });
const phoneProgress = z.discriminatedUnion("kind", [
  z.strictObject({ req: id, expires_ms: at, kind: z.literal("button"), plan_id: id, step: id, choice: id }),
  z.strictObject({ req: id, expires_ms: at, kind: z.literal("voice"), text: z.string(), at: z.discriminatedUnion("kind", [
    z.strictObject({ kind: z.literal("command"), id, step: id }), z.strictObject({ kind: z.literal("none") }),
  ]).optional() }),
]);
const progressResult = z.strictObject({ req: id, status: z.enum(["answer", "stale", "passed"]), reply: z.string().optional(), choice_id: id.optional() });
const planView = z.custom<PlanView>((v) => isObj(v) && typeof v.id === "string" && Array.isArray(v.steps));
const xz = z.tuple([at, at]);
const planTarget = z.strictObject({ objectId: id.optional(), deviceId: id.optional(), room: id.optional(), position: xz.optional() });
const wirePlan = z.strictObject({
  id, revision: z.number().int(), supersedes: id.optional(), origin: z.enum(["live", "mock"]).optional(),
  source: z.enum(["brain", "agent", "planner"]), goal: z.string(), judgment: z.string(), dryRun: z.boolean(),
  robot: z.strictObject({ position: xz.nullable(), room: id.nullable() }), path: z.array(xz),
  legs: z.array(z.strictObject({ stepId: id, end: z.number().int() })),
  steps: z.array(z.strictObject({ id, kind: z.enum(["move", "act", "ask", "device", "wait"]), label: z.string(), target: planTarget.optional(),
    status: z.enum(["pending", "active", "done", "failed", "skipped"]), started_ms: at.optional(), ended_ms: at.optional() })),
  status: z.enum(["planned", "running", "done", "cancelled", "failed"]), updatedAt: z.string(),
});
const maybeText = z.string().nullable();
const prediction = z.strictObject({ observation: z.string(), reasoning: z.string(), task_index: z.int(),
  state: id.optional(), from: maybeText.optional(), next_index: z.int().optional() });
const fsmStep = z.strictObject({ state: id, from: maybeText, next_index: z.int(), to: maybeText, on: maybeText, when: maybeText, action: maybeText, learned: z.boolean() });
const decisionRecord = z.strictObject({
  request_rev: rev.optional(),
  assistanceRevision: z.strictObject({ room: id, objectId: maybeText, completed: rev }).optional(),
  id, seq: rev, atMs: at, finalTime: id, textSent: z.string(), status: z.enum(["valid", "failed"]), prediction: prediction.nullable(), action: maybeText,
  fsm: fsmStep.nullable().optional(), late: z.literal(true).optional(), goal: z.literal(true).optional(), error: z.string().optional(),
  usage: z.strictObject({ model: id, prompt: rev, completion: rev, cached: rev, cost_usd: at.nullable() }).optional(), memoryVersion: rev, tasks: z.array(id).optional(),
  world: z.strictObject({ person_visible: z.boolean(), vlm_missing: rev, yolo_missing: rev, objects: z.array(z.strictObject({
    id, cls: id, status: id, surface: maybeText, surface_label: maybeText, error_m: at.nullable(),
    facts: z.record(id, z.strictObject({ value: id, certainty: z.enum(["confirmed", "inferred"]) })), closer_rev: z.record(id, rev).optional(),
  })) }), source: z.literal("speech").optional(), via: z.literal("answer").optional(), afterSeq: rev.optional(),
});
const precheck = z.discriminatedUnion("ok", [
  z.strictObject({ ok: z.literal(true) }),
  z.strictObject({ ok: z.literal(false), reason: z.enum(Object.keys(CHECK_TEXT) as [keyof typeof CHECK_TEXT, ...(keyof typeof CHECK_TEXT)[]]),
    text: id, object: id.optional(), carried: z.literal(true).optional() }),
]);
const checkedDecision = z.strictObject({ decision: decisionRecord, rev, check: precheck, assist: z.enum(["noonchi", "coach"]), at_ms: at });
const planAhead = z.strictObject({ trigger: z.string(), on: maybeText, object: id, goal_id: id.optional(),
  stand: z.custom<WorldObject>((v) => isObj(v) && typeof v.id === "string" && typeof v.cls === "string" && isObj(v.facts)).optional() });
const agentStep = z.strictObject({
  id, kind: z.enum(["go","pick","place","do","device","ask","say","wait"]), label: id, target: maybeText, object: maybeText, command: maybeText,
  prompt: z.strictObject({ text: id, ends: z.array(id), choices: z.array(z.strictObject({
    id, label: id, words: z.array(z.string()), reply: z.string(), whole: z.boolean().optional(),
  })) }).nullable(), text: maybeText, device: z.strictObject({ tool: id, deviceId: id, args: z.record(id, z.unknown()) }).nullable(),
  hand: z.strictObject({ deviceId: id, to: z.enum(["on","off","open","close"]) }).nullable(), caution: maybeText,
  until: ConditionSchema.nullable(), timeoutMs: at, onTimeout: z.enum(["ask","fail"]), look: z.literal("top").optional(),
});
const planResult = z.discriminatedUnion("ok", [
  z.strictObject({ ok: z.literal(true), plan: z.strictObject({ view: wirePlan, steps: z.array(agentStep), task: id, submitted: z.unknown().optional() }) }),
  z.strictObject({ ok: z.literal(false), error: z.string() }),
]);
const actLog = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("execution"), at_ms: at, plan_id: id, state: z.enum(["decided", "planned", "running", "verifying", "done", "failed"]), text: z.string(), reason: z.string().optional() }),
  z.strictObject({ type: z.literal("feedback"), at_ms: at, subject: id, text: z.string(), data: z.strictObject({ choice: id, via: z.enum(["voice", "button"]), observed_ms: at.optional() }) }),
  z.strictObject({ type: z.literal("plan"), plan: wirePlan.nullable() }),
]);
const actStatus = z.strictObject({ mode: z.enum(["noonchi", "coach"]), hold: z.boolean(), text: z.string().nullable(), safety: z.boolean(),
  tasks: z.array(id), placed: z.array(z.tuple([id, z.strictObject({ target: id, part: z.literal("basin").optional(), atMs: at })])) });
const pendingGoal = z.strictObject({
  id, action: z.string().min(1), state: z.string().min(1), trigger: z.string(), object: id.nullable(), cls: z.string().min(1),
  status: z.enum(["armed", "checking", "fired", "used", "dropped"]), prep: z.enum(["waiting", "planning", "ready", "failed"]),
  meal: z.strictObject({zone:z.string(), surface:z.string(), activity:z.string()}).optional(),
  checking_ms: at.optional(), check_until_ms: at.optional(), departure_rev: at.optional(), confirmed_ms: at.optional(),
  reason: z.enum(["took", "back", "moved", "replaced", "safety", "mode", "dock", "expired", "pam", "stale", "stop"]).nullable(),
  text: z.string().nullable(), armed_ms: at, ready_ms: at.nullable(), gone_ms: at.nullable(), fired_ms: at.nullable(), plan: planView.nullable(),
  error: z.string().min(1).optional(),
});
const pamLink = z.strictObject({ type: z.literal("link"), target: z.literal("pam"), up: z.boolean(), at_ms: at, text: z.string() });
const thoughtMessage = z.strictObject({ id, decision: id, at_ms: at, text: z.string() });
const brainGoal = z.strictObject({ goal: pendingGoal });
const personState = z.strictObject({ type: z.literal("person"), state: id, name: id, source: z.enum(["decision", "world"]), decision_id: id.nullable(), since_ms: at });
const robotState = z.strictObject({ state: z.enum(["idle", "observe", "move", "run", "return", "return_room", "standby", "recover"]), since_ms: at,
  step: z.strictObject({ plan_id: id, number: z.number().int().positive(), label: id }).nullable() });
const goalState = z.strictObject({ state: z.enum(["idle", "armed", "checking", "planning", "ready", "started", "done", "dropped"]), since_ms: at,
  id: id.nullable(), action: id.nullable(), left_ms: at.nullable(), reason: pendingGoal.shape.reason, result: z.enum(["done", "failed", "cancelled"]).nullable() });
const safetyState = z.strictObject({ state: z.enum(["normal", "suspect", "emergency"]), since_ms: at, fall: z.boolean(), hot: z.array(id), notices: z.array(id) });
const managerState = z.strictObject({ owner: z.enum(["safety", "request", "goal", "idle"]), mode: z.enum(["noonchi", "coach"]), since_ms: at, tasks: z.array(id) });
/** 목표 전환의 열쇠: 목표 id(세대). */
const goalKey = (b: Record<string, unknown>) => String((b.goal as { id?: unknown } | undefined)?.id ?? "_");

/** 두 타입이 같은가(양쪽으로). Assert<Equal<…>>가 false면 tsc가 실패한다(src/observe/scene.ts와 같은 식). */
type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
type Assert<T extends true> = T;
type Flat<T> = { [K in keyof T]: T[K] };
/** 서로 넣을 수 있는가(양쪽으로). 교차 타입(감지 & edge)·Omit 타입처럼 같은 모양을 다르게 적은 계약에 쓴다. */
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
/** 실제 모양으로 바꾼 토픽 몸이 계약 타입과 같다. 미니맵 몸은 SeenEvent에서 사건 칸을 빼고 근거 시각(촬영 시각)을 단 것이다. */
const offerFields = {id,rev,until_ms:at,target_id:id,goal_id:id.nullable()};
function offerBody<O extends "grant"|"offer">(op:O) {
  const fields = {...offerFields,op:z.literal(op)};
  return z.discriminatedUnion("kind",[
    z.strictObject({...fields,kind:z.literal("visit"),note:z.string().min(1).max(120).optional()}),
    z.strictObject({...fields,kind:z.enum(["tv_off","tv_on"])}),
    z.strictObject({...fields,kind:z.literal("choose_station"),candidates:z.array(id).min(2),direction:z.string(),visited:z.array(id)}),
  ]);
}
const goalIntent = z.union([offerBody("offer"),z.strictObject({op:z.literal("withdraw"),id,rev})]);
const managerDirective = z.union([offerBody("grant"),z.strictObject({op:z.literal("revoke"),id,rev})]);
const resultFields = {id,at_ms:at,target_id:id,evidence_rev:rev};
const directiveResult = z.discriminatedUnion("outcome",[
  z.strictObject({...resultFields,outcome:z.enum(["arrived","selected","cancelled","failed","unknown"])}),
  z.strictObject({...resultFields,outcome:z.literal("applied"),command_id:id,expected_power:z.enum(["on","off"])}),
]);
export type TopicBodiesSame = [
  Assert<Same<z.infer<typeof goalIntent>, import("../contract/machines.js").GoalIntent>>,
  Assert<Same<z.infer<typeof managerDirective>, import("../contract/machines.js").ManagerDirective>>,
  Assert<Same<z.infer<typeof directiveResult>, import("../contract/machines.js").DirectiveResult>>,
  Assert<Same<z.infer<typeof closerResult>, import("../contract/events.js").CloserResult>>,
  Assert<Same<z.infer<typeof wirePlan>, PlanView>>,
  Assert<Same<z.infer<typeof decisionRecord>, DecisionRecord>>,
  Assert<Same<z.infer<typeof planAhead>, PlanAhead>>,
  Assert<Same<z.infer<typeof planResult>, PlanResult>>,
  Assert<Same<z.infer<typeof phoneCommand>["cmd"], import("../contract/phone.js").PlannedCommandMessage>>,
  Assert<Equal<(typeof VIEW_KEYS)[number], keyof WorldView>>,
  Assert<Equal<(typeof DEVICE_KEYS)[number], keyof DeviceState>>,
  Assert<Same<z.infer<typeof sceneInput>, SceneInput>>,
  Assert<Equal<z.infer<typeof seen>, Flat<Omit<SeenEvent, "type" | "at_ms" | "captured_at_ms"> & { observed_ms: number }>>>,
  Assert<Equal<z.infer<typeof worldState>, WorldStateMsg>>,
  Assert<Equal<z.infer<typeof worldChanges>, WorldChangesMsg>>,
  Assert<Equal<z.infer<typeof worldInput>, WorldInput>>,
  Assert<Equal<z.infer<typeof worldCloser>, WorldCloserMsg>>,
  Assert<Equal<z.infer<typeof worldChanges>["changes"][number], WorldChange>>,
  Assert<Equal<z.infer<typeof brainGoal>, BrainGoalMsg>>,
  Assert<Same<z.infer<typeof personState>, PersonMessage>>,
  Assert<Same<z.infer<typeof robotState>, Timed<RobotState>>>,
  Assert<Same<z.infer<typeof goalState>, Timed<GoalState>>>,
  Assert<Same<z.infer<typeof safetyState>, Timed<SafetyState>>>,
  Assert<Same<z.infer<typeof managerState>, Timed<ManagerState>>>,
];

const photoRequest = z.strictObject({frame_id:id, captured_ms:at});
const localized = photoRequest.extend({
  position:xyz.nullable(), yaw_deg:at.nullable(), pitch_deg:at.nullable(),
  confidence:z.number().min(0).max(1), matches:z.int().nonnegative(), rms_px:at.nonnegative().nullable(),
  map_rev:id.nullable(), ar_gap_m:at.nonnegative().nullable(), ar_gap_deg:at.nonnegative().nullable(),
}).refine(r=>r.position===null
  ? r.yaw_deg===null && r.pitch_deg===null && r.confidence===0 && r.matches===0 && r.rms_px===null && r.ar_gap_m===null && r.ar_gap_deg===null
  : r.yaw_deg!==null && r.pitch_deg!==null && r.confidence>=.23 && r.matches>=PHOTO_MIN_MATCHES && r.rms_px!==null && r.rms_px<=PHOTO_MAX_RMS_PX && r.map_rev!==null &&
    (r.ar_gap_m===null)===(r.ar_gap_deg===null));
const identity = z.string().min(1);
const attemptKey = z.strictObject({ boot: identity, homeEpoch: identity, attemptId: identity, gen: z.int().nonnegative() });
const assistanceProof = z.strictObject({
  key: attemptKey, home: identity, user: identity,
  kind: z.enum(["explicit_accept", "explicit_decline", "confirmed_handoff", "self_resolved"]),
  evidence: z.strictObject({ source: identity, subjectId: identity, observedMs: z.number(), originId: identity }),
});
const assistanceOutcome = z.strictObject({
  key: attemptKey, home: identity, user: identity.nullable(), action: identity, context: identity.nullable(),
  request: z.enum(["direct", "proactive"]), startedMs: z.number(), endedMs: z.number(),
  execution: z.enum(["done", "cancelled", "failed"]), reaction: z.enum(["unknown", "accepted", "declined", "self_resolved"]),
  proof: assistanceProof.nullable(),
}) satisfies z.ZodType<AssistanceOutcome>;

const beerStamp = { home: identity, user: identity, device: identity, originId: identity, atMs: z.number() };
const beerEvent = z.union([
  z.strictObject({ ...beerStamp, kind: z.enum(["tv_on", "tv_off"]) }),
  z.strictObject({ ...beerStamp, kind: z.enum(["beer_taken", "can_put_away"]), object: identity, provenance: z.enum(["resident", "assistance"]) }),
]) satisfies z.ZodType<BeerEvent>;

export const TOPICS = {
  "/perception/localize": {qos:{kind:"reliable"}, body:photoRequest, key:by("frame_id"), order:null, from:["perception"]},
  "/perception/localized": {qos:{kind:"reliable"}, body:localized, key:by("frame_id"), order:null, from:["localize"]},
  "/goal/intent": { qos:{kind:"reliable"}, body:goalIntent, key:one, order:null, from:["goal"] },
  "/manager/directive": { qos:{kind:"reliable"}, body:managerDirective, key:one, order:null, from:["manager"] },
  "/act/directive_result": { qos:{kind:"reliable"}, body:directiveResult, key:one, order:null, from:["act"] },
  "/brain/person": { qos: { kind: "state" }, body: personState, key: one, order: "stamp", from: ["brain"] },
  "/brain/person_changes": { qos: { kind: "reliable" }, body: personState, key: one, order: null, from: ["brain"] },
  "/brain/nudge": { qos: { kind: "reliable" }, body: z.strictObject({ rev }), key: one, order: null, from: ["goal"] },
  "/goal/update": { qos: { kind: "reliable" }, body: z.strictObject({ rev }), key: one, order: null, from: ["act"] },
  "/act/work": { qos: { kind: "reliable" }, body: z.strictObject({
    at_ms: at, goal: pendingGoal.pick({ id: true, action: true, status: true, prep: true, gone_ms: true, reason: true }).nullable(), plan: z.strictObject({ goal: id.nullable(), status: wirePlan.shape.status }).nullable(),
    active: z.boolean(), requested: z.boolean(), emergency: z.boolean(), handling: id.nullable(), activeAction: maybeText, docking: z.boolean(),
    phoneBusy: z.boolean().optional(), mode: z.enum(["noonchi","coach"]), tasks: z.array(id),
  }), key: one, order: null, from: ["act"] },
  "/manager/request": { qos: { kind: "reliable" }, body: z.discriminatedUnion("kind", [
    z.strictObject({ kind: z.literal("speech"), input: checkedDecision }), z.strictObject({ kind: z.literal("cancel") }),
  ]), key: one, order: null, from: ["act"] },
  "/manager/order": { qos: { kind: "reliable" }, body: z.strictObject({ input: checkedDecision,
    gate: z.enum(["take","defer","request","dock","hands"]), resumed: z.boolean() }), key: one, order: null, from: ["manager"] },
  "/goal/state": { qos: { kind: "state" }, body: goalState, key: one, order: "stamp", from: ["goal"] },
  "/goal/changes": { qos: { kind: "reliable" }, body: goalState, key: one, order: null, from: ["goal"] },
  "/robot/state": { qos: { kind: "state" }, body: robotState, key: one, order: "stamp", from: ["act"] },
  "/robot/changes": { qos: { kind: "reliable" }, body: robotState, key: one, order: null, from: ["act"] },
  "/safety/state": { qos: { kind: "state" }, body: safetyState, key: one, order: "stamp", from: ["act"] },
  "/safety/changes": { qos: { kind: "reliable" }, body: safetyState, key: one, order: null, from: ["act"] },
  "/manager/state": { qos: { kind: "state" }, body: managerState, key: one, order: "stamp", from: ["manager"] },
  "/manager/changes": { qos: { kind: "reliable" }, body: managerState, key: one, order: null, from: ["manager"] },
  "/perception/frame": { qos: { kind: "sensor", depth: 4 }, body: frame, key: one, order: "observed_ms", from: ["phone"], photo: "jpeg_b64" },
  "/phone/pose": { qos: { kind: "sensor", depth: 600, record: true }, body: navigationPose, key: one, order: "observed_ms", from: ["phone"] },
  "/perception/detections": { qos: { kind: "sensor", depth: 600, record: true }, body: seen, key: one, order: "observed_ms", from: ["perception"] },
  "/perception/analysis": { qos: { kind: "reliable" }, body: observed, key: by("frame_id"), order: "observed_ms", from: ["perception"] },
  "/perception/scene": { qos: { kind: "reliable" }, body: sceneInput, key: one, order: null, from: ["perception"] },
  "/perception/frame_seen": { qos: { kind: "state" }, body: z.strictObject({ at_ms: at }), key: one, order: "stamp", from: ["perception"] },
  "/perception/view": { qos: { kind: "state" }, body: z.strictObject({ view: camera.nullable(), capturedAtMs: at, ...size }), key: one, order: "stamp", from: ["perception"] },
  "/perception/look_request": { qos: { kind: "reliable" }, body: lookRequest, key: by("req"), order: null, from: ["act"] },
  "/perception/look_result": { qos: { kind: "reliable" }, body: lookResult, key: by("req"), order: "observed_ms", from: ["perception"] },
  "/world/input": { qos: { kind: "reliable" }, body: worldInput, key: by("id"), order: null, from: ["act"] },
  "/world/state": { qos: { kind: "state" }, body: worldState, key: one, order: "rev", from: ["world"] },
  "/world/changes": { qos: { kind: "reliable" }, body: worldChanges, key: one, order: "rev", from: ["world"] },
  "/world/closer": { qos: { kind: "reliable" }, body: worldCloser, key: by("look"), order: null, from: ["world"] },
  // 새 집 사진(serial)마다 하나: /world/state는 가장 새 것만 남아 받는 쪽이 사진을 건너뛸 수 있다. 기록 노드가 사진마다 한 줄로 남긴다(실영상 판정)
  "/world/household_photo": { qos: { kind: "reliable" }, body: z.strictObject({ photo: householdPhoto }), key: one, order: null, from: ["world"] },
  "/brain/decision": { qos: { kind: "reliable" }, body: checkedDecision, key: one, order: null, from: ["brain"] },
  "/brain/plan_request": { qos: { kind: "reliable" }, body: z.strictObject({ req: id, decision: decisionRecord, ahead: planAhead.optional(), until: at }), key: by("req"), order: null, from: ["act", "goal"] },
  "/brain/plan": { qos: { kind: "reliable" }, body: z.strictObject({ req: id, decision_id: id, result: planResult }), key: by("req"), order: null, from: ["brain"] },
  // 미리 세운 목표(묶음 4 전에는 실행 추적이 낸다): 최신 보기(늦게 붙은 노드·대시보드)와 전환 하나하나(녹화·재생, STATE는 가운데 값을 합칠 수 있다)
  "/brain/goal": { qos: { kind: "state" }, body: brainGoal, key: one, order: "stamp", from: ["goal"] },
  "/brain/goal_changes": { qos: { kind: "reliable" }, body: brainGoal, key: goalKey, order: null, from: ["goal"] },
  "/brain/thought": { qos: { kind: "reliable" }, body: z.strictObject({ home: id, type: z.literal("thought"), messages: z.array(thoughtMessage) }), key: one, order: "stamp", from: ["brain"] },
  "/brain/link_changes": { qos: { kind: "reliable" }, body: pamLink, key: one, order: "stamp", from: ["brain"] },
  "/brain/link": { qos: { kind: "state" }, body: pamLink, key: one, order: "stamp", from: ["brain"] },
  "/brain/cancel": { qos: { kind: "reliable" }, body: z.strictObject({ req: id, decision_id: id }), key: by("req"), order: null, from: ["act", "goal"] },
  "/act/plan": { qos: { kind: "state" }, body: z.strictObject({ plan: wirePlan.nullable() }), key: one, order: "stamp", from: ["act"] },
  "/act/status": { qos: { kind: "state" }, body: actStatus, key: one, order: "stamp", from: ["act"] },
  "/act/log": { qos: { kind: "reliable" }, body: actLog, key: one, order: "stamp", from: ["act"] },
  "/act/beer_observation": { qos: { kind: "reliable" }, body: beerEvent, key: by("device"), order: null, from: ["act"] },
  "/act/assistance_outcome": { qos: { kind: "reliable" }, body: assistanceOutcome, key: (b: Record<string, unknown>) => {
    const key = b.key as AssistanceOutcome["key"];
    return JSON.stringify([b.home, key.boot, key.homeEpoch, key.attemptId]);
  }, order: null, from: ["act"] },
  "/act/phone_changes": { qos: { kind: "reliable" }, body: z.union([phoneCommand, z.strictObject({ plan: wirePlan.nullable() }), z.strictObject({ status: actStatus })]), key: one, order: "stamp", from: ["act"] },
  "/act/phone_command": { qos: { kind: "state" }, body: phoneCommand, key: one, order: "stamp", from: ["act"] },
  "/phone/claim": { qos: { kind: "state" }, body: phoneClaim, key: by("claim_id"), order: "stamp", from: ["act", "phone"] },
  "/phone/owner": { qos: { kind: "state" }, body: phoneOwner, key: one, order: "stamp", from: ["phone"] },
  "/phone/progress": { qos: { kind: "reliable" }, body: phoneProgress, key: by("req"), order: null, from: ["phone"] },
  "/act/progress_result": { qos: { kind: "reliable" }, body: progressResult, key: by("req"), order: null, from: ["act"] },
  "/phone/heard": { qos: { kind: "reliable" }, body: heard, key: one, order: "observed_ms", from: ["phone"] },
  "/phone/say": { qos: { kind: "reliable" }, body: z.strictObject({ text: z.string(), grade: z.literal("safety").optional() }), key: one, order: null, from: ["act", "brain"] },
  "/phone/link": { qos: { kind: "state" }, body: z.strictObject({ ready: z.boolean() }), key: one, order: "stamp", from: ["phone"] },
  "/device/command": { qos: { kind: "reliable" }, body: z.looseObject({ command_id: z.string().min(1), deadline_ms: z.number().finite() }), key: by("command_id"), order: null, from: ["act", "phone"] },
  "/device/result": { qos: { kind: "reliable" }, body: z.looseObject({ command_id: z.string().min(1), status: z.enum(["done", "failed", "expired", "unknown"]) }), key: by("command_id"), order: null, from: ["devices"] },
  "/device/state": { qos: { kind: "state" }, body: obj, key: by("id"), order: "stamp", from: ["devices"] },
  "/device/power_intent": { qos: { kind: "reliable" }, body: z.strictObject({ id, device_id:id, value:z.enum(["on","off"]), origin:z.enum(["automation","user","unknown"]), command_id:id.nullable(), at_ms:at }), key:by("device_id"), order:"stamp", from:["devices"] },
  "/device/changes": { qos: { kind: "reliable" }, body: deviceChange, key: by("id"), order: "stamp", from: ["devices"] },
  "/bus/dead": { qos: { kind: "reliable" }, body: obj, key: by("topic"), order: null, from: NODES },
} as const satisfies Record<string, TopicSpec<Record<string, unknown>>>;

export type TopicName = keyof typeof TOPICS;
export type Body<N extends TopicName> = z.infer<(typeof TOPICS)[N]["body"]>;
