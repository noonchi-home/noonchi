// World State의 장면 VLM 물건(SceneObservation.objects): 물건은 장면 VLM 답으로만 생기고·확정되고·사라진다(사용자 결정 2026-11-18, VLM 무조건 우선 src/world/merge.ts).
// YOLO 물건 감지는 World State에 들어가지 않는다. 같은 사진의 YOLO 감지와 이어진(det) VLM 물건은 자리를 그 감지 바닥 점으로 낸다(VLM 상자보다 정확하다).
// - 식별: 자리로 한다(core.matchAt, VLM_MATCH_M 안). 종류는 core.voteClass가 따로 바꾼다. 맞는 것이 없으면 실행 추적 대상(focusTarget), 그 사진 시야 안의 같은 무리
//   확인 물건 하나(inViewKin), 그다음 새 후보. 카메라를 본 적 없는 집(맞추기 전)은 자리 없이 같은 무리 물건을 처음 본 순서로 잇는다.
// - 확정: 서로 다른 원본 프레임 VLM_CONFIRM_FRAMES장, 두 장의 폰 눈이 VLM_STILL_M 안(걷는 동안 찍힌 상자 투영은 틀린다). 맞추기 전은 폰 눈 없이 장 수만.
// - 사라짐: 그 자리가 시야 안인 장면 VLM 사진 VLM_GONE_PHOTOS장(원본 프레임마다 하나, 마지막으로 본 촬영보다 새 것)이 그 물건을 목록에 넣지 않으면.
//   시야 밖 사진은 세지 않고 시야 밖으로 둔다. 손에 있음·지킴·실행 추적 대상은 세지 않는다. 늦게 온 옛 사진이 그 뒤에 봤으면 다시 세어 거둔다.
// - 손에 있음·가림으로 답했거나 상자가 사진 끝에 닿으면 놓인 자리가 아니라 자리를 고치지 않는다.
//   손에 있음으로 답한 물건은 든 물건(같은 무리, 손에 있음)이나 폰 눈 REACH_M 안의 가장 가까운 확인된 같은 무리 물건으로 잇는다.
import type { Facet, WorldChange } from "../../contract/world.js";
import type { CameraView, SceneObservation } from "../../contract/observe.js";
import type { Plan2 } from "../../contract/events.js";
import { CHANGE_TEXT, onSurface } from "../labels.js";
import { vlmFirst } from "../merge.js";
import { inView, pixelOf, placePoint, sizeOf, type PlaneSurface } from "../place.js";
import { CLASSES, DRINKWARE, NEAR_M, NOW_FACETS, POSE_HOLD, sameDrinkware, VLM_ONLY, type ObjClass } from "../vocab.js";
import { GONE_KEEP_MS, OBJ_CLASSES, Part, SIZE_SAMPLES, VLM_CANDIDATE_MS, VLM_CONFIRM_FRAMES, VLM_GONE_PHOTOS, VLM_MATCH_M, VLM_MOVE_M, dist, fromCamera, type Obj, type TrailSample, type V3 } from "./core.js";

/** 그 사진의 YOLO 감지 하나: 감지 번호(d1…), 상자(엔진 프레임 픽셀 [x, y, w, h]), 바닥 점(픽셀, 없으면 상자 아랫변 가운데). */
export interface LookDet { id: string; box: readonly [number, number, number, number]; foot?: readonly [number, number] }
/** 장면 VLM 답을 본 사진: 원래 엔진 프레임의 카메라·크기와 그 사진을 찍은 때의 폰 눈 수평 자리(모르면 null), 그 사진의 YOLO 감지.
 *  VLM 물건 상자(사진 비율)나 이어진 감지의 바닥 점을 트윈 자리로 바꾼다. */
