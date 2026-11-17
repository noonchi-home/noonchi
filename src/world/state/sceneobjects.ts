// World State의 장면 VLM 물건(SceneObservation.objects): VLM 무조건 우선(src/world/merge.ts)으로 물건 보임·되살림·확정을 정하고 답 번호(v1…)를 물건 id에 잇는다.
// 물건 식별은 자리로 한다(core.matchAt, 전체 사진 YOLO·가까이 보기와 같은 규칙). 종류는 core.voteClass가 따로 바꾼다.
// 손에 있음·가림으로 답했거나 상자가 사진 끝에 닿으면 놓인 자리가 아니라 자리를 고치지 않는다.
// 손에 있음으로 답한 물건은 든 물건(같은 무리, 손에 있음)이나 폰 눈 REACH_M 안의 가장 가까운 확인된 같은 무리 물건으로 잇는다
// (1인칭 집기: 폰을 든 사람이 컵을 들면 YOLO는 들린 컵을 다른 자리 새 후보로 잡는다. 그 후보는 버리고 새 id를 만들지 않는다).
import type { WorldChange } from "../../contract/world.js";
import type { CameraView, SceneObservation } from "../../contract/observe.js";
import type { Plan2 } from "../../contract/events.js";
import { CHANGE_TEXT, onSurface } from "../labels.js";
import { vlmFirst } from "../merge.js";
import { placePoint, type PlaneSurface } from "../place.js";
import { NEAR_M, POSE_HOLD, sameDrinkware, VLM_ONLY, type ObjClass } from "../vocab.js";
import { OBJ_CLASSES, Part, VLM_CONFIRM_FRAMES, type Obj } from "./core.js";

/** 장면 VLM 답을 본 사진: 원래 엔진 프레임의 카메라·크기. VLM 물건 상자(사진 비율)를 트윈 자리로 바꾼다. */
export interface SceneLook { view: CameraView; width: number; height: number }
/** 손에 있음으로 답한 물건을 폰 눈에서 이만큼(m, 수평) 안의 물건으로 잇는다. */
export const REACH_M = NEAR_M;
/** 상자가 사진 끝에서 이만큼(비율) 안이면 잘린 것으로 본다(아랫변이 놓인 자리가 아닐 수 있다). */
const EDGE = 0.01;

type Placed = ReturnType<typeof placePoint>;

/** 장면 VLM 물건 넣기. */
export class SceneObjects extends Part {
  /** 장면 VLM 답 하나(원본 프레임 frameId, 촬영 at)의 물건을 넣는다. ids에 VLM 물건 번호(그리고 손에 있음으로 다시 이은 감지 번호)를 물건 id로 더한다. eye: 폰 눈 수평 자리. */
  link(frameId: string, at: number, scene: SceneObservation, ids: Map<string, string>, look: SceneLook | undefined, eye: Plan2 | null): WorldChange[] {
    const core = this.core;
    const changes: WorldChange[] = [];
    const surfaces = look ? this.o.surfaces() : [];
    const used = new Set<string>();
    const said = (id: string) => scene.observations.filter((ob) => ob.object_id === id).map((ob) => ob.state as string);
    for (const v of scene.objects ?? []) {
      if (!OBJ_CLASSES.has(v.cls)) continue;
      const cls = v.cls as ObjClass;
      const states = [...said(v.id), ...(v.det ? said(v.det) : [])];
      const lifted = states.includes(POSE_HOLD.object);
      const hidden = states.some((s) => (VLM_ONLY as readonly string[]).includes(s));
      const linked = v.det ? ids.get(v.det) : undefined;
      let obj: Obj | null = linked ? core.objects.get(linked) ?? null : null;
      if (lifted) {
        const hold = this.liftTarget(cls, eye, used);
        if (hold && hold !== obj) {
          if (obj && !obj.confirmed) core.forget(obj.id);
          obj = hold;
          if (v.det) ids.set(v.det, hold.id);
        }
      }
      const edge = v.box.x <= EDGE || v.box.y <= EDGE || v.box.x + v.box.w >= 1 - EDGE || v.box.y + v.box.h >= 1 - EDGE;
      const placed = !linked && look && !lifted && !hidden ? this.place(v.box, look, surfaces) : null;
      if (!obj && placed?.position) obj = core.matchAt(cls, placed.position, used);
      // VLM 무조건 우선: YOLO가 못 봤어도 VLM이 본 물건은 있다(놓인 자리를 알 때 후보로 만든다)
      if (!obj && placed?.position && vlmFirst(false, true)) obj = core.create(cls, at, frameId);
      if (!obj) continue;
      used.add(obj.id);
      ids.set(v.id, obj.id);
      this.seen(obj, cls, at, frameId, edge ? null : placed, surfaces, changes);
    }
    return changes;
  }

