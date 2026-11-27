// World State의 사람·관절(People): 사람 자리·방(가장 큰 사람 상자의 발), 관절 자세(서 있음·앉아 있음·누워 있음)와 쓰러짐 의심(src/world/fall.ts FallWatch).
// 쓰러짐 의심인 동안 사람 자세는 관절만 바꾸고(VLM 자세 답은 막음), 침대·소파 위로 빼는 것은 지금 누운 구간 안에서 찍힌 그 사람의 VLM 자리 답(침대 위·소파 위)으로만 한다.
// 관절이 붙인 사실은 같은 프레임 VLM 답보다 앞선다(poseHolds). 관절은 물건을 보지 않는다: 손에 있음·마시기·따르기 같은 물건 사실은 장면 VLM 답으로만 정한다
// (사용자 결정 2026-11-18, 판단 입력에 YOLO 물건 사실을 넣지 않는다).
import type { Facet, WorldChange, WorldFact, WorldView } from "../../contract/world.js";
import type { CameraView, Detection, FrameMeta, Pose } from "../../contract/observe.js";
import { CHANGE_TEXT, OBJECT_NAME } from "../labels.js";
import { inView, onRest, pixelOf, placeBox, rayDir } from "../place.js";
import { KPT_HIGH, mainPerson, type Pt } from "../pose.js";
import { fallPose, type FallPose } from "../fall.js";
import { FACT_FRESH_MS, POSE_FALL, POSE_POSTURE, REST_PLACES } from "../vocab.js";
import { PERSON, Part, type Facts, type Plan2, type V3 } from "./core.js";

/** 상자 아래가 프레임 높이의 이 비율보다 아래면 발이 잘린 것으로 본다. */
const FEET_EDGE = 0.98;
const area = (b: Detection["box"]) => Math.max(0, b[2]) * Math.max(0, b[3]);
/** 사람이 있던 자리가 화면 안인가를 볼 높이(m, 바닥 위 몸 가운데). */
const BODY_MID_M = 0.9;
/** 사용자로 세는 관절: 머리(0 코·1·2 눈·3·4 귀)나 어깨(5·6) 가운데 하나가 KPT_HIGH 이상. 손·팔만 잡힌 상자는 사용자가 아니다. */
const USER_KPTS = [0, 1, 2, 3, 4, 5, 6] as const;
const FACE_KPTS = [0, 1, 2, 3, 4] as const;
/** 사람 감지 상자와 관절 상자(또는 앞 장 상자)를 같은 사람으로 보는 겹침(IoU) 하한. */
const SAME_PERSON_IOU = 0.3;
const sure = (p: Pose, idx: readonly number[]) => idx.some((i) => (p.keypoints[i]?.[2] ?? 0) >= KPT_HIGH);
function iou(a: readonly number[], b: readonly number[]): number {
  const w = Math.min(a[0]! + a[2]!, b[0]! + b[2]!) - Math.max(a[0]!, b[0]!);
  const h = Math.min(a[1]! + a[3]!, b[1]! + b[3]!) - Math.max(a[1]!, b[1]!);
  const inter = Math.max(0, w) * Math.max(0, h);
  const union = a[2]! * a[3]! + b[2]! * b[3]! - inter;
  return union > 0 ? inter / union : 0;
}
/** 같은 사람으로 보는 짝: 사람 상자와 짝 후보가 하나씩이면 그 둘(그 장의 관절은 그 사람 때문에 돌았다), 여럿이면 겹침이 가장 큰 것(SAME_PERSON_IOU 이상). */
function closest<T extends { box: readonly number[] }>(box: readonly number[], list: readonly T[], single: boolean): T | null {
  if (single && list.length === 1) return list[0]!;
  let best: T | null = null, top = SAME_PERSON_IOU;
  for (const x of list) {
    const v = iou(box, x.box);
    if (v >= top) { best = x; top = v; }
  }
  return best;
}
/** 사람 상자 하나의 판정: 사용자로 세는가, 얼굴 관절이 보였는가. */
interface UserCheck { box: Detection["box"]; user: boolean; face: boolean }

/** 사람 자리·방, 관절 사실, 쓰러짐 의심. */
export class People extends Part {
  /** 이번 프레임의 발 자리에서 본 방. undefined는 새 발 자리 없음, null은 집 안 방이 아님(방을 모름으로). 감지 합치기(applyDetections) 끝에서 반영한다. */
  nextRoom: { id: string; label: string } | null | undefined = undefined;
  trail: NonNullable<WorldView["person_trail"]> = [];

  feet(view: CameraView | null, box: readonly [number,number,number,number], size: {width:number;height:number}): Plan2 | null {
    if (!view || box[1] + box[3] >= size.height * FEET_EDGE) return null;
    const hit = placeBox(view, [...box], size, [], this.o.floorAt).position;
    return hit?.every(Number.isFinite) ? [hit[0], hit[2]] : null;
  }

