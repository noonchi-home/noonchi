// World State의 가까이 보기(CloserLook, src/observe/pipeline.ts closer): 잘라 본 몇 장을 한 번에 합치고(물건 감지만), 지킴(CLOSER_HOLD_MS)과 옮김 표시(followed_by)를 다룬다.
// 맞는 물건이 없으면 서로 다른 원본 프레임 CLOSER_NEW_FRAMES장이거나, 1장 이상이고 같은 가까이 보기의 VLM이 그 감지에 사실을 답하고 가림은 답하지 않아야 새 물건을 만든다.
// 가까이 보기와 전체 사진은 촬영 순서가 섞여 들어오므로 자리·보임은 물건마다 마지막으로 고친 촬영보다 새 촬영만 고친다(같은 원본 프레임이면 잘라 본 것이 앞선다).
import type { ObjClass, WorldChange } from "../../contract/world.js";
import type { CameraView, Detection, SceneObservation } from "../../contract/observe.js";
import { CHANGE_TEXT, onSurface } from "../labels.js";
import { placePoint, type PlaneSurface } from "../place.js";
import { CLASSES, NOW_FACETS, STATES, VLM_ONLY, type StateKey, type StateOf } from "../vocab.js";
import { OBJ_CLASSES, Part, dist, fits, type Obj, type V3 } from "./core.js";

/** 가까이 보기로 VLM 확인 없이 새 물건을 만들려면 같은 자리로 보인 서로 다른 원본 프레임이 이만큼 있어야 한다(물건 등장 확인 장수와 같다).
 *  이보다 적으면 같은 가까이 보기의 VLM이 그 감지에 사실을 답해야 만든다(CloserPending). */
export const CLOSER_NEW_FRAMES = 3;

/** 가까이 본 한 장의 감지: 상자는 엔진 프레임 픽셀, edge는 잘라 본 상자 경계에 닿음(src/observe/crop.ts onCropEdge). */
export interface CloserDetection extends Detection { edge: boolean }
/** 가까이 본 한 장: 원본 엔진 프레임 id·촬영 시각·카메라·크기와 그 잘라 본 사진의 감지. */
export interface CloserPass { frameId: string; capturedAtMs: number; view: CameraView; width: number; height: number; dets: CloserDetection[] }
/** 가까이 본 한 장의 물건 감지 하나: 그 장, 감지 번호(d1…), 트윈 자리. */
interface CloserSeen { pass: CloserPass; tmp: string; position: V3; center: [number, number]; surface: string | null; part: "basin" | null; errorM: number | null }
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

/** 가까이 보기 합치기·지킴·옮김 표시. */
export class CloserLook extends Part {
  /** 이미 끝낸 가까이 보기 후보(applyCloserScene·endCloser는 한 번만 쓴다). */
  private readonly closerDone = new WeakSet<CloserPending>();

  /** 같은 종류 새 물건이 다른 자리에 생겼다(옮김): 한 묶음(전체 사진 한 장·가까이 보기 한 번)에서 등장을 확인한 새 물건(그 촬영 시각)으로
   *  같은 종류 다른 물건의 지킴을 푼다. 지킴 중이던 물건에는 그 묶음에서 다른 자리에 생긴 같은 종류 새 물건이 하나일 때만 그 id를 남긴다(여럿이면 어느 것인지 모른다).
   *  saw: 같은 묶음에서 본 물건(옮긴 것이 아니라 그대로 둔다). 그 물건을 마지막으로 본 촬영·보임 판단보다 옛(같은 촬영 포함) 등장은 지킴·옮김 표시를 바꾸지 않는다. */
  liftHolds(fresh: readonly Fresh[], saw: ReadonlySet<string>): void {
    if (!fresh.length) return;
    for (const o of this.core.objects.values()) {
      if ((o.closerAt === null && o.peekGuard === null) || saw.has(o.id)) continue;
      const near = (CLASSES[o.cls] as { identityM?: number }).identityM ?? this.core.identityM;
      const moved = fresh.filter(({ obj, at }) => obj !== o && obj.cls === o.cls && at > o.lastSeen && at >= o.judgedAt
        && !(o.position && obj.position && dist(o.position, obj.position) <= near));
      if (!moved.length) continue;
      const at = Math.max(...moved.map((m) => m.at));
      const one = moved.length === 1 ? moved[0]! : null;
      if (one && o.status !== "gone" && (this.core.held(o, at) || this.core.guarded(o, at))) o.followed = { id: one.obj.id, at: one.at, frame: one.frame };
      o.closerAt = null;
      o.peekGuard = null;
    }
  }

  /** 이 촬영(원본 프레임 frameId)에서 물건을 다시 봤다: 옮김 표시를 붙인 촬영보다 새 촬영이거나 같은 원본 프레임이면 표시를 지운다
   *  (같은 원본 프레임에서 보였으면 새 물건과 함께 있었다). */
  sawAgain(obj: Obj, atMs: number, frameId: string): void {
    const f = obj.followed;
    if (f && (atMs > f.at || (atMs === f.at && frameId === f.frame))) obj.followed = null;
  }