export interface SceneLook { view: CameraView; width: number; height: number; eye?: Plan2 | null; dets?: readonly LookDet[] }
/** 손에 있음으로 답한 물건을 폰 눈에서 이만큼(m, 수평) 안의 물건으로 잇는다. */
export const REACH_M = NEAR_M;
/** 장면 VLM 새 물건을 확정하는 두 장의 폰 눈은 이만큼(m) 안이어야 한다(걷는 동안 찍힌 상자 투영은 틀린다). */
const VLM_STILL_M = 0.3;
/** 상자가 사진 끝에서 이만큼(비율) 안이면 잘린 것으로 본다(아랫변이 놓인 자리가 아닐 수 있다). */
const EDGE = 0.01;
/** VLM 상자 아랫변 오차(사진 높이 비율): 광선이 바닥에 닿아도 이만큼 아래(카메라 쪽) 안에서 트윈 면에 닿으면 그 면 자리다. YOLO 감지 바닥 점은 SNAP_UP_DET. */
const SNAP_UP = 0.04;
const SNAP_UP_DET = 0.01;
/** 바닥 자리를 믿는가: 아랫변을 사진 높이 LOOSE_DV만큼 옮겼을 때 자리가 LOOSE_M 넘게 움직이면(먼 바닥을 비스듬히 본 광선) 믿지 않는다. */
const LOOSE_DV = 0.03;
const LOOSE_M = 0.5;
/** VLM 상자로 믿는 바닥 자리의 카메라 수평 거리 한도(m). 트윈 면 위 자리와 YOLO 감지 바닥 점은 이 한도가 없다. */
const FAR_FLOOR_M = 3;
/** 움직임을 보는 시간(ms): 이 안의 다른 자리와 견준다. */
const SETTLE_MS = 3000;
/** 제자리로 보는 움직임: 트윈 자리 0.15m, 트윈 자리를 모르면 사진 가운데 점이 사진 너비·높이의 5%. */
const MOVE_M = 0.15;
const MOVE_IMAGE = 0.05;

type Placed = ReturnType<typeof placePoint>;
type Px = [number, number, number, number];
/** 이번 답에서 등장을 확인한(되살린 것 포함) 물건과 그 촬영(옮김 처리 liftHolds). */
interface Fresh { obj: Obj; at: number; frame: string }

