// World State의 VLM 사실(SceneFacts): 면(facet)마다 하나, 그 종류에 없는 면·그 대상에 붙지 않는 값은 버린다. 촬영 시각이 더 오래된 답은 버리고, 같은 값이 연속 두 번이면 confirmed.
// 지금만 맞는 면은 그 대상을 본 프레임의 VLM 답에 없으면 지운다. VLM 답은 원본 프레임·대상·면마다 한 번만 세고, 같은 원본 프레임이면 잘라 본 사진의 답이 앞선다.
// 관절이 붙인 사실·들고 가는 중인 물건의 자리·쓰러짐 의심 중 자세는 VLM 답이 덮지 않는다.
// 물건 안 내용(contents)은 이 규칙이 아니라 내용물 갱신기(contents.ts)가 정한다. 몸통(body) 답을 받은 물건은 갱신기가 내용물을 다시 쓴다(불투명이면 「안이 안 보임」).
import type { Facet, WorldChange } from "../../contract/world.js";
import type { SceneObservation } from "../../contract/observe.js";
import { CHANGE_TEXT, OBJECT_NAME, fixtureName } from "../labels.js";
import { FACT_FRESH_MS, NOW_FACETS, POSE_HOLD, STATES, VLM_ONLY, type ClassKey, type StateKey, type StateOf, type Target } from "../vocab.js";
import { PERSON, Part, fits, type Facts, type Obj } from "./core.js";

/** VLM 답을 원본 프레임·대상·면마다 한 번만 세려고 기억하는 수(넣은 순서, 최근 것). */
const ANSWERS_KEEP = 4000;

/** VLM 사실 넣기. */
export class SceneFacts extends Part {
  private summary = "";
  private summaryAt = Number.NEGATIVE_INFINITY;
  /** 원본 프레임·대상·면(「e3|cup_1|place」)마다 넣은 VLM 답이 전체 사진(full)인지 잘라 본 사진(crop)인지(넣은 순서, 최근 ANSWERS_KEEP개). */
  private readonly answers = new Map<string, "full" | "crop">();

