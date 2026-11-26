// World State의 YOLO 감지(Detections): 엔진 프레임 YOLO 감지 가운데 사람(등장·사라짐·자리·방)과 가전 설비(카메라로 가전 맞추기, devices.ts), 관절 자세·쓰러짐(people.ts)만 넣는다.
// 물건 감지는 World State에 들어가지 않는다(사용자 결정 2026-11-18: 물건 등장·확정·사라짐·자리·사실은 장면 VLM 답으로만, sceneobjects.ts).
// 이 파일과 people.ts는 World State 물건을 읽거나 쓰지 않는다(tests/world-yolo-objects.test.ts가 지킨다).
import type { FixtureClass, WorldChange } from "../../contract/world.js";
import type { Detection, FrameMeta, Pose } from "../../contract/observe.js";
import { CHANGE_TEXT } from "../labels.js";
import { CLASSES } from "../vocab.js";
import { FAST_GONE_MS, KEYS, PERSON, Part } from "./core.js";

const FIXTURE_CLASSES: ReadonlySet<string> = new Set(KEYS.filter((k) => CLASSES[k].role === "fixture"));

/** YOLO 감지 넣기(사람·가전 설비·관절). */
export class Detections extends Part {
  /** poses: 이 프레임의 관절(YOLO26-pose). 없으면(관절 모델이 없거나 사람이 없어 돌리지 않음) 자세·손에 듦을 보지 않는다.
   *  이미 넣은 가장 새 전체 사진보다 옛 촬영(감지 대기열에서 늦게 나온 프레임)은 넣지 않고 변화·감지 번호 없이 돌려준다.
   *  ids는 사람·가전 설비 감지 번호만 잇는다(물건 감지 번호는 그 사진의 장면 VLM 물건이 det로 잇는다). 물건 감지는 버린다. */
  applyDetections(frame: FrameMeta, dets: Detection[], poses?: Pose[]): { changes: WorldChange[]; ids: Map<string, string> } {
    const core = this.core;
    const at = frame.capturedAtMs;
    if (core.frameAt !== null && at < core.frameAt) return { changes: [], ids: new Map() };
    core.start(at);
    core.frameAt = at;
    const view = frame.view;
    if (view) core.sawCamera = true;
    const ids = new Map<string, string>();
    const seen = new Set<string>();
    const candidates: { tmp: string; d: Detection }[] = [];
    const eyeRoom = frame.eye ? this.o.roomAt([frame.eye.position[0], frame.eye.position[1]]) : null;
    dets.forEach((d, i) => {
      const tmp = `d${i + 1}`;
      if (!core.accepts(d)) return;
      if (d.label === "person") {
        candidates.push({ tmp, d });
        return;
      }
      if (FIXTURE_CLASSES.has(d.label)) {
        const fix = core.sight.fixture(d.label as FixtureClass, at, eyeRoom);
        ids.set(tmp, fix.id);
        if (frame.vlm !== false) core.sight.sight(frame, tmp, fix, d, eyeRoom); // 카메라로 가전 맞추기는 그 프레임 VLM 답이 쓴다: 빠른 프레임은 답이 없다
        return;
      }
    });
    // 사람 감지 가운데 사용자로 세는 것만 사람이다(시연자 손·폰을 든 시연자는 빼고, people.ts users)
    const users = new Set(core.people.users(frame, candidates.map((c) => c.d), poses));
    const people: Detection[] = [];
    for (const c of candidates) {
      if (!users.has(c.d)) continue;
      ids.set(c.tmp, PERSON);
      seen.add(PERSON);
      people.push(c.d);
    }
    // 누구의 VLM 답인지 모르는 때(crowdAt)는 사용자로 세지 않은 상자까지 센다(VLM은 그 손·사람도 본다)
    if (candidates.length > 1) core.crowdAt = at;
    if (seen.has(PERSON)) {
      core.person.last_seen_ms = at;
      core.person.count = people.length;
      core.people.locatePerson(frame, people);
    }
    const events = core.confirmer.observe(at, seen, core.person.visible ? [PERSON] : [], () => true);
    if (seen.has(PERSON)) core.fastBlocked = false;
    // 떠남 빠르게: 사람이 있던 자리가 화면 안인데 YOLO가 FAST_GONE_MS 이어 못 보면 사라짐 확정(4초)을 기다리지 않는다.
    // 자리가 화면 밖이거나 모르면 셈을 지우고 확정 규칙(confirmer)에 맡긴다. VLM 답이 그 뒤 사람을 보면 되돌린다(WorldState.revertGone)
    // 못 본 구간(vacantFrom)은 안 보임이 된 뒤에도 자리가 화면 안이고 못 보는 동안 이어진다(TV 규칙이 WorldPerson.vacant로 읽는다)
    if (seen.has(PERSON) || !core.people.spotInView(frame)) core.vacantFrom = null;
    else core.vacantFrom ??= at;
    if (core.vacantFrom !== null && core.person.visible && !core.fastBlocked && at - core.vacantFrom >= FAST_GONE_MS && !events.some((e) => e.key === PERSON)) {
      core.fastGone = { at, since: core.person.since_ms, count: core.person.count, facts: core.person.facts };
      core.confirmer.forget(PERSON);
      events.push({ key: PERSON, kind: "gone", atMs: at });
    }
    const changes: WorldChange[] = [];
    for (const e of events) {
      core.person.visible = e.kind === "appeared";
      core.person.since_ms = at;
      if (e.kind === "appeared") core.fastGone = null;
      if (e.kind === "gone") {
        core.person.facts = {};
        core.person.count = 0;
      }
      changes.push({ kind: e.kind === "appeared" ? "person_appeared" : "person_gone", at_ms: at, subject: PERSON, meaningful: true,
        text: e.kind === "appeared" ? CHANGE_TEXT.personAppeared : CHANGE_TEXT.personGone });
    }
    // 사람 방: 보이는 동안 바뀌거나 사람이 막 보이면 변화 하나
    const next = core.people.nextRoom;
    core.people.nextRoom = undefined;
    const appeared = events.some((e) => e.kind === "appeared");
    if (next === null) core.person.room = null;
    else if (next && next.id !== core.person.room?.id) {
      core.person.room = next;
      if (core.person.visible) changes.push(core.people.roomChange(at));
    } else if (appeared && core.person.room) changes.push(core.people.roomChange(at));
    if (poses) core.people.applyPose(frame, poses, changes);
    return { changes, ids };
  }

}
