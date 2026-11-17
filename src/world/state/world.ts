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
// 파일 나눔(src/world/state/): world.ts 겉 클래스 WorldState·공개 메서드·view, core.ts 안쪽 공유 객체 WorldCore(물건·가전 설비·사람·등장 셈·관절 사실·쓰러짐)와 작은 도우미,
// objects.ts 감지 합치기·물건 움직임·들고 감 보호, people.ts 사람 자리·방·관절·쓰러짐 의심, facts.ts VLM 사실, closer.ts 가까이 보기·지킴·옮김 표시,
// devices.ts 가전 설비·카메라로 본 가전·가전 상태. 다른 도메인은 src/world/index.ts로 가져온다.
import type { EyePose } from "../../contract/events.js";
import type { VlmMissing, WorldChange, WorldEye, WorldFixture, WorldObject, WorldPerson, WorldView, YoloMissing } from "../../contract/world.js";
import type { Detection, EngineFrame, Pose, SceneObservation } from "../../contract/observe.js";
import { headWithin } from "../../shared/cut.js";
import type { DeviceState, SightEvidence, VisionResult } from "../../contract/devices.js";
import { CHANGE_TEXT, HEARD_MAX } from "../labels.js";
import type { PlaneSurface, RestSpot } from "../place.js";
import type { FallConfig } from "../fall.js";
import { relatedDeviceIds } from "../relations.js";
import { cameraKindOf } from "../../devices/kinds.js";
import { FRESH_MS, NEAR_M, POSE_HOLD } from "../vocab.js";
import { WorldCore, type Plan2, type V3 } from "./core.js";
import { Detections } from "./objects.js";
import { People } from "./people.js";
import { SceneFacts } from "./facts.js";
import { CloserLook, type CloserDetection, type CloserPass, type CloserPending } from "./closer.js";
import { DeviceSight } from "./devices.js";
import { ContentsBook } from "./contents.js";

export { CLOSER_HOLD_MS } from "./core.js";
export { CLOSER_NEW_FRAMES, type CloserDetection, type CloserPass, type CloserPending } from "./closer.js";

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
  /** 카메라로 이어 본 가전 상태를 허브에 넘긴다(src/devices/hub/signals.ts observe). 없으면 넘기지 않는다. */
  see?: (id: string, twin: Record<string, unknown>, atMs: number, evidence?: Record<string, SightEvidence>) => VisionResult;
  /** 같은 물체로 볼 기본 거리(m, 기본 0.25). 종류에 identityM이 있으면 그 값. */
  identityM?: number;
  /** 등장·사라짐·관절 사실 확인에서 한 장으로 치는 시간(ms, 기본 EVIDENCE_STEP_MS 2000). 장면을 다른 간격(1초)으로 적은 시험이 그 간격을 준다. */
  evidenceStepMs?: number;
  /** 쓰러짐 의심 시간·각도(src/world/fall.ts, 기본 FALL_DEFAULTS). */
  fall?: FallConfig;
  /** 트윈의 침대·소파(그 위에 누운 것은 쓰러짐 의심이 아니다). 없으면 없음. */
  rests?: () => RestSpot[];
}

/** 잰 크기들의 가운데값(높이·폭 따로, mm까지)과 바닥 가운데: 지금 자리(가까운 바닥 가장자리)에서 그 자리를 잰 카메라 반대쪽(from)으로 반 폭 옮긴 점.
 *  from을 모르면 가운데를 내지 않는다. */
function sizeView(xs: readonly { height: number; width: number }[], at: [number, number, number], from: [number, number] | null): { height: number; width: number; center?: [number, number, number] } {
  const mid = (v: number[]) => { const a = [...v].sort((x, y) => x - y); const n = a.length; return n % 2 ? a[(n - 1) / 2]! : (a[n / 2 - 1]! + a[n / 2]!) / 2; };
  const r = (v: number) => Math.round(v * 1000) / 1000;
  const width = r(mid(xs.map((x) => x.width)));
  return { height: r(mid(xs.map((x) => x.height))), width, ...(from ? { center: [r(at[0] + from[0] * width / 2), at[1], r(at[2] + from[1] * width / 2)] as [number, number, number] } : {}) };
}

export class WorldState {
  private readonly core: WorldCore;
  private eye: WorldEye | null = null;
  private vlmMissing = 0;
  private yoloMissing = 0;

  constructor(o: WorldStateOptions) {
    const core = new WorldCore(o);
    core.merge = new Detections(core);
    core.people = new People(core);
    core.vlm = new SceneFacts(core);
    core.closer = new CloserLook(core);
    core.contents = new ContentsBook(core);
    core.sight = new DeviceSight(core);
    this.core = core;
  }

