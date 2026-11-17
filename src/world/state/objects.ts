// World State의 감지 합치기(Detections): 엔진 프레임 YOLO 감지를 물체별로 합치고 등장·사라짐·시야 밖을 센다(같은 물체는 트윈 자리 + 종류).
// 사람 감지는 사람 자리·관절(people.ts)로, 가전 설비 상자는 카메라로 가전 맞추기(devices.ts)로 넘긴다. 늦게 온 전체 사진은 통째로 넣지 않는다.
// 물건 움직임과 들고 감 보호(carried)도 여기 있다: 원본 프레임(전체 감지·가까이 보기)마다 본 자리를 쌓아 SETTLE_MS 안에서 움직였는지 세고,
// 사람이 안 보이게 될 때 아직 움직이던 관절의 「손에 있음」 물건은 제자리에 SETTLE_MS 있을 때까지 손에 있음을 두며 VLM·가까이 보기 자리 답이 덮지 않는다.
import type { Facet, FixtureClass, ObjClass, WorldChange } from "../../contract/world.js";
import type { Detection, FrameMeta, Pose } from "../../contract/observe.js";
import { EVIDENCE_GAP_MS } from "../confirm.js";
import { CHANGE_TEXT, onSurface } from "../labels.js";
import { inView, pixelOf, placePoint, sizeOf } from "../place.js";
import { CLASSES, NOW_FACETS, POSE_HOLD } from "../vocab.js";
import { NEAR_M as REACH_M, sameDrinkware } from "../vocab.js";
import { KEYS, OBJ_CLASSES, PERSON, Part, SIZE_SAMPLES, VLM_CANDIDATE_MS, VLM_MATCH_M, dist, fromCamera, type Obj, type TrailSample, type V3 } from "./core.js";

const FIXTURE_CLASSES: ReadonlySet<string> = new Set(KEYS.filter((k) => CLASSES[k].role === "fixture"));
/** 사라진 물체를 이만큼 두었다가 잊는다(같은 자리에 다시 보이면 같은 id로 돌아온다). */
const GONE_KEEP_MS = 600_000;
/** 사람이 안 보이게 될 때 관절이 붙인 「손에 있음」 물건이 이만큼(ms) 제자리에 있었으면 내려놓은 것이다. 아니면 들고 가는 중일 수 있어 둔다. */
const SETTLE_MS = 3000;
/** 제자리로 보는 움직임: 트윈 자리 0.15m, 트윈 자리를 모르면 사진 가운데 점이 사진 너비·높이의 5%. */
const MOVE_M = 0.15;
const MOVE_IMAGE = 0.05;