  /** 손에 있음으로 답한 물건이 이을 물건: 손에 있는 같은 무리 확인 물건이 하나면 그것, 아니면 폰 눈 REACH_M 안의 가장 가까운 확인된 같은 무리 물건(같은 종류 먼저). */
  private liftTarget(cls: ObjClass, eye: Plan2 | null, used: ReadonlySet<string>): Obj | null {
    const kin = [...this.core.objects.values()].filter((x) => x.confirmed && !used.has(x.id) && sameDrinkware(x.cls, cls));
    const held = kin.filter((x) => x.facts.place?.value === POSE_HOLD.object);
    if (held.length === 1) return held[0]!;
    if (!eye) return null;
    const flat = (x: Obj) => Math.hypot(x.position![0] - eye[0], x.position![2] - eye[1]);
    return kin.filter((x) => x.position && flat(x) <= REACH_M)
      .sort((a, b) => Number(a.cls !== cls) - Number(b.cls !== cls) || flat(a) - flat(b))[0] ?? null;
  }

  /** VLM 물건 상자(사진 비율)의 아랫변 가운데를 트윈 자리로. */
  private place(box: { x: number; y: number; w: number; h: number }, look: SceneLook, surfaces: PlaneSurface[]): Placed {
    const foot: [number, number] = [(box.x + box.w / 2) * look.width, (box.y + box.h) * look.height];
    return placePoint(look.view, foot, { width: look.width, height: look.height }, surfaces, this.o.floorAt);
  }

  /** VLM이 이 물건을 at 촬영에 봤다: 종류 셈, VLM 본 시각, 자리(놓인 자리를 알고 더 새 촬영일 때), 확정(후보는 서로 다른 원본 프레임 VLM_CONFIRM_FRAMES장)·되살림·시야 안으로. */
  private seen(obj: Obj, cls: ObjClass, at: number, frameId: string, placed: Placed | null, surfaces: PlaneSurface[], changes: WorldChange[]): void {
    const core = this.core;
    if (obj.confirmed) core.voteClass(obj, cls, at, frameId);
    obj.vlmSeen = Math.max(obj.vlmSeen ?? at, at);
    obj.lastSeen = Math.max(obj.lastSeen, at);
    obj.lastInView = Math.max(obj.lastInView, at);
    if (placed?.position && core.newerPlace(obj, at, false)) {
      obj.position = placed.position;
      obj.surface = placed.surface;
      obj.surfaceLabel = placed.surface ? surfaces.find((s) => s.id === placed.surface)?.label ?? null : null;
      obj.part = placed.part;
      obj.errorM = placed.errorM;
      obj.room = this.o.roomAt([placed.position[0], placed.position[2]])?.id ?? null;
      obj.posAt = at;
      obj.posCloser = false;
    }
    const appear = () => {
      obj.confirmed = true;
      obj.status = "present";
      obj.goneAt = null;
      core.judge(obj, at, frameId, false);
      core.clearSightings(obj);
      changes.push({ kind: "appeared", at_ms: at, subject: obj.id, meaningful: true, text: CHANGE_TEXT.appeared(core.name(obj), obj.surfaceLabel ? onSurface(obj.surfaceLabel) : null) });
    };
    if (!obj.confirmed) {
      if (!obj.vlmFrames.includes(frameId)) obj.vlmFrames.push(frameId);
      if (obj.vlmFrames.length >= VLM_CONFIRM_FRAMES) appear();
      return;
    }
    if (obj.status === "gone" && obj.goneAt !== null && at > obj.goneAt) appear();
    else if (obj.status === "out_of_view" && at >= obj.judgedAt) {
      obj.status = "present";
      core.judge(obj, at, frameId, false);
      changes.push({ kind: "back_in_view", at_ms: at, subject: obj.id, meaningful: false, text: CHANGE_TEXT.backInView(core.name(obj)) });
    }
  }
}