/** 장면 VLM 물건 넣기. */
export class SceneObjects extends Part {
  /** 장면 VLM 답 하나(원본 프레임 frameId, 촬영 at)의 물건을 넣는다. ids에 VLM 물건 번호와 그 물건이 이어진 감지 번호(det)를 물건 id로 더한다.
   *  look: 그 사진의 카메라·크기·폰 눈·YOLO 감지(카메라가 없으면 undefined). */
  link(frameId: string, at: number, scene: SceneObservation, ids: Map<string, string>, look: SceneLook | undefined): WorldChange[] {
    const eye = look?.eye ?? null;
    const core = this.core;
    if (look) core.sawCamera = true;
    // 맞춘 뒤 카메라 없는 답은 물건 식별·사라짐 셈에 쓰지 않는다(자리 모름 유령 컵)
    const blind = !look && core.sawCamera;
    const changes: WorldChange[] = [];
    const fresh: Fresh[] = [];
    const surfaces = look ? this.o.surfaces() : [];
    const used = new Set<string>();
    /** 이 답이 본 물건(가림 답은 있다는 근거가 아니라 빼고, 사라짐 셈을 막지 않는다). */
    const saw = new Set<string>();
    const said = (id: string) => scene.observations.filter((ob) => ob.object_id === id).map((ob) => ob.state as string);
    // 한 답 안에서 같은 무리 상자가 크게 겹치면 한 물건이다(가로 유리컵 v1: 한 잔을 상자 둘로 답했다). 겹친 번호는 앞 번호의 물건 id를 받는다
    const { kept, alias } = dedupe(scene.objects ?? []);
    // 물건마다 상자·바닥 점 자리를 먼저 낸다
    const items = (blind ? [] : kept).filter((v) => OBJ_CLASSES.has(v.cls)).map((v) => {
      const cls = v.cls as ObjClass;
      const states = [...said(v.id), ...(v.det ? said(v.det) : [])];
      const lifted = states.includes(POSE_HOLD.object);
      const hidden = states.some((s) => (VLM_ONLY as readonly string[]).includes(s));
      // 같은 사진의 YOLO 감지와 이어졌으면(det) 자리·크기는 그 감지 상자로 낸다
      const d = v.det ? look?.dets?.find((x) => x.id === v.det) : undefined;
      const px: Px | null = look ? (d ? [...d.box] : [v.box.x * look.width, v.box.y * look.height, v.box.w * look.width, v.box.h * look.height]) : null;
      const foot: [number, number] | null = px ? (d?.foot ? [d.foot[0], d.foot[1]] : [px[0] + px[2] / 2, px[1] + px[3]]) : null;
      const edge = !!px && !!look && (px[0] <= EDGE * look.width || px[1] <= EDGE * look.height || px[0] + px[2] >= (1 - EDGE) * look.width || px[1] + px[3] >= (1 - EDGE) * look.height);
      // 바닥 점 자리: 트윈 면을 먼저 맞추고, 상자 높이 오차에 크게 흔들리는 먼 바닥 자리는 믿지 않는다(잇기·자리·새 물건에 쓰지 않음)
      const spot = look && foot ? this.footSpot(foot, look, surfaces, !!d) : null;
      // 상자 자리: 들렸거나 가렸으면 잇기에만 쓰고(놓인 자리가 아니다) 자리·새 물건에는 쓰지 않는다
      const placed = lifted || hidden ? null : spot;
      return { v, cls, lifted, hidden, px, edge, spot, placed, obj: null as Obj | null };
    });
    // 0차: 든 물건은 실행 추적의 집기 대상이 먼저다(들린 근거: 이 답의 손에 있음). 이을 컵이 모호하면 미룬다(liftTarget null)
    for (const it of items) {
      if (!it.lifted) continue;
      it.obj = core.focusTarget(it.cls, null, used, true) ?? this.liftTarget(it.cls, eye, used);
      if (it.obj) used.add(it.obj.id);
    }
    // 1차: 자리로 잇기(core.matchAt, VLM_MATCH_M 안)를 가까운 짝부터 한다. 같은 답의 먼 상자가 시야 안 물건을 먼저 가져가 가까운 상자가 새 id가 되지 않게(가로 키 큰 컵 v1)
    // 든 물건 잇기가 모호하면 상자 투영 자리로 우회해 잇지도 않는다(Codex e0fb3b8 4)
    const near = (it: (typeof items)[number]) => {
      const hit = it.spot?.position && !it.lifted ? core.matchAt(it.cls, it.spot.position, used, VLM_MATCH_M) : null;
      return hit && it.spot?.position && hit.position ? dist(hit.position, it.spot.position) : Number.POSITIVE_INFINITY;
    };
    for (const it of [...items].sort((x, y) => near(x) - near(y))) {
      if (!it.spot?.position || it.lifted) continue;
      it.obj = core.matchAt(it.cls, it.spot.position, used, VLM_MATCH_M);
      if (it.obj) used.add(it.obj.id);
    }
    for (const it of items) {
      const { v, cls, lifted, hidden, px, edge, spot, placed } = it;
      let obj = it.obj;
      // 손에 있던 물건이 다른 자리 PUT_DOWN_M 안에 다시 보였다(내려놓음)
      if (!obj && spot?.position && !lifted) obj = core.putDown(cls, spot.position, used);
      // 실행 추적이 지금 집기·내려놓기 하는 대상(들린 컵, 바짝 댄 잔: 그 사진에서 대상 자리가 상자 안에 비침, 목적지에 놓인 컵)
      const sees = look && px ? (p: V3) => {
        const q = pixelOf(look.view, p, { width: look.width, height: look.height });
        return !!q && q[0] >= px[0] - px[2] * 0.1 && q[0] <= px[0] + px[2] * 1.1 && q[1] >= px[1] - px[3] * 0.1 && q[1] <= px[1] + px[3] * 1.1;
      } : undefined;
      if (!obj) obj = core.focusTarget(cls, spot?.position ?? null, used, false, sees, eye);
      // 그 사진 시야 안에 아직 이 답에서 쓰지 않은 같은 무리 확인 물건이 하나뿐이면 그것이다(거리 제한 없음, 둘 이상이면 모호해 미룬다). VLM 상자 투영은 많이 흔들려
      // 같은 컵이 새 id가 됐다(가로 유리컵 r10·키 큰 컵 r4·머그 r7 재생). 새 물건은 시야 안 확인 물건보다 VLM이 더 많이 답할 때만 만든다
      if (!obj && !lifted && look) obj = this.inViewKin(cls, used, look.view);
      // 맞추기 전(카메라를 본 적 없음): 자리를 모르니 같은 무리 물건을 처음 본 순서로 잇는다. 손에 든 물건은 같은 종류만(냉장고에서 꺼낸 병이 식탁 컵이 되지 않게)
      if (!obj && !look) obj = this.blindKin(cls, used, lifted);
      // VLM 무조건 우선: YOLO가 못 봤어도 VLM이 본 물건은 있다. 놓인 자리와 그 사진의 폰 눈을 알 때(맞추기 전은 자리 없이) 후보로 만든다.
      // 손에 든 물건은 놓인 자리가 아니라 카메라가 있으면 만들지 않는다(1인칭 집기: 든 컵이 새 id가 되지 않게). 사진 끝에 닿은 상자는 놓인 자리를 몰라 만들지 않는다
      if (!obj && !hidden && (look ? !lifted && !edge && !!placed?.position && !!eye : true) && vlmFirst(false, true)) {
        obj = core.create(cls, at, frameId);
        obj.vlmEye = eye;
      }
      if (!obj) continue;
      // 확인 전 후보가 마시는 그릇 무리 안 다른 종류 답을 받으면 기본 종류(컵, DRINKWARE 첫째)이고 id도 그 꼴이다: 병은 두 답이 이어 병일 때만이다
      // (키 큰 컵 m1·c1, 유리잔 c1: 유리잔이 한 장 「병」 답으로 bottle_1이 돼 컵 치우기 계획 대상이 「보이지 않아」로 막혔다)
      if (!obj.confirmed && obj.cls !== cls && sameDrinkware(obj.cls, cls) && obj.cls !== DRINKWARE[0]) obj = core.recast(obj, DRINKWARE[0]);
      used.add(obj.id);
      ids.set(v.id, obj.id);
      if (v.det) ids.set(v.det, obj.id);
      // 가림은 있다는 근거가 아니다: 사실(가림)만 잇고 보임·확정·자리는 바꾸지 않는다
      if (hidden) continue;
      saw.add(obj.id);
      this.seen(obj, cls, at, frameId, edge ? null : placed, surfaces, changes, fresh, eye, look);
      if (look && px && placed?.position && !edge && (CLASSES[cls].facets as readonly string[]).includes("contents")) {
        // 그릇은 크기를 잰다(위에서 컵 안을 보는 판정이 쓴다, src/world/place.ts cupInside)
        const size = sizeOf(look.view, px, { width: look.width, height: look.height }, placed.position);
        if (size) obj.sizes = [...obj.sizes, { height: size.height, width: size.width }].slice(-SIZE_SAMPLES);
      }
      // 움직임·정지 근거(들고 감 보호): 이 사진에서 본 자리(들린 컵은 상자 투영, 모르면 사진 가운데 점)
      const center: [number, number] = px && look ? [(px[0] + px[2] / 2) / look.width, (px[1] + px[3] / 2) / look.height] : [v.box.x + v.box.w / 2, v.box.y + v.box.h / 2];
      this.track(obj, [{ at, frame: frameId, position: spot?.position ?? null, center }]);
    }
    for (const [dropped, keep] of alias) {
      const id = ids.get(keep);
      if (!id) continue;
      ids.set(dropped, id);
      const d = scene.objects?.find((x) => x.id === dropped)?.det;
      if (d) ids.set(d, id);
    }
    if (!blind) this.unseen(frameId, at, saw, look, changes);
    core.closer.liftHolds(fresh, saw);
    return changes;
  }

