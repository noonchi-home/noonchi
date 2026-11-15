// World State: 엔진 프레임마다 YOLO 감지와 VLM 관찰을 물체별로 합치고, 시간에 따른 변화(등장·사라짐·시야 밖·상태·가전)를 낸다.
// 종류·사실 값·면·신뢰도는 낱말 표(src/world/vocab.ts)를 따른다.
// - 같은 물체: 트윈 위치 + 종류(종류의 identityM, 없으면 기본 0.25m 안). 맞추기 전(카메라 없음)에는 같은 종류의 물체에 차례로 붙인다.
// - 등장·사라짐: Confirmer(시간 기준. 등장은 처음 본 뒤 사람 2초·물건 4초 이어 보임, 사라짐은 마지막으로 본 뒤 시야 안에서 사람 4초·물건 6초 못 봄.
//   2초 간격이면 사람 2장·물건 3장). 사라짐은 그 자리가 시야 안인 프레임만 센다. 등장 확인 전 물체는 view()에 내지 않고, 500ms 넘게 못 보면 잊는다.
// - 가전 설비(TV·냉장고·전자레인지·오븐·토스터·싱크대): 보임·사라짐 없이 방(클로이드 눈의 방)마다 종류 하나. VLM 사실만 쌓고 같은 방 트윈 가전 id를 붙인다.
// - VLM 사실: 면(facet)마다 하나. 그 종류에 없는 면·그 대상에 붙지 않는 값은 버린다. 촬영 시각이 더 오래된 답은 버리고, 같은 값이 연속 두 번이면 confirmed.
//   지금만 맞는 면(vocab NOW_FACETS: 쓰는 중, 사람 들고 있음·하는 일·자리)은 그 대상을 본 프레임의 VLM 답에 없으면 지운다. 사람이 안 보이면 사람 사실을 지운다.
// - 관절(applyDetections의 poses): 손목이 물건 상자 안·가까이면 손에 있음과 사람 물건을 들고 있음, 관절 자세(서 있음·앉아 있음·누워 있음).
//   같은 프레임에서는 관절 사실이 VLM 답보다 앞선다. 손목이 떨어지거나 사람이 안 보이면 관절이 붙인 손에 있음만 지운다.
// - 사람 자리·방: 맞춘 뒤 가장 큰 사람 상자의 발(상자 아래가 프레임 끝에 닿지 않음)이 보이면 그 바닥 자리와 방. 눈의 방으로 대신하지 않는다. 바뀌면 변화 하나.
// - 분석 없음(applyMissing): 셈과 변화 하나만 남기고 등장·사라짐 셈에는 넣지 않는다.
// - 늦게 온 전체 사진: 이미 넣은 가장 새 전체 사진보다 옛 촬영(감지 대기열에서 늦게 나온 프레임)은 통째로 넣지 않는다. 등장·사라짐 셈·자리·보임·사람·가전 설비·관절이
//   그대로이고 감지 번호도 잇지 않는다(그 프레임 VLM 답은 대상 사실을 넣지 않는다). 전체 사진끼리는 촬영 순서로만 들어간다.
// - 가까이 보기(applyCloser, src/observe/pipeline.ts closer): 잘라 본 몇 장을 보통 프레임처럼 넣지 않고 한 번에 합친다. 물건 감지만 쓰고(사람·가전 설비·잘린 경계 상자는 버림),
//   맞는 물건이 없으면 서로 다른 원본 프레임 3장에서 같은 자리로 보이거나, 1장 이상 보이고 같은 가까이 보기의 VLM이 그 감지에 사실을 하나 이상 답하고 가림은 답하지 않아야
//   (두 모델 확인) 새 물건을 만든다. 3장이 안 된 후보는 VLM 답(applyCloserScene)까지 들고 있다가 답이 없거나 끊기면(endCloser) 버린다. 안 보인 물건은 그대로 둔다.
//   이미 있는 물건도 가림을 답한 상자의 사실은 넣지 않는다.
//   가까이 보기와 전체 사진은 서로 촬영 순서가 섞여 들어오므로 물건마다 자리를 마지막으로 고친 촬영 시각과 보임(있음·시야 밖·사라짐)을 마지막으로 판단한
//   촬영 시각·원본 프레임·출처를 둔다. 그보다 옛 촬영은 자리·보임을 되돌리지 않고, 가까이 보기가 더 새 촬영으로 본 물건은 옛 전체 사진의 등장·사라짐 셈에도
//   넣지 않는다. 같은 원본 프레임이면 잘라 본 자리·양성이 앞선다.
//   가까이 보기로 찾거나 고친 물건은 30초(CLOSER_HOLD_MS) 동안 전체 사진에서 못 봐도 사라짐으로 세지 않는다(지킴). 같은 종류 새 물건이 다른 자리에 생기면
//   지킴을 풀고, 한 촬영(전체 사진 한 장·가까이 보기 한 번)에 그런 새 물건이 하나면 옛 물건에 그 id(followed_by)를 남긴다(실행 추적이 새 물건으로 바로 이어 간다.
//   여럿이면 어느 것인지 몰라 남기지 않는다). 옛 물건을 마지막으로 본 촬영·보임 판단보다 옛(같은 촬영 포함)
//   등장은 지킴·옮김 표시를 바꾸지 않는다. 표시를 붙인 촬영보다 새 촬영이나 같은 원본 프레임에서 옛 물건을 다시 보면 표시를 지운다
//   (보임 판단보다 옛 가까이 보기여도: 보임은 되돌리지 않고 표시만 지운다).
//   VLM 답은 원본 프레임·대상·면마다 한 번만 센다(같은 사진을 두 번 판정해 확신으로 오르지 않게). 같은 원본 프레임·대상·면이면 오는 순서와 상관없이
//   잘라 본 사진의 답(applyCloserScene)이 전체 사진 답보다 앞선다. 잘라 본 답은 그 사진에서 잡은 물건 사실만 넣고 요약·다른 사실을 지우지 않는다.
//   잘라 본 답이 면 값을 새로 넣거나 바꾸면 그 면의 가까이 보기 횟수(closer_rev)를 올린다. 지금 값의 출처와 따로 남아 전체 사진이 값을 바꿔도 줄지 않는다.
// - 가전: 모든 가전의 상태 키(vocab DEVICE_STATES), 바뀐 속성의 이력, 사건 줄(세탁 끝남), 남은 시간, 오래 이어진 상태(tick: 냉장고 문 1분).
// - 카메라로 가전 상태 맞추기(src/world/sight.ts): 가전 설비 상자마다 그 사진의 방·시야·상자 방향으로 트윈 가전 하나를 고르고(못 고르면 설비 link에 까닭),
//   그 프레임 VLM 답의 값이 연속으로 이어지면 see(허브 observe)로 넘긴다. 카메라로 본 값이 상태가 된 가전 줄은 「카메라로 봄」을 붙이고, 실제 상태와 다르면 다름 줄 하나.
import type { EyePose } from "../contract/events.js";
import type {
  Facet, FixtureClass, ObjClass, VlmMissing, WorldChange, WorldDevice, WorldEye, WorldFact, WorldFixture, WorldObject, WorldPerson, WorldView, YoloMissing,
} from "../contract/world.js";
import type { Detection, Pose } from "../brain/detector.js";
import type { DeviceState, VisionResult, VisionSeen } from "../hub/types.js";
import type { EngineFrame } from "../observe/ring.js";
import type { CameraView } from "../phone/session.js";
import type { SceneObservation } from "../observe/scene.js";
import { Confirmer, EVIDENCE_GAP_MS, EVIDENCE_STEP_MS } from "./confirm.js";
import { CHANGE_TEXT, HEARD_MAX, OBJECT_NAME, fixtureName, objectName, onSurface } from "./labels.js";
import { inView, placeBox, placePoint, type PlaneSurface } from "./place.js";
import { describePose, heldByAny, mainPerson } from "./pose.js";
import { RemainingTracker, becameKey, deviceStateKeys, deviceStatus, deviceText, relatedDeviceIds } from "./relations.js";
import { SightReadings, linkDevice, rulesOf, sightValues, type SightLink } from "./sight.js";
import { cameraKindOf, kindEntry } from "../model/kinds.js";
import {
  CLASSES, DEVICE_LONG, DEVICE_STATES, FACT_FRESH_MS, FRESH_MS, NEAR_M, NOW_FACETS, POSE_HOLD, POSE_POSTURE, STATES, VLM_ONLY, type ClassKey, type DeviceLongKey, type DeviceStateKey, type StateKey, type Target,
} from "./vocab.js";

type V3 = [number, number, number];
type Plan2 = [number, number];
type Facts = Partial<Record<Facet, WorldFact>>;