  /** 관절을 받은 적이 있다(관절 모델이 돈다). 한 번도 없으면 머리·어깨를 볼 수 없어 사람 상자를 모두 사용자로 센다. */
  private poseModel = false;
  /** 사람이 이어서 보이는 동안의 상자별 판정. 관절은 몇 장에 한 번만 오므로(src/observe/detector.ts poseEvery) 그 사이 장은 겹치는 앞 판정을 잇는다. */
  private checks: UserCheck[] = [];

  /** 이 프레임의 사람 감지 가운데 사용자로 세는 것(2026-11-25 사용자 결정, 시연자 손 규칙 1·3):
   *  - 관절이 온 장: 겹치는 관절에 머리나 어깨가 KPT_HIGH 이상이면 사용자다. 겹치는 관절이 없으면(손만 잡힘) 아니다.
   *  - 관절이 없는 장: 앞 장에서 겹치는 상자의 판정을 잇는다. 이을 판정이 없으면 관절 모델이 도는 동안은 아니다(다음 관절 장을 기다린다).
   *  - 로봇 실행 단계 중(core.acting)에는 화면 아래 가장자리(FEET_EDGE)에 닿고 얼굴 관절이 보이지 않은 상자를 뺀다(폰을 든 시연자의 손·몸).
   *  사람 감지가 없는 장에서 판정을 지운다(사람이 다시 보인 첫 장에는 관절이 온다). */
  users(frame: FrameMeta, people: Detection[], poses?: Pose[]): Detection[] {
    if (!people.length) {
      this.checks = [];
      return [];
    }
    if (poses) this.poseModel = true;
    const before = this.checks;
    this.checks = people.map((d) => {
      if (poses) {
        const p = closest(d.box, poses, people.length === 1);
        return { box: d.box, user: !!p && sure(p, USER_KPTS), face: !!p && sure(p, FACE_KPTS) };
      }
      const c = closest(d.box, before, people.length === 1);
      return { box: d.box, user: c ? c.user : !this.poseModel, face: c?.face ?? false };
    });
    const bottom = frame.height * FEET_EDGE;
    return people.filter((d, i) => {
      const c = this.checks[i]!;
      return c.user && !(this.core.acting && d.box[1] + d.box[3] >= bottom && !c.face);
    });
  }

  /** 사람 자리·방: 맞춘 뒤 가장 큰 사람 상자의 발이 보이면 그 바닥 자리와 방. 방 반영은 applyDetections 끝에서. */
  locatePerson(frame: FrameMeta, people: Detection[]): void {
    const main = people.reduce((a, b) => (b.score * area(b.box) > a.score * area(a.box) ? b : a));
    if (people.length !== 1) this.trail = [];
    const position = this.feet(frame.view, main.box, frame);
    if (!position) return;
    this.core.person.position = position;
    this.core.person.positionAt = frame.capturedAtMs;
    this.nextRoom = this.o.roomAt(position);
    if (frame.fresh_position && people.length === 1 && frame.capturedAtMs > (this.trail.at(-1)?.at_ms ?? -Infinity)) {
      this.trail = [...this.trail.slice(-1), { position, room: this.nextRoom?.id ?? null, at_ms: frame.capturedAtMs }];
    }
  }

  /** 사람이 있던 자리(마지막 발 자리)의 몸 가운데가 이 프레임 화면 안인가. 자리나 카메라를 모르면 아니다. */
  spotInView(frame: FrameMeta): boolean {
    const p = this.core.person.position;
    return !!(p && frame.view && inView(frame.view, [p[0], this.o.floorAt(p) + BODY_MID_M, p[1]]));
  }

  roomChange(at: number): WorldChange {
    return { kind: "person_room", at_ms: at, subject: PERSON, meaningful: true, room: this.core.person.room!.id, text: CHANGE_TEXT.personRoom(this.core.person.room!.label) };
  }