  /** 이 감지를 받는가: 낱말 표의 사람·물건·가전 설비 종류이고 그 종류의 최소 신뢰도 이상. 관찰 흐름은 받는 감지만 상자·YOLO 글·VLM 감지 목록에 싣는다. */
  accepts(d: Pick<Detection, "label" | "score">): boolean {
    return this.core.accepts(d);
  }

  /** poses: 이 프레임의 관절(YOLO26-pose). 없으면(관절 모델이 없거나 사람이 없어 돌리지 않음) 자세·손에 듦을 보지 않는다.
   *  이미 넣은 가장 새 전체 사진보다 옛 촬영(감지 대기열에서 늦게 나온 프레임)은 넣지 않고 변화·감지 번호 없이 돌려준다(objects.ts). */
  applyDetections(frame: EngineFrame, dets: Detection[], poses?: Pose[]): { changes: WorldChange[]; ids: Map<string, string> } {
    return this.core.merge.applyDetections(frame, dets, poses);
  }

  /** 전체 사진의 VLM 답(facts.ts). */
  applyScene(frameId: string, capturedAtMs: number, scene: SceneObservation, ids: Map<string, string>): WorldChange[] {
    return this.core.vlm.applyScene(frameId, capturedAtMs, scene, ids);
  }

  /** 가까이 보기 합치기(closer.ts applyCloser). */
  applyCloser(looks: readonly CloserPass[], idsFrom?: string): { changes: WorldChange[]; ids: Map<string, string>; pending?: CloserPending } {
    return this.core.closer.applyCloser(looks, idsFrom);
  }

  /** 가까이 보기 한 번이 VLM 답 없이 끝났다(closer.ts endCloser). */
  endCloser(pending: CloserPending): void {
    this.core.closer.endCloser(pending);
  }

  /** 가까이 본 감지가 물건 감지인가(closer.ts closerObject). */
  closerObject(d: CloserDetection): boolean {
    return this.core.closer.closerObject(d);
  }

  /** 위에서 본 장의 내용물 값(closer.ts applyTop): 대상 확인을 거친 장만 넣는다(src/observe/pipeline.ts topLook). */
  applyTop(objectId: string, sourceFrameId: string, capturedAtMs: number, value: "empty" | "has_contents"): WorldChange[] {
    return this.core.closer.applyTop(objectId, sourceFrameId, capturedAtMs, value);
  }

  /** 보기 지킴(가까이 가서 위에서 비추는 동안, 실행 추적이 건다): on이면 그 물건을 그동안(PEEK_GUARD_MS 한도) 사라짐으로 세지 않고, off면 푼다.
   *  확인된 관측의 지킴(closer_hold)과 다른 칸이다. 물건이 없으면 아무것도 하지 않는다. */
  guard(objectId: string, atMs: number, on: boolean): void {
    const obj = this.core.objects.get(objectId);
    if (obj) obj.peekGuard = on ? atMs : null;
  }

  /** 가까이 본 사진의 VLM 답(closer.ts applyCloserScene). */
  applyCloserScene(sourceFrameId: string, capturedAtMs: number, scene: SceneObservation, ids: Map<string, string>, pending?: CloserPending): WorldChange[] {
    return this.core.closer.applyCloserScene(sourceFrameId, capturedAtMs, scene, ids, pending);
  }

  /** 계획의 따르기 단계 창(contents.ts window): on이면 확인 값을 보관하고 다시 열어(그 뒤 사진만) 다 이어진 값이 확인 값을 바꾸게 한다. off면 닫는다(값은 둔다).
   *  물건이 없으면 false. */
  contentsAction(id: string, atMs: number, on: boolean): boolean {
    const obj = this.core.objects.get(id);
    if (!obj) return false;
    this.core.contents.window(obj, atMs, on);
    return true;
  }

  /** 분석 없음 프레임: 셈을 늘리고 변화 하나. 등장·사라짐 셈은 그대로다. VLM 답이 없으면 그 프레임의 가전 맞춤도 버린다(값이 아니다). */
  applyMissing(frameId: string, capturedAtMs: number, m: { yolo?: YoloMissing; vlm?: VlmMissing }): WorldChange[] {
    this.core.start(capturedAtMs);
    if (m.yolo) this.yoloMissing++;
    if (m.vlm) {
      this.vlmMissing++;
      this.core.sight.dropLinks(frameId);
    }
    if (m.yolo) return [{ kind: "yolo_missing", at_ms: capturedAtMs, subject: frameId, meaningful: false, text: CHANGE_TEXT.yoloMissing[m.yolo] }];
    if (m.vlm) return [{ kind: "vlm_missing", at_ms: capturedAtMs, subject: frameId, meaningful: false, text: CHANGE_TEXT.vlmMissing[m.vlm] }];
    return [];
  }