const KEYS = Object.keys(CLASSES) as ClassKey[];
const OBJ_CLASSES: ReadonlySet<string> = new Set(KEYS.filter((k) => CLASSES[k].role === "object"));
const FIXTURE_CLASSES: ReadonlySet<string> = new Set(KEYS.filter((k) => CLASSES[k].role === "fixture"));
const PERSON = "person";
const HISTORY_MAX = 20;
/** 사라진 물체를 이만큼 두었다가 잊는다(같은 자리에 다시 보이면 같은 id로 돌아온다). */
const GONE_KEEP_MS = 600_000;
/** 상자 아래가 프레임 높이의 이 비율보다 아래면 발이 잘린 것으로 본다. */
const FEET_EDGE = 0.98;
/** VLM 답이 오지 않은 프레임의 가전 맞춤은 이만큼(촬영 시각 기준) 두었다가 버린다. */
const LINK_KEEP_MS = 60_000;
/** 가까이 보기로 찾거나 고친 물건은 이만큼(ms, 촬영 시각 기준) 전체 사진에서 못 봐도 사라짐으로 세지 않는다(전체 사진의 감지기는 그 물건을 못 본다). */
export const CLOSER_HOLD_MS = 30_000;
/** 가까이 보기로 VLM 확인 없이 새 물건을 만들려면 같은 자리로 보인 서로 다른 원본 프레임이 이만큼 있어야 한다(물건 등장 확인 장수와 같다).
 *  이보다 적으면 같은 가까이 보기의 VLM이 그 감지에 사실을 답해야 만든다(CloserPending). */
export const CLOSER_NEW_FRAMES = 3;
/** VLM 답을 원본 프레임·대상·면마다 한 번만 세려고 기억하는 수(넣은 순서, 최근 것). */
const ANSWERS_KEEP = 4000;

/** 가까이 본 한 장의 감지: 상자는 엔진 프레임 픽셀, edge는 잘라 본 상자 경계에 닿음(src/observe/crop.ts onCropEdge). */
export interface CloserDetection extends Detection { edge: boolean }
/** 가까이 본 한 장: 원본 엔진 프레임 id·촬영 시각·카메라·크기와 그 잘라 본 사진의 감지. */
export interface CloserPass { frameId: string; capturedAtMs: number; view: CameraView; width: number; height: number; dets: CloserDetection[] }
/** 가까이 본 한 장의 물건 감지 하나: 그 장, 감지 번호(d1…), 트윈 자리. */
interface CloserSeen { pass: CloserPass; tmp: string; position: V3; surface: string | null; part: "basin" | null; errorM: number | null }
/** 가까이 보기 한 번에서 같은 종류·같은 자리로 묶인 감지(장마다 하나, 촬영 순서). */
interface CloserGroup { cls: ObjClass; seen: CloserSeen[] }
/** 한 묶음(전체 사진 한 장·가까이 보기 한 번)에서 등장을 확인한 새 물건과 그 촬영(옮김 처리 liftHolds). */
interface Fresh { obj: Obj; at: number; frame: string }
/** 가까이 보기 한 번의 새 물건 후보(applyCloser): 맞는 물건이 없고 같은 자리로 보인 서로 다른 원본 프레임이 CLOSER_NEW_FRAMES장보다 적은 묶음 중
 *  VLM에 보낸 장(idsFrom)에 보인 것. 그 장의 VLM 답(applyCloserScene)이 그 감지 번호에 사실을 하나 이상 답하고 가림(not_visible)은 답하지 않은 후보만
 *  확인된 물건이 되고, VLM 답 없이 끝나면(endCloser) 버린다. 이번 가까이 보기의 옮김 처리(지킴 풀기·옮김 표시)는 후보와 함께 하려고 그때까지 미룬다. 한 번만 쓴다. */
export interface CloserPending {
  /** VLM에 보낸 장의 감지 번호 → 후보 묶음. */
  readonly candidates: ReadonlyMap<string, CloserGroup>;
  /** 이번 가까이 보기에서 맞추거나 만든 물건 id. */
  readonly used: ReadonlySet<string>;
  /** 이번 가까이 보기에서 CLOSER_NEW_FRAMES장으로 만든 물건. */
  readonly created: readonly Fresh[];
}

interface Obj {
  id: string;
  cls: ObjClass;
  position: V3 | null;
  surface: string | null;
  surfaceLabel: string | null;
  /** 그 면 안의 자리(싱크볼 안이면 basin). */
  part: "basin" | null;
  room: string | null;
  errorM: number | null;
  /** 등장을 확인했는가(아니면 세는 중). */
  confirmed: boolean;
  status: WorldObject["status"];
  firstSeen: number;
  lastSeen: number;
  lastInView: number;
  goneAt: number | null;
  facts: Facts;
  answered: number | null;
  /** 가까이 보기로 마지막에 찾거나 고친 촬영 시각(지킴의 시작). 지킴이 풀리면 null. */
  closerAt: number | null;
  /** 자리를 마지막으로 고친 촬영 시각과 그것이 가까이 보기였는가(같은 촬영이면 잘라 본 자리가 앞선다). */
  posAt: number;
  posCloser: boolean;
  /** 보임(있음·시야 밖·사라짐)을 마지막으로 판단한 촬영 시각: 전체 사진이 보거나, 시야 밖이거나, 사라짐·등장을 확인한 촬영과 가까이 보기로 본 촬영.
   *  이보다 옛 촬영은 보임을 바꾸지 않고 등장·사라짐 셈에도 들어가지 않는다(넣는 전체 사진보다 새 판단은 가까이 보기에서만 나온다). 시야 안인데 못 본 프레임(사라짐 셈 중)은 판단이 아니다:
   *  전체 사진의 감지기는 싱크대 안 컵을 못 보므로 그것을 판단으로 치면 가까이 보기가 지킴을 둘 수 없다. */
  judgedAt: number;
  /** 그 판단의 원본 프레임 id와 그것이 가까이 보기 양성이었는가(같은 원본 프레임이면 잘라 본 양성이 전체 사진 판단보다 앞선다). */
  judgedFrame: string;
  judgedCloser: boolean;
  /** 지킴 중에 같은 종류 새 물건이 다른 자리에 생겼다: 그 물건 id와 촬영 시각·원본 프레임. 그보다 새 촬영이나 같은 원본 프레임에서 이 물건을 다시 보면 null. */
  followed: { id: string; at: number; frame: string } | null;
  /** 면마다 가까이 보기 VLM 답이 값을 새로 넣거나 바꾼 횟수(지금 값의 출처와 따로 남는다). */
  closerRev: Partial<Record<Facet, number>>;
}

interface Fix {
  id: string; cls: FixtureClass; room: string | null; roomLabel: string | null; firstSeen: number; lastSeen: number; facts: Facts; answered: number | null;
  /** 카메라로 트윈 가전에 맞춘 마지막 결과와 그 촬영 시각. */
  link: (SightLink & { at_ms: number }) | null;
}

interface Dev {
  id: string; kind: string; label: string; twin: Record<string, unknown>; status: string | null; state: DeviceStateKey[]; changed: number; eventAt: number | null;
  /** 지금 상태 키마다 그 상태가 된 시각. */
  since: Partial<Record<DeviceStateKey, number>>;
  /** 이미 낸 오래 이어진 사건(규칙@시작 시각). */
  long: Set<string>;
  history: WorldDevice["history"]; known: boolean;
  /** 지금 상태가 카메라로 본 것이면 그 기록(허브 vision, applied). */
  vision: VisionSeen | null;
}

export interface WorldStateOptions {
  surfaces: () => PlaneSurface[];
  floorAt: (p: Plan2) => number;
  /** 평면 위 점이 있는 방(id와 이름). 집 밖이면 null. */
  roomAt: (p: Plan2) => { id: string; label: string } | null;
  /** 가전 목록. room은 방 id(가전 설비를 같은 방 가전에 붙인다), twinAttrs는 트윈 속성(카메라로 넘길 속성이 있는지). */
  devices: () => readonly { id: string; kind: string; label: string; room?: string; twinAttrs?: Readonly<Record<string, readonly unknown[]>> }[];
  /** 가전 평면 자리 [x, y](사람 가까이). 모르면 null. */
  locate?: (id: string) => Plan2 | null;
  /** 가전 가운데 트윈 자리 [x, 높이, y](카메라로 가전을 고를 때 시야·방향). 없거나 모르면 그 가전을 고르지 않는다. */
  place?: (id: string) => V3 | null;
  /** 카메라로 이어 본 가전 상태를 허브에 넘긴다(src/hub/signals.ts observe). 없으면 넘기지 않는다. */
  see?: (id: string, twin: Record<string, unknown>, atMs: number) => VisionResult;
  /** 같은 물체로 볼 기본 거리(m, 기본 0.25). 종류에 identityM이 있으면 그 값. */
  identityM?: number;
  /** 등장·사라짐·관절 사실 확인에서 한 장으로 치는 시간(ms, 기본 EVIDENCE_STEP_MS 2000). 장면을 다른 간격(1초)으로 적은 시험이 그 간격을 준다. */
  evidenceStepMs?: number;
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const dist = (a: V3, b: V3) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const area = (b: Detection["box"]) => Math.max(0, b[2]) * Math.max(0, b[3]);

/** 이 값이 그 종류·대상에 붙는가. */
function fits(value: StateKey, cls: ClassKey, target: Target): boolean {
  const s = STATES[value];
  return (s.for as readonly Target[]).includes(target) && (CLASSES[cls].facets as readonly Facet[]).includes(s.facet);
}

export class WorldState {
  private readonly objects = new Map<string, Obj>();
  private readonly fixtures = new Map<string, Fix>();
  private readonly counters = new Map<string, number>();
  private readonly confirmer: Confirmer;
  private readonly stepMs: number;
  private readonly person: {
    visible: boolean; since_ms: number | null; last_seen_ms: number | null; count: number; room: { id: string; label: string } | null; position: Plan2 | null; positionAt: number | null;
    facts: Facts; answered: number | null;
  } = { visible: false, since_ms: null, last_seen_ms: null, count: 0, room: null, position: null, positionAt: null, facts: {}, answered: null };
  private readonly devs = new Map<string, Dev>();
  private readonly remaining = new RemainingTracker();
  private eye: WorldEye | null = null;
  private summary = "";
  private summaryAt = Number.NEGATIVE_INFINITY;
  private vlmMissing = 0;
  private yoloMissing = 0;
  private frameAt: number | null = null;
  /** 관절로 마지막에 든 물건 id(확인 전 물건 포함). */
  private heldIds: string[] = [];
  /** 관절이 붙인 사실(그 사실 객체). VLM이 같은 면을 다시 쓰면 새 객체라 빠진다. */
  private readonly byPose = new WeakSet<WorldFact>();
  private readonly identityM: number;
  /** 프레임 id → 감지 번호마다 카메라로 고른 가전(그 프레임 VLM 답이 올 때까지). */
  private readonly links = new Map<string, { at: number; dets: Map<string, { cls: FixtureClass; link: SightLink }> }>();
  /** 가전마다 카메라로 이어 본 값의 수. */
  private readonly readings = new SightReadings();
  /** 가전마다 카메라로 마지막으로 본 촬영 시각. */
  private readonly sighted = new Map<string, number>();
  /** 원본 프레임·대상·면(「e3|cup_1|place」)마다 넣은 VLM 답이 전체 사진(full)인지 잘라 본 사진(crop)인지(넣은 순서, 최근 ANSWERS_KEEP개). */
  private readonly answers = new Map<string, "full" | "crop">();
  /** 이미 끝낸 가까이 보기 후보(applyCloserScene·endCloser는 한 번만 쓴다). */
  private readonly closerDone = new WeakSet<CloserPending>();