  /** 같은 면의 사실보다 오래된 답은 버린다. 값이 새로 생기거나 바뀌면 true.
   *  지금만 맞는 면(now)은 같은 값이어도 앞 답과 FACT_FRESH_MS 넘게 떨어지면 그 사이를 모르므로 처음 보인 시각을 새로 둔다.
   *  spanMs: 같은 값이 다시 와도 처음 보인 뒤 이만큼 지나야 confirmed로 올린다(기본 0: VLM 답은 두 번째에 바로). */
  setFact(facts: Facts, facet: Facet, value: string, atMs: number, now = false, spanMs = 0): boolean {
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
  answer(frameId: string, id: string, facts: Facts, facet: Facet, value: string, atMs: number, crop: boolean, now: boolean, turn: Set<string>): boolean {
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

  /** 장면 VLM이 물건의 놓인 곳을 말했다: 지금 값과 같으면 넣는다. 처음 값(손에 있음은 빼고)도 넣는다. 다른 값(손에 있음 포함)은 다른 원본 프레임의 더 새 촬영이
   *  같은 값을 이어 말할 때만 넣는다(가로 유리컵 r4: 한 장씩 식탁 위 → 선반 위 → 책상 위로 흔들렸고, 손이 없는 장면 한 장이 손에 있음을 켰다). 잘라 본 답은 이 규칙을 거치지 않는다. */
  private steady(obj: Obj, value: string, frameId: string, at: number): boolean {
    const prev = obj.facts.place;
    if (prev?.value === value || (!prev && value !== POSE_HOLD.object)) {
      obj.placeVote = null;
      return true;
    }
    const v = obj.placeVote;
    if (v && v.value === value && v.frame !== frameId && at > v.at) {
      obj.placeVote = null;
      return true;
    }
    if (!v || v.value !== value || (v.frame !== frameId && at > v.at)) obj.placeVote = { value, frame: frameId, at };
    return false;
  }

  /** VLM 대상: 사람·물건·가전 설비와 그 사실, 종류. */
  private targetOf(id: string): { kind: Target; facts: Facts; cls: ClassKey } | null {
    if (id === PERSON) return { kind: "person", facts: this.core.person.facts, cls: "person" };
    const obj = this.core.objects.get(id);
    if (obj) return { kind: "object", facts: obj.facts, cls: obj.cls };
    const fix = this.core.fixtures.get(id);
    return fix ? { kind: "fixture", facts: fix.facts, cls: fix.cls } : null;
  }

  applyScene(frameId: string, capturedAtMs: number, scene: SceneObservation, ids: Map<string, string>): WorldChange[] {
    const core = this.core;
    core.start(capturedAtMs);
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
    /** 몸통 답을 받은 물건(값이 그대로여도: 두 번째 같은 값이 확인됨으로 올린다). 고리 끝에 내용물을 다시 쓴다. */
    const bodies = new Set<string>();
    /** 안 내용 답: 몸통을 먼저 넣고(불투명이면 버림) 확인 줄을 낸다. */
    const contents: [Obj, StateOf<"contents">][] = [];
    const hidden = new Set(scene.observations.filter((o) => (VLM_ONLY as readonly string[]).includes(o.state)).map((o) => ids.get(o.object_id)).filter((x): x is string => !!x));
    for (const ob of scene.observations) {
      const id = ids.get(ob.object_id);
      const target = id ? this.targetOf(id) : null;
      if (!id || !target || !(ob.state in STATES)) continue;
      const value = ob.state as StateKey;
      if (!fits(value, target.cls, target.kind)) continue;
      const facet = STATES[value].facet;
      said.add(`${id}|${facet}`);
      // 안 내용은 이 답의 몸통(불투명)을 넣은 뒤 갱신기로 넣는다(아래)
      if (target.kind === "object" && facet === "contents") {
        contents.push([core.objects.get(id)!, value as StateOf<"contents">]);
        continue;
      }
      if (target.kind === "object" && facet === "body") bodies.add(id);
      if (core.people.poseHolds(target.facts[facet], capturedAtMs) || core.merge.carriedPlace(id, facet) || core.people.fallHeld(id, facet)) continue;
      if (target.kind === "object" && facet === "place" && !this.steady(core.objects.get(id)!, value, frameId, capturedAtMs)) continue;
      if (!this.answer(frameId, id, target.facts, facet, value, capturedAtMs, false, NOW_FACETS[target.kind].includes(facet), turn)) continue;
      if (target.kind === "person") {
        if (core.person.visible) changes.push({ kind: "person_state", at_ms: capturedAtMs, subject: PERSON, meaningful: false, text: CHANGE_TEXT.state(OBJECT_NAME.person!, value) });
      } else if (target.kind === "fixture") {
        const fix = core.fixtures.get(id)!;
        changes.push({ kind: "fixture", at_ms: capturedAtMs, subject: id, meaningful: true, text: CHANGE_TEXT.state(fixtureName(fix.cls, fix.id, fix.roomLabel), value) });
      } else {
        const obj = core.objects.get(id)!;
        if (obj.confirmed && obj.status !== "gone") changes.push({ kind: "state", at_ms: capturedAtMs, subject: id, meaningful: true, text: CHANGE_TEXT.state(core.name(obj), value) });
      }
    }
    for (const id of bodies) core.contents.settle(core.objects.get(id)!);
    for (const [obj, value] of contents) {
      const { changes: c } = core.contents.see(obj, frameId, capturedAtMs, value, 0);
      if (obj.confirmed && obj.status !== "gone") changes.push(...c);
    }
    // 이 프레임에서 본 대상의 지금만 맞는 사실: 이 답에 없으면 지운다(더 새 답의 사실, 같은 원본 프레임을 잘라 본 답의 사실은 그대로)
    for (const id of new Set(ids.values())) {
      const target = this.targetOf(id);
      if (!target || hidden.has(id)) continue;
      const owner = id === PERSON ? core.person : core.objects.get(id) ?? core.fixtures.get(id)!;
      owner.answered = Math.max(owner.answered ?? capturedAtMs, capturedAtMs);
      for (const f of NOW_FACETS[target.kind]) {
        const prev = target.facts[f];
        if (!prev || prev.at_ms > capturedAtMs || said.has(`${id}|${f}`) || core.people.poseHolds(prev, capturedAtMs)) continue;
        if (this.answers.get(`${frameId}|${id}|${f}`) === "crop") continue;
        delete target.facts[f];
      }
    }
    changes.push(...core.sight.seeDevices(frameId, capturedAtMs, scene));
    return changes;
  }
}
