// 미리 세운 목표(src/goal/watch.ts): 사람이 컵을 쓰는 것을 보면 습관 FSM 한 걸음 앞의 「컵 치우기」를 목표로 세우고 계획을 미리 만들어 둔다.
// 사람이 떠나면 판단을 바로 부르게 하고, PAM이 같은 행동을 고르면 미리 만든 계획을 다시 검사해 첫 명령을 낸다(계획 모드를 다시 부르지 않는다).
// 계획 모델은 같은 주소 자리의 가짜 OpenAI 서버(tests/helpers/planner.ts), 시계는 시험 시계(clock.t)다. smallFloor: 식탁 table_1 [7, 3], 싱크대 sink_1 [5, 1].
import { testTracker, type TrackerFixture } from "./helpers/tracker-ports.js";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { TrackCore } from "../src/act/track/core.js";
import { PlanHub } from "../src/act/hub.js";
import { checkPlan } from "../src/act/check.js";
import { tasksFor } from "../src/act/tasks.js";
import { APPROVAL_TEXT, CHECK_TEXT, EXEC_TEXT, FIND_TEXT, USE_THOUGHT } from "../src/act/labels.js";
import { Decider } from "../src/brain/decide.js";
import { Trigger } from "../src/world/trigger.js";
import { pamClientFor, startFakePamLlm } from "./helpers/pam.js";
import { ApprovalStore } from "../src/agent/approval.js";
import { resubmit, type PlanAhead } from "../src/agent/planTools.js";
import type { PlanResult } from "../src/agent/index.js";
import { CUP_FSM_MEMORY, type FsmMemory } from "../src/brain/decision.js";
import { LEARNED_FSM_MEMORY } from "../scripts/learned-memory.js";
import type { BrainLog, DecisionRecord } from "../src/contract/events.js";
import type { PendingGoal } from "../src/contract/goal.js";
import type { PlannedCommandMessage } from "../src/contract/phone.js";
import type { WorldObject, WorldSighting, WorldView } from "../src/contract/world.js";
import type { PlaneSurface } from "../src/world/index.js";
import { POSE_FALL } from "../src/world/vocab.js";
import { smallFloor } from "./helpers/floor.js";
import { cupSteps, fillSteps, idsFrom, planCalls, planContext, planTurn, startFakePlanner, testPlanner, type FakePlanner } from "./helpers/planner.js";
import { SMALL_SCENE } from "./helpers/floor.js";
import { floorPlanFrom } from "../src/layout/route.js";
import type { FloorPlan } from "../src/layout/floor.js";
import { HomeTrace } from "../src/server/home/trace.js";

let llm: FakePlanner;
beforeAll(async () => { llm = await startFakePlanner(); });
afterAll(async () => { await llm.close(); });

const NOONCHI = tasksFor("noonchi");
const PLACES: Record<string, { label: string; position: [number, number, number] }> = {
  table_1: { label: "식탁", position: [7, 0.75, 3] }, sink_1: { label: "싱크대", position: [5, 0.9, 1] }, fridge_1: { label: "냉장고", position: [7.5, 0.9, 0.5] },
};
/** 냉장고(fridge_1 [7.5, 0.5])를 더한 작은 평면도(채워 주기 계획). */
const fridgeFloor = (): FloorPlan => floorPlanFrom({ ...structuredClone(SMALL_SCENE), objects: [...structuredClone(SMALL_SCENE.objects), { id: "fridge_1", type: "fridge", room: "kitchen", plan: { position: [7.5, 0.5] } }] });
const fact = (value: string, at: number) => ({ value, at_ms: at, since_ms: at, certainty: "confirmed" as const });
/** 식탁 위 컵. place in_hand면 면 없음. */
const cupOn = (o: { id?: string; place?: string; seen: number; surface?: string | null; status?: WorldObject["status"]; followed_by?: string | null; position?: [number, number, number] }): WorldObject => ({
  id: o.id ?? "cup_1", cls: "cup", position: o.position ?? [7, 0.75, 3], surface: o.surface === undefined ? (o.place === "in_hand" ? null : "t") : o.surface, surface_label: "식탁", room: "hall", error_m: 0.1,
  status: o.status ?? "present", first_seen_ms: 0, last_seen_ms: o.seen, last_in_view_ms: o.seen, facts: { place: fact(o.place ?? "on_table", o.seen) }, answered_ms: null, devices: [], closer_hold: false,
  followed_by: o.followed_by ?? null,
});
type Who = { act?: string; holding?: string[]; posture?: string } | null;
/** PAM 판단(사람이 떠난 뒤 컵 치우기, action null이면 대기). visible: 판단 때 집 상태에 사람이 보였는가(기본 안 보임). */
const pam = (id: string, seq: number, atMs: number, action: string | null = "컵 치우기", visible = false): DecisionRecord => ({
  id, seq, atMs, textSent: "t", finalTime: "x", status: "valid", prediction: { observation: "사람이 컵을 두고 자리를 비움", reasoning: "습관대로 치운다", task_index: action ? NOONCHI.indexOf(action) : -1 },
  action, memoryVersion: 1, tasks: NOONCHI, world: { objects: [], person_visible: visible, vlm_missing: 0, yolo_missing: 0 },
});

/** 실행 추적 + 미리 세운 목표. person(who)로 사람을 바꾸고(나타나면 since_ms, 사라지면 그때가 since_ms), setObjects로 물건을 바꾼다.
 *  tick은 시계를 ms 움직이고, 있는 물건을 지금 본 것으로 고친 뒤 tracker.tick을 부른다. gone은 World State 사람 사라짐 변화처럼 onWorld를 부른다.
 *  승인 기억은 비어 있다(처음 하는 일): 목표로 시작한 실행은 묻지 않는다. */
function goalSetup(o: { over?: Partial<TrackerFixture>; state?: string | null; memory?: FsmMemory; objects?: WorldObject[]; where?: [number, number]; floor?: FloorPlan; trace?: HomeTrace } = {}) {
  const clock = { t: 10_000, now() { return this.t; } };
  let who: Who = null;
  let since = 0;
  let goneAt = 0;
  let objects: WorldObject[] = o.objects ?? [cupOn({ seen: clock.t })];
  let sightings: WorldSighting[] = [];
  const w = (): WorldView => {
    const facts = who
      ? { ...(who.act ? { activity: fact(who.act, clock.t) } : {}), ...(who.holding ? { holding: fact("holding_object", clock.t) } : {}), ...(who.posture ? { posture: fact(who.posture, clock.t) } : {}) }
      : {};
    return {
      at_ms: clock.t, objects, sightings, fixtures: [], devices: [], eye: null, frame_ms: clock.t, vlm_missing: 0, yolo_missing: 0,
      person: {
        visible: !!who, since_ms: who ? since : goneAt, last_seen_ms: who ? clock.t : null, count: who ? 1 : 0, room: null, room_label: null, position: o.where ?? null, near: [],
        holding: who?.holding ?? [], position_ms: o.where ? clock.t : null, answered_ms: null, facts,
      },
    };
  };
  const goals: PendingGoal[] = [];
  const thoughts: string[] = [];
  const logs: BrainLog[] = [];
  const phone: PlannedCommandMessage[] = [];
  let nudged = 0;
  const plans = new PlanHub(o.floor ?? smallFloor(), m => { if (m.type === "plan" && m.plan) o.trace?.plan(m.plan); }, () => "t");
  const planner = testPlanner(llm);
  const submittedCups: (string | undefined)[] = [];
  const approvals = new ApprovalStore(join(mkdtempSync(join(tmpdir(), "goal-")), "homes", "h", "approvals.json"), () => "t");
  const ctx = (d: DecisionRecord, ahead?: PlanAhead) => ({ ...planContext({ decision: d, world: w(), floor: plans.floor() }), ...(ahead ? { ahead } : {}) });
  const t = testTracker({
    plans, world: w, floor: () => plans.floor(), planGapMs: 0, approvals, clock, tasks: () => NOONCHI, locate: (id) => PLACES[id],
    planner: (d, signal, ahead) => {
      submittedCups.push(ahead?.object);
      return planner.plan(ctx(d, ahead), signal);
    },
    check: (d, p, seenSince) => checkPlan({ decision: d, tasks: NOONCHI, plan: p, world: w(), nowMs: clock.t, staleMs: 3000, mode: "test", ...(seenSince !== undefined ? { seenSince } : {}) }),
    reuse: (d, plan, rename) => resubmit(plan, ctx(d), rename),
    // 목표는 배운 화살표에서만 선다: 기본은 배운 뒤 기억(배우기 전 seed는 「배우기 전(seed) 기억이면…」 시험이 본다)
    habit: () => ({ memory: o.memory ?? LEARNED_FSM_MEMORY, kind: "fsm", state: o.state === undefined ? "drinking" : o.state, version: 1 }),
    trace: o.trace,
    onGoal: (g) => { goals.push(g); o.trace?.goal(g); }, nudge: () => { nudged++; }, thought: (text) => thoughts.push(text),
    toPhone: (m) => {
      phone.push(m);
      const step = m.type === "command" ? plans.current()?.steps.find(s => s.id === m.step) : undefined;
      if (m.type === "command" && step) o.trace?.command(m, step);
    },
    emit: (l) => logs.push(l), ...o.over,
  });
  let eye: [number, number] = [3, 1];
  /** 참이면 tick이 있는 물건을 지금 본 것으로 고치지 않는다(VLM 사진에 안 잡힘). */
  let frozen = false;
  t.onEye(eye);
  const tick = (ms = 250) => {
    clock.t += ms;
    if (!frozen) objects = objects.map((x) => (x.status === "present" ? { ...x, last_seen_ms: clock.t, last_in_view_ms: clock.t } : x));
    t.onEye(eye);
    t.tick();
  };
  const setEye = (at: [number, number]) => { eye = at; };
  const freeze = (on = true) => { frozen = on; };
  const person = (p: Who) => {
    if (p && !who) since = clock.t;
    if (!p && who) goneAt = clock.t;
    who = p;
  };
  /** 사람 사라짐이 집 상태에 반영된다. capturedAt: 떠난 것을 찍은 사진의 촬영 시각(집 상태 since_ms, 없으면 지금). */
  const gone = (capturedAt?: number) => {
    person(null);
    if (capturedAt !== undefined) goneAt = capturedAt;
    t.onWorld([{ kind: "person_gone", at_ms: clock.t, subject: "person", text: "사람 안 보임", meaningful: true }]);
  };
  const setObjects = (f: (xs: WorldObject[]) => WorldObject[]) => { objects = f(objects); };
  const setSightings = (xs: WorldSighting[]) => { sightings = xs; };
  const decide = async (d: DecisionRecord) => { t.onDecision(d); await t.idle(); };
  const commands = () => phone.flatMap((m) => (m.type === "command" ? [m] : []));
  const planCalls = () => llm.bodies().length;
  const states = () => goals.map((g) => `${g.status}/${g.prep}`);
  return { t, clock, tick, person, gone, setObjects, setSightings, setEye, freeze, goals, states, thoughts, logs, phone, commands, decide, planCalls, submittedCups, nudged: () => nudged, world: w, plans };
}