  /** 관절로 본 사람 자세(규칙: src/world/pose.ts): 가장 확실한 한 사람의 서 있음·앉아 있음·누워 있음. 쓰러짐 의심(src/world/fall.ts)이 되면 자세를 쓰러짐 의심으로 두고
   *  의미 있는 변화 줄을 한 번 내며, 일어날(서 있음·앉아 있음) 때까지 누운 자세 대신 그 값을 이어 둔다. 물건은 보지 않는다. */
  applyPose(frame: FrameMeta, poses: Pose[], changes: WorldChange[]): void {
    const core = this.core;
    const at = frame.capturedAtMs;
    const size = { width: frame.width, height: frame.height };
    const person = mainPerson(poses, this.downOf(frame.view, size));
    if (!person) return;
    const personFact = (facet: Facet, value: string) => {
      if (this.setPoseFact(core.person.facts, facet, value, at) && core.person.visible) {
        changes.push({ kind: "person_state", at_ms: at, subject: PERSON, meaningful: false, text: CHANGE_TEXT.state(OBJECT_NAME.person!, value) });
      }
    };
    const lean = person.lean ?? null;
    let pose: FallPose | null = person.level === "low" ? null : fallPose(lean, person.box, size, core.fallCfg);
    // 침대·소파 위로 빼려면 몸이 그 가구 자리에 비치고(기하는 후보만) 그 사람을 본 VLM 자리 답이 그 가구 위여야 한다. 그 답은 지금 누운 구간 안에서 찍혔고
    // FACT_FRESH_MS 안이어야 하며, 그 구간에 사람이 둘 넘게 보였으면 누구의 답인지 몰라 빼지 않는다. 답이 없거나 바닥이면 그대로 센다
    if (pose === "flat" && frame.view) {
      const spot = onRest(frame.view, [lean!.hip, lean!.shoulder], size, this.o.rests?.() ?? []);
      const said = core.person.facts.place;
      const since = core.fall.lyingSince() ?? at;
      if (spot && said && said.value === REST_PLACES[spot.kind] && said.at_ms >= since && at - said.at_ms <= FACT_FRESH_MS && core.crowdAt < since) pose = "rest";
    }
    const fall = core.fall.see(at, pose);
    if (fall === "fall") {
      this.setPoseFact(core.person.facts, "posture", POSE_FALL, at);
      changes.push({ kind: "person_state", at_ms: at, subject: PERSON, meaningful: true, text: CHANGE_TEXT.state(OBJECT_NAME.person!, POSE_FALL) });
      return;
    }
    if (core.fall.active) {
      // 일어나기 전(누운 채·가림)에는 쓰러짐 의심을 이어 둔다
      if (person.level !== "low") this.setPoseFact(core.person.facts, "posture", POSE_FALL, at);
      return;
    }
    const posture = (POSE_POSTURE as Record<string, string | undefined>)[person.posture];
    if (posture && person.level !== "low") personFact("posture", posture);
  }

  /** 사진 점에서 중력(아래) 방향(픽셀 벡터): 그 점의 광선 2m 앞 점과 그보다 0.1m 아래 점을 다시 비춘다. 카메라 자세가 없거나(맞추기 전)
   *  광선이 수직에서 viewDeg 안이면(거의 바로 아래·위) 모른다. */
  private downOf(view: CameraView | null, size: { width: number; height: number }): (pt: Pt) => Pt | null {
    const steep = Math.cos((this.core.fallCfg.viewDeg * Math.PI) / 180);
    return (pt) => {
      if (!view) return null;
      const d = rayDir(view, [(pt[0] / size.width) * 2 - 1, 1 - (pt[1] / size.height) * 2]);
      if (Math.abs(d[1]) >= steep) return null;
      const o = view.origin;
      const near: V3 = [o[0] + d[0] * 2, o[1] + d[1] * 2, o[2] + d[2] * 2];
      const a = pixelOf(view, near, size), b = pixelOf(view, [near[0], near[1] - 0.1, near[2]], size);
      if (!a || !b) return null;
      const v: Pt = [b[0] - a[0], b[1] - a[1]];
      return Math.hypot(v[0], v[1]) > 1e-6 ? v : null;
    };
  }

  /** 쓰러짐 의심인 동안 사람 자세는 관절만 바꾼다(VLM 답이 알림을 지우지 않게). */
  fallHeld(id: string, facet: Facet): boolean {
    return id === PERSON && facet === "posture" && this.core.fall.active;
  }

  private setPoseFact(facts: Facts, facet: Facet, value: string, atMs: number): boolean {
    // 관절은 프레임마다 오므로 장 수가 아니라 시간으로 확신한다: 같은 값이 한 장어치(2초) 이어져야 confirmed
    const changed = this.core.vlm.setFact(facts, facet, value, atMs, facet === "holding", this.core.stepMs);
    const f = facts[facet];
    if (f && f.value === value && f.at_ms === atMs) this.core.byPose.add(f);
    return changed;
  }

  /** 관절이 붙인 그 값이면 지운다. */
  dropPoseFact(facts: Facts, facet: Facet, value: string): void {
    const f = facts[facet];
    if (f && f.value === value && this.core.byPose.has(f)) delete facts[facet];
  }

  /** 관절이 이 프레임(또는 더 새 프레임)에서 붙인 사실이면 VLM 답이 바꾸거나 지우지 않는다. */
  poseHolds(f: WorldFact | undefined, capturedAtMs: number): boolean {
    return !!f && this.core.byPose.has(f) && f.at_ms >= capturedAtMs;
  }
}