  constructor(private readonly o: WorldStateOptions) {
    this.identityM = o.identityM ?? 0.25;
    this.stepMs = o.evidenceStepMs ?? EVIDENCE_STEP_MS;
    this.confirmer = new Confirmer((key) => (key === PERSON ? 2 : 3), this.stepMs);
  }

  /** 이 감지를 받는가: 낱말 표의 사람·물건·가전 설비 종류이고 그 종류의 최소 신뢰도 이상. 관찰 흐름은 받는 감지만 상자·YOLO 글·VLM 감지 목록에 싣는다. */
  accepts(d: Pick<Detection, "label" | "score">): boolean {
    const c = (CLASSES as Record<string, (typeof CLASSES)[ClassKey] | undefined>)[d.label];
    return !!c && c.role !== "scene" && d.score >= c.minScore;
  }

  /** 첫 프레임 시각을 사람 「안 보임」의 시작으로 둔다. */
  private start(atMs: number): void {
    if (this.person.since_ms === null) this.person.since_ms = atMs;
  }

  private create(cls: ObjClass, atMs: number, frameId: string): Obj {
    const n = (this.counters.get(cls) ?? 0) + 1;
    this.counters.set(cls, n);
    const obj: Obj = {
      id: `${cls}_${n}`, cls, position: null, surface: null, surfaceLabel: null, part: null, room: null, errorM: null, confirmed: false, status: "present",
      firstSeen: atMs, lastSeen: atMs, lastInView: atMs, goneAt: null, facts: {}, answered: null, closerAt: null,
      posAt: Number.NEGATIVE_INFINITY, posCloser: false, judgedAt: atMs, judgedFrame: frameId, judgedCloser: false, followed: null, closerRev: {},
    };
    this.objects.set(obj.id, obj);
    return obj;
  }

  /** 가까이 보기 지킴 중인가(atMs 기준 CLOSER_HOLD_MS 안). 지킴보다 앞서 찍힌 사진도 지킴으로 본다. */
  private held(obj: Obj, atMs: number): boolean {
    return obj.closerAt !== null && atMs - obj.closerAt < CLOSER_HOLD_MS;
  }

  /** 같은 종류 새 물건이 다른 자리에 생겼다(옮김): 한 묶음(전체 사진 한 장·가까이 보기 한 번)에서 등장을 확인한 새 물건(그 촬영 시각)으로
   *  같은 종류 다른 물건의 지킴을 푼다. 지킴 중이던 물건에는 그 묶음에서 다른 자리에 생긴 같은 종류 새 물건이 하나일 때만 그 id를 남긴다(여럿이면 어느 것인지 모른다).
   *  saw: 같은 묶음에서 본 물건(옮긴 것이 아니라 그대로 둔다). 그 물건을 마지막으로 본 촬영·보임 판단보다 옛(같은 촬영 포함) 등장은 지킴·옮김 표시를 바꾸지 않는다. */
  private liftHolds(fresh: readonly Fresh[], saw: ReadonlySet<string>): void {
    if (!fresh.length) return;
    for (const o of this.objects.values()) {
      if (o.closerAt === null || saw.has(o.id)) continue;
      const near = (CLASSES[o.cls] as { identityM?: number }).identityM ?? this.identityM;
      const moved = fresh.filter(({ obj, at }) => obj !== o && obj.cls === o.cls && at > o.lastSeen && at >= o.judgedAt
        && !(o.position && obj.position && dist(o.position, obj.position) <= near));
      if (!moved.length) continue;
      const at = Math.max(...moved.map((m) => m.at));
      const one = moved.length === 1 ? moved[0]! : null;
      if (one && o.status !== "gone" && this.held(o, at)) o.followed = { id: one.obj.id, at: one.at, frame: one.frame };
      o.closerAt = null;
    }
  }

  /** 이 촬영(원본 프레임 frameId)에서 물건을 다시 봤다: 옮김 표시를 붙인 촬영보다 새 촬영이거나 같은 원본 프레임이면 표시를 지운다
   *  (같은 원본 프레임에서 보였으면 새 물건과 함께 있었다). */
  private sawAgain(obj: Obj, atMs: number, frameId: string): void {
    const f = obj.followed;
    if (f && (atMs > f.at || (atMs === f.at && frameId === f.frame))) obj.followed = null;
  }

  /** 보임을 이 촬영(원본 프레임 frameId, closer면 가까이 보기 양성)으로 판단했다: 마지막 판단보다 새 촬영이면 그것으로 바꾸고,
   *  같은 원본 프레임의 가까이 보기 양성이면 출처만 가까이 보기로 올린다. */
  private judge(obj: Obj, at: number, frameId: string, closer: boolean): void {
    if (at > obj.judgedAt) {
      obj.judgedAt = at;
      obj.judgedFrame = frameId;
      obj.judgedCloser = closer;
    } else if (at === obj.judgedAt && closer && obj.judgedFrame === frameId) obj.judgedCloser = true;
  }

  /** 이 전체 사진은 보임을 바꾸지 못하는가: 마지막 보임 판단보다 옛 촬영이거나(가까이 보기가 더 새 촬영으로 봤다), 같은 원본 프레임을 잘라 본 양성이 그 판단이다.
   *  그런 사진은 그 물건의 등장·사라짐 셈에도 넣지 않는다(셈을 늘리지도 끊지도 않는다). */
  private staleFull(obj: Obj, at: number, frameId: string): boolean {
    return at < obj.judgedAt || (at === obj.judgedAt && obj.judgedCloser && obj.judgedFrame === frameId);
  }

  /** 이 가까이 본 촬영이 보임을 바꿀 수 있는가: 마지막 보임 판단보다 새 촬영이거나, 같은 원본 프레임의 전체 사진 판단이다(잘라 본 양성이 앞선다). */
  private newerCloser(obj: Obj, at: number, frameId: string): boolean {
    return at > obj.judgedAt || (at === obj.judgedAt && !obj.judgedCloser && obj.judgedFrame === frameId);
  }

  /** 자리를 고칠 촬영인가: 자리를 마지막으로 고친 촬영보다 새면. 같은 촬영이면 잘라 본 자리가 전체 사진 자리보다 앞선다. */
  private newerPlace(obj: Obj, atMs: number, closer: boolean): boolean {
    return atMs > obj.posAt || (atMs === obj.posAt && closer && !obj.posCloser);
  }

  /** 트윈 자리로 맞추기만(가까이 보기): 같은 종류 중 그 종류 거리 안의 가장 가까운 것(사라진 것·세는 중인 것도). */
  private nearest(cls: ObjClass, position: V3, used: ReadonlySet<string>): Obj | null {
    const near = (CLASSES[cls] as { identityM?: number }).identityM ?? this.identityM;
    let best: { obj: Obj; d: number } | null = null;
    for (const x of this.objects.values()) {
      if (x.cls !== cls || used.has(x.id) || !x.position) continue;
      const d = dist(x.position, position);
      if (d <= near && (!best || d < best.d)) best = { obj: x, d };
    }
    return best?.obj ?? null;
  }

  /** 같은 물체 찾기. 위치가 있으면 같은 종류 중 그 종류 거리 안의 가장 가까운 것(사라진 것도), 없으면 사라지지 않은 같은 종류를 처음 본 순서로. */
  private match(cls: ObjClass, position: V3 | null, used: ReadonlySet<string>): Obj | null {
    const pool = [...this.objects.values()].filter((x) => x.cls === cls && !used.has(x.id));
    const near = (CLASSES[cls] as { identityM?: number }).identityM ?? this.identityM;
    if (position) {
      let best: { obj: Obj; d: number } | null = null;
      for (const x of pool) {
        if (!x.position) continue;
        const d = dist(x.position, position);
        if (d <= near && (!best || d < best.d)) best = { obj: x, d };
      }
      if (best) return best.obj;
      return pool.find((x) => x.status !== "gone" && !x.position) ?? null;
    }
    return pool.filter((x) => x.status !== "gone").sort((a, b) => Number(b.confirmed) - Number(a.confirmed) || a.firstSeen - b.firstSeen)[0] ?? null;
  }

