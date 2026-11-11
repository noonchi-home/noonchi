// 합성 기록 넣기: 한 사람이 사는 집(기본 한양목련 180B)의 지난 며칠(기본 7일, 어제까지)을 기록 DB(RUNTIME_DIR/noonchi.db)에 넣는다.
// 실시험 판단이 기댈 지난 기록(하루 요약·판단 기록·반성·기억 판본)을 만든다. PAM·OpenAI를 부르지 않는다.
// 서버와 같은 길로 쓴다: 관찰(World State 글)·판단·계획(PlanHub, 에이전트가 낼 도구 호출 대본을 같은 계획 검사 PlanDraft에 넣음)·실행 추적(ExecutionTracker: 실제 폰 명령·승인)을 기록기(attachRecorder)가 적고,
// 피드백·반성 줄은 서버와 같은 글로 HistoryDb.add, 판단 기억은 memoryForDay, 기억 판본은 saveMemory로 쓴다. 관찰 텍스트는 textFromWorld가 만든다.
// 방·면·가전 이름은 집 자료(twin/)에서 가져온다. VLM 요약은 지금 VLM 답처럼 영어 한 문장이다.
// 줄마다 data.synthetic = true, 기억 판본은 source synthetic을 단다. --clear는 그것만 지운다(HistoryDb.removeSynthetic). 다시 넣으면 앞 합성 기록을 지우고 넣는다.
//   npx tsx scripts/seed-history.ts [--home mokryeon_180b] [--end YYYY-MM-DD] [--days 7]
//   npx tsx scripts/seed-history.ts --clear
// 서버는 판단·요청마다 기록 DB를 읽으므로 다시 켜지 않아도 된다. 오늘 판단이 이미 기억 판본을 정했으면 합성 기억은 다음 날부터 쓴다.
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import dotenv from "dotenv";
import { checkPlan } from "../src/act/check.js";
import { planIdOf, targetOf, TASKS } from "../src/act/tasks.js";
import { PlanDraft, type PlanResult } from "../src/agent/planTools.js";
import { ExecutionTracker } from "../src/act/track.js";
import { memoryApprovals } from "../src/agent/approval.js";
import { josa } from "../src/agent/phrases.js";
import { CUP_FSM_MEMORY, CUP_TASKS, isoWithOffset, type FsmMemory } from "../src/brain/decision.js";
import type { BrainLog } from "../src/contract/events.js";
import type { PlanView, XZ } from "../src/contract/plan.js";
import type { ControlMode } from "../src/contract/setup.js";
import type { Facet, ObjClass, WorldChange, WorldChangeKind, WorldEye, WorldFact, WorldObject, WorldPerson, WorldView } from "../src/contract/world.js";
import { HistoryDb, historyTzMinutes, type HistoryKind } from "../src/history/db.js";
import { FEEDBACK_TEXT, REFLECT_TEXT } from "../src/history/labels.js";
import { attachRecorder, topic, type DeviceNote } from "../src/history/recorder.js";
import { memoryForDay } from "../src/history/reflect.js";
import { isDay } from "../src/history/summary.js";
import type { DeviceState } from "../src/hub/types.js";
import { loadTwin } from "../src/model/devices.js";
import { loadScene } from "../src/model/scene.js";
import type { FloorPlan } from "../src/plan/floor.js";
import { PlanHub } from "../src/plan/hub.js";
import { floorPlanFrom, roomNamedAt } from "../src/plan/route.js";
import { decisionWorld, type DecisionRecord } from "../src/world/decide.js";
import { CHANGE_TEXT, OBJECT_NAME, objectName, onSurface } from "../src/world/labels.js";
import { textFromWorld } from "../src/world/text.js";
import { NOW_FACETS, STATES, type StateKey } from "../src/world/vocab.js";
import { askSteps, cupSteps, planContext } from "../tests/helpers/planner.js";