describe("식탁에서 떠난 뒤 새 활동 확인", () => {
  const setup = async (over: Partial<TrackerFixture> = {}) => {
    const evidence = { zone: "dining" as string | null, dining: ["dining"], surfaces: ["table_1"], rev: 7, watching: false, count: 1 };
    const s = goalSetup({ objects: [cupOn({ seen: 10_000, surface: "table_1" })], over: { meal: () => evidence, ...over } });
    s.person({ act: "drinking" });
    s.tick();
    await s.t.idle();
    s.gone();
    evidence.zone = null;
    s.tick();
    return { s, evidence };
  };
  it("떠난 지 16초 뒤에도 기다리고 같은 식사 구역·같은 활동에서만 거둔다", async () => {
    const { s, evidence } = await setup();
    s.tick(16_000);
    expect(s.goals.at(-1)?.status).toBe("checking");
    s.person({ act: "drinking" });
    for (const zone of [null, "sofa"]) {
      evidence.zone = zone;
      s.tick();
      expect(s.goals.at(-1)?.status).toBe("checking");
    }
    expect(s.commands()).toHaveLength(0);
    evidence.zone = "dining";
    s.tick();
    expect(s.goals.at(-1)?.reason).toBe("back");
  });
  it("처음 떠난 뒤 정확히 5분에 만료된다", async () => {
    const { s } = await setup();
    const end = s.goals.find(g => g.status === "checking")?.check_until_ms;
    expect(end).toBeTypeOf("number");
    s.tick(end! - s.clock.t - 1);
    expect(s.goals.at(-1)?.status).toBe("checking");
    s.tick(1);
    expect(s.goals.at(-1)?.reason).toBe("expired");
  });
  it("시청 근거를 본 PAM 답 한 번만 목표를 발동시킨다", async () => {
    const { s, evidence } = await setup();
    s.person({ act: "watching_tv" });
    Object.assign(evidence, { zone: "sofa", watching: true, rev: 12 });
    s.tick();
    const d = { ...pam("pam-watch", 2, s.clock.t, null, true), request_rev: 12,
      fsm: { state: "watching_tv", from: null, to: null, next_index: -1, on: null, when: null, action: null, learned:false } };
    expect(s.t.goalTrigger({...d, request_rev: 11})).toBeNull();
    expect(s.t.goalTrigger({...d, fsm:{...d.fsm, next_index:1}})).toBeNull();
    expect(s.t.goalTrigger(d)).toBe("컵 치우기");
    expect(s.t.goalTrigger(d)).toBeNull();
    await s.decide({...d, goal:true, action:"컵 치우기"});
    expect(s.commands()[0]?.text).toBe("식탁으로 가 주세요");
  });
  it("같은 사람인지 알 수 없으면 복귀나 TV 시청으로 보지 않고 처음 기한까지 기다린다", async () => {
    const {s,evidence} = await setup();
    const until = s.goals.at(-1)?.check_until_ms;
    s.person({act:"drinking"});
    Object.assign(evidence,{count:2,zone:"dining"});
    s.tick();
    Object.assign(evidence,{count:1,zone:"dining"});
    s.tick();
    expect(s.goals.at(-1)).toMatchObject({status:"checking",check_until_ms:until});
  });
  it("준비안 재검사 실패 후에는 확인한 그 컵으로만 새 계획을 만든다", async () => {
    let count = 0;
    const {s,evidence} = await setup({reuse:(_d,plan) => ++count === 1 ? {ok:false,error:"면 정보 변경"} : {ok:true,plan}});
    expect(s.submittedCups).toEqual(["cup_1"]);
    Object.assign(evidence,{zone:"sofa",watching:true,rev:12});
    s.person({act:"watching_tv"});
    s.tick();
    const d = {...pam("pam-watch",3,s.clock.t,null,true),request_rev:12,
      fsm:{state:"watching_tv",from:null,next_index:-1,to:null,when:null,on:null,action:null,learned:false}};
    expect(s.t.goalTrigger(d)).toBe("컵 치우기");
    await s.decide({...d,goal:true,action:"컵 치우기"});
    expect(s.submittedCups).toEqual(["cup_1", "cup_1"]);
    expect(s.commands()[0]?.text).toBe("식탁으로 가 주세요");
  });
  it.each([null,"away","drinking"] as const)("다른 구역에서 요리를 시작하면 PAM이 확인해 발동한다 (직전 상태 %s)", async (edge) => {
    const {s,evidence} = await setup();
    const before = s.nudged();
    s.person({act:"cooking"});
    Object.assign(evidence,{zone:"kitchen",watching:false,rev:12});
    s.tick();
    expect(s.nudged()).toBe(before+1);
    const d = {...pam("next",3,s.clock.t,null,true),request_rev:12};
    const noEdge = {state:"cooking",from:null,to:null,next_index:-1,on:null,when:null,action:null,learned:false};
    for (const state of ["away","unknown","drinking"]) expect(s.t.goalTrigger({...d,fsm:{...noEdge,state}})).toBeNull();
    const fsm = edge ? {...noEdge,from:edge,to:"cooking",when:"조리대 앞에 서 있다.",next_index:0} : noEdge;
    if (edge) expect(s.t.goalTrigger({...d,action:"사용자에게 물어보기",fsm:{...fsm,action:"사용자에게 물어보기"}})).toBeNull();
    expect(s.t.goalTrigger({...d,fsm})).toBe("컵 치우기");
    await s.decide({...d,fsm,action:"컵 치우기",goal:true});
    expect(s.commands()[0]?.text).toBe("식탁으로 가 주세요");
  });

  it("같은 식탁의 다른 컵으로 바꾸지 않는다", async () => {
    const { s } = await setup();
    s.setObjects(() => [cupOn({ id:"cup_2", surface:"table_1", seen:s.clock.t })]);
    s.tick();
    expect(s.goals.at(-1)).toMatchObject({status:"dropped", reason:"took"});
  });
});

describe("미리 세운 목표: 세우기와 미리 만들기", () => {
  it("처음 상태가 drinking이 아니어도(판단 전 null) 사람이 마시는 중이면(World State 하는 일) 세운다", () => {
    const s = goalSetup({ state: null });
    s.person({ act: "drinking" });
    s.tick();
    expect(s.goals[0]).toMatchObject({ action: "컵 치우기", state: "drinking", status: "armed" });
  });

  it("배우기 전(seed) 기억이면 마시는 중이어도 세우지 않는다(떠날 때 화살표가 묻기라 목표가 없다)", () => {
    const s = goalSetup({ memory: CUP_FSM_MEMORY });
    s.person({ act: "drinking" });
    s.tick();
    s.tick();
    expect(s.goals).toEqual([]);
  });

  it("사람이 컵으로 마시는 것을 보면 「컵 치우기」 목표를 세우고 메시지 상자에 「컵을 두고 자리를 뜨면 컵을 치울게요」를 한 번 올린다. 폰 명령은 없다", async () => {
    const s = goalSetup();
    s.person({ act: "drinking" });
    s.tick();
    expect(s.goals[0]).toMatchObject({ id: "goal-1", action: "컵 치우기", state: "drinking", trigger: "사용자가 먹거나 마시기를 끝내고 다른 일로 넘어간다.", object: "cup_1", cls: "cup", status: "armed", prep: "waiting", reason: null, text: "컵을 두고 자리를 뜨면 컵을 치울게요" });
    expect(s.thoughts).toEqual([USE_THOUGHT.act("마시는 중"), "컵을 두고 자리를 뜨면 컵을 치울게요"]);
    for (let i = 0; i < 20; i++) s.tick();
    await s.t.idle();
    expect(s.thoughts).toHaveLength(2);
    expect(s.commands()).toEqual([]);
  });

  it("사람이 떠나기 전에 계획 모드를 한 번만 불러 계획을 준비해 둔다(미리 만들기 waiting → planning → ready, 계획 보기 plan:goal-1). 계획 입력에 [미리 세운 목표] 줄이 있다", async () => {
    const s = goalSetup();
    const before = s.planCalls();
    s.person({ act: "drinking" });
    s.tick();
    await s.t.idle();
    for (let i = 0; i < 20; i++) s.tick();
    await s.t.idle();
    expect(s.planCalls() - before).toBe(1);
    expect(s.states()).toEqual(["armed/waiting", "armed/planning", "armed/ready"]);
    expect(s.t.goal()).toMatchObject({ status: "armed", prep: "ready", plan: { id: "plan:goal-1" } });
    expect(JSON.stringify(llm.bodies().at(-1))).toContain("[미리 세운 목표]");
    expect(s.commands()).toEqual([]);
    expect(s.logs.filter((l) => l.type === "execution")).toEqual([]);
  });

  it("컵이 손에 있는 동안에는 미리 만들지 않고, 식탁에 내려놓으면 만든다", async () => {
    const s = goalSetup();
    s.setObjects(() => [cupOn({ seen: s.clock.t, place: "in_hand" })]);
    s.person({ act: "drinking", holding: ["cup_1"] });
    s.tick();
    await s.t.idle();
    expect(s.t.goal()).toMatchObject({ status: "armed", prep: "waiting" });
    s.setObjects(() => [cupOn({ seen: s.clock.t })]);
    s.person({ act: "drinking" });
    s.tick();
    await s.t.idle();
    expect(s.t.goal()?.prep).toBe("ready");
  });

  it("컵이 둘이면 목표 컵(사람이 쓴 cup_2)이 아닌 컵의 계획은 받지 않는다: 미리 만들기가 실패로 끝나고 계획을 두지 않는다(Codex 26bff0f Task 4:910)", async () => {
    const s = goalSetup();
    s.setObjects(() => [cupOn({ seen: s.clock.t }), cupOn({ id: "cup_2", seen: s.clock.t, place: "in_hand", position: [7.4, 0.75, 3] })]);
    s.person({ act: "drinking", holding: ["cup_2"] });
    s.tick();
    expect(s.t.goal()).toMatchObject({ object: "cup_2", prep: "waiting" });
    // 사람이 cup_2를 식탁에 내려놓는다. 시험 대본은 입력의 첫 컵 줄(cup_1)을 집는 계획을 낸다
    s.setObjects((xs) => xs.map((x) => (x.id === "cup_2" ? cupOn({ id: "cup_2", seen: s.clock.t, position: [7.4, 0.75, 3] }) : x)));
    s.tick();
    await s.t.idle();
    expect(s.t.goal()).toMatchObject({ object: "cup_2", prep: "failed", plan: null });
  });

  it("세우지 않는 때: 습관 기억이 없음, 코치 모드 행동 목록, 쓰러짐 의심, 다른 계획이 열려 있음", async () => {
    for (const over of [{ habit: () => null }, { tasks: () => tasksFor("coach") }] as Partial<TrackerFixture>[]) {
      const s = goalSetup({ over });
      s.person({ act: "drinking" });
      s.tick();
      expect(s.goals).toEqual([]);
    }
    const fall = goalSetup();
    fall.person({ act: "drinking", posture: POSE_FALL });
    fall.tick();
    expect(fall.goals).toEqual([]);
    const busy = goalSetup();
    await busy.decide(pam("pam-1", 1, busy.clock.t, "사용자에게 물어보기"));
    busy.person({ act: "drinking" });
    busy.tick();
    expect(busy.goals).toEqual([]);
  });
});