  /** 시야 판단: 카메라가 없으면(맞추기 전) 시야 안, 카메라가 있는데 위치를 모르면 모름(null). */
  private visible(obj: Obj, view: EngineFrame["view"]): boolean | null {
    if (!view) return true;
    if (!obj.position) return null;
    return inView(view, obj.position);
  }

  private name(obj: Obj): string {
    return objectName(obj.cls, obj.id);
  }

  /** 가전 설비 하나: 그 사진을 찍은 클로이드 눈의 방마다 종류 하나(tv_living). */
  private fixture(cls: FixtureClass, atMs: number, room: { id: string; label: string } | null): Fix {
    const id = `${cls}_${room?.id ?? "room"}`;
    let f = this.fixtures.get(id);
    if (!f) {
      f = { id, cls, room: room?.id ?? null, roomLabel: room?.label ?? null, firstSeen: atMs, lastSeen: atMs, facts: {}, answered: null, link: null };
      this.fixtures.set(id, f);
    }
    f.lastSeen = atMs;
    return f;
  }

  /** 가전 설비 상자 하나를 트윈 가전에 맞춰 두고(등록부 camera가 있는 설비만), 그 프레임 VLM 답을 기다린다. */
  private sight(frame: EngineFrame, tmp: string, fix: Fix, box: Detection["box"], room: { id: string } | null): void {
    if (!rulesOf(fix.cls).length) return;
    const at = frame.capturedAtMs;
    const link = linkDevice({
      cls: fix.cls, box, size: { width: frame.width, height: frame.height }, view: frame.view, room: room?.id ?? null, devices: this.o.devices(), place: this.o.place ?? (() => null),
    });
    fix.link = { ...link, at_ms: at };
    if (link.device) this.sighted.set(link.device, at);
    let m = this.links.get(frame.id);
    if (!m) {
      m = { at, dets: new Map() };
      this.links.set(frame.id, m);
    }
    m.dets.set(tmp, { cls: fix.cls, link });
  }

  /** 그 프레임 VLM 답에서 고른 가전의 값을 읽고, 이어 본 값은 허브에 넘긴다. 실제 상태와 처음 다르면 다름 줄(판단 계기 아님). */
  private seeDevices(frameId: string, capturedAtMs: number, scene: SceneObservation): WorldChange[] {
    const m = this.links.get(frameId);
    this.links.delete(frameId);
    for (const [id, x] of this.links) if (x.at < capturedAtMs - LINK_KEEP_MS) this.links.delete(id);
    if (!m) return [];
    const stable: [string, Record<string, unknown>][] = [];
    for (const [tmp, { cls, link }] of m.dets) {
      const device = link.device;
      if (!device) continue;
      const said = scene.observations.filter((o) => o.object_id === tmp).map((o) => o.state as string);
      if (said.some((s) => (VLM_ONLY as readonly string[]).includes(s))) continue; // 가렸다: 답이 아니다
      const keys = said.filter((s): s is StateKey => s in STATES && fits(s as StateKey, cls, "fixture"));
      const values = sightValues(cls, keys, this.o.devices().find((d) => d.id === device)?.twinAttrs);
      const kept = Object.entries(values).filter(([attr, v]) => this.readings.read(device, attr, v, capturedAtMs));
      if (kept.length) stable.push([device, Object.fromEntries(kept)]);
    }
    const changes: WorldChange[] = [];
    for (const [id, twin] of stable) {
      const r = this.o.see?.(id, twin, capturedAtMs);
      if (r?.kind !== "mismatch") continue;
      const spec = this.o.devices().find((d) => d.id === id);
      const text = (t: Record<string, unknown>) => deviceStatus(spec?.kind ?? "", t) ?? Object.entries(t).map(([a, v]) => `${a} ${String(v)}`).join(" · ");
      const seen = Object.fromEntries(Object.keys(r.real).map((a) => [a, twin[a]]));
      changes.push({ kind: "device", at_ms: capturedAtMs, subject: id, meaningful: false, text: CHANGE_TEXT.deviceMismatch(spec?.label ?? id, text(seen), text(r.real)) });
    }
    return changes;
  }

  /** poses: 이 프레임의 관절(YOLO26-pose). 없으면(관절 모델이 없거나 사람이 없어 돌리지 않음) 자세·손에 듦을 보지 않는다.
   *  이미 넣은 가장 새 전체 사진보다 옛 촬영(감지 대기열에서 늦게 나온 프레임)은 넣지 않고 변화·감지 번호 없이 돌려준다. */
  applyDetections(frame: EngineFrame, dets: Detection[], poses?: Pose[]): { changes: WorldChange[]; ids: Map<string, string> } {
    const at = frame.capturedAtMs;
    if (this.frameAt !== null && at < this.frameAt) return { changes: [], ids: new Map() };
    this.start(at);
    this.frameAt = at;
    const view = frame.view;
    const surfaces = view ? this.o.surfaces() : [];
    const ids = new Map<string, string>();
    const seen = new Set<string>();
    const used = new Set<string>();
    const boxes: { obj: Obj; box: Detection["box"] }[] = [];
    const people: Detection[] = [];
    const eyeRoom = frame.eye ? this.o.roomAt([frame.eye.position[0], frame.eye.position[1]]) : null;
    dets.forEach((d, i) => {
      const tmp = `d${i + 1}`;
      if (!this.accepts(d)) return;
      if (d.label === "person") {
        ids.set(tmp, PERSON);
        seen.add(PERSON);
        people.push(d);
        return;
      }
      if (FIXTURE_CLASSES.has(d.label)) {
        const fix = this.fixture(d.label as FixtureClass, at, eyeRoom);
        ids.set(tmp, fix.id);
        if (frame.vlm !== false) this.sight(frame, tmp, fix, d.box, eyeRoom); // 카메라로 가전 맞추기는 그 프레임 VLM 답이 쓴다: 빠른 프레임은 답이 없다
        return;
      }
      if (!OBJ_CLASSES.has(d.label)) return;
      const cls = d.label as ObjClass;
      const placed = view ? placePoint(view, d.foot, { width: frame.width, height: frame.height }, surfaces, this.o.floorAt) : null;
      const obj = this.match(cls, placed?.position ?? null, used) ?? this.create(cls, at, frame.id);
      used.add(obj.id);
      ids.set(tmp, obj.id);
      seen.add(obj.id);
      boxes.push({ obj, box: d.box });
      obj.lastSeen = Math.max(obj.lastSeen, at);
      obj.lastInView = Math.max(obj.lastInView, at);
      this.judge(obj, at, frame.id, false);
      this.sawAgain(obj, at, frame.id);
      // 가까이 보기가 더 새 촬영(같은 촬영이면 잘라 본 자리)으로 고친 자리를 되돌리지 않는다
      if (placed?.position && this.newerPlace(obj, at, false)) {
        obj.position = placed.position;
        obj.surface = placed.surface;
        obj.surfaceLabel = placed.surface ? surfaces.find((s) => s.id === placed.surface)?.label ?? null : null;
        obj.part = placed.part;
        obj.errorM = placed.errorM;
        obj.room = this.o.roomAt([placed.position[0], placed.position[2]])?.id ?? null;
        obj.posAt = at;
        obj.posCloser = false;
      }
    });
    if (seen.has(PERSON)) {
      this.person.last_seen_ms = at;
      this.person.count = people.length;
      this.locatePerson(frame, people);
    }

    const present = [...this.objects.values()].filter((x) => x.confirmed && x.status !== "gone").map((x) => x.id);
    const candidates = this.person.visible ? [...present, PERSON] : present;
    // 가까이 보기가 이 프레임보다 새 촬영(같은 원본 프레임이면 잘라 본 양성)으로 본 물건은 이 프레임을 등장·사라짐 셈에 넣지 않는다(늘리지도 끊지도 않음)
    const stale = (key: string) => {
      const obj = key === PERSON ? undefined : this.objects.get(key);
      return !!obj && this.staleFull(obj, at, frame.id);
    };
    // 가까이 보기 지킴 중인 물건은 그 자리가 시야 안이어도 사라짐을 세지 않는다
    const events = this.confirmer.observe(at, seen, candidates, (key) => {
      if (key === PERSON) return true;
      const obj = this.objects.get(key)!;
      return !this.held(obj, at) && this.visible(obj, view) === true;
    }, stale);
    const changes: WorldChange[] = [];
    const fresh: { obj: Obj; at: number; frame: string }[] = [];
    for (const e of events) {
      if (e.key === PERSON) {
        this.person.visible = e.kind === "appeared";
        this.person.since_ms = at;
        if (e.kind === "gone") {
          this.person.facts = {};
          this.person.count = 0;
          this.heldIds = [];
          for (const o of this.objects.values()) this.dropPoseFact(o.facts, "place", POSE_HOLD.object); // 사람이 없으면 손에 있을 수 없다
        }
        changes.push({ kind: e.kind === "appeared" ? "person_appeared" : "person_gone", at_ms: at, subject: PERSON, meaningful: true,
          text: e.kind === "appeared" ? CHANGE_TEXT.personAppeared : CHANGE_TEXT.personGone });
        continue;
      }
      const obj = this.objects.get(e.key)!;
      this.judge(obj, at, frame.id, false);
      if (e.kind === "appeared") {
        obj.confirmed = true;
        obj.status = "present";
        obj.goneAt = null;
        fresh.push({ obj, at, frame: frame.id });
        changes.push({ kind: "appeared", at_ms: at, subject: obj.id, meaningful: true, text: CHANGE_TEXT.appeared(this.name(obj), obj.surfaceLabel ? onSurface(obj.surfaceLabel) : null) });
      } else {
        obj.status = "gone";
        obj.goneAt = at;
        for (const f of NOW_FACETS.object) delete obj.facts[f];
        changes.push({ kind: "gone", at_ms: at, subject: obj.id, meaningful: true, text: CHANGE_TEXT.gone(this.name(obj)) });
      }
    }
    // 이 프레임에서 등장한 새 물건이 다른 자리 같은 종류 물건의 지킴을 푼다(이 프레임에서 본 물건은 그대로)
    this.liftHolds(fresh, seen);
    for (const obj of this.objects.values()) {
      if (!obj.confirmed) {
        if (!seen.has(obj.id) && at - obj.lastSeen >= EVIDENCE_GAP_MS) this.forget(obj.id);   // 세는 중에 500ms 넘게 못 보면 잊는다(한두 장 놓친 것은 둔다)
        continue;
      }
      if (obj.status === "gone") {
        if (obj.goneAt !== null && at - obj.goneAt > GONE_KEEP_MS) this.forget(obj.id);
        continue;
      }
      const vis = seen.has(obj.id) ? true : this.visible(obj, view);
      // 가까이 보기가 더 새 촬영이나 같은 원본 프레임 양성으로 본 물건은 있음·시야 밖을 바꾸지 않는다
      if (stale(obj.id)) continue;
      if (vis === true) {
        obj.lastInView = Math.max(obj.lastInView, at);
        if (obj.status === "out_of_view") {
          obj.status = "present";
          this.judge(obj, at, frame.id, false);
          changes.push({ kind: "back_in_view", at_ms: at, subject: obj.id, meaningful: false, text: CHANGE_TEXT.backInView(this.name(obj)) });
        }
      } else if (vis === false) {
        this.judge(obj, at, frame.id, false);
        if (obj.status === "present") {
          obj.status = "out_of_view";
          changes.push({ kind: "out_of_view", at_ms: at, subject: obj.id, meaningful: false, text: CHANGE_TEXT.outOfView(this.name(obj)) });
        }
      }
    }
    // 사람 방: 보이는 동안 바뀌거나 사람이 막 보이면 변화 하나
    const next = this.nextRoom;
    this.nextRoom = undefined;
    const appeared = events.some((e) => e.key === PERSON && e.kind === "appeared");
    if (next === null) this.person.room = null;
    else if (next && next.id !== this.person.room?.id) {
      this.person.room = next;
      if (this.person.visible) changes.push(this.roomChange(at));
    } else if (appeared && this.person.room) changes.push(this.roomChange(at));
    if (poses) this.applyPose(at, poses, boxes, changes);
    return { changes, ids };
  }