const DEFAULT_RUNTIME_DIR = fileURLToPath(new URL("../runtime/", import.meta.url));
const DAY_MS = 86_400_000;
const addDays = (day: string, n: number) => new Date(Date.parse(`${day}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);

/** VLM 상태 → 면(낱말 표, src/world/state.ts와 같다). */
const facetOf = (s: string): Facet => STATES[s as StateKey].facet;
const PERSON = "person";

/** 면 하나: 평면도 물건(식탁·싱크대·거실 테이블). */
interface Place { id: string; label: string; room: string | null; xz: XZ; top: number }
interface Device { id: string; label: string; kind: string }

/** 시나리오가 쓰는 집 자료: 면과 가전 이름, 폰 눈 자리(거치대·식탁 앞·싱크대 앞·소파 쪽). */
interface HomeInfo {
  fp: FloorPlan;
  roomAt: (p: XZ) => { id: string; label: string } | null;
  table: Place; sink: Place; side: Place;
  livingAc: Device; bedAc: Device;
  eye: { rest: XZ; table: XZ; sink: XZ; sinkFar: XZ; sofa: XZ };
}

function loadHome(id: string, twinDir?: string): HomeInfo {
  const twin = loadTwin(twinDir, { home: id });
  const scene = loadScene(twin.home);
  if (!scene) throw new Error(`집 ${id}: scene.json이 없어요`);
  const fp = floorPlanFrom(scene);
  const objects = scene.objects as { id: string; type: string; name?: string }[];
  const place = (type: string, top: number): Place => {
    const o = objects.find((x) => x.type === type);
    const at = o && fp.objects.get(o.id);
    if (!o || !at) throw new Error(`집 ${id}: ${type}이 없어요`);
    return { id: o.id, label: o.name ?? o.id, room: at.room, xz: at.position, top };
  };
  const table = place("dining_table", 0.75);
  const sink = place("sink_counter", 0.9);
  const side = place("coffee_table", 0.45);
  const acs = twin.devices.filter((d) => d.kind === "aircon" && d.twinAttrs.power);
  const livingAc = acs.find((d) => d.room === table.room);
  const bedAc = acs.find((d) => d.room !== table.room);
  if (!livingAc || !bedAc) throw new Error(`집 ${id}: 식탁 방 에어컨과 다른 방 에어컨이 있어야 해요`);
  const roomAt = roomNamedAt(fp, twin.rooms);
  const off = (p: Place, dx: number, dz: number): XZ => [p.xz[0] + dx, p.xz[1] + dz];
  const eye = { rest: off(table, 1.0, 1.2), table: off(table, 0.45, 0.6), sink: off(sink, 0.4, 0.7), sinkFar: off(sink, 1.2, 1.0), sofa: off(side, 1.6, -1.6) };
  for (const [k, p] of Object.entries(eye)) if (!roomAt(p)) throw new Error(`집 ${id}: 폰 눈 자리 ${k} [${p.join(", ")}]가 집 밖이에요`);
  return { fp, roomAt, table, sink, side, livingAc: { id: livingAc.id, label: livingAc.label, kind: livingAc.kind }, bedAc: { id: bedAc.id, label: bedAc.label, kind: bedAc.kind }, eye };
}

/** add마다 data.synthetic = true를 붙이는 기록 DB(나머지는 그대로). */
function marked(db: HistoryDb): HistoryDb {
  const m = Object.create(db) as HistoryDb;
  m.add = (kind, atMs, text, o = {}) => db.add(kind, atMs, text, { ...o, data: { ...(o.data && typeof o.data === "object" ? o.data : {}), synthetic: true } });
  return m;
}

/** 한 주를 서버처럼 흘린다. 날마다 서버를 새로 켠 것처럼 World State·판단 번호·계획·실행 추적을 새로 둔다. 승인 기억은 이어진다. */
class Week {
  t = 0;
  day = "";
  private seq = 0;
  private frame = 0;
  private readonly brain = topic<[BrainLog]>();
  private readonly plansOut = topic<[PlanView]>();
  private readonly devices = topic<[DeviceState, DeviceNote?]>();
  private readonly modes = topic<[ControlMode]>();
  private readonly detach: () => void;
  private readonly twin = new Map<string, Record<string, unknown>>();
  private readonly approvals = memoryApprovals(() => new Date(this.t).toISOString());
  private objects = new Map<string, WorldObject>();
  private counters = new Map<string, number>();
  private person: WorldPerson = { visible: false, since_ms: null, last_seen_ms: null, count: 0, room: null, room_label: null, position: null, near: [], holding: [], position_ms: null, answered_ms: null, facts: {} };
  private eyeView: WorldEye | null = null;
  private recent: WorldChange[] = [];
  private summary = "";
  private vlmMissing = 0;
  private plans!: PlanHub;
  private tracker!: ExecutionTracker;
  readonly reflections: { version: number; appliesDay: string }[] = [];

  constructor(private readonly db: HistoryDb, readonly home: HomeInfo) {
    this.detach = attachRecorder(db, {
      onDevice: (cb) => this.devices.on(cb), onBrain: (cb) => this.brain.on(cb), onPlan: (cb) => this.plansOut.on(cb), onMode: (cb) => this.modes.on(cb), now: () => this.t,
    });
  }

  close(): void {
    this.detach();
  }

  private stamp(): string {
    return `${this.day} ${new Date(this.t + this.db.offsetMinutes * 60_000).toISOString().slice(11, 19)}`;
  }

  /** 그날 기록 시간대 시:분:초로 시계를 옮긴다(앞으로만). */
  at(hms: string): void {
    const t = Date.parse(`${this.day}T${hms}Z`) - this.db.offsetMinutes * 60_000;
    if (t < this.t) throw new Error(`${this.stamp()}: ${hms}는 지난 시각이에요`);
    this.t = t;
  }

  wait(sec: number): void {
    this.t += Math.round(sec * 1000);
  }

  /** 서버를 켠다: World State·판단 번호·계획·실행 추적을 새로 둔다. 가전 시작 상태는 적지 않고 기억만 한다. */
  boot(day: string, hms: string): void {
    this.day = day;
    this.at(hms);
    Object.assign(this, { seq: 0, frame: 0, objects: new Map(), counters: new Map(), recent: [], summary: "", vlmMissing: 0 });
    this.person = { visible: false, since_ms: this.t, last_seen_ms: null, count: 0, room: null, room_label: null, position: null, near: [], holding: [], position_ms: null, answered_ms: null, facts: {} };
    this.plans = new PlanHub(this.home.fp, (m) => { if (m.type === "plan" && m.plan) this.plansOut.emit(m.plan); }, () => new Date(this.t).toISOString());
    this.tracker = new ExecutionTracker({
      plans: this.plans, world: () => this.view(), floor: () => this.plans.floor(), toPhone: () => {}, emit: (l) => this.brain.emit(l), approvals: this.approvals,
      clock: { now: () => this.t },
      check: (d, p) => checkPlan({ decision: d, tasks: [...CUP_TASKS], plan: p, world: this.view(), nowMs: this.t, staleMs: 3000, mode: "test" }),
      // OpenAI를 부르지 않으므로 에이전트가 낼 도구 호출(컵 치우기 네 단계·물어보기)을 같은 계획 검사(PlanDraft)에 넣는다
      planner: (d) => this.plan(d),
    });
    for (const d of [this.home.livingAc, this.home.bedAc]) {
      if (!this.twin.has(d.id)) this.twin.set(d.id, { power: d === this.home.bedAc ? "on" : "off" });
      this.devices.emit(this.state(d.id), { initial: true, label: d.label, kind: d.kind });
    }
    this.eye(this.home.eye.rest);
  }

  /** 에이전트 계획 모드 대신: 서버 가짜 모델 시험과 같은 단계 대본을 계획 검사에 넣는다. */
  private plan(d: DecisionRecord): PlanResult {
    const view = this.view();
    const draft = new PlanDraft(planContext({ decision: d, world: view, floor: this.plans.floor() }));
    const type = (t: string) => [...this.home.fp.objects.values()].find((o) => o.type === t)?.id ?? "";
    const steps = d.action === "컵 치우기"
      ? cupSteps({ table: type("dining_table"), sink: type("sink_counter"), cup: targetOf(TASKS["컵 치우기"]!, view)?.id ?? "" })
      : askSteps();
    for (const [i, s] of steps.entries()) {
      const r = draft.add({ step: i + 1, ...s });
      if (!r.ok) return r;
    }
    return draft.finish();
  }

  mode(m: ControlMode): void {
    this.modes.emit(m);
  }

  private state(id: string): DeviceState {
    return { id, online: true, twin: { ...this.twin.get(id)! }, matter: {}, updatedAt: new Date(this.t).toISOString() };
  }

  device(d: Device, attr: string, to: unknown): void {
    this.twin.set(d.id, { ...this.twin.get(d.id), [attr]: to });
    this.devices.emit(this.state(d.id), { label: d.label, kind: d.kind });
  }

  /** 폰 눈(맞춘 자세) 자리. 계획 출발점과 이동 단계 확인에도 쓴다. */
  eye(p: XZ): void {
    const room = this.home.roomAt(p);
    this.eyeView = { position: p, height_m: 1.4, yaw_deg: 0, pitch_deg: -20, room: room?.id ?? null, room_label: room?.label ?? null, at_ms: this.t };
    this.plans.onEye(p);
    this.tracker.onEye(p);
  }

  view(): WorldView {
    return {
      at_ms: this.t, objects: [...this.objects.values()].map((o) => ({ ...o, facts: { ...o.facts } })), person: { ...this.person, facts: { ...this.person.facts } },
      fixtures: [], devices: [], eye: this.eyeView, frame_ms: null, vlm_missing: this.vlmMissing, yolo_missing: 0,
    };
  }

  private change(kind: WorldChangeKind, subject: string, text: string, meaningful: boolean): void {
    this.recent = [...this.recent.filter((c) => c.at_ms >= this.t - 600_000), { kind, at_ms: this.t, subject, text, meaningful }];
    this.brain.emit({ type: "world_change", at_ms: this.t, kind, text });
  }

  personIn(): void {
    Object.assign(this.person, { visible: true, since_ms: this.t, last_seen_ms: this.t });
    this.change("person_appeared", PERSON, CHANGE_TEXT.personAppeared, true);
  }

  personOut(): void {
    Object.assign(this.person, { visible: false, since_ms: this.t, facts: {} });
    this.change("person_gone", PERSON, CHANGE_TEXT.personGone, true);
  }

  /** 물건이 면 위에 보인다(등장 확인). 새 id를 돌려준다. */
  put(cls: ObjClass, on: Place): string {
    const n = (this.counters.get(cls) ?? 0) + 1;
    this.counters.set(cls, n);
    const id = `${cls}_${n}`;
    this.objects.set(id, {
      id, cls, position: [on.xz[0], on.top, on.xz[1]], surface: on.id, surface_label: on.label, room: on.room, error_m: 0.12, status: "present",
      first_seen_ms: this.t, last_seen_ms: this.t, last_in_view_ms: this.t, facts: {}, answered_ms: null, devices: [], closer_hold: false,
    });
    this.change("appeared", id, CHANGE_TEXT.appeared(objectName(cls, id), onSurface(on.label)), true);
    return id;
  }

  hide(id: string): void {
    const o = this.objects.get(id)!;
    o.status = "out_of_view";
    this.change("out_of_view", id, CHANGE_TEXT.outOfView(objectName(o.cls, id)), false);
  }

  gone(id: string): void {
    const o = this.objects.get(id)!;
    o.status = "gone";
    for (const f of NOW_FACETS.object) delete o.facts[f];
    this.change("gone", id, CHANGE_TEXT.gone(objectName(o.cls, id)), true);
  }

  /** 같은 값이 두 번이면 확인됨. 새 값이거나 바뀌면 true. */
  private fact(facts: Partial<Record<Facet, WorldFact>>, facet: Facet, value: string): boolean {
    const prev = facts[facet];
    facts[facet] = { value, at_ms: this.t, since_ms: prev?.value === value ? prev.since_ms : this.t, certainty: prev?.value === value ? "confirmed" : "inferred" };
    return prev?.value !== value;
  }

  /** 엔진 프레임 n장(2초 간격). 장마다 VLM 답(vlm 줄), 보이는 물건·사람의 사실, 요약이 바뀌면 World State 변화. */
  see(summary: string, facts: Record<string, string[]> = {}, n = 3): void {
    for (let i = 0; i < n; i++) {
      this.wait(2);
      this.brain.emit({ type: "observe", at_ms: this.t, frame_id: `e${++this.frame}`, captured_at_ms: this.t - 1200, yolo: null, vlm: summary });
      for (const o of this.objects.values()) if (o.status === "present") Object.assign(o, { last_seen_ms: this.t, last_in_view_ms: this.t });
      if (this.person.visible) this.person.last_seen_ms = this.t;
      if (summary !== this.summary) {
        this.summary = summary;
        this.change("vlm", `e${this.frame}`, CHANGE_TEXT.vlm(summary), false);
      }
      for (const [target, states] of Object.entries(facts)) {
        const isPerson = target === PERSON;
        const obj = isPerson ? null : this.objects.get(target)!;
        const into = isPerson ? this.person.facts : obj!.facts;
        const said = new Set(states.map(facetOf));
        for (const f of NOW_FACETS[isPerson ? "person" : "object"]) if (!said.has(f)) delete into[f];
        for (const s of states) {
          if (!this.fact(into, facetOf(s), s)) continue;
          if (isPerson) {
            if (this.person.visible) this.change("person_state", PERSON, CHANGE_TEXT.state(OBJECT_NAME.person!, s), false);
          } else this.change("state", target, CHANGE_TEXT.state(objectName(obj!.cls, target), s), true);
        }
      }
    }
  }

  /** VLM 답을 못 받은 프레임(vlm 줄만, World State 변화 없음). */
  missing(reason: "timeout" | "cap"): void {
    this.wait(2);
    this.vlmMissing++;
    this.brain.emit({ type: "observe", at_ms: this.t, frame_id: `e${++this.frame}`, captured_at_ms: this.t - 1200, yolo: null, vlm: null, vlm_missing: reason });
  }

  /** PAM 판단 하나: 지금 World State 관찰 텍스트 + 그날 기억 판본 + 행동 목록. 답(action·observation·reasoning)은 시나리오가 정한다. */
  decide(action: (typeof CUP_TASKS)[number] | null, observation: string, reasoning: string): string {
    this.wait(0.25);
    const atMs = this.t;
    const view = this.view();
    const textSent = textFromWorld(view, this.recent, { nowMs: atMs, offsetMinutes: this.db.offsetMinutes });
    const mem = memoryForDay(this.db, this.day);
    const seq = ++this.seq;
    const tasks: string[] = [...CUP_TASKS];
    const prediction = { observation, reasoning, task_index: action === null ? -1 : tasks.indexOf(action) };
    const d: DecisionRecord = {
      id: `pam-${seq}`, seq, atMs, textSent, finalTime: isoWithOffset(atMs, this.db.offsetMinutes), status: "valid", prediction, action,
      memoryVersion: mem.version, world: decisionWorld(view),
    };
    this.wait(1.9);
    this.brain.emit({ type: "decision", at_ms: this.t, id: d.id, seq, text_sent: textSent, status: "valid", prediction, action, memory_version: mem.version, world: d.world });
    this.tracker.onDecision(d);
    return planIdOf(d.id);
  }

  /** 판단 뒤 프레임으로 대상을 다시 보고 실행 전 검사를 통과한다. 처음 하는 일이면 승인 질문, 아니면 첫 명령이 실제 폰에 뜬다. */
  start(summary: string, facts: Record<string, string[]>): void {
    this.see(summary, facts, 1);
    this.tracker.tick();
    if (!this.tracker.openCommand()) throw new Error(`${this.stamp()}: 실행 전 검사를 통과하지 못했어요`);
  }

  private open() {
    const open = this.tracker.openCommand();
    if (!open) throw new Error(`${this.stamp()}: 실제 폰에 열린 명령이 없어요`);
    return open;
  }

  /** 실제 폰 답 단추(src/server/home.ts onChoice와 같다). */
  tap(choice: string): void {
    this.wait(3);
    const open = this.open();
    const picked = open.choices.find((c) => c.id === choice);
    if (!picked || !this.tracker.onAnswer(open.planId, open.stepId, choice)) throw new Error(`${this.stamp()}: ${choice} 답을 받지 않았어요`);
    this.db.add("feedback", this.t, FEEDBACK_TEXT.answer(picked.label, open.kind, open.text), { subject: open.planId, data: { choice, via: "button" } });
  }

  /** 실제 폰이 들은 말(src/server/home.ts onAnswer와 같다). */
  say(text: string): void {
    this.wait(3);
    const open = this.open();
    const picked = this.tracker.onHeard(text);
    if (!picked) throw new Error(`${this.stamp()}: 「${text}」를 답으로 받지 않았어요`);
    this.db.add("feedback", this.t, FEEDBACK_TEXT.answer(text, open.kind, open.text), { subject: open.planId, data: { choice: picked.id, via: "voice" } });
  }

  /** 이동 단계: walk면 폰 눈이 목표 1.2m 안으로 들어와 넘어가고, 아니면 목표 가까이(1.2m 밖)에서 「완료」 단추나 그 말로 넘긴다. */
  private move(near: XZ, far: XZ, how: string): void {
    this.wait(6);
    if (how === "walk") {
      this.eye(near);
      this.tracker.tick();
    } else {
      this.eye(far);
      if (how === "tap") this.tap("done");
      else this.say(how);
    }
  }

  /** 컵 치우기 네 단계를 사람이 실제 폰 명령대로 한다. 싱크대에 넣은 컵은 World State가 새 id로 본다. 끝나면 폰을 거치대에 둔다. */
  clearCup(cup: string, how: { table?: string; sink?: string } = {}): void {
    const { eye, sink } = this.home;
    this.move(eye.table, eye.rest, how.table ?? "walk");
    this.wait(4);
    this.see("A hand holds a mug above the dining table.", { [cup]: ["in_hand"] }, 2);
    this.tracker.onWorld();
    this.move(eye.sink, eye.sinkFar, how.sink ?? "walk");
    this.wait(3);
    const moved = this.put("cup", sink);
    this.hide(cup);
    this.see("A mug sits in the kitchen sink.", { [moved]: ["in_sink"] }, 2);
    this.tracker.onWorld();
    if (this.tracker.current()?.state !== "done") throw new Error(`${this.stamp()}: 컵 치우기가 끝나지 않았어요`);
    this.wait(25);
    this.eye(eye.rest);
    this.gone(cup);
    this.hide(moved);
    this.see("The dining table is clear.", {}, 2);
  }

  /** 하루 끝 반성(REFLECT_AT 23:30): 새 기억 판본은 다음 날부터(그날 판본을 이미 정한 날은 건너뛴다). 반성 줄은 runReflection과 같은 글. */
  reflect(memory: FsmMemory): void {
    let appliesDay = addDays(this.day, 1);
    while (this.db.pinnedMemory(appliesDay) !== null) appliesDay = addDays(appliesDay, 1);
    this.wait(38);
    const version = this.db.saveMemory({ kind: "fsm", memory, day: this.day, appliesDay, source: "synthetic" });
    this.db.add("reflection", this.t, REFLECT_TEXT.done(version, appliesDay), { data: { day: this.day, ok: true, version, applies_day: appliesDay } });
    this.reflections.push({ version, appliesDay });
  }
}

/** i번째 날 반성이 남기는 기억(PAM fsm 모양). 날이 갈수록 일과 단계가 늘고, 첫날 답에서 밤에는 묻지 않는다는 것을 배운다. */
export function memoryAfter(i: number, h: Pick<HomeInfo, "table" | "side" | "livingAc">): FsmMemory {
  const T = h.table.label;
  const clear = { trigger: `사용자가 컵을 비우고 ${josa(T, "을/를")} 떠났${i >= 2 ? "거나 외출하러 현관 쪽으로 나갔" : ""}고 아무도 컵을 들거나 만지지 않는다.`, action: "컵 치우기" };
  const ask = { trigger: "22시 전에 사용자가 자리를 비웠고 컵 안을 확인할 수 없다.", action: "사용자에게 물어보기" };
  const night = {
    id: "night",
    description: `22시가 넘은 밤이다. 사용자는 밤에는 폰으로 묻지 않기를 바란다.${i >= 1 ? ` 23시쯤 ${josa(h.livingAc.label, "을/를")} 끄고 침실로 간다.` : ""}`,
    rules: [{ trigger: `22시 이후 사용자가 자리를 비웠고 ${h.side.label} 위나 ${T} 위에 컵이 남아 있다.`, action: "대기" }],
    next: [{ to: i >= 1 ? "morning_coffee" : "drinking", on: `다음 날 아침 사용자가 ${T}에 앉아 커피를 마신다.` }],
  };
  const leftCup = {
    id: "left_cup",
    description: `사용자가 컵을 ${T} 위에 두고 자리를 비웠다. 사용자는 다 마시고 자리를 뜨면 컵을 치워 주기를 바란다. 잠깐 자리를 떴다가 돌아와 다시 마시기도 하니 컵이 비었는지 본다.${i >= 3 ? " 컵 안이 안 보여 물으면 치워 달라고 답한다." : ""}`,
    rules: [clear, ask],
    next: i === 0
      ? [{ to: "drinking", on: "사용자가 돌아와 컵을 다시 든다." }, { to: "night", on: "22시가 넘는다." }]
      : [
        { to: "morning_coffee", on: "사용자가 돌아와 컵을 다시 든다." }, { to: "away", on: "사용자가 외출하러 집을 나간다." },
        { to: "evening_tv", on: "사용자가 거실 소파에 앉아 TV를 본다." }, { to: "night", on: "22시가 넘는다." },
      ],
  };
  if (i === 0) {
    return {
      initial_state: "drinking",
      states: [
        { id: "drinking", description: `사용자가 ${T}에서 컵으로 커피나 음료를 마시는 중이라 컵은 사용 중이다.`, rules: [], next: [{ to: "left_cup", on: `사용자가 컵을 ${T}에 내려놓고 일어나 자리를 떠난다.` }] },
        leftCup, night,
      ],
    };
  }
  return {
    initial_state: "morning_coffee",
    states: [
      {
        id: "morning_coffee", description: `${i >= 5 ? "평일 7시쯤, 주말 8시 40분쯤" : "평일 7시쯤"} 사용자가 일어나 ${T}에서 컵으로 커피를 마신다. 컵은 사용 중이다.`, rules: [],
        next: [{ to: "left_cup", on: `사용자가 컵을 ${T}에 두고 일어나 자리를 떠난다.` }],
      },
      leftCup,
      {
        id: "away", description: `평일 8시 30분쯤부터 18시 30분쯤까지 사용자가 집에 없다.${i >= 4 ? " 금요일에는 21시쯤 돌아오기도 한다." : ""}`, rules: [],
        next: [{ to: "meal", on: `사용자가 돌아와 ${T}에 그릇과 컵을 놓는다.` }, { to: "evening_tv", on: "사용자가 돌아와 거실 소파에 앉는다." }],
      },
      {
        id: "meal", description: `${i >= 5 ? "19시쯤 저녁과 주말 12시 30분쯤 점심을" : "19시쯤 저녁을"} 사용자가 ${T}에서 그릇과 컵으로 먹는다. 먹는 동안 그릇과 컵은 사용 중이다.`, rules: [],
        next: [{ to: "left_cup", on: `사용자가 식사를 마치고 ${josa(T, "을/를")} 떠난다.` }],
      },
      {
        id: "evening_tv", description: `저녁${i >= 6 ? "과 주말 오후" : ""}에 사용자가 거실 소파에서 TV를 보고 ${josa(h.livingAc.label, "을/를")} 켠다. 소파에서 차를 마시기도 한다.`,
        rules: [{ trigger: `사용자가 소파에서 TV를 보고 있고 ${T} 위 컵이 비어 있으며 아무도 만지지 않는다.`, action: "컵 치우기" }],
        next: [{ to: "night", on: "22시가 넘는다." }],
      },
      night,
    ],
  };
}

/** 아침 커피: 앉아 마시다 다 마시고 자리를 뜨면 컵을 치운다. 첫날은 처음 하는 일이라 승인을 묻는다: 잠깐 자리를 뜬 첫 번째는 「거절」, 다 마신 두 번째는 「승인」. */
function morning(w: Week, i: number, start: string, weekend: boolean): void {
  const { table } = w.home;
  w.at(start);
  w.personIn();
  w.see("A person stands next to the dining table.", { person: ["standing"] }, 2);
  w.decide(null, "사람이 식탁 옆에 서 있고 식탁 위에는 아무것도 없다.", "아침 커피를 막 시작하는 때라 지금 도울 일이 없다.");
  w.wait(140);
  const cup = w.put("cup", table);
  w.see("A person sits at the dining table with a mug of coffee.", { person: ["sitting", "drinking"], [cup]: ["on_table", "has_contents"] }, 3);
  w.decide(null, "사람이 식탁에 앉아 컵으로 커피를 마시고 있다.", "컵을 쓰는 중이라 지금 치우면 방해가 된다.");
  if (i % 3 === 2) { // 가끔 VLM 답이 늦는다
    w.wait(300);
    w.missing("timeout");
    w.missing("timeout");
  }
  w.wait(weekend ? 1500 : 900);
  w.see("A person sits at the dining table drinking from a mug.", { person: ["sitting", "drinking"], [cup]: ["on_table", "has_contents"] }, 2);
  if (i === 0) {
    w.wait(260);
    w.see("A person stands up from the dining table.", { person: ["standing"], [cup]: ["on_table", "empty"] }, 2);
    w.personOut();
    w.decide("컵 치우기", "사람이 자리를 떠났고 식탁 위 컵이 비어 있다.", "left_cup 규칙대로 사람이 두고 간 빈 컵을 싱크대로 치운다.");
    w.start("An empty mug is on the dining table.", { [cup]: ["on_table", "empty"] });
    w.say("거절");
    w.wait(400);
    w.personIn();
    w.see("A person sits at the dining table and pours coffee into the mug.", { person: ["sitting", "holding_object"], [cup]: ["on_table", "has_contents"] }, 3);
    w.decide(null, "사람이 돌아와 컵에 커피를 다시 따랐다.", "drinking 단계로 돌아와 컵을 다시 쓰는 중이라 치우지 않는다.");
    w.wait(1000);
  } else w.wait(500);
  w.see("A person puts the mug down and stands up.", { person: ["standing"], [cup]: ["on_table", "empty"] }, 2);
  w.personOut();
  w.decide("컵 치우기", "사람이 컵을 비우고 식탁을 떠났다.", i === 0
    ? "left_cup 규칙대로 비운 컵을 싱크대로 치운다."
    : "사용자는 다 마시고 자리를 뜨면 컵을 치워 주기를 바라므로 left_cup 규칙대로 치운다.");
  w.start("An empty mug is on the dining table.", { [cup]: ["on_table", "empty"] });
  if (i === 0) w.tap("approve");
  w.clearCup(cup, i === 0 ? { sink: "tap" } : i === 2 ? { table: "다 했어" } : {});
}

/** 외출·귀가: 식탁 옆을 지나 나가고, 저녁에 돌아온다. */
function away(w: Week, out: string, back: string): void {
  w.at(out);
  w.personIn();
  w.see("A person in a coat walks past the dining table.", { person: ["standing"] }, 2);
  w.decide(null, "외출 옷을 입은 사람이 식탁 옆을 지나간다.", "식탁에 치울 컵이 없어 기다린다.");
  w.wait(20);
  w.personOut();
  w.see("The dining table is clear.", {}, 2);
  w.decide(null, "사람이 현관 쪽으로 나가 보이지 않는다.", "away 단계라 지금 도울 일이 없다.");
  w.at(back);
  w.personIn();
  w.see("A person stands near the dining table holding a bag.", { person: ["standing", "holding_object"] }, 2);
  w.decide(null, "사람이 집에 돌아와 식탁 옆에 서 있다.", "식탁에 치울 컵이 없어 기다린다.");
}

/** 식사: 그릇과 컵으로 먹고 자리를 뜨면 컵을 치운다. ask면 컵 안이 안 보여 먼저 묻고 「치워 주세요」 답 뒤에 치운다. */
function meal(w: Week, start: string, o: { ask?: boolean; lunch?: boolean } = {}): void {
  const { table } = w.home;
  w.at(start);
  w.eye(w.home.eye.rest);
  const bowl = w.put("bowl", table);
  const cup = w.put("cup", table);
  w.see(`A person eats ${o.lunch ? "lunch" : "dinner"} at the dining table with a bowl and a cup.`,
    { person: ["sitting", "eating"], [bowl]: ["on_table", "has_contents"], [cup]: ["on_table", "has_contents"] }, 3);
  w.decide(null, "사람이 식탁에서 그릇과 컵으로 밥을 먹고 있다.", "식사 중이라 그릇과 컵을 쓰고 있어 기다린다.");
  w.wait(1650);
  w.see("A person stands up from the dining table after eating.", { person: ["standing"], [bowl]: ["on_table", "empty"], [cup]: ["on_table", o.ask ? "contents_unknown" : "empty"] }, 2);
  w.personOut();
  if (o.ask) {
    w.decide("사용자에게 물어보기", "사람이 식탁을 떠났고 컵 안이 보이지 않는다.", "22시 전이고 컵 안을 확인할 수 없어 left_cup 규칙대로 사용자에게 묻는다.");
    w.tap("clear");
    w.see("An empty cup and an empty bowl are on the dining table.", { [bowl]: ["on_table", "empty"], [cup]: ["on_table", "empty"] }, 2);
    w.decide("컵 치우기", "식탁 위 컵이 비어 있고 사용자가 치워 달라고 답했다.", "사용자 답대로 left_cup 규칙의 컵 치우기를 한다.");
  } else {
    w.decide("컵 치우기", "사람이 식사를 마치고 식탁을 떠났고 컵이 비어 있다.", "사용자는 자리를 뜨면 컵을 치워 주기를 바라므로 빈 컵을 싱크대로 치운다.");
  }
  w.start("An empty cup and an empty bowl are on the dining table.", { [bowl]: ["on_table", "empty"], [cup]: ["on_table", "empty"] });
  w.clearCup(cup);
  w.wait(60);
  w.gone(bowl);
  w.see("The dining table is clear.", {}, 2);
}

/** TV와 거실 에어컨. 폰은 소파 쪽을 본다. 끝나면 에어컨을 끄고 자리를 뜬다. teaAt이면 그때 거실 테이블에 찻잔을 두고, 떠날 때 남긴다(그 판단은 부른 쪽이 한다). */
function tv(w: Week, start: string, end: string, teaAt?: string): string | null {
  const { side, livingAc } = w.home;
  w.at(start);
  w.eye(w.home.eye.sofa);
  w.personIn();
  w.see("A person sits on the sofa watching TV.", { person: ["sitting"] }, 3);
  w.decide(null, "사람이 거실 소파에 앉아 TV를 보고 있다.", "evening_tv 단계에서 치울 빈 컵이 보이지 않는다.");
  w.wait(200);
  w.device(livingAc, "power", "on");
  let tea: string | null = null;
  if (teaAt) {
    w.at(teaAt);
    tea = w.put("cup", side);
    w.see("A person sits on the sofa holding a cup of tea.", { person: ["sitting", "holding_object"], [tea]: ["on_table", "has_contents"] }, 3);
    w.decide(null, "사람이 소파에서 컵으로 차를 마시고 있다.", "컵을 쓰는 중이라 기다린다.");
  }
  w.at(end);
  w.device(livingAc, "power", "off");
  w.wait(90);
  w.see(tea ? "A cup is left on the coffee table in a dim living room." : "A person stands up from the sofa.",
    { person: ["standing"], ...(tea ? { [tea]: ["on_table", "contents_unknown"] } : {}) }, 2);
  w.personOut();
  if (!tea) w.decide(null, "사람이 소파에서 일어나 거실을 떠났다.", "치울 컵이 보이지 않아 기다린다.");
  return tea;
}

/** 하루: 평일은 7시쯤 일어나 커피, 8시 30분쯤 나가 18시 30분쯤 돌아와 저녁, TV, 23시 30분쯤 잔다. 주말은 늦게 일어나 점심도 먹는다. */
function liveDay(w: Week, day: string, i: number): void {
  const dow = new Date(`${day}T00:00:00Z`).getUTCDay();
  const weekend = dow === 0 || dow === 6;
  w.boot(day, weekend ? "08:20:00" : "06:50:00");
  if (i === 0) {
    w.wait(5);
    w.mode("test");
  }
  w.at(weekend ? "08:24:30" : "06:55:10");
  w.device(w.home.bedAc, "power", "off");
  morning(w, i, weekend ? "08:41:12" : "07:02:14", weekend);
  if (weekend) {
    meal(w, "12:31:40", { lunch: true });
    if (dow === 6) away(w, "13:52:10", "17:48:30");
    else tv(w, "15:04:20", "17:08:40");
    meal(w, "18:56:05");
  } else if (dow === 5) {
    away(w, "08:28:40", "21:06:15");
  } else {
    away(w, "08:28:40", "18:36:10");
    meal(w, "19:02:30", { ask: dow === 4 });
  }
  const tea = tv(w, dow === 5 ? "21:14:00" : weekend ? "19:41:30" : "19:44:00", "23:04:30", "22:41:15")!;
  if (i === 0) {
    w.decide("사용자에게 물어보기", "사람이 자리를 떠났고 거실 테이블 위 컵 안이 보이지 않는다.", "컵 안을 확인할 수 없어 left_cup 규칙대로 사용자에게 묻는다.");
    w.say("그대로 둬요. 밤에는 묻지 마세요");
  } else {
    w.decide(null, `밤 23시에 사람이 침실로 가고 거실 테이블에 컵 ${tea}이 남았다.`, "night 단계라 밤에는 묻지 않고 아침까지 둔다.");
  }
  w.at("23:12:40");
  w.device(w.home.bedAc, "power", "on");
  w.at("23:30:00");
  w.reflect(memoryAfter(i, w.home));
}

export interface SeedOptions {
  /** 집 id(twin/homes.json). 방·면·가전 이름을 이 집 자료에서 가져온다. */
  home: string;
  /** 마지막 날 YYYY-MM-DD(기록 시간대). */
  end: string;
  /** 날 수(기본 7). */
  days?: number;
  /** 트윈 폴더(기본 TWIN_STUDIO_DIR → 저장소 twin/). */
  twinDir?: string;
}

export interface SeedResult {
  days: string[];
  /** 넣은 줄 수(종류별). */
  counts: Partial<Record<HistoryKind, number>>;
  /** 넣은 기억 판본(첫 판은 컵 FSM seed). */
  versions: number[];
  /** 마지막 합성 기억 판본과 쓰기 시작하는 날. */
  latest: { version: number; appliesDay: string };
  /** 끝난 다음 날(오늘) 판단이 쓸 판본. */
  today: { day: string; version: number | null };
  cleared: ReturnType<HistoryDb["removeSynthetic"]>;
}

/** 앞서 넣은 합성 기록을 지우고 새로 넣는다. PAM·OpenAI를 부르지 않는다. */
export function seedHistory(db: HistoryDb, o: SeedOptions): SeedResult {
  const n = o.days ?? 7;
  if (!isDay(o.end)) throw new Error(`없는 날짜예요: ${o.end}`);
  if (!Number.isInteger(n) || n < 1 || n > 60) throw new Error(`날 수는 1~60이어야 해요: ${n}`);
  const home = loadHome(o.home, o.twinDir);
  const cleared = db.removeSynthetic();
  const days = Array.from({ length: n }, (_, i) => addDays(o.end, i - n + 1));
  const seed = db.saveMemory({ kind: "fsm", memory: CUP_FSM_MEMORY, day: null, appliesDay: null, source: "synthetic" });
  const w = new Week(marked(db), home);
  try {
    days.forEach((day, i) => liveDay(w, day, i));
  } finally {
    w.close();
  }
  const counts: Partial<Record<HistoryKind, number>> = {};
  const since = Date.parse(`${days[0]}T00:00:00Z`) - db.offsetMinutes * 60_000 - DAY_MS;
  for (const r of db.list({ since, limit: 10_000_000 })) if ((r.data as { synthetic?: unknown } | null)?.synthetic === true) counts[r.kind] = (counts[r.kind] ?? 0) + 1;
  const today = addDays(o.end, 1);
  return {
    days, counts, versions: [seed, ...w.reflections.map((r) => r.version)], latest: w.reflections.at(-1)!,
    today: { day: today, version: db.pinnedMemory(today) ?? db.memoryFor(today)?.version ?? null }, cleared,
  };
}

/** 명령줄. 기록 DB는 RUNTIME_DIR/noonchi.db, 날짜는 HISTORY_TZ_MINUTES 시간대. */
export function main(argv: string[], env: Record<string, string | undefined>, log: (line: string) => void = console.log): SeedResult | ReturnType<HistoryDb["removeSynthetic"]> {
  const arg = (k: string) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : undefined; };
  const path = join(env.RUNTIME_DIR?.trim() || DEFAULT_RUNTIME_DIR, "noonchi.db");
  const db = HistoryDb.open(path, historyTzMinutes(env));
  try {
    if (argv.includes("--clear")) {
      const r = db.removeSynthetic();
      log(`합성 기록을 지웠어요: 줄 ${r.events}개, 기억 판본 ${r.memories}개, 날 고정 ${r.pins}개 (${path})`);
      return r;
    }
    const end = arg("--end") ?? addDays(db.dayOf(Date.now()), -1);
    const r = seedHistory(db, { home: arg("--home") ?? (env.HOME_ID?.trim() || "mokryeon_180b"), end, days: Number(arg("--days") ?? 7), twinDir: env.TWIN_STUDIO_DIR });
    if (r.cleared.events) log(`앞서 넣은 합성 기록 ${r.cleared.events}줄을 지웠어요`);
    log(`합성 기록을 넣었어요: ${r.days[0]} ~ ${r.days.at(-1)} (${path})`);
    log(`  ${Object.entries(r.counts).map(([k, v]) => `${k} ${v}`).join(", ")}`);
    log(`  기억 판본 ${r.versions[0]}~${r.latest.version}판, 마지막 ${r.latest.version}판은 ${r.latest.appliesDay}부터`);
    if (r.latest.appliesDay !== r.today.day) log(`  오늘(${r.today.day}) 판단은 이미 기억 ${r.today.version}판으로 정해서 합성 기억은 ${r.latest.appliesDay}부터 써요`);
    log("  지우기: npx tsx scripts/seed-history.ts --clear");
    return r;
  } finally {
    db.close();
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  dotenv.config({ quiet: true });
  try {
    main(process.argv.slice(2), process.env);
  } catch (e) {
    console.error(`합성 기록을 넣지 못했어요: ${(e as Error).message}`);
    process.exit(1);
  }
}