describe("미리 세운 목표: 사람이 떠나면 PAM 확인 뒤 바로 시작", () => {
  /** 마시는 동안 계획을 준비해 둔 상태까지. */
  async function ready(o: Parameters<typeof goalSetup>[0] = {}) {
    const s = goalSetup(o);
    s.person({ act: "drinking" });
    s.tick();
    await s.t.idle();
    expect(s.t.goal()?.prep).toBe("ready");
    return s;
  }

  it("사람이 떠나면(컵은 식탁에 그대로) 사람이 떠난 때를 실어 fired로 바꾸고 판단을 바로 부르게 한다(nudge 한 번). 폰 명령은 없다", async () => {
    const s = await ready();
    s.tick();
    const at = s.clock.t;
    s.gone();
    expect(s.t.goal()).toMatchObject({ status: "fired", prep: "ready", gone_ms: at, fired_ms: at });
    expect(s.nudged()).toBe(1);
    s.tick();
    expect(s.nudged()).toBe(1);
    expect(s.commands()).toEqual([]);
  });

  it("PAM이 떠난 뒤 컵 치우기를 고르면 계획 모드를 다시 부르지 않고 미리 만든 계획을 그 판단 id로 내, 승인을 묻지 않고(처음 하는 일 묻기를 켜도) 판단을 받은 그 자리에서 「식탁으로 가 주세요」를 보낸다", async () => {
    const s = await ready({ over: { askFirst: true } });
    s.tick();
    s.gone();
    s.tick();
    const before = s.planCalls();
    await s.decide(pam("pam-2", 2, s.clock.t));
    expect(s.planCalls()).toBe(before);
    expect(s.commands()).toHaveLength(1);
    expect(s.commands()[0]).toMatchObject({ id: "plan:pam-2", text: "식탁으로 가 주세요", speak: true });
    expect(s.commands().some((c) => c.text === APPROVAL_TEXT.ask("컵 치우기"))).toBe(false);
    expect(s.goals.at(-1)).toMatchObject({ status: "used", reason: null });
    expect(s.t.goal()).toBeNull();
  });

  it("keeps the prepared goal through 300 unrelated model calls, then connects the real take to its first phone step", async () => {
    const trace = new HomeTrace("b:h#1", () => 10_000, () => {});
    const s = await ready({ trace, over: { assistance: { boot: "b", homeEpoch: "h#1", ended: (attempt, state, ms) => trace.ended(attempt, state, ms) } } });
    const prepared = trace.snapshot().rows.find(row => row.name === "목표 준비")!;
    expect(prepared).toBeDefined();
    for (let n = 0; n < 300; n++) {
      trace.finish(trace.start("vlm"), "done", "model_answer");
    }
    expect(trace.snapshot().rows.find(row => row.id === prepared.id)).toMatchObject({ retained: true, state: "done" });
    s.tick();
    s.gone();
    s.tick();
    await s.decide(pam("pam-2", 2, s.clock.t));
    const command = s.commands()[0]!;
    expect(command).toMatchObject({ id: "plan:pam-2", kind: "go" });
    expect(trace.snapshot().rows).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: prepared.id, retained: true, activity_id: prepared.activity_id }),
      expect.objectContaining({ kind: "EXECUTION", refs: expect.objectContaining({ plan_id: command.id, goal_id: prepared.refs.goal_id }),
        activity_id: prepared.activity_id, state: "pending" }),
    ]));
    s.t.stop();
    expect(trace.snapshot().rows.find(row => row.id === prepared.id)?.retained).toBeUndefined();
  });

  it("시작한 계획의 첫 단계는 첫 명령을 보낸 시각(started_ms)을 싣는다(대시보드 시간 줄 반응 간격)", async () => {
    const s = await ready();
    s.tick();
    s.gone();
    s.tick();
    const at = s.clock.t;
    await s.decide(pam("pam-2", 2, s.clock.t));
    expect(s.goals.at(-1)).toMatchObject({ status: "used" });
    expect(s.plans.current()!.steps[0]).toMatchObject({ status: "active", started_ms: at });
  });

  it("처음 하는 일 묻기를 켜면(ASK_FIRST_TIME) 목표가 아닌 보통 판단의 처음 하는 컵 치우기는 첫 단계 전에 승인을 묻는다(목표 실행만 묻지 않는다)", async () => {
    const s = goalSetup({ over: { habit: () => null, askFirst: true } });
    await s.decide(pam("pam-1", 1, s.clock.t - 1));
    expect(s.commands()[0]).toMatchObject({ text: APPROVAL_TEXT.ask("컵 치우기") });
  });

  it("떠나기 전에 보낸 판단은 받지 않는다: 같은 행동이어도 사람이 떠난 때보다 앞선 판단은 목표가 맡아 기록만 하고, 떠난 뒤 판단으로 시작한다(Codex 26bff0f Task 5:1252)", async () => {
    const s = await ready();
    s.tick();
    const sentAt = s.clock.t;
    s.tick();
    s.gone();
    const before = s.planCalls();
    await s.decide(pam("pam-3", 3, sentAt));
    expect(s.logs.at(-1)).toMatchObject({ type: "execution", plan_id: "plan:pam-3", state: "decided", text: EXEC_TEXT.goalWait });
    expect(s.commands()).toEqual([]);
    expect(s.t.goal()?.status).toBe("fired");
    await s.decide(pam("pam-4", 4, s.clock.t));
    expect(s.commands()[0]).toMatchObject({ id: "plan:pam-4", text: "식탁으로 가 주세요" });
    expect(s.planCalls()).toBe(before);
  });

  it("사람이 아직 마시는 동안 PAM이 컵 치우기를 고르면 계획을 만들지 않고 「다 쓰고 떠나면 할 일로 두었어요」만 남긴다(목표가 맡는다)", async () => {
    const s = await ready();
    const before = s.planCalls();
    await s.decide(pam("pam-5", 5, s.clock.t));
    expect(s.planCalls()).toBe(before);
    expect(s.logs.at(-1)).toMatchObject({ type: "execution", plan_id: "plan:pam-5", state: "decided", text: EXEC_TEXT.goalWait });
    expect(s.t.goal()).toMatchObject({ status: "armed", prep: "ready" });
    expect(s.commands()).toEqual([]);
  });

  it("미리 만들기가 사람이 떠난 뒤에 끝나도 fired 그대로이고 판단을 다시 부르지 않는다. 뒤에 온 판단은 그 계획을 쓴다(Codex 26bff0f Task 4:922)", async () => {
    const s = goalSetup();
    const before = s.planCalls();
    s.person({ act: "drinking" });
    s.tick();
    expect(s.t.goal()).toMatchObject({ status: "armed", prep: "planning" });
    s.gone();
    expect(s.t.goal()).toMatchObject({ status: "fired", prep: "planning" });
    await s.t.idle();
    expect(s.t.goal()).toMatchObject({ status: "fired", prep: "ready" });
    s.tick();
    expect(s.nudged()).toBe(1);
    await s.decide(pam("pam-6", 6, s.clock.t));
    expect(s.planCalls() - before).toBe(1);
    expect(s.commands()[0]).toMatchObject({ id: "plan:pam-6", text: "식탁으로 가 주세요" });
  });

  it("PAM 판단이 미리 만드는 중에 오면 그 호출을 받아 쓴다(계획 모드를 한 번 더 부르지 않는다)", async () => {
    const s = goalSetup();
    const before = s.planCalls();
    s.person({ act: "drinking" });
    s.tick();
    s.gone();
    await s.decide(pam("pam-7", 7, s.clock.t));
    expect(s.planCalls() - before).toBe(1);
    expect(s.commands()[0]).toMatchObject({ id: "plan:pam-7", text: "식탁으로 가 주세요" });
  });

  it("받아 쓰던 판단이 새 판단에 밀려 끊기면 계획 모드를 다시 부르지 않는다: 새 사람 요청의 계획을 끊지 않는다(Codex 26bff0f Task 5:1275)", async () => {
    const s = goalSetup();
    const before = s.planCalls();
    s.person({ act: "drinking" });
    s.tick();
    s.gone();
    s.t.onDecision(pam("pam-8", 8, s.clock.t));
    await s.decide(pam("pam-9", 9, s.clock.t, "사용자에게 물어보기"));
    // 컵 치우기 계획 모드 호출은 미리 만들기 하나뿐이다(끊긴 받아 쓰기가 다시 부르지 않는다). 미리 만들기는 끊기기 전에 나갔을 수도, 못 나갔을 수도 있다
    const byAction = (name: string) => llm.bodies().slice(before).filter((b) => planTurn(b)?.action === name).length;
    expect(byAction("컵 치우기")).toBeLessThanOrEqual(1);
    expect(byAction("사용자에게 물어보기")).toBe(1);
    expect(s.commands().at(-1)).toMatchObject({ id: "plan:pam-9", choices: expect.arrayContaining([expect.objectContaining({ label: "치워 주세요" })]) });
    expect(s.commands().some((c) => c.id === "plan:pam-8")).toBe(false);
  });

  it("폰 대화 중이면 사람이 떠나도 첫 명령을 미루고, 대화가 끝나면 보낸다(사람 요청이 먼저)", async () => {
    let talking = true;
    const s = await ready({ over: { talking: () => talking } });
    s.tick();
    s.gone();
    await s.decide(pam("pam-10", 10, s.clock.t));
    expect(s.commands()).toEqual([]);
    talking = false;
    s.tick();
    expect(s.commands()[0]).toMatchObject({ id: "plan:pam-10", text: "식탁으로 가 주세요" });
  });

  it("예산(시험 시계, PAM 답 시간은 뺌): 사람 사라짐 변화 뒤 판단 타이머 한 번(250ms) 안에 PAM을 부르고 그 답으로 첫 명령이 나가며, 그동안 계획 모드 호출은 0번이다. 주기 판단은 5초다", async () => {
    const pamLlm = await startFakePamLlm({ predict: (v) => ({ observation: "o", reasoning: "r", task_index: /사람 안 보임/.test(v.observation_text) ? v.tasks.indexOf("컵 치우기") : -1 }) });
    try {
      let decider: Decider | null = null;
      const s = goalSetup({ over: { nudge: () => decider?.nudge() } });
      decider = new Decider({
        pam: pamClientFor(pamLlm), world: { view: () => s.world() }, trigger: new Trigger({ mode: "periodic", minGapMs: 3000, periodMs: 5000, idleStopMs: 1_800_000, liveMs: 10_000, maxInflight: 1 }, 0),
        tasks: () => NOONCHI, memory: () => ({ memory: LEARNED_FSM_MEMORY, kind: "fsm", version: 1 }), emit: () => {}, offsetMinutes: 540, clock: s.clock, onDecision: (d) => s.t.onDecision(d),
      });
      /** 서버 판단 타이머(250ms)와 같은 차례: 판단 → 실행 추적. */
      const loop = async () => { s.clock.t += 250; decider!.onFrame(); decider!.tick(); await decider!.idle(); s.tick(0); await s.t.idle(); };
      s.person({ act: "drinking" });
      for (let i = 0; i < 4; i++) await loop();
      expect(s.t.goal()?.prep).toBe("ready");
      const before = s.planCalls();
      const goneAt = s.clock.t;
      s.gone();
      while (!s.commands().length && s.clock.t - goneAt < 6000) await loop();
      expect(s.commands()[0]).toMatchObject({ text: "식탁으로 가 주세요" });
      expect(s.clock.t - goneAt).toBeLessThanOrEqual(250);
      expect(s.planCalls()).toBe(before);
      decider.stop();
    } finally {
      await pamLlm.close();
    }
  });
});