  /** 사람 자리·방: 맞춘 뒤 가장 큰 사람 상자의 발이 보이면 그 바닥 자리와 방. 방 반영은 applyDetections 끝에서. */
  private locatePerson(frame: EngineFrame, people: Detection[]): void {
    const main = people.reduce((a, b) => (b.score * area(b.box) > a.score * area(a.box) ? b : a));
    const feet = main.box[1] + main.box[3] < frame.height * FEET_EDGE;
    const placed = frame.view && feet ? placeBox(frame.view, main.box, { width: frame.width, height: frame.height }, [], this.o.floorAt) : null;
    if (!placed?.position) return;
    const position: Plan2 = [placed.position[0], placed.position[2]];
    this.person.position = position;
    this.person.positionAt = frame.capturedAtMs;
    this.nextRoom = this.o.roomAt(position);
  }

  /** 이번 프레임의 발 자리에서 본 방. undefined는 새 발 자리 없음, null은 집 안 방이 아님(방을 모름으로). */
  private nextRoom: { id: string; label: string } | null | undefined = undefined;

  private roomChange(at: number): WorldChange {
    return { kind: "person_room", at_ms: at, subject: PERSON, meaningful: true, text: CHANGE_TEXT.personRoom(this.person.room!.label) };
  }

  /** 관절로 본 사실(규칙: src/world/pose.ts). 어느 관절이든 손목이 물건 상자 안·가까이면 그 물건 손에 있음과 사람 물건을 들고 있음,
   *  자세는 가장 확실한 한 사람의 서 있음·앉아 있음·누워 있음.
   *  손목이 보이는데 든 것이 없으면 관절이 붙인 손에 있음·들고 있음만 지운다(VLM이 붙인 사실은 둔다). */
  private applyPose(at: number, poses: Pose[], boxes: { obj: Obj; box: Detection["box"] }[], changes: WorldChange[]): void {
    const person = mainPerson(poses);
    if (!person) return;
    const people = poses.map(describePose);
    const wrists = people.some((p) => Object.keys(p.wrists).length > 0);
    const held: string[] = [];
    for (const { obj, box } of boxes) {
      if (!heldByAny(people, box)) {
        if (wrists) this.dropPoseFact(obj.facts, "place", POSE_HOLD.object);
        continue;
      }
      held.push(obj.id);
      if (this.setPoseFact(obj.facts, "place", POSE_HOLD.object, at) && obj.confirmed && obj.status !== "gone") {
        changes.push({ kind: "state", at_ms: at, subject: obj.id, meaningful: true, text: CHANGE_TEXT.state(this.name(obj), POSE_HOLD.object) });
      }
    }
    const personFact = (facet: Facet, value: string) => {
      if (this.setPoseFact(this.person.facts, facet, value, at) && this.person.visible) {
        changes.push({ kind: "person_state", at_ms: at, subject: PERSON, meaningful: false, text: CHANGE_TEXT.state(OBJECT_NAME.person!, value) });
      }
    };
    if (held.length) {
      personFact("holding", POSE_HOLD.person);
      this.heldIds = held; // 확인 전 물건도 든다: 무엇을 들었는지는 id 앞 종류로 본다
    } else if (wrists) {
      this.dropPoseFact(this.person.facts, "holding", POSE_HOLD.person);
      this.heldIds = [];
    }
    const posture = (POSE_POSTURE as Record<string, string | undefined>)[person.posture];
    if (posture && person.level !== "low") personFact("posture", posture);
  }

  private setPoseFact(facts: Facts, facet: Facet, value: string, atMs: number): boolean {
    // 관절은 프레임마다 오므로 장 수가 아니라 시간으로 확신한다: 같은 값이 한 장어치(2초) 이어져야 confirmed
    const changed = this.setFact(facts, facet, value, atMs, facet === "holding", this.stepMs);
    const f = facts[facet];
    if (f && f.value === value && f.at_ms === atMs) this.byPose.add(f);
    return changed;
  }

  /** 관절이 붙인 그 값이면 지운다. */
  private dropPoseFact(facts: Facts, facet: Facet, value: string): void {
    const f = facts[facet];
    if (f && f.value === value && this.byPose.has(f)) delete facts[facet];
  }

  /** 관절이 이 프레임(또는 더 새 프레임)에서 붙인 사실이면 VLM 답이 바꾸거나 지우지 않는다. */
  private poseHolds(f: WorldFact | undefined, capturedAtMs: number): boolean {
    return !!f && this.byPose.has(f) && f.at_ms >= capturedAtMs;
  }

  private forget(id: string): void {
    this.objects.delete(id);
    this.confirmer.forget(id);
  }

  /** 같은 면의 사실보다 오래된 답은 버린다. 값이 새로 생기거나 바뀌면 true.
   *  지금만 맞는 면(now)은 같은 값이어도 앞 답과 FACT_FRESH_MS 넘게 떨어지면 그 사이를 모르므로 처음 보인 시각을 새로 둔다.
   *  spanMs: 같은 값이 다시 와도 처음 보인 뒤 이만큼 지나야 confirmed로 올린다(기본 0: VLM 답은 두 번째에 바로). */
  private setFact(facts: Facts, facet: Facet, value: string, atMs: number, now = false, spanMs = 0): boolean {
    const prev = facts[facet];
    if (prev && atMs < prev.at_ms) return false;
    if (prev && prev.value === value) {
      const since = now && atMs - prev.at_ms > FACT_FRESH_MS ? atMs : prev.since_ms;
      const certainty = prev.certainty === "confirmed" || atMs - prev.since_ms >= spanMs ? "confirmed" : prev.certainty;
      facts[facet] = { value, at_ms: atMs, since_ms: since, certainty, ...(prev.closer_ms !== undefined ? { closer_ms: prev.closer_ms } : {}) };
      return false;
    }
    facts[facet] = { value, at_ms: atMs, since_ms: atMs, certainty: "inferred" };
    return true;
  }