  /** 이 답에 없던 물건: 확인 전 후보는 VLM_CANDIDATE_MS 넘게 못 봤으면 잊고(후보 자리로 남김), 사라진 물건은 GONE_KEEP_MS 뒤 잊는다.
   *  확인된 물건은 그 사진에서 시야 밖이면 시야 밖으로 두고, 시야 안이면 사라짐 셈(vlmMiss)에 그 사진을 넣는다. */
  private unseen(frameId: string, at: number, saw: ReadonlySet<string>, look: SceneLook | undefined, changes: WorldChange[]): void {
    const core = this.core;
    for (const obj of [...core.objects.values()]) {
      if (saw.has(obj.id)) continue;
      if (!obj.confirmed) {
        if (at - obj.lastSeen >= VLM_CANDIDATE_MS) core.loseCandidate(obj, at);
        continue;
      }
      if (obj.status === "gone") {
        if (obj.goneAt !== null && at - obj.goneAt > GONE_KEEP_MS) core.forget(obj.id);
        continue;
      }
      // 가까이 보기가 더 새 촬영이나 같은 원본 프레임 양성으로 본 물건은 이 사진으로 보임을 바꾸지 않는다
      if (core.staleJudge(obj, at, frameId)) continue;
      // 시야: 카메라가 있으면 그 자리가 사진 안인가(자리를 모르면 모름), 맞추기 전은 자리 없는 물건만 시야 안으로 본다
      const vis = look ? (obj.position ? inView(look.view, obj.position) : null) : obj.position ? null : true;
      if (vis === null) continue;
      if (!vis) {
        core.judge(obj, at, frameId, false);
        if (obj.status === "present") {
          obj.status = "out_of_view";
          changes.push({ kind: "out_of_view", at_ms: at, subject: obj.id, meaningful: false, text: CHANGE_TEXT.outOfView(core.name(obj)) });
        }
        continue;
      }
      if (obj.status === "out_of_view") {
        obj.status = "present";
        core.judge(obj, at, frameId, false);
        changes.push({ kind: "back_in_view", at_ms: at, subject: obj.id, meaningful: false, text: CHANGE_TEXT.backInView(core.name(obj)) });
      }
      if (core.missHeld(obj, at) || (obj.vlmSeen !== null && at <= obj.vlmSeen)) continue;
      if (!obj.vlmMiss.some((m) => m.frame === frameId)) obj.vlmMiss.push({ frame: frameId, at });
      if (obj.vlmMiss.length < VLM_GONE_PHOTOS) continue;
      const goneAt = Math.max(...obj.vlmMiss.map((m) => m.at));
      core.judge(obj, goneAt, frameId, false);
      obj.status = "gone";
      obj.goneAt = goneAt;
      obj.missGone = true;
      for (const f of NOW_FACETS.object) delete obj.facts[f];
      changes.push({ kind: "gone", at_ms: goneAt, subject: obj.id, meaningful: true, text: CHANGE_TEXT.gone(core.name(obj)) });
    }
  }