describe("미리 세운 목표: 맞지 않게 되면 버리고 지금 길로", () => {
  async function ready(o: Parameters<typeof goalSetup>[0] = {}) {
    const s = goalSetup(o);
    s.person({ act: "drinking" });
    s.tick();
    await s.t.idle();
    return s;
  }
  const last = (s: ReturnType<typeof goalSetup>) => s.goals.at(-1)!;
  const coreOf = (s: ReturnType<typeof goalSetup>) => (s.t as unknown as { core: TrackCore }).core;

  it("들고 나감: 사람이 떠날 때 컵도 사라지면 took로 버리고 판단을 부르지 않는다. 손에 있음으로 남으면 15초 기다린 뒤 took", async () => {
    const s = await ready();
    s.setObjects(() => [cupOn({ seen: s.clock.t, status: "gone" })]);
    s.gone();
    expect(last(s)).toMatchObject({ status: "dropped", reason: "took" });
    expect(s.nudged()).toBe(0);
    const h = await ready();
    h.setObjects(() => [cupOn({ seen: h.clock.t, place: "in_hand" })]);
    h.gone();
    expect(h.t.goal()?.status).toBe("armed");
    for (let i = 0; i < 61; i++) h.tick();
    expect(last(h)).toMatchObject({ status: "dropped", reason: "took" });
    expect(h.nudged()).toBe(0);
  });

  it("금방 돌아옴: fired 뒤 PAM 판단 전에 사람이 다시 보이면 back으로 버리고, 그 뒤 컵 치우기 판단은 계획 모드로 만든다(지금 길)", async () => {
    const s = await ready();
    s.tick();
    s.gone();
    s.tick();
    // 다시 나타나 컵을 쓰지 않는다(쓰면 새 등장이라 goal-2를 세운다: 「한 등장에 한 번」 시험)
    s.person({});
    s.tick();
    expect(last(s)).toMatchObject({ status: "dropped", reason: "back" });
    expect(s.t.goal()).toBeNull();
    s.person(null);
    s.tick();
    const before = s.planCalls();
    await s.decide(pam("pam-1", 1, s.clock.t));
    expect(s.planCalls() - before).toBe(1);
  });

  it("컵이 옮겨짐: 다른 면으로 옮겨진 뒤 사람이 떠나면 미리 만든 계획을 쓰지 않고 moved로 버리며 계획 모드로 만든다. 쓰는 동안 이어진 물건 없이 사라져도 moved", async () => {
    const s = await ready();
    s.setObjects(() => [cupOn({ seen: s.clock.t, surface: "sofa" })]);
    s.tick();
    s.gone();
    const before = s.planCalls();
    await s.decide(pam("pam-2", 2, s.clock.t));
    expect(s.goals.find((g) => g.status === "dropped")).toMatchObject({ reason: "moved" });
    expect(s.planCalls() - before).toBe(1);
    const m = await ready();
    m.setObjects(() => [cupOn({ seen: m.clock.t, status: "gone" })]);
    m.tick();
    expect(last(m)).toMatchObject({ status: "dropped", reason: "moved" });
  });

  it("컵이 옮겨져 새 id가 붙어도(followed_by) 같은 면이면 그 컵으로 이어 가 미리 만든 계획을 쓴다", async () => {
    const s = await ready();
    s.setObjects(() => [cupOn({ seen: s.clock.t, status: "gone", followed_by: "cup_2" }), cupOn({ id: "cup_2", seen: s.clock.t })]);
    s.tick();
    s.gone();
    expect(s.t.goal()).toMatchObject({ status: "fired", object: "cup_2" });
    const before = s.planCalls();
    await s.decide(pam("pam-3", 3, s.clock.t));
    expect(s.planCalls()).toBe(before);
    expect(s.commands()[0]).toMatchObject({ id: "plan:pam-3", text: "식탁으로 가 주세요" });
  });

  it("다른 판단: 다른 행동을 고른 판단이 오면 other로 버리고 그 판단의 계획을 만든다. 대기 판단은 버리지 않는다", async () => {
    const s = await ready();
    await s.decide(pam("pam-4", 4, s.clock.t, null));
    expect(s.t.goal()?.status).toBe("armed");
    await s.decide(pam("pam-5", 5, s.clock.t, "사용자에게 물어보기"));
    expect(s.goals.find((g) => g.status === "dropped")).toMatchObject({ reason: "replaced" });
    expect(s.commands().at(-1)).toMatchObject({ id: "plan:pam-5" });
  });

  it("안전·모드·시간: 쓰러짐 의심이면 safety, 행동 목록이 코치 모드로 바뀌면 mode, 세운 지 goalArmMs가 지나면 expired, 사람이 떠난 뒤 15초 안에 PAM이 고르지 않으면 pam", async () => {
    const f = await ready();
    f.person({ act: "drinking", posture: POSE_FALL });
    f.tick();
    expect(last(f)).toMatchObject({ status: "dropped", reason: "safety" });
    let coach = false;
    const m = await ready({ over: { tasks: () => (coach ? tasksFor("coach") : NOONCHI) } });
    coach = true;
    m.tick();
    expect(last(m)).toMatchObject({ status: "dropped", reason: "mode" });
    const e = await ready({ over: { goalArmMs: 1000 } });
    for (let i = 0; i < 5; i++) e.tick();
    expect(last(e)).toMatchObject({ status: "dropped", reason: "expired" });
    const p = await ready();
    p.gone();
    await p.decide(pam("pam-6", 6, p.clock.t, null));
    for (let i = 0; i < 61; i++) p.tick();
    expect(last(p)).toMatchObject({ status: "dropped", reason: "pam" });
  });

  it("충전 자리 복귀 중에는 세우지 않고, 복귀가 끝나면 세운다. 있던 목표는 복귀가 시작되면 dock으로 버린다(Codex 26bff0f Task 4:862)", async () => {
    const s = goalSetup();
    const core = coreOf(s);
    const docking = () => ({ id: "dock:1", sent: null, spokeAt: s.clock.t, visionAt: s.clock.t, phase: "look" as const, target: null, charging: true, startedAt: s.clock.t, decision: "pam-0" });
    core.docking = docking();
    s.person({ act: "drinking" });
    s.tick();
    expect(s.goals).toEqual([]);
    core.docking = null;
    s.tick();
    expect(s.t.goal()?.status).toBe("armed");
    core.docking = docking();
    s.tick();
    expect(last(s)).toMatchObject({ status: "dropped", reason: "dock" });
  });

  it("한 등장에 한 번: 버린 뒤 같은 사람이 계속 마셔도 다시 세우지 않고(계획 모드 호출 늘지 않음), 떠났다 다시 나타나 마시면 goal-2를 세운다", async () => {
    const s = await ready();
    // 다른 판단으로 버린다. 열린 물어보기 계획은 「그만」으로 닫는다(다른 계획이 열려 있으면 세우지 않으므로)
    await s.decide(pam("pam-7", 7, s.clock.t, "사용자에게 물어보기"));
    expect(last(s)).toMatchObject({ status: "dropped", reason: "replaced" });
    s.t.onHeard("그만");
    const calls = s.planCalls();
    for (let i = 0; i < 20; i++) s.tick();
    await s.t.idle();
    expect(s.goals.filter((g) => g.id === "goal-1" && g.status === "armed" && g.prep === "waiting")).toHaveLength(1);
    expect(s.goals.every((g) => g.id === "goal-1")).toBe(true);
    expect(s.planCalls()).toBe(calls);
    s.person(null);
    s.tick();
    s.person({ act: "drinking" });
    s.tick();
    expect(s.goals.find((g) => g.id === "goal-2")).toMatchObject({ status: "armed" });
  });

  it("멈추면 미리 만드는 호출을 끊고 더 내지 않는다", async () => {
    const s = goalSetup();
    s.person({ act: "drinking" });
    s.tick();
    const n = s.goals.length;
    s.t.stop();
    await s.t.idle();
    expect(s.goals).toHaveLength(n);
  });
});

describe("미리 세운 목표: Codex 검토(5c4961e) 고침", () => {
  async function ready(o: Parameters<typeof goalSetup>[0] = {}) {
    const s = goalSetup(o);
    s.person({ act: "drinking" });
    s.tick();
    await s.t.idle();
    expect(s.t.goal()?.prep).toBe("ready");
    return s;
  }

  it("떠나는 사진을 찍은 뒤라도 집 상태에 「사람 안 보임」이 반영되기 전에 보낸 판단(사람이 보이던 관찰)은 받지 않고, 반영된 뒤 보낸 판단으로 시작한다(goal.ts:193)", async () => {
    const s = await ready();
    const shot = s.clock.t;
    s.tick();
    // 떠나는 사진 뒤(shot 이후)에 보냈지만 그때 집 상태에는 아직 사람이 보였다
    const early = pam("pam-1", 1, s.clock.t, "컵 치우기", true);
    s.tick();
    s.gone(shot);
    expect(s.t.goal()).toMatchObject({ status: "fired", gone_ms: shot });
    const before = s.planCalls();
    await s.decide(early);
    expect(s.logs.at(-1)).toMatchObject({ type: "execution", plan_id: "plan:pam-1", state: "decided", text: EXEC_TEXT.goalWait });
    expect(s.commands()).toEqual([]);
    expect(s.t.goal()?.status).toBe("fired");
    await s.decide(pam("pam-2", 2, s.clock.t));
    expect(s.commands()[0]).toMatchObject({ id: "plan:pam-2", text: "식탁으로 가 주세요" });
    expect(s.planCalls()).toBe(before);
  });

  it("「그만」이면 목표와 미리 만든 계획을 버린다(stop): 사람이 떠나도 판단을 바로 부르지 않고, 뒤에 온 판단은 계획 모드로 새로 만든다(answers.ts:89)", async () => {
    const s = await ready();
    expect(s.t.onHeard("그만")).toMatchObject({ kind: "answer", choice: { id: "stop" } });
    expect(s.goals.at(-1)).toMatchObject({ status: "dropped", reason: "stop" });
    expect(s.t.goal()).toBeNull();
    s.tick();
    s.gone();
    expect(s.nudged()).toBe(0);
    const before = s.planCalls();
    await s.decide(pam("pam-3", 3, s.clock.t));
    expect(s.planCalls() - before).toBe(1);
  });

  it("미리 만드는 중에 「그만」이면 그 호출을 끊고 목표를 버린다", async () => {
    const s = goalSetup();
    s.person({ act: "drinking" });
    s.tick();
    expect(s.t.goal()?.prep).toBe("planning");
    expect(s.t.onHeard("그만")).toMatchObject({ kind: "answer" });
    await s.t.idle();
    expect(s.goals.at(-1)).toMatchObject({ status: "dropped", reason: "stop", prep: "planning" });
    expect(s.goals.some((g) => g.prep === "ready")).toBe(false);
  });
});