  /** 실제 폰이 들은 말 한 마디를 변화 줄로 남긴다(판단 계기). HEARD_MAX자에서 자르고 줄바꿈·「」를 뺀다. 빈 말은 남기지 않는다.
   *  World State에는 쌓지 않는다: 판단 호출(src/brain/decide.ts)이 최근 변화 줄로 60초 동안만 관찰 텍스트에 넣는다. */
  heard(text: string, atMs: number): WorldChange[] {
    const said = headWithin(text.replace(/[「」]/g, "").replace(/\s+/g, " ").trim(), HEARD_MAX);
    return said ? [{ kind: "heard", at_ms: atMs, subject: "person", text: CHANGE_TEXT.heard(said), meaningful: true }] : [];
  }

  /** 가전 상태(devices.ts applyDevice). */
  applyDevice(s: DeviceState, atMs: number, evidence?: Record<string, SightEvidence>): WorldChange[] {
    return this.core.sight.applyDevice(s, atMs, evidence);
  }

  /** 시간이 지나야 나는 사건(devices.ts tick). 판단 타이머가 부른다. */
  tick(nowMs: number): WorldChange[] {
    return this.core.sight.tick(nowMs);
  }

  setEye(eye: EyePose | null, atMs: number): void {
    const room = eye ? this.core.o.roomAt(eye.position) : null;
    this.eye = eye
      ? { position: [eye.position[0], eye.position[1]], height_m: eye.height_m, yaw_deg: eye.yaw_deg, pitch_deg: eye.pitch_deg, room: room?.id ?? null, room_label: room?.label ?? null, at_ms: atMs }
      : null;
  }

  view(nowMs: number): WorldView {
    const core = this.core;
    const devices = core.o.devices();
    const objects: WorldObject[] = [...core.objects.values()].filter((x) => x.confirmed).map((x) => ({
      id: x.id, cls: x.cls, position: x.position, surface: x.surface, surface_label: x.surfaceLabel, ...(x.part ? { surface_part: x.part } : {}), room: x.room, error_m: x.errorM, status: x.status,
      first_seen_ms: x.firstSeen, last_seen_ms: x.lastSeen, last_in_view_ms: x.lastInView, facts: { ...x.facts }, answered_ms: x.answered, devices: relatedDeviceIds(x.cls, devices),
      closer_hold: core.held(x, nowMs), followed_by: x.followed?.id ?? null, ...(Object.keys(x.closerRev).length ? { closer_rev: { ...x.closerRev } } : {}),
      ...(x.carried ? { carried: true as const } : {}),
      ...(x.sizes.length && x.position ? { size_m: sizeView(x.sizes, x.position, x.posFrom) } : {}),
      ...(x.contents ? { contents_gen: x.contents.gen, ...(x.contents.past.length ? { contents_past: x.contents.past.map((p) => ({ value: p.value, at_ms: p.atMs })) } : {}) } : {}),
    }));
    const fixtures: WorldFixture[] = [...core.fixtures.values()].map((f) => ({
      id: f.id, cls: f.cls, room: f.room, room_label: f.roomLabel, first_seen_ms: f.firstSeen, last_seen_ms: f.lastSeen, facts: { ...f.facts }, answered_ms: f.answered,
      device: devices.find((d) => d.kind === cameraKindOf(f.cls) && d.room !== undefined && d.room === f.room)?.id ?? null,
      ...(f.link ? { link: { device: f.link.device, miss: f.link.miss, at_ms: f.link.at_ms } } : {}),
    }));
    const p = core.person;
    const near = p.visible && p.position && p.positionAt !== null && nowMs - p.positionAt <= FRESH_MS && core.o.locate
      ? devices.filter((d) => { const at = core.o.locate!(d.id); return !!at && Math.hypot(at[0] - p.position![0], at[1] - p.position![1]) <= NEAR_M; }).map((d) => d.id)
      : [];
    const person: WorldPerson = {
      visible: p.visible, since_ms: p.since_ms, last_seen_ms: p.last_seen_ms, count: p.visible ? p.count : 0,
      position: p.position, position_ms: p.positionAt, room: p.room?.id ?? null, room_label: p.room?.label ?? null, near,
      holding: [...new Set([...(core.byPose.has(p.facts.holding!) ? core.heldIds : []),
        ...objects.filter((o) => o.status !== "gone" && o.facts.place?.value === POSE_HOLD.object).map((o) => o.id)])],
      facts: { ...p.facts }, answered_ms: p.answered,
    };
    const sightings = core.sightingsAt(nowMs);
    return {
      at_ms: nowMs, objects, ...(sightings.length ? { sightings } : {}), person, fixtures,
      devices: core.sight.deviceViews(nowMs),
      eye: this.eye, frame_ms: core.frameAt, vlm_missing: this.vlmMissing, yolo_missing: this.yoloMissing,
    };
  }
}
