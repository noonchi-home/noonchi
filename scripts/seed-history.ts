// 합성 기록 넣기: 한 사람이 사는 집(기본 한양목련 180B)의 지난 며칠(기본 7일, 어제까지)을 기록 DB(RUNTIME_DIR/noonchi.db)에 넣는다.
// 실시험 판단이 기댈 지난 기록(하루 요약·판단 기록·반성·기억 판본)을 만든다. PAM·OpenAI를 부르지 않는다.
// 서버와 같은 길로 쓴다: 관찰(World State 글)·판단·계획(PlanHub, 에이전트가 낼 도구 호출 대본을 같은 계획 검사 PlanDraft에 넣음)·실행 추적(ExecutionTracker: 실제 폰 명령·승인)을 기록기(attachRecorder)가 적고,
// 피드백·반성 줄은 서버와 같은 글로 HistoryDb.add, 판단 기억은 memoryForDay, 기억 판본은 saveMemory로 쓴다. 관찰 텍스트는 textFromWorld가 만든다.
// 방·면·가전 이름은 집 자료(twin/)에서 가져온다. VLM 요약은 지금 VLM 답처럼 영어 한 문장이다.
// 줄마다 data.synthetic = true, 기억 판본은 source synthetic을 단다. --clear는 그것만 지운다(HistoryDb.removeSynthetic). 다시 넣으면 앞 합성 기록을 지우고 넣는다.
//   npx tsx scripts/seed-history.ts [--home mokryeon_180b] [--end YYYY-MM-DD] [--days 7]
//   npx tsx scripts/seed-history.ts --clear
// 서버는 판단·요청마다 기록 DB를 읽으므로 다시 켜지 않아도 된다. 오늘 판단이 이미 기억 판본을 정했으면 합성 기억은 다음 날부터 쓴다.
// 이야기(2026-11-18 확정): 날마다 아침 커피 뒤 한 번 컵을 두고 떠나고, 1·2일째는 묻고(답 「치워 주세요」 → 컵 치우기), 둘째 밤 채택 검사를 지나 3일째부터 바로 치운다.
// 말없이 에어컨: 1일째 「아 덥다」는 클로이드가 켜고, 2·3일째 사람이 말없이 켜고, 셋째 밤 통과해 4일째부터 TV를 보기 시작하면 클로이드가 켠다.
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import dotenv from "dotenv";
import { checkPlan } from "../src/act/check.js";
import { EXEC_TEXT } from "../src/act/labels.js";
import { planIdOf, targetOf, TASK_NAMES, TASKS } from "../src/act/tasks.js";
import { PlanDraft, type PlanResult } from "../src/agent/planTools.js";
import { ExecutionTracker } from "../src/act/track/tracker.js";
import { memoryApprovals } from "../src/agent/approval.js";
import { ANY_STATE, CUP_FSM_MEMORY, CUP_TASKS, fsmStep, isoWithOffset, validateMemory, type FsmMemory } from "../src/brain/decision.js";
import { adoptKey, adoptedFsm, checkCandidate, type CheckDay } from "../src/brain/pam/adopt.js";
import type { BrainLog, DecisionRecord } from "../src/contract/events.js";
import type { CandidateFsm } from "../src/contract/pam.js";
import type { PlanView, XZ } from "../src/contract/plan.js";
import type { ControlMode } from "../src/contract/setup.js";
import type { Facet, ObjClass, WorldChange, WorldChangeKind, WorldEye, WorldFact, WorldObject, WorldPerson, WorldView } from "../src/contract/world.js";
import { HistoryDb, historyTzMinutes, type HistoryKind } from "../src/brain/history/db.js";
import { FEEDBACK_TEXT, REFLECT_TEXT } from "../src/brain/history/labels.js";
import { attachRecorder, topic, type DeviceNote } from "../src/brain/history/recorder.js";
import { memoryForDay } from "../src/brain/history/reflect.js";
import { isDay } from "../src/brain/history/summary.js";
import type { DeviceState } from "../src/contract/devices.js";
import { loadTwin } from "../src/layout/twin-files.js";
import { loadScene } from "../src/layout/scene.js";
import type { FloorPlan } from "../src/layout/floor.js";
import { PlanHub } from "../src/act/hub.js";
import { floorPlanFrom, roomNamedAt } from "../src/layout/route.js";
import { decisionWorld } from "../src/brain/decide.js";
import { CHANGE_TEXT, OBJECT_NAME, objectName, onSurface } from "../src/world/labels.js";
import { textFromWorld } from "../src/world/text.js";
import { NOW_FACETS, STATES, type StateKey } from "../src/world/vocab.js";
import { askSteps, cupSteps, planContext } from "../tests/helpers/planner.js";