  /** 바닥 점(픽셀)의 트윈 자리. 광선이 바닥에 닿았는데 사진 높이 SNAP_UP 안 아래 점(카메라 쪽)이 트윈 면에 닿으면 그 면 자리다(상자 아랫변이 식탁 먼 끝을
   *  조금 넘었다). 면에 닿지 않은 바닥 자리가 상자 높이 오차(사진 높이 LOOSE_DV)에 LOOSE_M 넘게 흔들리거나, VLM 상자인데 카메라에서 FAR_FLOOR_M 넘으면
   *  믿지 않는다(null).
   *  precise: YOLO 감지 바닥 점(마스크)이라 면 맞추기 폭을 SNAP_UP_DET로 줄인다. */
  private footSpot(foot: [number, number], look: SceneLook, surfaces: PlaneSurface[], precise: boolean): Placed | null {
    const size = { width: look.width, height: look.height };
    const at = (dv: number) => placePoint(look.view, [foot[0], foot[1] + dv * look.height], size, surfaces, this.o.floorAt);
    const p0 = at(0);
    if (!p0.position || p0.surface) return p0;
    const up = precise ? SNAP_UP_DET : SNAP_UP;
    for (let k = 1; k <= 4; k++) {
      const p = at((up * k) / 4);
      if (p.position && p.surface) return p;
    }
    // VLM 상자만으로는 카메라에서 FAR_FLOOR_M 넘는 바닥 자리를 믿지 않는다(창 너머 발코니 장식, 걷는 동안 어긋난 카메라)
    const o = look.view.origin;
    if (!precise && Math.hypot(p0.position[0] - o[0], p0.position[2] - o[2]) > FAR_FLOOR_M) return null;
    const near = at(LOOSE_DV);
    if (!near.position) return null;
    return Math.hypot(near.position[0] - p0.position[0], near.position[2] - p0.position[2]) > LOOSE_M ? null : p0;
  }