  /** VLM 답 하나를 넣는다(전체 사진·잘라 본 사진이 같이 쓰는 규칙). 원본 프레임·대상·면마다 한 번만 센다:
   *  - 그 열쇠에 잘라 본 답이 이미 들어갔으면 무엇이든 버린다(잘라 본 답이 앞선다). 전체 사진 답이 들어갔으면 전체 사진 답은 버리고 잘라 본 답은 받는다.
   *  - 같은 원본 프레임의 다른 답(같은 답 안의 같은 면 포함)은 그 프레임 사실의 값만 바꾸고 확신(confirmed)으로 올리지 않는다.
   *  turn: 이 답(한 번의 applyScene·applyCloserScene)에서 이미 넣은 열쇠. 값이 새로 생기거나 바뀌면 true. 잘라 본 답이 값을 바꿨으면 closer_ms(촬영 시각)를 남긴다. */
  private answer(frameId: string, id: string, facts: Facts, facet: Facet, value: string, atMs: number, crop: boolean, now: boolean, turn: Set<string>): boolean {
    const changed = this.putAnswer(frameId, id, facts, facet, value, atMs, crop, now, turn);
    if (changed && crop) facts[facet] = { ...facts[facet]!, closer_ms: atMs };
    return changed;
  }

  private putAnswer(frameId: string, id: string, facts: Facts, facet: Facet, value: string, atMs: number, crop: boolean, now: boolean, turn: Set<string>): boolean {
    const key = `${frameId}|${id}|${facet}`;
    const before = this.answers.get(key);
    const again = turn.has(key);
    if (!again && (before === "crop" || (before === "full" && !crop))) return false;
    turn.add(key);
    this.answers.delete(key);
    this.answers.set(key, crop ? "crop" : "full");
    if (this.answers.size > ANSWERS_KEEP) this.answers.delete(this.answers.keys().next().value!);
    const prev = facts[facet];
    if ((again || before) && prev && prev.at_ms === atMs) {
      if (prev.value === value) return false;
      facts[facet] = { value, at_ms: atMs, since_ms: atMs, certainty: "inferred" };
      return true;
    }
    return this.setFact(facts, facet, value, atMs, now);
  }

  /** VLM 대상: 사람·물건·가전 설비와 그 사실, 종류. */
  private targetOf(id: string): { kind: Target; facts: Facts; cls: ClassKey } | null {
    if (id === PERSON) return { kind: "person", facts: this.person.facts, cls: "person" };
    const obj = this.objects.get(id);
    if (obj) return { kind: "object", facts: obj.facts, cls: obj.cls };
    const fix = this.fixtures.get(id);
    return fix ? { kind: "fixture", facts: fix.facts, cls: fix.cls } : null;
  }

  applyScene(frameId: string, capturedAtMs: number, scene: SceneObservation, ids: Map<string, string>): WorldChange[] {
    this.start(capturedAtMs);
    const changes: WorldChange[] = [];
    const summary = scene.summary.trim();
    if (capturedAtMs >= this.summaryAt) {
      this.summaryAt = capturedAtMs;
      if (summary && summary !== this.summary) {
        this.summary = summary;
        changes.push({ kind: "vlm", at_ms: capturedAtMs, subject: frameId, meaningful: false, text: CHANGE_TEXT.vlm(summary) });
      }
    }
    const said = new Set<string>();
    const turn = new Set<string>();
    const hidden = new Set(scene.observations.filter((o) => (VLM_ONLY as readonly string[]).includes(o.state)).map((o) => ids.get(o.object_id)).filter((x): x is string => !!x));
    for (const ob of scene.observations) {
      const id = ids.get(ob.object_id);
      const target = id ? this.targetOf(id) : null;
      if (!id || !target || !(ob.state in STATES)) continue;
      const value = ob.state as StateKey;
      if (!fits(value, target.cls, target.kind)) continue;
      const facet = STATES[value].facet;
      said.add(`${id}|${facet}`);
      if (this.poseHolds(target.facts[facet], capturedAtMs)) continue;
      if (!this.answer(frameId, id, target.facts, facet, value, capturedAtMs, false, NOW_FACETS[target.kind].includes(facet), turn)) continue;
      if (target.kind === "person") {
        if (this.person.visible) changes.push({ kind: "person_state", at_ms: capturedAtMs, subject: PERSON, meaningful: false, text: CHANGE_TEXT.state(OBJECT_NAME.person!, value) });
      } else if (target.kind === "fixture") {
        const fix = this.fixtures.get(id)!;
        changes.push({ kind: "fixture", at_ms: capturedAtMs, subject: id, meaningful: true, text: CHANGE_TEXT.state(fixtureName(fix.cls, fix.id, fix.roomLabel), value) });
      } else {
        const obj = this.objects.get(id)!;
        if (obj.confirmed && obj.status !== "gone") changes.push({ kind: "state", at_ms: capturedAtMs, subject: id, meaningful: true, text: CHANGE_TEXT.state(this.name(obj), value) });
      }
    }
    // 이 프레임에서 본 대상의 지금만 맞는 사실: 이 답에 없으면 지운다(더 새 답의 사실, 같은 원본 프레임을 잘라 본 답의 사실은 그대로)
    for (const id of new Set(ids.values())) {
      const target = this.targetOf(id);
      if (!target || hidden.has(id)) continue;
      const owner = id === PERSON ? this.person : this.objects.get(id) ?? this.fixtures.get(id)!;
      owner.answered = Math.max(owner.answered ?? capturedAtMs, capturedAtMs);
      for (const f of NOW_FACETS[target.kind]) {
        const prev = target.facts[f];
        if (!prev || prev.at_ms > capturedAtMs || said.has(`${id}|${f}`) || this.poseHolds(prev, capturedAtMs)) continue;
        if (this.answers.get(`${frameId}|${id}|${f}`) === "crop") continue;
        delete target.facts[f];
      }
    }
    changes.push(...this.seeDevices(frameId, capturedAtMs, scene));
    return changes;
  }

  /** 가까이 보기 합치기: 잘라 본 몇 장(원본 프레임마다 그 프레임 카메라)을 한 번에 넣는다. 보통 프레임의 등장·사라짐 셈은 건드리지 않는다.
   *  - 물건 감지만 쓴다. 사람·가전 설비·받지 않는 감지·잘라 본 경계에 닿은 상자는 버린다.
   *  - 장마다 상자 아래 가운데의 트윈 자리로, 같은 종류·같은 자리(종류 거리 안) 감지를 묶는다.
   *  - 묶음이 확인된 물건(사라진 것 포함)에 맞으면: 자리는 자리를 마지막으로 고친 촬영보다 새면(같은 촬영이면 잘라 본 자리가 앞선다),
   *    본 시각·상태(present)·지킴은 마지막 보임 판단(전체 사진의 보임·시야 밖·사라짐, 가까이 보기)보다 새 촬영이거나 같은 원본 프레임의 전체 사진 판단일 때만 고친다.
   *    옮김 표시는 그와 따로, 표시를 붙인 촬영보다 새 촬영이거나 같은 원본 프레임이면 지운다(sawAgain).
   *  - 맞는 확인된 물건이 없으면: 서로 다른 원본 프레임 CLOSER_NEW_FRAMES장이 있으면 확인된 물건 하나를 만든다(세는 중인 같은 자리 물건이 있으면 그것을 확인).
   *    그보다 적은 묶음 중 idsFrom 장에 보인 것은 후보(pending)로 돌려주고, 그 장의 VLM 답(applyCloserScene)이 그 감지에 사실을 답하면 만든다.
   *    후보가 있으면 이번 옮김 처리는 VLM 답(applyCloserScene)이나 끝냄(endCloser)까지 미룬다.
   *  - 안 보인 물건은 그대로다. 찾거나 고친 물건은 지킴(closerAt)을 둔다.
   *  ids: idsFrom 원본 프레임(없으면 촬영 시각이 가장 새 원본 프레임) 감지 번호(d1…) → 물건 id. 그 사진의 VLM 답(applyCloserScene)이 쓴다. */
  applyCloser(looks: readonly CloserPass[], idsFrom?: string): { changes: WorldChange[]; ids: Map<string, string>; pending?: CloserPending } {
    const changes: WorldChange[] = [];
    const ids = new Map<string, string>();
    const passes = [...looks].sort((a, b) => a.capturedAtMs - b.capturedAtMs);
    const newest = passes.at(-1);
    if (!newest) return { changes, ids };
    const from = idsFrom ?? newest.frameId;
    const surfaces = this.o.surfaces();
    const groups: CloserGroup[] = [];
    for (const pass of passes) {
      pass.dets.forEach((d, i) => {
        if (!this.closerObject(d)) return;
        const placed = placePoint(pass.view, d.foot, { width: pass.width, height: pass.height }, surfaces, this.o.floorAt);
        if (!placed.position) return;
        const cls = d.label as ObjClass;
        const near = (CLASSES[cls] as { identityM?: number }).identityM ?? this.identityM;
        let best: { g: CloserGroup; d: number } | null = null;
        for (const g of groups) {
          if (g.cls !== cls || g.seen.some((s) => s.pass === pass)) continue;
          const gap = dist(g.seen.at(-1)!.position, placed.position);
          if (gap <= near && (!best || gap < best.d)) best = { g, d: gap };
        }
        const seen: CloserSeen = { pass, tmp: `d${i + 1}`, position: placed.position, surface: placed.surface, part: placed.part, errorM: placed.errorM };
        if (best) best.g.seen.push(seen);
        else groups.push({ cls, seen: [seen] });
      });
    }
    const used = new Set<string>();
    const created: Fresh[] = [];
    const candidates = new Map<string, CloserGroup>();
    for (const g of groups) {
      const enough = new Set(g.seen.map((s) => s.pass.frameId)).size >= CLOSER_NEW_FRAMES;
      const obj = this.closeGroup(g, enough, used, surfaces, changes, created);
      for (const s of g.seen) {
        if (s.pass.frameId !== from) continue;
        if (obj) ids.set(s.tmp, obj.id);
        else candidates.set(s.tmp, g);
      }
    }
    if (candidates.size) return { changes, ids, pending: { candidates, used, created } };
    // 새로 만든 물건이 다른 자리 같은 종류 물건의 지킴을 푼다(이번에 본 물건은 그대로)
    this.liftHolds(created, used);
    return { changes, ids };
  }