describe("미리 세운 목표: 실제 영상 g1에서 드러난 것(2026-11-18)", () => {
  it("마시는 동안 컵이 아직 World State 물건이 아니어도(VLM이 손에 든 컵을 물건으로 잘 안 답함) 목표를 세운다(물건 모름). 컵이 식탁에 보이면 그 컵으로 계획을 미리 만든다", async () => {
    const s = goalSetup();
    s.setObjects(() => []);
    s.person({ act: "drinking" });
    s.tick();
    expect(s.t.goal()).toMatchObject({ status: "armed", prep: "waiting", object: null, text: "컵을 두고 자리를 뜨면 컵을 치울게요" });
    s.setObjects(() => [cupOn({ seen: s.clock.t })]);
    s.tick();
    await s.t.idle();
    expect(s.t.goal()).toMatchObject({ prep: "ready", object: "cup_1" });
  });

  it("물건을 모른 채 사람이 떠나면 컵이 보일 때까지 기다렸다가(사람 사라짐 뒤 0.7초에 컵 확정, g1 tall) 떠남으로 바꾸고 판단을 부른다. 15초 안에 컵이 안 보이면 took", async () => {
    const s = goalSetup();
    s.setObjects(() => []);
    s.person({ act: "drinking" });
    s.tick();
    s.gone();
    expect(s.t.goal()).toMatchObject({ status: "armed", object: null });
    expect(s.nudged()).toBe(0);
    s.tick(700);
    s.setObjects(() => [cupOn({ seen: s.clock.t })]);
    s.tick();
    expect(s.t.goal()).toMatchObject({ status: "fired", object: "cup_1" });
    expect(s.nudged()).toBe(1);
    const n = goalSetup();
    n.setObjects(() => []);
    n.person({ act: "drinking" });
    n.tick();
    n.gone();
    for (let i = 0; i < 61; i++) n.tick();
    expect(n.goals.at(-1)).toMatchObject({ status: "dropped", reason: "took" });
  });

  /** 마시는 동안 계획을 준비해 둔 상태까지. */
  async function ready(o: Parameters<typeof goalSetup>[0] = {}) {
    const s = goalSetup(o);
    s.person({ act: "drinking" });
    s.tick();
    await s.t.idle();
    expect(s.t.goal()?.prep).toBe("ready");
    return s;
  }

  // 2026-11-19 glass pfsm4-2: 마시는 중 PAM이 물 채우기 화살표를 잘못 골라 목표가 「다른 일이 맡음」으로 버려졌다. 그 계획은 쓰는 동안 첫 명령을 미루다
  // 실행 전 검사(내용물 있음)에서 막힐 일이었다. 목표는 다른 일의 계획이 실제로 시작될 때(running)만 버린다
  it("마시는 동안 다른 행동(컵에 물 채워 주기)이 골라져도 그 계획이 시작하지 않고 막혀 있으면 목표를 버리지 않고, 사람이 떠나면 목표 계획으로 시작한다", async () => {
    const WATER = "컵에 물 채워 주기";
    llm.scripts[WATER] = () => [planCalls(fillSteps({ fridge: "fridge_1", table: "table_1", cup: "cup_1", drink: "물" }))];
    try {
      const full = (seen: number): WorldObject => { const c = cupOn({ seen }); return { ...c, facts: { ...c.facts, contents: fact("has_contents", seen) } }; };
      const s = goalSetup({ floor: fridgeFloor(), objects: [full(10_000)] });
      s.person({ act: "drinking" });
      s.tick();
      await s.t.idle();
      expect(s.t.goal()?.prep).toBe("ready");
      await s.decide(pam("pam-4", 4, s.clock.t, WATER, true));
      expect(s.plans.current()).toMatchObject({ id: "plan:pam-4", status: "planned" });
      expect(s.commands()).toEqual([]);
      expect(s.t.goal()).toMatchObject({ status: "armed", prep: "ready" });
      s.tick();
      s.gone();
      s.tick();
      expect(s.goals.some((g) => g.status === "dropped")).toBe(false);
      expect(s.t.goal()).toMatchObject({ status: "fired" });
      await s.decide(pam("pam-5", 5, s.clock.t));
      expect(s.commands()[0]).toMatchObject({ id: "plan:pam-5", text: "식탁으로 가 주세요" });
      expect(s.goals.at(-1)).toMatchObject({ status: "used", reason: null });
    } finally {
      delete llm.scripts[WATER];
    }
  });

  // 2026-11-20 wide-mug pfsm10: 마시는 중 고른 물 채우기 계획이 사람이 떠난 1.8초 뒤에야 만들어져 「컵 가까이 가 주세요」를 냈다가 곧바로 컵 치우기로 바뀌었다
  it("사람이 떠나 목표가 판단을 부른(fired) 뒤에는 떠나기 전 관찰로 고른 다른 행동을 시작하지 않는다: 그 계획이 떠난 뒤에 만들어져도, 판단이 떠난 뒤에 와도 폰 명령 없이 막고 목표 계획으로 시작한다", async () => {
    const WATER = "컵에 물 채워 주기";
    llm.scripts[WATER] = () => [planCalls(fillSteps({ fridge: "fridge_1", table: "table_1", cup: "cup_1", drink: "물" }))];
    try {
      const s = goalSetup({ floor: fridgeFloor() });
      s.person({ act: "drinking" });
      s.tick();
      await s.t.idle();
      expect(s.t.goal()?.prep).toBe("ready");
      // 떠나기 전 판단: 계획을 만드는 사이 사람이 떠난다
      s.t.onDecision(pam("pam-4", 4, s.clock.t, WATER, true));
      s.tick();
      s.gone();
      await s.t.idle();
      expect(s.t.goal()).toMatchObject({ status: "fired" });
      expect(s.commands()).toEqual([]);
      expect(s.logs.filter((l) => l.type === "execution" && l.plan_id === "plan:pam-4").at(-1)).toMatchObject({ state: "failed", text: EXEC_TEXT.beforeLeave });
      // 떠나기 전에 보낸 판단이 떠난 뒤에 와도 받지 않는다
      await s.decide(pam("pam-5", 5, s.clock.t - 500, WATER, true));
      expect(s.logs.at(-1)).toMatchObject({ type: "execution", plan_id: "plan:pam-5", state: "decided", text: EXEC_TEXT.beforeLeave });
      expect(s.commands()).toEqual([]);
      s.tick();
      await s.decide(pam("pam-6", 6, s.clock.t));
      expect(s.commands()[0]).toMatchObject({ id: "plan:pam-6", text: "식탁으로 가 주세요" });
      expect(s.goals.at(-1)).toMatchObject({ status: "used", reason: null });
    } finally {
      delete llm.scripts[WATER];
    }
  });

  it("다른 행동의 계획이 실제로 시작(running)하면 그때 목표를 「다른 일이 맡음」으로 버린다", async () => {
    const s = await ready();
    await s.decide(pam("pam-5", 5, s.clock.t, "사용자에게 물어보기", true));
    expect(s.plans.current()).toMatchObject({ id: "plan:pam-5", status: "running" });
    expect(s.goals.at(-1)).toMatchObject({ status: "dropped", reason: "replaced" });
  });

  // 2026-11-19 사용자 「이미 먹으면서 치우기 계획을 세웠는데, 자리 없다고 판단했는데 왜 제대로 동작을 안 해?」(glass pfsm4-2: 떠난 직후 PAM이 away·화살표 없음)
  it("목표 트리거(goalTrigger): 떠난 뒤 PAM이 화살표 없이(−1) 상태만 목표 화살표의 도착(away, to *)으로 답하면 목표 행동이고, 그 행동의 판단은 준비한 계획으로 시작한다. 출발 상태(drinking) 그대로면 null", async () => {
    const step = (state: string) => ({ state, from: null, next_index: -1, to: null, on: null, when: null, action: null, learned: false });
    const same = await ready();
    same.tick();
    same.gone();
    same.tick();
    expect(same.t.goalTrigger({ ...pam("pam-2", 2, same.clock.t, null), fsm: step("drinking") })).toBeNull();
    const s = await ready();
    s.tick();
    s.gone();
    s.tick();
    const d = { ...pam("pam-2", 2, s.clock.t, null), fsm: step("away") };
    expect(s.t.goalTrigger(d)).toBe("컵 치우기");
    const before = s.planCalls();
    await s.decide({ ...d, action: "컵 치우기" });
    expect(s.planCalls()).toBe(before);
    expect(s.commands()[0]).toMatchObject({ id: "plan:pam-2", text: "식탁으로 가 주세요" });
    expect(s.goals.at(-1)).toMatchObject({ status: "used", reason: null });
  });

  it("목표 트리거는 없다: 목표가 없음, 아직 떠나기 전(armed), 이미 행동이 있음, PAM이 다른 화살표 번호를 냄(행동 없는 화살표도 그 답을 따른다)", async () => {
    const step = { state: "away", from: null, next_index: -1, to: null, on: null, when: null, action: null, learned: false };
    const none = goalSetup();
    expect(none.t.goalTrigger({ ...pam("pam-1", 1, none.clock.t, null), fsm: step })).toBeNull();
    await none.decide({ ...pam("pam-1", 1, none.clock.t, null), fsm: step });
    expect(none.commands()).toEqual([]);
    const armed = await ready();
    expect(armed.t.goalTrigger({ ...pam("pam-2", 2, armed.clock.t, null, true), fsm: step })).toBeNull();
    // 마시는 중에서 행동 없이 TV를 보러 가는 화살표가 있는 기억: PAM이 그 화살표(번호 1)를 골랐으면 목표 행동으로 바꾸지 않는다
    const memory = structuredClone(LEARNED_FSM_MEMORY);
    memory.states.find((x) => x.id === "drinking")!.next.splice(1, 0, { to: "watching_tv", on: "사용자가 먹다가 TV를 보러 간다." });
    const other = await ready({ memory });
    other.tick();
    other.gone();
    other.tick();
    expect(other.t.goal()).toMatchObject({ status: "fired" });
    const tv = { state: "watching_tv", from: "drinking", next_index: 1, to: "watching_tv", on: "사용자가 먹다가 TV를 보러 간다.", when: null, action: null, learned: false };
    expect(other.t.goalTrigger({ ...pam("pam-3", 3, other.clock.t, null), fsm: tv })).toBeNull();
    expect(other.t.goalTrigger({ ...pam("pam-3", 3, other.clock.t, null), fsm: { ...step, state: "watching_tv" } })).toBe("컵 치우기");
    expect(other.t.goalTrigger({ ...pam("pam-3", 3, other.clock.t, "사용자에게 물어보기"), fsm: step })).toBeNull();
  });

  // Codex(b5da6c36) P2: 목표 행동을 실행 추적 복사본에만 넣어 판단 기록에는 「대기」가 남았다(밤 채택 검사 robotSpans가 로봇이 한 행동을 못 찾음)
  it("판단(Decider)이 목표 트리거를 물어 판단 기록·실행 추적에 목표 행동으로 낸다: 기록 action 「컵 치우기」(goal 표시, PAM 답 화살표는 그대로 없음)와 첫 명령", async () => {
    const pamLlm = await startFakePamLlm({ predict: (v) => (/사람 안 보임/.test(v.observation_text)
      ? { observation: "o", reasoning: "r", state: "away", from: null, next_index: -1 }
      : v.last_state === "drinking" ? { observation: "o", reasoning: "r", state: "drinking", from: null, next_index: -1 } : { observation: "o", reasoning: "r", state: "drinking", from: "away", next_index: 0 }) });
    try {
      let decider: Decider | null = null;
      const logs: BrainLog[] = [];
      const s = goalSetup({ over: { nudge: () => decider?.nudge() } });
      decider = new Decider({
        pam: pamClientFor(pamLlm), world: { view: () => s.world() }, trigger: new Trigger({ mode: "periodic", minGapMs: 3000, periodMs: 5000, idleStopMs: 1_800_000, liveMs: 10_000, maxInflight: 1 }, 0),
        tasks: () => NOONCHI, memory: () => ({ memory: LEARNED_FSM_MEMORY, kind: "fsm", version: 1 }), emit: (l) => logs.push(l), offsetMinutes: 540, clock: s.clock,
        onDecision: (d) => s.t.onDecision(d), goalTrigger: (d) => s.t.goalTrigger(d),
      });
      const loop = async () => { s.clock.t += 250; decider!.onFrame(); decider!.tick(); await decider!.idle(); s.tick(0); await s.t.idle(); };
      s.person({ act: "drinking" });
      for (let i = 0; i < 4; i++) await loop();
      expect(s.t.goal()?.prep).toBe("ready");
      const goneAt = s.clock.t;
      s.gone();
      while (!s.commands().length && s.clock.t - goneAt < 6000) await loop();
      expect(s.commands()[0]).toMatchObject({ text: "식탁으로 가 주세요" });
      const fired = logs.filter((l): l is Extract<BrainLog, { type: "decision" }> => l.type === "decision" && l.action === "컵 치우기");
      expect(fired).toHaveLength(1);
      expect(fired[0]).toMatchObject({ goal: true, fsm: { state: "away", from: null, next_index: -1 } });
      expect(s.commands()[0]!.id).toBe(`plan:${fired[0]!.id}`);
      decider.stop();
    } finally {
      await pamLlm.close();
    }
  });

  it("사람이 마시는 동안 PAM 판단이 대기(안 하기는 화살표 없음)면 그 일이 맡지 않았으니 목표를 버리지 않는다", async () => {
    const s = goalSetup();
    s.person({ act: "drinking" });
    s.tick();
    await s.t.idle();
    await s.decide(pam("pam-1", 1, s.clock.t, null, true));
    expect(s.t.goal()).toMatchObject({ status: "armed", prep: "ready" });
    expect(s.goals.some((g) => g.status === "dropped")).toBe(false);
  });
});