/** 감지 합치기·등장 셈·물건 움직임. */
export class Detections extends Part {
  /** poses: 이 프레임의 관절(YOLO26-pose). 없으면(관절 모델이 없거나 사람이 없어 돌리지 않음) 자세·손에 듦을 보지 않는다.
   *  이미 넣은 가장 새 전체 사진보다 옛 촬영(감지 대기열에서 늦게 나온 프레임)은 넣지 않고 변화·감지 번호 없이 돌려준다. */
  applyDetections(frame: FrameMeta, dets: Detection[], poses?: Pose[]): { changes: WorldChange[]; ids: Map<string, string> } {
    const core = this.core;
    const at = frame.capturedAtMs;
    if (core.frameAt !== null && at < core.frameAt) return { changes: [], ids: new Map() };
    core.start(at);
    core.frameAt = at;
    const view = frame.view;
    const surfaces = view ? this.o.surfaces() : [];
    const ids = new Map<string, string>();
    const seen = new Set<string>();
    const used = new Set<string>();
    const boxes: { obj: Obj; box: Detection["box"]; mask: Detection["mask"] }[] = [];
    const people: Detection[] = [];
    const eyeRoom = frame.eye ? this.o.roomAt([frame.eye.position[0], frame.eye.position[1]]) : null;
    // 이 사진 물건 감지들의 트윈 자리(보완 잇기가 가장 가까운 감지를 고를 때 본다)
    const spots = dets.map((d) => (view && core.accepts(d) && OBJ_CLASSES.has(d.label) ? placePoint(view, d.foot, { width: frame.width, height: frame.height }, surfaces, this.o.floorAt).position : null));
    dets.forEach((d, i) => {
      const tmp = `d${i + 1}`;
      if (!core.accepts(d)) return;
      if (d.label === "person") {
        ids.set(tmp, PERSON);
        seen.add(PERSON);
        people.push(d);
        return;
      }
      if (FIXTURE_CLASSES.has(d.label)) {
        const fix = core.sight.fixture(d.label as FixtureClass, at, eyeRoom);
        ids.set(tmp, fix.id);
        if (frame.vlm !== false) core.sight.sight(frame, tmp, fix, d, eyeRoom); // 카메라로 가전 맞추기는 그 프레임 VLM 답이 쓴다: 빠른 프레임은 답이 없다
        return;
      }
      if (!OBJ_CLASSES.has(d.label)) return;
      const cls = d.label as ObjClass;
      const placed = view ? placePoint(view, d.foot, { width: frame.width, height: frame.height }, surfaces, this.o.floorAt) : null;
      // 그 사진에서 어떤 자리가 이 감지 상자 안에 비치는가(상자를 10% 넓혀 본다)
      const sees = view ? (p: V3) => {
        const px = pixelOf(view, p, { width: frame.width, height: frame.height });
        const [bx, by, bw, bh] = d.box;
        return !!px && px[0] >= bx - bw * 0.1 && px[0] <= bx + bw * 1.1 && px[1] >= by - bh * 0.1 && px[1] <= by + bh * 1.1;
      } : undefined;
      // 보완 잇기(0.5m·내려놓음)는 이 사진 감지 가운데 그 물건 자리에 이 감지가 가장 가까울 때만
      const nearest = placed?.position ? (o: Obj) => !o.position || spots.every((s, j) => j === i || !s || dist(s, o.position!) >= dist(placed.position!, o.position!)) : undefined;
      const obj = this.match(cls, placed?.position ?? null, used, frame.eye ? frame.eye.position : null, sees, nearest) ?? core.create(cls, at, frame.id);
      used.add(obj.id);
      ids.set(tmp, obj.id);
      seen.add(obj.id);
      boxes.push({ obj, box: d.box, mask: d.mask });
      // 그릇은 크기를 잰다(위에서 컵 안을 보는 판정이 쓴다, src/world/place.ts cupInside)
      if (view && placed?.position && (CLASSES[cls].facets as readonly string[]).includes("contents")) {
        const size = sizeOf(view, d.box, { width: frame.width, height: frame.height }, placed.position);
        if (size) obj.sizes = [...obj.sizes, { height: size.height, width: size.width }].slice(-SIZE_SAMPLES);
      }
      obj.lastSeen = Math.max(obj.lastSeen, at);
      obj.lastInView = Math.max(obj.lastInView, at);
      core.judge(obj, at, frame.id, false);
      core.closer.sawAgain(obj, at, frame.id);
      this.track(obj, [{ at, frame: frame.id, position: placed?.position ?? null, center: [(d.box[0] + d.box[2] / 2) / frame.width, (d.box[1] + d.box[3] / 2) / frame.height] }]);
      // 가까이 보기가 더 새 촬영(같은 촬영이면 잘라 본 자리)으로 고친 자리를 되돌리지 않는다. 손에 든 물건도 자리를 따라간다(내려놓으면 그 자리로 이어 맞춘다)
      if (placed?.position && core.newerPlace(obj, at, false)) {
        obj.position = placed.position;
        obj.surface = placed.surface;
        obj.surfaceLabel = placed.surface ? surfaces.find((s) => s.id === placed.surface)?.label ?? null : null;
        obj.part = placed.part;
        obj.errorM = placed.errorM;
        obj.room = this.o.roomAt([placed.position[0], placed.position[2]])?.id ?? null;
        obj.posAt = at;
        obj.posCloser = false;
        obj.vlmPlaced = false;
        obj.posFrom = view ? fromCamera(view.origin, placed.position) : null;
      }
    });
    if (people.length > 1) core.crowdAt = at;
    if (seen.has(PERSON)) {
      core.person.last_seen_ms = at;
      core.person.count = people.length;
      core.people.locatePerson(frame, people);
    }

    const present = [...core.objects.values()].filter((x) => x.confirmed && x.status !== "gone").map((x) => x.id);
    const candidates = core.person.visible ? [...present, PERSON] : present;
    // 가까이 보기가 이 프레임보다 새 촬영(같은 원본 프레임이면 잘라 본 양성)으로 본 물건은 이 프레임을 등장·사라짐 셈에 넣지 않는다(늘리지도 끊지도 않음)
    const stale = (key: string) => {
      const obj = key === PERSON ? undefined : core.objects.get(key);
      return !!obj && this.staleFull(obj, at, frame.id);
    };
    // 가까이 보기 지킴·보기 지킴 중인 물건은 그 자리가 시야 안이어도 사라짐을 세지 않는다
    const events = core.confirmer.observe(at, seen, candidates, (key) => {
      if (key === PERSON) return true;
      const obj = core.objects.get(key)!;
      return !core.held(obj, at) && !core.guarded(obj, at) && !core.vlmHold(obj, at) && !core.focusHold(obj) && this.visible(obj, view) === true;
    }, stale);
    const changes: WorldChange[] = [];
    const fresh: { obj: Obj; at: number; frame: string }[] = [];
    for (const e of events) {
      if (e.key === PERSON) {
        core.person.visible = e.kind === "appeared";
        core.person.since_ms = at;
        if (e.kind === "gone") {
          core.person.facts = {};
          core.person.count = 0;
          core.heldIds = [];
          // 사람이 없으면 손에 있을 수 없다. 다만 든 물건이 아직 움직이면 사람·손목만 먼저 안 보이는 것(들고 나가는 중)일 수 있어 내려놓음(제자리 SETTLE_MS)까지 둔다
          for (const o of core.objects.values()) {
            if (core.people.posedInHand(o) && at - o.movedAt < SETTLE_MS) o.carried = true;
            else core.people.dropPoseFact(o.facts, "place", POSE_HOLD.object);
          }
        }
        changes.push({ kind: e.kind === "appeared" ? "person_appeared" : "person_gone", at_ms: at, subject: PERSON, meaningful: true,
          text: e.kind === "appeared" ? CHANGE_TEXT.personAppeared : CHANGE_TEXT.personGone });
        continue;
      }
      const obj = core.objects.get(e.key)!;
      core.judge(obj, at, frame.id, false);
      if (e.kind === "appeared") {
        obj.confirmed = true;
        obj.status = "present";
        obj.goneAt = null;
        fresh.push({ obj, at, frame: frame.id });
        core.clearSightings(obj);
        changes.push({ kind: "appeared", at_ms: at, subject: obj.id, meaningful: true, text: CHANGE_TEXT.appeared(core.name(obj), obj.surfaceLabel ? onSurface(obj.surfaceLabel) : null) });
      } else {
        obj.status = "gone";
        obj.goneAt = at;
        for (const f of NOW_FACETS.object) delete obj.facts[f];
        changes.push({ kind: "gone", at_ms: at, subject: obj.id, meaningful: true, text: CHANGE_TEXT.gone(core.name(obj)) });
      }
    }
    // 이 프레임에서 등장한 새 물건이 다른 자리 같은 종류 물건의 지킴을 푼다(이 프레임에서 본 물건은 그대로)
    core.closer.liftHolds(fresh, seen);
    for (const obj of core.objects.values()) {
      if (!obj.confirmed) {
        // 세는 중에 500ms 넘게 못 보면 잊고 마지막 자리를 후보 자리로 남긴다(한두 장 놓친 것은 둔다). 장면 VLM 답 후보는 VLM_CANDIDATE_MS 둔다
        const keep = obj.vlmFrames.length ? VLM_CANDIDATE_MS : EVIDENCE_GAP_MS;
        if (!seen.has(obj.id) && at - obj.lastSeen >= keep) core.loseCandidate(obj, at);
        continue;
      }
      if (obj.status === "gone") {
        if (obj.goneAt !== null && at - obj.goneAt > GONE_KEEP_MS) core.forget(obj.id);
        continue;
      }
      const vis = seen.has(obj.id) ? true : this.visible(obj, view);
      // 가까이 보기가 더 새 촬영이나 같은 원본 프레임 양성으로 본 물건은 있음·시야 밖을 바꾸지 않는다
      if (stale(obj.id)) continue;
      if (vis === true) {
        obj.lastInView = Math.max(obj.lastInView, at);
        if (obj.status === "out_of_view") {
          obj.status = "present";
          core.judge(obj, at, frame.id, false);
          changes.push({ kind: "back_in_view", at_ms: at, subject: obj.id, meaningful: false, text: CHANGE_TEXT.backInView(core.name(obj)) });
        }
      } else if (vis === false) {
        core.judge(obj, at, frame.id, false);
        if (obj.status === "present") {
          obj.status = "out_of_view";
          changes.push({ kind: "out_of_view", at_ms: at, subject: obj.id, meaningful: false, text: CHANGE_TEXT.outOfView(core.name(obj)) });
        }
      }
    }
    // 사람 방: 보이는 동안 바뀌거나 사람이 막 보이면 변화 하나
    const next = core.people.nextRoom;
    core.people.nextRoom = undefined;
    const appeared = events.some((e) => e.key === PERSON && e.kind === "appeared");
    if (next === null) core.person.room = null;
    else if (next && next.id !== core.person.room?.id) {
      core.person.room = next;
      if (core.person.visible) changes.push(core.people.roomChange(at));
    } else if (appeared && core.person.room) changes.push(core.people.roomChange(at));
    if (poses) core.people.applyPose(frame, poses, boxes, changes);
    // 확인 전 후보가 이 사진에서 관절의 손에 없으면 그 자리를 손에 없던 자리로 둔다(잊을 때 후보 자리로 남긴다)
    for (const { obj } of boxes) {
      if (!obj.confirmed && obj.position && obj.posAt === at && !core.people.posedInHand(obj)) obj.free = { position: obj.position, surface: obj.surface, surfaceLabel: obj.surfaceLabel, at };
    }
    // 내려놓기 단계: 시작 뒤 목적지에 새로 보인 같은 종류 물건은 놓인 대상이다(감지 번호도 대상으로)
    core.placeDups();
    for (const [k, v] of ids) { const o = core.objects.get(v); if (o?.status === "gone" && o.followed) ids.set(k, o.followed.id); }
    return { changes, ids };
  }