  /** 손에 있음으로 답한 물건이 이을 물건: 손에 있는 같은 무리 확인 물건이 하나면 그것(둘 이상이면 모호), 아니면 그 사진의 폰 눈 REACH_M 안의 확인된 같은 무리 물건이
   *  하나일 때 그것(같은 종류가 있으면 같은 종류 중에서). 모호하면 null(잇기를 미룬다). */
  private liftTarget(cls: ObjClass, eye: Plan2 | null, used: ReadonlySet<string>): Obj | null {
    const kin = [...this.core.objects.values()].filter((x) => x.confirmed && !used.has(x.id) && sameDrinkware(x.cls, cls));
    const held = kin.filter((x) => x.facts.place?.value === POSE_HOLD.object);
    if (held.length) return held.length === 1 ? held[0]! : null;
    if (!eye) return null;
    const near = kin.filter((x) => x.position && Math.hypot(x.position[0] - eye[0], x.position[2] - eye[1]) <= REACH_M);
    const same = near.filter((x) => x.cls === cls);
    const pool = same.length ? same : near;
    return pool.length === 1 ? pool[0]! : null;
  }

  /** 장면 VLM 상자 자리로 옮기는가: 자리를 모르는 물건·후보는 옮긴다. 확인된 물건은 VLM_MOVE_M 안 흔들림은 버리고, 그보다 먼 자리는 다른 원본 프레임의 더 새 촬영이
   *  그 근처(VLM_MOVE_M 안)를 이어 말할 때만 옮긴다(가로 유리컵 r4: 상자 투영이 흔들려 놓인 곳·같은 물건 잇기가 흔들렸다). */
  private moved(obj: Obj, placed: Placed, frameId: string, at: number): boolean {
    const position = placed.position!;
    if (!obj.confirmed || !obj.position) return true;
    // 좌표 흔들림(VLM_MOVE_M 안)과 면·싱크볼 경계 바뀜을 따로 본다: 같은 면·같은 칸이면 흔들림이라 버리고,
    // 면이나 싱크볼 안·밖이 바뀌었으면 거리가 짧아도 다른 원본 프레임의 더 새 촬영이 같은 면·칸을 이어 말할 때 옮긴다(Codex e0fb3b8 3)
    const sameSpot = placed.surface === obj.surface && placed.part === obj.part;
    if (sameSpot && dist(obj.position, position) <= VLM_MOVE_M) {
      obj.posVote = null;
      return false;
    }
    const v = obj.posVote;
    const agree = v && v.frame !== frameId && at > v.at && (sameSpot ? dist(v.position, position) <= VLM_MOVE_M : v.surface === placed.surface && v.part === placed.part);
    if (agree) {
      obj.posVote = null;
      return true;
    }
    obj.posVote = { position, frame: frameId, at, surface: placed.surface, part: placed.part };
    return false;
  }

  /** 그 사진 시야 안의 같은 무리 확인 물건 중 이 답에서 아직 쓰지 않은 것이 하나뿐이면 그것(같은 종류가 있으면 같은 종류 중에서). 둘 이상이면 모호해 null.
   *  확인 전 후보는 자리(core.matchAt, VLM_MATCH_M 안)로만 잇는다: 거리 없이 이으면 먼 곳에 한 장씩 나온 상자 둘이 한 물건의 두 장으로 확정됐다(Codex P2 41e1181). */
  private inViewKin(cls: ObjClass, used: ReadonlySet<string>, view: CameraView): Obj | null {
    const kin = [...this.core.objects.values()].filter((x) => x.confirmed && x.status !== "gone" && !used.has(x.id) && sameDrinkware(x.cls, cls) && x.position && inView(view, x.position));
    const same = kin.filter((x) => x.cls === cls);
    const pool = same.length ? same : kin;
    return pool.length === 1 ? pool[0]! : null;
  }