// 2026-11-18 g1 glass: 미리 만든 계획을 받아 쓰다 계획 모드로 넘어갔는데 「계획이 맞지 않아 버림」만 남고 까닭이 없었다
describe("미리 세운 목표: 준비한 계획을 버린 까닭", () => {
  const E_PRE = "모델 차례 3번 안에 맞는 계획을 내지 못함";
  const E_PLAN = "2번 집기: 집을 물건(cup_9)이 World State에 없습니다";
  const E_REUSE = "2번 단계: 보이는 World State 물건이 아닙니다: cup_1";

  it("받아 쓰던 미리 만들기가 실패하면 목표는 「준비한 계획 버림」(stale, 까닭 error)과 서버 로그를 남기고 계획 모드로 넘어간다(씀은 내지 않는다). 계획 모드도 실패하면 실행 기록 「계획이 맞지 않아 버림」에 그 까닭(reason)", async () => {
    let release: (r: PlanResult) => void = () => {};
    const logged: string[] = [];
    const s = goalSetup({
      over: {
        log: (line) => logged.push(line),
        planner: (_d, _signal, ahead) => (ahead ? new Promise<PlanResult>((r) => { release = r; }) : Promise.resolve({ ok: false as const, error: E_PLAN })),
      },
    });
    s.person({ act: "drinking" });
    s.tick();
    expect(s.t.goal()?.prep).toBe("planning");
    s.gone();
    s.t.onDecision(pam("pam-1", 1, s.clock.t));
    release({ ok: false, error: E_PRE });
    await s.t.idle();
    expect(s.goals.at(-1)).toMatchObject({ id: "goal-1", status: "dropped", reason: "stale", error: E_PRE });
    expect(s.goals.some((g) => g.status === "used")).toBe(false);
    expect(logged).toContain(`[실행 추적] goal-1 준비한 계획 버림(컵 치우기): ${E_PRE}`);
    expect(s.logs.filter((l) => l.type === "execution").at(-1)).toMatchObject({ plan_id: "plan:pam-1", state: "failed", text: EXEC_TEXT.badPlan, reason: E_PLAN });
    expect(logged.some((l) => l.includes("plan:pam-1") && l.includes(E_PLAN))).toBe(true);
  });

  it("받아 쓰던 미리 만들기가 끝났지만 지금 판단으로 다시 검사해 못 넘으면 그 까닭으로 버리고 계획 모드로 새로 만든다. 받아 쓰면 끝난 뒤에 씀(used)을 낸다", async () => {
    const s = goalSetup({ over: { reuse: () => ({ ok: false, error: E_REUSE }) } });
    s.person({ act: "drinking" });
    s.tick();
    s.gone();
    await s.decide(pam("pam-2", 2, s.clock.t));
    expect(s.goals.at(-1)).toMatchObject({ status: "dropped", reason: "stale", error: E_REUSE });
    expect(s.commands()[0]).toMatchObject({ id: "plan:pam-2", text: "식탁으로 가 주세요" });
    const ok = goalSetup();
    ok.person({ act: "drinking" });
    ok.tick();
    ok.gone();
    ok.t.onDecision(pam("pam-3", 3, ok.clock.t));
    expect(ok.goals.at(-1)?.status).not.toBe("used");
    await ok.t.idle();
    expect(ok.goals.at(-1)).toMatchObject({ status: "used", reason: null });
    expect(ok.goals.at(-1)).not.toHaveProperty("error");
  });

  it("준비된 계획을 지금 판단으로 다시 검사해 못 넘으면 그 까닭으로 「준비한 계획 버림」을 남기고 계획 모드로 만든다", async () => {
    const logged: string[] = [];
    const s = goalSetup({ over: { log: (line) => logged.push(line), reuse: () => ({ ok: false, error: E_REUSE }) } });
    s.person({ act: "drinking" });
    s.tick();
    await s.t.idle();
    expect(s.t.goal()?.prep).toBe("ready");
    s.tick();
    s.gone();
    s.tick();
    const before = s.planCalls();
    await s.decide(pam("pam-4", 4, s.clock.t));
    expect(s.goals.at(-1)).toMatchObject({ status: "dropped", reason: "stale", error: E_REUSE });
    expect(logged).toContain(`[실행 추적] goal-1 준비한 계획 버림(컵 치우기): ${E_REUSE}`);
    expect(s.planCalls() - before).toBe(1);
  });

  it("미리 만들기가 실패하면 그 까닭을 목표(error)와 서버 로그에 남긴다. 뒤에 다른 까닭으로 버리면 앞 까닭은 지운다", async () => {
    const logged: string[] = [];
    const s = goalSetup({ over: { log: (line) => logged.push(line), planner: (_d, _signal, ahead) => Promise.resolve({ ok: false as const, error: ahead ? E_PRE : "x" }) } });
    s.person({ act: "drinking" });
    s.tick();
    await s.t.idle();
    expect(s.t.goal()).toMatchObject({ prep: "failed", error: E_PRE });
    expect(logged).toContain(`[실행 추적] goal-1 계획 못 만듦(컵 치우기): ${E_PRE}`);
    s.setObjects(() => []);
    s.gone();
    expect(s.goals.at(-1)).toMatchObject({ status: "dropped", reason: "took" });
    expect(s.goals.at(-1)).not.toHaveProperty("error");
  });
});

/** 식탁 면(test 물건 면 id t, 평면도 table_1 자리 [7, 3])과 싱크대 면. */
const SURFACES: PlaneSurface[] = [
  { id: "t", label: "식탁", center: [7, 3], top: 0.75, radius: 0.6, kind: "table" },
  { id: "s", label: "싱크대", center: [5, 1], top: 0.9, radius: 0.5, kind: "sink" },
];
/** 진행 중 계획의 집기 단계 대상 물건 id. */
const pickedOf = (s: ReturnType<typeof goalSetup>) => s.plans.current()?.steps.find((x) => x.label.includes("집기"))?.target?.objectId;