  /** 이 전체 사진은 보임을 바꾸지 못하는가: 마지막 보임 판단보다 옛 촬영이거나(가까이 보기가 더 새 촬영으로 봤다), 같은 원본 프레임을 잘라 본 양성이 그 판단이다.
   *  그런 사진은 그 물건의 등장·사라짐 셈에도 넣지 않는다(셈을 늘리지도 끊지도 않는다). */
  private staleFull(obj: Obj, at: number, frameId: string): boolean {
    return at < obj.judgedAt || (at === obj.judgedAt && obj.judgedCloser && obj.judgedFrame === frameId);
  }

  /** 같은 물체 찾기. 위치가 있으면 장면 VLM·가까이 보기와 같은 식별 규칙(core.matchAt: 같은 종류 먼저, 마시는 그릇 무리는 하나뿐일 때만). 맞는 것이 없으면
   *  VLM이 손에 있음으로 답한 같은 무리 물건이 하나뿐일 때 그것(들린 컵은 상자 아랫변이 놓인 자리가 아니다), 그다음 자리를 모르는 같은 종류. 위치가 없으면 사라지지 않은 같은 종류를 처음 본 순서로. */
  private match(cls: ObjClass, position: V3 | null, used: ReadonlySet<string>, eye: [number, number] | null, sees?: (target: V3) => boolean, nearest?: (o: Obj) => boolean): Obj | null {
    const pool = [...this.core.objects.values()].filter((x) => x.cls === cls && !used.has(x.id));
    if (position) {
      const hit = this.core.matchAt(cls, position, used);
      if (hit) return hit;
      // 장면 VLM 상자로 자리를 정한 물건은 투영 차이가 커서 VLM_MATCH_M 안 감지를 잇는다(가로 유리컵 r6: 한 잔이 cup_9·cup_18 두 id).
      // 이 사진의 다른 감지가 그 물건에 더 가까우면 그 감지 몫이다(Codex 40407aa 1: 가까운 일치를 먼저 배정하고 모호하지 않을 때만 보완)
      const vlmHit = this.core.matchAt(cls, position, new Set([...used, ...[...this.core.objects.values()].filter((x) => !x.vlmPlaced).map((x) => x.id)]), VLM_MATCH_M);
      if (vlmHit && (!nearest || nearest(vlmHit))) return vlmHit;
      // 손에 있던 물건이 다른 자리 1m 안에 다시 보였다(내려놓음)
      const down = this.core.putDown(cls, position, used);
      if (down && (!nearest || nearest(down))) return down;
      // 손에 든 컵은 그 사진의 폰 눈 REACH_M 안일 때만 먼 감지를 잇는다(폰을 든 사람의 손). 둘 이상이면 모호해 잇지 않는다
      const held = [...this.core.objects.values()].filter((x) => x.confirmed && !used.has(x.id) && sameDrinkware(x.cls, cls) && x.facts.place?.value === POSE_HOLD.object);
      const reach = eye && held.length === 1 && held[0]!.position && Math.hypot(held[0]!.position[0] - eye[0], held[0]!.position[2] - eye[1]) <= REACH_M;
      if (reach) return held[0]!;
      // 실행 추적이 지금 집기·내려놓기 하는 대상(들린 컵, 바짝 댄 잔, 목적지에 놓인 컵)
      const focus = this.core.focusTarget(cls, position, used, false, sees, eye);
      if (focus) return focus;
      return pool.find((x) => x.status !== "gone" && !x.position) ?? null;
    }
    return pool.filter((x) => x.status !== "gone").sort((a, b) => Number(b.confirmed) - Number(a.confirmed) || a.firstSeen - b.firstSeen)[0] ?? null;
  }