  /** 가까이 본 묶음 하나를 넣는다: 맞는 확인된 물건이 있으면 그것을 고치고, 없으면 make일 때만 확인된 물건 하나를 만든다(세는 중인 같은 자리 물건이 있으면
   *  그것을 확인하고 created에 더한다). 넣은 물건은 used에 더해 돌려주고, 넣지 않았으면 null. */
  private closeGroup(g: CloserGroup, make: boolean, used: Set<string>, surfaces: PlaneSurface[], changes: WorldChange[], created: Fresh[]): Obj | null {
    const last = g.seen.at(-1)!;
    const at = last.pass.capturedAtMs;
    const match = this.nearest(g.cls, last.position, used);
    let obj: Obj | null = null;
    if (match?.confirmed) {
      obj = match;
      this.placeCloser(obj, last, surfaces);
      // 보임은 마지막 보임 판단보다 새 촬영일 때만 고친다(전체 사진이 더 새 촬영으로 본 사라짐·시야 밖을 되돌리지 않는다).
      // 같은 원본 프레임의 전체 사진 판단이면 잘라 본 양성이 앞선다
      if (this.newerCloser(obj, at, last.pass.frameId)) {
        this.seenCloser(obj, at, last.pass.frameId);
        if (obj.status === "gone") {
          obj.status = "present";
          obj.goneAt = null;
          changes.push({ kind: "appeared", at_ms: at, subject: obj.id, meaningful: true, text: CHANGE_TEXT.appeared(this.name(obj), obj.surfaceLabel ? onSurface(obj.surfaceLabel) : null) });
        } else if (obj.status === "out_of_view") {
          obj.status = "present";
          changes.push({ kind: "back_in_view", at_ms: at, subject: obj.id, meaningful: false, text: CHANGE_TEXT.backInView(this.name(obj)) });
        }
      }
    } else if (make) {
      obj = match ?? this.create(g.cls, g.seen[0]!.pass.capturedAtMs, g.seen[0]!.pass.frameId);
      obj.firstSeen = Math.min(obj.firstSeen, g.seen[0]!.pass.capturedAtMs);
      obj.confirmed = true;
      obj.status = "present";
      obj.goneAt = null;
      this.placeCloser(obj, last, surfaces);
      this.seenCloser(obj, at, last.pass.frameId);
      created.push({ obj, at, frame: last.pass.frameId });
      changes.push({ kind: "appeared", at_ms: at, subject: obj.id, meaningful: true, text: CHANGE_TEXT.appeared(this.name(obj), obj.surfaceLabel ? onSurface(obj.surfaceLabel) : null) });
    }
    if (!obj) return null;
    // 옮김 표시는 보임 판단과 따로 지운다: 보임을 바꾸지 못하는 옛 촬영이어도 표시를 붙인 촬영보다 새거나 같은 원본 프레임이면 두 물건이 함께 있었다
    for (const s of g.seen) this.sawAgain(obj, s.pass.capturedAtMs, s.pass.frameId);
    used.add(obj.id);
    return obj;
  }

  /** 가까이 보기 한 번이 VLM 답 없이 끝났다(답 없음·끊김): 새 물건 후보를 버리고 미뤄 둔 옮김 처리를 한다. 이미 끝낸 후보면 아무것도 하지 않는다. */
  endCloser(pending: CloserPending): void {
    if (this.closerDone.has(pending)) return;
    this.closerDone.add(pending);
    this.liftHolds(pending.created, pending.used);
  }

  /** 가까이 본 감지가 물건 감지인가: 사람·가전 설비·받지 않는 감지·잘라 본 경계에 닿은 상자가 아니다.
   *  applyCloser는 이 감지만 쓰고, 관찰 흐름은 이 감지가 있는 가장 새 장을 VLM에 보낸다. */
  closerObject(d: CloserDetection): boolean {
    return !d.edge && this.accepts(d) && OBJ_CLASSES.has(d.label);
  }

  /** 가까이 본 촬영으로 자리·면·방을 고친다(자리를 마지막으로 고친 촬영보다 새면, 같은 촬영이면 잘라 본 자리가 앞선다). */
  private placeCloser(obj: Obj, s: { pass: CloserPass; position: V3; surface: string | null; part: "basin" | null; errorM: number | null }, surfaces: PlaneSurface[]): void {
    const at = s.pass.capturedAtMs;
    if (!this.newerPlace(obj, at, true)) return;
    obj.position = s.position;
    obj.surface = s.surface;
    obj.surfaceLabel = s.surface ? surfaces.find((x) => x.id === s.surface)?.label ?? null : null;
    obj.part = s.part;
    obj.errorM = s.errorM;
    obj.room = this.o.roomAt([s.position[0], s.position[2]])?.id ?? null;
    obj.posAt = at;
    obj.posCloser = true;
  }

  /** 가까이 본 촬영으로 보였다: 본 시각·보임 판단 시각·지킴을 두고, 보통 프레임의 등장·사라짐 셈은 있음으로 다시 둔다. 옮김 표시는 applyCloser가 따로 지운다. */
  private seenCloser(obj: Obj, at: number, frameId: string): void {
    obj.lastSeen = Math.max(obj.lastSeen, at);
    obj.lastInView = Math.max(obj.lastInView, at);
    this.judge(obj, at, frameId, true);
    obj.closerAt = Math.max(obj.closerAt ?? at, at);
    this.confirmer.mark(obj.id);
  }

  /** 가까이 본 사진의 VLM 답: ids(그 사진에서 잡은 물건)의 사실만 넣는다. 장면 요약·답에 없는 면·지금만 맞는 사실·사람·가전 설비는 건드리지 않는다.
   *  가림(not_visible)을 답한 상자는 이미 있는 물건이어도 그 상자의 사실을 넣지 않는다.
   *  원본 프레임(sourceFrameId)·물건·면마다 한 번만 넣고, 같은 원본 프레임의 전체 사진 답보다 앞선다(answer).
   *  pending(같은 가까이 보기 applyCloser의 후보)이 있으면 먼저 이 답이 사실(그 종류에 붙는 값)을 하나 이상 답하고 가림(not_visible)은 답하지 않은 후보 감지마다
   *  확인된 물건을 만들어(그사이 같은 자리 물건이 확인됐으면 그것에 맞춘다) ids에 더하고 미뤄 둔 옮김 처리를 한다. 사실을 답하지 않거나 가림을 답한 후보는 버린다. */
  applyCloserScene(sourceFrameId: string, capturedAtMs: number, scene: SceneObservation, ids: Map<string, string>, pending?: CloserPending): WorldChange[] {
    const changes: WorldChange[] = [];
    if (pending && !this.closerDone.has(pending)) {
      this.closerDone.add(pending);
      const used = new Set(pending.used);
      const created = [...pending.created];
      const surfaces = this.o.surfaces();
      const tmps = new Map<CloserGroup, string[]>();
      for (const [tmp, g] of pending.candidates) tmps.set(g, [...(tmps.get(g) ?? []), tmp]);
      for (const [g, list] of tmps) {
        const said = scene.observations.filter((ob) => list.includes(ob.object_id)).map((ob) => ob.state as string);
        // 가렸다고 답한 상자는 함께 답한 사실이 있어도 VLM이 확인한 것이 아니다
        if (said.some((s) => (VLM_ONLY as readonly string[]).includes(s))) continue;
        if (!said.some((s) => s in STATES && fits(s as StateKey, g.cls, "object"))) continue;
        const obj = this.closeGroup(g, true, used, surfaces, changes, created)!;
        for (const tmp of list) ids.set(tmp, obj.id);
      }
      this.liftHolds(created, used);
    }
    const turn = new Set<string>();
    // 이미 있는 물건도 가렸다고 답한 상자는 함께 답한 사실을 넣지 않는다(답 순서와 상관없이, 상자마다)
    const hidden = new Set(scene.observations.filter((ob) => (VLM_ONLY as readonly string[]).includes(ob.state)).map((ob) => ob.object_id));
    for (const ob of scene.observations) {
      if (hidden.has(ob.object_id)) continue;
      const id = ids.get(ob.object_id);
      const obj = id ? this.objects.get(id) : undefined;
      if (!obj || !(ob.state in STATES)) continue;
      const value = ob.state as StateKey;
      if (!fits(value, obj.cls, "object")) continue;
      const facet = STATES[value].facet;
      if (this.poseHolds(obj.facts[facet], capturedAtMs)) continue;
      if (!this.answer(sourceFrameId, obj.id, obj.facts, facet, value, capturedAtMs, true, NOW_FACETS.object.includes(facet), turn)) continue;
      obj.closerRev[facet] = (obj.closerRev[facet] ?? 0) + 1;
      if (obj.confirmed && obj.status !== "gone") changes.push({ kind: "state", at_ms: capturedAtMs, subject: obj.id, meaningful: true, text: CHANGE_TEXT.state(this.name(obj), value) });
    }
    return changes;
  }