  /** 맞추기 전: 이 답에서 아직 쓰지 않은 사라지지 않은 같은 무리 물건(같은 종류 먼저, 확인된 것 먼저, 처음 본 순서). same이면 같은 종류만. */
  private blindKin(cls: ObjClass, used: ReadonlySet<string>, same = false): Obj | null {
    const pool = [...this.core.objects.values()].filter((x) => x.status !== "gone" && !used.has(x.id) && (same ? x.cls === cls : sameDrinkware(x.cls, cls)));
    return pool.sort((a, b) => Number(b.cls === cls) - Number(a.cls === cls) || Number(b.confirmed) - Number(a.confirmed) || a.firstSeen - b.firstSeen)[0] ?? null;
  }

  /** VLM이 이 물건을 at 촬영에 봤다: 종류 셈, VLM 본 시각(사라짐 셈 정리), 자리(놓인 자리를 알고 더 새 촬영일 때), 확정(후보는 서로 다른 원본 프레임 VLM_CONFIRM_FRAMES장)·
   *  되살림·시야 안으로. */
  private seen(obj: Obj, cls: ObjClass, at: number, frameId: string, placed: Placed | null, surfaces: PlaneSurface[], changes: WorldChange[], fresh: Fresh[],
    eye: Plan2 | null, look: SceneLook | undefined): void {
    const core = this.core;
    if (obj.confirmed) core.voteClass(obj, cls, at, frameId);
    obj.vlmSeen = Math.max(obj.vlmSeen ?? at, at);
    obj.vlmMiss = obj.vlmMiss.filter((m) => m.at > obj.vlmSeen!);
    obj.lastSeen = Math.max(obj.lastSeen, at);
    obj.lastInView = Math.max(obj.lastInView, at);
    core.closer.sawAgain(obj, at, frameId);
    if (placed?.position && core.newerPlace(obj, at, false) && this.moved(obj, placed, frameId, at)) {
      obj.position = placed.position;
      obj.surface = placed.surface;
      obj.surfaceLabel = placed.surface ? surfaces.find((s) => s.id === placed.surface)?.label ?? null : null;
      obj.part = placed.part;
      obj.errorM = placed.errorM;
      obj.room = this.o.roomAt([placed.position[0], placed.position[2]])?.id ?? null;
      obj.posAt = at;
      obj.posCloser = false;
      obj.posFrom = look ? fromCamera(look.view.origin, placed.position) : null;
    }
    const appear = () => {
      obj.confirmed = true;
      obj.status = "present";
      obj.goneAt = null;
      obj.missGone = false;
      core.judge(obj, at, frameId, false);
      core.clearSightings(obj);
      fresh.push({ obj, at, frame: frameId });
      changes.push({ kind: "appeared", at_ms: at, subject: obj.id, meaningful: true, text: CHANGE_TEXT.appeared(core.name(obj), obj.surfaceLabel ? onSurface(obj.surfaceLabel) : null) });
    };
    if (!obj.confirmed) {
      // 카메라가 있는데 폰 눈을 모르는 사진은 확인 장수에서 뺀다(Codex 4e682c8 4). 걷는 중(두 장의 폰 눈이 VLM_STILL_M 넘게 떨어짐)이면 그 장부터 다시 센다(가로 키 큰 컵 r1: 유령 컵)
      if (look) {
        if (!eye) return;
        if (!obj.vlmEye || Math.hypot(eye[0] - obj.vlmEye[0], eye[1] - obj.vlmEye[1]) > VLM_STILL_M) {
          obj.vlmFrames = [frameId];
          obj.vlmEye = eye;
          return;
        }
      }
      if (!obj.vlmFrames.includes(frameId)) obj.vlmFrames.push(frameId);
      if (obj.vlmFrames.length >= VLM_CONFIRM_FRAMES) appear();
      return;
    }
    // 사라진 물건: 더 새 촬영에서 보면 되살리고, 늦게 온 옛 사진이 사라짐 셈 사진들 사이에서 봤으면(셈이 모자라짐) 사라짐을 거둔다
    if (obj.status === "gone" && obj.goneAt !== null && (at > obj.goneAt || (obj.missGone && obj.vlmMiss.length < VLM_GONE_PHOTOS))) appear();
    else if (obj.status !== "gone") {
      core.judge(obj, at, frameId, false);
      if (obj.status === "out_of_view" && at >= obj.judgedAt) {
        obj.status = "present";
        changes.push({ kind: "back_in_view", at_ms: at, subject: obj.id, meaningful: false, text: CHANGE_TEXT.backInView(core.name(obj)) });
      }
    }
  }