  /** 이 가까이 본 촬영이 보임을 바꿀 수 있는가: 마지막 보임 판단보다 새 촬영이거나, 같은 원본 프레임의 전체 사진 판단이다(잘라 본 양성이 앞선다). */
  private newerCloser(obj: Obj, at: number, frameId: string): boolean {
    return at > obj.judgedAt || (at === obj.judgedAt && !obj.judgedCloser && obj.judgedFrame === frameId);
  }

  /** 트윈 자리로 맞추기만(가까이 보기): 같은 종류 중 그 종류 거리 안의 가장 가까운 것(사라진 것·세는 중인 것도). */
  private nearest(cls: ObjClass, position: V3, used: ReadonlySet<string>): Obj | null {
    const near = (CLASSES[cls] as { identityM?: number }).identityM ?? this.core.identityM;
    let best: { obj: Obj; d: number } | null = null;
    for (const x of this.core.objects.values()) {
      if (x.cls !== cls || used.has(x.id) || !x.position) continue;
      const d = dist(x.position, position);
      if (d <= near && (!best || d < best.d)) best = { obj: x, d };
    }
    return best?.obj ?? null;
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
        const near = (CLASSES[cls] as { identityM?: number }).identityM ?? this.core.identityM;
        let best: { g: CloserGroup; d: number } | null = null;
        for (const g of groups) {
          if (g.cls !== cls || g.seen.some((s) => s.pass === pass)) continue;
          const gap = dist(g.seen.at(-1)!.position, placed.position);
          if (gap <= near && (!best || gap < best.d)) best = { g, d: gap };
        }
        const center: [number, number] = [(d.box[0] + d.box[2] / 2) / pass.width, (d.box[1] + d.box[3] / 2) / pass.height];
        const seen: CloserSeen = { pass, tmp: `d${i + 1}`, position: placed.position, center, surface: placed.surface, part: placed.part, errorM: placed.errorM };
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
    const core = this.core;
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
          changes.push({ kind: "appeared", at_ms: at, subject: obj.id, meaningful: true, text: CHANGE_TEXT.appeared(core.name(obj), obj.surfaceLabel ? onSurface(obj.surfaceLabel) : null) });
        } else if (obj.status === "out_of_view") {
          obj.status = "present";
          changes.push({ kind: "back_in_view", at_ms: at, subject: obj.id, meaningful: false, text: CHANGE_TEXT.backInView(core.name(obj)) });
        }
      }
    } else if (make) {
      obj = match ?? core.create(g.cls, g.seen[0]!.pass.capturedAtMs, g.seen[0]!.pass.frameId);
      obj.firstSeen = Math.min(obj.firstSeen, g.seen[0]!.pass.capturedAtMs);
      obj.confirmed = true;
      obj.status = "present";
      obj.goneAt = null;
      this.placeCloser(obj, last, surfaces);
      this.seenCloser(obj, at, last.pass.frameId);
      created.push({ obj, at, frame: last.pass.frameId });
      changes.push({ kind: "appeared", at_ms: at, subject: obj.id, meaningful: true, text: CHANGE_TEXT.appeared(core.name(obj), obj.surfaceLabel ? onSurface(obj.surfaceLabel) : null) });
    }
    if (!obj) return null;
    // 옮김 표시는 보임 판단과 따로 지운다: 보임을 바꾸지 못하는 옛 촬영이어도 표시를 붙인 촬영보다 새거나 같은 원본 프레임이면 두 물건이 함께 있었다
    for (const s of g.seen) this.sawAgain(obj, s.pass.capturedAtMs, s.pass.frameId);
    // 원본 프레임마다 본 자리도 움직임·정지 근거다(전체 감지가 놓치고 가까이 보기로만 보는 물건도 내려놓음을 안다). 묶음 전체를 합친 뒤 판정한다
    core.merge.track(obj, g.seen.map((s) => ({ at: s.pass.capturedAtMs, frame: s.pass.frameId, position: s.position, center: s.center })));
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
    return !d.edge && this.core.accepts(d) && OBJ_CLASSES.has(d.label);
  }

  /** 가까이 본 촬영으로 자리·면·방을 고친다(자리를 마지막으로 고친 촬영보다 새면, 같은 촬영이면 잘라 본 자리가 앞선다). */
  private placeCloser(obj: Obj, s: { pass: CloserPass; position: V3; surface: string | null; part: "basin" | null; errorM: number | null }, surfaces: PlaneSurface[]): void {
    const at = s.pass.capturedAtMs;
    if (!this.core.newerPlace(obj, at, true)) return;
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
    this.core.judge(obj, at, frameId, true);
    obj.closerAt = Math.max(obj.closerAt ?? at, at);
    this.core.confirmer.mark(obj.id);
  }

  /** 위에서 본 장(src/observe/pipeline.ts topLook이 대상 확인을 거친 장)의 내용물 값 하나: 그 물건을 그 촬영에 본 것으로 두고(본 시각·보임 판단·지킴)
   *  내용물 갱신기에 위에서 본 답으로 넣는다. 자리·다른 면은 바꾸지 않는다. 물건이 없거나 사라졌으면 빈 목록. */
  applyTop(objectId: string, sourceFrameId: string, capturedAtMs: number, value: "empty" | "has_contents"): WorldChange[] {
    const obj = this.core.objects.get(objectId);
    if (!obj || obj.status === "gone") return [];
    this.seenCloser(obj, capturedAtMs, sourceFrameId);
    const r = this.core.contents.see(obj, sourceFrameId, capturedAtMs, value, 2);
    if (r.changed) {
      obj.closerRev.contents = (obj.closerRev.contents ?? 0) + 1;
      if (obj.facts.contents) obj.facts.contents = { ...obj.facts.contents, closer_ms: capturedAtMs };
    }
    return obj.confirmed ? r.changes : [];
  }

  /** 가까이 본 사진의 VLM 답: ids(그 사진에서 잡은 물건)의 사실만 넣는다. 장면 요약·답에 없는 면·지금만 맞는 사실·사람·가전 설비는 건드리지 않는다.
   *  가림(not_visible)을 답한 상자는 이미 있는 물건이어도 그 상자의 사실을 넣지 않는다.
   *  원본 프레임(sourceFrameId)·물건·면마다 한 번만 넣고, 같은 원본 프레임의 전체 사진 답보다 앞선다(answer).
   *  pending(같은 가까이 보기 applyCloser의 후보)이 있으면 먼저 이 답이 사실(그 종류에 붙는 값)을 하나 이상 답하고 가림(not_visible)은 답하지 않은 후보 감지마다
   *  확인된 물건을 만들어(그사이 같은 자리 물건이 확인됐으면 그것에 맞춘다) ids에 더하고 미뤄 둔 옮김 처리를 한다. 사실을 답하지 않거나 가림을 답한 후보는 버린다. */
  applyCloserScene(sourceFrameId: string, capturedAtMs: number, scene: SceneObservation, ids: Map<string, string>, pending?: CloserPending): WorldChange[] {
    const core = this.core;
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
    const contents: [Obj, StateOf<"contents">][] = [];
    // 이미 있는 물건도 가렸다고 답한 상자는 함께 답한 사실을 넣지 않는다(답 순서와 상관없이, 상자마다)
    const hidden = new Set(scene.observations.filter((ob) => (VLM_ONLY as readonly string[]).includes(ob.state)).map((ob) => ob.object_id));
    for (const ob of scene.observations) {
      if (hidden.has(ob.object_id)) continue;
      const id = ids.get(ob.object_id);
      const obj = id ? core.objects.get(id) : undefined;
      if (!obj || !(ob.state in STATES)) continue;
      const value = ob.state as StateKey;
      if (!fits(value, obj.cls, "object")) continue;
      const facet = STATES[value].facet;
      // 안 내용은 이 답의 몸통(불투명)을 넣은 뒤 내용물 갱신기(contents.ts)로 넣는다(아래). 같은 원본 프레임의 전체 사진 답보다 이 답이 앞선다
      if (facet === "contents") {
        contents.push([obj, value as StateOf<"contents">]);
        continue;
      }
      if (core.people.poseHolds(obj.facts[facet], capturedAtMs) || core.merge.carriedPlace(obj.id, facet)) continue;
      if (!core.vlm.answer(sourceFrameId, obj.id, obj.facts, facet, value, capturedAtMs, true, NOW_FACETS.object.includes(facet), turn)) {
        if (facet === "body") core.contents.settle(obj);
        continue;
      }
      if (facet === "body") core.contents.settle(obj);
      obj.closerRev[facet] = (obj.closerRev[facet] ?? 0) + 1;
      if (obj.confirmed && obj.status !== "gone") changes.push({ kind: "state", at_ms: capturedAtMs, subject: obj.id, meaningful: true, text: CHANGE_TEXT.state(core.name(obj), value) });
    }
    for (const [obj, value] of contents) {
      const r = core.contents.see(obj, sourceFrameId, capturedAtMs, value, 1);
      // 가까이 본 답이 내용물 값을 새로 넣거나 바꿨으면 횟수와 그 촬영 시각(같은 값이 이어지는 동안 남는다)
      if (r.changed) {
        obj.closerRev.contents = (obj.closerRev.contents ?? 0) + 1;
        if (obj.facts.contents) obj.facts.contents = { ...obj.facts.contents, closer_ms: capturedAtMs };
      }
      if (obj.confirmed && obj.status !== "gone") changes.push(...r.changes);
    }
    return changes;
  }
}