// 2026-11-18 d1 세 판: 컵이 확정 물건(VLM 2장)이 된 뒤에야 미리 만들기를 시작해, 컵을 내려놓고 1~2초 안에 떠나는 판에서 사람이 떠나기 전에 계획이 없었다
describe("미리 세운 목표: 컵이 놓이기 전 미리 만들기(대신 물건)", () => {
  it("컵이 아직 World State 물건이 아니어도 사람 곁 면(식탁)에 둘 것으로 보고 세우자마자 미리 만든다. 사람이 떠난 뒤 그 면에 컵이 확정되면 계획 모드를 다시 부르지 않고 그 컵 id로 묶어 바로 시작한다", async () => {
    const s = goalSetup({ objects: [], where: [7.8, 3.2], over: { surfaces: () => SURFACES } });
    const before = s.planCalls();
    s.person({ act: "drinking" });
    s.tick();
    expect(s.t.goal()).toMatchObject({ status: "armed", prep: "planning", object: null });
    await s.t.idle();
    expect(s.t.goal()).toMatchObject({ prep: "ready" });
    s.gone();
    expect(s.t.goal()?.status).toBe("armed");
    s.setObjects(() => [cupOn({ id: "cup_3", seen: s.clock.t })]);
    s.tick();
    expect(s.t.goal()).toMatchObject({ status: "fired", object: "cup_3" });
    await s.decide(pam("pam-2", 2, s.clock.t));
    expect(s.planCalls() - before).toBe(1);
    expect(s.commands()[0]).toMatchObject({ id: "plan:pam-2", text: "식탁으로 가 주세요" });
    expect(pickedOf(s)).toBe("cup_3");
    expect(s.goals.at(-1)).toMatchObject({ status: "used", object: "cup_3" });
  });

  it("사람 자리를 몰라도 이번 등장에서 그 종류 후보를 손 밖에서 본 면이 있으면 그 면으로 미리 만든다. 둘 다 없으면 기다린다", async () => {
    const s = goalSetup({ objects: [], over: { surfaces: () => SURFACES } });
    s.person({ act: "drinking" });
    s.tick();
    expect(s.t.goal()?.prep).toBe("waiting");
    s.setSightings([{ cls: "cup", position: [7.1, 0.75, 3.1], surface: "t", surface_label: "식탁", at_ms: s.clock.t, in_hand: false }]);
    s.tick();
    expect(s.t.goal()?.prep).toBe("planning");
  });

  it("사람 곁 면이 싱크대뿐이거나 멀면 미리 만들지 않는다", async () => {
    const s = goalSetup({ objects: [], where: [5.2, 1.1], over: { surfaces: () => SURFACES } });
    s.person({ act: "drinking" });
    s.tick();
    expect(s.t.goal()?.prep).toBe("waiting");
    const far = goalSetup({ objects: [], where: [12, 9], over: { surfaces: () => SURFACES } });
    far.person({ act: "drinking" });
    far.tick();
    expect(far.t.goal()?.prep).toBe("waiting");
  });

  it("컵이 미리 만든 면이 아닌 곳에 놓이면 미리 만든 계획을 쓰지 않고 moved로 버리며 계획 모드로 만든다", async () => {
    const s = goalSetup({ objects: [], where: [7.8, 3.2], over: { surfaces: () => SURFACES } });
    s.person({ act: "drinking" });
    s.tick();
    await s.t.idle();
    s.gone();
    s.setObjects(() => [cupOn({ id: "cup_3", seen: s.clock.t, surface: "sofa" })]);
    s.tick();
    const before = s.planCalls();
    await s.decide(pam("pam-2", 2, s.clock.t));
    expect(s.goals.find((g) => g.status === "dropped")).toMatchObject({ reason: "moved" });
    expect(s.planCalls() - before).toBe(1);
  });
});

// 2026-11-18 mug d1: 한 머그를 cup_2(내려놓을 때)·cup_1(다시 볼 때)로 잡았고, 사람이 떠난 뒤 cup_2가 사라지자 머그는 식탁에 있는데 「버림 · 들고 나감」이 났다
describe("미리 세운 목표: 목표 컵이 사라져도 같은 면에 같은 종류 컵이 있으면 들고 나감이 아니다", () => {
  it("사람이 떠난 뒤 목표 컵(cup_2)이 사라져도 그 면에 다른 컵(cup_1)이 보이면 그 컵으로 이어 가고, 미리 만든 계획을 그 컵 id로 묶어 바로 시작한다", async () => {
    const s = goalSetup({ objects: [] });
    s.setObjects(() => [cupOn({ id: "cup_2", seen: s.clock.t })]);
    const before = s.planCalls();
    s.person({ act: "drinking" });
    s.tick();
    await s.t.idle();
    expect(s.t.goal()).toMatchObject({ prep: "ready", object: "cup_2" });
    s.setObjects((xs) => [...xs, cupOn({ id: "cup_1", seen: s.clock.t })]);
    s.tick();
    s.gone();
    expect(s.t.goal()).toMatchObject({ status: "fired", object: "cup_2" });
    s.setObjects(() => [cupOn({ id: "cup_2", seen: s.clock.t - 3000, status: "gone" }), cupOn({ id: "cup_1", seen: s.clock.t })]);
    s.tick();
    expect(s.t.goal()).toMatchObject({ status: "fired", object: "cup_1" });
    await s.decide(pam("pam-2", 2, s.clock.t));
    expect(s.goals.some((g) => g.reason === "took")).toBe(false);
    expect(s.planCalls() - before).toBe(1);
    expect(s.commands()[0]).toMatchObject({ id: "plan:pam-2", text: "식탁으로 가 주세요" });
    expect(pickedOf(s)).toBe("cup_1");
  });

  it("그 면에 같은 종류 컵이 하나도 없으면 들고 나감(took)이다", async () => {
    const s = goalSetup({ objects: [] });
    s.setObjects(() => [cupOn({ id: "cup_2", seen: s.clock.t })]);
    s.person({ act: "drinking" });
    s.tick();
    await s.t.idle();
    s.gone();
    s.setObjects(() => [cupOn({ id: "cup_2", seen: s.clock.t - 3000, status: "gone" }), cupOn({ id: "cup_1", seen: s.clock.t, surface: "sofa" })]);
    s.tick();
    expect(s.goals.at(-1)).toMatchObject({ status: "dropped", reason: "took" });
  });
});

// 2026-11-18 glass d1: 사람이 떠난 뒤(집 상태에 사람 안 보임) 컵이 확정되기 직전에 보낸 컵 치우기 판단이, 목표가 컵을 본 뒤(fired) 와서 「다 쓰고 떠나면 할 일로 두었어요」로 기록만 됐다(1.6초 늦음)
describe("미리 세운 목표: 사람이 떠난 것이 반영된 뒤 보낸 판단", () => {
  it("사람 안 보임이 집 상태에 들어간 뒤 보낸 같은 행동 판단은 목표가 컵을 기다리다 그 뒤에 떠남을 내도 받아 바로 시작한다", async () => {
    const s = goalSetup({ objects: [], where: [7.8, 3.2], over: { surfaces: () => SURFACES } });
    s.person({ act: "drinking" });
    s.tick();
    await s.t.idle();
    s.gone();
    s.tick();
    const sent = pam("pam-2", 2, s.clock.t);
    s.setObjects(() => [cupOn({ id: "cup_3", seen: s.clock.t })]);
    s.tick();
    expect(s.t.goal()?.status).toBe("fired");
    await s.decide(sent);
    expect(s.commands()[0]).toMatchObject({ id: "plan:pam-2", text: "식탁으로 가 주세요" });
  });
});

// 2026-11-18 사용자 결정: 떠나기 직전 2.5초 안에 그 면 위에서 손에 없이 본 컵이면 떠난 뒤 사진을 기다리지 않고 바로 시작한다.
// 사람이 마지막에 컵을 들고 나갔으면 식탁에 가서 없는 것을 보고 찾기로 넘어간다(집기 전에 떠난 뒤 다시 봤는지 본다)
describe("미리 세운 목표: 떠나기 직전에 본 컵으로 바로 시작", () => {
  /** 미리 만든 계획이 준비되고, 컵을 떠나기 lastMs 앞에 마지막으로 본 채(그 뒤 사진에 안 잡힘) 사람이 떠난 상태. */
  async function leftWith(lastMs: number) {
    const s = goalSetup();
    s.person({ act: "drinking" });
    s.tick();
    await s.t.idle();
    expect(s.t.goal()?.prep).toBe("ready");
    s.tick(1000);
    s.freeze();
    s.setObjects(() => [cupOn({ seen: s.clock.t })]);
    s.tick(lastMs);
    s.gone();
    s.tick(2500);
    return s;
  }

  it("떠나기 1초 앞에 식탁 위에서 본 컵이면 떠난 뒤 사진 없이 판단을 받자마자 「식탁으로 가 주세요」를 보낸다(판단이 떠난 뒤 2.5초에 와 마지막 사진이 3.5초 지나도)", async () => {
    const s = await leftWith(1000);
    await s.decide(pam("pam-2", 2, s.clock.t));
    expect(s.commands()[0]).toMatchObject({ id: "plan:pam-2", text: "식탁으로 가 주세요" });
  });

  it("떠나기 3초 앞에 본 컵이면 떠난 뒤 사진을 기다린다(바로 보내지 않는다)", async () => {
    const s = await leftWith(3000);
    await s.decide(pam("pam-2", 2, s.clock.t));
    expect(s.commands()).toEqual([]);
  });

  it("식탁에 갔을 때 떠난 뒤 사진에 컵이 있으면 바로 「컵을 들어 주세요」로 간다", async () => {
    const s = await leftWith(1000);
    await s.decide(pam("pam-2", 2, s.clock.t));
    s.freeze(false);
    s.setEye([7, 3]);
    s.tick();
    s.tick();
    expect(s.commands().at(-1)).toMatchObject({ id: "plan:pam-2", text: "컵을 들어 주세요" });
  });

  // 2026-11-19 영상 모드(고정 자세)에서 드러남: 1단계를 폰 위치가 아니라 「완료」로 넘기면 떠난 뒤 컵을 아직 다시 못 봤을 때 붙잡힌 뒤 다시 보는 길이 없어 멈췄다
  describe("1단계를 「완료」로 넘겼는데(폰 위치로는 끝나지 않음) 떠난 뒤 컵을 아직 다시 못 봤으면 붙잡았다가", () => {
    async function answered() {
      const s = await leftWith(1000);
      await s.decide(pam("pam-2", 2, s.clock.t));
      const first = s.commands()[0]!;
      expect(first).toMatchObject({ id: "plan:pam-2", text: "식탁으로 가 주세요" });
      expect(s.t.onAnswer(first.id, first.step, "done")).toBe(true);
      await s.t.idle();
      expect(s.commands().some((c) => c.text === "컵을 들어 주세요")).toBe(false);
      expect(s.t.robotTransition({ ...s.t.machineFacts(), observing: false }, s.clock.t)?.state).toBe("recover");
      return s;
    }
    it("그 뒤 사진에 컵이 보이면 「컵을 들어 주세요」로 간다", async () => {
      const s = await answered();
      s.freeze(false);
      s.tick();
      s.tick();
      expect(s.commands().at(-1)).toMatchObject({ id: "plan:pam-2", text: "컵을 들어 주세요" });
    });
    it("집기 전에 컵을 다시 보는 동안은 VLM 사진 간격을 1초로 줄이고(다시 보기 기한 3초 안에 새 사진의 답이 오게), 다시 보면 원래 간격이다", async () => {
      const s = await answered();
      expect(s.t.fastVlm()).toBe(true);
      s.freeze(false);
      s.tick();
      s.tick();
      expect(s.commands().at(-1)).toMatchObject({ text: "컵을 들어 주세요" });
      expect(s.t.fastVlm()).toBe(false);
    });
    it("다시 보기 기한이 지나도 안 보이면 그 자리로 찾으러 가고(멀면 「식탁으로 가 주세요」, 가까우면 「식탁 위를 비춰 주세요」), 못 찾으면 대상이 없다고 닫는다", async () => {
      const s = await answered();
      s.setObjects((xs) => xs.map((x) => ({ ...x, status: "gone" as const })));
      for (let i = 0; i < 16; i++) s.tick();
      expect(s.commands().at(-1)).toMatchObject({ id: "plan:pam-2", text: "식탁으로 가 주세요" });
      expect(s.commands().at(-1)!.step).not.toBe("plan:pam-2:1");
      expect(s.t.robotTransition({ ...s.t.machineFacts(), observing: false }, s.clock.t)?.state).toBe("move");
      s.setEye([7, 3]);
      for (let i = 0; i < 8; i++) s.tick();
      expect(s.commands().at(-1)).toMatchObject({ text: FIND_TEXT.aim("식탁") });
      expect(s.t.robotTransition({ ...s.t.machineFacts(), observing: false }, s.clock.t)?.state).toBe("observe");
      for (let i = 0; i < 280; i++) s.tick();
      expect(s.logs.filter((l) => l.type === "execution").at(-1)).toMatchObject({ plan_id: "plan:pam-2", state: "failed", text: CHECK_TEXT.no_target });
      // 다시 보다가 계획이 끝나면(실패) 원래 사진 간격으로 돌아간다: 다음 계획까지 1초 간격이 남지 않는다
      expect(s.t.fastVlm()).toBe(false);
    });
  });

  it("사람이 마지막에 컵을 들고 나갔으면(떠난 뒤 사진에 컵이 없음) 식탁에 가서 집기 대신 그 자리를 찾고(「식탁 위를 비춰 주세요」), 못 찾으면 대상이 없다고 닫는다", async () => {
    const s = await leftWith(1000);
    await s.decide(pam("pam-2", 2, s.clock.t));
    expect(s.commands()[0]).toMatchObject({ text: "식탁으로 가 주세요" });
    s.setObjects((xs) => xs.map((x) => ({ ...x, status: "gone" as const })));
    s.setEye([7, 3]);
    for (let i = 0; i < 16; i++) s.tick();
    expect(s.commands().some((c) => c.text === "컵을 들어 주세요")).toBe(false);
    expect(s.commands().at(-1)).toMatchObject({ text: FIND_TEXT.aim("식탁") });
    for (let i = 0; i < 280; i++) s.tick();
    expect(s.logs.filter((l) => l.type === "execution").at(-1)).toMatchObject({ plan_id: "plan:pam-2", state: "failed", text: CHECK_TEXT.no_target });
  });
});