  /** 들고 가는 중(carried)인 물건의 자리 면: 내려놓음이 확인될 때까지 VLM·가까이 보기 자리 답이 손에 있음을 덮지 않는다. */
  carriedPlace(id: string, facet: Facet): boolean {
    return facet === "place" && this.core.objects.get(id)?.carried === true;
  }

  /** 물건이 움직였는지 센다: 원본 프레임(장면 VLM·가까이 보기)마다 본 자리(트윈 자리, 모르면 엔진 프레임 사진 가운데 점) 하나를 촬영 순서로 쌓고,
   *  SETTLE_MS 안의 다른 자리와 MOVE_M(MOVE_IMAGE) 넘게 떨어졌으면 그 둘 가운데 늦은 촬영 시각을 movedAt으로 둔다.
   *  앞 SETTLE_MS 안에 본 자리가 없으면(끊겼다 다시 봄) 그사이를 모르므로 그 촬영부터 정지를 센다. 같은 원본 프레임은 한 번만 센다. */
  track(o: Obj, samples: readonly TrailSample[]): void {
    for (const n of [...samples].sort((a, b) => a.at - b.at)) {
      const end = Math.max(n.at, o.trail.at(-1)?.at ?? n.at);
      o.trail = o.trail.filter((s) => end - s.at <= SETTLE_MS);
      if (end - n.at > SETTLE_MS || o.trail.some((s) => s.frame === n.frame)) continue;
      const far = (s: TrailSample) => n.position && s.position
        ? Math.hypot(n.position[0] - s.position[0], n.position[2] - s.position[2]) > MOVE_M
        : Math.hypot(n.center[0] - s.center[0], n.center[1] - s.center[1]) > MOVE_IMAGE;
      if (!o.trail.some((s) => s.at < n.at)) o.movedAt = Math.max(o.movedAt, n.at);
      for (const s of o.trail) if (Math.abs(n.at - s.at) <= SETTLE_MS && far(s)) o.movedAt = Math.max(o.movedAt, n.at, s.at);
      o.trail.push(n);
      o.trail.sort((a, b) => a.at - b.at);
    }
  }
}

type SceneObj = NonNullable<SceneObservation["objects"]>[number];
/** 상자 겹침(IoU, 사진 비율 상자). */
const iouOf = (a: SceneObj["box"], b: SceneObj["box"]): number => {
  const x = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
  const y = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
  const inter = x * y;
  return inter / (a.w * a.h + b.w * b.h - inter || 1);
};
/** 한 답 안에서 같은 물건을 두 번 답한 상자로 보는 겹침: IoU, 또는 작은 상자가 큰 상자 안에 든 몫(머그 q2: 큰 상자 안 작은 상자). */
export const SAME_BOX_IOU = 0.5;
export const SAME_BOX_INSIDE = 0.7;
/** 작은 상자가 다른 상자 안에 든 몫(겹친 넓이 / 작은 상자 넓이). */
const insideOf = (a: SceneObj["box"], b: SceneObj["box"]): number => {
  const x = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
  const y = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
  return (x * y) / (Math.min(a.w * a.h, b.w * b.h) || 1);
};
/** 한 답의 VLM 물건에서 앞 물건과 같은 무리이고 상자가 SAME_BOX_IOU 넘게 겹치는 것을 뺀다(서로 다른 감지 번호와 이은 둘은 두지 않는다). alias: 뺀 번호 → 남긴 번호. */
function dedupe(objects: readonly SceneObj[]): { kept: SceneObj[]; alias: Map<string, string> } {
  const kept: SceneObj[] = [];
  const alias = new Map<string, string>();
  for (const v of objects) {
    // 서로 다른 YOLO 감지와 이은 물건은 다른 물건이다
    const same = kept.find((k) => sameDrinkware(k.cls, v.cls) && (iouOf(k.box, v.box) >= SAME_BOX_IOU || insideOf(k.box, v.box) >= SAME_BOX_INSIDE) && !(k.det && v.det && k.det !== v.det));
    if (same) alias.set(v.id, same.id);
    else kept.push(v);
  }
  return { kept, alias };
}

