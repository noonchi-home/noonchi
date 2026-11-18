// World State의 사람·관절(People): 사람 자리·방(가장 큰 사람 상자의 발), 관절 자세(서 있음·앉아 있음·누워 있음)와 쓰러짐 의심(src/world/fall.ts FallWatch).
// 쓰러짐 의심인 동안 사람 자세는 관절만 바꾸고(VLM 자세 답은 막음), 침대·소파 위로 빼는 것은 지금 누운 구간 안에서 찍힌 그 사람의 VLM 자리 답(침대 위·소파 위)으로만 한다.
// 관절이 붙인 사실은 같은 프레임 VLM 답보다 앞선다(poseHolds). 관절은 물건을 보지 않는다: 손에 있음·마시기·따르기 같은 물건 사실은 장면 VLM 답으로만 정한다
// (사용자 결정 2026-11-18, 판단 입력에 YOLO 물건 사실을 넣지 않는다).
import type { Facet, WorldChange, WorldFact } from "../../contract/world.js";
import type { CameraView, Detection, FrameMeta, Pose } from "../../contract/observe.js";
import { CHANGE_TEXT, OBJECT_NAME } from "../labels.js";
import { onRest, pixelOf, placeBox, rayDir } from "../place.js";
import { mainPerson, type Pt } from "../pose.js";
import { fallPose, type FallPose } from "../fall.js";
import { FACT_FRESH_MS, POSE_FALL, POSE_POSTURE, REST_PLACES } from "../vocab.js";
import { PERSON, Part, type Facts, type Plan2, type V3 } from "./core.js";

/** 상자 아래가 프레임 높이의 이 비율보다 아래면 발이 잘린 것으로 본다. */
const FEET_EDGE = 0.98;
const area = (b: Detection["box"]) => Math.max(0, b[2]) * Math.max(0, b[3]);

/** 사람 자리·방, 관절 사실, 쓰러짐 의심. */
export class People extends Part {
  /** 이번 프레임의 발 자리에서 본 방. undefined는 새 발 자리 없음, null은 집 안 방이 아님(방을 모름으로). 감지 합치기(applyDetections) 끝에서 반영한다. */
  nextRoom: { id: string; label: string } | null | undefined = undefined;

  /** 사람 자리·방: 맞춘 뒤 가장 큰 사람 상자의 발이 보이면 그 바닥 자리와 방. 방 반영은 applyDetections 끝에서. */
  locatePerson(frame: FrameMeta, people: Detection[]): void {
    const main = people.reduce((a, b) => (b.score * area(b.box) > a.score * area(a.box) ? b : a));
    const feet = main.box[1] + main.box[3] < frame.height * FEET_EDGE;
    const placed = frame.view && feet ? placeBox(frame.view, main.box, { width: frame.width, height: frame.height }, [], this.o.floorAt) : null;
    if (!placed?.position) return;
    const position: Plan2 = [placed.position[0], placed.position[2]];
    this.core.person.position = position;
    this.core.person.positionAt = frame.capturedAtMs;
    this.nextRoom = this.o.roomAt(position);
  }

  roomChange(at: number): WorldChange {
    return { kind: "person_room", at_ms: at, subject: PERSON, meaningful: true, text: CHANGE_TEXT.personRoom(this.core.person.room!.label) };
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