// 2026-11-18 사용자 결정: 목표가 서 있는 동안만 VLM 사진 간격을 1초로(관찰 흐름의 가까이 보는 차례와 같은 길, src/observe/pipeline.ts FAST_VLM_MS)
describe("미리 세운 목표: 목표 동안 VLM 사진 간격", () => {
  it("목표가 서 있는 동안(세움·떠남) fastVlm이 참이고, 버리거나 계획이 시작되면(씀) 거짓이다", async () => {
    const s = goalSetup();
    expect(s.t.fastVlm()).toBe(false);
    s.person({ act: "drinking" });
    s.tick();
    expect(s.t.fastVlm()).toBe(true);
    await s.t.idle();
    s.gone();
    expect(s.t.goal()?.status).toBe("fired");
    expect(s.t.fastVlm()).toBe(true);
    await s.decide(pam("pam-2", 2, s.clock.t));
    expect(s.goals.at(-1)?.status).toBe("used");
    expect(s.t.fastVlm()).toBe(false);
    const d = goalSetup();
    d.person({ act: "drinking" });
    d.tick();
    expect(d.t.onHeard("그만")).toMatchObject({ kind: "answer" });
    expect(d.t.fastVlm()).toBe(false);
  });

  it("찾기 차례(가까이 보는 차례)와 겹쳐도 참이다", async () => {
    const s = goalSetup();
    s.person({ act: "drinking" });
    s.tick();
    const core = (s.t as unknown as { core: TrackCore }).core;
    const real = core.finder.looking.bind(core.finder);
    core.finder.looking = () => true;
    expect(s.t.fastVlm()).toBe(true);
    expect(s.t.looking()).toBe(true);
    core.finder.looking = real;
  });
});

// Codex 검토(59447ec, main 합치기 전): P1 goal.ts:317, P2 start.ts:312·goal.ts:207, P2 start.ts:314
describe("미리 세운 목표: Codex 검토(59447ec) 고침", () => {
  /** 컵 치우기 계획을 cup 대신 이 id로 짜는 가짜 계획 모드와 그 계획기를 쓰는 목표 실행 추적. steps: 단계 고르기(없으면 네 단계 그대로). */
  async function withPlanner(cup: string | null, steps: (xs: Record<string, unknown>[]) => Record<string, unknown>[], o: Parameters<typeof goalSetup>[0] = {}) {
    const fake = await startFakePlanner({ "컵 치우기": (input) => { const ids = idsFrom(input); return [planCalls(steps(cupSteps({ ...ids, cup: cup ?? ids.cup })))]; } });
    const real = testPlanner(fake);
    let s!: ReturnType<typeof goalSetup>;
    s = goalSetup({
      ...o,
      over: {
        ...o.over,
        planner: (d, signal, ahead) => real.plan({ ...planContext({ decision: d, world: s.world(), floor: s.plans.floor() }), ...(ahead ? { ahead } : {}) }, signal),
      },
    });
    return { s, close: () => fake.close() };
  }
  /** 컵을 떠나기 1초 앞에 마지막으로 본 채(그 뒤 사진에 안 잡힘) 사람이 떠나고 2.5초 지난 상태로 만든다(미리 만든 계획이 준비된 뒤). */
  async function leave(s: ReturnType<typeof goalSetup>, cup: WorldObject) {
    s.person({ act: "drinking" });
    s.tick();
    await s.t.idle();
    expect(s.t.goal()?.prep).toBe("ready");
    s.tick(1000);
    s.freeze();
    s.setObjects(() => [{ ...cup, last_seen_ms: s.clock.t, last_in_view_ms: s.clock.t }]);
    s.tick(1000);
    s.gone();
    s.tick(2500);
  }

  it("P1: 받아 쓰던 미리 만들기를 기다리는 사이 쓰러짐 의심이 생기면 첫 명령을 보내지 않고, 목표는 안전 알림으로 버린다", async () => {
    let release: (r: PlanResult) => void = () => {};
    let pending: Promise<PlanResult> | null = null;
    const s = goalSetup({
      over: {
        planner: (d, signal, ahead) => {
          if (!ahead) return testPlanner(llm).plan(planContext({ decision: d, world: s.world(), floor: s.plans.floor() }), signal);
          pending = new Promise<PlanResult>((r) => { release = r; });
          return pending;
        },
      },
    });
    s.person({ act: "drinking" });
    s.tick();
    expect(s.t.goal()?.prep).toBe("planning");
    s.gone();
    s.t.onDecision(pam("pam-1", 1, s.clock.t));
    // 목표는 받아 쓰기로 떼어졌다. 그사이 사람이 다시 보이고 쓰러짐 의심
    s.person({ posture: POSE_FALL });
    s.tick();
    const done = await testPlanner(llm).plan({ ...planContext({ decision: { ...pam("goal-1", 0, s.clock.t), prediction: null }, world: s.world(), floor: s.plans.floor() }), ahead: { trigger: "t", on: null, object: "cup_1" } });
    release(done);
    await s.t.idle();
    s.tick();
    expect(s.commands().some((c) => c.text === "식탁으로 가 주세요")).toBe(false);
    expect(s.logs.filter((l) => l.type === "execution" && l.plan_id === "plan:pam-1").at(-1)).toMatchObject({ state: "failed", text: EXEC_TEXT.goalSafety });
    expect(s.goals.at(-1)).toMatchObject({ status: "dropped", reason: "safety" });
  });

  it("P2: 계획 대상이 지금 종류가 컵인 bottle_n이어도 목표 물건으로 받고(미리 만들기 준비됨), 떠나기 직전 사진으로 시작하면 집기 전에 다시 본다(없으면 찾기)", async () => {
    const cup = { ...cupOn({ id: "bottle_1", seen: 10_000 }) };
    const { s, close } = await withPlanner("bottle_1", (xs) => xs, { objects: [cup] });
    try {
      await leave(s, cup);
      await s.decide(pam("pam-2", 2, s.clock.t));
      expect(s.commands()[0]).toMatchObject({ id: "plan:pam-2", text: "식탁으로 가 주세요" });
      s.setObjects((xs) => xs.map((x) => ({ ...x, status: "gone" as const })));
      s.setEye([7, 3]);
      for (let i = 0; i < 16; i++) s.tick();
      expect(s.commands().some((c) => c.text === "컵을 들어 주세요")).toBe(false);
      expect(s.commands().at(-1)).toMatchObject({ text: FIND_TEXT.aim("식탁") });
    } finally { await close(); }
  });

  it("P3: 집기로 시작하는 계획은 떠나기 직전 사진만으로 집기를 시키지 않는다: 떠난 뒤 사진에 컵이 있으면 그때 「컵을 들어 주세요」, 없으면 찾기", async () => {
    const pickFirst = (xs: Record<string, unknown>[]) => xs.slice(1);
    const a = await withPlanner(null, pickFirst);
    try {
      await leave(a.s, cupOn({ seen: 10_000 }));
      await a.s.decide(pam("pam-2", 2, a.s.clock.t));
      expect(a.s.commands()).toEqual([]);
      a.s.freeze(false);
      a.s.tick();
      a.s.tick();
      expect(a.s.commands()[0]).toMatchObject({ id: "plan:pam-2", text: "컵을 들어 주세요" });
    } finally { await a.close(); }
    const b = await withPlanner(null, pickFirst);
    try {
      await leave(b.s, cupOn({ seen: 10_000 }));
      await b.s.decide(pam("pam-3", 3, b.s.clock.t));
      b.s.setObjects((xs) => xs.map((x) => ({ ...x, status: "gone" as const })));
      for (let i = 0; i < 16; i++) b.s.tick();
      expect(b.s.commands().some((c) => c.text === "컵을 들어 주세요")).toBe(false);
      expect(b.s.commands().at(-1)?.text).toMatch(/식탁/);
    } finally { await b.close(); }
  });
});