  /** 시야 판단: 카메라가 없으면(맞추기 전) 시야 안, 카메라가 있는데 위치를 모르면 모름(null). */
  private visible(obj: Obj, view: FrameMeta["view"]): boolean | null {
    if (!view) return true;
    if (!obj.position) return null;
    return inView(view, obj.position);
  }

  /** 들고 가는 중(carried)인 물건의 자리 면: 내려놓음이 확인될 때까지 VLM·가까이 보기 자리 답이 손에 있음을 덮지 않는다. */
  carriedPlace(id: string, facet: Facet): boolean {
    return facet === "place" && this.core.objects.get(id)?.carried === true;
  }

  /** 물건이 움직였는지 센다: 원본 프레임(전체 감지·가까이 보기)마다 본 자리(트윈 자리, 모르면 엔진 프레임 사진 가운데 점) 하나를 촬영 순서로 쌓고,
   *  SETTLE_MS 안의 다른 자리와 MOVE_M(MOVE_IMAGE) 넘게 떨어졌으면 그 둘 가운데 늦은 촬영 시각을 movedAt으로 둔다(직전 프레임과만 견주면 100ms마다
   *  조금씩 들고 가도 제자리로 보이고, 떨어진 옛 자리의 시각을 두면 천천히 들고 가는 동안에도 3초 전 것만 떨어져 바로 내려놓은 것이 된다).
   *  앞 SETTLE_MS 안에 본 자리가 없으면(감지가 끊겼다 다시 봄) 그사이를 모르므로 그 촬영부터 정지를 센다. 같은 원본 프레임은 한 번만 센다.
   *  한 번에 온 자리(가까이 보기 한 번의 묶음)를 다 쌓은 뒤, 사람이 안 보이는 동안 들고 가던 물건이 이어 본 자리로 가장 새 촬영까지 SETTLE_MS
   *  움직임이 없으면 내려놓은 것으로 손에 있음을 지운다. */
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
    if (!o.carried) return;
    const end = o.trail.at(-1)?.at ?? o.movedAt;
    if (this.core.person.visible || !this.core.people.posedInHand(o)) o.carried = false;
    else if (end - o.movedAt >= SETTLE_MS) {
      this.core.people.dropPoseFact(o.facts, "place", POSE_HOLD.object);
      o.carried = false;
    }
  }
}