const DEFAULT_RUNTIME_DIR = fileURLToPath(new URL("../runtime/", import.meta.url));
const DAY_MS = 86_400_000;
const addDays = (day: string, n: number) => new Date(Date.parse(`${day}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);

/** VLM 상태 → 면(낱말 표, src/world/state/facts.ts와 같다). */
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
  // 에어컨 습관 기록은 「에어컨 켜기」 할 일이 다루는 가전 종류(TaskSpec devices)에 쌓는다
  const acKinds: readonly string[] = TASKS["에어컨 켜기"].allow.devices?.kinds ?? [];
  const acs = twin.devices.filter((d) => acKinds.includes(d.kind) && d.twinAttrs.power);
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
  /** 마지막으로 분석한 엔진 프레임 시각(World State frame_ms). */
  private frameAt: number | null = null;
  private plans!: PlanHub;
  private tracker!: ExecutionTracker;
  /** 그날 장면이 따르는 기억(판단 기록의 사람 상태·화살표를 이 기억으로 만든다). */
  private story: FsmMemory = CUP_FSM_MEMORY;
  readonly reflections: { version: number; appliesDay: string }[] = [];

  /** seedOnly: 날마다 판본을 넣지 않는 주(memories none)의 seed 판본. 판단은 그 판본을 쓰고 그날 기억을 고정하지 않는다. */
  constructor(private readonly db: HistoryDb, readonly home: HomeInfo, private readonly seedOnly: number | null = null) {
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

  /** 서버를 켠다: World State·판단 번호·계획·실행 추적을 새로 둔다. 가전 시작 상태는 적지 않고 기억만 한다. story: 그날 장면이 따르는 기억. */
  boot(day: string, hms: string, story: FsmMemory): void {
    this.day = day;
    this.story = story;
    this.at(hms);
    Object.assign(this, { seq: 0, frame: 0, objects: new Map(), counters: new Map(), recent: [], summary: "", vlmMissing: 0 });
    this.person = { visible: false, since_ms: this.t, last_seen_ms: null, count: 0, room: null, room_label: null, position: null, near: [], holding: [], position_ms: null, answered_ms: null, facts: {} };
    this.plans = new PlanHub(this.home.fp, (m) => { if (m.type === "plan" && m.plan) this.plansOut.emit(m.plan); }, () => new Date(this.t).toISOString());
    this.tracker = new ExecutionTracker({
      plans: this.plans,
      approvals: this.approvals,
      clock: { now: () => this.t },
      check: (d, p) => checkPlan({ decision: d, tasks: [...CUP_TASKS], plan: p, world: this.view(), nowMs: this.t, staleMs: 3000, mode: "test" }),
      // OpenAI를 부르지 않으므로 에이전트가 낼 도구 호출(컵 치우기 네 단계·물어보기)을 같은 계획 검사(PlanDraft)에 넣는다
      planner: (d) => this.plan(d),
      state: {
        view: () => this.view(),
      },
      layout: {
        floor: () => this.plans.floor(),
      },
      phone: {
        toPhone: () => {},
      },
      brain: {
        // 묻기 답 「치워 주세요」 → 말 부탁(컵 치우기) 판단을 서버처럼 판단 기록에 남긴다(src/brain/decide.ts logSpeech)
        sentSeq: () => this.seq,
        onSpeech: (d) => this.brain.emit({
          type: "decision", at_ms: this.t, id: d.id, seq: d.seq, text_sent: d.textSent, status: d.status, prediction: d.prediction, action: d.action, fsm: null,
          memory_version: d.memoryVersion, world: d.world, ...(d.source ? { source: d.source } : {}), ...(d.via ? { via: d.via } : {}),
        }),
      },
      goals: {},
      manager: {},
      observe: {},
      events: {
        emit: (l) => this.brain.emit(l),
      },
      appliances: {},
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

  /** 클로이드가 판단(planId)의 가전 명령을 한다: 그 계획의 실행 기록(판단 → 실행 중 → 완료)과 가전 바뀜. 밤 흐름이 로봇이 한 구간(못 봄)으로 센다. */
  robotDevice(planId: string, d: Device, attr: string, to: unknown): void {
    const run = (state: "decided" | "running" | "done") => this.brain.emit({ type: "execution", at_ms: this.t, plan_id: planId, state, text: EXEC_TEXT[state] });
    run("decided");
    run("running");
    this.wait(4);
    this.device(d, attr, to);
    run("done");
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
      fixtures: [], devices: [], eye: this.eyeView, frame_ms: this.frameAt, vlm_missing: this.vlmMissing, yolo_missing: 0,
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
      first_seen_ms: this.t, last_seen_ms: this.t, last_in_view_ms: this.t, facts: {}, answered_ms: null, devices: [], closer_hold: false, followed_by: null,
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
      this.frameAt = this.t;
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
    this.frameAt = this.t;
    this.vlmMissing++;
    this.brain.emit({ type: "observe", at_ms: this.t, frame_id: `e${++this.frame}`, captured_at_ms: this.t - 1200, yolo: null, vlm: null, vlm_missing: reason });
  }

  /** PAM 판단 하나: 지금 World State 관찰 텍스트 + 그날 기억 판본 + 행동 목록. 답(사람 상태 state·일어난 화살표 edge·observation·reasoning)은 시나리오가 정하고,
   *  행동은 그 화살표의 행동이어야 한다(그날 기억을 따른다). track false: 실행 추적에 넘기지 않는다(컵 대본이 아닌 판단, 그 결과는 부른 쪽이 기록한다). */
  decide(action: string | null, observation: string, reasoning: string, o: { state: string; edge?: { from: string; next: number }; track?: boolean }): string {
    this.wait(0.25);
    const atMs = this.t;
    const view = this.view();
    const textSent = textFromWorld(view, this.recent, { nowMs: atMs, offsetMinutes: this.db.offsetMinutes });
    const mem = this.seedOnly !== null ? { version: this.seedOnly } : memoryForDay(this.db, this.day);
    const seq = ++this.seq;
    // 판단은 돕는 방식 자동처럼 모든 행동 가운데 고른다(앞 둘의 순서는 컵 행동과 같다)
    const tasks: string[] = [...TASK_NAMES];
    const prediction = { observation, reasoning, task_index: action === null ? -1 : tasks.indexOf(action), state: o.state, from: o.edge?.from ?? null, next_index: o.edge?.next ?? -1 };
    const fsm = fsmStep(this.story, prediction);
    if (fsm.action !== action) throw new Error(`${this.stamp()}: 판단 ${action ?? "대기"}가 그날 기억의 화살표 행동(${fsm.action ?? "없음"})과 달라요`);
    const d: DecisionRecord = {
      id: `pam-${seq}`, seq, atMs, textSent, finalTime: isoWithOffset(atMs, this.db.offsetMinutes), status: "valid", prediction, action,
      memoryVersion: mem.version, world: decisionWorld(view), fsm,
    };
    this.wait(1.9);
    this.brain.emit({ type: "decision", at_ms: this.t, id: d.id, seq, text_sent: textSent, status: "valid", prediction, action, fsm, memory_version: mem.version, world: d.world });
    if (o.track !== false) this.tracker.onDecision(d);
    return planIdOf(d.id);
  }

  /** 실제 폰이 들은 말(답이 아닌 혼잣말): 관찰 텍스트 한 줄이 된다. 합성 기록에는 그 말을 그대로 남긴다. */
  heard(text: string): void {
    this.wait(1);
    this.change("heard", PERSON, CHANGE_TEXT.heard(text), true);
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

  /** 실제 폰 답 단추(src/server/home/phone.ts onChoice와 같다). waited: 이미 정한 시각으로 옮겨 두었다(3초 기다리지 않는다). */
  tap(choice: string, o: { waited?: boolean } = {}): void {
    if (!o.waited) this.wait(3);
    const open = this.open();
    const picked = open.choices.find((c) => c.id === choice);
    if (!picked || !this.tracker.onAnswer(open.planId, open.stepId, choice)) throw new Error(`${this.stamp()}: ${choice} 답을 받지 않았어요`);
    this.db.add("feedback", this.t, FEEDBACK_TEXT.answer(picked.label, open.kind, open.text), { subject: open.planId, data: { choice, via: "button" } });
  }

  /** 실제 폰이 들은 말(src/server/home/phone.ts onAnswer와 같다). 새 폰처럼 말할 때 떠 있던 지금 명령을 at으로 싣는다. */
  say(text: string): void {
    this.wait(3);
    const open = this.open();
    const heard = this.tracker.onHeard(text, { kind: "command", id: open.planId, step: open.stepId, pending: [] });
    if (heard?.kind !== "answer") throw new Error(`${this.stamp()}: 「${text}」를 답으로 받지 않았어요`);
    this.db.add("feedback", this.t, FEEDBACK_TEXT.answer(text, open.kind, open.text), { subject: open.planId, data: { choice: heard.choice.id, via: "voice" } });
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

/** 마시는 중에서 떠나는 seed 묻기 화살표의 on(합성 컵 치우기 후보의 사건). */
export const LEAVE_ON = CUP_FSM_MEMORY.states.find((s) => s.id === "drinking")!.next.find((e) => e.to === ANY_STATE)!.on;
/** 데모 「2-습관」: 말없이 TV를 보기 시작하면 에어컨(배우는 습관, 사용자 답 2026-11-19). 자리에 없음 → TV 보는 중 seed 진입 화살표의 on(「사용자가 돌아와 TV를 본다.」). */
export const TV_START_ON = CUP_FSM_MEMORY.states.find((s) => s.id === "away")!.next.find((e) => e.to === "watching_tv")!.on;
/** 합성 반성이 내는 후보 FSM: seed 모양에 마시는 중 → * 컵 치우기 후보 하나(seed 묻기 화살표와 같은 on)와
 *  자리에 없음 → TV 보는 중 에어컨 켜기 후보 하나(seed 진입 화살표와 같은 on). 같은 사건은 한 상태에 한 번이라 후보가 그 진입 화살표 자리를 맡는다
 *  (로봇 FSM은 seed 화살표를 그대로 두고 통과한 후보만 그 자리에 붙인다, adoptedFsm). */
export const SYNTH_CANDIDATES: CandidateFsm = {
  initial_state: CUP_FSM_MEMORY.initial_state,
  states: CUP_FSM_MEMORY.states.map((s) => ({
    id: s.id, description: s.description, activity: [...s.activity],
    next: s.next.filter((e) => !e.action && !(s.id === "away" && e.on === TV_START_ON)).map(({ to, on }) => ({ to, on })),
    rules: s.id === "drinking" ? [{ to: ANY_STATE, action: "컵 치우기", candidates: [{ on: LEAVE_ON }] }]
      : s.id === "away" ? [{ to: "watching_tv", action: "에어컨 켜기", candidates: [{ on: TV_START_ON }] }] : [],
  })),
};
const KEYS = { clear: adoptKey("drinking", "컵 치우기", { on: LEAVE_ON }), aircon: adoptKey("away", "에어컨 켜기", { on: TV_START_ON }) } as const;

/** 날마다 장면의 정한 때(기록 시간대 시:분:초). 셈이 보는 때(떠남·답·외출·TV 시작·사람이 켠 에어컨)는 이 시각에 맞춰 둔다(weekMarks가 같은 표를 읽는다).
 *  평일은 7시쯤 커피 뒤 떠나고 8시 30분쯤 나가 밖에서 먹고 돌아와 바로 TV, 금요일은 21시쯤 돌아온다. 주말은 늦게 일어나 낮에 나갔다 저녁에 돌아온다. */
export function dayTimes(day: string, i: number) {
  const dow = new Date(`${day}T00:00:00Z`).getUTCDay();
  const weekend = dow === 0 || dow === 6;
  const base = weekend
    ? { boot: "08:20:00", bedOff: "08:24:30", coffee: "08:41:12", leaveSee: "09:25:30", out: "11:50:20", tv: "19:41:30" }
    : { boot: "06:50:00", bedOff: "06:55:10", coffee: "07:02:14", leaveSee: "07:40:30", out: "08:28:40", tv: dow === 5 ? "21:14:00" : "19:44:00" };
  const sec = (hms: string) => { const [h, m, x] = hms.split(":").map(Number); return h! * 3600 + m! * 60 + x!; };
  const hms = (s: number) => new Date(s * 1000).toISOString().slice(11, 19);
  const leave = sec(base.leaveSee) + 4;
  const tv = sec(base.tv);
  return {
    weekend, ...base, tea: "22:41:15", end: "23:04:30", bedOn: "23:12:40", reflect: "23:30:00",
    /** 커피 뒤 사람이 컵을 두고 떠난 때(떠나는 프레임 두 장 뒤). 1·2일째 「치워 주세요」 답은 그 26초 뒤. 외출 문을 나선 때. */
    leave: hms(leave), answer: hms(leave + 26), gone: hms(sec(base.out) + 30),
    /** 2·3일째 사람이 말없이 거실 에어컨을 켜는 때(TV 시작 40·50초 뒤). 아니면 null. */
    personAc: i === 1 || i === 2 ? hms(tv + 30 + 10 * i) : null,
  };
}
/** 로봇이 그 일을 한 구간(못 봄)으로 보는 길이(초): 컵 치우기 네 단계·에어컨 켜기가 다 드는 길이. */
const ROBOT_SPAN_S = { clear: 120, aircon: 60 } as const;
/** weekMarks가 날짜를 받지 않으면 쓰는 주(월~일). 셈(n·k·못 봄)은 요일과 상관없다. */
const WEEK_REF = ["2026-11-02", "2026-11-03", "2026-11-04", "2026-11-05", "2026-11-06", "2026-11-07", "2026-11-08"];

/** 합성 n일치 채택 검사 입력(장면 표 dayTimes에서 바로 뽑음, 모델 안 부름). 시각은 자정부터 초, 하루 창은 켠 때부터 반성 때까지.
 *  clear: 후보 = 아침 커피 뒤 떠난 때, 행동·답 = 1·2일째 「치워 주세요」 답 때, 안 보인 구간 = 집에 없는 때 + 3일째부터 로봇이 치운 구간.
 *  aircon: 후보 = 집에 돌아와 소파에서 TV를 보기 시작한 때(자리에 없음에서), 행동 = 2·3일째 사람이 거실 에어컨을 켠 때,
 *  안 보인 구간 = 집에 없는 때 + 로봇이 거실 에어컨을 켠 구간(1일째 「아 덥다」, 4일째부터 배운 화살표). */
export function weekMarks(n: number, which: "clear" | "aircon" = "clear", days: readonly string[] = WEEK_REF): CheckDay[] {
  if (n > days.length) throw new Error(`weekMarks: ${n}일치를 만들 날이 ${days.length}일뿐이에요`);
  const sec = (hms: string) => { const [h, m, x] = hms.split(":").map(Number); return h! * 3600 + m! * 60 + x!; };
  return days.slice(0, n).map((day, i) => {
    const t = dayTimes(day, i);
    const absent: [number, number] = [sec(t.gone), sec(t.tv)];
    const day0 = { start: sec(t.boot), end: sec(t.reflect) };
    if (which === "clear") {
      const leave = sec(t.leave);
      const asked = i < 2 ? [sec(t.answer)] : [];
      return { ...day0, candidate: [leave], action: asked, answered: asked, unseen: [absent, ...(i >= 2 ? [[leave, leave + ROBOT_SPAN_S.clear] as [number, number]] : [])] };
    }
    const tv = sec(t.tv);
    const robot = i === 0 || i >= 3;
    return { ...day0, candidate: [tv], action: t.personAc ? [sec(t.personAc)] : [], unseen: [absent, ...(robot ? [[tv, tv + ROBOT_SPAN_S.aircon] as [number, number]] : [])] };
  });
}

/** i번째 날(0부터) 밤 반성이 남기는 로봇 FSM. 상태는 seed 넷 그대로이고 배우는 화살표는 채택 검사(src/brain/pam/adopt.ts)가 정한다:
 *  컵 치우기는 둘째 밤(i = 1)에 통과해 3일째부터, 말없이 에어컨은 셋째 밤(i = 2)에 통과해 4일째부터.
 *  시간 습관(평일 7시 커피, 밤에는 묻지 않기)은 설명에만 적는다. */
export function memoryAfter(i: number, h: { table: { label: string } }): FsmMemory {
  const passed = new Set((["clear", "aircon"] as const).filter((w) => checkCandidate(weekMarks(i + 1, w)).passed).map((w) => KEYS[w]));
  const m = adoptedFsm(SYNTH_CANDIDATES, passed, CUP_FSM_MEMORY);
  const state = (id: string) => m.states.find((s) => s.id === id)!;
  if (i >= 1) state("drinking").description += ` ${i >= 5 ? "평일 7시쯤, 주말 8시 40분쯤" : "평일 7시쯤"} 일어나 ${h.table.label}에서 커피를 마신다.`;
  if (i >= 1) state("away").description = `평일 8시 30분쯤부터 저녁까지 사용자가 집에 없다.${i >= 4 ? " 금요일에는 21시쯤 돌아오기도 한다." : ""} 22시가 넘으면 폰으로 묻지 않기를 바란다.`;
  return validateMemory(m, "fsm") as FsmMemory;
}

/** 그날 장면이 따르는 기억: 1일째 seed, 그 뒤는 전날 밤 반성이 남긴 기억(scripted 판본과 같다. memories none이어도 장면 이야기는 같다). */
const storyMemory = (i: number, h: { table: { label: string } }): FsmMemory => (i === 0 ? CUP_FSM_MEMORY : memoryAfter(i - 1, h));

/** 아침 커피: 앉아 마시다 컵을 두고 떠난다(하루 한 번). 1·2일째는 떠날 때 묻고 「치워 주세요」 답 뒤 치우고, 3일째부터는 바로 치운다. */
function morning(w: Week, i: number, t: ReturnType<typeof dayTimes>): void {
  const { table } = w.home;
  w.at(t.coffee);
  w.personIn();
  w.see("A person stands next to the dining table.", { person: ["standing"] }, 2);
  w.decide(null, "사람이 식탁 옆에 서 있고 식탁 위에는 아무것도 없다.", "아침 커피를 막 시작하는 때라 지금 도울 일이 없다.", { state: "away" });
  w.wait(140);
  const cup = w.put("cup", table);
  w.see("A person sits at the dining table with a mug of coffee.", { person: ["sitting", "drinking"], [cup]: ["on_table", "has_contents"] }, 3);
  w.decide(null, "사람이 식탁에 앉아 컵으로 커피를 마시고 있다.", "자리에 없다가 마시는 중으로 넘어갔고 컵을 쓰는 중이라 기다린다.", { state: "drinking", edge: { from: "away", next: 0 } });
  if (i % 3 === 2) { // 가끔 VLM 답이 늦는다
    w.wait(300);
    w.missing("timeout");
    w.missing("timeout");
  }
  w.wait(t.weekend ? 1500 : 900);
  w.see("A person sits at the dining table drinking from a mug.", { person: ["sitting", "drinking"], [cup]: ["on_table", "has_contents"] }, 2);
  w.at(t.leaveSee);
  w.see("A person puts the mug down and stands up.", { person: ["standing"], [cup]: ["on_table", "empty"] }, 2);
  w.personOut();
  const leave = { state: "away", edge: { from: "drinking", next: 0 } };
  if (i < 2) {
    w.decide("사용자에게 물어보기", "사람이 컵을 두고 식탁을 떠났다.", "마시는 중에서 떠나는 화살표대로 컵을 치울지 묻는다.", leave);
    w.start("An empty mug is on the dining table.", { [cup]: ["on_table", "empty"] });
    w.at(t.answer);
    w.tap("clear", { waited: true });
    w.start("An empty mug is on the dining table.", { [cup]: ["on_table", "empty"] });
  } else {
    w.decide("컵 치우기", "사람이 컵을 두고 식탁을 떠났다.", "마시는 중에서 떠나는 화살표대로 두고 간 컵을 싱크대로 치운다.", leave);
    w.start("An empty mug is on the dining table.", { [cup]: ["on_table", "empty"] });
  }
  w.clearCup(cup, i === 0 ? { sink: "tap" } : i === 2 ? { table: "다 했어" } : {});
}

/** 외출: 식탁 옆을 지나 나간다(밖에서 먹고 TV를 보러 돌아온다). */
function away(w: Week, t: ReturnType<typeof dayTimes>): void {
  w.at(t.out);
  w.personIn();
  w.see("A person in a coat walks past the dining table.", { person: ["standing"] }, 2);
  w.decide(null, "외출 옷을 입은 사람이 식탁 옆을 지나간다.", "식탁에 치울 컵이 없어 기다린다.", { state: "away" });
  w.at(t.gone);
  w.personOut();
  w.see("The dining table is clear.", {}, 2);
  w.decide(null, "사람이 현관 쪽으로 나가 보이지 않는다.", "자리에 없음이라 지금 도울 일이 없다.", { state: "away" });
}

/** 돌아와 바로 TV(자리에 없음 → TV 보는 중)와 거실 에어컨. 폰은 소파 쪽을 본다. 1일째는 「아 덥다」 말을 듣고 클로이드가 켜고(덥다 화살표),
 *  2·3일째는 사람이 말없이 스스로 켜고(판단은 대기), 4일째부터는 배운 화살표(자리에 없음 → TV 보는 중)로 클로이드가 켠다.
 *  TV를 보며 거실 테이블에 찻잔을 두고 마시다, 끝나면 에어컨을 끄고 찻잔을 들고 침실로 간다(치우기 아님). */
function tv(w: Week, i: number, t: ReturnType<typeof dayTimes>): void {
  const { side, livingAc } = w.home;
  w.at(t.tv);
  w.eye(w.home.eye.sofa);
  w.personIn();
  w.see("A person sits on the sofa watching TV.", { person: ["sitting", "watching_tv"] }, 3);
  const start = { state: "watching_tv", edge: { from: "away", next: 1 } };
  if (i >= 3) {
    const plan = w.decide("에어컨 켜기", "사람이 돌아와 거실 소파에 앉아 TV를 본다.", "자리에 없다가 TV를 보기 시작하면 에어컨을 켜는 화살표대로 거실 에어컨을 켠다.", { ...start, track: false });
    w.robotDevice(plan, livingAc, "power", "on");
  } else {
    w.decide(null, "사람이 돌아와 거실 소파에 앉아 TV를 본다.", "자리에 없다가 TV 보는 중으로 넘어갔고 지금 도울 일이 없다.", start);
    if (i === 0) {
      w.wait(12);
      w.heard("아 덥다");
      const plan = w.decide("에어컨 켜기", "사람이 거실 소파에서 TV를 보다가 덥다고 말했다.", "덥다고 말해서 TV 보는 중 화살표대로 거실 에어컨을 켠다.", { state: "watching_tv", edge: { from: "watching_tv", next: 1 }, track: false });
      w.robotDevice(plan, livingAc, "power", "on");
    } else {
      w.at(t.personAc!);
      w.device(livingAc, "power", "on");
    }
  }
  w.at(t.tea);
  const tea = w.put("cup", side);
  w.see("A person sits on the sofa holding a cup of tea.", { person: ["sitting", "watching_tv", "holding_object"], [tea]: ["on_table", "has_contents"] }, 3);
  w.decide(null, "사람이 소파에서 TV를 보며 컵으로 차를 마시고 있다.", "TV 보는 중이고 컵을 쓰는 중이라 기다린다.", { state: "watching_tv" });
  w.at(t.end);
  w.device(livingAc, "power", "off");
  w.wait(90);
  w.see("A person stands up from the sofa holding a cup of tea.", { person: ["standing", "holding_object"], [tea]: ["in_hand"] }, 2);
  w.personOut();
  w.gone(tea);
  w.decide(null, "사람이 찻잔을 들고 거실을 떠났다.", "찻잔을 들고 갔고 남은 컵이 없어 기다린다.", { state: "away" });
}

/** 하루: 아침 커피, 외출, 돌아와 TV, 23시 30분쯤 잔다. */
function liveDay(w: Week, day: string, i: number, o: { scripted: boolean }): void {
  const t = dayTimes(day, i);
  w.boot(day, t.boot, storyMemory(i, w.home));
  if (i === 0) {
    w.wait(5);
    w.mode("test");
  }
  w.at(t.bedOff);
  w.device(w.home.bedAc, "power", "off");
  morning(w, i, t);
  away(w, t);
  tv(w, i, t);
  w.at(t.bedOn);
  w.device(w.home.bedAc, "power", "on");
  w.at(t.reflect);
  if (o.scripted) w.reflect(memoryAfter(i, w.home));
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
  /** scripted: 날마다 그날 밤 반성이 남길 판본(memoryAfter)과 반성 줄을 넣는다. none: seed 판본 하나만 넣고 날마다 판본·반성 줄·날 고정을 넣지 않는다(실제 반성을 이어 돌릴 때). 기본 scripted. */
  memories?: "scripted" | "none";
}

export interface SeedResult {
  days: string[];
  /** 넣은 줄 수(종류별). */
  counts: Partial<Record<HistoryKind, number>>;
  /** 넣은 기억 판본(첫 판은 컵 FSM seed). */
  versions: number[];
  /** 마지막 합성 기억 판본과 쓰기 시작하는 날(memories none이면 null). */
  latest: { version: number; appliesDay: string } | null;
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
  const scripted = (o.memories ?? "scripted") === "scripted";
  const w = new Week(marked(db), home, scripted ? null : seed);
  try {
    days.forEach((day, i) => liveDay(w, day, i, { scripted }));
  } finally {
    w.close();
  }
  const counts: Partial<Record<HistoryKind, number>> = {};
  const since = Date.parse(`${days[0]}T00:00:00Z`) - db.offsetMinutes * 60_000 - DAY_MS;
  for (const r of db.list({ since, limit: 10_000_000 })) if ((r.data as { synthetic?: unknown } | null)?.synthetic === true) counts[r.kind] = (counts[r.kind] ?? 0) + 1;
  const today = addDays(o.end, 1);
  return {
    days, counts, versions: [seed, ...w.reflections.map((r) => r.version)], latest: w.reflections.at(-1) ?? null,
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
    if (r.latest) {
      log(`  기억 판본 ${r.versions[0]}~${r.latest.version}판, 마지막 ${r.latest.version}판은 ${r.latest.appliesDay}부터`);
      if (r.latest.appliesDay !== r.today.day) log(`  오늘(${r.today.day}) 판단은 이미 기억 ${r.today.version}판으로 정해서 합성 기억은 ${r.latest.appliesDay}부터 써요`);
    }
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