  /** 분석 없음 프레임: 셈을 늘리고 변화 하나. 등장·사라짐 셈은 그대로다. VLM 답이 없으면 그 프레임의 가전 맞춤도 버린다(값이 아니다). */
  applyMissing(frameId: string, capturedAtMs: number, m: { yolo?: YoloMissing; vlm?: VlmMissing }): WorldChange[] {
    this.start(capturedAtMs);
    if (m.yolo) this.yoloMissing++;
    if (m.vlm) {
      this.vlmMissing++;
      this.links.delete(frameId);
    }
    if (m.yolo) return [{ kind: "yolo_missing", at_ms: capturedAtMs, subject: frameId, meaningful: false, text: CHANGE_TEXT.yoloMissing[m.yolo] }];
    if (m.vlm) return [{ kind: "vlm_missing", at_ms: capturedAtMs, subject: frameId, meaningful: false, text: CHANGE_TEXT.vlmMissing[m.vlm] }];
    return [];
  }

  /** 실제 폰이 들은 말 한 마디를 변화 줄로 남긴다(판단 계기). HEARD_MAX자에서 자르고 줄바꿈·「」를 뺀다. 빈 말은 남기지 않는다.
   *  World State에는 쌓지 않는다: 판단 호출(src/world/decide.ts)이 최근 변화 줄로 60초 동안만 관찰 텍스트에 넣는다. */
  heard(text: string, atMs: number): WorldChange[] {
    const said = text.replace(/[「」]/g, "").replace(/\s+/g, " ").trim().slice(0, HEARD_MAX);
    return said ? [{ kind: "heard", at_ms: atMs, subject: "person", text: CHANGE_TEXT.heard(said), meaningful: true }] : [];
  }

  /** 가전 상태. 처음 받은 상태는 상태 이름 변화 하나, 그 뒤로는 바뀐 속성마다 이력과 사건 줄(아는 상태가 아니면 속성 줄, 판단 계기 아님).
   *  카메라로 본 값이 상태가 된 속성(vision.applied)의 줄은 「카메라로 봄」을 붙인다. */
  applyDevice(s: DeviceState, atMs: number): WorldChange[] {
    const spec = this.o.devices().find((d) => d.id === s.id);
    if (!spec) return [];
    let d = this.devs.get(s.id);
    if (!d) {
      d = { id: s.id, kind: spec.kind, label: spec.label, twin: {}, status: null, state: [], changed: atMs, eventAt: null, since: {}, long: new Set(), history: [], known: false, vision: null };
      this.devs.set(s.id, d);
    }
    d.vision = s.signal !== "none" && s.vision?.applied ? s.vision : null;
    if (s.signal === "none") {
      d.status = null;
      d.state = [];
      d.since = {};
      this.remaining.update(s.id, {}, atMs);
      return [];
    }
    const seen = (attr: string, to: unknown) => !!d.vision && attr in d.vision.twin && same(d.vision.twin[attr], to);
    const changes: WorldChange[] = [];
    for (const [attr, to] of Object.entries(s.twin)) {
      const from = d.twin[attr];
      if (d.known && same(from, to)) continue;
      d.history = [...d.history, { attr, from: from ?? null, to, at_ms: atMs }].slice(-HISTORY_MAX);
      d.changed = atMs;
      const key = becameKey(attr, to);
      if (key) d.since[key] = atMs;
      if (!d.known) continue;
      if (key) {
        d.eventAt = atMs;
        const became = deviceText(d.kind, key).became;
        changes.push({ kind: "device", at_ms: atMs, subject: d.id, meaningful: true, text: seen(attr, to) ? CHANGE_TEXT.deviceSeen(d.label, became) : CHANGE_TEXT.device(d.label, became) });
      } else changes.push({ kind: "device", at_ms: atMs, subject: d.id, meaningful: false, text: CHANGE_TEXT.deviceAttr(d.label, attr, to) });
    }
    const status = deviceStatus(d.kind, s.twin);
    if (!d.known && status !== null) {
      changes.push({ kind: "device", at_ms: atMs, subject: d.id, meaningful: true, text: d.vision ? CHANGE_TEXT.deviceSeen(d.label, status) : CHANGE_TEXT.device(d.label, status) });
    }
    d.status = status;
    d.state = deviceStateKeys(d.kind, s.twin);
    for (const k of Object.keys(d.since) as DeviceStateKey[]) if (!d.state.includes(k)) delete d.since[k];
    for (const k of d.state) d.since[k] ??= atMs; // 신호가 돌아와 값이 같아도 그때부터 센다
    d.twin = { ...s.twin };
    d.known = true;
    this.remaining.update(s.id, s.twin, atMs);
    return changes;
  }

  /** 시간이 지나야 나는 사건(vocab DEVICE_LONG, 종류는 등록부 longEvents: 냉장고·현관문 문이 1분 넘게 열림). 한 상태가 이어지는 동안 한 번. 판단 타이머가 부른다. */
  tick(nowMs: number): WorldChange[] {
    const changes: WorldChange[] = [];
    for (const d of this.devs.values()) {
      for (const [key, rule] of Object.entries(DEVICE_LONG) as [DeviceLongKey, (typeof DEVICE_LONG)[DeviceLongKey]][]) {
        const since = d.since[rule.state];
        if (since === undefined || d.status === null || !d.state.includes(rule.state) || !kindEntry(d.kind)?.longEvents?.includes(key) || nowMs - since < rule.afterMs) continue;
        const mark = `${key}@${since}`;
        if (d.long.has(mark)) continue;
        d.long.add(mark);
        const seen = !!d.vision && DEVICE_STATES[rule.state].attr in d.vision.twin;
        changes.push({ kind: "device", at_ms: nowMs, subject: d.id, meaningful: true, text: seen ? CHANGE_TEXT.deviceSeen(d.label, rule.label) : CHANGE_TEXT.device(d.label, rule.label) });
      }
    }
    return changes;
  }

  setEye(eye: EyePose | null, atMs: number): void {
    const room = eye ? this.o.roomAt(eye.position) : null;
    this.eye = eye
      ? { position: [eye.position[0], eye.position[1]], height_m: eye.height_m, yaw_deg: eye.yaw_deg, pitch_deg: eye.pitch_deg, room: room?.id ?? null, room_label: room?.label ?? null, at_ms: atMs }
      : null;
  }

  view(nowMs: number): WorldView {
    const devices = this.o.devices();
    const objects: WorldObject[] = [...this.objects.values()].filter((x) => x.confirmed).map((x) => ({
      id: x.id, cls: x.cls, position: x.position, surface: x.surface, surface_label: x.surfaceLabel, ...(x.part ? { surface_part: x.part } : {}), room: x.room, error_m: x.errorM, status: x.status,
      first_seen_ms: x.firstSeen, last_seen_ms: x.lastSeen, last_in_view_ms: x.lastInView, facts: { ...x.facts }, answered_ms: x.answered, devices: relatedDeviceIds(x.cls, devices),
      closer_hold: this.held(x, nowMs), followed_by: x.followed?.id ?? null, ...(Object.keys(x.closerRev).length ? { closer_rev: { ...x.closerRev } } : {}),
    }));
    const fixtures: WorldFixture[] = [...this.fixtures.values()].map((f) => ({
      id: f.id, cls: f.cls, room: f.room, room_label: f.roomLabel, first_seen_ms: f.firstSeen, last_seen_ms: f.lastSeen, facts: { ...f.facts }, answered_ms: f.answered,
      device: devices.find((d) => d.kind === cameraKindOf(f.cls) && d.room !== undefined && d.room === f.room)?.id ?? null,
      ...(f.link ? { link: { device: f.link.device, miss: f.link.miss, at_ms: f.link.at_ms } } : {}),
    }));
    const p = this.person;
    const near = p.visible && p.position && p.positionAt !== null && nowMs - p.positionAt <= FRESH_MS && this.o.locate
      ? devices.filter((d) => { const at = this.o.locate!(d.id); return !!at && Math.hypot(at[0] - p.position![0], at[1] - p.position![1]) <= NEAR_M; }).map((d) => d.id)
      : [];
    const person: WorldPerson = {
      visible: p.visible, since_ms: p.since_ms, last_seen_ms: p.last_seen_ms, count: p.visible ? p.count : 0,
      position: p.position, position_ms: p.positionAt, room: p.room?.id ?? null, room_label: p.room?.label ?? null, near,
      holding: [...new Set([...(this.byPose.has(p.facts.holding!) ? this.heldIds : []),
        ...objects.filter((o) => o.status !== "gone" && o.facts.place?.value === POSE_HOLD.object).map((o) => o.id)])],
      facts: { ...p.facts }, answered_ms: p.answered,
    };
    return {
      at_ms: nowMs, objects, person, fixtures,
      devices: [...this.devs.values()].map((d) => ({
        id: d.id, kind: d.kind, label: d.label, status: d.status, state: [...d.state], active: d.state.some((k) => DEVICE_STATES[k].active),
        changed_ms: d.changed, event_ms: d.eventAt, started_ms: this.remaining.startedAt(d.id), remaining_min: this.remaining.remainingMin(d.id, nowMs), history: [...d.history],
        ...(d.vision ? { vision: { at_ms: Math.max(this.sighted.get(d.id) ?? 0, Date.parse(d.vision.at) || 0) } } : {}),
      })),
      eye: this.eye, frame_ms: this.frameAt, vlm_missing: this.vlmMissing, yolo_missing: this.yoloMissing,
    };
  }
}
