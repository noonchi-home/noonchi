// 실행 추적(src/act/track/): 실제 폰은 에이전트의 손이다. 계획은 에이전트 계획 모드(src/agent/planner.ts)가 만들고, 시험의 모델은
// 같은 주소 자리의 가짜 OpenAI 서버가 도구 호출로 낸다(tests/helpers/planner.ts, 지금 서버와 같은 컵 계획). 계획 단계마다 사람에게 명령 하나를 보내고,
// 그 단계가 됐는지를 폰 눈 위치(이동)와 World State(컵 자리)로 본 뒤 다음 명령을 보낸다. 「완료」(단추·말)는 지금 단계 하나를 넘기고 「그만」은 계획을 그만둔다.
// 조건은 단계가 시작된 뒤 본 사실만 쓰므로 손에 있음·싱크대 안 사실은 지금 시계(clock.t)로 둔다.
import { testTracker, type TrackerFixture } from "./helpers/tracker-ports.js";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { walkingMap } from "../src/layout/walk-guide.js";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { HistoryDb } from "../src/brain/history/db.js";
import type { ActionChoice } from "../src/act/prompts.js";
import { DONE_NOTICE_MS, type ExecutionTracker, TRACK_DEFAULTS, type ContentsLook, type Stall, type Stray } from "../src/act/track/tracker.js";
import type { TrackCore } from "../src/act/track/core.js";
import { ApprovalStore, type ApprovalAnswer } from "../src/agent/approval.js";
import type { AgentStep } from "../src/agent/planTools.js";
import type { PlanResult } from "../src/agent/index.js";
import { checkDecision, checkPlan, type CheckResult } from "../src/act/check.js";
import { TASKS, clearsAway, putAway, targetOf } from "../src/act/tasks.js";
import { PlanDraft, resubmit } from "../src/agent/planTools.js";
import type { BrainLog, CloserResult, DecisionRecord } from "../src/contract/events.js";
import type { HeardAt, PlannedCommand, PlannedCommandMessage } from "../src/contract/phone.js";
import type { WorldChange, WorldObject, WorldView } from "../src/contract/world.js";
import { PlanHub } from "../src/act/hub.js";
import { APPROVAL_TEXT, CAUTION_TEXT, CHECK_TEXT, DOCK_TEXT, EXEC_TEXT, CAUTION_LINE, PEEK_TEXT, STEP_COMMAND, STEP_LABEL, TOP_TEXT, USE_THOUGHT, type TellMode } from "../src/act/labels.js";
import { CONTENTS_HOLD, PEEK } from "../src/act/robot/contents.js";
import { FIND } from "../src/act/robot/find.js";
import { DOCK, USER_ROOM_MS } from "../src/act/robot/dock.js";
import { POSE_FALL } from "../src/world/vocab.js";
import { PHONE_PROTOCOL } from "../src/phone/protocol.js";
/** 인덕션 켜기 전 질문(서버 글). */
const ASK_ON = "냄비와 상판이 뜨거워져요. 인덕션을 켤까요?";
import { WorldState, type CloserPass } from "../src/world/state/world.js";
import { sha256 } from "../src/observe/ring.js";
import type { EngineFrame, Detection, CameraView } from "../src/contract/observe.js";
import { floorPlanFrom } from "../src/layout/route.js";
import { SMALL_SCENE, smallFloor } from "./helpers/floor.js";
import { viewLooking } from "./helpers/camera.js";
import { standing } from "./helpers/poses.js";
import { cupSteps, fillSteps, microwaveScripts, planCalls, planContext, ramenScripts, ramenSteps, startFakePlanner, testPlanner, type FakePlanner } from "./helpers/planner.js";
import { describeDevice } from "../src/devices/mapping.js";
import { MemoryHub } from "../src/devices/hub/memory.js";
import { makeHome } from "./helpers/home.js";
import { deviceRunner } from "../src/act/devices.js";
import { memoryLessons, quietLabels } from "../src/act/lessons.js";
import { det } from "./helpers/detectors.js";
import { heardAtOf } from "./helpers/ws.js";
import { see as vlmSee } from "./helpers/vlm-scene.js";

// 코치 계획(라면 끓이기 알려 주기) 시험 틀: 수납장·인덕션이 있는 주방, 인덕션은 가전 induction_1(cooktop)
const RAMEN = "라면 끓이기 알려 주기";
const ramenDecision = (id = "pam-1", seq = 1): DecisionRecord => ({ ...decision, id, seq, action: RAMEN, prediction: { ...pred, task_index: 1 } });
const kitchenFloor = () => floorPlanFrom({ ...structuredClone(SMALL_SCENE), objects: [...structuredClone(SMALL_SCENE.objects),
  { id: "cabinet_1", type: "kitchen_cabinet", room: "kitchen", plan: { position: [4.5, 3.5] } }, { id: "induction_1", type: "induction_counter", room: "kitchen", plan: { position: [6, 0.5] } }] });
const cooktop = (state: string[], history: WorldView["devices"][number]["history"] = []): WorldView["devices"][number] => ({ id: "induction_1", kind: "cooktop", label: "인덕션", status: state.join(" "), state: state as WorldView["devices"][number]["state"], active: false, changed_ms: 0, event_ms: null, started_ms: null, remaining_min: null, history });
function coachSetup(over: Parameters<typeof setup>[0] = {}) {
  const plans = new PlanHub(kitchenFloor(), () => {}, () => "t");
  const hub = makeHome().hub;
  llm.scripts = { ...llm.scripts, ...ramenScripts() };
  const planner = testPlanner(llm);
  const w = over.w ?? (() => world([]));
  return setup({
    plans, w, approvals: store({ [`task:${RAMEN}`]: "approve" }), handDevices: () => [{ id: "induction_1", kind: "cooktop", label: "인덕션" }],
    planner: (d, signal) => planner.plan(planContext({ decision: d, world: w(), floor: plans.floor(), hub }), signal), ...over,
  });
}
/** 인덕션 켜기(7번) 앞까지 「완료」로 넘긴다. */
async function toOn(s: ReturnType<typeof setup>, d: DecisionRecord = ramenDecision()) {
  await s.decide(d);
  for (let n = 1; n <= 6; n++) expect(s.t.onAnswer(`plan:${d.id}`, `plan:${d.id}:${n}`, "done"), String(n)).toBe(true);
}

it("station arrival uses the walk guide, never the last generic eye or the door threshold",()=>{
  const map=walkingMap(smallFloor(),SMALL_SCENE as unknown as import("../src/contract/layout.js").SceneJson);
  const result:string[]=[];
  const s=setup({walking:()=>map,stations:{rev:()=>1,target:id=>({id,label:"서기",position:[5,0,2],look:null}),result:r=>result.push(r.outcome)}});
  const sample=(x:number)=>{s.clock.t+=200;s.t.onNavigationPose({quality:"usable",observed_ms:s.clock.t,pose_gen:1,position:[x,2]});s.t.tick();};
  s.t.onEye([5,2]);sample(3.5);sample(3.7);
  s.t.onDirective({op:"grant",id:"visit:walk",kind:"visit",target_id:"spot",rev:1,goal_id:null,until_ms:30000});
  // 안내는 이동 가능 점 격자 길: 트인 경계 → 주방 격자 점(4.5, 2.1) → 설 자리
  expect(s.last()).toMatchObject({guide:{remaining:[{kind:"portal"},{kind:"via",position:[4.5,0,2.1]},{kind:"stand"}]}});
  sample(4.1);sample(4.2);
  expect(s.last()).toMatchObject({step:"visit:walk:go",speak:false,guide:{remaining:[{kind:"via",position:[4.5,0,2.1]},{kind:"stand"}]}});
  expect(result).toEqual([]);
  sample(4.7);sample(4.8);expect(result).toEqual(["arrived"]);
});

it("관찰 자리는 맞춘 눈으로만 도착하고 승인 질문이 오면 방문 줄을 거둔다",()=>{
  const results:string[]=[];
  let pending=false;
  // 폰 눈 방향(World State eye yaw_deg, 평면 x축에서 잰 각): 0이면 +x(냉장고 반대쪽), 180이면 냉장고 앞 쪽
  let yaw=0;
  const watched=world([cup("present")]);
  const s=setup({approvalsWaiting:()=>pending,w:()=>({...watched,eye:{position:[4,4],height_m:1.15,yaw_deg:yaw,pitch_deg:-10,room:null,room_label:null,at_ms:10_000}}),
    stations:{map:()=>({version:1,stations:[{id:"entry",room:"kitchen",name:"입구",position:[4,4],look_at:[2,4],roles:["observe"],surfaces:["fridge1"],rooms:[],observes_zone_ids:[]}],zones:[],surface_fronts:[],kitchen_entry:"entry",meal_watch:null}),rev:()=>7,target:id=>({id,label:"주방 입구",position:[4,0,4],look:{label:"냉장고 앞",position:[2,0.6,4]}}),result:r=>results.push(r.outcome)}});
  const d={op:"grant",id:"visit:1",kind:"visit",target_id:"entry",rev:3,goal_id:null,until_ms:20000} as const;
  s.t.onEye([0,0]); s.t.onDirective(d);
  expect(s.phone.at(-1)).toMatchObject({type:"command",text:"주방 입구로 이동해 냉장고 앞을 비춰 주세요.",choices:[],target:{position:[4,0,4],look:[2,0.6,4]}});
  expect(s.t.openCommand()).toMatchObject({planId:d.id,kind:"command",choices:[]});
  pending=true; s.t.tick();
  expect(s.phone.at(-1)).toMatchObject({type:"command_clear",id:d.id});
  pending=false; s.t.onEye([4,4]); s.t.onDirective(d);
  expect(results).toEqual(["cancelled"]);
  // 이미 반경 안이어도 비출 곳(냉장고 앞)을 보지 않으면 도착이 아니다: 「…을 비춰 주세요」를 띄우고 기다린다
  s.t.onDirective({...d,id:"visit:2"});
  expect(results).toEqual(["cancelled"]);
  expect(s.phone.at(-1)).toMatchObject({type:"command",id:"visit:2",text:"주방 입구로 이동해 냉장고 앞을 비춰 주세요."});
  yaw=180; s.t.tick();
  expect(results).toEqual(["cancelled"]);
  watched.devices=[{...cooktop([]),kind:"fridge",id:"fridge1"}];
  watched.household_photo = arrivalPhoto(10_000,[4,1,4],[2,0.6,4]);
  s.t.tick(); expect(results).toEqual(["cancelled"]);
  watched.fixtures=[{id:"refrigerator_kitchen",cls:"refrigerator",room:"kitchen",room_label:"주방",device:"fridge1",
    first_seen_ms:9000,last_seen_ms:10_100,answered_ms:9000,facts:{open:{value:"closed",at_ms:9000,since_ms:9000,certainty:"confirmed"}}}];
  s.t.tick(); expect(results).toEqual(["cancelled"]);
  watched.fixtures[0]!.answered_ms=10_000;
  watched.fixtures[0]!.facts.open!.at_ms=10_000;
  watched.household_photo=arrivalPhoto(10_000,[4,1,4],[4,5,4]);
  s.t.tick(); expect(results).toEqual(["cancelled"]);
  watched.household_photo=arrivalPhoto(10_000,[4,1,4],[2,0.6,4]); s.t.tick();
  expect(results.at(-1)).toBe("arrived");
});
function arrivalPhoto(at: number, origin: [number, number, number], look: [number, number, number]): NonNullable<WorldView["household_photo"]> {
  return { id:"arrival", serial:1, at_ms:at, proof:{ camera:viewLooking(origin,look), person_count:0, person:null, seats:"clear", dining_food:"unknown" } };
}
let llm: FakePlanner;
beforeAll(async () => { llm = await startFakePlanner(); });
afterAll(async () => { await llm.close(); });

// smallFloor: 로봇 [1, 2], 식탁 table_1 [7, 3], 싱크대 sink_1 [5, 1]
const cup = (status: WorldObject["status"], place?: string, seen = 9_000): WorldObject => ({
  id: "cup_1", cls: "cup", position: [2, 0.75, 1], surface: "t", surface_label: "식탁", room: "hall", error_m: 0.1, status,
  first_seen_ms: 0, last_seen_ms: seen, last_in_view_ms: seen, facts: place ? { place: { value: place, at_ms: seen, since_ms: seen, certainty: "confirmed" } } : {}, answered_ms: null, devices: [], closer_hold: false, followed_by: null,
});
/** 분석한 마지막 프레임(frame_ms)은 실제 World State처럼 물건을 마지막으로 본 프레임이다(본 물건이 없으면 null). */
const world =(objects: WorldObject[], personAction?: string, at = 0): WorldView => ({
  at_ms: 0, objects, person: { visible: !!personAction, since_ms: 0, last_seen_ms: null, count: 0, room: null, room_label: null, position: null, near: [], holding: [], position_ms: null, answered_ms: null, facts: personAction ? { holding: { value: personAction, at_ms: at, since_ms: at, certainty: "confirmed" } } : {} },
  fixtures: [], devices: [], eye: null, frame_ms: objects.length ? Math.max(at, ...objects.map((o) => o.last_seen_ms)) : null, vlm_missing: 0, yolo_missing: 0,
});
const pred = { observation: "o", reasoning: "r", task_index: 0 };
const decision: DecisionRecord = {
  id: "pam-1", seq: 1, atMs: 8_000, textSent: "t", finalTime: "x", status: "valid", prediction: pred, action: "컵 치우기", memoryVersion: 1,
  world: { objects: [], person_visible: false, vlm_missing: 0, yolo_missing: 0 },
};
const ask = (id: string, seq: number): DecisionRecord => ({ ...decision, id, seq, action: "사용자에게 물어보기", prediction: { ...pred, task_index: 1 } });
const DONE = [{ id: "done", label: "완료" }];
/** 평면도 물건의 트윈 자리(고리 대상). */
const PLACES: Record<string, { label: string; position: [number, number, number] }> = {
  table_1: { label: "식탁", position: [7, 0.75, 3] }, sink_1: { label: "싱크대", position: [5, 0.9, 1] },
};
const TABLE = { id: "table_1", ...PLACES.table_1! };
const SINK = { id: "sink_1", ...PLACES.sink_1! };

/** 승인 기억(파일). remembered: 미리 넣어 둘 답. */
function store(remembered: Record<string, ApprovalAnswer> = {}): ApprovalStore {
  const s = new ApprovalStore(join(mkdtempSync(join(tmpdir(), "track-")), "homes", "h", "approvals.json"), () => "t");
  for (const [key, a] of Object.entries(remembered)) s.answer(key, a);
  return s;
}

/** approvals가 없으면 컵 치우기에 승인을 받아 둔 기억으로 만든다(승인 질문 없이 첫 단계부터). 같은 행동 다시 계획 간격은 0(그 간격은 따로 본다).
 *  decide: 판단을 넘기고 에이전트가 계획을 다 만들 때까지 기다린다. */
function setup(over: Partial<TrackerFixture> & { w?: () => WorldView; check?: () => CheckResult } = {}) {
  const logs: BrainLog[] = [];
  const phone: PlannedCommandMessage[] = [];
  const clock = { t: 10_000, now() { return this.t; } };
  const plans = over.plans ?? new PlanHub(smallFloor(), () => {}, () => "t");
  const approvals = over.approvals ?? store({ "task:컵 치우기": "approve" });
  const w = over.w ?? (() => world([cup("present")]));
  const planner = testPlanner(llm);
  /** 실행 추적에 넘긴 판단(PAM 판단과 말 부탁·묻기 답으로 만든 판단, onSpeech). */
  const decided: DecisionRecord[] = [];
  const t = testTracker({
    onSpeech: (d) => decided.push(d),
    plans, world: w, check: over.check ?? (() => ({ ok: true })), floor: () => plans.floor(), planGapMs: 0,
    planner: (d, signal) => planner.plan(planContext({ decision: d, world: w(), floor: plans.floor() }), signal),
    // 승인 질문 길을 보는 시험이 많아 처음 하는 일 묻기를 켜 둔다(기본 끔은 「기본(처음 하는 일 묻기 끔)」 시험이 askFirst: undefined로 본다)
    toPhone: (m) => phone.push(m), emit: (l) => logs.push(l), clock, locate: (id) => PLACES[id], askFirst: true, ...over, approvals,
  });
  const decide = async (d: DecisionRecord) => {
    decided.push(d);
    t.onDecision(d);
    await t.idle();
  };
  const decisions = () => decided;
  const exec = () => logs.flatMap((l) => (l.type === "execution" ? [l] : []));
  const commands = () => phone.flatMap((m) => (m.type === "command" ? [m] : []));
  /** 새로 읽은 명령(speak)만. */
  const spoken = () => commands().filter((m) => m.speak).map((m) => m.text);
  const last = () => phone.at(-1) as PlannedCommand;
  const steps = () => plans.current()!.steps.map((s) => s.status);
  /** 폰이 들은 말: 새 폰처럼 말할 때 떠 있던 명령(at, 기본은 지금 폰 명령 줄)을 싣는다. 답으로 받았으면 그 답, 아니면(버림·답 아님) null. */
  const heard = (text: string, at: HeardAt = heardAtOf(phone)): ActionChoice | null => {
    const r = t.onHeard(text, at);
    return r?.kind === "answer" ? r.choice : null;
  };
  /** 그 계획의 지금 실제 폰 명령에 답 단추를 누른다. */
  const answer = async (planId: string, choice: string) => {
    const m = phone.findLast((x): x is PlannedCommand => x.type === "command" && x.id === planId);
    expect(m, `${planId}의 명령`).toBeTruthy();
    expect(t.onAnswer(planId, m!.step, choice)).toBe(true);
    await t.idle();
  };
  return { t, decide, decisions, answer, logs, phone, clock, plans, exec, commands, spoken, last, steps, approvals, heard };
}

// 2026-11-20 사용자 「아직도 컵안을 확인해달라는 내용이 없네」, 고른 답: 컵 안 확인은 「늘 확인」, 음료가 남았으면 「버려도 될지 묻기」
describe("컵 치우기: 집기 전에 늘 컵 안을 위에서 본다", () => {
  /** 위에서 보기를 하는 집(계획 맥락 topLook): 계획 검사가 컵 안 보기 단계를 넣는다. 위에서 본 사진 쌍(topReady)과 위에서 보기(lookContents)는 시험이 정한다. */
  it("계획을 만드는 동안 배운 답이 적용되지 않게 되면 첫 명령 전에 위에서 보기를 복원한다", async () => {
    const w = world([cup("present")]);
    const ctx = {...planContext({decision,world:w,floor:smallFloor()}),topLook:true as const};
    const s = setup({
      planner: (d,signal) => testPlanner(llm).plan({...ctx,decision:d,discardLeftover:true},signal),
      discardLeftover: () => false,
      reuse: (d,plan) => resubmit(plan,{...ctx,decision:d}),
    });
    await s.decide(decision);
    expect(s.t.onAnswer(s.last().id,s.last().step,"done")).toBe(true);
    expect(s.last().text).toContain("위에서");
  });

  function topSetup(preference?: {read():boolean; remember(allow:boolean):void}) {
    let w = world([cup("present")]);
    let latestPairStart = -Infinity;
    const looks: ContentsLook[] = [];
    const guards: [string, boolean][] = [];
    const planner = testPlanner(llm);
    const s = setup({
      w: () => w,
      rememberLeftover: preference?.remember,
      planner: (d, signal) => planner.plan({ ...planContext({ decision: d, world: w, floor: smallFloor() }), topLook: true, discardLeftover:preference?.read() }, signal),
      topReady: (_id, since) => latestPairStart >= since, lookContents: (h) => { looks.push(h); return true; }, guardObject: (id, on) => { guards.push([id, on]); },
    });
    /** 컵 안 값(확인됨)을 지금 시계로 둔다. null이면 모름. */
    const contents = (value: string | null) => {
      const c = cup("present", undefined, s.clock.t);
      w = world([value ? { ...c, facts: { contents: { value, at_ms: s.clock.t, since_ms: s.clock.t, certainty: "confirmed" } } } : c]);
    };
    /** 식탁으로 가기를 「완료」로 넘겨 컵 안 보기까지. */
    const toTop = async () => {
      await s.decide(decision);
      expect(s.last()).toMatchObject({ step: "plan:pam-1:1", text: "식탁으로 가 주세요" });
      expect(s.t.onAnswer("plan:pam-1", "plan:pam-1:1", "done")).toBe(true);
    };
    /** 위에서 본 사진 쌍이 모이고 위에서 보기가 끝난다(그 결과로 컵 안 값 value). */
    const seeTop = (value: string | null, photos: string[] = value ? [value, value] : []) => {
      latestPairStart = s.clock.t;
      const count = looks.length;
      s.clock.t += 500;
      s.t.tick();
      expect(looks).toHaveLength(count + 1);
      contents(value);
      looks[count]!.done({ ok: true, frame_id: `top-${count}`, captured_at_ms: s.clock.t, crop: [0, 0, 100, 100], frames: 2, vlm: "ok",
        summary: null, found: [{ id: "cup_1", cls: "cup", score: 1, facts: photos }] });
      s.t.onWorld();
      s.t.tick();
    };
    return { ...s, contents, toTop, seeTop, looks, guards, setWorld: (v: WorldView) => { w = v; } };
  }

  it("다섯 단계 차례: 식탁으로 가기 → 컵 안 보기(위에서 비추기, 단추 없음, 보기 지킴) → 비었으면 컵 집기 → 싱크대로 가기 → 컵 내려놓기", async () => {
    const s = topSetup();
    await s.toTop();
    expect(s.plans.current()!.steps.map((x) => x.label)).toEqual(["식탁으로 가기", TOP_TEXT.label("컵"), STEP_LABEL.pickCup, STEP_LABEL.goSink, STEP_LABEL.placeCup]);
    expect(s.last()).toMatchObject({ step: "plan:pam-1:2", text: PEEK_TEXT.above("컵"), kind: "do", view: "above", choices: [], speak: true, target: { id: "cup_1" } });
    expect(s.guards).toEqual([["cup_1", true]]);
    // 위에서 본 사진 쌍이 모이기 전에는 넘기지 않고, 「완료」 단추도 없다
    s.clock.t += 2000;
    s.t.tick();
    expect(s.looks).toEqual([]);
    expect(s.t.onAnswer("plan:pam-1", "plan:pam-1:2", "done")).toBe(false);
    s.seeTop("empty");
    expect(s.looks[0]).toMatchObject({ planId: "plan:pam-1", objectId: "cup_1", top: { sinceMs: expect.any(Number) } });
    expect(s.last()).toMatchObject({ step: "plan:pam-1:3", text: "컵을 들어 주세요" });
    expect(s.guards).toEqual([["cup_1", true], ["cup_1", false]]);
    for (const n of [3, 4]) expect(s.t.onAnswer("plan:pam-1", `plan:pam-1:${n}`, "done")).toBe(true);
    expect(s.spoken()).toEqual(["식탁으로 가 주세요", PEEK_TEXT.above("컵"), "컵을 들어 주세요", "싱크대로 가 주세요", "컵을 싱크대에 넣어 주세요"]);
  });

  it("옆 사진으로 컵 안을 이미 알아도(비었음) 늘 위에서 본다: 위에서 보기가 끝날 때까지 집기로 넘기지 않는다", async () => {
    const s = topSetup();
    s.contents("empty");
    await s.toTop();
    expect(s.last()).toMatchObject({ step: "plan:pam-1:2", view: "above" });
    s.clock.t += 5000;
    s.t.onWorld();
    s.t.tick();
    expect(s.last()).toMatchObject({ step: "plan:pam-1:2" });
    s.seeTop("empty");
    expect(s.last()).toMatchObject({ step: "plan:pam-1:3", text: "컵을 들어 주세요" });
  });

  it.each(["empty", "has_contents"] as const)("도착 좌표보다 먼저 그 컵 안이 확인되면 접근과 확인을 마친다 (%s)", async (value) => {
    const s = topSetup();
    await s.decide(decision);
    expect(s.last()).toMatchObject({ step: "plan:pam-1:1" });
    const from = s.clock.t;
    s.clock.t += 2000;
    const seen = (id: string, start: number) => ({ ...cup("present", undefined, s.clock.t), id,
      facts: { contents: { value, certainty: "confirmed" as const, at_ms: s.clock.t, since_ms: start, inside_ms: [start, s.clock.t] as [number, number] } } });
    s.setWorld(world([cup("present", undefined, s.clock.t), seen("cup_2", from)]));
    s.t.onWorld();
    s.setWorld(world([seen("cup_1", from - 1)]));
    s.t.onWorld();
    expect(s.last()).toMatchObject({ step: "plan:pam-1:1" });
    s.setWorld(world([seen("cup_1", from)]));
    s.t.onWorld();
    expect(s.last()?.text).toBe(value === "empty" ? "컵을 들어 주세요" : TOP_TEXT.ask);
    expect(s.looks).toHaveLength(0);
    expect(s.spoken()).not.toContain(PEEK_TEXT.above("컵"));
  });

  it("음료가 남았으면 실제 폰에 「남은 음료를 버리고 치울까요?」(치워 주세요·그대로 둬요)를 묻고, 「치워 주세요」(말로도)면 컵 집기로 이어 간다", async () => {
    const s = topSetup();
    await s.toTop();
    s.seeTop("has_contents");
    expect(s.last()).toEqual({
      type: "command", id: "plan:pam-1", step: "plan:pam-1:2:leftover", text: TOP_TEXT.ask, vision: null,
      choices: [{ id: "clear", label: "치워 주세요" }, { id: "keep", label: "그대로 둬요" }], target: null, speak: true, grade: "question",
    });
    expect(s.plans.current()).toMatchObject({ status: "running" });
    expect(s.heard("치워 주세요")).toMatchObject({ id: "clear" });
    expect(s.last()).toMatchObject({ step: "plan:pam-1:3", text: "컵을 들어 주세요" });
  });

  it.each([["치워 주세요",true],["그대로 둬요",false]] as const)("남은 음료에 대한 말 답 %s를 다음 계획에 쓴다", async (speech,allow) => {
    const db=HistoryDb.open(":memory:");
    try {
      const read=()=>db.cupAnswers.allowDiscard("home","resident");
      const s=topSetup({read,remember:value=>db.cupAnswers.remember("home","resident",value)});
      await s.toTop();
      s.seeTop("has_contents");
      db.cupAnswers.remember("home","resident",!allow);
      expect(s.heard(speech)?.id).toBe(allow ? "clear" : "keep");
      expect(read()).toBe(allow);
      const next=topSetup({read,remember:()=>{}});
      await next.toTop();
      expect(next.last().text).toBe(allow ? "컵을 들어 주세요" : PEEK_TEXT.above("컵"));
    } finally {db.close();}
  });

  it("컵 안을 비추는 동안 새로 잰 컵 가운데를 폰에 조용히 보내고 사진을 자주 받는다", async () => {
    const s = topSetup();
    await s.toTop();
    const c = cup("present", undefined, s.clock.t);
    const center: [number, number, number] = [1.2, 0.75, 1.5];
    s.setWorld(world([{ ...c, size_m: { width: 0.1, height: 0.15, center } }]));
    s.clock.t += 1500;
    s.t.onWorld();
    s.t.tick();
    expect(s.last()).toMatchObject({ view: "above", speak: false, target: { id: c.id, position: center } });
    expect(s.t.fastVlm()).toBe(true);
    s.t.stop();
    expect(s.guards.at(-1)).toEqual([c.id, false]);
    expect(s.t.fastVlm()).toBe(false);
  });

  it.each([{ photos: [] }, { photos: ["empty"] }, { photos: ["empty", "has_contents"] }])("위 사진 두 장이 같은 답을 주지 않으면 옆 사진의 비었음으로 집지 않는다 ($photos)", async ({ photos }) => {
    const s = topSetup();
    s.contents("empty");
    await s.toTop();
    s.seeTop("empty", photos);
    s.clock.t += CONTENTS_HOLD.settleMs;
    s.t.tick();
    expect(s.exec().at(-1)).toMatchObject({ state: "failed", text: EXEC_TEXT.topUnknown });
  });

  it("앞 사진에서 컵 안이 모호하면 기다리는 동안 새 사진 쌍으로 한 번 다시 보고 남은 음료를 묻는다", async () => {
    const s = topSetup();
    await s.toTop();
    s.seeTop(null);
    s.t.tick();
    expect(s.looks).toHaveLength(1);
    s.clock.t += 1600;
    s.seeTop("has_contents");
    expect(s.looks[1]!.top!.sinceMs).toBeGreaterThan(s.looks[0]!.top!.sinceMs);
    expect(s.last()).toMatchObject({ text: TOP_TEXT.ask, grade: "question" });
  });

  it("「그대로 둬요」면 치우지 않고 계획을 끝낸다(완료 문장 없음). 그 컵만 남았으면 다음 판단도 치우지 않고, 사람이 다시 보이면 다시 치울 수 있다", async () => {
    const s = topSetup();
    await s.toTop();
    s.seeTop("has_contents");
    expect(s.t.onAnswer("plan:pam-1", "plan:pam-1:2:leftover", "keep")).toBe(true);
    expect(s.plans.current()).toMatchObject({ status: "cancelled" });
    expect(s.exec().filter((l) => l.plan_id === "plan:pam-1").at(-1)).toMatchObject({ state: "failed", text: EXEC_TEXT.kept });
    s.t.tick();
    expect(s.phone.some((m) => m.type === "command" && m.id.startsWith("done:"))).toBe(false);
    const sent = s.commands().length;
    await s.decide({ ...decision, id: "pam-2", seq: 2, atMs: s.clock.t });
    expect(s.exec().filter((l) => l.plan_id === "plan:pam-2").map((l) => [l.state, l.text])).toEqual([["decided", EXEC_TEXT.decided], ["failed", CHECK_TEXT.kept]]);
    expect(s.commands().filter((c) => c.id === "plan:pam-2")).toHaveLength(0);
    // 사람이 다시 보였다가 떠난 뒤의 판단은 다시 치운다
    s.clock.t += 1000;
    const c = cup("present", undefined, s.clock.t);
    s.setWorld({ ...world([c]), person: { ...world([c]).person, visible: true, since_ms: s.clock.t } });
    s.clock.t += 10_000;
    await s.decide({ ...decision, id: "pam-3", seq: 3, atMs: s.clock.t });
    expect(s.commands().length).toBeGreaterThan(sent);
    expect(s.last()).toMatchObject({ id: "plan:pam-3", text: "식탁으로 가 주세요" });
  });

  it("위에서 봐도 모르면 사진을 더 기다린 뒤(settleMs) 그만둔다: 사용자에게 비었는지 묻지 않는다", async () => {
    const s = topSetup();
    await s.toTop();
    s.seeTop(null);
    expect(s.plans.current()).toMatchObject({ status: "running" });
    s.clock.t += CONTENTS_HOLD.settleMs;
    s.t.tick();
    expect(s.plans.current()).toMatchObject({ status: "failed" });
    expect(s.exec().at(-1)).toMatchObject({ state: "failed", text: EXEC_TEXT.topUnknown });
    expect(s.commands().some((c) => c.text === TOP_TEXT.ask || c.choices.length > 1)).toBe(false);
    expect(s.guards.at(-1)).toEqual(["cup_1", false]);
  });

  it("위에서 보기를 하지 않는 집(계획 맥락 topLook 없음)·컵 치우기가 아닌 행동의 계획에는 컵 안 보기 단계가 없다", async () => {
    const s = setup();
    await s.decide(decision);
    expect(s.plans.current()!.steps.map((x) => x.label)).toEqual([STEP_LABEL.goTable, STEP_LABEL.pickCup, STEP_LABEL.goSink, STEP_LABEL.placeCup]);
  });
});

describe("실행 추적: 단계마다 실제 폰 명령", () => {
  // 가로 유리컵 실제 판 r5(2026-11-18): 집기·내려놓기 중 들린 컵·놓인 컵이 새 id가 돼 단계가 늦거나 끝나지 않았다. 실행 추적이 지금 대상을 World State에 알린다
  it("집기·내려놓기 단계가 되면 그 대상과 자리(집기는 컵 자리, 내려놓기는 목적지)를 World State focus로 알리고, 다른 단계·계획 끝에는 푼다", async () => {
    let w = world([cup("present")]);
    const focuses: [string | null, unknown][] = [];
    const { t, decide, clock } = setup({ w: () => w, focusObject: (id, f) => { focuses.push([id, f ?? null]); } });
    await decide(decision);
    clock.t += 600;
    t.onEye([6.2, 3]);
    t.tick();
    expect(focuses.at(-1)).toEqual(["cup_1", { step: "pick", spot: [2, 1] }]);
    clock.t += 600;
    w = world([cup("present", "in_hand", clock.t)]);
    t.onWorld();
    // 집기 뒤 내려놓기까지(싱크대로 가는 동안)는 든 물건으로 알린다(가로 머그 r4: 가는 중 손에 든 머그가 새 id가 됐다)
    expect(focuses.at(-1)).toEqual(["cup_1", { step: "carry", spot: null }]);
    clock.t += 600;
    t.onEye([5.3, 1.5]);
    t.tick();
    expect(focuses.at(-1)).toEqual(["cup_1", { step: "place", spot: expect.any(Array) }]);
    // Codex(02dda8c 2): 실행 추적이 따라가는 id가 새 id로 바뀌면 focus도 새 대상으로
    clock.t += 600;
    w = world([cup("gone", "in_hand", clock.t - 600), { ...cup("present", "in_sink", clock.t), id: "cup_2", first_seen_ms: clock.t }]);
    t.onWorld();
    expect(focuses.some(([id]) => id === "cup_2")).toBe(true);
    // Codex(02dda8c 3): 멈추면 푼다
    t.stop();
    expect(focuses.at(-1)).toEqual([null, null]);
  });

  it("컵 치우기는 단계마다 사람에게 하는 명령 하나를 보내고, 폰 위치와 World State로 그 단계가 된 것을 본 뒤 다음 명령을 보낸다", async () => {
    let w = world([cup("present")]);
    const { t, decide, phone, clock, plans, exec, commands, spoken, last, steps } = setup({ w: () => w });
    await decide(decision);
    // 1 이동: 폰 눈을 아직 모르면 거리 모름
    // 명령 대상(실제 폰 고리)은 식탁 → 컵 → 싱크대 → 싱크대
    expect(phone).toEqual([{ type: "command", id: "plan:pam-1", step: "plan:pam-1:1", text: "식탁으로 가 주세요", vision: "식탁까지 거리 모름", choices: DONE, target: TABLE, speak: true, kind: "go" }]);
    expect(plans.current()).toMatchObject({ id: "plan:pam-1", status: "running" });
    expect(steps()).toEqual(["active", "pending", "pending", "pending"]);
    clock.t += 600;
    t.onEye([1, 2]);
    t.tick();
    expect(last()).toMatchObject({ step: "plan:pam-1:1", vision: "식탁까지 6.1m", speak: false });
    clock.t += 600;
    t.onEye([6.2, 3]);
    t.tick();
    // 2 집기: 식탁 가까이(1.2m 안)라 다음 명령, 컵 자리는 World State
    expect(last()).toEqual({
      type: "command", id: "plan:pam-1", step: "plan:pam-1:2", text: "컵을 들어 주세요", vision: "컵 · 식탁 위", choices: DONE,
      target: { id: "cup_1", label: "컵", position: [2, 0.75, 1] }, speak: true, kind: "pick",
    });
    expect(steps()).toEqual(["done", "active", "pending", "pending"]);
    clock.t += 600;
    w = world([cup("present", "in_hand", clock.t)]);
    t.onWorld();
    // 3 이동: 컵이 손에 있음
    expect(last()).toMatchObject({ step: "plan:pam-1:3", text: "싱크대로 가 주세요", vision: "컵 · 손에 있음 · 싱크대까지 2.3m", target: SINK, speak: true, kind: "go" });
    expect(steps()).toEqual(["done", "done", "active", "pending"]);
    // 싱크대에서 1.3m면 아직 안 넘긴다(비전 상태만 바뀐다)
    clock.t += 600;
    t.onEye([5, 2.3]);
    t.tick();
    expect(last()).toMatchObject({ step: "plan:pam-1:3", vision: "컵 · 손에 있음 · 싱크대까지 1.3m", speak: false });
    expect(steps()).toEqual(["done", "done", "active", "pending"]);
    clock.t += 600;
    t.onEye([5.3, 1.5]);
    t.tick();
    // 4 내려놓기
    expect(last()).toMatchObject({ step: "plan:pam-1:4", text: "컵을 싱크대에 넣어 주세요", vision: "컵 · 손에 있음", target: SINK, speak: true, kind: "place" });
    expect(steps()).toEqual(["done", "done", "done", "active"]);
    // 컵이 아직 손에 있으면 안 넘긴다. 싱크대 면 위(트윈 위치)여도 손에 있으면 안 넘긴다
    clock.t += 600;
    t.onWorld();
    t.tick();
    expect(last()).toMatchObject({ step: "plan:pam-1:4" });
    expect(steps()).toEqual(["done", "done", "done", "active"]);
    clock.t += 600;
    w = world([{ ...cup("present", "in_hand", clock.t), surface: "sink_1", surface_label: "싱크대" }]);
    t.onWorld();
    t.tick();
    expect(last()).toMatchObject({ step: "plan:pam-1:4" });
    expect(steps()).toEqual(["done", "done", "done", "active"]);
    clock.t += 600;
    w = world([cup("present", "in_sink", clock.t)]);
    t.onWorld();
    // 싱크대 안이면 명령을 지우고 계획 완료
    expect(last()).toEqual({ type: "command_clear", id: "plan:pam-1" });
    expect(plans.current()).toMatchObject({ status: "done", steps: [{ status: "done" }, { status: "done" }, { status: "done" }, { status: "done" }] });
    expect(exec().map((l) => l.state)).toEqual(["decided", "planned", "running", "done"]);
    expect(exec().every((l) => l.plan_id === "plan:pam-1")).toBe(true);
    expect(spoken()).toEqual(["식탁으로 가 주세요", "컵을 들어 주세요", "싱크대로 가 주세요", "컵을 싱크대에 넣어 주세요"]);
    // 명령은 사람에게 하는 말이다(클로이드가 스스로 하는 말이 아니다). 답 단추는 「완료」 하나(나중에 없음)
    for (const text of Object.values(STEP_COMMAND)) expect(text).toMatch(/주세요$/);
    expect(commands().every((m) => JSON.stringify(m.choices) === JSON.stringify(DONE))).toBe(true);
    expect(t.current()).toMatchObject({ planId: "plan:pam-1", state: "done" });
  });

  // 2026-11-20 사용자 「컵치우기를 완료했다는 완료메시지도 없다」: 계획을 마치면 실제 폰 명령 줄(새 자리 없이)에 완료 문장을 띄운다
  it("계획을 끝까지 마치면 다음 타이머에 실제 폰 명령 줄에 완료 문장(「컵을 다 치웠어요.」, 답 단추 없음)을 소리와 함께 띄우고, DONE_NOTICE_MS 뒤 지운다. 그만·실패면 띄우지 않는다", async () => {
    let w = world([cup("present")]);
    const { t, decide, clock, last, phone } = setup({ w: () => w });
    await decide(decision);
    for (const n of [1, 2, 3]) t.onAnswer("plan:pam-1", `plan:pam-1:${n}`, "done");
    clock.t += 600;
    w = world([cup("present", "in_sink", clock.t)]);
    t.onWorld();
    expect(last()).toEqual({ type: "command_clear", id: "plan:pam-1" });
    t.tick();
    expect(last()).toEqual({ type: "command", id: "done:plan:pam-1", step: "done:plan:pam-1:1", text: "컵을 다 치웠어요.", vision: null, choices: [], target: null, speak: true });
    const sent = phone.length;
    clock.t += DONE_NOTICE_MS - 1;
    t.tick();
    expect(phone).toHaveLength(sent);
    clock.t += 1;
    t.tick();
    expect(last()).toEqual({ type: "command_clear", id: "done:plan:pam-1" });
    // 그만으로 닫은 계획은 완료 문장이 없다
    const stop = setup();
    await stop.decide(decision);
    stop.t.onHeard("그만", heardAtOf(stop.phone));
    stop.t.tick();
    expect(stop.phone.some((m) => m.type === "command" && m.id.startsWith("done:"))).toBe(false);
  });

  it("집기는 사람이 물건을 들고 있어도(holding_object) 된 것으로 본다", async () => {
    let w = world([cup("present")]);
    const { t, decide, last } = setup({ w: () => w });
    await decide(decision);
    t.onAnswer("plan:pam-1", "plan:pam-1:1", "done");
    expect(last()).toMatchObject({ step: "plan:pam-1:2" });
    w = world([cup("present")], "holding_object", 10_000);
    t.onWorld();
    expect(last()).toMatchObject({ step: "plan:pam-1:3", text: "싱크대로 가 주세요" });
  });

  it("놓기: 컵이 싱크볼 안이고 손에 없어도 사람이 그 컵을 들고 있다는 근거(person_holding)가 있으면 넘기지 않는다. 분석한 프레임에 사람이 안 보이면 넘긴다", async () => {
    let w = world([cup("present")]);
    const { t, decide, clock, last, plans } = setup({ w: () => w });
    await decide(decision);
    for (const n of [1, 2, 3]) t.onAnswer("plan:pam-1", `plan:pam-1:${n}`, "done");
    expect(last()).toMatchObject({ step: "plan:pam-1:4" });
    clock.t += 600;
    const onSink: WorldObject = { ...cup("present", "on_table", clock.t), surface: "sink_1", surface_label: "싱크대", surface_part: "basin" };
    const held = world([onSink], "holding_object", clock.t);
    w = { ...held, frame_ms: clock.t, person: { ...held.person, holding: ["cup_1"] } };
    t.onWorld();
    t.tick();
    expect(last()).toMatchObject({ step: "plan:pam-1:4" });
    // 든 것을 모를 때(관절로 이은 물건 없음)도 그 컵일 수 있어 넘기지 않는다
    w = { ...held, frame_ms: clock.t };
    t.onWorld();
    expect(last()).toMatchObject({ step: "plan:pam-1:4" });
    expect(plans.current()).toMatchObject({ status: "running" });
    clock.t += 600;
    w = { ...world([{ ...onSink, last_seen_ms: clock.t }]), frame_ms: clock.t };
    t.onWorld();
    expect(last()).toEqual({ type: "command_clear", id: "plan:pam-1" });
    expect(plans.current()).toMatchObject({ status: "done" });
  });

  it("컵이 움직여 World State가 새 id를 붙여도(맞춘 카메라, 0.25m 넘게) 같은 컵으로 보고, 그 사이 판단은 같은 행동으로 이어 간다", async () => {
    // cup_9는 계획 전부터 싱크대 안에 있던 다른 컵: 내려놓기로 보지 않는다
    const other = { ...cup("present", "in_sink", 8_000), id: "cup_9" };
    let w = world([cup("present"), other]);
    const { t, decide, logs, plans, last, steps } = setup({ w: () => w });
    await decide(decision);
    t.onAnswer("plan:pam-1", "plan:pam-1:1", "done");
    // 집기: 손에 든 컵이 cup_2로 보이고 식탁 자리 cup_1은 사라짐
    w = world([{ ...cup("gone"), last_seen_ms: 9_000 }, { ...cup("present", "in_hand", 10_000), id: "cup_2", first_seen_ms: 9_400 }, other]);
    t.onWorld();
    expect(last()).toMatchObject({ step: "plan:pam-1:3", vision: "컵 · 손에 있음 · 싱크대까지 거리 모름" });
    // 새 판단의 대상이 새 id(cup_2)여도 같은 행동: 1단계부터 다시 하지 않는다
    await decide({ ...decision, id: "pam-2", seq: 2 });
    expect(logs.at(-1)).toMatchObject({ type: "execution", plan_id: "plan:pam-2", text: EXEC_TEXT.same });
    expect(plans.current()).toMatchObject({ id: "plan:pam-1", status: "running" });
    t.onAnswer("plan:pam-1", "plan:pam-1:3", "done");
    expect(last()).toMatchObject({ step: "plan:pam-1:4", vision: "컵 · 손에 있음" });
    t.tick();
    expect(steps()).toEqual(["done", "done", "done", "active"]);
    // 내려놓기: 싱크대 안 컵이 또 새 id(cup_3)
    w = world([{ ...cup("gone"), last_seen_ms: 9_000 }, { ...cup("gone", "in_hand", 9_500), id: "cup_2", first_seen_ms: 9_400 }, { ...cup("present", "in_sink", 10_000), id: "cup_3", first_seen_ms: 9_800 }, other]);
    t.onWorld();
    expect(last()).toEqual({ type: "command_clear", id: "plan:pam-1" });
    expect(plans.current()).toMatchObject({ id: "plan:pam-1", status: "done" });
  });

  it("완료 단추와 말(완료·다 했어)은 지금 단계 하나만 넘긴다. 지난 단계·다른 계획·없는 답은 무시한다", async () => {
    const { t, heard, decide, spoken, steps, last } = setup();
    await decide(decision);
    expect(t.onAnswer("plan:pam-1", "plan:pam-1:1", "done")).toBe(true);
    expect(t.onAnswer("plan:pam-1", "plan:pam-1:1", "done")).toBe(false);
    expect(t.onAnswer("plan:other", "plan:pam-1:2", "done")).toBe(false);
    expect(t.onAnswer("plan:pam-1", "plan:pam-1:2", "later")).toBe(false);
    expect(steps()).toEqual(["done", "active", "pending", "pending"]);
    expect(heard("완료")).toMatchObject({ id: "done", reply: "" });
    expect(steps()).toEqual(["done", "done", "active", "pending"]);
    expect(heard("응 다 했어")).toMatchObject({ id: "done" });
    expect(steps()).toEqual(["done", "done", "done", "active"]);
    expect(heard("불 꺼 줘")).toBeNull();
    expect(last()).toMatchObject({ step: "plan:pam-1:4" });
    expect(t.onAnswer("plan:pam-1", "plan:pam-1:4", "done")).toBe(true);
    expect(last()).toEqual({ type: "command_clear", id: "plan:pam-1" });
    expect(spoken()).toEqual(["식탁으로 가 주세요", "컵을 들어 주세요", "싱크대로 가 주세요", "컵을 싱크대에 넣어 주세요"]);
    expect(heard("완료")).toBeNull();
  });

  it("한 번 볼 때 한 단계만 넘긴다: 컵을 든 채 싱크대 옆이어도 집기 다음 tick에 이동을 넘긴다", async () => {
    let w = world([cup("present")]);
    const { t, decide, steps } = setup({ w: () => w });
    await decide(decision);
    t.onAnswer("plan:pam-1", "plan:pam-1:1", "done");
    w = world([cup("present", "in_hand", 10_000)]);
    t.onEye([5, 1.5]);
    t.tick();
    expect(steps()).toEqual(["done", "done", "active", "pending"]);
    t.tick();
    expect(steps()).toEqual(["done", "done", "done", "active"]);
  });

  it("말로 「그만」이면 명령을 지우고 계획을 취소한다. 실행 기록은 실패(그만둠)", async () => {
    const { t, heard, decide, plans, exec, last } = setup();
    await decide(decision);
    t.onAnswer("plan:pam-1", "plan:pam-1:1", "done");
    expect(heard("이제 그만")).toMatchObject({ id: "stop", reply: "" });
    expect(last()).toEqual({ type: "command_clear", id: "plan:pam-1" });
    expect(plans.current()).toMatchObject({ status: "cancelled", steps: [{ status: "done" }, { status: "skipped" }, { status: "skipped" }, { status: "skipped" }] });
    expect(exec().at(-1)).toMatchObject({ state: "failed", text: EXEC_TEXT.stopped });
    expect(t.openCommand()).toBeNull();
    expect(heard("그만")).toBeNull();
  });

  it("한 단계가 오래 걸리면 30초마다 명령을 다시 읽고, 2분이 지나면 실패로 닫는다. 다음 단계로 가면 다시 잰다", async () => {
    expect(TRACK_DEFAULTS).toMatchObject({ repeatMs: 30_000, visionMs: 500, recheckMs: 3000, askMs: 120_000, planGapMs: 15_000, stallMs: 8000, stallMax: 3, offHoldMs: 120_000 });
    const { t, decide, clock, spoken, plans, exec, last } = setup();
    await decide(decision);
    clock.t += 29_999;
    t.tick();
    expect(spoken()).toEqual(["식탁으로 가 주세요"]);
    clock.t += 1;
    t.tick();
    expect(spoken()).toEqual(["식탁으로 가 주세요", "식탁으로 가 주세요"]);
    expect(last()).toMatchObject({ step: "plan:pam-1:1", speak: true });
    clock.t += 30_000;
    t.tick();
    expect(spoken()).toHaveLength(3);
    t.onAnswer("plan:pam-1", "plan:pam-1:1", "done");
    for (let i = 0; i < 4; i++) {
      clock.t += 30_000;
      t.tick();
    }
    expect(t.current()).toMatchObject({ state: "running" });
    expect(spoken()).toEqual(["식탁으로 가 주세요", "식탁으로 가 주세요", "식탁으로 가 주세요", "컵을 들어 주세요", "컵을 들어 주세요", "컵을 들어 주세요", "컵을 들어 주세요", "컵을 들어 주세요"]);
    clock.t += 1;
    t.tick();
    expect(exec().at(-1)).toMatchObject({ state: "failed", text: EXEC_TEXT.timeout });
    expect(last()).toEqual({ type: "command_clear", id: "plan:pam-1" });
    expect(plans.current()).toMatchObject({ status: "failed", steps: [{ status: "done" }, { status: "failed" }, { status: "skipped" }, { status: "skipped" }] });
  });

  it("비전 상태는 바뀔 때만, 0.5초에 한 번까지 보낸다", async () => {
    const { t, decide, clock, phone } = setup();
    await decide(decision);
    t.onEye([1, 2]);
    clock.t += 100;
    t.tick();
    expect(phone).toHaveLength(1);
    clock.t += 400;
    t.tick();
    expect(phone.map((m) => m.type === "command" && m.vision)).toEqual(["식탁까지 거리 모름", "식탁까지 6.1m"]);
    clock.t += 500;
    t.tick();
    expect(phone).toHaveLength(2);
    t.onEye([2, 2], true);
    clock.t += 500;
    t.tick();
    expect(phone).toHaveLength(2);
    t.onEye([4, 2.8]);
    clock.t += 500;
    t.tick();
    expect(phone.at(-1)).toMatchObject({ vision: "식탁까지 3.0m", speak: false });
  });

  it("물어보기는 같은 자리에 질문과 답 단추를 띄우고, 답(단추·말)을 받으면 명령을 지우고 완료. 「완료」 단추는 없다", async () => {
    const a = setup();
    await a.decide(ask("pam-1", 1));
    expect(a.phone).toEqual([{
      type: "command", id: "plan:pam-1", step: "plan:pam-1:1", text: "컵을 치울까요?", vision: null,
      choices: [{ id: "clear", label: "치워 주세요" }, { id: "keep", label: "그대로 둬요" }], target: null, speak: true, grade: "question",
    }]);
    expect(a.steps()).toEqual(["active"]);
    expect(a.t.onAnswer("plan:pam-1", "plan:pam-1:1", "done")).toBe(false);
    expect(a.heard("완료")).toBeNull();
    expect(a.heard("그냥 그대로 둬")).toMatchObject({ id: "keep", reply: "알겠어요. 그대로 둘게요" });
    expect(a.exec().at(-1)).toMatchObject({ state: "done", text: "완료: 그대로 둬요" });
    expect(a.last()).toEqual({ type: "command_clear", id: "plan:pam-1" });
    expect(a.plans.current()).toMatchObject({ status: "done", steps: [{ status: "done" }] });
    const b = setup();
    await b.decide(ask("pam-1", 1));
    expect(b.t.onAnswer("plan:pam-1", "plan:pam-1:1", "clear")).toBe(true);
    // 「치워 주세요」는 묻기 계획을 닫고 컵 치우기를 말 부탁 길로 시작한다(아래 「말 부탁 → 계획 모드」)
    expect(b.exec()).toContainEqual(expect.objectContaining({ plan_id: "plan:pam-1", state: "done", text: "완료: 치워 주세요" }));
    const c = setup();
    await c.decide(ask("pam-1", 1));
    c.clock.t += 120_001;
    c.t.tick();
    expect(c.exec().at(-1)).toMatchObject({ state: "failed", text: EXEC_TEXT.noAnswer });
  });

  it("다른 행동을 고른 새 판단은 진행 중 계획을 바꾸고, 실제 폰의 앞 명령을 지운 뒤 새 명령을 보낸다", async () => {
    const { t, decide, phone, plans, exec } = setup();
    await decide(decision);
    await decide(ask("pam-2", 2));
    expect(exec().find((l) => l.plan_id === "plan:pam-1" && l.state === "failed")).toMatchObject({ text: EXEC_TEXT.superseded });
    expect(phone.map((m) => [m.type, m.id])).toEqual([["command", "plan:pam-1"], ["command_clear", "plan:pam-1"], ["command", "plan:pam-2"]]);
    expect(plans.current()).toMatchObject({ id: "plan:pam-2", supersedes: "plan:pam-1", status: "running" });
  });
});

describe("실행 추적: 그 자리에서 하는 일(do, 채워 주기)", () => {
  const WATER = "컵에 물 채워 주기";
  const water: DecisionRecord = { ...decision, action: WATER, prediction: { ...pred, task_index: 4 } };
  const FRIDGE = { id: "fridge_1", label: "냉장고", position: [7.5, 0.9, 0.5] as [number, number, number] };
  const fridgeFloor = () => floorPlanFrom({ ...structuredClone(SMALL_SCENE), objects: [...structuredClone(SMALL_SCENE.objects), { id: "fridge_1", type: "fridge", room: "kitchen", plan: { position: [7.5, 0.5] } }] });
  const fact = (value: string, at: number) => ({ value, at_ms: at, since_ms: at, certainty: "confirmed" as const });
  /** 식탁 위 컵. contents: 컵 안 사실과 그 시각. */
  const tableCup = (contents?: [string, number], seen = 9_000): WorldObject => ({ ...cup("present", undefined, seen), ...(contents ? { facts: { contents: fact(contents[0], contents[1]) } } : {}) });
  const bottle = (place: string, at: number): WorldObject => ({ ...cup("present", place, at), id: "bottle_1", cls: "bottle", surface: null, surface_label: null, first_seen_ms: at });
  function fillSetup(over: Parameters<typeof setup>[0] = {}) {
    const plans = new PlanHub(fridgeFloor(), () => {}, () => "t");
    llm.scripts[WATER] = () => [planCalls(fillSteps({ fridge: "fridge_1", table: "table_1", cup: "cup_1", drink: "물" }))];
    return setup({ plans, locate: (id) => ({ ...PLACES, fridge_1: FRIDGE })[id], approvals: store({ [`task:${WATER}`]: "approve" }), ...over });
  }

  // 2026-11-19 실제 모델(마시는 중 계속 요청 5번 중 1번): 마시는 중에 물 채우기 화살표를 잘못 일으켰다. 물건 조건(비어 있음)은 행동 쪽 검사가 본다
  it("마시는 중에 물 채우기 판단이 잘못 와도 컵에 내용물이 있다고 확인됐으면 계획 전 검사가 막고, 계획 전 검사를 건너뛰어도 쓰는 동안은 첫 명령을 미루다 떠난 뒤 실행 전 검사가 막아 실제 폰 명령이 없다", async () => {
    let using = true;
    const w = (): WorldView => {
      const b = world([tableCup(["has_contents", 9_000])]);
      return using ? { ...b, person: { ...b.person, visible: true, since_ms: 0, count: 1, holding: ["cup_1"], facts: { holding: fact("holding_object", 9_500), activity: fact("drinking", 9_500) } } } : b;
    };
    const pre = fillSetup({ w, precheck: (d) => checkDecision({ decision: d, tasks: [WATER], world: w() }) });
    await pre.decide(water);
    expect(pre.commands()).toEqual([]);
    expect(pre.exec().at(-1)).toMatchObject({ plan_id: "plan:pam-1", state: "failed", text: CHECK_TEXT.contents_mismatch });
    const run = fillSetup({ w, check: () => checkPlan({ decision: water, tasks: [WATER], plan: run.plans.current()!, world: w(), nowMs: run.clock.t, staleMs: 600_000, mode: "test" }) });
    await run.decide(water);
    expect(run.commands()).toEqual([]);
    using = false;
    run.t.onWorld();
    for (let i = 0; i < 20; i++) { run.clock.t += 250; run.t.tick(); }
    expect(run.commands()).toEqual([]);
    expect(run.exec().at(-1)).toMatchObject({ plan_id: "plan:pam-1", state: "failed", text: CHECK_TEXT.contents_mismatch });
  });

  // Codex(638302d use.ts:104): 채우기 계획의 첫 act 대상(냉장고·병)으로 보호를 검사해 쓰는 중인 컵을 지나쳐 첫 명령이 나갔다
  it("사람이 그 컵을 쓰는 중이면 물 채워 주기 계획도 첫 명령을 미룬다(첫 단계 대상이 냉장고·병이어도 계획이 다루는 컵을 본다)", async () => {
    const w = (): WorldView => {
      const b = world([tableCup(["empty", 9_000])]);
      return { ...b, person: { ...b.person, visible: true, since_ms: 0, count: 1, holding: ["cup_1"], facts: { holding: fact("holding_object", 9_500) } } };
    };
    const s = fillSetup({ w });
    await s.decide(water);
    expect(s.commands()).toEqual([]);
    expect(s.exec().at(-1)).toMatchObject({ plan_id: "plan:pam-1", state: "planned", text: EXEC_TEXT.inUse });
  });

  it("물 채워 주기는 네 명령을 차례로 보내고 kind는 go·pick·go·do다. 병 집기는 병이 손에 있음일 때, 따르기는 컵이 내용물 있음일 때만 넘어간다. 답 단추는 「완료」 하나다", async () => {
    let w = world([tableCup(["empty", 9_000])]);
    const { t, decide, clock, plans, exec, commands, spoken, last, steps } = fillSetup({ w: () => w });
    await decide(water);
    expect(last()).toEqual({ type: "command", id: "plan:pam-1", step: "plan:pam-1:1", text: "냉장고로 가 주세요", vision: "냉장고까지 거리 모름", choices: DONE, target: FRIDGE, speak: true, kind: "go" });
    expect(plans.current()).toMatchObject({ goal: WATER, status: "running" });
    clock.t += 600;
    t.onEye([7.2, 1]);
    t.tick();
    // 2 병 집기: 병은 냉장고 안이라 안 보인다. 대상(고리)은 냉장고, 비전 상태 줄은 없다
    expect(last()).toEqual({ type: "command", id: "plan:pam-1", step: "plan:pam-1:2", text: "물병을 꺼내 주세요", vision: null, choices: DONE, target: FRIDGE, speak: true, kind: "pick" });
    // 사람이 무엇인가 들고 있어도(든 것을 모름) 병이 손에 있다고 보이지 않으면 넘기지 않는다
    clock.t += 600;
    w = world([tableCup(["empty", 9_000])], "holding_object", clock.t);
    t.onWorld();
    t.tick();
    expect(last()).toMatchObject({ step: "plan:pam-1:2" });
    // 병이 보여도 냉장고 안이면 넘기지 않는다
    clock.t += 600;
    w = world([tableCup(["empty", 9_000]), bottle("in_fridge", clock.t)]);
    t.onWorld();
    expect(last()).toMatchObject({ step: "plan:pam-1:2" });
    clock.t += 600;
    w = world([tableCup(["empty", 9_000]), bottle("in_hand", clock.t)], "holding_object", clock.t);
    t.onWorld();
    expect(last()).toMatchObject({ step: "plan:pam-1:3", text: "식탁으로 가 주세요", vision: "식탁까지 2.0m", target: TABLE, speak: true, kind: "go" });
    expect(steps()).toEqual(["done", "done", "active", "pending"]);
    clock.t += 600;
    t.onEye([6.5, 3]);
    t.tick();
    // 4 따르기: 대상은 그 컵, 비전 상태 줄은 컵 안의 지금 값
    expect(last()).toEqual({
      type: "command", id: "plan:pam-1", step: "plan:pam-1:4", text: "컵에 물을 따라 주세요", vision: "컵 · 비어 있음", choices: DONE,
      target: { id: "cup_1", label: "컵", position: [2, 0.75, 1] }, speak: true, kind: "do",
    });
    clock.t += 600;
    t.onWorld();
    t.tick();
    expect(last()).toMatchObject({ step: "plan:pam-1:4" });
    expect(steps()).toEqual(["done", "done", "done", "active"]);
    // 따른 뒤: 컵이 내용물 있음이면 「완료」 없이 끝난다
    clock.t += 600;
    w = world([tableCup(["has_contents", clock.t], clock.t), bottle("on_table", clock.t)]);
    t.onWorld();
    expect(last()).toEqual({ type: "command_clear", id: "plan:pam-1" });
    expect(plans.current()).toMatchObject({ status: "done" });
    expect(exec().map((l) => l.state)).toEqual(["decided", "planned", "running", "done"]);
    expect(spoken()).toEqual(["냉장고로 가 주세요", "물병을 꺼내 주세요", "식탁으로 가 주세요", "컵에 물을 따라 주세요"]);
    expect(commands().filter((m) => m.speak).map((m) => m.kind)).toEqual(["go", "pick", "go", "do"]);
    expect(commands().every((m) => JSON.stringify(m.choices) === JSON.stringify(DONE))).toBe(true);
    // 따르기는 놓기가 아니다: 그 컵은 치운 것으로 남지 않는다
    expect([...t.placed().keys()]).toEqual([]);
  });

  it("단계 시작 전에 본 내용물 있음으로는 따르기를 넘기지 않는다. 비전 상태 줄은 값이 바뀌면 다시 보낸다. 「완료」로도 넘어간다", async () => {
    let w = world([tableCup(["has_contents", 9_000])]);
    const { t, decide, clock, plans, last } = fillSetup({ w: () => w });
    await decide(water);
    for (const n of [1, 2, 3]) t.onAnswer("plan:pam-1", `plan:pam-1:${n}`, "done");
    expect(last()).toMatchObject({ step: "plan:pam-1:4", vision: "컵 · 내용물 있음", kind: "do" });
    clock.t += 600;
    t.onWorld();
    t.tick();
    expect(last()).toMatchObject({ step: "plan:pam-1:4" });
    clock.t += 600;
    w = world([tableCup(["empty", clock.t], clock.t)]);
    t.onWorld();
    expect(last()).toMatchObject({ step: "plan:pam-1:4", vision: "컵 · 비어 있음", speak: false });
    // 컵 안을 모르면 그 컵 자리를 쓴다
    clock.t += 600;
    w = world([tableCup(undefined, clock.t)]);
    t.onWorld();
    expect(last()).toMatchObject({ step: "plan:pam-1:4", vision: "컵 · 식탁 위", speak: false });
    expect(t.onAnswer("plan:pam-1", "plan:pam-1:4", "done")).toBe(true);
    expect(plans.current()).toMatchObject({ status: "done" });
  });

  it("do 단계가 8초 넘게 안 끝나면 stalled를 kind do로 부른다(그 컵을 가까이 본다)", async () => {
    const stalls: Stall[] = [];
    const { t, decide, clock } = fillSetup({ w: () => world([tableCup(["empty", 9_000])]), stalled: (s) => { stalls.push(s); return true; } });
    await decide(water);
    for (const n of [1, 2, 3]) t.onAnswer("plan:pam-1", `plan:pam-1:${n}`, "done");
    clock.t += 7_999;
    t.tick();
    expect(stalls).toEqual([]);
    clock.t += 1;
    t.tick();
    expect(stalls).toHaveLength(1);
    expect(stalls[0]).toMatchObject({
      planId: "plan:pam-1", stepId: "plan:pam-1:4", kind: "do", command: "컵에 물을 따라 주세요", until: { object: "cup_1", follow: true, facts: { contents: "has_contents" } },
      stuckMs: 8000, looks: 0, spots: [{ id: "cup_1", label: "컵", position: [2, 0.75, 1] }],
    });
  });

  it("따르고 내려놓은 병은 치운 물건(placed)에 넣지 않는다: 다음 채워 주기가 같은 병을 다시 집는 계획을 낼 수 있다. 컵 치우기의 컵은 지금처럼 남는다", async () => {
    expect([clearsAway(TASKS[WATER]!, "bottle"), clearsAway(TASKS[WATER]!, "cup"), clearsAway(TASKS["컵 치우기"]!, "cup"), clearsAway(TASKS["컵 치우기"]!, "bottle"), clearsAway(TASKS["라면 끓이기 알려 주기"]!, "cup"), clearsAway(null, "cup")])
      .toEqual([false, false, true, false, false, false]);
    const seen = (t: number) => world([tableCup(["empty", t], t), bottle("on_table", t)]);
    let w = seen(9_000);
    const plans = new PlanHub(fridgeFloor(), () => {}, () => "t");
    const s = fillSetup({ plans, w: () => w });
    // 병이 보이는 집: 그 병을 집고, 따른 뒤 식탁에 내려놓는 다섯 단계
    const steps = fillSteps({ fridge: "fridge_1", table: "table_1", cup: "cup_1", drink: "물" });
    llm.scripts[WATER] = () => [planCalls([steps[0]!, { ...steps[1]!, target: "bottle_1", until: { object: "bottle_1", follow: true, facts: { place: "in_hand" } } }, steps[2]!, steps[3]!,
      { kind: "place", act: "놓기", target: "table_1", object: "bottle_1", timeout_s: 120 }])];
    await s.decide(water);
    for (const n of [1, 2, 3, 4, 5]) expect(s.t.onAnswer("plan:pam-1", `plan:pam-1:${n}`, "done"), String(n)).toBe(true);
    expect(s.plans.current()).toMatchObject({ status: "done" });
    expect([...s.t.placed().keys()]).toEqual([]);
    // 다음 채워 주기: 같은 병을 집는 계획이 「이미 치운 물건」으로 버려지지 않는다
    s.clock.t += 20_000;
    w = seen(s.clock.t);
    const draft = new PlanDraft(planContext({ decision: { ...water, id: "pam-2", seq: 2 }, world: w, floor: plans.floor(), placed: new Map(s.t.placed()) }));
    expect(draft.add({ step: 1, ...steps[1]!, target: "bottle_1", until: { object: "bottle_1", follow: true, facts: { place: "in_hand" } } })).toMatchObject({ ok: true });
  });

  it("평면도 자리에서 하는 do는 비전 상태 줄이 그 자리까지 거리다", async () => {
    const plans = new PlanHub(fridgeFloor(), () => {}, () => "t");
    const s = fillSetup({ plans, w: () => world([tableCup(["empty", 9_000])]) });
    llm.scripts[WATER] = () => [planCalls(fillSteps({ fridge: "fridge_1", table: "table_1", cup: "cup_1", drink: "물" }).map((st, i) => (i === 3 ? { ...st, target: "table_1", until: undefined } : st)))];
    await s.decide(water);
    s.t.onEye([6.5, 3]);
    for (const n of [1, 2, 3]) s.t.onAnswer("plan:pam-1", `plan:pam-1:${n}`, "done");
    expect(s.last()).toMatchObject({ step: "plan:pam-1:4", vision: "식탁까지 0.5m", target: TABLE, kind: "do" });
  });

  it("따르기 단계(끝 조건이 그 컵 내용물)가 되면 그 컵의 창을 열고, 단계가 끝나거나 계획이 닫히면 닫는다", async () => {
    const calls: [string, boolean][] = [];
    let w = world([tableCup(["empty", 9_000])]);
    const s = fillSetup({ w: () => w, contentsAction: (id, on) => calls.push([id, on]) });
    await s.decide(water);
    s.t.onAnswer("plan:pam-1", "plan:pam-1:1", "done");
    w = world([tableCup(["empty", 9_000]), bottle("in_hand", s.clock.t)], "holding_object", s.clock.t);
    s.t.onWorld();
    s.t.onAnswer("plan:pam-1", "plan:pam-1:3", "done");
    expect(calls).toEqual([["cup_1", true]]);
    s.t.onAnswer("plan:pam-1", "plan:pam-1:4", "done");
    expect(calls).toEqual([["cup_1", true], ["cup_1", false]]);
  });

  it("따르기 단계 도중 컵이 새 id로 이어지면 창도 새 컵으로 옮긴다(앞 컵 닫고 새 컵 엶)", async () => {
    const calls: [string, boolean][] = [];
    let w = world([tableCup(["empty", 9_000])]);
    const s = fillSetup({ w: () => w, contentsAction: (id, on) => calls.push([id, on]) });
    await s.decide(water);
    s.t.onAnswer("plan:pam-1", "plan:pam-1:1", "done");
    w = world([tableCup(["empty", 9_000]), bottle("in_hand", s.clock.t)], "holding_object", s.clock.t);
    s.t.onWorld();
    s.t.onAnswer("plan:pam-1", "plan:pam-1:3", "done");
    s.clock.t += 1_000;
    // 옛 컵은 사라지고 그 뒤 같은 종류 새 컵(cup_2)이 보인다: 실행 추적이 그 컵으로 잇는다
    w = world([{ ...tableCup(["empty", 9_000]), status: "gone" }, { ...tableCup(["empty", s.clock.t], s.clock.t), id: "cup_2", first_seen_ms: s.clock.t }]);
    s.t.onWorld();
    expect(calls).toEqual([["cup_1", true], ["cup_1", false], ["cup_2", true]]);
  });

  it("불투명 컵(실제 World State): 물 채우기를 붙잡아도 사용자에게 묻지 않고, 몰라 30초 뒤 「안을 몰라」로 닫는다", async () => {
    const ws = new WorldState({ evidenceStepMs: 1000, surfaces: () => [], floorAt: () => 0, roomAt: () => ({ id: "kitchen", label: "주방" }), devices: () => [] });
    const frame = (i: number): EngineFrame => ({ id: `e${i}`, capturedAtMs: i * 1000, latestAtMs: i * 1000, jpeg: Buffer.from(`${i}`), sha256: sha256(Buffer.from(`${i}`)), width: 480, height: 360, eye: null, view: null });
    for (let i = 1; i <= 3; i++) {
      const { ids } = vlmSee(ws, frame(i), [det("cup", 0.9, [220, 160, 40, 20], 41)]);
      ws.applyScene(`e${i}`, i * 1000, { scene: "k", observations: [{ object_id: "d1", state: "opaque" }, { object_id: "d1", state: "on_table" }], summary: "s" }, ids);
    }
    const s = fillSetup({
      w: () => ws.view(s.clock.t),
      check: () => checkPlan({ decision: { ...water, atMs: 0 }, tasks: [WATER], plan: s.plans.current()!, world: ws.view(s.clock.t), nowMs: s.clock.t, staleMs: 600_000, mode: "test" }),
      lookContents: (h) => { h.done(); return true; },
    });
    s.t.onEye([0, 0]);
    await s.decide({ ...water, tasks: [WATER], atMs: 0 });
    for (let i = 0; i < 140; i++) { s.clock.t += 250; s.t.tick(); }
    expect(s.commands().filter((c) => c.text.endsWith("?"))).toEqual([]);
    expect(s.exec().at(-1)).toMatchObject({ state: "failed", text: CHECK_TEXT.unknown_contents });
  });

  describe("내용물 보류(실행 전 검사가 컵 안을 몰라 막은 계획)", () => {
    const fillDecision = { ...water, tasks: [WATER] };
    const inferred = (v: string) => ({ contents: { value: v, at_ms: 9_000, since_ms: 9_000, certainty: "inferred" as const } });
    const confirmed = (v: string) => ({ contents: { value: v, at_ms: 9_500, since_ms: 9_000, certainty: "confirmed" as const } });
    /** 컵 facts를 바꿔 가며 볼 World와 실제 checkPlan으로 검사하는 실행 추적. looks: 받은 가까이 보기 부탁. */
    function holdSetup(over: Parameters<typeof setup>[0] = {}) {
      let facts: WorldObject["facts"] = inferred("empty");
      let seen = 9_000;
      let pos: [number, number, number] | null = null;
      let gen = 3;
      let extra: Partial<WorldObject> = {};
      const w = () => world([{ ...cup("present", undefined, seen), ...(pos ? { position: pos } : {}), facts, contents_gen: gen, ...extra }]);
      const looks: ContentsLook[] = [];
      const s = fillSetup({
        w, lookContents: (h) => { looks.push(h); return true; },
        check: () => checkPlan({ decision: fillDecision, tasks: [WATER], plan: s.plans.current()!, world: w(), nowMs: s.clock.t, staleMs: 3_000, mode: "test" }),
        ...over,
      });
      return {
        ...s, looks, set: (f: WorldObject["facts"]) => { facts = f; }, see: (at: number) => { seen = at; }, move: (p: [number, number, number]) => { pos = p; },
        gen: (n: number) => { gen = n; }, extra: (x: Partial<WorldObject>) => { extra = x; },
      };
    }

    it("모르면 실패로 닫지 않고 그 컵을 가까이 본 뒤 4초 사진을 기다린다. 그사이 확인되면 첫 명령을 보낸다", async () => {
      const s = holdSetup();
      await s.decide(fillDecision);
      s.clock.t += 3_500; s.t.tick(); // recheckMs(3초)가 지나도 닫히지 않는다
      expect(s.exec().map((e) => e.state)).not.toContain("failed");
      expect(s.looks).toEqual([expect.objectContaining({ planId: "plan:pam-1", objectId: "cup_1" })]);
      expect(s.commands()).toEqual([]);
      s.looks[0]!.done();
      s.set(confirmed("empty"));
      s.see(s.clock.t);
      s.clock.t += 500; s.t.tick();
      expect(s.spoken()).toEqual(["냉장고로 가 주세요"]);
    });

    it("확인된 반대 값이면 보류하지 않고 그 까닭으로 닫는다", async () => {
      const s = holdSetup();
      s.set(confirmed("has_contents"));
      await s.decide(fillDecision);
      s.clock.t += 3_100; s.see(s.clock.t); s.t.tick();
      expect(s.exec().at(-1)).toMatchObject({ state: "failed", text: CHECK_TEXT.contents_mismatch });
      expect(s.looks).toEqual([]);
    });

    it("보류하는 동안 컵을 다시 못 봐 낡아도 닫지 않는다(가까이 보기·사진 기다림 중)", async () => {
      const s = holdSetup();
      await s.decide(fillDecision);
      for (let i = 0; i < 20; i++) { s.clock.t += 250; s.t.tick(); } // 컵을 9초에 본 뒤 15초까지: 낡음
      expect(s.exec().map((e) => e.state)).not.toContain("failed");
    });

    it("보기 담당이 바빠 받지 않으면 3초 뒤 가까이 보기 없이 사진을 기다리고, 묻지 못하면 30초 뒤 「안을 몰라」로 닫는다", async () => {
      const s = holdSetup({ lookContents: () => false });
      await s.decide(fillDecision);
      for (let i = 0; i < 150; i++) { s.clock.t += 250; s.see(s.clock.t); s.t.tick(); } // 보류 30초 + 다시 보기 기한 3초(컵은 계속 보인다)
      expect(s.exec().at(-1)).toMatchObject({ state: "failed", text: CHECK_TEXT.unknown_contents });
      expect(s.commands()).toEqual([]);
    });

    it("불투명이 확인된 컵은 가까이 보지 않는다. 그만두면 가까이 보기 신호가 끊긴다", async () => {
      const s = holdSetup();
      s.set({ ...inferred("contents_unknown"), body: { value: "opaque", at_ms: 9_000, since_ms: 9_000, certainty: "confirmed" } });
      await s.decide(fillDecision);
      s.clock.t += 500; s.t.tick();
      expect(s.looks).toEqual([]);
      const t2 = holdSetup();
      await t2.decide(fillDecision);
      t2.heard("그만해");
      expect(t2.looks[0]!.signal.aborted).toBe(true);
    });

    it("가까이 보기가 끝나지 않아도(VLM이 늦거나 멈춤) 30초 기한이 되면 가까이 보기 신호를 끊고 「안을 몰라」로 닫는다", async () => {
      const s = holdSetup();
      await s.decide(fillDecision);
      for (let i = 0; i < 140; i++) { s.clock.t += 250; s.see(s.clock.t); s.t.tick(); }
      expect(s.looks).toHaveLength(1);
      expect(s.looks[0]!.signal.aborted).toBe(true);
      expect(s.exec().at(-1)).toMatchObject({ state: "failed", text: CHECK_TEXT.unknown_contents });
    });

    it("가까이 봐도 모르면 사용자에게 묻지 않는다: 가까이 가서 보라는 명령만 보내고(「주세요」, 「?」 없음) 끝나지 않으면 「안을 몰라」로 닫는다", async () => {
      const s = holdSetup({ lookContents: (h) => { h.done(); return true; } });
      s.t.onEye([0, 0]);
      await s.decide(fillDecision);
      for (let i = 0; i < 200; i++) { s.clock.t += 250; s.see(s.clock.t); s.t.onEye([0, 0]); s.t.tick(); }
      expect(s.commands().length).toBeGreaterThan(0);
      expect(s.commands().every((c) => c.text.endsWith("주세요") && !c.text.endsWith("?"))).toBe(true);
      expect(s.exec().at(-1)).toMatchObject({ state: "failed", text: CHECK_TEXT.unknown_contents });
    });

    describe("가까이 가서 보기(peek)", () => {
      const OPAQUE = () => ({ ...inferred("contents_unknown"), body: { value: "opaque", at_ms: 9_000, since_ms: 9_000, certainty: "confirmed" as const } });
      const isPeek = (c: { step: string }) => c.step.includes(":peek:");
      /** 불투명 컵 물 채우기를 붙잡은 실행 추적. 폰 눈은 컵 [2, 1]에서 eye만큼(기본 1m). tick은 컵을 그때 보고(fresh) 250ms 간다. */
      async function peeking(o: { eye?: [number, number]; over?: Parameters<typeof setup>[0] } = {}) {
        let ready = false;
        let talk = false;
        let approvals = false;
        const guards: [string, boolean][] = [];
        const s = holdSetup({
          topReady: () => ready, guardObject: (id, on) => guards.push([id, on]), talking: () => talk, approvalsWaiting: () => approvals, ...o.over,
        });
        s.set(OPAQUE());
        let eye: [number, number] = o.eye ?? [3, 1];
        let eyeOn = true;
        s.t.onEye(eye);
        await s.decide(fillDecision);
        let fresh = true;
        const tick = (ms = 250) => { s.clock.t += ms; if (fresh) s.see(s.clock.t); if (eyeOn) s.t.onEye(eye); s.t.tick(); };
        const run = (ms: number) => { for (let t = 0; t < ms; t += 250) tick(); };
        tick();
        return {
          ...s, guards, tick, run,
          ready: (v: boolean) => { ready = v; }, talk: (v: boolean) => { talk = v; }, approvals: (v: boolean) => { approvals = v; }, fresh: (v: boolean) => { fresh = v; },
          eye: (p: [number, number]) => { eye = p; s.t.onEye(p); }, eyeOn: (v: boolean) => { eyeOn = v; },
        };
      }

      it("불투명 컵: 「컵 가까이 가 주세요」(go, near_m 0.5, 단추 없음) → 0.5m 안이면 「컵 안이 보이게 위에서 비춰 주세요」(do, view above) → 위에서 본 사진이 모이면 명령을 거두고 위에서 보기 → 확인되면 첫 명령", async () => {
        const s = await peeking();
        expect(s.last()).toEqual({
          type: "command", id: "plan:pam-1", step: "plan:pam-1:peek:cup_1:3:go:1", text: PEEK_TEXT.go("컵"), vision: "컵까지 1.0m", choices: [],
          target: { id: "cup_1", label: "컵", position: [2, 0.75, 1] }, speak: true, kind: "go", near_m: PEEK.nearM,
        });
        s.eye([2.6, 1]);
        s.run(1000);
        expect(s.last()).toMatchObject({ step: "plan:pam-1:peek:cup_1:3:go:1" });
        s.eye([2.4, 1]);
        s.tick();
        const aboveAt = s.clock.t;
        expect(s.last()).toEqual({
          type: "command", id: "plan:pam-1", step: "plan:pam-1:peek:cup_1:3:above:2", text: PEEK_TEXT.above("컵"), vision: "컵 · 안이 안 보임", choices: [],
          target: { id: "cup_1", label: "컵", position: [2, 0.75, 1] }, speak: true, kind: "do", view: "above",
        });
        expect(s.guards).toEqual([["cup_1", true]]);
        s.run(1000);
        expect(s.looks).toEqual([]);
        s.ready(true);
        s.tick();
        expect(s.phone.at(-1)).toEqual({ type: "command_clear", id: "plan:pam-1" });
        expect(s.looks).toEqual([expect.objectContaining({ planId: "plan:pam-1", objectId: "cup_1", top: { sinceMs: aboveAt } })]);
        s.looks[0]!.done();
        s.set(confirmed("empty"));
        s.tick();
        expect(s.spoken().at(-1)).toBe("냉장고로 가 주세요");
        expect(s.guards).toEqual([["cup_1", true], ["cup_1", false]]);
        expect(s.commands().every((c) => c.text.endsWith("주세요"))).toBe(true);
        expect(PHONE_PROTOCOL).toBe(5);
      });

      it("처음부터 0.5m 안이면 go 없이 위에서 비춰 달라고 한다", async () => {
        const s = await peeking({ eye: [2.3, 1] });
        expect(s.commands().filter(isPeek).map((c) => c.kind)).toEqual(["do"]);
        expect(s.last()).toMatchObject({ text: PEEK_TEXT.above("컵"), view: "above" });
      });

      it("위에서 본 뒤에도 모르면 묻지 않고 「안을 몰라」로 닫는다. 같은 컵·세대의 새 계획은 60초 안에 다시 가까이 가지 않는다", async () => {
        const s = await peeking({ eye: [2.3, 1] });
        s.ready(true);
        s.tick();
        s.looks[0]!.done();
        s.run(CONTENTS_HOLD.settleMs + 4000);
        expect(s.exec().at(-1)).toMatchObject({ state: "failed", text: CHECK_TEXT.unknown_contents });
        expect(s.guards.at(-1)).toEqual(["cup_1", false]);
        expect(s.commands().some((c) => c.text.endsWith("?"))).toBe(false);
        const n = s.commands().length;
        await s.decide({ ...fillDecision, id: "pam-2", seq: 2 });
        s.run(8000);
        expect(s.commands().slice(n).filter(isPeek)).toEqual([]);
        expect(s.exec().at(-1)).toMatchObject({ plan_id: "plan:pam-2", state: "failed", text: CHECK_TEXT.unknown_contents });
      });

      it("폰 대화가 시작되면 떠 있는 명령을 거두고(보기 지킴도 풂), 끝나면 새 번호로 다시 보낸다. 승인 대기 중에는 보내지 않는다", async () => {
        const s = await peeking({ eye: [2.3, 1] });
        expect(s.last()).toMatchObject({ step: "plan:pam-1:peek:cup_1:3:above:1" });
        s.talk(true);
        s.tick();
        expect(s.phone.at(-1)).toEqual({ type: "command_clear", id: "plan:pam-1" });
        expect(s.guards).toEqual([["cup_1", true], ["cup_1", false]]);
        s.run(2000);
        expect(s.phone.at(-1)).toEqual({ type: "command_clear", id: "plan:pam-1" });
        s.talk(false);
        s.tick();
        expect(s.last()).toMatchObject({ step: "plan:pam-1:peek:cup_1:3:above:2", speak: true });
        const w = await peeking({ over: { approvalsWaiting: () => true } });
        w.run(2000);
        expect(w.commands().filter(isPeek)).toEqual([]);
      });

      it("명령이 30초 안에 끝나지 않으면 거두고 「안을 몰라」로 닫는다(보기 지킴도 풂)", async () => {
        const s = await peeking({ eye: [2.3, 1] });
        s.run(PEEK.stepMs + 4000);
        expect(s.exec().at(-1)).toMatchObject({ state: "failed", text: CHECK_TEXT.unknown_contents });
        expect(s.guards).toEqual([["cup_1", true], ["cup_1", false]]);
        expect(s.phone.some((m) => m.type === "command_clear")).toBe(true);
      });

      it("위에서 비춰 달라고 한 뒤 컵이 0.2m 옮겨지면 명령을 거두고(보기 지킴 풂) go부터 다시 한다", async () => {
        const s = await peeking({ eye: [2.4, 1] });
        expect(s.last()).toMatchObject({ kind: "do", view: "above" });
        s.move([1.8, 0.75, 1]);
        s.tick();
        expect(s.guards).toEqual([["cup_1", true], ["cup_1", false]]);
        expect(s.last()).toMatchObject({ text: PEEK_TEXT.go("컵"), kind: "go", step: "plan:pam-1:peek:cup_1:3:go:2", target: { position: [1.8, 0.75, 1] } });
        expect(s.phone.filter((m) => m.type === "command_clear")).toHaveLength(1);
      });

      it("「그만」이면 계획을 그만두고 보기 지킴을 푼다", async () => {
        const s = await peeking({ eye: [2.3, 1] });
        expect(s.heard("그만해")?.id).toBe("stop");
        expect(s.guards).toEqual([["cup_1", true], ["cup_1", false]]);
        expect(s.exec().at(-1)).toMatchObject({ state: "failed", text: EXEC_TEXT.stopped });
      });

      it("위에서 본 뒤 확인됐지만 컵을 다시 못 봐 낡았으면 30초 기다린다: 다시 보이면 첫 명령, 아니면 낡음으로 닫는다", async () => {
        for (const back of [true, false]) {
          const s = await peeking({ eye: [2.3, 1] });
          s.ready(true);
          s.tick();
          s.fresh(false);
          s.run(4000);
          s.looks[0]!.done();
          s.set(confirmed("empty"));
          s.run(10_000);
          expect(s.spoken()).not.toContain("냉장고로 가 주세요");
          expect(s.exec().map((e) => e.state)).not.toContain("failed");
          if (back) {
            s.fresh(true);
            s.tick();
            expect(s.spoken().at(-1)).toBe("냉장고로 가 주세요");
          } else {
            s.run(CONTENTS_HOLD.holdMs + 4000);
            expect(s.exec().at(-1)).toMatchObject({ state: "failed", text: CHECK_TEXT.stale });
          }
        }
      });

      it("이번 보류에서 위에서 본 값이 판단 뒤 가까이 본 값(closer_rev)을 바꿔도 「가까이 본 뒤 다시 판단」으로 닫지 않고 행동 조건으로 다시 검사해 이어 간다", async () => {
        const s = await peeking({ eye: [2.3, 1] });
        s.ready(true);
        s.tick();
        s.looks[0]!.done();
        s.set({ ...OPAQUE(), ...confirmed("empty") });
        s.extra({ closer_rev: { contents: 1 } });
        s.tick();
        expect(s.exec().map((e) => e.text)).not.toContain(EXEC_TEXT.closerNewer);
        expect(s.spoken().at(-1)).toBe("냉장고로 가 주세요");
      });

      it("확인으로 세대가 오른 뒤 컵이 낡아도, 붙잡은 지 30초가 넘었어도 다시 보이기를 30초 기다린다", async () => {
        const s = await peeking();
        s.run(20_000);
        s.eye([2.3, 1]);
        s.tick();
        s.run(6000);
        s.ready(true);
        s.tick();
        s.fresh(false);
        s.run(4000);
        s.looks[0]!.done();
        s.set({ ...OPAQUE(), ...confirmed("empty") });
        s.gen(4);
        s.run(10_000);
        expect(s.exec().map((e) => e.state)).not.toContain("failed");
        s.fresh(true);
        s.tick();
        expect(s.spoken().at(-1)).toBe("냉장고로 가 주세요");
      });

      it("보류 중 컵이 들리면(검사 이유가 들고 있음) 바로 명령과 보기 지킴을 거두고, 들고 감 보호(carried)여도 30초 뒤 닫는다", async () => {
        const s = await peeking({ eye: [2.3, 1] });
        expect(s.guards).toEqual([["cup_1", true]]);
        s.extra({ carried: true });
        s.set({ ...OPAQUE(), place: { value: "in_hand", at_ms: s.clock.t, since_ms: s.clock.t, certainty: "confirmed" } });
        s.tick();
        expect(s.phone.at(-1)).toEqual({ type: "command_clear", id: "plan:pam-1" });
        expect(s.guards).toEqual([["cup_1", true], ["cup_1", false]]);
        s.run(CONTENTS_HOLD.holdMs + 1000);
        expect(s.exec().at(-1)).toMatchObject({ state: "failed", text: CHECK_TEXT.in_hand });
      });

      it("보류 중 컵을 잠깐 들었다 내려놓으면(들고 감 보호 아님) 3초 만에 닫지 않고 기다렸다가 다시 이어 간다. 컵이 안 보이게 돼도(없음) 30초 기다린다", async () => {
        const s = await peeking({ eye: [2.3, 1] });
        s.set({ ...OPAQUE(), place: { value: "in_hand", at_ms: s.clock.t, since_ms: s.clock.t, certainty: "confirmed" } });
        s.run(10_000);
        expect(s.exec().map((e) => e.state)).not.toContain("failed");
        s.set(OPAQUE());
        s.run(1000);
        expect(s.last()).toMatchObject({ text: PEEK_TEXT.above("컵"), speak: true });
        expect(s.exec().map((e) => e.state)).not.toContain("failed");
        s.extra({ status: "gone" });
        s.run(10_000);
        expect(s.exec().map((e) => e.state)).not.toContain("failed");
        s.run(CONTENTS_HOLD.holdMs);
        expect(s.exec().at(-1)).toMatchObject({ state: "failed", text: CHECK_TEXT.no_target });
      });

      it("옮김 표시(followed_by)가 남아 있으면 한 번 거두고 새 대상이 정해질 때까지 같은 컵으로 다시 보내지 않는다", async () => {
        const s = await peeking({ eye: [2.3, 1] });
        s.extra({ followed_by: "cup_2" });
        s.run(3000);
        expect(s.phone.filter((m) => m.type === "command_clear")).toHaveLength(1);
        expect(s.commands().filter(isPeek)).toHaveLength(1);
        expect(s.guards).toEqual([["cup_1", true], ["cup_1", false]]);
      });

      it("위치 맞춤을 다시 시작하면(추정 눈) 명령을 거두고, 다시 맞추면 새 번호로 보낸다. 맞춘 눈이 2초 넘게 안 오면 거둔다", async () => {
        const s = await peeking({ eye: [2.3, 1] });
        expect(s.last()).toMatchObject({ step: "plan:pam-1:peek:cup_1:3:above:1" });
        s.eyeOn(false);
        s.t.onEye([2.3, 1], true);
        s.tick();
        expect(s.phone.at(-1)).toEqual({ type: "command_clear", id: "plan:pam-1" });
        s.eyeOn(true);
        s.tick();
        expect(s.last()).toMatchObject({ step: "plan:pam-1:peek:cup_1:3:above:2" });
        s.eyeOn(false);
        s.run(2500);
        expect(s.phone.at(-1)).toEqual({ type: "command_clear", id: "plan:pam-1" });
      });

      it("실행 추적을 멈추면 보류를 풀어 보기 지킴과 부탁 신호를 끝낸다", async () => {
        const s = await peeking({ eye: [2.3, 1] });
        s.ready(true);
        s.tick();
        s.t.stop();
        expect(s.guards).toEqual([["cup_1", true], ["cup_1", false]]);
        expect(s.looks[0]!.signal.aborted).toBe(true);
      });

      it("보류에서 풀려도 폰 대화 중이면 첫 명령을 미룬다: 끝나면 보내고, 30초 넘게 막히면 「폰을 쓰는 중이라 실행하지 않아요」로 닫는다", async () => {
        for (const ends of [true, false]) {
          const s = await peeking({ eye: [2.3, 1] });
          s.ready(true);
          s.tick();
          s.looks[0]!.done();
          s.talk(true);
          s.set(confirmed("empty"));
          s.run(5000);
          expect(s.spoken()).not.toContain("냉장고로 가 주세요");
          if (ends) {
            s.talk(false);
            s.tick();
            expect(s.spoken().at(-1)).toBe("냉장고로 가 주세요");
          } else {
            s.run(CONTENTS_HOLD.holdMs + 1000);
            expect(s.exec().at(-1)).toMatchObject({ state: "failed", text: EXEC_TEXT.phoneBusy });
          }
        }
      });
    });
  });
});

describe("실행 추적: 코치 계획(손으로 켜는 위험 가전)", () => {
  const P = "plan:pam-1";
  // 켜기 전 질문의 안전 문구는 서버 글(CAUTION_LINE)이다
  const ASK = "냄비와 상판이 뜨거워져요. 인덕션을 켤까요?";
  const YESNO = [{ id: "approve", label: "승인" }, { id: "reject", label: "거절" }];
  const OFF = { type: "command", id: P, step: `off:${P}:induction_1:1`, text: "인덕션을 꺼 주세요", vision: null, choices: DONE, target: null, speak: true, grade: "safety" };
  /** 끄기 안내의 「완료」 뒤·상태가 이미 꺼짐인 채 닫힌 뒤: 보이게 해 달라는 부탁(답 단추 없음). */
  const ASK_OFF = { ...OFF, text: "인덕션이 보이게 폰을 가까이 대 주세요", choices: [] };

  it("인덕션 켜기 단계는 먼저 안전 문구와 함께 묻고(승인·거절), 승인 뒤에만 「인덕션을 켜 주세요」를 보낸다. 「완료」·말·비전으로는 승인 없이 넘어가지 않고, 답은 기억하지 않아 다음 판에도 또 묻는다", async () => {
    expect(CAUTION_TEXT.ask(CAUTION_LINE.cooktop!, "인덕션")).toBe(ASK);
    const approvals = store({ [`task:${RAMEN}`]: "approve" });
    let w = world([]);
    const s = coachSetup({ approvals, w: () => w });
    await toOn(s);
    expect(s.last()).toEqual({ type: "command", id: P, step: `${P}:7:hand`, text: ASK, vision: null, choices: YESNO, target: null, speak: true, grade: "question" });
    expect(s.spoken()).not.toContain("인덕션을 켜 주세요");
    expect(s.steps()[6]).toBe("active");
    // 승인 없이 넘기는 길이 없다: 단계 「완료」, 질문에 「완료」, 말 「완료」·「다 했어」, 가전이 켜졌다는 관찰, 시간
    expect(s.t.onAnswer(P, `${P}:7`, "done")).toBe(false);
    expect(s.t.onAnswer(P, `${P}:7:hand`, "done")).toBe(false);
    expect(s.heard("완료")).toBeNull();
    expect(s.heard("다 했어")).toBeNull();
    w = { ...world([]), devices: [cooktop(["on"])] };
    s.t.onWorld();
    s.clock.t += 5_000;
    s.t.tick();
    expect(s.last()).toMatchObject({ step: `${P}:7:hand`, text: ASK });
    expect(s.steps()[6]).toBe("active");
    expect(s.spoken()).not.toContain("인덕션을 켜 주세요");
    // 승인: 그때 켜라는 명령
    expect(s.t.onAnswer(P, `${P}:7:hand`, "approve")).toBe(true);
    expect(s.last()).toMatchObject({ type: "command", step: `${P}:7`, text: "인덕션을 켜 주세요", choices: DONE, speak: true, kind: "do" });
    expect(Object.keys(approvals.memory().always ?? {})).toEqual([`task:${RAMEN}`]);
    // 다음 판: 같은 승인 기억으로도 또 묻는다
    const again = coachSetup({ approvals });
    await toOn(again);
    expect(again.last()).toMatchObject({ step: `${P}:7:hand`, text: ASK, choices: YESNO });
    // 말 「승인」도 받는다
    expect(again.heard("승인")).toMatchObject({ id: "approve" });
    expect(again.last()).toMatchObject({ step: `${P}:7`, text: "인덕션을 켜 주세요" });
  });

  it("가전 종류를 알 수 없어도(가전 목록 없음) 손으로 켜는 단계는 묻는다", async () => {
    const s = coachSetup({ handDevices: undefined });
    await toOn(s);
    expect(s.last()).toMatchObject({ step: `${P}:7:hand`, choices: YESNO });
    expect(s.last().text).toMatch(/^냄비와 상판이 뜨거워져요\. .+ 켤까요\?$/);
  });

  it("거절이면 켜라는 명령 없이 취소로 닫는다. 끄기 안내도 없다", async () => {
    const s = coachSetup();
    await toOn(s);
    expect(s.t.onAnswer(P, `${P}:7:hand`, "reject")).toBe(true);
    expect(s.last()).toEqual({ type: "command_clear", id: P });
    expect(s.spoken()).not.toContain("인덕션을 켜 주세요");
    expect(s.spoken()).not.toContain("인덕션을 꺼 주세요");
    expect(s.exec().at(-1)).toMatchObject({ state: "failed", text: APPROVAL_TEXT.refused });
    expect(s.plans.current()).toMatchObject({ status: "cancelled" });
  });

  it("켜기 전 질문에 2분 안에 답이 없으면 켜라는 명령 없이 닫는다", async () => {
    const s = coachSetup();
    await toOn(s);
    s.clock.t += 120_001;
    s.t.tick();
    expect(s.exec().at(-1)).toMatchObject({ state: "failed", text: EXEC_TEXT.noAnswer });
    expect(s.spoken()).not.toContain("인덕션을 켜 주세요");
    expect(s.spoken()).not.toContain("인덕션을 꺼 주세요");
  });

  it("켠 뒤 「그만」이면 계획을 닫고 「인덕션을 꺼 주세요」와 「완료」를 보낸다. 「완료」면 풀지 않고 보이게 해 달라는 부탁(답 단추 없음)으로 바뀌고, 확인된 꺼짐(허브 켜짐 → 꺼짐)을 보면 지운다", async () => {
    let w = world([]);
    const s = coachSetup({ w: () => w });
    await toOn(s);
    s.t.onAnswer(P, `${P}:7:hand`, "approve");
    const onAt = s.clock.t;
    expect(s.heard("그만")).toMatchObject({ id: "stop" });
    expect(s.phone.slice(-2)).toEqual([{ type: "command_clear", id: P }, OFF]);
    expect(s.plans.current()).toMatchObject({ status: "cancelled" });
    expect(s.t.openCommand()).toMatchObject({ planId: P, stepId: `off:${P}:induction_1:1`, kind: "command", text: "인덕션을 꺼 주세요", choices: [{ id: "done" }] });
    expect(s.t.onAnswer(P, `off:${P}:induction_1:1`, "approve")).toBe(false);
    expect(s.t.onAnswer(P, `off:${P}:induction_1:1`, "done")).toBe(true);
    expect(s.last()).toEqual(ASK_OFF);
    expect(s.t.openCommand()).toMatchObject({ stepId: `off:${P}:induction_1:1`, text: ASK_OFF.text, choices: [] });
    expect(s.t.safety().cycles.induction_1).toEqual({ cycle: 1, onAt, askedAt: s.clock.t });
    expect(s.t.onAnswer(P, `off:${P}:induction_1:1`, "done")).toBe(false);
    s.clock.t += 1_000;
    s.t.tick();
    expect(s.last()).toEqual(ASK_OFF);
    // 허브가 켜짐 → 꺼짐을 알리면(명시) 지운다
    w = { ...world([]), devices: [cooktop(["off"], [{ attr: "power", from: "off", to: "on", at_ms: onAt + 100 }, { attr: "power", from: "on", to: "off", at_ms: s.clock.t }])] };
    s.t.onWorld();
    expect(s.last()).toEqual({ type: "command_clear", id: P });
    expect(s.t.openCommand()).toBeNull();
    expect(s.t.safety().released).toEqual({ induction_1: { planId: P, evidenceAt: s.clock.t, via: "switch" } });
  });

  it("끄기 안내는 말 「완료」·「다 했어」로 풀리지도 바뀌지도 않고, 120초가 지나도 남아 같은 안내를 다시 소리로 보낸다. 시간 초과로 닫힌 계획에도 보내고 허브 꺼짐을 보면 지운다", async () => {
    const said = coachSetup();
    await toOn(said);
    said.t.onAnswer(P, `${P}:7:hand`, "approve");
    said.heard("그만");
    const n = said.phone.length;
    expect(said.heard("완료")).toBeNull();
    expect(said.heard("다 했어")).toBeNull();
    expect(said.phone).toHaveLength(n);
    said.clock.t += 119_000;
    said.t.tick();
    expect(said.phone).toHaveLength(n);
    said.clock.t += 1_001;
    said.t.tick();
    expect(said.phone.slice(n)).toEqual([OFF]);
    said.clock.t += 120_001;
    said.t.tick();
    expect(said.phone.slice(n)).toEqual([OFF, OFF]);
    expect(said.t.openCommand()).toMatchObject({ stepId: `off:${P}:induction_1:1`, choices: [{ id: "done" }] });

    let w = { ...world([]), devices: [cooktop(["on"])] };
    const seen = coachSetup({ w: () => w });
    await toOn(seen);
    seen.t.onAnswer(P, `${P}:7:hand`, "approve");
    // 켜기 단계가 시간 안에 끝나지 않아 닫힌다(그 사이 사람이 켰을 수 있다)
    seen.clock.t += 120_001;
    seen.t.tick();
    expect(seen.exec().at(-1)).toMatchObject({ state: "failed", text: EXEC_TEXT.timeout });
    expect(seen.last()).toEqual(OFF);
    seen.clock.t += 1_000;
    seen.t.tick();
    expect(seen.last()).toEqual(OFF);
    w = { ...world([]), devices: [cooktop(["off"], [{ attr: "power", from: "on", to: "off", at_ms: seen.clock.t }])] };
    seen.t.onWorld();
    expect(seen.last()).toEqual({ type: "command_clear", id: P });
  });

  it("끄기 단계(12번)를 「완료」로 넘기면 다음 단계로 가지만 켠 가전 추적(hot)은 남고, 계획이 끝나면 끄기 안내가 간다. 코치 계획이 열려 있는 동안 coaching()이 참이다(판단 호출을 쉬게 한다)", async () => {
    const s = coachSetup();
    expect(s.t.coaching()).toBe(false);
    await toOn(s);
    expect(s.t.coaching()).toBe(true);
    s.t.onAnswer(P, `${P}:7:hand`, "approve");
    s.t.onAnswer(P, `${P}:7`, "done");
    // 8 알림(4초) · 9 기다리기(240초) · 10 면 넣기 · 11 기다리기 · 12 끄기 · 13 알림
    s.clock.t += 4_001; s.t.tick();
    expect(s.steps()[8]).toBe("active");
    expect(s.t.coaching()).toBe(true);
    s.clock.t += 240_001; s.t.tick();
    expect(s.last()).toMatchObject({ step: `${P}:10`, text: "면과 스프를 넣어 주세요" });
    // 소리 등급: 보통 명령은 칸이 없고, 계획 안 끄기 단계(12번)는 안전
    expect(s.last()).not.toHaveProperty("grade");
    s.t.onAnswer(P, `${P}:10`, "done");
    s.clock.t += 240_001; s.t.tick();
    expect(s.last()).toMatchObject({ step: `${P}:12`, text: "인덕션을 꺼 주세요", choices: DONE, kind: "do", grade: "safety" });
    expect(s.t.onAnswer(P, `${P}:12`, "done")).toBe(true);
    expect(s.steps()[12]).toBe("active");
    expect(s.t.safety().hot).toEqual(["induction_1"]);
    s.clock.t += 4_001; s.t.tick();
    expect(s.plans.current()).toMatchObject({ status: "done" });
    expect(s.phone.slice(-2)).toEqual([{ type: "command_clear", id: P }, OFF]);
    expect(s.t.safety().hot).toEqual([]);
    expect(s.t.coaching()).toBe(false);
    expect(s.spoken()).toEqual([
      "수납장으로 가 주세요", "냄비를 꺼내 주세요", "싱크대로 가 주세요", "냄비에 물을 받아 주세요", "인덕션으로 가 주세요", "냄비를 인덕션에 올려 주세요",
      ASK, "인덕션을 켜 주세요", "물이 끓을 때까지 기다려요.", "면과 스프를 넣어 주세요", "인덕션을 꺼 주세요", "라면이 다 됐어요.", "인덕션을 꺼 주세요",
    ]);
  });

  it("허브가 인덕션을 켜짐 → 꺼짐으로 바꿔 12번이 끝나면 추적이 풀리고 계획이 끝나도 끄기 안내가 없다. 풀려도 회차(onAt)는 남는다", async () => {
    let w = { ...world([]), devices: [cooktop(["off"])] };
    const s = coachSetup({ w: () => w });
    await toOn(s);
    s.t.onAnswer(P, `${P}:7:hand`, "approve");
    const onAt = s.clock.t;
    s.clock.t += 1_000;
    const on = { attr: "power", from: "off", to: "on", at_ms: s.clock.t };
    w = { ...world([]), devices: [cooktop(["on"], [on])] };
    s.t.onWorld();
    expect(s.steps()[7]).toBe("active");
    s.clock.t += 4_001; s.t.tick();
    s.clock.t += 240_001; s.t.tick();
    s.t.onAnswer(P, `${P}:10`, "done");
    s.clock.t += 240_001; s.t.tick();
    expect(s.last()).toMatchObject({ step: `${P}:12`, text: "인덕션을 꺼 주세요" });
    expect(s.t.safety().hot).toEqual(["induction_1"]);
    s.clock.t += 1_000;
    w = { ...world([]), devices: [cooktop(["off"], [on, { attr: "power", from: "on", to: "off", at_ms: s.clock.t }])] };
    s.t.onWorld();
    expect(s.steps()[12]).toBe("active");
    expect(s.t.safety()).toEqual({ hot: [], cycles: { induction_1: { cycle: 1, onAt, askedAt: null } }, released: { induction_1: { planId: P, evidenceAt: s.clock.t, via: "switch" } } });
    s.clock.t += 4_001; s.t.tick();
    expect(s.plans.current()).toMatchObject({ status: "done" });
    expect(s.phone.some((m) => m.type === "command" && /^off:/.test(m.step))).toBe(false);
  });

  it("12번이 20초 넘게 안 끝나고 인덕션 상태가 이미 꺼짐(켜짐을 못 봄)이면 보이게 해 달라는 부탁을 12번 명령 줄에 한 번 보낸다(답 단추 없음)", async () => {
    const w = { ...world([]), devices: [cooktop(["off"])] };
    const s = coachSetup({ w: () => w });
    await toOn(s);
    s.t.onAnswer(P, `${P}:7:hand`, "approve");
    s.t.onAnswer(P, `${P}:7`, "done");
    s.clock.t += 4_001; s.t.tick();
    s.clock.t += 240_001; s.t.tick();
    s.t.onAnswer(P, `${P}:10`, "done");
    s.clock.t += 240_001; s.t.tick();
    expect(s.last()).toMatchObject({ step: `${P}:12`, text: "인덕션을 꺼 주세요" });
    s.clock.t += 19_000; s.t.tick();
    expect(s.last()).toMatchObject({ step: `${P}:12`, text: "인덕션을 꺼 주세요" });
    s.clock.t += 1_001; s.t.tick();
    expect(s.last()).toMatchObject({ type: "command", id: P, step: `${P}:12`, text: ASK_OFF.text, choices: [], speak: true, kind: "do", grade: "safety" });
    for (let i = 0; i < 8; i++) { s.clock.t += 1_000; s.t.tick(); }
    expect(s.phone.filter((m) => m.type === "command" && m.text === ASK_OFF.text)).toHaveLength(1);
    expect(s.t.safety().cycles.induction_1!.askedAt).toBe(s.clock.t - 8_000);
  });

  it("한 판정: 전원 모름 → 켜기 지시 → 첫 관측이 꺼짐(모름 → 꺼짐)이면 풀지 않는다(부탁이 남는다)", async () => {
    let w = { ...world([]), devices: [cooktop([])] };
    const s = coachSetup({ w: () => w });
    await toOn(s);
    s.t.onAnswer(P, `${P}:7:hand`, "approve");
    const onAt = s.clock.t;
    s.clock.t += 1_000;
    w = { ...world([]), devices: [cooktop(["off"], [{ attr: "power", from: null, to: "off", at_ms: onAt + 500 }])] };
    s.heard("그만");
    expect(s.last()).toEqual(ASK_OFF);
    for (let i = 0; i < 4; i++) { s.clock.t += 1_000; s.t.onWorld(); s.t.tick(); }
    expect(s.last()).toEqual(ASK_OFF);
    expect(s.t.safety().released).toEqual({});
  });

  it("한 판정: 켜기 단계(7번) 진행 중에는 켜짐 → 꺼짐을 봐도 풀지 않고, 그 단계가 끝난 뒤에 푼다", async () => {
    let w = { ...world([]), devices: [cooktop(["on"], [{ attr: "power", from: "off", to: "on", at_ms: 5_000 }])] };
    const s = coachSetup({ w: () => w });
    await toOn(s);
    s.t.onAnswer(P, `${P}:7:hand`, "approve");
    const onAt = s.clock.t;
    // 켜라고 하기 전부터 켜져 있었다(7번 끝 조건 became on은 서지 않는다). 그 뒤 꺼짐을 허브가 알린다
    s.clock.t += 1_000;
    w = { ...world([]), devices: [cooktop(["off"], [{ attr: "power", from: "off", to: "on", at_ms: 5_000 }, { attr: "power", from: "on", to: "off", at_ms: onAt + 500 }])] };
    s.t.onWorld();
    s.t.tick();
    expect(s.steps()[6]).toBe("active");
    expect(s.t.safety().hot).toEqual(["induction_1"]);
    expect(s.t.safety().released).toEqual({});
    s.t.onAnswer(P, `${P}:7`, "done");
    s.t.tick();
    expect(s.t.safety()).toMatchObject({ hot: [], released: { induction_1: { evidenceAt: onAt + 500, via: "switch" } } });
  });

  it("끄기 안내는 켜라고 한 뒤에 새로 본 꺼짐으로만 지운다: 처음부터 남아 있던 꺼짐 값으로는 지우지 않는다(상태가 이미 꺼짐이면 끄라는 안내 대신 부탁)", async () => {
    let w = { ...world([]), devices: [cooktop(["off"])] };
    const s = coachSetup({ w: () => w });
    await toOn(s);
    s.t.onAnswer(P, `${P}:7:hand`, "approve");
    const onAt = s.clock.t;
    s.heard("그만");
    expect(s.last()).toEqual(ASK_OFF);
    s.t.onWorld();
    s.clock.t += 1_000;
    s.t.tick();
    expect(s.last()).toEqual(ASK_OFF);
    // 켜라고 하기 전의 꺼짐 기록도 아니다
    w = { ...world([]), devices: [cooktop(["off"], [{ attr: "power", from: "on", to: "off", at_ms: onAt - 1 }])] };
    s.t.onWorld();
    s.t.tick();
    expect(s.last()).toEqual(ASK_OFF);
    // 켜라고 한 뒤 켰다가 끈 것을 보면 지운다
    s.clock.t += 1_000;
    w = { ...world([]), devices: [cooktop(["off"], [{ attr: "power", from: "off", to: "on", at_ms: onAt + 500 }, { attr: "power", from: "on", to: "off", at_ms: s.clock.t }])] };
    s.t.onWorld();
    expect(s.last()).toEqual({ type: "command_clear", id: P });
  });

  it("끄기 안내는 켜라고 한 뒤에 찍힌 꺼짐 사진으로만 지운다: 켜라고 한 뒤 도착했어도 그 전에 찍힌 사진의 답이면 그대로 둔다", async () => {
    let w = { ...world([]), devices: [cooktop(["off"])] };
    const s = coachSetup({ w: () => w });
    await toOn(s);
    s.t.onAnswer(P, `${P}:7:hand`, "approve");
    const onAt = s.clock.t;
    s.heard("그만");
    expect(s.last()).toEqual(ASK_OFF);
    // 켜라고 한 뒤(onAt + 1000) 도착했지만 켜라고 하기 전(onAt - 500)에 찍힌 꺼짐 사진: 지우지 않는다
    s.clock.t += 1_000;
    w = { ...world([]), devices: [cooktop(["off"], [{ attr: "power", from: "on", to: "off", at_ms: s.clock.t, seen_ms: onAt - 500, explicit: true }])] };
    s.t.onWorld();
    s.t.tick();
    expect(s.last()).toEqual(ASK_OFF);
    // 켜라고 한 뒤 찍힌 꺼짐 사진이면 지운다
    s.clock.t += 1_000;
    w = { ...world([]), devices: [cooktop(["off"], [{ attr: "power", from: "on", to: "off", at_ms: s.clock.t, seen_ms: onAt + 200, explicit: true }])] };
    s.t.onWorld();
    expect(s.last()).toEqual({ type: "command_clear", id: P });
  });

  it("끄기 안내가 남은 동안 새 계획이 와도 안내를 지우지 않는다: 새 계획은 첫 명령(승인 질문 포함)을 미루고 실행 기록·말풍선에 그 가전 꺼짐을 기다린다고 남긴다. 안내가 풀리면 그때 시작한다", async () => {
    let w = world([]);
    const s = coachSetup({ w: () => w });
    await toOn(s);
    s.t.onAnswer(P, `${P}:7:hand`, "approve");
    const onAt = s.clock.t;
    s.heard("그만");
    expect(s.last()).toEqual(OFF);
    expect(s.t.offWaiting()).toBeNull();
    s.clock.t += 1_000;
    await s.decide(ramenDecision("pam-2", 2));
    expect(s.t.current()).toEqual({ planId: "plan:pam-2", state: "planned" });
    for (let i = 0; i < 20; i++) { s.clock.t += 1_000; s.t.tick(); }
    expect(s.last()).toEqual(OFF);
    expect(s.phone.some((m) => m.type === "command" && m.id === "plan:pam-2")).toBe(false);
    expect(s.t.openCommand()).toMatchObject({ stepId: `off:${P}:induction_1:1` });
    expect(s.exec().filter((l) => l.plan_id === "plan:pam-2" && l.text === EXEC_TEXT.deferred("인덕션"))).toEqual([expect.objectContaining({ state: "planned", text: "인덕션 꺼짐 확인 전이라 새 일을 미룸" })]);
    expect(s.t.offWaiting()).toBe("인덕션");
    // 말 「다 했어」로는 풀리지 않는다. 허브 켜짐 → 꺼짐을 보면 지우고 새 계획의 첫 명령을 보낸다
    expect(s.heard("다 했어")).toBeNull();
    expect(s.last()).toEqual(OFF);
    w = { ...world([]), devices: [cooktop(["off"], [{ attr: "power", from: "off", to: "on", at_ms: onAt + 100 }, { attr: "power", from: "on", to: "off", at_ms: s.clock.t }])] };
    s.t.onWorld();
    expect(s.phone.slice(-2)).toEqual([{ type: "command_clear", id: P }, expect.objectContaining({ id: "plan:pam-2", step: "plan:pam-2:1", text: "수납장으로 가 주세요", speak: true })]);
    expect(s.t.current()).toEqual({ planId: "plan:pam-2", state: "running" });
    expect(s.t.offWaiting()).toBeNull();
  });

  it("켠 위험 가전이 여럿이면 가전마다 끄기 안내를 줄에 넣고 120초마다 차례로 돌아가며 띄운다. 그 가전 꺼짐을 보면 그 가전 안내만 지운다", async () => {
    const MW = { kind: "do", act: "켜기", target: "microwave_1", hand_device: { id: "microwave_1", to: "on" }, timeout_s: 120 };
    let w = world([]);
    const s = coachSetup({ w: () => w, handDevices: () => [{ id: "induction_1", kind: "cooktop", label: "인덕션" }, { id: "microwave_1", kind: "microwave", label: "전자레인지" }] });
    const steps = ramenSteps({ cabinet: "cabinet_1", sink: "sink_1", cooktop: "induction_1", cooktopDevice: "induction_1" });
    llm.scripts[RAMEN] = () => [planCalls([steps[6]!, MW, steps[11]!, { ...MW, act: "끄기", hand_device: { id: "microwave_1", to: "off" } }])];
    await s.decide(ramenDecision());
    s.t.onAnswer(P, `${P}:1:hand`, "approve");
    const onAt = s.clock.t;
    s.t.onAnswer(P, `${P}:1`, "done");
    expect(s.last()).toMatchObject({ step: `${P}:2:hand`, text: "그릇이 뜨거워져요. 전자레인지를 켤까요?" });
    s.t.onAnswer(P, `${P}:2:hand`, "approve");
    s.t.onAnswer(P, `${P}:2`, "done");
    expect(s.last()).toMatchObject({ step: `${P}:3`, text: "인덕션을 꺼 주세요" });
    s.heard("그만");
    expect(s.last()).toEqual(OFF);
    const MW_OFF = { ...OFF, step: `off:${P}:microwave_1:1`, text: "전자레인지를 꺼 주세요" };
    s.clock.t += 120_001;
    s.t.tick();
    expect(s.phone.slice(-2)).toEqual([{ type: "command_clear", id: P }, MW_OFF]);
    expect(s.t.openCommand()).toMatchObject({ stepId: `off:${P}:microwave_1:1`, text: "전자레인지를 꺼 주세요" });
    s.clock.t += 120_001;
    s.t.tick();
    expect(s.phone.slice(-2)).toEqual([{ type: "command_clear", id: P }, OFF]);
    // 인덕션 꺼짐(허브): 인덕션 안내만 지우고 전자레인지 안내를 띄운다
    w = { ...world([]), devices: [cooktop(["off"], [{ attr: "power", from: "off", to: "on", at_ms: onAt + 100 }, { attr: "power", from: "on", to: "off", at_ms: s.clock.t }])] };
    s.t.onWorld();
    expect(s.phone.slice(-2)).toEqual([{ type: "command_clear", id: P }, MW_OFF]);
    expect(s.t.onAnswer(P, `off:${P}:induction_1:1`, "done")).toBe(false);
    s.clock.t += 120_001;
    s.t.tick();
    expect(s.last()).toEqual(MW_OFF);
    expect(s.t.openCommand()).toMatchObject({ stepId: `off:${P}:microwave_1:1` });
  });

  it("폰이 끊긴 뒤 물을 일이 생기면 바로 그만둔다: 기다리기 시간 초과의 계속·그만 질문을 보내지 않고 실패로 닫아 PAM 판단이 다시 돈다. 켠 인덕션은 끄기 안내 줄에 남는다", async () => {
    let ready = true;
    const s = coachSetup({ phoneReady: () => ready });
    const steps = ramenSteps({ cabinet: "cabinet_1", sink: "sink_1", cooktop: "induction_1", cooktopDevice: "induction_1", waitS: 200 });
    llm.scripts[RAMEN] = () => [planCalls([steps[6]!, { ...steps[8]!, timeout_s: 100, on_timeout: "ask" }, steps[11]!])];
    await s.decide(ramenDecision());
    s.t.onAnswer(P, `${P}:1:hand`, "approve");
    s.t.onAnswer(P, `${P}:1`, "done");
    expect(s.t.waiting()).toBe(true);
    ready = false;
    s.clock.t += 100_001;
    s.t.tick();
    expect(s.phone.some((m) => m.type === "command" && m.step === `${P}:2:again`)).toBe(false);
    expect(s.exec().filter((l) => l.plan_id === P).at(-1)).toMatchObject({ state: "failed", text: EXEC_TEXT.phoneGone });
    expect(EXEC_TEXT.phoneGone).toBe("폰이 없어 물을 수 없어 그만둠");
    expect(s.t.waiting()).toBe(false);
    expect(s.t.openCommand()).toMatchObject({ stepId: `off:${P}:induction_1:1`, text: "인덕션을 꺼 주세요" });
  });

  it("다시 알리기(tell)는 서버 글만 보낸다: 지금 명령(그대로·「먼저」). 모델 글은 보내지 않는다(그 판은 원래 명령 그대로)", async () => {
    const s = coachSetup();
    await s.decide(ramenDecision());
    for (const n of [1, 2, 3]) s.t.onAnswer(P, `${P}:${n}`, "done");
    const before = s.last();
    expect(s.t.tell(P, `${P}:4`, "먼저 인덕션을 켜 주세요" as TellMode)).toBeNull();
    expect(s.last()).toEqual(before);
    expect(s.t.toldAt()).toBeNull();
    expect(s.t.tell(P, `${P}:4`, "earlier")).toBe("먼저 냄비에 물을 받아 주세요");
    for (const n of [4, 5]) s.t.onAnswer(P, `${P}:${n}`, "done");
    // 위험 가전이 대상인 단계도 그 단계 서버 명령으로만 나간다
    expect(s.t.tell(P, `${P}:6`, "repeat")).toBe("냄비를 인덕션에 올려 주세요");
    expect(s.t.tell(P, `${P}:6`, "earlier")).toBe("먼저 냄비를 인덕션에 올려 주세요");
    expect(s.last()).toMatchObject({ step: `${P}:6`, text: "먼저 냄비를 인덕션에 올려 주세요" });
  });

  it("손으로 끄는 단계의 끝 조건(became off)은 그 단계 뒤에 새로 본 꺼짐으로만 넘어간다: 남아 있던 꺼짐 값으로는 넘기지 않아 켠 가전 표시와 끄기 안내가 남는다", async () => {
    let w = { ...world([]), devices: [cooktop(["off"])] };
    const s = coachSetup({ w: () => w });
    const steps = ramenSteps({ cabinet: "cabinet_1", sink: "sink_1", cooktop: "induction_1", cooktopDevice: "induction_1" });
    llm.scripts[RAMEN] = () => [planCalls([steps[6]!, { ...steps[11]!, until: { device: "induction_1", became: "off" } }])];
    await s.decide(ramenDecision());
    s.t.onAnswer(P, `${P}:1:hand`, "approve");
    s.t.onAnswer(P, `${P}:1`, "done");
    expect(s.last()).toMatchObject({ step: `${P}:2`, text: "인덕션을 꺼 주세요" });
    const offAt = s.clock.t;
    s.clock.t += 1_000;
    s.t.onWorld();
    s.t.tick();
    expect(s.last()).toMatchObject({ step: `${P}:2` });
    expect(s.t.current()).toMatchObject({ state: "running" });
    // 그만두면 켠 가전이 남아 있어 안내가 뜬다(상태가 이미 꺼짐이라 끄라는 안내 대신 보이게 해 달라는 부탁)
    s.heard("그만");
    expect(s.last()).toEqual(ASK_OFF);
    // 다른 판: 그 단계 뒤에 꺼진 것을 보면 넘어가 계획이 끝나고 안내가 없다
    const t2 = coachSetup({ w: () => w });
    llm.scripts[RAMEN] = () => [planCalls([steps[6]!, { ...steps[11]!, until: { device: "induction_1", became: "off" } }])];
    await t2.decide(ramenDecision("pam-2", 2));
    t2.t.onAnswer("plan:pam-2", "plan:pam-2:1:hand", "approve");
    t2.t.onAnswer("plan:pam-2", "plan:pam-2:1", "done");
    t2.clock.t += 2_000;
    w = { ...world([]), devices: [cooktop(["off"], [{ attr: "power", from: "off", to: "on", at_ms: offAt }, { attr: "power", from: "on", to: "off", at_ms: t2.clock.t }])] };
    t2.t.onWorld();
    expect(t2.plans.current()).toMatchObject({ status: "done" });
    expect(t2.phone.some((m) => m.type === "command" && /^off:/.test(m.step))).toBe(false);
  });

  it("켜기 전 질문의 안전 문구는 서버 글이다: 모델이 쓴 caution은 폰으로 나가지 않는다", async () => {
    const s = coachSetup();
    const steps = ramenSteps({ cabinet: "cabinet_1", sink: "sink_1", cooktop: "induction_1", cooktopDevice: "induction_1" });
    llm.scripts[RAMEN] = () => [planCalls([{ ...steps[6]!, caution: "인덕션 전원 버튼을 누르세요." }, steps[11]!])];
    await s.decide(ramenDecision());
    expect(s.last()).toMatchObject({ step: `${P}:1:hand` });
    expect(s.commands().some((m) => m.text.includes("누르세요"))).toBe(false);
  });

  it("컵 치우기(코치 아님) 계획에는 coaching()이 거짓이다", async () => {
    const s = setup();
    await s.decide(decision);
    expect(s.t.current()).toMatchObject({ state: "running" });
    expect(s.t.coaching()).toBe(false);
  });
});

describe("실행 추적: 켠 위험 가전 추적은 확인된 꺼짐으로만 푼다(전자레인지 카메라 근거·다시 걸기·회차·확인 불가 복구)", () => {
  const P = "plan:pam-1";
  type Dev = WorldView["devices"][number];
  type Line = Dev["history"][number];
  const MW_ON = { kind: "do", act: "켜기", target: "microwave_1", hand_device: { id: "microwave_1", to: "on" }, timeout_s: 120 };
  const MW_OFF_STEP = { ...MW_ON, act: "끄기", hand_device: { id: "microwave_1", to: "off" } };
  const OFF = { type: "command", id: P, step: `off:${P}:microwave_1:1`, text: "전자레인지를 꺼 주세요", vision: null, choices: DONE, target: null, speak: true, grade: "safety" };
  const ASK = { ...OFF, text: "전자레인지가 보이게 폰을 가까이 대 주세요", choices: [] };
  /** 카메라로 본 전자레인지(이력 줄 seen_ms·explicit, 마지막 관측 sight_last). */
  const mw = (state: string[], history: Line[] = [], sight?: Dev["sight_last"]): Dev => ({ ...cooktop(state, history), id: "microwave_1", kind: "microwave", label: "전자레인지", ...(sight ? { sight_last: sight } : {}) });
  /** 카메라 이력 줄: 도착 at, 촬영 seen. */
  const cam = (from: string | null, to: string, seen: number, explicit = true, at = seen + 1_500): Line => ({ attr: "power", from, to, at_ms: at, seen_ms: seen, explicit });
  const lastOff = (seen: number, close = true, explicit = true): Dev["sight_last"] => ({ power: { value: "off", seen_ms: seen, explicit, close } });

  /** 전자레인지 켜기(1번)·끄기(2번) 계획을 받아 켜기 질문에 승인한다. 돌려준 값: 켜라고 한 시각. */
  async function mwOn(o: { w: () => WorldView; steps?: Record<string, unknown>[]; handDevices?: TrackerFixture["handDevices"] }) {
    const s = coachSetup({ w: o.w, handDevices: "handDevices" in o ? o.handDevices : () => [{ id: "microwave_1", kind: "microwave", label: "전자레인지" }] });
    llm.scripts[RAMEN] = () => [planCalls(o.steps ?? [MW_ON, MW_OFF_STEP])];
    await s.decide(ramenDecision());
    expect(s.t.onAnswer(P, `${P}:1:hand`, "approve")).toBe(true);
    return { s, onAt: s.clock.t };
  }
  const settle = (s: ReturnType<typeof coachSetup>, n = 2) => { for (let i = 0; i < n; i++) { s.clock.t += 500; s.t.onWorld(); s.t.tick(); } };

  it("명시·추정: 크게 보여도 VLM이 전원을 말하지 않은 답(추정 꺼짐)만 이어지면 트윈이 꺼짐이어도 풀지 않는다. 켜짐 → 추정 꺼짐 → 같은 꺼짐 값의 명시 줄이 오면 switch로 푼다", async () => {
    let w = world([]);
    const { s, onAt } = await mwOn({ w: () => w });
    const on = cam("off", "on", onAt + 100);
    w = { ...world([]), devices: [mw(["on"], [on])] };
    s.heard("그만");
    expect(s.last()).toEqual(OFF);
    w = { ...world([]), devices: [mw(["off"], [on, cam("on", "off", onAt + 4_000, false)], lastOff(onAt + 6_000, true, false))] };
    settle(s);
    expect(s.last()).toEqual(OFF);
    expect(s.t.safety().released).toEqual({});
    w = { ...world([]), devices: [mw(["off"], [on, cam("on", "off", onAt + 4_000, false), cam("off", "off", onAt + 8_000)], lastOff(onAt + 8_000, false))] };
    s.t.onWorld();
    expect(s.last()).toEqual({ type: "command_clear", id: P });
    expect(s.t.safety().released).toEqual({ microwave_1: { planId: P, evidenceAt: onAt + 8_000, via: "switch" } });
  });

  it("명시·추정: VLM이 「꺼져 있음」을 답한 켜짐 → 꺼짐(명시)이면 바로 푼다", async () => {
    let w = world([]);
    const { s, onAt } = await mwOn({ w: () => w });
    const on = cam("off", "on", onAt + 100);
    w = { ...world([]), devices: [mw(["on"], [on])] };
    s.heard("그만");
    w = { ...world([]), devices: [mw(["off"], [on, cam("on", "off", onAt + 3_000)])] };
    s.t.onWorld();
    expect(s.last()).toEqual({ type: "command_clear", id: P });
    expect(s.t.safety().released.microwave_1).toEqual({ planId: P, evidenceAt: onAt + 3_000, via: "switch" });
  });

  it("다시 걸기: 꺼짐 촬영 → 다시 켜짐 촬영 → 꺼짐 답 도착·해제 → 켜짐 답 도착 순서면 다시 건다(닫힌 계획이면 끄기 안내). 회차 번호가 오르고 onAt은 그 켜짐 촬영 시각이다", async () => {
    let w = world([]);
    const { s, onAt } = await mwOn({ w: () => w });
    const on = cam("off", "on", onAt + 100);
    w = { ...world([]), devices: [mw(["on"], [on])] };
    s.heard("그만");
    const off = cam("on", "off", onAt + 1_000, true, onAt + 5_000);
    w = { ...world([]), devices: [mw(["off"], [on, off])] };
    s.clock.t = onAt + 5_000;
    s.t.onWorld();
    expect(s.last()).toEqual({ type: "command_clear", id: P });
    // 켜짐 사진은 꺼짐 사진 뒤(onAt + 2000)에 찍혔지만 답은 해제 뒤에 왔다
    s.clock.t = onAt + 6_000;
    w = { ...world([]), devices: [mw(["on"], [on, off, cam("off", "on", onAt + 2_000, true, onAt + 6_000)])] };
    s.t.onWorld();
    expect(s.last()).toEqual({ ...OFF, step: `off:${P}:microwave_1:2` });
    expect(s.t.safety()).toMatchObject({ released: {}, cycles: { microwave_1: { cycle: 2, onAt: onAt + 2_000, askedAt: null } } });
  });

  it("다시 걸기: 해제 근거보다 먼저 찍힌 켜짐이 늦게 와도, 해제 근거 촬영 10분 뒤의 켜짐도 다시 걸지 않는다", async () => {
    let w = world([]);
    const { s, onAt } = await mwOn({ w: () => w });
    const on = cam("off", "on", onAt + 100);
    w = { ...world([]), devices: [mw(["on"], [on])] };
    s.heard("그만");
    const off = cam("on", "off", onAt + 1_000, true, onAt + 5_000);
    w = { ...world([]), devices: [mw(["off"], [on, off])] };
    s.clock.t = onAt + 5_000;
    s.t.onWorld();
    const n = s.phone.length;
    // 해제 근거(onAt + 1000)보다 먼저 찍힌 켜짐
    w = { ...world([]), devices: [mw(["on"], [on, off, cam("off", "on", onAt + 900, true, onAt + 6_000)])] };
    settle(s);
    expect(s.phone).toHaveLength(n);
    // 해제 근거 촬영 10분 뒤의 켜짐
    s.clock.t = onAt + 1_000 + 600_001;
    w = { ...world([]), devices: [mw(["on"], [on, off, cam("off", "on", onAt + 1_000 + 600_001, true, s.clock.t)])] };
    settle(s);
    expect(s.phone).toHaveLength(n);
    expect(s.t.safety().cycles.microwave_1!.cycle).toBe(1);
  });

  it("다시 걸기: 허브는 꺼짐 그대로인데 카메라가 새로 켜짐을 보면(sight_last에만 남음) 다시 건다. 풀린 근거보다 먼저 찍힌 카메라 켜짐으로는 걸지 않는다", async () => {
    let w = world([]);
    const { s, onAt } = await mwOn({ w: () => w });
    const on = cam("off", "on", onAt + 100);
    w = { ...world([]), devices: [mw(["on"], [on])] };
    s.heard("그만");
    const off = cam("on", "off", onAt + 1_000, true, onAt + 5_000);
    w = { ...world([]), devices: [mw(["off"], [on, off])] };
    s.clock.t = onAt + 5_000;
    s.t.onWorld();
    expect(s.last()).toEqual({ type: "command_clear", id: P });
    const n = s.phone.length;
    // 풀린 근거(onAt + 1000)보다 먼저 찍힌 카메라 켜짐: 걸지 않는다
    w = { ...world([]), devices: [mw(["off"], [on, off], { power: { value: "on", seen_ms: onAt + 900, explicit: true, close: false } })] };
    settle(s);
    expect(s.phone).toHaveLength(n);
    // 허브는 꺼짐 그대로(이력 줄 없음), 카메라 마지막 관측만 새 켜짐
    w = { ...world([]), devices: [mw(["off"], [on, off], { power: { value: "on", seen_ms: onAt + 3_000, explicit: true, close: false } })] };
    s.t.onWorld();
    expect(s.last()).toEqual({ ...OFF, step: `off:${P}:microwave_1:2` });
    expect(s.t.safety()).toMatchObject({ released: {}, cycles: { microwave_1: { cycle: 2, onAt: onAt + 3_000, askedAt: null } } });
  });

  it("끄기 단계는 실행 추적이 회차마다 든 풀린 근거로 끝난다: 꺼짐 확인 뒤 이력 줄이 20개 넘게 쌓여 그 근거가 밀려나도 끝나고, 그 근거 뒤 새 켜짐(sight_last)이 있으면 끝나지 않고 다시 건다", async () => {
    const steps = ramenSteps({ cabinet: "cabinet_1", sink: "sink_1", cooktop: "induction_1", cooktopDevice: "induction_1", waitS: 60 });
    /** 끄기 단계(3번)까지: 켜짐(허브) → 기다리는 동안 꺼짐(허브, 풀림) → 이력 20개 넘게 다른 줄(앞 줄은 밀려남). */
    async function toOff(sight?: WorldView["devices"][number]["sight_last"]) {
      let w = { ...world([]), devices: [cooktop(["off"])] };
      const s = coachSetup({ w: () => w });
      llm.scripts[RAMEN] = () => [planCalls([steps[6]!, steps[8]!, steps[11]!])];
      await s.decide(ramenDecision());
      s.t.onAnswer(P, `${P}:1:hand`, "approve");
      s.clock.t += 1_000;
      const on = { attr: "power", from: "off", to: "on", at_ms: s.clock.t };
      w = { ...world([]), devices: [cooktop(["on"], [on])] };
      s.t.onWorld();
      s.clock.t += 1_000;
      const offAt = s.clock.t;
      w = { ...world([]), devices: [cooktop(["off"], [on, { attr: "power", from: "on", to: "off", at_ms: offAt }])] };
      s.t.onWorld();
      expect(s.t.safety()).toMatchObject({ hot: [], released: { induction_1: { evidenceAt: offAt, via: "switch" } } });
      const filler = Array.from({ length: 21 }, (_, i) => ({ attr: "door", from: i % 2 ? "open" : "closed", to: i % 2 ? "closed" : "open", at_ms: offAt + 100 + i }));
      w = { ...world([]), devices: [{ ...cooktop(["off"], filler), ...(sight ? { sight_last: sight } : {}) }] };
      s.clock.t += 60_000;
      s.t.tick();
      for (let i = 0; i < 3; i++) { s.clock.t += 500; s.t.onWorld(); s.t.tick(); }
      return { s, offAt };
    }
    const done = await toOff();
    expect(done.s.plans.current()).toMatchObject({ status: "done" });
    expect(done.s.phone.some((m) => m.type === "command" && /^off:/.test(m.step))).toBe(false);
    // 근거 뒤 카메라가 새 켜짐을 봤다(허브는 꺼짐): 끝나지 않고 다시 건다
    const again = await toOff({ power: { value: "on", seen_ms: 12_500, explicit: true, close: false } });
    expect(again.s.steps()[2]).toBe("active");
    expect(again.s.t.safety()).toMatchObject({ hot: ["induction_1"], cycles: { induction_1: { cycle: 2, onAt: 12_500 } } });
  });

  it("끄기 단계는 hot이 없다는 것만으로 끝나지 않는다: 풀린 지 11분 뒤(다시 걸기 기간 밖) 다시 켜진 인덕션이면 그 단계에서 다시 걸고, 허브 꺼짐을 봐야 끝난다", async () => {
    let w = { ...world([]), devices: [cooktop(["off"])] };
    const s = coachSetup({ w: () => w });
    const steps = ramenSteps({ cabinet: "cabinet_1", sink: "sink_1", cooktop: "induction_1", cooktopDevice: "induction_1", waitS: 700 });
    llm.scripts[RAMEN] = () => [planCalls([steps[6]!, steps[8]!, steps[11]!])];
    await s.decide(ramenDecision());
    s.t.onAnswer(P, `${P}:1:hand`, "approve");
    s.clock.t += 1_000;
    const on = { attr: "power", from: "off", to: "on", at_ms: s.clock.t };
    w = { ...world([]), devices: [cooktop(["on"], [on])] };
    s.t.onWorld();
    expect(s.steps()[1]).toBe("active");
    // 기다리는 동안 꺼짐(풀림)
    s.clock.t += 1_000;
    const off = { attr: "power", from: "on", to: "off", at_ms: s.clock.t };
    w = { ...world([]), devices: [cooktop(["off"], [on, off])] };
    s.t.onWorld();
    expect(s.t.safety()).toMatchObject({ hot: [], released: { induction_1: { via: "switch" } } });
    // 11분 뒤 다시 켜짐: 다시 걸기 기간이 지나 그때는 걸리지 않는다
    s.clock.t += 660_000;
    s.t.tick();
    const again = { attr: "power", from: "off", to: "on", at_ms: s.clock.t };
    w = { ...world([]), devices: [cooktop(["on"], [on, off, again])] };
    s.t.onWorld();
    expect(s.t.safety().hot).toEqual([]);
    // 기다리기가 끝나 끄기 단계(3번): 지금 켜져 있으니 끝나지 않고 그 자리에서 다시 건다
    s.clock.t += 45_000;
    s.t.tick();
    for (let i = 0; i < 3; i++) { s.clock.t += 500; s.t.onWorld(); s.t.tick(); }
    expect(s.last()).toMatchObject({ step: `${P}:3`, text: "인덕션을 꺼 주세요" });
    expect(s.steps()[2]).toBe("active");
    expect(s.t.safety()).toMatchObject({ hot: ["induction_1"], cycles: { induction_1: { cycle: 2, onAt: again.at_ms, askedAt: null } } });
    // 허브 꺼짐을 보면 풀리고 끝난다
    s.clock.t += 1_000;
    w = { ...world([]), devices: [cooktop(["off"], [on, off, again, { attr: "power", from: "on", to: "off", at_ms: s.clock.t }])] };
    s.t.onWorld();
    expect(s.plans.current()).toMatchObject({ status: "done" });
    expect(s.t.safety().hot).toEqual([]);
    expect(s.phone.some((m) => m.type === "command" && /^off:/.test(m.step))).toBe(false);
  });

  it("다시 걸기: 같은 계획이 돌고 있으면 그 계획 hot에 다시 넣고 onAt이 그 켜짐 시각이 된다(라면, 허브 근거)", async () => {
    let w = { ...world([]), devices: [cooktop(["off"])] };
    const s = coachSetup({ w: () => w });
    await s.decide(ramenDecision());
    for (let n = 1; n <= 6; n++) s.t.onAnswer(P, `${P}:${n}`, "done");
    s.t.onAnswer(P, `${P}:7:hand`, "approve");
    const onAt = s.clock.t;
    s.clock.t += 1_000;
    const on = { attr: "power", from: "off", to: "on", at_ms: s.clock.t };
    w = { ...world([]), devices: [cooktop(["on"], [on])] };
    s.t.onWorld();
    // 9번 기다리는 동안 꺼졌다가(풀림) 다시 켜졌다(다시 걸림)
    s.clock.t += 4_001; s.t.tick();
    expect(s.steps()[8]).toBe("active");
    s.clock.t += 1_000;
    const off = { attr: "power", from: "on", to: "off", at_ms: s.clock.t };
    w = { ...world([]), devices: [cooktop(["off"], [on, off])] };
    s.t.onWorld();
    expect(s.t.safety()).toMatchObject({ hot: [], cycles: { induction_1: { cycle: 1, onAt } } });
    s.clock.t += 1_000;
    w = { ...world([]), devices: [cooktop(["on"], [on, off, { attr: "power", from: "off", to: "on", at_ms: s.clock.t }])] };
    s.t.onWorld();
    expect(s.t.safety()).toEqual({ hot: ["induction_1"], cycles: { induction_1: { cycle: 2, onAt: s.clock.t, askedAt: null } }, released: {} });
    expect(s.t.current()).toMatchObject({ state: "running" });
  });

  it("다시 걸기: 계획 A가 풀린 뒤 계획 B가 도는 중에 A의 가전이 다시 켜지면 B 명령이 명령 줄에 그대로이고, A의 끄기 안내는 B가 끝난 뒤 뜬다", async () => {
    let w = world([]);
    const { s, onAt } = await mwOn({ w: () => w });
    const on = cam("off", "on", onAt + 100);
    const off = cam("on", "off", onAt + 1_000);
    w = { ...world([]), devices: [mw(["off"], [on, off])] };
    s.heard("그만");
    expect(s.t.safety().released).toMatchObject({ microwave_1: { planId: P } });
    // 계획 B(라면, 승인 기억 있음): 첫 명령이 바로 뜬다
    llm.scripts = { ...llm.scripts, ...ramenScripts() };
    s.clock.t += 1_000;
    await s.decide(ramenDecision("pam-2", 2));
    expect(s.last()).toMatchObject({ id: "plan:pam-2", step: "plan:pam-2:1" });
    const b = s.last();
    w = { ...world([]), devices: [mw(["on"], [on, off, cam("off", "on", onAt + 3_000)])] };
    settle(s);
    expect(s.last()).toEqual(b);
    expect(s.t.openCommand()).toMatchObject({ planId: "plan:pam-2" });
    s.heard("그만");
    expect(s.phone.slice(-2)).toEqual([{ type: "command_clear", id: "plan:pam-2" }, { ...OFF, step: `off:${P}:microwave_1:2` }]);
  });

  it("확인 불가 복구: 켜짐을 놓친 채 닫히면 부탁이 뜬다. 부탁 전에 찍힌 것·멀리서 본 것(close 거짓)·추정 꺼짐으로는 풀지 않고, 부탁 뒤 촬영된 가까이 본 명시 꺼짐이면 confirmed로 푼다", async () => {
    let w = { ...world([]), devices: [mw(["off"])] };
    const { s } = await mwOn({ w: () => w });
    s.clock.t += 1_000;
    s.heard("그만");
    expect(s.last()).toEqual(ASK);
    const askedAt = s.clock.t;
    expect(s.t.safety().cycles.microwave_1!.askedAt).toBe(askedAt);
    for (const sight of [lastOff(askedAt - 1), lastOff(askedAt + 1_000, false), lastOff(askedAt + 1_000, true, false)]) {
      w = { ...world([]), devices: [mw(["off"], [], sight)] };
      settle(s);
      expect(s.last()).toEqual(ASK);
    }
    w = { ...world([]), devices: [mw(["off"], [], lastOff(askedAt + 1_000))] };
    s.t.onWorld();
    expect(s.last()).toEqual({ type: "command_clear", id: P });
    expect(s.t.safety().released.microwave_1).toEqual({ planId: P, evidenceAt: askedAt + 1_000, via: "confirmed" });
  });

  it("회차: 다시 걸린 뒤에는 옛 회차의 부탁 뒤에 찍혔던 가까이 본 꺼짐 기록이 남아 있어도 풀지 않는다(회차가 오르고 askedAt이 비워진다)", async () => {
    let w = { ...world([]), devices: [mw(["off"])] };
    const { s } = await mwOn({ w: () => w });
    s.clock.t += 1_000;
    s.heard("그만");
    const askedAt = s.clock.t;
    const close = lastOff(askedAt + 1_000);
    w = { ...world([]), devices: [mw(["off"], [], close)] };
    s.t.onWorld();
    expect(s.t.safety().released.microwave_1).toMatchObject({ via: "confirmed" });
    // 다시 켜짐(카메라) → 다시 걸림
    const on = cam("off", "on", askedAt + 2_000);
    s.clock.t = askedAt + 4_000;
    w = { ...world([]), devices: [mw(["on"], [on], close)] };
    s.t.onWorld();
    expect(s.last()).toEqual({ ...OFF, step: `off:${P}:microwave_1:2` });
    expect(s.t.safety().cycles.microwave_1).toEqual({ cycle: 2, onAt: askedAt + 2_000, askedAt: null });
    // 추정 꺼짐 + 옛 회차의 가까이 본 명시 꺼짐 기록: 풀지 않는다
    w = { ...world([]), devices: [mw(["off"], [on, cam("on", "off", askedAt + 5_000, false)], close)] };
    settle(s);
    expect(s.last()).toEqual({ ...OFF, step: `off:${P}:microwave_1:2` });
  });

  it("회차: 카메라는 가까이 본 명시 꺼짐을 말해도 허브 신호가 지금 켜짐이면 풀지 않는다", async () => {
    let w = { ...world([]), devices: [mw(["off"])] };
    const { s } = await mwOn({ w: () => w });
    s.clock.t += 1_000;
    s.heard("그만");
    const askedAt = s.clock.t;
    w = { ...world([]), devices: [mw(["on"], [], lastOff(askedAt + 1_000))] };
    settle(s);
    expect(s.last()).toEqual(ASK);
    expect(s.t.safety().released).toEqual({});
  });

  it("확인 불가 복구: 시간 초과 질문에서 「그만」이면 hot이 남고 안내는 부탁 하나로 120초마다 되풀이된다", async () => {
    const w = { ...world([]), devices: [mw(["off"])] };
    const { s } = await mwOn({ w: () => w, steps: [MW_ON, { ...MW_OFF_STEP, on_timeout: "ask" }] });
    s.t.onAnswer(P, `${P}:1`, "done");
    expect(s.last()).toMatchObject({ step: `${P}:2`, text: "전자레인지를 꺼 주세요" });
    s.clock.t += 20_001; s.t.tick();
    expect(s.last()).toMatchObject({ step: `${P}:2`, text: ASK.text, choices: [] });
    s.clock.t += 100_000; s.t.tick();
    expect(s.last()).toMatchObject({ step: `${P}:2:again` });
    expect(s.t.onAnswer(P, `${P}:2:again`, "stop")).toBe(true);
    expect(s.last()).toEqual(ASK);
    const n = s.phone.length;
    s.clock.t += 120_001; s.t.tick();
    s.clock.t += 120_001; s.t.tick();
    expect(s.phone.slice(n)).toEqual([ASK, ASK]);
    expect(s.t.safety().released).toEqual({});
  });

  describe("닫힌 계획의 끄기 안내와 다른 계획(11c-2)", () => {
    const GO = { kind: "go", act: "가기", target: "cabinet_1", until: { phone_near: "cabinet_1" }, timeout_s: 600 };
    const P2 = "plan:pam-2";
    /** A: 전자레인지를 켜고 「그만」으로 닫은 뒤 카메라가 꺼짐을 봐 풀린 상태. 돌려준 값: 그 시험 틀과 A의 켜짐·꺼짐 이력 줄. */
    async function releasedA(o: { w: () => WorldView; set: (devices: Dev[]) => void; over?: Parameters<typeof coachSetup>[0] }) {
      const s = coachSetup({ w: o.w, handDevices: () => [{ id: "induction_1", kind: "cooktop", label: "인덕션" }, { id: "microwave_1", kind: "microwave", label: "전자레인지" }], ...o.over });
      llm.scripts[RAMEN] = () => [planCalls([MW_ON, MW_OFF_STEP])];
      await s.decide(ramenDecision());
      s.t.onAnswer(P, `${P}:1:hand`, "approve");
      const onAt = s.clock.t;
      const lines = [cam("off", "on", onAt + 100), cam("on", "off", onAt + 1_000)];
      o.set([mw(["off"], lines)]);
      s.heard("그만");
      expect(s.t.safety().released).toMatchObject({ microwave_1: { planId: P } });
      return { s, onAt, lines };
    }

    it("끄기 안내 명령: id는 닫힌 계획 id, step은 off:<계획>:<가전>:<회차>. at이 그 안내여도 말 「완료」·「다 했어」는 답으로 받지 않는다", async () => {
      const w = world([]);
      const { s } = await mwOn({ w: () => w });
      s.heard("그만");
      expect(s.last()).toEqual({ ...OFF, step: `off:${P}:microwave_1:1` });
      const n = s.phone.length;
      expect(s.t.onHeard("완료", heardAtOf(s.phone))).toEqual({ kind: "stale" });
      expect(s.t.onHeard("다 했어", heardAtOf(s.phone))).toEqual({ kind: "stale" });
      expect(s.phone).toHaveLength(n);
      expect(s.t.openCommand()).toMatchObject({ planId: P, stepId: `off:${P}:microwave_1:1`, choices: [{ id: "done" }] });
    });

    it("안내가 남은 동안 폰이 필요한 계획(처음 하는 컵 치우기)은 시작하지 않고 실행 기록 「전자레인지 꺼짐 확인 전이라 새 일을 미룸」, 안내가 풀리면 첫 명령(승인 질문)이 간다", async () => {
      let devs: Dev[] = [];
      const w = () => ({ ...world([cup("present")]), devices: devs });
      const { s } = await mwOn({ w });
      devs = [mw(["on"], [cam("off", "on", s.clock.t + 100)])];
      s.heard("그만");
      expect(s.last()).toEqual(OFF);
      s.clock.t += 1_000;
      await s.decide({ ...decision, id: "pam-2", seq: 2 });
      for (let i = 0; i < 5; i++) { s.clock.t += 1_000; s.t.tick(); }
      expect(s.last()).toEqual(OFF);
      expect(s.exec().filter((l) => l.plan_id === P2 && l.text === EXEC_TEXT.deferred("전자레인지"))).toHaveLength(1);
      devs = [mw(["off"], [cam("off", "on", 10_100), cam("on", "off", s.clock.t)])];
      s.t.onWorld();
      expect(s.phone.slice(-2)).toEqual([{ type: "command_clear", id: P }, expect.objectContaining({ id: P2, step: `${P2}:approve`, text: "컵 치우기를 할까요?" })]);
    });

    it("같은 때 이미 승인된 가전 계획(에어컨 켜기)은 바로 돌아 트윈 에어컨을 켠다. 명령 줄의 끄기 안내는 그대로이고 그 계획의 알림 줄은 명령 줄로 가지 않는다(실행 기록에는 남는다)", async () => {
      const home = makeHome();
      llm.scripts["에어컨 켜기"] = () => [planCalls([{ kind: "device", label: "거실 에어컨 켜기", target: "ac_living", tool: "turn_on", timeout_s: 60 }, { kind: "say", notice: "끝", timeout_s: 10 }])];
      const w = world([]);
      const s = coachSetup({
        w: () => w, devices: deviceRunner(home.hub, home.policy), approvals: store({ [`task:${RAMEN}`]: "approve", "task:에어컨 켜기": "approve" }),
        handDevices: () => [{ id: "microwave_1", kind: "microwave", label: "전자레인지" }, { id: "ac_living", kind: "aircon", label: "스탠드 에어컨" }],
      });
      llm.scripts[RAMEN] = () => [planCalls([MW_ON, MW_OFF_STEP])];
      await s.decide(ramenDecision());
      s.t.onAnswer(P, `${P}:1:hand`, "approve");
      s.heard("그만");
      expect(s.last()).toEqual(OFF);
      const n = s.phone.length;
      await s.decide({ ...decision, id: "pam-2", seq: 2, action: "에어컨 켜기" });
      await new Promise((r) => setTimeout(r, 30));
      expect(home.hub.get("ac_living")!.twin.power).toBe("on");
      for (let i = 0; i < 3; i++) { s.clock.t += 5_000; s.t.tick(); }
      expect(s.plans.current()).toMatchObject({ id: P2, status: "done" });
      expect(s.phone.slice(n).filter((m) => m.type === "command")).toEqual([]);
      expect(s.t.openCommand()).toMatchObject({ planId: P, stepId: OFF.step });
      expect(s.exec().filter((l) => l.plan_id === P2).map((l) => l.state)).toEqual(["decided", "planned", "running", "done"]);
    });

    it("A 라면이 끝나 인덕션이 풀린 뒤 10분 안에 B 라면 7번이 인덕션을 다시 켜도 A 안내가 생기지 않는다. 그 회차는 B 것이고 B는 12번 끄기까지 간다", async () => {
      let w = { ...world([]), devices: [cooktop(["off"])] };
      const s = coachSetup({ w: () => w });
      await toOn(s);
      s.t.onAnswer(P, `${P}:7:hand`, "approve");
      s.clock.t += 1_000;
      const onA = { attr: "power", from: "off", to: "on", at_ms: s.clock.t };
      s.clock.t += 1_000;
      const offA = { attr: "power", from: "on", to: "off", at_ms: s.clock.t };
      w = { ...world([]), devices: [cooktop(["off"], [onA, offA])] };
      s.t.onWorld();
      s.heard("그만");
      expect(s.t.safety().released).toMatchObject({ induction_1: { planId: P } });
      s.clock.t += 60_000;
      await toOn(s, ramenDecision("pam-2", 2));
      expect(s.t.onAnswer(P2, `${P2}:7:hand`, "approve")).toBe(true);
      s.clock.t += 1_000;
      const onB = { attr: "power", from: "off", to: "on", at_ms: s.clock.t };
      w = { ...world([]), devices: [cooktop(["on"], [onA, offA, onB])] };
      s.t.onWorld();
      expect(s.t.safety()).toMatchObject({ hot: ["induction_1"], released: {}, cycles: { induction_1: { cycle: 2 } } });
      s.clock.t += 4_001; s.t.tick();
      s.clock.t += 240_001; s.t.tick();
      s.t.onAnswer(P2, `${P2}:10`, "done");
      s.clock.t += 240_001; s.t.tick();
      expect(s.last()).toMatchObject({ id: P2, step: `${P2}:12` });
      s.clock.t += 1_000;
      w = { ...world([]), devices: [cooktop(["off"], [onA, offA, onB, { attr: "power", from: "on", to: "off", at_ms: s.clock.t }])] };
      s.t.onWorld();
      s.clock.t += 4_001; s.t.tick();
      expect(s.plans.current()).toMatchObject({ id: P2, status: "done" });
      expect(s.phone.some((m) => m.type === "command" && /^off:/.test(m.step))).toBe(false);
    });

    it("B가 켜지 않은 A 가전이 B 도중 다시 켜지면 A 안내는 줄에서 기다리고 B는 그대로 간다. 폰에 「전자레인지가 다시 켜졌어요. 꺼 주세요」를 소리로만 보내고 120초 뒤 다시 말한다. B의 기다리기 시간은 그대로 흐르고, B가 닫히면 A 안내가 명령 줄에 뜬다", async () => {
      let devs: Dev[] = [];
      const said: string[] = [];
      const { s, lines } = await releasedA({ w: () => ({ ...world([]), devices: devs }), set: (d) => { devs = d; }, over: { sayAloud: (t) => said.push(t) } });
      const B = ramenSteps({ cabinet: "cabinet_1", sink: "sink_1", cooktop: "induction_1", cooktopDevice: "induction_1", waitS: 300 });
      llm.scripts[RAMEN] = () => [planCalls([GO, B[8]!, B[3]!])];
      s.clock.t += 1_000;
      await s.decide(ramenDecision("pam-2", 2));
      expect(s.t.onAnswer(P2, `${P2}:1`, "done")).toBe(true);
      expect(s.steps()[1]).toBe("active");
      const waitFrom = s.clock.t;
      // 기다리는 동안 A의 전자레인지가 다시 켜짐(카메라)
      s.clock.t += 2_000;
      devs = [mw(["on"], [...lines, cam("off", "on", s.clock.t - 500)])];
      s.t.onWorld();
      expect(said).toEqual(["전자레인지가 다시 켜졌어요. 꺼 주세요"]);
      expect(s.t.offTold()).toMatchObject({ device: "전자레인지" });
      expect(s.phone.filter((m) => m.type === "command" && /^off:/.test(m.step))).toEqual([]);
      expect(s.t.openCommand()).toBeNull();
      s.clock.t += 120_001; s.t.tick();
      expect(said).toHaveLength(2);
      // 기다리기는 그 시간에 끝난다(300초)
      s.clock.t = waitFrom + 299_000; s.t.tick();
      expect(s.steps()[1]).toBe("active");
      s.clock.t = waitFrom + 300_001; s.t.tick();
      expect(s.last()).toMatchObject({ id: P2, step: `${P2}:3` });
      const told = said.length;
      s.heard("그만");
      expect(s.phone.slice(-2)).toEqual([{ type: "command_clear", id: P2 }, { ...OFF, step: `off:${P}:microwave_1:2` }]);
      // 명령 줄에 안내가 뜬 뒤에는 소리 알림을 멈춘다(명령 줄 안내가 읽힌다)
      s.clock.t += 120_001; s.t.tick();
      expect(said).toHaveLength(told);
    });

    it("B 승인 질문을 기다리는 중이어도 같다: A 안내는 기다리고 소리로만 알린다", async () => {
      let devs: Dev[] = [];
      const said: string[] = [];
      const { s, lines, onAt } = await releasedA({
        w: () => ({ ...world([cup("present")]), devices: devs }), set: (d) => { devs = d; }, over: { sayAloud: (t) => said.push(t) },
      });
      s.clock.t += 1_000;
      await s.decide({ ...decision, id: "pam-2", seq: 2 });
      expect(s.last()).toMatchObject({ id: P2, step: `${P2}:approve` });
      devs = [mw(["on"], [...lines, cam("off", "on", onAt + 2_000)])];
      s.t.onWorld();
      expect(said).toEqual(["전자레인지가 다시 켜졌어요. 꺼 주세요"]);
      expect(s.last()).toMatchObject({ id: P2, step: `${P2}:approve` });
      expect(s.t.onAnswer(P2, `${P2}:approve`, "reject")).toBe(true);
      expect(s.phone.slice(-2)).toEqual([{ type: "command_clear", id: P2 }, { ...OFF, step: `off:${P}:microwave_1:2` }]);
    });

    it("B 도중 두 가전(전자레인지·인덕션) 안내가 줄에서 기다리면 120초마다 소리 알림을 두 가전에 번갈아 보낸다", async () => {
      let devs: Dev[] = [];
      const said: string[] = [];
      const s = coachSetup({
        w: () => ({ ...world([]), devices: devs }), sayAloud: (t) => said.push(t),
        handDevices: () => [{ id: "induction_1", kind: "cooktop", label: "인덕션" }, { id: "microwave_1", kind: "microwave", label: "전자레인지" }],
      });
      const IND_ON = { ...MW_ON, target: "induction_1", hand_device: { id: "induction_1", to: "on" } };
      const IND_OFF = { ...IND_ON, act: "끄기", hand_device: { id: "induction_1", to: "off" } };
      llm.scripts[RAMEN] = () => [planCalls([MW_ON, IND_ON, MW_OFF_STEP, IND_OFF])];
      await s.decide(ramenDecision());
      s.t.onAnswer(P, `${P}:1:hand`, "approve");
      const mwLines = [cam("off", "on", s.clock.t + 100)];
      devs = [mw(["on"], mwLines), cooktop(["off"])];
      settle(s);
      expect(s.last()).toMatchObject({ step: `${P}:2:hand` });
      s.t.onAnswer(P, `${P}:2:hand`, "approve");
      s.clock.t += 1_000;
      const indLines: Line[] = [{ attr: "power", from: "off", to: "on", at_ms: s.clock.t }];
      devs = [mw(["on"], mwLines), cooktop(["on"], indLines)];
      s.t.onWorld();
      s.heard("그만");
      s.clock.t += 1_000;
      mwLines.push(cam("on", "off", s.clock.t));
      indLines.push({ attr: "power", from: "on", to: "off", at_ms: s.clock.t });
      devs = [mw(["off"], mwLines), cooktop(["off"], indLines)];
      s.t.onWorld();
      expect(Object.keys(s.t.safety().released).sort()).toEqual(["induction_1", "microwave_1"]);
      const B = ramenSteps({ cabinet: "cabinet_1", sink: "sink_1", cooktop: "induction_1", cooktopDevice: "induction_1", waitS: 300 });
      llm.scripts[RAMEN] = () => [planCalls([GO, B[8]!, B[3]!])];
      s.clock.t += 1_000;
      await s.decide(ramenDecision("pam-2", 2));
      expect(s.t.onAnswer(P2, `${P2}:1`, "done")).toBe(true);
      // 기다리는 동안 두 가전이 다시 켜짐
      s.clock.t += 2_000;
      devs = [mw(["on"], [...mwLines, cam("off", "on", s.clock.t - 500)]), cooktop(["on"], [...indLines, { attr: "power", from: "off", to: "on", at_ms: s.clock.t - 500 }])];
      s.t.onWorld();
      const MW_TOLD = "전자레인지가 다시 켜졌어요. 꺼 주세요";
      const IND_TOLD = "인덕션이 다시 켜졌어요. 꺼 주세요";
      expect([...said].sort()).toEqual([MW_TOLD, IND_TOLD].sort());
      for (let i = 0; i < 4; i++) { s.clock.t += 60_001; s.t.tick(); }
      expect(s.steps()[1]).toBe("active");
      expect(said.slice(2)).toEqual([said[0], said[1]]);
      expect(s.t.offTold()).toMatchObject({ device: said[1] === MW_TOLD ? "전자레인지" : "인덕션" });
    });

    it("A 안내가 줄에 남은 가전을 B가 승인해 켜면 승인을 받고, B가 켠 채 닫혀도 그 가전 안내는 하나만 남는다", async () => {
      let devs: Dev[] = [];
      const { s, lines, onAt } = await releasedA({ w: () => ({ ...world([]), devices: devs }), set: (d) => { devs = d; } });
      llm.scripts[RAMEN] = () => [planCalls([GO, MW_ON, MW_OFF_STEP])];
      s.clock.t += 1_000;
      await s.decide(ramenDecision("pam-2", 2));
      devs = [mw(["on"], [...lines, cam("off", "on", onAt + 2_000)])];
      s.t.onWorld();
      expect(s.last()).toMatchObject({ id: P2, step: `${P2}:1` });
      s.t.onAnswer(P2, `${P2}:1`, "done");
      expect(s.last()).toMatchObject({ id: P2, step: `${P2}:2:hand` });
      expect(s.t.onAnswer(P2, `${P2}:2:hand`, "approve")).toBe(true);
      expect(s.t.safety()).toMatchObject({ hot: ["microwave_1"], cycles: { microwave_1: { cycle: 3 } } });
      s.heard("그만");
      const offs = () => s.phone.filter((m) => m.type === "command" && /^off:/.test(m.step)).map((m) => m.type === "command" && m.step);
      expect(offs()).toEqual([`off:${P}:microwave_1:2`]);
      s.clock.t += 120_001; s.t.tick();
      expect(offs()).toEqual([`off:${P}:microwave_1:2`, `off:${P}:microwave_1:2`]);
    });
  });

  it("이름 없는 가전이면 「완료」에 부탁을 보내지 않고 끄라는 안내 그대로 둔다", async () => {
    const w = world([]);
    const { s } = await mwOn({ w: () => w, handDevices: undefined });
    s.heard("그만");
    const OFF_ANY = { ...OFF, text: "가전을 꺼 주세요" };
    expect(s.last()).toEqual(OFF_ANY);
    const n = s.phone.length;
    expect(s.t.onAnswer(P, `off:${P}:microwave_1:1`, "done")).toBe(true);
    expect(s.phone).toHaveLength(n);
    expect(s.t.openCommand()).toMatchObject({ text: "가전을 꺼 주세요", choices: [{ id: "done" }] });
  });

  it("떠 있는 끄기 안내를 읽는 길(SafetyTracker.shownOff)은 깊은 읽기 전용 복사본을 준다: 받은 쪽이 바꿔도 안내·추적은 그대로다", async () => {
    let w = world([]);
    const { s, onAt } = await mwOn({ w: () => w });
    w = { ...world([]), devices: [mw(["on"], [cam("off", "on", onAt + 100)])] };
    s.heard("그만");
    expect(s.last()).toEqual(OFF);
    const safety = (s.t as unknown as { core: TrackCore }).core.safety;
    const off = safety.shownOff()!;
    // @ts-expect-error 깊은 읽기 전용: 안내 가전을 바꿀 수 없다
    off.note.deviceId = "fridge_1";
    // @ts-expect-error 깊은 읽기 전용: 부탁으로 바꿀 수 없다
    off.note.ask = true;
    // @ts-expect-error 깊은 읽기 전용: 명령 글을 바꿀 수 없다
    off.sent.text = "바뀐 글";
    // @ts-expect-error 깊은 읽기 전용: 답 단추를 바꿀 수 없다
    off.sent.choices.length = 0;
    expect(s.t.openCommand()).toMatchObject({ planId: P, stepId: OFF.step, kind: "command", text: "전자레인지를 꺼 주세요", choices: [{ id: "done" }] });
    expect(s.t.offTrack()).toEqual({ hot: [], notices: ["microwave_1"] });
    expect(safety.shownOff()).toMatchObject({ sent: { text: "전자레인지를 꺼 주세요", choices: [{ id: "done" }] }, note: { deviceId: "microwave_1", ask: false } });
  });

  it("계획 실행 상태의 켜기 회차(Run.onAt)는 읽기 전용 복사본이다: 다른 부분이 바꿔도 SafetyTracker의 회차는 그대로다", async () => {
    const w = world([]);
    const { s, onAt } = await mwOn({ w: () => w });
    const cycle = (s.t as unknown as { core: TrackCore }).core.run!.onAt.get("microwave_1")!;
    // @ts-expect-error 읽기 전용: 회차의 부탁 시각을 바꿀 수 없다
    cycle.askedAt = onAt;
    // @ts-expect-error 읽기 전용: 회차 시작 시각을 바꿀 수 없다
    cycle.onAt = 0;
    expect(s.t.safety().cycles).toEqual({ microwave_1: { cycle: 1, onAt, askedAt: null } });
  });
});

describe("실행 추적: 전자레인지로 데우기 알려 주기(7번 다 되기 기다리기는 cycleEnded로만 끝난다)", () => {
  const MW_TASK = "전자레인지로 데우기 알려 주기";
  const MWK = "microwave_kitchen";
  const P = "plan:pam-1";
  type Dev = WorldView["devices"][number];
  type Line = Dev["history"][number];
  const ASK = "그릇이 뜨거워져요. 전자레인지를 켤까요?";
  const SHOW = "전자레인지가 보이게 폰을 가까이 대 주세요";
  /** 카메라로 본 주방 전자레인지(이력 줄 seen_ms·explicit, 마지막 관측 sight_last). */
  const mwk = (state: string[], history: Line[] = [], sight?: Dev["sight_last"]): Dev => ({ ...cooktop(state, history), id: MWK, kind: "microwave", label: "주방 전자레인지", ...(sight ? { sight_last: sight } : {}) });
  const cam = (from: string | null, to: string, seen: number, explicit = true, at = seen + 1_500): Line => ({ attr: "power", from, to, at_ms: at, seen_ms: seen, explicit });
  const lastOff = (seen: number, close = true, explicit = true): Dev["sight_last"] => ({ power: { value: "off", seen_ms: seen, explicit, close } });
  const mwFloor = () => floorPlanFrom({ ...structuredClone(SMALL_SCENE), objects: [...structuredClone(SMALL_SCENE.objects), { id: MWK, type: "microwave", room: "kitchen", plan: { position: [6, 0.5] } }] });
  const mwSpec = { id: MWK, label: "주방 전자레인지", room: "kitchen", roomLabel: "kitchen", twinType: "microwave", twinAttrs: { power: ["off", "on"] }, ...describeDevice("microwave", { power: ["off", "on"] })! };
  const mwDecision = (): DecisionRecord => ({ ...decision, id: "pam-1", seq: 1, action: MW_TASK, prediction: { ...pred, task_index: 2 } });

  function mwSetup(o: { w: () => WorldView; waitS?: number }) {
    const plans = new PlanHub(mwFloor(), () => {}, () => "t");
    const hub = new MemoryHub([mwSpec]);
    llm.scripts = { ...llm.scripts, ...microwaveScripts(o.waitS) };
    const planner = testPlanner(llm);
    return setup({
      plans, w: o.w, approvals: store({ [`task:${MW_TASK}`]: "approve" }), handDevices: () => [{ id: MWK, kind: "microwave", label: "주방 전자레인지" }],
      planner: (d, signal) => planner.plan(planContext({ decision: d, world: o.w(), floor: plans.floor(), hub }), signal),
    });
  }
  /** 1~4번을 「완료」로 넘기고 5번 켜기 질문에 승인한다. 돌려준 값: 켜라고 한 시각. */
  async function toOn(s: ReturnType<typeof setup>) {
    await s.decide(mwDecision());
    for (let n = 1; n <= 4; n++) expect(s.t.onAnswer(P, `${P}:${n}`, "done"), String(n)).toBe(true);
    expect(s.last()).toMatchObject({ step: `${P}:5:hand`, text: ASK, choices: [{ id: "approve" }, { id: "reject" }], grade: "question" });
    expect(s.phone.some((m) => m.type === "command" && m.text === "전자레인지를 켜 주세요")).toBe(false);
    expect(s.t.onAnswer(P, `${P}:5:hand`, "approve")).toBe(true);
    expect(s.last()).toMatchObject({ step: `${P}:5`, text: "전자레인지를 켜 주세요" });
    return s.clock.t;
  }
  /** 6번 알림(4초)을 지나 7번 기다리기로. */
  const toWait = (s: ReturnType<typeof setup>) => { s.clock.t += 4_001; s.t.tick(); s.t.tick(); };
  const offCommands = (s: ReturnType<typeof setup>) => s.phone.filter((m) => m.type === "command" && /^off:/.test(m.step));

  it("5번은 명령 전에 승인 질문, 승인 뒤 VLM이 쓰는 중(켜짐)이면 넘어간다. 6번 동안 명시 꺼짐을 보면 tick이 hot을 풀고 7번은 바로 끝나며, 계획이 끝나도 끄기 안내가 없다", async () => {
    let devs: Dev[] = [mwk(["off"])];
    const s = mwSetup({ w: () => ({ ...world([]), devices: devs }) });
    const onAt = await toOn(s);
    const on = cam("off", "on", onAt + 500);
    s.clock.t += 2_000;
    devs = [mwk(["on"], [on])];
    s.t.onWorld();
    expect(s.steps()[5]).toBe("active");
    expect(s.t.safety().hot).toEqual([MWK]);
    s.clock.t += 2_000;
    devs = [mwk(["off"], [on, cam("on", "off", onAt + 3_000)])];
    s.t.onWorld();
    s.t.tick();
    expect(s.t.safety()).toMatchObject({ hot: [], released: { [MWK]: { via: "switch", evidenceAt: onAt + 3_000 } } });
    toWait(s);
    expect(s.last()).toMatchObject({ step: `${P}:8`, text: "전자레인지 문을 열어 주세요" });
    s.t.onAnswer(P, `${P}:8`, "done");
    expect(s.last()).toMatchObject({ step: `${P}:9`, text: "그릇을 꺼내 주세요" });
    s.t.onAnswer(P, `${P}:9`, "done");
    expect(s.plans.current()).toMatchObject({ status: "done" });
    expect(offCommands(s)).toEqual([]);
  });

  /** 5번 승인 뒤 켜짐, 6번 동안 명시 꺼짐을 봐 hot이 풀린 데까지. 돌려준 값: 켜라고 한 시각. */
  async function releasedIn6(s: ReturnType<typeof setup>, set: (d: Dev[]) => void) {
    const onAt = await toOn(s);
    const on = cam("off", "on", onAt + 500);
    s.clock.t += 2_000;
    set([mwk(["on"], [on])]);
    s.t.onWorld();
    s.clock.t += 2_000;
    set([mwk(["off"], [on, cam("on", "off", onAt + 3_000)])]);
    s.t.onWorld();
    s.t.tick();
    expect(s.t.safety()).toMatchObject({ hot: [], released: { [MWK]: { via: "switch", evidenceAt: onAt + 3_000 } } });
    return onAt;
  }
  /** 전원이 아닌 이력 줄 n개(이력 한도 20줄을 넘겨 켜짐·꺼짐 줄을 밀어낸다). */
  const doorLines = (n: number, from: number): Line[] => Array.from({ length: n }, (_, i) => ({ attr: "door", from: i % 2 ? "open" : "closed", to: i % 2 ? "closed" : "open", at_ms: from + i * 10 }));

  it("6번 동안 꺼짐을 확인해 hot이 풀린 뒤 이력 줄이 21개 넘게 쌓여 켜짐·꺼짐 줄이 밀려나도 7번은 실행 추적이 든 풀린 근거로 끝난다", async () => {
    let devs: Dev[] = [mwk(["off"])];
    const s = mwSetup({ w: () => ({ ...world([]), devices: devs }) });
    const onAt = await releasedIn6(s, (d) => { devs = d; });
    devs = [mwk(["off"], doorLines(21, onAt + 4_000))];
    toWait(s);
    expect(s.last()).toMatchObject({ step: `${P}:8`, text: "전자레인지 문을 열어 주세요" });
    expect(s.t.safety().hot).toEqual([]);
  });

  it("6번에 풀리고 이력이 밀려난 뒤 전자레인지가 다시 켜짐이면 7번은 끝나지 않고 새 회차로 hot에 다시 건다. 그 회차가 꺼지면 끝난다", async () => {
    let devs: Dev[] = [mwk(["off"])];
    const s = mwSetup({ w: () => ({ ...world([]), devices: devs }) });
    const onAt = await releasedIn6(s, (d) => { devs = d; });
    const lines = doorLines(21, onAt + 4_000);
    devs = [mwk(["on"], lines)];
    toWait(s);
    expect(s.steps()[6]).toBe("active");
    expect(s.t.safety()).toMatchObject({ hot: [MWK], cycles: { [MWK]: { cycle: 2 } } });
    s.clock.t += 1_000; s.t.tick();
    expect(s.steps()[6]).toBe("active");
    s.clock.t += 1_000;
    devs = [mwk(["off"], [...lines, cam("on", "off", s.clock.t - 500)])];
    s.t.onWorld();
    expect(s.last()).toMatchObject({ step: `${P}:8` });
    expect(s.t.safety().hot).toEqual([]);
  });

  it("5번을 「완료」로 넘기고 전자레인지가 옛 꺼짐 그대로면 7번이 끝나지 않고 hot도 남는다. 20초 뒤 그 단계에 부탁(답 단추 없음)이 한 번 뜨고, 부탁 전에 찍힌·멀리서 본 꺼짐으로는 안 끝나며, 부탁 뒤 촬영된 가까이 본 명시 꺼짐이면 7번이 끝나고 hot이 풀린다", async () => {
    let devs: Dev[] = [mwk(["off"])];
    const s = mwSetup({ w: () => ({ ...world([]), devices: devs }) });
    await toOn(s);
    s.t.onAnswer(P, `${P}:5`, "done");
    toWait(s);
    expect(s.steps()[6]).toBe("active");
    s.clock.t += 19_000; s.t.tick();
    expect(s.phone.filter((m) => m.type === "command" && m.text === SHOW)).toEqual([]);
    s.clock.t += 1_001; s.t.tick();
    expect(s.last()).toMatchObject({ type: "command", id: P, step: `${P}:7`, text: SHOW, choices: [], speak: true, grade: "safety" });
    const askedAt = s.clock.t;
    for (const sight of [lastOff(askedAt - 1), lastOff(askedAt + 500, false), lastOff(askedAt + 500, true, false)]) {
      devs = [mwk(["off"], [], sight)];
      s.clock.t += 1_000; s.t.onWorld(); s.t.tick();
      expect(s.steps()[6]).toBe("active");
      expect(s.t.safety().hot).toEqual([MWK]);
    }
    expect(s.phone.filter((m) => m.type === "command" && m.text === SHOW)).toHaveLength(1);
    devs = [mwk(["off"], [], lastOff(askedAt + 500))];
    s.t.onWorld(); s.t.tick();
    expect(s.t.safety()).toMatchObject({ hot: [], released: { [MWK]: { via: "confirmed" } } });
    expect(s.last()).toMatchObject({ step: `${P}:8` });
  });

  it("5번을 「완료」로 넘겼고 켜짐 이력이 없으면 7번이 시간 초과 질문까지 가고, 「그만」이면 끄기 안내 줄로 넘어간다(상태가 이미 꺼짐이라 보이게 해 달라는 부탁)", async () => {
    const devs: Dev[] = [mwk(["off"])];
    const s = mwSetup({ w: () => ({ ...world([]), devices: devs }), waitS: 60 });
    await toOn(s);
    s.t.onAnswer(P, `${P}:5`, "done");
    toWait(s);
    s.clock.t += 60_001; s.t.tick();
    expect(s.last()).toMatchObject({ step: `${P}:7:again` });
    expect(s.t.safety().hot).toEqual([MWK]);
    expect(s.t.onAnswer(P, `${P}:7:again`, "stop")).toBe(true);
    expect(s.t.openCommand()).toMatchObject({ planId: P, stepId: `off:${P}:${MWK}:1`, text: SHOW, choices: [] });
  });

  it("7번 전에 그만두면 명령 줄에 끄기 안내 「전자레인지를 꺼 주세요」가 뜬다", async () => {
    let devs: Dev[] = [mwk(["off"])];
    const s = mwSetup({ w: () => ({ ...world([]), devices: devs }) });
    const onAt = await toOn(s);
    s.clock.t += 2_000;
    devs = [mwk(["on"], [cam("off", "on", onAt + 500)])];
    s.t.onWorld();
    s.heard("그만");
    expect(s.last()).toEqual({ type: "command", id: P, step: `off:${P}:${MWK}:1`, text: "전자레인지를 꺼 주세요", vision: null, choices: DONE, target: null, speak: true, grade: "safety" });
  });

  it("켜라고 하기 전에 있던 켜짐 → 꺼짐 이력으로도, 켜라고 하기 전에 찍은 꺼짐 사진의 답이 늦게 도착해도 7번이 끝나지 않고 hot·끄기 안내가 그대로다", async () => {
    let devs: Dev[] = [mwk(["off"], [cam("off", "on", 1_000), cam("on", "off", 3_000)])];
    const s = mwSetup({ w: () => ({ ...world([]), devices: devs }) });
    const onAt = await toOn(s);
    s.t.onAnswer(P, `${P}:5`, "done");
    toWait(s);
    s.clock.t += 2_000; s.t.onWorld(); s.t.tick();
    expect(s.steps()[6]).toBe("active");
    // 켜라고 하기 전(onAt - 1000)에 찍은 꺼짐 사진의 답이 지금 도착
    devs = [mwk(["off"], [cam("off", "on", onAt - 5_000), cam("on", "off", onAt - 1_000, true, s.clock.t)])];
    s.clock.t += 1_000; s.t.onWorld(); s.t.tick();
    expect(s.steps()[6]).toBe("active");
    expect(s.t.safety()).toMatchObject({ hot: [MWK], released: {} });
    s.heard("그만");
    expect(s.t.openCommand()).toMatchObject({ stepId: `off:${P}:${MWK}:1` });
  });

  it("추정 꺼짐(VLM이 전원을 말하지 않음)만 이어지면 트윈이 꺼짐이어도 7번이 끝나지 않고 hot도 남는다. 같은 꺼짐 값의 명시 꺼짐이 오면 7번이 끝나고 hot이 풀린다", async () => {
    let devs: Dev[] = [mwk(["off"])];
    const s = mwSetup({ w: () => ({ ...world([]), devices: devs }) });
    const onAt = await toOn(s);
    const on = cam("off", "on", onAt + 500);
    s.clock.t += 2_000;
    devs = [mwk(["on"], [on])];
    s.t.onWorld();
    toWait(s);
    devs = [mwk(["off"], [on, cam("on", "off", onAt + 6_000, false)], lastOff(onAt + 6_000, true, false))];
    s.clock.t += 2_000; s.t.onWorld(); s.t.tick();
    expect(s.steps()[6]).toBe("active");
    expect(s.t.safety().hot).toEqual([MWK]);
    devs = [mwk(["off"], [on, cam("on", "off", onAt + 6_000, false), cam("off", "off", onAt + 9_000)])];
    s.clock.t += 2_000; s.t.onWorld(); s.t.tick();
    expect(s.t.safety()).toMatchObject({ hot: [], released: { [MWK]: { via: "switch", evidenceAt: onAt + 9_000 } } });
    expect(s.last()).toMatchObject({ step: `${P}:8` });
  });

  it("6번에 풀린 뒤 다시 켜져 회차가 오르면 7번은 새 회차의 꺼짐으로만 끝난다", async () => {
    let devs: Dev[] = [mwk(["off"])];
    const s = mwSetup({ w: () => ({ ...world([]), devices: devs }) });
    const onAt = await toOn(s);
    const on = cam("off", "on", onAt + 500);
    const off = cam("on", "off", onAt + 1_500);
    s.clock.t += 2_000;
    devs = [mwk(["off"], [on, off])];
    s.t.onWorld(); s.t.tick();
    expect(s.t.safety()).toMatchObject({ hot: [], released: { [MWK]: {} } });
    // 6번 동안 다시 켜짐(같은 계획 hot에 다시 걸림, 회차 2)
    const again = cam("off", "on", onAt + 2_500);
    devs = [mwk(["on"], [on, off, again])];
    s.clock.t += 1_000; s.t.onWorld(); s.t.tick();
    expect(s.t.safety()).toMatchObject({ hot: [MWK], cycles: { [MWK]: { cycle: 2, onAt: onAt + 2_500 } } });
    toWait(s);
    expect(s.steps()[6]).toBe("active");
    devs = [mwk(["off"], [on, off, again, cam("on", "off", s.clock.t)])];
    s.clock.t += 1_000; s.t.onWorld(); s.t.tick();
    expect(s.last()).toMatchObject({ step: `${P}:8` });
    expect(s.t.safety().hot).toEqual([]);
  });
});

describe("실행 추적: 실제 폰 질문은 모두 말로 답할 수 있다(질문을 띄우고 onHeard로 답함)", () => {
  // 답 묶음마다 말로 맞는지는 tests/voice-answers.test.ts, 승인 대기 token이 명령 답보다 먼저인지는 tests/phone-server.test.ts·src/server/home/phone.ts가 본다
  it("처음 하는 일 승인 질문: 말 「승인」은 그 질문의 답이고, 다른 명령에 온 「승인」은 늦은 답이다", async () => {
    const s = setup({ approvals: store() });
    await s.decide(decision);
    expect(s.last()).toMatchObject({ text: APPROVAL_TEXT.ask("컵 치우기"), step: "plan:pam-1:approve" });
    expect(s.t.machineFacts()).toMatchObject({ asking: true, step: null });
    const at = heardAtOf(s.phone);
    expect(s.t.onHeard("승인", { kind: "command", id: "plan:pam-1", step: "plan:pam-1:1", pending: [] })).toEqual({ kind: "stale" });
    expect(s.t.onHeard("응 승인", at)).toEqual({ kind: "answer", choice: expect.objectContaining({ id: "approve" }) });
    expect(s.spoken().at(-1)).toBe("식탁으로 가 주세요");
  });

  it("물어보기 단계: 말 「그대로 둬요」가 그 질문의 답이고 계획을 끝낸다. 다른 명령에 온 답은 늦은 답이다", async () => {
    const s = setup();
    await s.decide(ask("pam-1", 1));
    const at = heardAtOf(s.phone);
    expect(s.t.onHeard("그대로 둬요", { kind: "command", id: "plan:pam-0", step: "plan:pam-0:1", pending: [] })).toEqual({ kind: "stale" });
    expect(s.t.onHeard("그대로 둬요", at)).toEqual({ kind: "answer", choice: expect.objectContaining({ id: "keep" }) });
    expect(s.plans.current()).toMatchObject({ status: "done" });
  });

  it("시간 초과 다시 묻기: 말 「계속」이 그 질문의 답이고 그 단계를 다시 시작한다", async () => {
    const before = llm.scripts["컵 치우기"];
    llm.scripts["컵 치우기"] = () => [planCalls(cupSteps({ table: "table_1", sink: "sink_1", cup: "cup_1" }).map((st, i) => (i === 0 ? { ...st, timeout_s: 10, on_timeout: "ask" } : st)))];
    try {
      const s = setup();
      await s.decide(decision);
      s.clock.t += 10_001; s.t.tick();
      expect(s.last()).toMatchObject({ step: "plan:pam-1:1:again" });
      expect(s.t.onHeard("계속", heardAtOf(s.phone))).toEqual({ kind: "answer", choice: expect.objectContaining({ id: "continue" }) });
      expect(s.last()).toMatchObject({ step: "plan:pam-1:1", text: "식탁으로 가 주세요" });
    } finally {
      llm.scripts["컵 치우기"] = before!;
    }
  });
});

describe("실행 추적: 말 답은 말할 때 떠 있던 명령에만(at)", () => {
  const P = "plan:pam-1";
  it("A 명령이 떠 있을 때 말하기 시작해 B 명령으로 바뀐 뒤 「완료」가 도착하면(at = A) B 단계가 넘어가지 않고 버린다. at이 지금 명령이면 받는다", async () => {
    const s = setup();
    await s.decide(decision);
    const a = heardAtOf(s.phone);
    expect(a).toEqual({ kind: "command", id: P, step: `${P}:1`, pending: [] });
    expect(s.t.onAnswer(P, `${P}:1`, "done")).toBe(true);
    expect(s.last()).toMatchObject({ step: `${P}:2` });
    expect(s.t.onHeard("완료", a)).toEqual({ kind: "stale" });
    expect(s.steps()[1]).toBe("active");
    expect(s.t.onHeard("완료", heardAtOf(s.phone))).toEqual({ kind: "answer", choice: expect.objectContaining({ id: "done" }) });
    expect(s.steps()[2]).toBe("active");
  });

  it("at 칸이 없는 「완료」(옛 탭)와 at이 none인데 명령이 떠 있을 때의 「다 했어」는 버린다. 「그만」은 at과 상관없이(칸이 없어도) 받는다", async () => {
    const s = setup();
    await s.decide(decision);
    expect(s.t.onHeard("완료")).toEqual({ kind: "stale" });
    expect(s.t.onHeard("다 했어", { kind: "none", pending: [] })).toEqual({ kind: "stale" });
    expect(s.steps()[0]).toBe("active");
    expect(s.t.onHeard("그만해")).toEqual({ kind: "answer", choice: expect.objectContaining({ id: "stop" }) });
    expect(s.plans.current()).toMatchObject({ status: "cancelled" });
  });

  it("지금 명령이 없고 at이 none이면 답 말도 null이다. 명령이 떠 있어도 답이 아닌 말은 null", async () => {
    const s = setup();
    expect(s.t.onHeard("완료", { kind: "none", pending: [] })).toBeNull();
    await s.decide(decision);
    expect(s.t.onHeard("불 꺼 줘", heardAtOf(s.phone))).toBeNull();
  });

  it("at이 다른 「승인」(지금은 B의 승인 질문이 떠 있음)은 B 승인도 되지 않는다", async () => {
    const s = setup({ approvals: store() });
    await s.decide(decision);
    expect(s.last()).toMatchObject({ step: `${P}:approve` });
    expect(s.t.onHeard("승인", { kind: "command", id: "plan:pam-0", step: "plan:pam-0:2", pending: [] })).toEqual({ kind: "stale" });
    expect(s.approvals.memory()).toEqual({ always: {} });
    expect(s.last()).toMatchObject({ step: `${P}:approve` });
    expect(s.t.onHeard("승인", heardAtOf(s.phone))).toEqual({ kind: "answer", choice: expect.objectContaining({ id: "approve" }) });
    expect(s.last()).toMatchObject({ step: `${P}:1` });
  });
});

describe("실행 추적: 판본이 맞는 폰이 없을 때(phoneReady)", () => {
  const P = "plan:pam-1";
  it("판본이 맞는 폰이 없으면 사람 단계 계획(컵 치우기)은 시작하지 않고 실행 기록에 한 번 남긴다. 맞는 폰이 붙으면 시작한다", async () => {
    let ready = false;
    const s = setup({ phoneReady: () => ready });
    await s.decide(decision);
    for (let i = 0; i < 5; i++) { s.clock.t += 1_000; s.t.tick(); }
    expect(s.phone.filter((m) => m.type === "command")).toEqual([]);
    expect(s.t.current()).toEqual({ planId: P, state: "planned" });
    expect(s.exec().filter((l) => l.text === EXEC_TEXT.phoneOld)).toEqual([expect.objectContaining({ plan_id: P, state: "planned", text: "폰 화면 새로 고침 전이라 새 일을 미룸" })]);
    expect(s.t.machineFacts().blocked).toBe(true);
    ready = true;
    s.t.tick();
    expect(s.last()).toMatchObject({ type: "command", step: `${P}:1`, text: "식탁으로 가 주세요" });
    expect(s.t.machineFacts().blocked).toBe(false);
  });
});

describe("실행 추적: 코치 계획의 다른 행동 알림(strayed)과 다시 알리기(tell)", () => {
  const P = "plan:pam-1";
  const room = (at: number, label = "거실"): WorldChange => ({ kind: "person_room", at_ms: at, subject: "person", text: `사람 ${label}에 있음`, meaningful: true });
  function straySetup(over: Parameters<typeof setup>[0] = {}) {
    const strays: Stray[] = [];
    let accept = true;
    const s = coachSetup({ strayed: (x) => { strays.push(x); return accept; }, ...over });
    return { ...s, strays, accept: (v: boolean) => { accept = v; } };
  }
  /** 물 받기(4번, 끝 조건 없음)까지 「완료」로 넘긴다. */
  async function toFill(s: ReturnType<typeof setup>) {
    await s.decide(ramenDecision());
    for (let n = 1; n <= 3; n++) s.t.onAnswer(P, `${P}:${n}`, "done");
    expect(s.last()).toMatchObject({ step: `${P}:4`, text: "냄비에 물을 받아 주세요" });
  }

  it("물 받기 단계에 사람 방이 거실로 바뀌면 strayed를 한 번 부르고 6초 안에는 다시 부르지 않으며 단계마다 2번까지다. 알림에는 계획 단계·지금 단계·방금 본 변화가 있다", async () => {
    expect(TRACK_DEFAULTS).toMatchObject({ strayGapMs: 6000, strayMax: 2, tellHoldMs: 8000 });
    const s = straySetup();
    await toFill(s);
    s.clock.t += 1_000;
    s.t.onWorld([room(s.clock.t)]);
    expect(s.strays).toHaveLength(1);
    expect(s.strays[0]).toMatchObject({ planId: P, stepId: `${P}:4`, label: "물 받기", command: "냄비에 물을 받아 주세요", at: 4, changes: ["사람 거실에 있음"] });
    expect(s.strays[0]!.steps.slice(0, 5)).toEqual([
      { label: "수납장으로 가기", status: "done" }, { label: "냄비 꺼내기", status: "done" }, { label: "싱크대로 가기", status: "done" }, { label: "물 받기", status: "active" }, { label: "인덕션으로 가기", status: "pending" },
    ]);
    expect(s.strays[0]!.signal.aborted).toBe(false);
    s.clock.t += 5_999;
    s.t.onWorld([room(s.clock.t, "주방")]);
    expect(s.strays).toHaveLength(1);
    s.clock.t += 1;
    s.t.onWorld([room(s.clock.t)]);
    expect(s.strays).toHaveLength(2);
    expect(s.strays[1]!.changes).toEqual(["사람 거실에 있음", "사람 주방에 있음", "사람 거실에 있음"]);
    s.clock.t += 10_000;
    s.t.onWorld([room(s.clock.t)]);
    expect(s.strays).toHaveLength(2);
    // 다음 단계로 가면 앞 알림의 신호가 끊기고 다시 센다
    s.t.onAnswer(P, `${P}:4`, "done");
    expect(s.strays[0]!.signal.aborted).toBe(true);
    s.t.onAnswer(P, `${P}:5`, "done");
    s.clock.t += 1_000;
    s.t.onWorld([room(s.clock.t)]);
    expect(s.strays).toHaveLength(3);
    expect(s.strays[2]).toMatchObject({ stepId: `${P}:6`, label: "냄비 올리기", at: 6 });
  });

  it("가전 상태·가전 설비 상태 변화도 계기다. 의미 없는 변화·들은 말·물건 변화에는 부르지 않는다. 받지 않은 알림(false)은 세지 않는다", async () => {
    const s = straySetup();
    await toFill(s);
    s.clock.t += 1_000;
    s.t.onWorld([{ kind: "vlm", at_ms: s.clock.t, subject: "e1", text: "VLM: 주방", meaningful: false }, { kind: "heard", at_ms: s.clock.t, subject: "person", text: "사람이 말함: 「음」", meaningful: true },
      { kind: "appeared", at_ms: s.clock.t, subject: "cup_1", text: "컵 cup_1 보임", meaningful: true }]);
    expect(s.strays).toEqual([]);
    s.accept(false);
    s.t.onWorld([{ kind: "device", at_ms: s.clock.t, subject: "induction_1", text: "인덕션 켜짐", meaningful: true }]);
    expect(s.strays).toHaveLength(1);
    expect(s.strays[0]!.changes).toEqual(["컵 cup_1 보임", "인덕션 켜짐"]);
    s.accept(true);
    s.clock.t += 100;
    s.t.onWorld([{ kind: "fixture", at_ms: s.clock.t, subject: "tv_living", text: "거실 TV 화면 켜짐", meaningful: true }]);
    expect(s.strays).toHaveLength(2);
  });

  it("지금 단계의 끝 조건을 참으로 만든 변화에는 부르지 않는다(다음 단계로 넘어간다). 켜기 전 질문 중에도 부르지 않는다", async () => {
    let w = world([]);
    const s = straySetup({ w: () => w });
    await s.decide(ramenDecision());
    s.t.onAnswer(P, `${P}:1`, "done");
    expect(s.last()).toMatchObject({ step: `${P}:2`, text: "냄비를 꺼내 주세요" });
    s.clock.t += 1_000;
    w = world([], "holding_object", s.clock.t);
    s.t.onWorld([{ kind: "person_state", at_ms: s.clock.t, subject: "person", text: "사람 물건을 들고 있음", meaningful: true }, room(s.clock.t, "주방")]);
    expect(s.last()).toMatchObject({ step: `${P}:3` });
    expect(s.strays).toEqual([]);
    for (let n = 3; n <= 6; n++) s.t.onAnswer(P, `${P}:${n}`, "done");
    expect(s.last()).toMatchObject({ step: `${P}:7:hand` });
    s.clock.t += 10_000;
    s.t.onWorld([room(s.clock.t)]);
    expect(s.strays).toEqual([]);
  });

  it("폰이 지금 단계 자리를 떠나 다른 자리 가까이로 가면 부른다(그 자리마다 한 번). 이동 단계에는 부르지 않는다", async () => {
    const s = straySetup();
    await s.decide(ramenDecision());
    // 1 수납장으로 가기(이동 단계): 식탁 옆을 지나가도 부르지 않는다
    s.t.onEye([7, 2.6]);
    s.t.tick();
    expect(s.strays).toEqual([]);
    for (let n = 1; n <= 3; n++) s.t.onAnswer(P, `${P}:${n}`, "done");
    // 4 물 받기(싱크대 [5, 1]): 싱크대 앞이면 부르지 않는다
    s.clock.t += 1_000;
    s.t.onEye([5.2, 1.6]);
    s.t.tick();
    expect(s.strays).toEqual([]);
    // 식탁([7, 3]) 가까이로 감
    s.clock.t += 1_000;
    s.t.onEye([6.8, 2.6]);
    s.t.tick();
    expect(s.strays).toHaveLength(1);
    expect(s.strays[0]!.changes).toEqual(["폰이 식탁 가까이로 감"]);
    s.clock.t += 7_000;
    s.t.tick();
    expect(s.strays).toHaveLength(1);
  });

  it("컵 치우기(코치 아님)에는 부르지 않는다", async () => {
    const strays: Stray[] = [];
    const s = setup({ strayed: (x) => { strays.push(x); return true; } });
    await s.decide(decision);
    s.t.onAnswer(P, `${P}:1`, "done");
    s.clock.t += 1_000;
    s.t.onWorld([room(s.clock.t)]);
    s.t.onEye([5, 1]);
    s.t.tick();
    expect(strays).toEqual([]);
  });

  it("tell은 같은 계획·단계 id로 글만 바꿔 읽고 8초 뒤 원래 명령을 speak false로 다시 보낸다. 단계가 넘어가면 되돌리지 않는다", async () => {
    const TELL = "먼저 냄비에 물을 받아 주세요";
    const s = straySetup();
    await toFill(s);
    const before = s.last();
    expect(s.t.tell(P, `${P}:3`, "earlier")).toBeNull();
    expect(s.t.tell("plan:pam-9", `${P}:4`, "earlier")).toBeNull();
    // 모델 글은 받지 않는다(방식만)
    expect(s.t.tell(P, `${P}:4`, "지금 그거 하면 안 돼요" as TellMode)).toBeNull();
    expect(s.t.toldAt()).toBeNull();
    expect(s.t.tell(P, `${P}:4`, "earlier")).toBe(TELL);
    expect(s.last()).toEqual({ ...before, text: TELL, speak: true });
    expect(s.t.toldAt()).not.toBeNull();
    s.clock.t += 7_999;
    s.t.tick();
    expect(s.last()).toMatchObject({ text: TELL });
    s.clock.t += 1;
    s.t.tick();
    expect(s.last()).toEqual({ ...before, speak: false });
    expect(s.spoken()).toEqual(["수납장으로 가 주세요", "냄비를 꺼내 주세요", "싱크대로 가 주세요", "냄비에 물을 받아 주세요", TELL]);
    // 단계가 넘어가면 되돌리지 않는다
    expect(s.t.tell(P, `${P}:4`, "earlier")).toBe(TELL);
    s.t.onAnswer(P, `${P}:4`, "done");
    const sent = s.phone.length;
    s.clock.t += 9_000;
    s.t.tick();
    expect(s.phone.slice(sent).filter((m) => m.type === "command" && m.text === "냄비에 물을 받아 주세요")).toEqual([]);
    expect(s.last()).toMatchObject({ step: `${P}:5`, text: "인덕션으로 가 주세요" });
    // 켜기 전 질문 중에는 알리지 않는다
    s.t.onAnswer(P, `${P}:5`, "done");
    s.t.onAnswer(P, `${P}:6`, "done");
    expect(s.t.tell(P, `${P}:7`, "repeat")).toBeNull();
    expect(s.t.tell(P, `${P}:7:hand`, "repeat")).toBeNull();
  });

  it("코치 계획의 지금 사람 단계를 알려 준다(들은 말 돕기). 질문 중·코치가 아닌 계획·끝난 계획이면 null", async () => {
    const s = straySetup();
    expect(s.t.coachStep()).toBeNull();
    await toFill(s);
    expect(s.t.coachStep()).toMatchObject({ planId: P, stepId: `${P}:4`, label: "물 받기", command: "냄비에 물을 받아 주세요", at: 4 });
    for (let n = 4; n <= 6; n++) s.t.onAnswer(P, `${P}:${n}`, "done");
    expect(s.t.coachStep()).toBeNull();
    s.heard("그만");
    expect(s.t.coachStep()).toBeNull();
    const cupRun = setup();
    await cupRun.decide(decision);
    expect(cupRun.t.coachStep()).toBeNull();
  });
});

describe("실행 추적: 잘한 단계는 말을 줄인다(수업 기록)", () => {
  const P = "plan:pam-1";
  /** 계획을 끝까지 넘긴다. 켜기 전 질문은 승인. hook(n)은 n번 사람 단계가 떠 있을 때 부른다. */
  async function finishRun(s: ReturnType<typeof setup>, hook: (n: number) => void = () => {}) {
    await s.decide(ramenDecision());
    for (const n of [1, 2, 3, 4, 5, 6]) { hook(n); expect(s.t.onAnswer(P, `${P}:${n}`, "done"), String(n)).toBe(true); }
    expect(s.t.onAnswer(P, `${P}:7:hand`, "approve")).toBe(true);
    hook(7); s.t.onAnswer(P, `${P}:7`, "done");
    s.clock.t += 4_001; s.t.tick();
    s.clock.t += 240_001; s.t.tick();
    hook(10); s.t.onAnswer(P, `${P}:10`, "done");
    s.clock.t += 240_001; s.t.tick();
    hook(12); s.t.onAnswer(P, `${P}:12`, "done");
    s.clock.t += 4_001; s.t.tick();
    expect(s.plans.current()).toMatchObject({ status: "done" });
  }
  const HUMAN = ["수납장으로 가기", "냄비 꺼내기", "싱크대로 가기", "물 받기", "인덕션으로 가기", "냄비 올리기", "인덕션 켜기", "면과 스프 넣기", "인덕션 끄기"];

  it("끝낸 계획의 사람 단계마다 혼자 해냈는지 기록한다. 다시 알리기(tell)·다시 읽기를 받은 단계는 혼자 해낸 것이 아니다. 알림·기다리기 단계는 기록하지 않는다", async () => {
    const lessons = memoryLessons();
    const s = coachSetup({ lessons });
    await finishRun(s, (n) => {
      if (n === 4) expect(s.t.tell(P, `${P}:4`, "earlier")).toBe("먼저 냄비에 물을 받아 주세요");
      if (n === 6) { s.clock.t += 30_000; s.t.tick(); }
    });
    const got = lessons.get(RAMEN)!;
    expect(got.runs).toBe(1);
    expect(got.steps.map((x) => x.label)).toEqual(HUMAN);
    expect(got.steps.filter((x) => x.alone === 0).map((x) => x.label)).toEqual(["물 받기", "냄비 올리기"]);
    expect(got.updatedAt).toBe(new Date(s.clock.t).toISOString());
  });

  it("취소한 판과 코치가 아닌 계획은 기록하지 않는다", async () => {
    const lessons = memoryLessons();
    const s = coachSetup({ lessons });
    await toOn(s);
    s.heard("그만");
    expect(lessons.get(RAMEN)).toBeNull();
    const cupRun = setup({ lessons });
    await cupRun.decide(decision);
    for (const n of [1, 2, 3, 4]) cupRun.t.onAnswer(P, `${P}:${n}`, "done");
    expect(cupRun.plans.current()).toMatchObject({ status: "done" });
    expect(lessons.get("컵 치우기")).toBeNull();
  });

  it("이어서 두 판 혼자 해낸 단계는 셋째 판에 조용하다: 명령은 speak false로 뜨고(글은 그대로), 20초 안에 안 끝나면 한 번 읽으며 그 단계는 혼자 해낸 것으로 세지 않는다", async () => {
    const lessons = memoryLessons();
    for (let k = 0; k < 2; k++) await finishRun(coachSetup({ lessons }));
    expect([...quietLabels(lessons.get(RAMEN))].sort()).toEqual([...HUMAN].sort());
    const s = coachSetup({ lessons });
    await s.decide(ramenDecision());
    expect(s.last()).toMatchObject({ step: `${P}:1`, text: "수납장으로 가 주세요", speak: false, choices: DONE, kind: "go" });
    expect(s.t.quietStep()).toBe("수납장으로 가기");
    s.clock.t += 19_999;
    s.t.tick();
    expect(s.spoken()).toEqual([]);
    s.clock.t += 1;
    s.t.tick();
    expect(s.spoken()).toEqual(["수납장으로 가 주세요"]);
    expect(s.t.quietStep()).toBeNull();
    s.clock.t += 5_000;
    s.t.tick();
    expect(s.spoken()).toEqual(["수납장으로 가 주세요"]);
    s.t.onAnswer(P, `${P}:1`, "done");
    expect(s.last()).toMatchObject({ step: `${P}:2`, text: "냄비를 꺼내 주세요", speak: false });
    for (const n of [2, 3, 4, 5, 6]) s.t.onAnswer(P, `${P}:${n}`, "done");
    // 인덕션 켜기는 조용한 단계여도 묻고(소리로), 승인 뒤 켜라는 명령도 읽는다
    expect(s.last()).toMatchObject({ step: `${P}:7:hand`, text: ASK_ON, speak: true });
    s.t.onAnswer(P, `${P}:7:hand`, "approve");
    expect(s.last()).toMatchObject({ step: `${P}:7`, text: "인덕션을 켜 주세요", speak: true });
    expect(s.t.quietStep()).toBeNull();
    s.t.onAnswer(P, `${P}:7`, "done");
    s.clock.t += 4_001; s.t.tick();
    s.clock.t += 240_001; s.t.tick();
    s.t.onAnswer(P, `${P}:10`, "done");
    s.clock.t += 240_001; s.t.tick();
    s.t.onAnswer(P, `${P}:12`, "done");
    s.clock.t += 4_001; s.t.tick();
    // 힌트를 받은 1번은 0으로, 나머지는 3으로
    const steps = lessons.get(RAMEN)!.steps;
    expect(steps[0]).toEqual({ label: "수납장으로 가기", alone: 0 });
    expect(steps.slice(1).every((x) => x.alone === 3)).toBe(true);
    // 알림(say) 단계는 조용한 단계가 아니다: 늘 읽는다. 12번을 「완료」로 넘겨 확인된 꺼짐이 없으니 끝난 뒤 끄기 안내를 읽는다
    expect(s.spoken()).toEqual(["수납장으로 가 주세요", ASK_ON, "인덕션을 켜 주세요", "물이 끓을 때까지 기다려요.", "라면이 다 됐어요.", "인덕션을 꺼 주세요"]);
  });

  it("수업 기록이 없으면(lessons 없음) 지금처럼 모든 명령을 읽는다", async () => {
    const s = coachSetup();
    await s.decide(ramenDecision());
    expect(s.last()).toMatchObject({ speak: true });
    expect(s.t.quietStep()).toBeNull();
  });
});

describe("실행 추적: 한 번에 한 계획, 실행 전 검사", () => {
  it("검사가 통과할 때까지 tick마다 다시 보고, 그 사이 통과하면 첫 명령을 보낸다", async () => {
    let ok = false;
    const { t, decide, clock, spoken } = setup({ check: () => (ok ? { ok: true } : { ok: false, reason: "stale", text: "x" }), recheckMs: 3000 });
    await decide(decision);
    expect(t.current()).toMatchObject({ state: "planned" });
    clock.t += 1000;
    t.tick();
    expect(t.current()).toMatchObject({ state: "planned" });
    ok = true;
    t.tick();
    expect(t.current()).toMatchObject({ state: "running" });
    expect(spoken()).toEqual(["식탁으로 가 주세요"]);
  });

  // Codex(69d3493): 들고 감 보호는 최대 약 6초인데 다시 검사는 3초뿐이라, 계획이 빨리 오면 「손에 있음」으로 실패하고 다시 계획 제한까지 걸렸다
  it("대상 물건의 손에 있음이 들고 감 보호(carried)면 보호가 풀릴 때까지 다시 보기 기한을 세지 않고, 풀린 뒤 통과하면 첫 명령을 보낸다", async () => {
    let w = world([{ ...cup("present", "in_hand", 10_000), carried: true }]);
    const inHand = (): CheckResult => (w.objects[0]!.facts.place?.value === "in_hand" ? { ok: false, reason: "in_hand", text: "x", ...(w.objects[0]!.carried ? { carried: true as const } : {}) } : { ok: true });
    const { t, decide, clock, spoken } = setup({ w: () => w, check: inHand, recheckMs: 3000 });
    await decide(decision);
    for (let i = 0; i < 24; i++) {
      clock.t += 250;
      t.tick();
    }
    expect(t.current()).toMatchObject({ state: "planned" });
    w = world([cup("present", undefined, clock.t)]);
    t.tick();
    expect(t.current()).toMatchObject({ state: "running" });
    expect(spoken()).toEqual(["식탁으로 가 주세요"]);
  });

  it("들고 감 보호가 풀린 뒤에도 손에 있음이면 그때부터 recheckMs를 세어 실패로 끝낸다", async () => {
    let w = world([{ ...cup("present", "in_hand", 10_000), carried: true }]);
    const check = (): CheckResult => ({ ok: false, reason: "in_hand", text: "x", ...(w.objects[0]!.carried ? { carried: true as const } : {}) });
    const { t, decide, clock, logs } = setup({ w: () => w, check, recheckMs: 3000 });
    await decide(decision);
    for (let i = 0; i < 24; i++) {
      clock.t += 250;
      t.tick();
    }
    w = world([cup("present", "in_hand", clock.t)]);
    for (let i = 0; i < 11; i++) {
      clock.t += 250;
      t.tick();
    }
    expect(t.current()).toMatchObject({ state: "planned" });
    clock.t += 500;
    t.tick();
    expect(logs.at(-1)).toMatchObject({ type: "execution", state: "failed", text: "x" });
  });

  // Codex(a2cf199): 검사를 막은 물건이 아닌 계획 물건의 들고 감 보호로도 다시 보기 기한이 멈췄다
  it("검사가 들고 감 보호로 막았다고 하지 않으면(carried 없음) 계획 물건이 보호 중이어도 recheckMs가 지나면 실패로 끝낸다", async () => {
    const w = world([{ ...cup("present", "in_hand", 10_000), carried: true }]);
    const { t, decide, clock, logs } = setup({ w: () => w, check: () => ({ ok: false, reason: "in_hand", text: "x" }), recheckMs: 3000 });
    await decide(decision);
    clock.t += 3000;
    t.tick();
    expect(logs.at(-1)).toMatchObject({ type: "execution", state: "failed", text: "x" });
  });

  it("recheckMs가 지나도 검사를 통과하지 못하면 실패로 끝내고 이유를 남긴다. 폰에는 아무것도 보내지 않는다. 대기는 기록만", async () => {
    const { t, decide, logs, plans, phone } = setup({ check: () => ({ ok: false, reason: "in_hand", text: "사람이 그 물건을 쓰는 중이라 실행하지 않아요" }), recheckMs: 0 });
    await decide(decision);
    t.tick();
    expect(logs.at(-1)).toMatchObject({ type: "execution", state: "failed", text: "사람이 그 물건을 쓰는 중이라 실행하지 않아요" });
    expect(plans.current()?.status).toBe("failed");
    expect(phone).toEqual([]);
    await decide({ ...decision, id: "pam-2", seq: 2, action: null, prediction: { ...pred, task_index: -1 } });
    expect(logs.at(-1)).toMatchObject({ type: "execution", plan_id: "plan:pam-2", state: "decided", text: EXEC_TEXT.wait });
    await decide({ ...decision, id: "pam-3", seq: 3, status: "failed", action: null, prediction: null, error: "e" });
    expect(logs.at(-1)).toMatchObject({ type: "execution", plan_id: "plan:pam-3", state: "decided", text: EXEC_TEXT.decisionFailed });
  });

  it("periodic처럼 같은 판단이 연달아 와도 명령은 한 번이고 그 계획이 끝까지 간다", async () => {
    const { t, decide, logs, spoken } = setup();
    for (let s = 1; s <= 4; s++) await decide({ ...decision, id: `pam-${s}`, seq: s });
    expect(spoken()).toEqual(["식탁으로 가 주세요"]);
    expect(t.current()!.planId).toBe("plan:pam-1");
    expect(logs.filter((l) => l.type === "execution" && l.text === EXEC_TEXT.same).map((l) => l.type === "execution" && l.plan_id)).toEqual(["plan:pam-2", "plan:pam-3", "plan:pam-4"]);
    for (let s = 1; s <= 4; s++) t.onAnswer("plan:pam-1", `plan:pam-1:${s}`, "done");
    expect(t.current()).toMatchObject({ planId: "plan:pam-1", state: "done" });
  });

  it("지금 계획보다 먼저 보낸 판단의 답이 늦게 오면 버린다", async () => {
    const { t, decide, logs, spoken } = setup();
    await decide(ask("pam-5", 5));
    await decide({ ...decision, id: "pam-4", seq: 4 });
    expect(t.current()).toMatchObject({ planId: "plan:pam-5", state: "running" });
    expect(logs.at(-1)).toMatchObject({ type: "execution", plan_id: "plan:pam-4", text: EXEC_TEXT.late });
    expect(spoken()).toEqual(["컵을 치울까요?"]);
  });

  it("지금 명령을 알려 주고, 멈추면 더 기록하지 않고 폰에도 보내지 않는다", async () => {
    const { t, heard, decide, logs, phone, clock } = setup();
    expect(t.openCommand()).toBeNull();
    await decide(decision);
    expect(t.openCommand()).toEqual({ planId: "plan:pam-1", stepId: "plan:pam-1:1", kind: "command", text: "식탁으로 가 주세요", choices: [expect.objectContaining({ id: "done", label: "완료" })] });
    t.stop();
    const n = logs.length;
    const m = phone.length;
    await decide({ ...decision, id: "pam-2", seq: 2, action: "사용자에게 물어보기" });
    clock.t += 60_000;
    t.tick();
    expect(heard("완료")).toBeNull();
    expect(logs).toHaveLength(n);
    expect(phone).toHaveLength(m);
  });
});

describe("실행 추적: 멈춘 집기·놓기 단계(관찰 모드 A)와 사람 부탁 다시 보내기", () => {
  const PICK_UNTIL = { any: [{ object: "cup_1", follow: true, facts: { place: "in_hand" } }, { person_holding: "cup" }] };
  const PLACE_UNTIL = {
    all: [
      {
        any: [
          { object: "cup_1", follow: true, facts: { place: "in_sink" } },
          { all: [{ object: "cup_1", follow: true, surface: "sink_1", part: "basin" }, { not: { object: "cup_1", follow: true, facts: { place: "in_hand" } } }] },
        ],
      },
      { not: { person_holding: "cup_1" } },
    ],
  };

  /** stalled는 받은 알림을 모은다. accept(false)면 받지 않았다고 돌려준다. */
  function stallSetup(over: Parameters<typeof setup>[0] = {}) {
    const stalls: Stall[] = [];
    let accept = true;
    const s = setup({ ...over, stalled: (x) => { stalls.push(x); return accept; } });
    return { ...s, stalls, accept: (v: boolean) => { accept = v; } };
  }
  /** 컵 계획 2단계(집기)를 바꾼 계획. */
  function variant(change: (st: AgentStep) => AgentStep, over: Parameters<typeof setup>[0] = {}) {
    const planner = testPlanner(llm);
    return stallSetup({
      ...over,
      planner: async (d, signal) => {
        const r = await planner.plan(planContext({ decision: d, world: world([cup("present")]), floor: smallFloor() }), signal);
        if (r.ok) r.plan.steps[1] = change(r.plan.steps[1]!);
        return r;
      },
    });
  }
  /** 식탁 가기를 「완료」로 넘겨 집기 단계(시작 10초)로. */
  async function toPick(s: ReturnType<typeof stallSetup>) {
    await s.decide(decision);
    s.t.onAnswer("plan:pam-1", "plan:pam-1:1", "done");
    expect(s.steps()).toEqual(["done", "active", "pending", "pending"]);
  }

  it("집기 단계가 8초 넘게 안 끝나면 관찰 모드를 부른다. 단계 시작 뒤·받은 부름 뒤 8초마다, 단계마다 3번까지", async () => {
    expect(TRACK_DEFAULTS).toMatchObject({ stallMs: 8000, stallMax: 3 });
    const s = stallSetup();
    await toPick(s);
    s.clock.t += 7_999;
    s.t.tick();
    expect(s.stalls).toEqual([]);
    s.clock.t += 1;
    s.t.tick();
    expect(s.stalls).toHaveLength(1);
    expect(s.stalls[0]).toMatchObject({
      planId: "plan:pam-1", stepId: "plan:pam-1:2", kind: "pick", label: STEP_LABEL.pickCup, command: STEP_COMMAND.pickCup, until: PICK_UNTIL,
      stuckMs: 8000, looks: 0, spots: [{ id: "cup_1", label: "컵", position: [2, 0.75, 1] }],
    });
    expect(s.stalls[0]!.gen).toEqual(expect.any(Number));
    expect(s.stalls[0]!.signal.aborted).toBe(false);
    s.clock.t += 250;
    s.t.tick();
    expect(s.stalls).toHaveLength(1);
    for (const since of [16_000, 24_000, 32_000, 40_000]) {
      s.clock.t = 10_000 + since;
      s.t.tick();
    }
    expect(s.stalls.map((x) => [x.stepId, x.stuckMs, x.looks])).toEqual([["plan:pam-1:2", 8000, 0], ["plan:pam-1:2", 16_000, 1], ["plan:pam-1:2", 24_000, 2]]);
    expect(s.t.current()).toMatchObject({ state: "running" });
    expect(s.stalls.some((x) => x.signal.aborted)).toBe(false);
  });

  it("이동·물어보기·알림·기다리기·기기 단계와 끝난 조건 없는 사람 단계는 부르지 않는다", async () => {
    const quiet = async (s: ReturnType<typeof stallSetup>, name: string) => {
      for (let i = 0; i < 5; i++) {
        s.clock.t += 4000;
        s.t.tick();
      }
      expect(s.t.current(), name).toMatchObject({ state: "running" });
      expect(s.stalls, name).toEqual([]);
    };
    const go = stallSetup();
    await go.decide(decision);
    await quiet(go, "이동");
    const q = stallSetup();
    await q.decide(ask("pam-1", 1));
    await quiet(q, "물어보기");
    const never = () => new Promise<never>(() => {});
    const kinds: [string, (st: AgentStep) => AgentStep, Parameters<typeof setup>[0]?][] = [
      ["조건 없는 집기", (st) => ({ ...st, until: null })],
      ["알림", (st) => ({ ...st, kind: "say", command: null, text: "컵을 치우는 중이에요" })],
      ["기다리기", (st) => ({ ...st, kind: "wait", command: null })],
      ["기기", (st) => ({ ...st, kind: "device", command: null, device: { tool: "turn_on", deviceId: "ac_living", args: {} } }), { devices: { run: never, confirm: never, cancel: () => {} } }],
    ];
    for (const [name, change, over] of kinds) {
      const s = variant(change, over);
      await toPick(s);
      await quiet(s, name);
    }
  });

  it("관찰 모드가 받지 않으면(false) 세지 않고 다음 tick에 다시 부른다. 받은 부름부터 8초를 잰다", async () => {
    const s = stallSetup();
    s.accept(false);
    await toPick(s);
    s.clock.t += 8000;
    s.t.tick();
    s.clock.t += 250;
    s.t.tick();
    s.accept(true);
    s.clock.t += 250;
    s.t.tick();
    s.clock.t += 250;
    s.t.tick();
    expect(s.stalls.map((x) => [x.stuckMs, x.looks])).toEqual([[8000, 0], [8250, 0], [8500, 0]]);
    s.clock.t = 10_000 + 16_499;
    s.t.tick();
    expect(s.stalls).toHaveLength(3);
    s.clock.t += 1;
    s.t.tick();
    expect(s.stalls.at(-1)).toMatchObject({ stuckMs: 16_500, looks: 1 });
  });

  it("받은 부름은 끝날 때 settle로 셈을 정한다: settle(false)(새 사진 모자람·VLM 자리 없음)는 돌려받아 3번 상한에 넣지 않고, 두 번째 settle과 옛 단계의 settle은 아무것도 하지 않는다", async () => {
    const s = stallSetup();
    await toPick(s);
    for (let i = 0; i < 4; i++) {
      s.clock.t += 8000;
      s.t.tick();
      s.stalls.at(-1)!.settle(false);
      s.stalls.at(-1)!.settle(false);
    }
    expect(s.stalls.map((x) => [x.stuckMs, x.looks])).toEqual([[8000, 0], [16_000, 0], [24_000, 0], [32_000, 0]]);
    // 돌려받아도 다음 부름은 받은 부름에서 8초 뒤다
    s.clock.t += 7_999;
    s.t.tick();
    expect(s.stalls).toHaveLength(4);
    s.clock.t += 1;
    s.t.tick();
    s.stalls.at(-1)!.settle(true);
    s.stalls.at(-1)!.settle(false);
    s.clock.t += 8000;
    s.t.tick();
    expect(s.stalls.at(-1)).toMatchObject({ stepId: "plan:pam-1:2", looks: 1 });
    const old = s.stalls.at(-1)!;   // 정하지 않은 부름은 센다
    s.t.onAnswer("plan:pam-1", "plan:pam-1:2", "done");
    s.t.onAnswer("plan:pam-1", "plan:pam-1:3", "done");
    s.clock.t += 8000;
    s.t.tick();
    expect(s.stalls.at(-1)).toMatchObject({ stepId: "plan:pam-1:4", looks: 0 });
    old.settle(false);
    s.clock.t += 8000;
    s.t.tick();
    expect(s.stalls.at(-1)).toMatchObject({ stepId: "plan:pam-1:4", looks: 1 });
  });

  it("다음 단계로 가면 셈과 기준 시각을 다시 잡는다. 놓기 단계는 컵과 싱크대를 보고, 끝난 단계 알림의 신호는 끊긴다", async () => {
    const s = stallSetup();
    await toPick(s);
    for (let i = 0; i < 3; i++) {
      s.clock.t += 8000;
      s.t.tick();
    }
    expect(s.stalls).toHaveLength(3);
    s.clock.t += 1000;
    s.t.onAnswer("plan:pam-1", "plan:pam-1:2", "done");
    expect(s.stalls.every((x) => x.signal.aborted)).toBe(true);
    s.t.onAnswer("plan:pam-1", "plan:pam-1:3", "done");
    expect(s.last()).toMatchObject({ step: "plan:pam-1:4" });
    s.clock.t += 7_999;
    s.t.tick();
    expect(s.stalls).toHaveLength(3);
    s.clock.t += 1;
    s.t.tick();
    expect(s.stalls).toHaveLength(4);
    const place = s.stalls[3]!;
    expect(place).toMatchObject({
      planId: "plan:pam-1", stepId: "plan:pam-1:4", kind: "place", label: STEP_LABEL.placeCup, command: STEP_COMMAND.placeCup,
      until: PLACE_UNTIL, stuckMs: 8000, looks: 0,
      spots: [{ id: "cup_1", label: "컵", position: [2, 0.75, 1] }, SINK],
    });
    expect(place.gen).toBeGreaterThan(s.stalls[0]!.gen);
    expect(place.signal.aborted).toBe(false);
  });

  it("단계가 끝나면(시간 초과 실패·「그만」·새 계획·멈춤·계획 완료) 그 알림의 신호를 끊는다", async () => {
    const ends: [string, (s: ReturnType<typeof stallSetup>) => void | Promise<void>][] = [
      ["시간 초과", (s) => { s.clock.t += 120_001; s.t.tick(); }],
      ["그만", (s) => { s.heard("그만"); }],
      // 손대는 단계(집기)라 다른 행동 판단은 말로 한 부탁일 때만 계획을 바꾼다
      ["새 계획", (s) => s.decide({ ...ask("pam-2", 2), textSent: "사람이 말함: 「어떻게 할지 물어봐 줘」" })],
      ["멈춤", (s) => { s.t.stop(); }],
      ["계획 완료", (s) => { s.t.onAnswer("plan:pam-1", "plan:pam-1:2", "done"); s.t.onAnswer("plan:pam-1", "plan:pam-1:3", "done"); s.clock.t += 8000; s.t.tick(); s.t.onAnswer("plan:pam-1", "plan:pam-1:4", "done"); }],
    ];
    for (const [name, end] of ends) {
      const s = stallSetup();
      await toPick(s);
      s.clock.t += 8000;
      s.t.tick();
      expect(s.stalls, name).toHaveLength(1);
      await end(s);
      expect(s.stalls.map((x) => x.signal.aborted), name).toEqual(s.stalls.map(() => true));
    }
  });

  it("가까이 봐서 지키는 중인 옛 물건(closer_hold)은 「아직 있음」으로 세지 않는다: 그 뒤 새로 보인 같은 종류 물건으로 이어 가 놓기가 비전으로 넘어간다", async () => {
    for (const hold of [false, true]) {
      let w = world([cup("present")]);
      const s = setup({ w: () => w });
      await s.decide(decision);
      for (const step of ["plan:pam-1:1", "plan:pam-1:2", "plan:pam-1:3"]) s.t.onAnswer("plan:pam-1", step, "done");
      expect(s.last()).toMatchObject({ step: "plan:pam-1:4" });
      s.clock.t += 600;
      const old: WorldObject = { ...cup("present", "in_hand", 9_000), closer_hold: hold };
      w = world([old, { ...cup("present", "in_sink", s.clock.t), id: "cup_2", position: [5, 0.9, 1], first_seen_ms: s.clock.t - 200 }]);
      s.t.onWorld();
      if (hold) {
        expect(s.last(), "지킴").toEqual({ type: "command_clear", id: "plan:pam-1" });
        expect(s.t.current(), "지킴").toMatchObject({ state: "done" });
      } else {
        expect(s.last(), "지킴 없음").toMatchObject({ step: "plan:pam-1:4", vision: "컵 · 손에 있음" });
        expect(s.t.current(), "지킴 없음").toMatchObject({ state: "running" });
      }
    }
  });

  it("옮김 표시(followed_by)가 있어도 그 뒤 새로 보인 같은 종류 물건이 여럿이면 어느 것으로도 잇지 않는다(놓기는 「완료」로 넘긴다). 하나면 잇는다", async () => {
    for (const many of [true, false]) {
      let w = world([cup("present")]);
      const s = setup({ w: () => w });
      await s.decide(decision);
      for (const step of ["plan:pam-1:1", "plan:pam-1:2", "plan:pam-1:3"]) s.t.onAnswer("plan:pam-1", step, "done");
      s.clock.t += 600;
      const old: WorldObject = { ...cup("present", "in_hand", 9_000), followed_by: "cup_2" };
      const fresh = (id: string, x: number): WorldObject => ({ ...cup("present", "in_sink", s.clock.t), id, position: [x, 0.9, 1], first_seen_ms: s.clock.t - 200 });
      w = world(many ? [old, fresh("cup_2", 5), fresh("cup_3", 4.4)] : [old, fresh("cup_2", 5)]);
      s.t.onWorld();
      if (many) {
        expect(s.t.current(), "여럿").toMatchObject({ state: "running" });
        expect(s.last(), "여럿").toMatchObject({ step: "plan:pam-1:4" });
      } else expect(s.t.current(), "하나").toMatchObject({ state: "done" });
    }
  });
});

describe("실행 추적: 판단 뒤 가까이 본 사실(B와 PAM)", () => {
  // 이 묶음은 볼 면(TaskSpec.look)이 있는 행동의 다시 판단을 본다. 컵 치우기는 습관(2026-11-16)으로 내용물을 보지 않으니 시험 동안만 볼 면을 붙인다
  const clear = TASKS["컵 치우기"]! as { look?: readonly string[] };
  beforeEach(() => {
    clear.look = ["contents"];
  });
  afterEach(() => {
    delete clear.look;
  });

  it("컵 치우기는 볼 면이 없어, 판단 뒤 가까이 보기가 컵 안을 바꿔도 다시 판단하지 않고 계획한다(컵을 두고 떠나면 내용물과 상관없이 치움)", async () => {
    delete clear.look;
    const changed = world([{ ...cup("present"), facts: { contents: { value: "has_contents", at_ms: 9_000, since_ms: 9_000, certainty: "inferred", closer_ms: 9_500 } }, closer_rev: { contents: 1 } }]);
    const a = setup({ w: () => changed });
    await a.decide(decision);
    expect(a.exec().map((e) => e.text)).not.toContain(EXEC_TEXT.closerNewer);
    expect(a.commands()[0]).toMatchObject({ step: "plan:pam-1:1" });
  });

  /** 컵 안 사실. closer: 가까이 보기가 그 값을 넣은 촬영 시각(World State closer_ms). */
  const contents = (value: string, closer?: number): WorldObject["facts"] => ({
    contents: { value, at_ms: 9_000, since_ms: 9_000, certainty: "inferred", ...(closer !== undefined ? { closer_ms: closer } : {}) },
  });
  /** 컵 하나의 World State. rev: 가까이 보기가 면 값을 바꾼 횟수(closer_rev). */
  const withFacts = (facts: WorldObject["facts"], rev?: WorldObject["closer_rev"]) => world([{ ...cup("present"), facts, ...(rev ? { closer_rev: rev } : {}) }]);
  /** 판단 때 본 컵 사실(판단 기록의 World State 요약). rev: 그때 가까이 보기가 면 값을 바꾼 횟수(closer_rev). */
  const seen = (facts: Record<string, string>, rev?: Record<string, number>): DecisionRecord => ({
    ...decision,
    world: { ...decision.world, objects: [{
      id: "cup_1", cls: "cup", status: "present", surface: "t", surface_label: "식탁", error_m: 0.1,
      facts: Object.fromEntries(Object.entries(facts).map(([k, v]) => [k, { value: v, certainty: "inferred" as const }])), ...(rev ? { closer_rev: rev } : {}),
    }] },
  });

  it("판단 뒤 가까이 보기가 바꾼 값을 전체 사진이 다시 바꿔 closer_ms가 없어져도, 가까이 본 횟수(closer_rev)가 판단 때와 다르고 값도 다르면 다시 판단한다", async () => {
    // 판단 때 비어 있음 → 가까이 보기가 내용물 있음(횟수 1) → 전체 사진이 안이 안 보임(closer_ms 없음)
    const now = world([{ ...cup("present"), facts: contents("contents_unknown"), closer_rev: { contents: 1 } }]);
    const a = setup({ w: () => now });
    await a.decide(seen({ contents: "empty" }));
    expect(a.exec().map((e) => e.text)).toEqual([EXEC_TEXT.closerNewer]);
    expect(a.phone).toEqual([]);
    // 판단 때 이미 같은 횟수였으면(가까이 보기가 판단 전에 바꿈) 그 뒤 전체 사진이 바꾼 값은 막지 않는다
    const b = setup({ w: () => now });
    await b.decide(seen({ contents: "empty" }, { contents: 1 }));
    expect(b.commands()[0]).toMatchObject({ step: "plan:pam-1:1" });
  });

  it("판단 때 본 값과 다르게 가까이 보기가 행동 대상 종류 물건의 볼 면(컵 안)을 바꿨으면 계획하지 않고 「가까이 본 뒤 다시 판단」만 남긴다", async () => {
    const changed = withFacts(contents("has_contents", 9_500), { contents: 1 });
    const a = setup({ w: () => changed });
    await a.decide(seen({ contents: "contents_unknown" }));
    expect(a.exec().map((e) => [e.plan_id, e.state, e.text])).toEqual([["plan:pam-1", "decided", EXEC_TEXT.closerNewer]]);
    expect(a.phone).toEqual([]);
    expect(EXEC_TEXT.closerNewer).toBe("가까이 본 뒤 다시 판단");

    // 판단 때 본 값과 같으면 그대로 계획한다
    const b = setup({ w: () => changed });
    await b.decide(seen({ contents: "has_contents" }));
    expect(b.commands()[0]).toMatchObject({ step: "plan:pam-1:1" });
    // 전체 사진이 바꾼 값(가까이 보기 횟수가 판단 때와 같음)은 막지 않는다
    const c = setup({ w: () => withFacts(contents("has_contents")) });
    await c.decide(seen({ contents: "contents_unknown" }));
    expect(c.commands()[0]).toMatchObject({ step: "plan:pam-1:1" });
    // 판단 때 없던 컵(가까이 보기로 새로 생김)도 다시 판단한다
    const d = setup({ w: () => changed });
    await d.decide(decision);
    expect(d.exec().map((e) => e.text)).toEqual([EXEC_TEXT.closerNewer]);
  });

  it("계획을 만드는 사이 가까이 보기가 컵 안을 바꾸면 그 계획은 실행하지 않는다", async () => {
    let w = withFacts({});
    let release!: () => void;
    const held = new Promise<void>((ok) => { release = ok; });
    const p = testPlanner(llm);
    const a = setup({ w: () => w, planner: async (d, signal) => {
      const ctx = planContext({ decision: d, world: w, floor: smallFloor() });
      await held;
      return p.plan(ctx, signal);
    } });
    a.t.onDecision(seen({}));
    w = withFacts(contents("empty", 9_500), { contents: 1 });
    release();
    await a.t.idle();
    expect(a.exec().map((e) => [e.state, e.text])).toEqual([["decided", EXEC_TEXT.decided], ["failed", EXEC_TEXT.closerNewer]]);
    expect(a.phone).toEqual([]);
  });

  it("승인 답을 기다리는 사이 가까이 보기가 컵 안을 바꾸면 「승인」 뒤에도 첫 명령을 보내지 않고 「가까이 본 뒤 다시 판단」으로 닫는다", async () => {
    let w = withFacts(contents("empty"));
    const a = setup({ w: () => w, approvals: store() });
    await a.decide(seen({ contents: "empty" }));
    expect(a.last()).toMatchObject({ step: "plan:pam-1:approve" });
    w = withFacts(contents("has_contents", 9_500), { contents: 1 });
    expect(a.t.onAnswer("plan:pam-1", "plan:pam-1:approve", "approve")).toBe(true);
    expect(a.commands().map((c) => c.step)).toEqual(["plan:pam-1:approve"]);
    expect(a.last()).toEqual({ type: "command_clear", id: "plan:pam-1" });
    expect(a.exec().at(-1)).toMatchObject({ plan_id: "plan:pam-1", state: "failed", text: EXEC_TEXT.closerNewer });
    expect(a.plans.current()).toMatchObject({ id: "plan:pam-1", status: "cancelled" });
    expect(a.t.current()).toMatchObject({ state: "failed" });
  });

  it("실행 전 검사를 다시 보는 사이 가까이 보기가 컵 안을 바꾸면 검사가 통과해도 시작하지 않는다", async () => {
    let w = withFacts(contents("empty"));
    let ready = false;
    const a = setup({ w: () => w, check: () => (ready ? { ok: true } : { ok: false, reason: "stale", text: "아직 아님" } as CheckResult) });
    await a.decide(seen({ contents: "empty" }));
    expect(a.t.current()).toMatchObject({ state: "planned" });
    w = withFacts(contents("has_contents", 9_500), { contents: 1 });
    ready = true;
    a.t.tick();
    expect(a.commands()).toEqual([]);
    expect(a.exec().at(-1)).toMatchObject({ state: "failed", text: EXEC_TEXT.closerNewer });
    expect(a.plans.current()).toMatchObject({ status: "cancelled" });
  });

  it("「가까이 본 뒤 다시 판단」으로 닫은 계획은 같은 행동 다시 계획 15초에 넣지 않아 5초 뒤 새 판단(같은 행동)이 계획을 세운다. 다른 까닭으로 닫은 계획은 15초를 기다린다", async () => {
    const gap = { planGapMs: TRACK_DEFAULTS.planGapMs };
    // 계획을 받을 때(planned) 가까이 보기가 컵 안을 바꿈
    let w = withFacts({});
    let release!: () => void;
    const gate = new Promise<void>((ok) => { release = ok; });
    const p = testPlanner(llm);
    const a = setup({ ...gap, w: () => w, planner: async (d, signal) => {
      const ctx = planContext({ decision: d, world: w, floor: smallFloor() });
      await gate;
      return p.plan(ctx, signal);
    } });
    a.t.onDecision(seen({}));
    w = withFacts(contents("empty", 9_500), { contents: 1 });
    release();
    await a.t.idle();
    expect(a.exec().at(-1)).toMatchObject({ plan_id: "plan:pam-1", state: "failed", text: EXEC_TEXT.closerNewer });
    a.clock.t += 5_000;
    await a.decide({ ...seen({ contents: "empty" }, { contents: 1 }), id: "pam-2", seq: 2 });
    expect(a.commands()[0]).toMatchObject({ id: "plan:pam-2", step: "plan:pam-2:1" });

    // 첫 명령 전(실행 전 검사를 다시 보는 사이) 가까이 보기가 컵 안을 바꿈
    let v = withFacts(contents("empty"));
    let ready = false;
    const b = setup({ ...gap, w: () => v, check: () => (ready ? { ok: true } : { ok: false, reason: "stale", text: "아직 아님" } as CheckResult) });
    await b.decide(seen({ contents: "empty" }));
    v = withFacts(contents("has_contents", 9_500), { contents: 1 });
    ready = true;
    b.t.tick();
    expect(b.exec().at(-1)).toMatchObject({ plan_id: "plan:pam-1", state: "failed", text: EXEC_TEXT.closerNewer });
    b.clock.t += 5_000;
    await b.decide({ ...seen({ contents: "has_contents" }, { contents: 1 }), id: "pam-2", seq: 2 });
    expect(b.commands()[0]).toMatchObject({ id: "plan:pam-2", step: "plan:pam-2:1" });

    // 「그만」으로 닫은 계획은 15초 안의 같은 행동 판단을 「잠시 뒤 다시 봄」으로 남기고, 15초 뒤에 다시 세운다
    const c = setup(gap);
    await c.decide(decision);
    c.heard("그만");
    expect(c.exec().at(-1)).toMatchObject({ plan_id: "plan:pam-1", state: "failed", text: EXEC_TEXT.stopped });
    c.clock.t += 5_000;
    await c.decide({ ...decision, id: "pam-2", seq: 2 });
    expect(c.exec().at(-1)).toMatchObject({ plan_id: "plan:pam-2", state: "decided", text: EXEC_TEXT.held });
    c.clock.t += 10_000;
    await c.decide({ ...decision, id: "pam-3", seq: 3 });
    expect(c.commands().at(-1)).toMatchObject({ id: "plan:pam-3", step: "plan:pam-3:1" });
  });

  it("첫 명령을 보낸 뒤에는 가까이 보기가 컵 안을 바꿔도 계획을 그대로 이어 간다(단계마다 끝나는 조건을 World State로 본다)", async () => {
    let w = withFacts(contents("empty"));
    const a = setup({ w: () => w });
    await a.decide(seen({ contents: "empty" }));
    expect(a.last()).toMatchObject({ step: "plan:pam-1:1" });
    w = withFacts(contents("has_contents", 9_500), { contents: 1 });
    a.clock.t += 600;
    a.t.onWorld();
    a.t.tick();
    expect(a.t.current()).toMatchObject({ state: "running" });
    expect(a.t.openCommand()).toMatchObject({ stepId: "plan:pam-1:1" });
  });
});

describe("실행 추적: 승인(처음 하는 PAM 계획)", () => {
  const APPROVE = [{ id: "approve", label: "승인" }, { id: "reject", label: "거절" }];

  // 2026-11-18 사용자 결정: 처음 하는 일이라는 까닭만으로는 묻지 않고 바로 한다(알아서 판단하는 것을 보여 준다). 묻는 길은 askFirst로 켤 때만 아래 시험이 본다
  it("기본(처음 하는 일 묻기 끔): 처음 컵 치우기도 묻지 않고 첫 명령 「식탁으로 가 주세요」부터 보내고, 승인 기억을 남기지 않는다", async () => {
    const { decide, spoken, phone, plans, approvals } = setup({ approvals: store(), askFirst: undefined });
    await decide(decision);
    expect(spoken()).toEqual(["식탁으로 가 주세요"]);
    expect(phone.some((m) => m.type === "command" && m.step.endsWith(":approve"))).toBe(false);
    expect(plans.current()).toMatchObject({ status: "running" });
    expect(approvals.memory()).toEqual({ always: {} });
  });

  it("처음 컵 치우기는 실제 폰에 「컵 치우기를 할까요?」와 승인·거절 두 단추를 띄우고, 「승인」이면 기억하고 첫 명령을 보낸다", async () => {
    const { t, heard, decide, phone, plans, approvals, spoken, exec } = setup({ approvals: store() });
    await decide(decision);
    expect(phone).toEqual([{ type: "command", id: "plan:pam-1", step: "plan:pam-1:approve", text: "컵 치우기를 할까요?", vision: null, choices: APPROVE, target: null, speak: true, grade: "question" }]);
    expect(APPROVAL_TEXT.ask("컵 치우기")).toBe("컵 치우기를 할까요?");
    expect(plans.current()).toMatchObject({ id: "plan:pam-1", status: "planned", steps: [{ status: "pending" }, { status: "pending" }, { status: "pending" }, { status: "pending" }] });
    expect(t.current()).toMatchObject({ state: "planned" });
    expect(t.openCommand()).toMatchObject({ planId: "plan:pam-1", stepId: "plan:pam-1:approve", kind: "ask", text: "컵 치우기를 할까요?" });
    // 「완료」와 예전 답은 승인 답이 아니다
    for (const old of ["done", "once", "always", "never"]) expect(t.onAnswer("plan:pam-1", "plan:pam-1:approve", old), old).toBe(false);
    expect(heard("완료")).toBeNull();
    expect(t.onAnswer("plan:pam-1", "plan:pam-1:approve", "approve")).toBe(true);
    expect(approvals.memory()).toEqual({ always: { "task:컵 치우기": "t" } });
    expect(spoken()).toEqual(["컵 치우기를 할까요?", "식탁으로 가 주세요"]);
    expect(phone.at(-1)).toMatchObject({ step: "plan:pam-1:1", text: "식탁으로 가 주세요", choices: [{ id: "done", label: "완료" }] });
    expect(plans.current()).toMatchObject({ status: "running" });
    expect(exec().map((l) => l.state)).toEqual(["decided", "planned", "running"]);
  });

  it("말 「승인」이면 기억하고 첫 명령으로 간다. 다음 컵 치우기는 묻지 않는다", async () => {
    const { t, heard, decide, approvals, spoken } = setup({ approvals: store() });
    await decide(decision);
    expect(heard("승인할게요")).toMatchObject({ id: "approve", reply: "" });
    expect(approvals.memory()).toEqual({ always: { "task:컵 치우기": "t" } });
    expect(spoken()).toEqual(["컵 치우기를 할까요?", "식탁으로 가 주세요"]);
    for (let s = 1; s <= 4; s++) t.onAnswer("plan:pam-1", `plan:pam-1:${s}`, "done");
    await decide({ ...decision, id: "pam-2", seq: 2 });
    expect(spoken().at(-1)).toBe("식탁으로 가 주세요");
    expect(spoken().filter((s) => s === "컵 치우기를 할까요?")).toHaveLength(1);
  });

  it("기억에 승인이 있으면 묻지 않고 첫 명령이 바로 「식탁으로 가 주세요」", async () => {
    const { t, decide, spoken, phone } = setup({ approvals: store({ "task:컵 치우기": "approve" }) });
    await decide(decision);
    expect(spoken()).toEqual(["식탁으로 가 주세요"]);
    expect(phone.some((m) => m.type === "command" && m.step.endsWith(":approve"))).toBe(false);
  });

  it("「거절」이면 기억하지 않고 계획을 취소한다. 실행 기록은 「사용자가 거절한 일」, 다음 판단은 또 묻는다", async () => {
    const { t, heard, decide, plans, approvals, exec, last, spoken } = setup({ approvals: store() });
    await decide(decision);
    expect(heard("거절")).toMatchObject({ id: "reject" });
    expect(approvals.memory()).toEqual({ always: {} });
    expect(last()).toEqual({ type: "command_clear", id: "plan:pam-1" });
    expect(plans.current()).toMatchObject({ id: "plan:pam-1", status: "cancelled" });
    expect(exec().at(-1)).toMatchObject({ plan_id: "plan:pam-1", state: "failed", text: APPROVAL_TEXT.refused });
    expect(APPROVAL_TEXT.refused).toBe("사용자가 거절한 일");
    await decide({ ...decision, id: "pam-2", seq: 2 });
    expect(last()).toMatchObject({ type: "command", id: "plan:pam-2", step: "plan:pam-2:approve", text: "컵 치우기를 할까요?", choices: APPROVE });
    expect(spoken()).toEqual(["컵 치우기를 할까요?", "컵 치우기를 할까요?"]);
    expect(t.onAnswer("plan:pam-2", "plan:pam-2:approve", "reject")).toBe(true);
    expect(approvals.memory()).toEqual({ always: {} });
  });

  it("예전 파일의 「하지 마」 기억은 버린다: 그 계획도 판단이 오면 다시 묻는다", async () => {
    const path = join(mkdtempSync(join(tmpdir(), "track-")), "approvals.json");
    writeFileSync(path, JSON.stringify({ always: {}, never: { "task:컵 치우기": "t0" } }));
    const { t, decide, last } = setup({ approvals: new ApprovalStore(path, () => "t") });
    await decide(decision);
    expect(last()).toMatchObject({ type: "command", step: "plan:pam-1:approve", text: "컵 치우기를 할까요?", choices: APPROVE });
  });

  it("승인 질문 중 들은 주변 말에 승인·거절 말이 들어 있어도 답으로 받지 않는다. 말 전체가 답일 때만 받는다", async () => {
    const { t, heard, decide, approvals, spoken } = setup({ approvals: store() });
    await decide(decision);
    for (const said of ["승인 받았다고 했잖아", "그거 좋아 보여", "아니 그게 아니라", "그거 하지 마라고 했잖아", "거절당했어", "응", "네", "앞으로도 해 줘", "이번만"]) {
      expect(heard(said), said).toBeNull();
    }
    expect(approvals.memory()).toEqual({ always: {} });
    expect(spoken()).toEqual(["컵 치우기를 할까요?"]);
    expect(t.openCommand()).toMatchObject({ stepId: "plan:pam-1:approve" });
    expect(heard("응 좋아")).toMatchObject({ id: "approve" });
  });

  it("승인 답을 2분 안에 받지 못하면 실패(답을 받지 못함)로 닫는다. 그 사이 30초마다 다시 읽는다", async () => {
    const { t, decide, clock, spoken, exec, last } = setup({ approvals: store() });
    await decide(decision);
    clock.t += 30_000;
    t.tick();
    expect(spoken()).toEqual(["컵 치우기를 할까요?", "컵 치우기를 할까요?"]);
    clock.t += 90_001;
    t.tick();
    expect(exec().at(-1)).toMatchObject({ state: "failed", text: EXEC_TEXT.noAnswer });
    expect(last()).toEqual({ type: "command_clear", id: "plan:pam-1" });
  });

  it("기억이 비어 있어도 질문 계획(사용자에게 물어보기)은 승인을 묻지 않고 첫 명령이 바로 그 질문이다", async () => {
    const { t, decide, spoken, phone } = setup({ approvals: store() });
    await decide(ask("pam-1", 1));
    expect(spoken()).toEqual(["컵을 치울까요?"]);
    expect(phone[0]).toMatchObject({ step: "plan:pam-1:1", choices: [{ id: "clear", label: "치워 주세요" }, { id: "keep", label: "그대로 둬요" }] });
  });
});

describe("실행 추적: 놓기 단계를 끝낸 물건(이미 치운 것)", () => {
  const TASK_LIST = ["컵 치우기", "사용자에게 물어보기"];

  it("놓기를 끝낸 컵은 그 계획의 넣은 곳과 남아 같은 행동의 계획 전 검사·대상 고르기에서 빠진다. 같은 면에서 다시 보이거나 손에 있음 한 번(추정)으로는 남고, 손에 있음이 확인되면 풀린다", async () => {
    let w = world([cup("present")]);
    let tracker: ExecutionTracker | null = null;
    const { t, decide, clock, exec, plans } = setup({ w: () => w, precheck: (d) => checkDecision({ decision: d, tasks: TASK_LIST, world: w, placed: tracker!.placed() }) });
    tracker = t;
    await decide(decision);
    for (const n of [1, 2, 3]) t.onAnswer("plan:pam-1", `plan:pam-1:${n}`, "done");
    clock.t += 600;
    const done = clock.t;
    const inBasin: WorldObject = { ...cup("present", "on_table", clock.t), surface: "sink_1", surface_label: "싱크대", surface_part: "basin" };
    w = { ...world([inBasin]), frame_ms: clock.t };
    t.onWorld();
    expect(plans.current()).toMatchObject({ id: "plan:pam-1", status: "done" });
    expect([...t.placed()]).toEqual([["cup_1", { target: "sink_1", part: "basin", atMs: done }]]);
    // VLM 자리 사실은 「식탁 위」지만 실행 추적이 싱크대에 넣은 컵이라 같은 행동을 다시 계획하지 않는다
    expect(targetOf(TASKS["컵 치우기"]!, w, t.placed())).toBeNull();
    await decide({ ...decision, id: "pam-2", seq: 2, atMs: clock.t });
    expect(exec().at(-1)).toMatchObject({ plan_id: "plan:pam-2", state: "failed", text: CHECK_TEXT.in_sink });
    clock.t += 600;
    w = { ...world([{ ...inBasin, last_seen_ms: clock.t }]), frame_ms: clock.t };
    expect(t.placed().has("cup_1")).toBe(true);
    clock.t += 600;
    const once: WorldObject = { ...inBasin, last_seen_ms: clock.t, facts: { place: { value: "in_hand", at_ms: clock.t, since_ms: clock.t, certainty: "inferred" } } };
    w = { ...world([once]), frame_ms: clock.t };
    expect(t.placed().has("cup_1")).toBe(true);
    // 다시 집음(손에 있음 확인됨): 풀린다. 그 컵을 식탁에 내려놓으면 다음 판단은 계획을 세운다
    clock.t += 600;
    w = { ...world([{ ...inBasin, last_seen_ms: clock.t, facts: { place: { value: "in_hand", at_ms: clock.t, since_ms: clock.t - 600, certainty: "confirmed" } } }]), frame_ms: clock.t };
    expect(t.placed().size).toBe(0);
    // 싱크볼 안에 다시 내려놓으면(손에 없음) 넣은 기억이 없어도 치운 것이다
    clock.t += 600;
    w = { ...world([{ ...inBasin, last_seen_ms: clock.t }]), frame_ms: clock.t };
    expect([...t.placed().keys()]).toEqual(["cup_1"]);
    clock.t += 600;
    w = { ...world([cup("present", "on_table", clock.t)]), frame_ms: clock.t };
    expect(t.placed().size).toBe(0);
    await decide({ ...decision, id: "pam-3", seq: 3, atMs: clock.t });
    expect(plans.current()).toMatchObject({ id: "plan:pam-3", status: "running" });
  });

  // 2026-11-16 23:36·23:48 실제 시험: 놓은 컵(cup_11)이 끝낸 뒤 새 id(cup_28)로 다시 잡혀 치운 기억이 없어지고, 서버를 다시 본 뒤 싱크볼 안 새 컵(cup_32)도 치울 컵으로 남아 PAM이 다시 치우기를 골랐다
  // Codex(c5d3e6a): 새 id로 넘기며 놓기 기억에서 빠진 옛 id는 다시 집거나 다른 자리에서 보여도 찾기에서 영영 빠졌다
  it("놓기 기억을 새 id로 넘긴 옛 컵이 그 뒤 다시 보이면 찾기에서 빼지 않는다", async () => {
    let w = world([cup("present")]);
    let tracker: ExecutionTracker | null = null;
    const { t, decide, clock, exec } = setup({ w: () => w, precheck: (d) => checkDecision({ decision: d, tasks: TASK_LIST, world: w, placed: tracker!.placed() }) });
    tracker = t;
    await decide(decision);
    for (const n of [1, 2, 3, 4]) t.onAnswer("plan:pam-1", `plan:pam-1:${n}`, "done");
    const done = clock.t;
    clock.t += 1000;
    w = { ...world([cup("gone", undefined, done - 1000)]), frame_ms: clock.t };
    t.placed();
    clock.t += 1000;
    const again: WorldObject = { ...cup("present", "on_counter", clock.t), id: "cup_28", first_seen_ms: clock.t, position: [5, 0.9, 0.6], surface: "sink_1", surface_label: "싱크대" };
    w = { ...world([cup("gone", undefined, done - 1000), again]), frame_ms: clock.t };
    expect([...t.placed().keys()]).toEqual(["cup_28"]);
    // 옛 컵 cup_1이 식탁에서 다시 보인다(다른 컵이었다): 놓기 기억과 상관없는 컵이다
    clock.t += 1000;
    w = { ...world([cup("present", "on_table", clock.t), again]), frame_ms: clock.t };
    t.placed();
    // 그 뒤 cup_1이 오래 안 보이면 계획 전 검사는 싱크대 컵(cup_28) 때문에 in_sink로 막고, 찾기는 cup_1의 마지막 자리로 간다
    clock.t += 15_000;
    w = { ...world([{ ...cup("out_of_view", "on_table", clock.t - 15_000) }, again]), frame_ms: clock.t };
    await decide({ ...decision, id: "pam-2", seq: 2, atMs: clock.t });
    expect(exec().at(-1)).toMatchObject({ plan_id: "plan:pam-2", state: "decided", text: "컵을 찾으러 가요" });
  });

  it("놓기를 끝낸 컵이 사라지고 같은 종류가 넣은 곳(싱크대 면)에 새 id로 다시 잡히면 그 컵으로 치운 기억을 이어 가 다시 치우지 않는다. 30초가 지나도 안 잡히면 잊는다", async () => {
    let w = world([cup("present")]);
    let tracker: ExecutionTracker | null = null;
    const { t, decide, clock, exec } = setup({ w: () => w, precheck: (d) => checkDecision({ decision: d, tasks: TASK_LIST, world: w, placed: tracker!.placed() }) });
    tracker = t;
    await decide(decision);
    for (const n of [1, 2, 3, 4]) t.onAnswer("plan:pam-1", `plan:pam-1:${n}`, "done");
    const done = clock.t;
    expect([...t.placed()]).toEqual([["cup_1", { target: "sink_1", atMs: done }]]);
    // 들고 가는 동안(끝내기 전) 마지막으로 본 cup_1이 사라짐: 바로 잊지 않고 기다린다
    clock.t += 1000;
    w = { ...world([cup("gone", undefined, done - 1000)]), frame_ms: clock.t };
    expect([...t.placed()]).toEqual([["cup_1", { target: "sink_1", atMs: done }]]);
    // 2초 뒤 싱크대 면(싱크볼 옆)에 새 id
    clock.t += 1000;
    const again: WorldObject = { ...cup("present", "on_counter", clock.t), id: "cup_28", first_seen_ms: clock.t, position: [5, 0.9, 0.6], surface: "sink_1", surface_label: "싱크대" };
    w = { ...world([cup("gone", undefined, done - 1000), again]), frame_ms: clock.t };
    expect([...t.placed()]).toEqual([["cup_28", { target: "sink_1", atMs: done }]]);
    await decide({ ...decision, id: "pam-2", seq: 2, atMs: clock.t });
    expect(exec().at(-1)).toMatchObject({ plan_id: "plan:pam-2", state: "failed", text: CHECK_TEXT.in_sink });
    // 다른 종류(병)나 다른 면의 새 물건은 잇지 않고, 30초 넘게 안 잡히면 잊는다
    const t2 = setup({ w: () => w });
    w = world([cup("present")]);
    await t2.decide(decision);
    for (const n of [1, 2, 3, 4]) t2.t.onAnswer("plan:pam-1", `plan:pam-1:${n}`, "done");
    t2.clock.t += 1000;
    w = { ...world([cup("gone", undefined, t2.clock.t - 2000), { ...again, id: "bottle_3", cls: "bottle", first_seen_ms: t2.clock.t }, { ...again, id: "cup_40", surface: "t", surface_label: "식탁", first_seen_ms: t2.clock.t }]), frame_ms: t2.clock.t };
    expect([...t2.t.placed().keys()]).toEqual(["cup_1"]);
    t2.clock.t += 30_001;
    expect(t2.t.placed().size).toBe(0);
  });

  // Codex(e0f0c33): 사라진 때를 놓기 시각에 묶어, 놓은 뒤 오래 보이다 사라진 컵은 새 id로 잇지 못했다
  it("놓은 뒤 1분 동안 보이다 사라진 컵도 그 마지막 확인 뒤 새 id로 잡히면 잇는다", async () => {
    let w = world([cup("present")]);
    const { t, decide, clock } = setup({ w: () => w });
    await decide(decision);
    for (const n of [1, 2, 3, 4]) t.onAnswer("plan:pam-1", `plan:pam-1:${n}`, "done");
    const done = clock.t;
    const sink = { position: [5, 0.9, 0.6] as [number, number, number], surface: "sink_1", surface_label: "싱크대" };
    clock.t = done + 60_000;
    w = { ...world([{ ...cup("present", "on_counter", clock.t), ...sink }]), frame_ms: clock.t };
    expect(t.placed().has("cup_1")).toBe(true);
    clock.t += 2000;
    w = { ...world([{ ...cup("gone", "on_counter", done + 60_000), ...sink }, { ...cup("present", "on_counter", clock.t), ...sink, id: "cup_28", first_seen_ms: clock.t }]), frame_ms: clock.t };
    expect([...t.placed()]).toEqual([["cup_28", { target: "sink_1", atMs: done }]]);
  });

  it("싱크볼 안 컵은 실행 추적이 넣은 기억이 없어도(서버를 다시 띄운 뒤, 새 id) 치운 것이라 치우기를 막는다. 손에 있음이 확인되면 아니고, 식탁 위 컵이 있으면 그 컵을 치운다", async () => {
    const basin: WorldObject = { ...cup("present", "on_desk"), id: "cup_32", position: [5, 0.9, 1.1], surface: "sink_1", surface_label: "싱크대", surface_part: "basin" };
    basin.facts = { place: { value: "on_desk", at_ms: 9_000, since_ms: 9_000, certainty: "inferred" } };
    let w = world([basin]);
    let tracker: ExecutionTracker | null = null;
    const { t, decide, exec, plans } = setup({ w: () => w, precheck: (d) => checkDecision({ decision: d, tasks: TASK_LIST, world: w, placed: tracker!.placed() }) });
    tracker = t;
    expect([...t.placed()]).toEqual([["cup_32", { target: "sink_1", part: "basin", atMs: 0 }]]);
    await decide(decision);
    expect(exec().at(-1)).toMatchObject({ plan_id: "plan:pam-1", state: "failed", text: CHECK_TEXT.in_sink });
    w = world([{ ...basin, facts: { place: { value: "in_hand", at_ms: 9_000, since_ms: 8_000, certainty: "confirmed" } } }]);
    expect(t.placed().size).toBe(0);
    w = world([cup("present"), basin]);
    await decide({ ...decision, id: "pam-2", seq: 2 });
    expect(plans.current()).toMatchObject({ id: "plan:pam-2", status: "running" });
  });

  // 2026-11-18 사용자 결정(1d14c37 넓힘): 끝낸 계획의 대상뿐 아니라 넣은 곳의 같은 종류 무리도 치운 것이다
  it("치운 컵 무리: 컵 치우기가 끝난 뒤 넣은 곳(싱크대 면)의 같은 종류 물건은 넣은 기억이 없어도(둘이 함께 새 id로 잡힘·그 뒤 들어온 컵) 치운 것이라 내용물 보기·판단 전 보기·새 치우기 계획에서 빠진다. 다른 종류·다른 면, 손에 있음이 확인된 것은 아니다", async () => {
    let w = world([cup("present")]);
    let tracker: ExecutionTracker | null = null;
    const { t, decide, clock, exec } = setup({ w: () => w, precheck: (d) => checkDecision({ decision: d, tasks: TASK_LIST, world: w, placed: tracker!.placed() }) });
    tracker = t;
    // 계획을 끝내기 전에는 싱크대 면(싱크볼 밖)의 컵이 치운 것이 아니다
    const onSink = (id: string, at: number): WorldObject => ({ ...cup("present", "on_counter", at), id, first_seen_ms: at, position: [5.2, 0.9, 0.7], surface: "sink_1", surface_label: "싱크대" });
    w = world([cup("present"), onSink("cup_20", 8_000)]);
    expect(t.placed().has("cup_20")).toBe(false);
    w = world([cup("present")]);
    await decide(decision);
    for (const n of [1, 2, 3, 4]) t.onAnswer("plan:pam-1", `plan:pam-1:${n}`, "done");
    // 놓은 컵이 사라지고 같은 종류 둘이 넣은 곳에 새 id로 잡힘(어느 것이 그 컵인지 모른다), 병과 식탁 위 컵도 보임
    clock.t += 2000;
    const now = clock.t;
    const bottle: WorldObject = { ...onSink("bottle_3", now), cls: "bottle" };
    const onTable: WorldObject = { ...cup("present", "on_table", now), id: "cup_40", first_seen_ms: now };
    // 놓기 전부터 싱크대 면에 있던 컵(cup_20)도 무리다(Codex(1d14c37)가 막았던 「원래 있던 옆 컵·나중에 생긴 컵」은 이 결정으로 치운 것이다)
    w = { ...world([cup("gone", undefined, now - 3000), onSink("cup_20", 8_000), onSink("cup_28", now), onSink("cup_29", now), bottle, onTable]), frame_ms: now };
    expect([...t.placed().keys()].sort()).toEqual(["cup_1", "cup_20", "cup_28", "cup_29"]);
    for (const id of ["cup_28", "cup_29"]) expect(putAway(w.objects.find((o) => o.id === id)!, t.placed()), id).toBe(true);
    // 넣은 기억(cup_1)을 잊은 뒤에도, 그 뒤 들어온 컵도 무리다. 손에 있음이 확인된 컵은 아니다
    clock.t += 31_000;
    const held: WorldObject = { ...onSink("cup_29", now), facts: { place: { value: "in_hand", at_ms: clock.t, since_ms: clock.t, certainty: "confirmed" } } };
    w = { ...world([onSink("cup_28", now), held, onSink("cup_33", clock.t)]), frame_ms: clock.t };
    expect([...t.placed().keys()].sort()).toEqual(["cup_28", "cup_33"]);
    // Codex(c23fe16 steps.ts:87): 무리의 컵을 다시 집어 쓰면(손에 있음 확인) 같은 면에 도로 내려놓아도 무리로 돌아가지 않는다
    clock.t += 600;
    w = { ...world([onSink("cup_28", now), { ...onSink("cup_33", clock.t), facts: { place: { value: "in_hand", at_ms: clock.t, since_ms: clock.t, certainty: "confirmed" } } }]), frame_ms: clock.t };
    t.onWorld();
    expect([...t.placed().keys()]).toEqual(["cup_28"]);
    clock.t += 600;
    w = { ...world([onSink("cup_28", now), { ...onSink("cup_33", clock.t), last_seen_ms: clock.t }]), frame_ms: clock.t };
    t.onWorld();
    expect([...t.placed().keys()]).toEqual(["cup_28"]);
    // 무리만 보이면 새 치우기 계획을 세우지 않는다
    w = { ...world([onSink("cup_28", now)]), frame_ms: clock.t };
    await decide({ ...decision, id: "pam-2", seq: 2, atMs: clock.t });
    expect(exec().at(-1)).toMatchObject({ plan_id: "plan:pam-2", state: "failed", text: CHECK_TEXT.in_sink });
  });

  it("치운 컵 무리: 싱크볼 안에 넣고 끝냈으면 무리는 그 싱크볼 안이다(옆 조리대에 새로 놓인 컵은 아니다)", async () => {
    let w = world([cup("present")]);
    const { t, decide, clock } = setup({ w: () => w });
    await decide(decision);
    for (const n of [1, 2, 3]) t.onAnswer("plan:pam-1", `plan:pam-1:${n}`, "done");
    clock.t += 600;
    const inBasin: WorldObject = { ...cup("present", "on_table", clock.t), position: [5, 0.9, 1.1], surface: "sink_1", surface_label: "싱크대", surface_part: "basin" };
    w = { ...world([inBasin]), frame_ms: clock.t };
    t.onWorld();
    expect([...t.placed()]).toEqual([["cup_1", { target: "sink_1", part: "basin", atMs: clock.t }]]);
    clock.t += 600;
    const side: WorldObject = { ...inBasin, id: "cup_50", first_seen_ms: clock.t, last_seen_ms: clock.t, position: [5, 0.9, 0.6], surface_part: undefined };
    w = { ...world([{ ...inBasin, last_seen_ms: clock.t }, side]), frame_ms: clock.t };
    expect([...t.placed().keys()]).toEqual(["cup_1"]);
  });

  it("「완료」로 끝낸 놓기도 남는다. 놓기 전에 본 자리·트윈 자리를 모르는 채 본 것은 근거가 아니고, 그 뒤 다른 면(식탁)에서 보이면 풀린다", async () => {
    let w = world([cup("present")]);
    const { t, decide, clock } = setup({ w: () => w });
    await decide(decision);
    for (const n of [1, 2, 3, 4]) t.onAnswer("plan:pam-1", `plan:pam-1:${n}`, "done");
    expect([...t.placed()]).toEqual([["cup_1", { target: "sink_1", atMs: clock.t }]]);
    // 트윈 자리를 모르는 채(맞추기 전) 다시 보인 것은 옮긴 근거가 아니다
    clock.t += 600;
    w = { ...world([{ ...cup("present", undefined, clock.t), position: null, surface: null, surface_label: null }]), frame_ms: clock.t };
    expect(t.placed().has("cup_1")).toBe(true);
    clock.t += 600;
    w = { ...world([cup("present", undefined, clock.t)]), frame_ms: clock.t }; // 식탁 면(t)에서 다시 보임
    expect(t.placed().size).toBe(0);
  });

  it("싱크볼 안에서 끝낸 놓기는 그 자리(싱크볼)를 남긴다. 같은 싱크대 면이어도 싱크볼 밖(옆 조리대)에서 보이면 풀리고, 자리를 모르는 채 본 것으로는 풀지 않는다", async () => {
    let w = world([cup("present")]);
    const { t, decide, clock, plans } = setup({ w: () => w });
    await decide(decision);
    for (const n of [1, 2, 3]) t.onAnswer("plan:pam-1", `plan:pam-1:${n}`, "done");
    clock.t += 600;
    const done = clock.t;
    const inBasin: WorldObject = { ...cup("present", "on_table", clock.t), position: [5, 0.9, 1.1], surface: "sink_1", surface_label: "싱크대", surface_part: "basin" };
    w = { ...world([inBasin]), frame_ms: clock.t };
    t.onWorld();
    expect(plans.current()).toMatchObject({ id: "plan:pam-1", status: "done" });
    expect([...t.placed()]).toEqual([["cup_1", { target: "sink_1", part: "basin", atMs: done }]]);
    // 싱크볼 안에서 다시 보이면 남는다
    clock.t += 600;
    w = { ...world([{ ...inBasin, last_seen_ms: clock.t }]), frame_ms: clock.t };
    expect(t.placed().has("cup_1")).toBe(true);
    // 트윈 자리를 모르는 채(맞추기 전) 다시 보인 것은 옮긴 근거가 아니다
    clock.t += 600;
    w = { ...world([{ ...inBasin, last_seen_ms: clock.t, position: null, surface: null, surface_label: null, surface_part: undefined }]), frame_ms: clock.t };
    expect(t.placed().has("cup_1")).toBe(true);
    // 같은 싱크대 면의 싱크볼 옆 조리대(싱크볼 밖)에서 보이면 옮긴 것이다
    clock.t += 600;
    w = { ...world([{ ...inBasin, last_seen_ms: clock.t, position: [5, 0.9, 0.6], surface_part: undefined }]), frame_ms: clock.t };
    expect(t.placed().size).toBe(0);
  });
});

describe("실행 추적 + 실제 World State(기준점을 맞춘 카메라)", () => {
  // 카메라: 트윈 (0, 1.5, 0)에서 45° 아래로 숙이고 +x를 본다(tests/world-state.test.ts와 같다). 90° 시야 투영(열 우선)
  const P = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, -1.0002, -1, 0, 0, -0.020002, 0];
  const mul = (a: number[], b: number[]) => [a[3]! * b[0]! + a[0]! * b[3]! + a[1]! * b[2]! - a[2]! * b[1]!, a[3]! * b[1]! - a[0]! * b[2]! + a[1]! * b[3]! + a[2]! * b[0]!, a[3]! * b[2]! + a[0]! * b[1]! - a[1]! * b[0]! + a[2]! * b[3]!, a[3]! * b[3]! - a[0]! * b[0]! - a[1]! * b[1]! - a[2]! * b[2]!];
  const tilt = [Math.sin(-Math.PI / 8), 0, 0, Math.cos(-Math.PI / 8)];
  const look: CameraView = { origin: [0, 1.5, 0], orientation: mul([0, Math.sin(-Math.PI / 4), 0, Math.cos(-Math.PI / 4)], tilt) as [number, number, number, number], theta: 0, projection: P };
  const frame = (i: number): EngineFrame => ({ id: `e${i}`, capturedAtMs: i * 1000, latestAtMs: i * 1000, jpeg: Buffer.from(`${i}`), sha256: sha256(Buffer.from(`${i}`)), width: 480, height: 360, eye: null, view: look });
  const box = (b: [number, number, number, number]): Detection => (det("cup", 0.9, b, 41));
  const onTable = box([220, 160, 40, 20]);
  const moved = box([60, 300, 40, 20]);

  // 가로 유리컵 실제 판 r4·r6(2026-11-18): 식탁 위 잔을 VLM이 「선반 위」로 답했다
  it("들려 있지 않은 물건의 놓인 곳은 트윈 면으로 정한다: 식탁 면 위 컵은 VLM이 선반 위라 해도 식탁 위다. 손에 있음은 VLM 말을 따른다", () => {
    // 식탁 면을 카메라 앞(0.75, 0)에 둔다: onTable 상자가 그 면 위다(tests/world-state.test.ts와 같은 자리)
    const ws = new WorldState({ evidenceStepMs: 1000,
      surfaces: () => [{ id: "table_1", label: "식탁", center: [0.75, 0], top: 0.75, radius: 0.6 }],
      floorAt: () => 0, roomAt: () => ({ id: "kitchen", label: "주방" }), devices: () => [],
    });
    const see = (i: number, state: "on_table" | "on_shelf" | "in_hand") => {
      const { ids } = vlmSee(ws, frame(i), [onTable]);
      ws.applyScene(`e${i}`, i * 1000, { scene: "k", observations: [{ object_id: "d1", state }], summary: "s" }, ids);
    };
    for (let i = 1; i <= 3; i++) see(i, "on_table");
    see(4, "on_shelf");
    see(5, "on_shelf");
    expect(ws.view(5000).objects[0]).toMatchObject({ surface: "table_1", facts: { place: { value: "on_table" } } });
    see(6, "in_hand");
    see(7, "in_hand");
    expect(ws.view(7000).objects[0]!.facts.place?.value).toBe("in_hand");
  });

  // Codex(4e682c8 2·3): 외접원·싱크볼 경계만 보면 옆 조리대 컵·긴 식탁 바깥 컵을 덮는다. 실제 면 사각형과 투영 오차 여유(0.15m)를 빼고도 안일 때만 바꾼다
  it("트윈 면·싱크볼 보정은 회전한 실제 사각형 안쪽(투영 오차 0.15m 여유를 뺀 안)일 때만 한다", () => {
    const probe = new WorldState({ evidenceStepMs: 1000, surfaces: () => [{ id: "table_1", label: "식탁", center: [0.75, 0], top: 0.75, radius: 0.6 }], floorAt: () => 0, roomAt: () => null, devices: () => [] });
    for (let i = 1; i <= 3; i++) vlmSee(probe, frame(i), [onTable]);
    const p = probe.view(3000).objects[0]!.position!;
    const run = (rect: { center: [number, number]; size: [number, number]; facing_deg: number }, basin: boolean) => {
      const s = { id: basin ? "sink_1" : "table_1", label: "면", center: [0.75, 0] as [number, number], top: 0.75, radius: 0.6, rect, ...(basin ? { basin: rect } : {}) };
      const ws = new WorldState({ evidenceStepMs: 1000, surfaces: () => [s], floorAt: () => 0, roomAt: () => null, devices: () => [] });
      const see = (i: number, state: "on_floor" | "on_counter") => {
        const { ids } = vlmSee(ws, frame(i), [onTable]);
        ws.applyScene(`e${i}`, i * 1000, { scene: "k", observations: [{ object_id: "d1", state }], summary: "s" }, ids);
      };
      for (let i = 1; i <= 3; i++) see(i, basin ? "on_counter" : "on_floor");
      return ws.view(3000).objects[0]!.facts.place?.value;
    };
    // 사각형 가장자리 0.05m 안(여유 0.15m보다 얕다): 덮지 않는다
    const edge = { center: [p[0] + 0.2, p[2]] as [number, number], size: [0.5, 0.5] as [number, number], facing_deg: 0 };
    expect(run(edge, false)).toBe("on_floor");
    expect(run(edge, true)).toBe("on_counter");
    // 사각형 한가운데: 덮는다
    const mid = { center: [p[0], p[2]] as [number, number], size: [0.8, 0.8] as [number, number], facing_deg: 0 };
    expect(run(mid, false)).toBe("on_table");
    expect(run(mid, true)).toBe("in_sink");
  });

  // 가로 머그 실제 판 r4(2026-11-18): 싱크볼 안 컵이 「조리대 위」였다. Codex(40407aa 2·3): 면 가장자리 밖 컵의 바닥 답을 덮지 않고, 변화 줄도 바꾼 값으로
  it("싱크볼 안 물건은 VLM이 조리대 위라 해도 싱크대 안으로 넣는다. 면 가운데에서 먼(반지름 0.8배 밖) 물건은 트윈 면으로 덮지 않는다. 변화 줄은 넣은 값으로 쓴다", () => {
    const sink = { id: "sink_1", label: "싱크대", center: [0.75, 0] as [number, number], top: 0.75, radius: 0.6, basin: { center: [0.75, 0] as [number, number], size: [0.9, 0.9] as [number, number], facing_deg: 0 } };
    const ws = new WorldState({ evidenceStepMs: 1000, surfaces: () => [sink], floorAt: () => 0, roomAt: () => ({ id: "kitchen", label: "주방" }), devices: () => [] });
    const see = (i: number, state: "on_counter" | "in_sink") => {
      const { ids } = vlmSee(ws, frame(i), [onTable]);
      return ws.applyScene(`e${i}`, i * 1000, { scene: "k", observations: [{ object_id: "d1", state }], summary: "s" }, ids);
    };
    for (let i = 1; i <= 3; i++) see(i, "on_counter");
    expect(ws.view(3000).objects[0]).toMatchObject({ surface: "sink_1", surface_part: "basin" });
    expect(ws.view(3000).objects[0]!.facts.place?.value).toBe("in_sink");
    see(4, "in_sink");
    see(5, "in_sink");
    expect(ws.view(5000).objects[0]!.facts.place?.value).toBe("in_sink");
    // 변화 줄은 넣은 값(트윈 면으로 바꾼 값)이다
    const table = new WorldState({ evidenceStepMs: 1000, surfaces: () => [{ id: "table_1", label: "식탁", center: [0.75, 0], top: 0.75, radius: 0.6 }], floorAt: () => 0, roomAt: () => ({ id: "kitchen", label: "주방" }), devices: () => [] });
    const said = (i: number, state: "on_table" | "on_shelf") => {
      const { ids } = vlmSee(table, frame(i), [onTable]);
      return table.applyScene(`e${i}`, i * 1000, { scene: "k", observations: [{ object_id: "d1", state }], summary: "s" }, ids);
    };
    for (let i = 1; i <= 3; i++) said(i, "on_table");
    const texts = [...said(4, "on_shelf"), ...said(5, "on_shelf")].map((c) => c.text).join(" ");
    expect(texts).not.toContain("선반");
  });

  it("식탁 위 컵을 들어 옮기면(VLM 손에 있음) 같은 id로 이어 집기·내려놓기가 비전으로 넘어가고 비전 상태 줄이 그 컵을 따라간다", async () => {
    const ws = new WorldState({ evidenceStepMs: 1000,
      surfaces: () => [{ id: "table_1", label: "식탁", center: [2, 0], top: 0.75, radius: 0.6 }, { id: "sink_1", label: "싱크대", center: [1.2, 0.8], top: 0.9, radius: 0.5 }],
      floorAt: () => 0, roomAt: () => ({ id: "kitchen", label: "주방" }), devices: () => [],
    });
    const see = (i: number, d: Detection, state: "on_table" | "in_hand" | "in_sink") => {
      const { ids } = vlmSee(ws, frame(i), [d]);
      ws.applyScene(`e${i}`, i * 1000, { scene: "k", observations: [{ object_id: "d1", state }], summary: "s" }, ids);
    };
    for (let i = 1; i <= 3; i++) see(i, onTable, "on_table");
    const { t, decide, last, clock } = setup({ w: () => ws.view(10_000) });
    clock.t = 3_500;
    await decide({ ...decision, atMs: 0 });
    t.onAnswer("plan:pam-1", "plan:pam-1:1", "done");
    expect(last()).toMatchObject({ step: "plan:pam-1:2", vision: "컵 · 식탁 위" });
    for (let i = 4; i <= 6; i++) see(i, moved, "in_hand");
    // 장면 VLM이 손에 있음으로 답한 들린 컵은 폰 눈 가까이의 그 컵으로 잇는다(새 id가 생기지 않는다)
    expect(ws.view(6000).objects.map((o) => [o.id, o.status])).toEqual([["cup_1", "present"]]);
    t.onWorld();
    expect(last()).toMatchObject({ step: "plan:pam-1:3", vision: "컵 · 손에 있음 · 싱크대까지 거리 모름" });
    t.onAnswer("plan:pam-1", "plan:pam-1:3", "done");
    // 물건의 다른 놓인 곳은 VLM 사진 2장이 이어 말할 때 바뀐다(SceneFacts.steady)
    see(7, moved, "in_sink");
    see(8, moved, "in_sink");
    t.onWorld();
    expect(last()).toEqual({ type: "command_clear", id: "plan:pam-1" });
  });

  it("놓기 단계에서 옮긴 컵이 싱크볼 안에 보이면 VLM 자리 사실이 「식탁 위」여도 손에 없으니 「완료」 없이 끝난다. 싱크볼 옆 조리대(같은 싱크대 면)나 「손에 있음」인 동안은 안 끝난다", async () => {
    // 싱크대 면 sink_1의 싱크볼: 깊이(x) 1.05~1.35, 폭(y) 0.45~0.95
    const sink = { id: "sink_1", label: "싱크대", center: [1.2, 0.8] as [number, number], top: 0.9, radius: 0.5, basin: { center: [1.2, 0.7] as [number, number], size: [0.5, 0.3] as [number, number], facing_deg: 0 } };
    const ws = new WorldState({ evidenceStepMs: 1000,
      surfaces: () => [{ id: "table_1", label: "식탁", center: [2, 0], top: 0.75, radius: 0.6 }, sink],
      floorAt: () => 0, roomAt: () => ({ id: "kitchen", label: "주방" }), devices: () => [],
    });
    const beside = box([427, 100, 40, 20]); // 싱크대 면 윗면 (1.2, 1.1): 싱크볼 밖
    const inSink = box([340, 100, 40, 20]); // 싱크대 면 윗면 (1.2, 0.64): 싱크볼 안
    const see = (i: number, d: Detection, state: "on_table" | "in_hand") => {
      clock.t = i * 1000;
      const { ids } = vlmSee(ws, frame(i), [d]);
      ws.applyScene(`e${i}`, i * 1000, { scene: "k", observations: [{ object_id: "d1", state }], summary: "s" }, ids);
      t.onWorld();
    };
    for (let i = 1; i <= 3; i++) vlmSee(ws, frame(i), [onTable]);
    const { t, decide, last, clock, plans, exec, steps } = setup({ w: () => ws.view(clock.t) });
    clock.t = 3_500;
    await decide({ ...decision, atMs: 0 });
    t.onAnswer("plan:pam-1", "plan:pam-1:1", "done");
    for (let i = 4; i <= 6; i++) see(i, moved, "in_hand");
    expect(last()).toMatchObject({ step: "plan:pam-1:3" });
    t.onAnswer("plan:pam-1", "plan:pam-1:3", "done");
    expect(steps()).toEqual(["done", "done", "done", "active"]);
    // 싱크볼 옆 조리대에 컵(시야 안 같은 무리 하나라 같은 cup_1): 같은 싱크대 면이고 손에 없지만 싱크볼 안이 아니라 넘기지 않는다
    for (let i = 7; i <= 9; i++) see(i, beside, "on_table");
    expect(ws.view(9000).objects.map((o) => [o.id, o.status, o.surface, o.surface_part, o.facts.place?.value])).toEqual([
      ["cup_1", "present", "sink_1", undefined, "on_table"],
    ]);
    expect(steps()).toEqual(["done", "done", "done", "active"]);
    // 컵이 싱크볼 안에 보이지만 VLM은 아직 손에 있다고 본다: 넘기지 않는다
    for (let i = 10; i <= 12; i++) see(i, inSink, "in_hand");
    expect(ws.view(12_000).objects.filter((o) => o.status === "present").map((o) => [o.id, o.facts.place?.value])).toEqual([["cup_1", "in_hand"]]);
    expect(steps()).toEqual(["done", "done", "done", "active"]);
    expect(plans.current()).toMatchObject({ status: "running" });
    // VLM이 싱크대 안 대신 「식탁 위」라 답해도 트윈 싱크볼 안이라 싱크대 안으로 넣고 끝난다(「완료」를 누르지 않음)
    see(13, inSink, "on_table");
    see(14, inSink, "on_table");   // 다른 놓인 곳은 VLM 사진 2장 이어서
    expect(ws.view(14_000).objects.at(-1)).toMatchObject({ id: "cup_1", surface: "sink_1", surface_part: "basin", facts: { place: { value: "in_sink" } } });
    expect(last()).toEqual({ type: "command_clear", id: "plan:pam-1" });
    expect(plans.current()).toMatchObject({ id: "plan:pam-1", status: "done" });
    expect(exec().at(-1)).toMatchObject({ plan_id: "plan:pam-1", state: "done" });
    // 놓기를 끝낸 컵은 지금 따라가는 World State id로 남는다(이미 치운 것)
    expect([...t.placed()]).toEqual([["cup_1", { target: "sink_1", part: "basin", atMs: 14_000 }]]);
  });

  it("놓기: VLM이 「싱크대 안」이라 답해도 사람이 그 컵을 들고 있다고 보이면 안 끝난다. 사람이 안 보이는 프레임(10초 안)이 오면 끝난다", async () => {
    const ws = new WorldState({ evidenceStepMs: 1000,
      surfaces: () => [{ id: "table_1", label: "식탁", center: [2, 0], top: 0.75, radius: 0.6 }, { id: "sink_1", label: "싱크대", center: [1.2, 0.8], top: 0.9, radius: 0.5 }],
      floorAt: () => 0, roomAt: () => ({ id: "kitchen", label: "주방" }), devices: () => [],
    });
    const person: Detection = det("person", 0.9, [150, 40, 160, 300], 0);
    for (let i = 1; i <= 3; i++) vlmSee(ws, frame(i), [onTable]);
    const { t, decide, last, clock, plans } = setup({ w: () => ws.view(clock.t) });
    clock.t = 3_500;
    await decide({ ...decision, atMs: 0 });
    for (const n of [1, 2, 3]) t.onAnswer("plan:pam-1", `plan:pam-1:${n}`, "done");
    expect(last()).toMatchObject({ step: "plan:pam-1:4" });
    const see = (i: number, dets: Detection[], said: [string, "holding_object" | "in_hand" | "in_sink"][]) => {
      clock.t = i * 1000;
      const { ids } = vlmSee(ws, frame(i), dets);
      ws.applyScene(`e${i}`, i * 1000, { scene: "k", observations: said.map(([object_id, state]) => ({ object_id, state })), summary: "s" }, ids);
      t.onWorld();
      return ids;
    };
    // 사람이 컵을 들고 보인다(VLM 들고 있음, 관절 없음이라 든 것을 모름)
    for (let i = 4; i <= 5; i++) see(i, [person, onTable], [["d1", "holding_object"], ["d2", "in_hand"]]);
    expect(ws.view(5000).person).toMatchObject({ visible: true, facts: { holding: { value: "holding_object" } } });
    // VLM이 컵을 「싱크대 안」이라 답해도 사람이 들고 있으니 넘기지 않는다
    const ids6 = see(6, [person, onTable], [["d1", "holding_object"], ["d2", "in_sink"]]);
    // 다른 놓인 곳은 VLM 사진 2장 이어서(같은 사진 묶음의 다음 VLM 답)
    ws.applyScene("e6b", 6100, { scene: "k", observations: [{ object_id: "d1", state: "holding_object" }, { object_id: "d2", state: "in_sink" }], summary: "s" }, ids6);
    t.onWorld();
    expect(ws.view(6100)).toMatchObject({ frame_ms: 6000, person: { visible: true }, objects: [{ id: "cup_1", facts: { place: { value: "in_sink" } } }] });
    expect(last()).toMatchObject({ step: "plan:pam-1:4" });
    expect(plans.current()).toMatchObject({ status: "running" });
    // 사람이 화면에서 나간다: 사라짐이 확인되기 전(한 장)에는 아직 들고 있는 사람이 있어 넘기지 않는다
    see(7, [onTable], [["d1", "in_sink"]]);
    expect(ws.view(7000).person.visible).toBe(true);
    expect(plans.current()).toMatchObject({ status: "running" });
    // 사람이 안 보이는 프레임(분석한 프레임이 10초 안)이고 컵은 싱크대 안: 「완료」 없이 끝난다
    see(8, [onTable], [["d1", "in_sink"]]);
    expect(ws.view(8000)).toMatchObject({ frame_ms: 8000, person: { visible: false } });
    expect(last()).toEqual({ type: "command_clear", id: "plan:pam-1" });
    expect(plans.current()).toMatchObject({ id: "plan:pam-1", status: "done" });
  });

  it("가까이 봐서 찾은 식탁 위 컵을 들어 옮기면(VLM 손에 있음) 지킴 중인 그 컵으로 이어 집기가 비전으로 넘어간다", async () => {
    const ws = new WorldState({ evidenceStepMs: 1000,
      surfaces: () => [{ id: "table_1", label: "식탁", center: [2, 0], top: 0.75, radius: 0.6 }, { id: "sink_1", label: "싱크대", center: [1.2, 0.8], top: 0.9, radius: 0.5 }],
      floorAt: () => 0, roomAt: () => ({ id: "kitchen", label: "주방" }), devices: () => [],
    });
    const pass = (i: number, d: Detection): CloserPass => ({ frameId: `e${i}`, capturedAtMs: i * 1000, view: look, width: 480, height: 360, dets: [{ ...d, edge: false }] });
    const { ids: closerIds, pending } = ws.applyCloser([1, 2, 3].map((i) => pass(i, onTable)));
    // 가까이 본 VLM이 그 감지(d1)와 같은 물건을 답한다(물건은 VLM 물건으로만 생긴다)
    ws.applyCloserScene("e3", 3000, { scene: "k", objects: [{ id: "v1", cls: "cup", box: { x: 220 / 480, y: 160 / 360, w: 40 / 480, h: 20 / 360 }, det: "d1" }], observations: [{ object_id: "d1", state: "on_table" }], summary: "s" },
      closerIds, pending, { view: look, width: 480, height: 360, crop: [0, 0, 480, 360] });
    expect(ws.view(3000).objects).toEqual([expect.objectContaining({ id: "cup_1", status: "present", closer_hold: true })]);
    const see = (i: number, d: Detection, state: "on_table" | "in_hand" | "in_sink") => {
      const { ids } = vlmSee(ws, frame(i), [d]);
      ws.applyScene(`e${i}`, i * 1000, { scene: "k", observations: [{ object_id: "d1", state }], summary: "s" }, ids);
    };
    const { t, decide, last, clock } = setup({ w: () => ws.view(clock.t) });
    clock.t = 3_500;
    await decide({ ...decision, atMs: 0 });
    t.onAnswer("plan:pam-1", "plan:pam-1:1", "done");
    expect(last()).toMatchObject({ step: "plan:pam-1:2", vision: "컵 · 식탁 위" });
    clock.t = 4000;
    see(4, moved, "in_hand");
    t.onWorld();
    expect(last()).toMatchObject({ step: "plan:pam-1:2" });
    clock.t = 5000;
    see(5, moved, "in_hand");
    expect(ws.view(5000).objects.map((o) => [o.id, o.status, o.closer_hold, o.followed_by])).toEqual([["cup_1", "present", true, null]]);
    t.onWorld();
    expect(last()).toMatchObject({ step: "plan:pam-1:3", vision: "컵 · 손에 있음 · 싱크대까지 거리 모름" });
  });

  it("관절은 물건을 보지 않는다: 손목이 컵 상자 안이어도 VLM 답이 「식탁 위」면 「컵을 들어 주세요」 단계를 넘기지 않고, VLM이 손에 있음을 2장 이어 답하면 넘긴다", async () => {
    const ws = new WorldState({ evidenceStepMs: 1000,
      surfaces: () => [{ id: "table_1", label: "식탁", center: [2, 0], top: 0.75, radius: 0.6 }],
      floorAt: () => 0, roomAt: () => ({ id: "kitchen", label: "주방" }), devices: () => [],
    });
    const person: Detection = det("person", 0.9, [150, 40, 160, 300], 0);
    for (let i = 1; i <= 3; i++) {
      const { ids } = vlmSee(ws, frame(i), [onTable]);
      ws.applyScene(`e${i}`, i * 1000, { scene: "k", observations: [{ object_id: "d1", state: "on_table" }], summary: "s" }, ids);
    }
    const { t, decide, last, clock } = setup({ w: () => ws.view(10_000) });
    clock.t = 3_500;
    await decide({ ...decision, atMs: 0 });
    t.onAnswer("plan:pam-1", "plan:pam-1:1", "done");
    expect(last()).toMatchObject({ step: "plan:pam-1:2", text: STEP_COMMAND.pickCup, vision: "컵 · 식탁 위" });
    const grab = (i: number, wrist: [number, number], state: "on_table" | "in_hand") => {
      const { ids } = vlmSee(ws, frame(i), [person, onTable], { poses: [standing({ 10: [...wrist, 0.9] }, [150, 40, 160, 300])] });
      ws.applyScene(`e${i}`, i * 1000, { scene: "k", observations: [{ object_id: "d2", state }], summary: "s" }, ids);
      t.onWorld();
    };
    grab(4, [160, 300], "on_table"); // 손목이 컵 상자 [220, 160, 40, 20]에서 멀다
    expect(last()).toMatchObject({ step: "plan:pam-1:2", vision: "컵 · 식탁 위" });
    grab(5, [235, 170], "on_table"); // 손목이 컵 상자 안이어도 관절은 물건을 보지 않는다
    expect(ws.view(5000).objects[0]!.facts.place?.value).toBe("on_table");
    expect(last()).toMatchObject({ step: "plan:pam-1:2" });
    // VLM이 손에 있음을 사진 2장 이어 답하면 넘어간다
    grab(6, [235, 170], "in_hand");
    grab(7, [235, 170], "in_hand");
    expect(ws.view(7000).objects[0]!.facts.place?.value).toBe("in_hand");
    expect(last()).toMatchObject({ step: "plan:pam-1:3", text: STEP_COMMAND.goSink, vision: "컵 · 손에 있음 · 싱크대까지 거리 모름" });
  });
});

describe("실행 추적: 계획 밖 가까이 가서 보기(판단 전 보기 B 뒤에도 모를 때)", () => {
  const fact = (value: string) => ({ value, at_ms: 9_000, since_ms: 9_000, certainty: "confirmed" as const });
  const OPAQUE: WorldObject["facts"] = { body: fact("opaque"), contents: fact("contents_unknown") };
  const GUESS: WorldObject["facts"] = { contents: { ...fact("empty"), certainty: "inferred" } };
  const NOONCHI = ["컵 치우기", "사용자에게 물어보기", "세탁물 건조기로 옮기기", "에어컨 켜기", "컵에 물 채워 주기", "컵에 콜라 따라 주기"];
  /** 사람이 보이고(먹는 중) 식탁에 컵 하나가 있는 집. 폰 눈은 컵 [2, 1]에서 1m(eye false면 맞추기 전). looks: 받은 위에서 보기 부탁. */
  function idleSetup(o: { facts?: WorldObject["facts"]; tasks?: string[]; eye?: boolean; person?: boolean; over?: Parameters<typeof setup>[0] } = {}) {
    let facts = o.facts ?? OPAQUE;
    let person = o.person !== false;
    let ready = false;
    const looks: ContentsLook[] = [];
    const guards: [string, boolean][] = [];
    const s = setup({
      w: () => world([{ ...cup("present", "on_table", 9_000), facts: { ...facts, place: fact("on_table") }, contents_gen: 2 }], person ? "eating" : undefined, 9_000),
      tasks: () => o.tasks ?? NOONCHI, topReady: () => ready, guardObject: (id, on) => guards.push([id, on]), lookContents: (h) => { looks.push(h); return true; },
      ...o.over,
    });
    // 맞춘 폰 눈은 tick마다 다시 온다(실제 폰은 초당 10번)
    let eye: [number, number] | null = o.eye === false ? null : [3, 1];
    if (eye) s.t.onEye(eye);
    const tick = (ms = 250) => { s.clock.t += ms; if (eye) s.t.onEye(eye); s.t.tick(); };
    return {
      ...s, looks, guards, tick, set: (f: WorldObject["facts"]) => { facts = f; }, ready: (v: boolean) => { ready = v; }, person: (v: boolean) => { person = v; },
      eye: (p: [number, number]) => { eye = p; s.t.onEye(p); },
    };
  }

  // 636c2c4(관찰 모드의 폰 부탁 없앰) 뒤에도: 내용물을 모르면 폰을 가까이 보내 직접 보는 길은 계획 밖에서 그대로이고, 막는 것은 계획 단계가 도는 동안뿐이다
  it("계획 밖에서는 「컵 가까이 가 주세요」를 보내고, 계획 단계가 도는 동안은 폰 명령이 그 단계 명령뿐이며, 계획이 끝나면 다시 가까이 가서 본다", async () => {
    const s = idleSetup();
    s.tick();
    expect(s.last()).toMatchObject({ id: "peek:1", text: PEEK_TEXT.go("컵") });
    await s.decide(decision);
    const from = s.phone.length;
    for (let i = 0; i < 20; i++) s.tick();
    expect(s.phone.slice(from).filter((m) => m.type === "command").every((m) => String(m.id).startsWith("plan:"))).toBe(true);
    expect(s.t.openCommand()).toMatchObject({ planId: "plan:pam-1", text: "식탁으로 가 주세요" });
    s.heard("그만");
    for (let i = 0; i < 4; i++) s.tick();
    expect(s.commands().at(-1)).toMatchObject({ text: PEEK_TEXT.go("컵") });
    expect(String(s.commands().at(-1)!.id)).toMatch(/^peek:/);
  });

  it("계획이 없고 불투명 컵이면 지금 명령 줄에 「컵 가까이 가 주세요」(id peek:1)를 보내고, 0.5m 안이면 위에서 비춰 달라고 한 뒤 위에서 보기를 부탁한다(계획 id 없음)", () => {
    const s = idleSetup();
    s.tick();
    expect(s.last()).toMatchObject({ type: "command", id: "peek:1", step: "peek:1:peek:cup_1:2:go:1", text: PEEK_TEXT.go("컵"), choices: [], kind: "go", near_m: PEEK.nearM });
    expect(s.t.openCommand()).toMatchObject({ planId: "peek:1", kind: "command", text: PEEK_TEXT.go("컵"), choices: [] });
    s.eye([2.3, 1]);
    s.tick();
    const aboveAt = s.clock.t;
    expect(s.last()).toMatchObject({ id: "peek:1", text: PEEK_TEXT.above("컵"), kind: "do", view: "above" });
    expect(s.guards).toEqual([["cup_1", true]]);
    // 위에서 보는 동안 사람이 안 보여도(폰이 컵을 내려다봄) 거두지 않는다
    s.person(false);
    s.tick();
    expect(s.last()).toMatchObject({ text: PEEK_TEXT.above("컵") });
    s.ready(true);
    s.tick();
    expect(s.last()).toEqual({ type: "command_clear", id: "peek:1" });
    expect(s.looks).toEqual([expect.objectContaining({ planId: "", objectId: "cup_1", top: { sinceMs: aboveAt } })]);
    s.looks[0]!.done();
    expect(s.guards).toEqual([["cup_1", true], ["cup_1", false]]);
    // 확인되면 칸이 비고 다시 보내지 않는다
    s.set({ body: fact("opaque"), contents: fact("empty") });
    for (let i = 0; i < 40; i++) s.tick();
    expect(s.t.openCommand()).toBeNull();
    expect(s.commands().filter((c) => c.id !== "peek:1")).toEqual([]);
  });

  it("내용물 보류의 위에서 비추기·위에서 보기 동안에만 looking()이 참이다(가까이 가기는 아니다)", () => {
    const s = idleSetup();
    s.tick();
    expect(s.last()).toMatchObject({ text: PEEK_TEXT.go("컵") });
    expect(s.t.looking()).toBe(false);
    s.eye([2.3, 1]);
    s.tick();
    expect(s.last()).toMatchObject({ text: PEEK_TEXT.above("컵") });
    expect(s.t.looking()).toBe(true);
    s.ready(true);
    s.tick();
    expect(s.t.looking()).toBe(true);
    s.looks[0]!.done();
    for (let i = 0; i < 40; i++) s.tick();
    expect(s.t.looking()).toBe(false);
  });

  // Codex(22ac514): 보기를 거둔 일시정지 중에도 looking이 참이라 최대 30초 동안 VLM 1초 간격이 이어졌다
  it("계획의 보류가 다른 까닭으로 멈춘 동안(pause)은 looking()이 거짓이다", async () => {
    let held = false;
    const s = setup({
      w: () => world([{ ...cup("present", "on_table", 9_000), facts: held ? { place: { value: "in_hand", at_ms: 9_000, since_ms: 9_000, certainty: "confirmed" } } : {} }]),
      check: () => (held ? { ok: false, reason: "in_hand", text: CHECK_TEXT.in_hand } : { ok: false, reason: "unknown_contents", text: CHECK_TEXT.unknown_contents, object: "cup_1" }),
      lookContents: () => true,
    });
    await s.decide(decision);
    expect(s.t.looking()).toBe(true);   // 잘라 보기
    held = true;
    s.clock.t += 250;
    s.t.tick();
    expect(s.t.looking()).toBe(false);
  });

  it("위에서 본 뒤에도 모르면 기록만 남고(묻지 않음) 그 컵·세대는 60초 동안 다시 가까이 가지 않는다", () => {
    const s = idleSetup({ eye: false });
    s.eye([2.3, 1]);
    s.tick();
    s.ready(true);
    s.tick();
    s.looks[0]!.done();
    for (let i = 0; i < 40; i++) s.tick();
    const n = s.commands().length;
    for (let i = 0; i < 200; i++) s.tick();
    expect(s.commands().slice(n)).toEqual([]);
    expect(s.commands().some((c) => c.text.endsWith("?"))).toBe(false);
    for (let i = 0; i < 60; i++) s.tick(250);
    expect(s.commands().slice(n).map((c) => c.id)).toContain("peek:2");
  });

  it("불투명이 아니면 B가 그 세대에 잘라 본 뒤 4초가 지나야 보낸다", () => {
    const s = idleSetup({ facts: GUESS });
    s.tick();
    expect(s.commands()).toEqual([]);
    s.t.lookedIdle("cup_1");
    s.tick(3_500);
    expect(s.commands()).toEqual([]);
    s.tick(600);
    expect(s.last()).toMatchObject({ text: PEEK_TEXT.go("컵") });
  });

  it("보내지 않는 때: 위치를 맞추기 전, 사람이 안 보임, 목록에 내용물 행동이 없음, 승인 대기, 폰 대화 중, 이미 확인된 컵", () => {
    const cases: Parameters<typeof idleSetup>[0][] = [
      { eye: false }, { person: false }, { tasks: ["라면 끓이기 알려 주기", "사용자에게 물어보기"] },
      { over: { approvalsWaiting: () => true } }, { over: { talking: () => true } }, { facts: { body: fact("opaque"), contents: fact("empty") } },
    ];
    for (const o of cases) {
      const s = idleSetup(o);
      s.tick();
      expect(s.commands()).toEqual([]);
    }
  });

  it("폰 대화가 시작되면 거두고(지우기·보기 지킴 풂), 끝나면 새 번호로 다시 보낸다", () => {
    let talking = false;
    const s = idleSetup({ eye: false, over: { talking: () => talking } });
    s.eye([2.3, 1]);
    s.tick();
    expect(s.last()).toMatchObject({ id: "peek:1", view: "above" });
    talking = true;
    s.tick();
    expect(s.last()).toEqual({ type: "command_clear", id: "peek:1" });
    expect(s.guards).toEqual([["cup_1", true], ["cup_1", false]]);
    talking = false;
    s.tick();
    expect(s.last()).toMatchObject({ id: "peek:2", view: "above" });
  });

  it("계획이 열리면 그 계획이 명령을 보내기 전에 거둔다(지우기 뒤 계획 명령)", async () => {
    const s = idleSetup();
    s.tick();
    expect(s.last()).toMatchObject({ id: "peek:1" });
    await s.decide(decision);
    s.tick();
    const clear = s.phone.findIndex((m) => m.type === "command_clear" && m.id === "peek:1");
    const plan = s.phone.findIndex((m) => m.type === "command" && m.id === "plan:pam-1");
    expect(clear).toBeGreaterThanOrEqual(0);
    expect(clear).toBeLessThan(plan);
    expect(s.last()).toMatchObject({ id: "plan:pam-1" });
    expect(s.t.openCommand()).toMatchObject({ planId: "plan:pam-1" });
  });

  it("같은 컵을 붙잡은 새 계획이 위에서 비추기를 보내면, 계획 밖 정리가 그 계획의 보기 지킴을 풀지 않는다", async () => {
    const s = idleSetup({ eye: false, over: { check: () => ({ ok: false, reason: "unknown_contents", text: CHECK_TEXT.unknown_contents, object: "cup_1" }) } });
    s.eye([2.3, 1]);
    s.tick();
    expect(s.last()).toMatchObject({ id: "peek:1", view: "above" });
    await s.decide(decision);
    for (let i = 0; i < 8; i++) s.tick();
    expect(s.last()).toMatchObject({ id: "plan:pam-1", view: "above" });
    expect(s.guards.at(-1)).toEqual(["cup_1", true]);
  });

  it("위에서 보는 중(명령을 거둔 뒤)에도 「그만」이면 계획 밖 가까이 가서 보기를 그만두고 60초 쉰다", () => {
    const s = idleSetup({ eye: false });
    s.eye([2.3, 1]);
    s.tick();
    s.ready(true);
    s.tick();
    expect(s.looks).toHaveLength(1);
    expect(s.heard("그만해")?.id).toBe("stop");
    expect(s.looks[0]!.signal.aborted).toBe(true);
    const n = s.commands().length;
    for (let i = 0; i < 200; i++) s.tick();
    expect(s.commands().slice(n)).toEqual([]);
  });

  it("계획을 만드는 중(다음 tick 전)에 「그만」이 오면 계획 만들기와 함께 계획 밖 가까이 가서 보기도 거두고 60초 쉰다", async () => {
    const s = idleSetup();
    s.tick();
    expect(s.last()).toMatchObject({ id: "peek:1" });
    s.t.onDecision(decision);
    expect(s.heard("그만해")?.id).toBe("stop");
    await s.t.idle();
    expect(s.phone.some((m) => m.type === "command_clear" && m.id === "peek:1")).toBe(true);
    const n = s.commands().length;
    for (let i = 0; i < 200; i++) s.tick();
    expect(s.commands().slice(n)).toEqual([]);
  });

  it("가까이 가기(go) 도중 사람이 안 보이면 거둔다. 위에서 비추는 동안은 안 보여도 잇는다", () => {
    const s = idleSetup();
    s.tick();
    expect(s.last()).toMatchObject({ id: "peek:1", kind: "go" });
    s.person(false);
    s.tick();
    expect(s.last()).toEqual({ type: "command_clear", id: "peek:1" });
  });

  it("「그만」이면 거두고 그 컵은 60초 동안 다시 보내지 않는다", () => {
    const s = idleSetup();
    s.tick();
    expect(s.heard("그만해")?.id).toBe("stop");
    expect(s.last()).toEqual({ type: "command_clear", id: "peek:1" });
    for (let i = 0; i < 40; i++) s.tick();
    expect(s.commands().filter((c) => c.id !== "peek:1")).toEqual([]);
  });
});

describe("실행 추적: 안 보이는 대상은 마지막으로 본 자리로 가서 다시 본다(계획 전 찾기)", () => {
  // 식탁 위 후보 자리 [2, 0.75, 1]. 폰 눈은 처음에 [6, 1](4m 밖)
  const SPOT: [number, number, number] = [2, 0.75, 1];
  const sighting = (at_ms = 9_000, label: string | null = "식탁"): NonNullable<WorldView["sightings"]>[number] =>
    ({ cls: "cup", position: SPOT, surface: label ? "t" : null, surface_label: label, at_ms, in_hand: false });
  const found = (id: string, at: [number, number, number], seen: number): WorldObject => ({ ...cup("present", "on_table", seen), id, position: at });
  const TASKS_ALL = ["컵 치우기", "사용자에게 물어보기", "컵에 물 채워 주기"];
  /** 가까이 보기가 새 사진으로 보고 VLM도 답했는데 찾은 것이 없다(분명히 없음). */
  const ABSENT: CloserResult = { ok: true, frame_id: "e9.c1", captured_at_ms: 9_000, crop: [0, 0, 10, 10], frames: 5, found: [], summary: "s", vlm: "ok" };
  function findSetup(o: { objects?: WorldObject[]; sightings?: WorldView["sightings"] | null; person?: string; over?: Parameters<typeof setup>[0] } = {}) {
    let objects = o.objects ?? [];
    let sightings: WorldView["sightings"] | null = o.sightings === undefined ? [sighting()] : o.sightings;
    let ready = false;
    let took = true;
    const looks: ContentsLook[] = [];
    const guards: [string, boolean][] = [];
    const asked: [number[], number][] = [];
    let person = o.person;
    const w = (): WorldView => ({ ...world(objects, person), ...(sightings ? { sightings } : {}) });
    const s = setup({
      w, precheck: (d) => checkDecision({ decision: d, tasks: TASKS_ALL, world: w() }),
      spotReady: (at, since) => { asked.push([at, since]); return ready; },
      lookContents: (h) => { if (!took) return false; looks.push(h); return true; }, guardObject: (id, on) => guards.push([id, on]), ...o.over,
    });
    let eye: [number, number] = [6, 1];
    s.t.onEye(eye);
    const tick = (ms = 250) => { s.clock.t += ms; s.t.onEye(eye); s.t.tick(); };
    return {
      ...s, looks, guards, asked, tick,
      ready: (v: boolean) => { ready = v; }, took: (v: boolean) => { took = v; }, eye: (p: [number, number]) => { eye = p; s.t.onEye(p); },
      objects: (x: WorldObject[]) => { objects = x; }, sightings: (x: WorldView["sightings"] | null) => { sightings = x; }, person: (v?: string) => { person = v; },
    };
  }
  /** 가까이 가서(1m 안) 비춘 뒤 그 자리 사진이 모여 가까이 보기를 부탁한 데까지. */
  function toLook(s: ReturnType<typeof findSetup>) {
    s.eye([2.6, 1]);
    s.tick();
    s.ready(true);
    s.tick();
    expect(s.looks).toHaveLength(1);
  }

  it("컵 치우기 판단에 확인된 컵이 없고 식탁 위 후보 자리가 있으면 실패 없이 「컵을 찾으러 가요」와 「식탁으로 가 주세요」(go 1.0m, 대상 = 그 자리, 단추 없음)", async () => {
    const s = findSetup();
    await s.decide(decision);
    expect(s.exec().map((l) => [l.plan_id, l.state, l.text])).toEqual([["plan:pam-1", "decided", "컵을 찾으러 가요"]]);
    expect(s.last()).toMatchObject({
      type: "command", id: "find:1", step: "find:1:go:1", text: "식탁으로 가 주세요", kind: "go", near_m: 1, choices: [], speak: true,
      target: { id: "find_cup", label: "식탁", position: SPOT },
    });
    expect(s.t.openCommand()).toMatchObject({ planId: "find:1", kind: "command", text: "식탁으로 가 주세요", choices: [] });
  });

  // 가로 유리컵 실제 판 r2(2026-11-18): 가까이 본 VLM이 유리컵을 병으로 답했다
  it("가까이 보기가 그 자리에서 마시는 그릇 무리의 다른 종류(병)를 찾았으면 「분명히 없음」이 아니다. 그 자리 0.1m 안 병으로 찾으면 다시 판단하고, 컵이 없어 막히면 그 자리를 다시 찾지 않고 닫는다", async () => {
    const s = findSetup();
    await s.decide(decision);
    toLook(s);
    // 비추기 뒤 사진만 가까이 본다(비추기를 보낸 시각)
    expect(s.looks[0]!.since).toBeTypeOf("number");
    s.looks[0]!.done({ ...ABSENT, found: [{ id: "bottle_2", cls: "bottle", score: 0, facts: [], via: "vlm" }] });
    s.tick();
    expect(s.exec().some((l) => l.state === "failed")).toBe(false);
    s.sightings(null);
    s.objects([{ ...found("bottle_2", [2.05, 0.75, 1], s.clock.t), cls: "bottle" }]);
    s.tick();
    expect(s.exec().at(-1)).toMatchObject({ plan_id: "plan:pam-1", state: "failed", text: CHECK_TEXT.no_target });
    s.sightings([sighting(s.clock.t)]);
    await s.decide({ ...decision, id: "pam-2", seq: 2, atMs: s.clock.t });
    expect(s.commands().filter((c) => c.id.startsWith("find:")).map((c) => c.id)).not.toContain("find:2");
  });

  it("자리 이름은 계획 단계와 같은 평면도 이름을 쓴다(World State 면 이름 「거실·복도 식탁」이 아니라 「식탁」)", async () => {
    const s = findSetup({ sightings: [{ ...sighting(), surface: "table_1", surface_label: "거실·복도 식탁" }] });
    await s.decide(decision);
    expect(s.last()).toMatchObject({ text: "식탁으로 가 주세요", target: { label: "식탁" }, vision: expect.stringMatching(/^식탁까지 /) });
  });

  // 2026-11-19 조정자 결정: 분명한 까닭(싱크대 안·내용물 반대)으로 막으면 판단의 화살표를 풀게 알린다(onRefused). 모름(대상이 안 보임·찾을 후보가 남음)은 지금처럼 기다린다
  it("계획 전 검사가 분명한 까닭으로 막으면(찾을 후보 없는 싱크대 안·확인된 내용물 반대) 그 판단을 onRefused로 알리고, 대상이 안 보임·찾을 후보가 남은 싱크대 안은 알리지 않는다", async () => {
    const inSink = { ...cup("present", "in_sink", 9_000), surface: "sink_1", surface_label: "싱크대" };
    const refusedOf = async (o: Parameters<typeof findSetup>[0], first?: DecisionRecord) => {
      const refused: string[] = [];
      const s = findSetup({ ...o, over: { onRefused: (id) => refused.push(id) } });
      if (first) await s.decide(first);
      await s.decide({ ...decision, id: "pam-2", seq: 2 });
      return { s, refused };
    };
    const sink = await refusedOf({ objects: [inSink], sightings: null });
    expect(sink.s.exec().at(-1)).toMatchObject({ plan_id: "plan:pam-2", state: "failed", text: CHECK_TEXT.in_sink });
    expect(sink.refused).toEqual(["plan:pam-2"]);
    // 찾을 후보 자리가 남았는데 다른 계획이 열려 있어 찾기를 시작하지 못한 싱크대 안: 아직 모름
    const candidate = await refusedOf({ objects: [inSink] }, ask("pam-1", 1));
    expect(candidate.s.exec().at(-1)).toMatchObject({ plan_id: "plan:pam-2", state: "failed", text: CHECK_TEXT.in_sink });
    expect(candidate.refused).toEqual([]);
    const unseen = await refusedOf({ objects: [], sightings: null });
    expect(unseen.s.exec().at(-1)).toMatchObject({ plan_id: "plan:pam-2", state: "failed", text: CHECK_TEXT.no_target });
    expect(unseen.refused).toEqual([]);
    const full: WorldObject = { ...cup("present", "on_table", 9_000), facts: { place: { value: "on_table", at_ms: 9_000, since_ms: 9_000, certainty: "confirmed" }, contents: { value: "has_contents", at_ms: 9_000, since_ms: 9_000, certainty: "confirmed" } } };
    const refill: string[] = [];
    const f = findSetup({ objects: [full], sightings: null, over: { onRefused: (id) => refill.push(id) } });
    await f.decide({ ...decision, id: "pam-3", seq: 3, action: "컵에 물 채워 주기" });
    expect(f.exec().at(-1)).toMatchObject({ plan_id: "plan:pam-3", state: "failed", text: CHECK_TEXT.contents_mismatch });
    expect(refill).toEqual(["plan:pam-3"]);
  });

  // Codex(1b07d3e2 P2): 말 부탁이 계획 전 찾기 중이면 보호 대상에서 빠져, 부탁 전에 보낸 요청의 PAM 답이 찾기를 다른 계획으로 갈아 치웠다
  it("말 부탁이 계획 전 찾기 중이어도 그 부탁 전에 보낸 요청의 PAM 판단은 늦은 답으로 기록만 하고 찾기를 바꾸지 않는다. 뒤에 보낸 요청의 판단은 받는다", async () => {
    const s = findSetup();
    s.t.onRequest({ task: "컵 치우기", heard: "컵 치워 줘", atMs: s.clock.t, afterSeq: 3 });
    await s.t.idle();
    const say = s.decisions().find((d) => d.source === "speech")!;
    expect(s.exec().at(-1)).toMatchObject({ plan_id: `plan:${say.id}`, state: "decided", text: "컵을 찾으러 가요" });
    expect(s.last()).toMatchObject({ id: "find:1", text: "식탁으로 가 주세요" });
    await s.decide({ ...ask("pam-3", 3), atMs: s.clock.t });
    expect(s.exec().at(-1)).toMatchObject({ plan_id: "plan:pam-3", text: EXEC_TEXT.late });
    expect(s.t.openCommand()).toMatchObject({ planId: "find:1", text: "식탁으로 가 주세요" });
    expect(s.plans.current()).toBeNull();
    await s.decide({ ...decision, id: "pam-4", seq: 4, atMs: s.clock.t });
    expect(s.exec().at(-1)).toMatchObject({ plan_id: "plan:pam-4", text: EXEC_TEXT.findingSame("컵") });
  });

  // Codex(c5d3e6a): 다른 계획이 진행 중이거나 승인 질문 중이어도 계획 전 찾기를 시작해 그 계획의 폰 줄을 찾기 명령이 덮었다
  it("다른 계획이 열려 있으면(질문 중 포함) 계획 전 찾기를 시작하지 않고 지금처럼 닫는다: 그 계획의 폰 줄을 덮지 않는다", async () => {
    const s = findSetup();
    await s.decide(ask("pam-1", 1));
    const shown = s.last();
    expect(shown).toMatchObject({ id: "plan:pam-1" });
    await s.decide({ ...decision, id: "pam-2", seq: 2 });
    expect(s.exec().at(-1)).toMatchObject({ plan_id: "plan:pam-2", state: "failed", text: CHECK_TEXT.no_target });
    expect(s.last()).toEqual(shown);
    s.tick();
    expect(s.commands().some((c) => c.id.startsWith("find:"))).toBe(false);
  });

  it("사람이 컵을 쓰는 중이면(그 컵·무엇인지 모르는 물건을 듦, 그 자리를 손에 든 채 봄: 쓰는 중 지킴) 찾지 않는다. 사람이 안 보이면 찾는다", async () => {
    const holding = findSetup({ person: "holding_object" });
    await holding.decide(decision);
    expect(holding.exec().at(-1)).toMatchObject({ state: "failed", text: CHECK_TEXT.no_target });
    expect(holding.commands()).toEqual([]);
    const inHand = findSetup({ person: "standing", sightings: [{ ...sighting(), in_hand: true }] });
    await inHand.decide(decision);
    expect(inHand.commands()).toEqual([]);
    // 사람이 안 보이면 손에 든 채 본 자리라도 마지막으로 본 자리로 간다
    const gone = findSetup({ sightings: [{ ...sighting(), in_hand: true }] });
    await gone.decide(decision);
    expect(gone.last()).toMatchObject({ id: "find:1" });
  });

  it("찾는 중에 사람이 나타나 무엇인지 모르는 물건(컵일 수 있음)을 들면 찾기 명령을 거두고, 사람이 사라지면 다시 보낸다", async () => {
    const s = findSetup();
    await s.decide(decision);
    expect(s.last()).toMatchObject({ id: "find:1", text: "식탁으로 가 주세요" });
    s.person("holding_object");
    s.tick();
    expect(s.last()).toEqual({ type: "command_clear", id: "find:1" });
    for (let i = 0; i < 8; i++) s.tick();
    expect(s.last()).toEqual({ type: "command_clear", id: "find:1" });
    s.person(undefined);
    s.tick();
    expect(s.last()).toMatchObject({ id: "find:1", text: "식탁으로 가 주세요", speak: true });
  });

  it("싱크대에 치운 컵이 따로 있어 계획 전 검사가 in_sink로 막아도 후보 자리가 있으면 찾으러 간다", async () => {
    const inSink = { ...cup("present", "in_sink", 9_500), id: "cup_9", position: [5, 0.9, 1] as [number, number, number] };
    const s = findSetup({ objects: [inSink] });
    await s.decide(decision);
    expect(s.last()).toMatchObject({ id: "find:1", text: "식탁으로 가 주세요" });
  });

  it("1m 안이면 「식탁 위를 비춰 주세요」(do, 대상 = 그 자리). 비춘 뒤 사진으로 그 자리를 볼 수 있으면 명령을 거두고 그 자리를 다시 가까이 본다(force)", async () => {
    const s = findSetup();
    await s.decide(decision);
    s.eye([2.6, 1]);
    s.tick();
    const aimAt = s.clock.t;
    expect(s.last()).toMatchObject({ id: "find:1", step: "find:1:aim:2", text: "식탁 위를 비춰 주세요", kind: "do", target: { id: "find_cup", label: "식탁", position: SPOT } });
    expect(s.last().near_m).toBeUndefined();
    s.tick();
    expect(s.asked.at(-1)).toEqual([SPOT, aimAt]);
    s.ready(true);
    s.tick();
    expect(s.last()).toEqual({ type: "command_clear", id: "find:1" });
    expect(s.looks).toEqual([expect.objectContaining({ planId: "", objectId: "find_cup", spot: { id: "find_cup", label: "식탁", position: SPOT }, force: true })]);
  });

  it("생각 말풍선에 찾기 상태를 쌓는다: 시작하면 「컵이 안 보여서 식탁 쪽을 다시 볼게요」, 찾으면 「컵을 찾았어요」, 못 찾으면 「컵을 못 찾았어요」", async () => {
    const said: [string, string][] = [];
    const s = findSetup({ over: { thought: (text, id) => said.push([text, id]) } });
    await s.decide(decision);
    expect(said).toEqual([["컵이 안 보여서 식탁 쪽을 다시 볼게요", "pam-1"]]);
    toLook(s);
    s.objects([found("cup_3", [2.2, 0.75, 1], s.clock.t)]);
    s.tick();
    await s.t.idle();
    expect(said.at(-1)).toEqual(["컵을 찾았어요", "pam-1"]);
    const lost: [string, string][] = [];
    const l = findSetup({ sightings: [sighting(9_000, null)], over: { thought: (text, id) => lost.push([text, id]) } });
    await l.decide(decision);
    expect(lost).toEqual([["컵이 안 보여서 컵 있던 곳을 다시 볼게요", "pam-1"]]);
    toLook(l);
    l.looks[0]!.done();
    l.tick(4_100);
    expect(lost.at(-1)).toEqual(["컵을 못 찾았어요", "pam-1"]);
    for (const [text] of [...said, ...lost]) expect(text).not.toMatch(/[.?]$/);
  });

  it("처음부터 1m 안이면 가기 없이 비추기부터, 면이 없는 자리는 「컵 있던 곳…」", async () => {
    const s = findSetup({ sightings: [sighting(9_000, null)] });
    s.eye([2.5, 1]);
    await s.decide(decision);
    expect(s.commands().map((c) => c.text)).toEqual(["컵 있던 곳을 비춰 주세요"]);
    const far = findSetup({ sightings: [sighting(9_000, null)] });
    await far.decide(decision);
    expect(far.last()).toMatchObject({ text: "컵 있던 곳으로 가 주세요" });
  });

  it("기다리는 중 그 자리 0.5m 안에 컵이 10초 안에 보이면 사진 기다림 전에 바로, 찾는 동안 받은 같은 행동의 가장 새 판단으로 계획을 만든다", async () => {
    const s = findSetup();
    await s.decide(decision);
    await s.decide({ ...decision, id: "pam-2", seq: 2 });
    expect(s.exec().at(-1)).toMatchObject({ plan_id: "plan:pam-2", state: "decided", text: "컵을 찾는 중이에요" });
    toLook(s);
    s.objects([found("cup_3", [2.2, 0.75, 1], s.clock.t)]);
    s.tick();
    await s.t.idle();
    expect(s.exec().filter((l) => l.state === "planned").map((l) => l.plan_id)).toContain("plan:pam-2");
    expect(s.exec().some((l) => l.state === "failed")).toBe(false);
    expect(s.commands().at(-1)).toMatchObject({ id: "plan:pam-2" });
  });

  // Codex(3672313): 계획 전 찾기에서 찾은 뒤 만든 계획은 findHeld가 없어, 폰 대화·승인 대기가 남아도 첫 명령을 바로 보냈다
  it("계획 전 찾기에서 찾은 뒤 만든 계획도 폰 대화·승인 대기가 있으면 첫 명령을 미루고, 풀리면 보낸다", async () => {
    let talking = false;
    const s = findSetup({ over: { talking: () => talking } });
    await s.decide(decision);
    toLook(s);
    talking = true;
    s.objects([found("cup_3", [2.2, 0.75, 1], s.clock.t)]);
    s.tick();
    await s.t.idle();
    expect(s.exec().some((l) => l.plan_id === "plan:pam-1" && l.state === "planned")).toBe(true);
    s.objects([found("cup_3", [2.2, 0.75, 1], s.clock.t + 250)]);
    s.tick();
    expect(s.commands().some((c) => c.id === "plan:pam-1")).toBe(false);
    talking = false;
    s.objects([found("cup_3", [2.2, 0.75, 1], s.clock.t + 250)]);
    s.tick();
    expect(s.commands().at(-1)).toMatchObject({ id: "plan:pam-1" });
  });

  it("0.5m 안 컵 둘이 0.1m 안으로 붙어 있으면 아직 찾은 것이 아니다", async () => {
    const s = findSetup();
    await s.decide(decision);
    toLook(s);
    s.objects([found("cup_3", [2.2, 0.75, 1], s.clock.t), found("cup_4", [2.25, 0.75, 1], s.clock.t)]);
    s.tick();
    await s.t.idle();
    expect(s.exec().some((l) => l.state === "planned")).toBe(false);
  });

  // 가로 키 큰 컵 실제 판 r1(2026-11-18): 비추기 뒤 1장만 보는 가까이 보기가 한 번 「찾은 것 없음」이면 바로 계획이 실패했다
  it("가까이 보기가 새 사진으로 보고 VLM도 답했는데 그 종류가 없으면(분명히 없음), 첫 번은 확인 실패로 보고 다시 비춰 한 번 더 보고, 두 번째도 없으면 「대상 물건이 보이지 않아 실행하지 않아요」로 닫는다. 60초 안 같은 판단은 찾으러 가지 않고 바로 닫는다", async () => {
    const s = findSetup();
    await s.decide(decision);
    toLook(s);
    s.looks[0]!.done(ABSENT);
    s.tick();
    expect(s.exec().some((l) => l.state === "failed")).toBe(false);
    for (let i = 0; i < 60 && s.looks.length < 2; i++) s.tick();
    expect(s.looks).toHaveLength(2);
    s.looks[1]!.done(ABSENT);
    s.tick();
    expect(s.exec().at(-1)).toMatchObject({ plan_id: "plan:pam-1", state: "failed", text: CHECK_TEXT.no_target });
    const n = s.commands().length;
    await s.decide({ ...decision, id: "pam-3", seq: 3 });
    expect(s.exec().at(-1)).toMatchObject({ plan_id: "plan:pam-3", state: "failed", text: CHECK_TEXT.no_target });
    expect(s.commands().length).toBe(n);
    s.clock.t += FIND.retryMs;
    await s.decide({ ...decision, id: "pam-4", seq: 4 });
    expect(s.exec().at(-1)).toMatchObject({ plan_id: "plan:pam-4", state: "decided", text: "컵을 찾으러 가요" });
  });

  it("비춘 사진에 그 자리가 30초 안에 들어오지 않으면(영상 모드에서 자리가 영상 화면 밖일 때) 비추기 한도로 닫고 그 자리를 쉰다", async () => {
    const s = findSetup();
    await s.decide(decision);
    s.eye([2.6, 1]);
    s.tick();
    expect(s.last()).toMatchObject({ text: "식탁 위를 비춰 주세요" });
    for (let i = 0; i < 29; i++) s.tick(1000);
    expect(s.exec().some((l) => l.state === "failed")).toBe(false);
    s.tick(1_250);
    expect(s.exec().at(-1)).toMatchObject({ plan_id: "plan:pam-1", state: "failed", text: CHECK_TEXT.no_target });
    expect(s.last()).toEqual({ type: "command_clear", id: "find:1" });
    expect(s.looks).toEqual([]);
  });

  // Codex(edf045c): 결과가 ok이기만 하면 「없음」으로 보아, 컵을 감지했지만 VLM 실패로 확정하지 못한 때도 바로 닫고 60초 쉬었다
  it("가까이 보기가 확인에 실패했으면(사진 모자람·그 종류를 감지했지만 VLM 답 없음) 사진을 4초 기다린 뒤 닫지 않고 다시 비춰 본다(전체 기한 안)", async () => {
    for (const unsure of [
      { ok: false as const, why: "no_fresh_frames" as const },
      { ...ABSENT, found: [{ id: null, cls: "cup" as const, score: 0.6, facts: [] }], vlm: "vlm_busy" as const },
    ]) {
      const s = findSetup();
      await s.decide(decision);
      toLook(s);
      s.looks[0]!.done(unsure as CloserResult);
      s.ready(false);
      s.tick(3_900);
      expect(s.exec().some((l) => l.state === "failed")).toBe(false);
      s.tick(200);
      expect(s.exec().some((l) => l.state === "failed")).toBe(false);
      expect(s.last()).toMatchObject({ id: "find:1", text: "식탁 위를 비춰 주세요" });
    }
  });

  it("가까이 보는 차례(비추기·가까이 보기·사진 기다림)에만 looking()이 참이다(관찰 흐름이 그동안 VLM 사진 간격을 1초로 줄인다)", async () => {
    const s = findSetup();
    await s.decide(decision);
    expect(s.t.looking()).toBe(false);   // 가기
    s.eye([2.6, 1]);
    s.tick();
    expect(s.t.looking()).toBe(true);    // 비추기
    s.ready(true);
    s.tick();
    expect(s.t.looking()).toBe(true);    // 가까이 보기
    s.looks[0]!.done(ABSENT);
    s.tick();
    // 첫 「분명히 없음」은 다시 본다(사진 기다림도 가까이 보는 차례)
    expect(s.t.looking()).toBe(true);
    for (let i = 0; i < 60 && s.looks.length < 2; i++) s.tick();
    s.looks[1]!.done(ABSENT);
    s.tick();
    expect(s.exec().at(-1)).toMatchObject({ state: "failed" });
    expect(s.t.looking()).toBe(false);   // 끝
  });

  it("보기 담당이 바쁘면 3초 뒤 다시 부탁한다", async () => {
    const s = findSetup();
    await s.decide(decision);
    s.took(false);
    s.eye([2.6, 1]);
    s.tick();
    s.ready(true);
    s.tick();
    expect(s.looks).toEqual([]);
    s.took(true);
    s.tick(2_000);
    expect(s.looks).toEqual([]);
    s.tick(1_100);
    expect(s.looks).toHaveLength(1);
  });

  it("다른 행동의 계획을 받으면 찾기를 거둔다(지우기 뒤 계획 명령)", async () => {
    const s = findSetup();
    await s.decide(decision);
    await s.decide(ask("pam-2", 2));
    const clearAt = s.phone.findIndex((m) => m.type === "command_clear" && m.id === "find:1");
    const planAt = s.phone.findIndex((m) => m.type === "command" && m.id === "plan:pam-2");
    expect(clearAt).toBeGreaterThan(-1);
    expect(planAt).toBeGreaterThan(clearAt);
    expect(s.exec().find((l) => l.plan_id === "plan:pam-1" && l.state === "failed")).toMatchObject({ text: EXEC_TEXT.superseded });
    s.tick();
    expect(s.commands().filter((c) => c.id === "find:1")).toHaveLength(1);
  });

  it("폰 대화면 거두고 풀리면 새 단계 id로 다시 보낸다. 막힌 채 30초면 닫는다", async () => {
    let talking = false;
    const s = findSetup({ over: { talking: () => talking } });
    await s.decide(decision);
    talking = true;
    s.tick();
    expect(s.last()).toEqual({ type: "command_clear", id: "find:1" });
    talking = false;
    s.tick();
    expect(s.last()).toMatchObject({ id: "find:1", step: "find:1:go:2", text: "식탁으로 가 주세요" });
    talking = true;
    s.tick();
    for (let i = 0; i < 31; i++) s.tick(1000);
    expect(s.exec().at(-1)).toMatchObject({ plan_id: "plan:pam-1", state: "failed", text: CHECK_TEXT.no_target });
  });

  it("「그만」이면 거두고 그 자리를 60초 쉰다", async () => {
    const s = findSetup();
    await s.decide(decision);
    expect(s.heard("그만")).toMatchObject({ id: "stop" });
    expect(s.last()).toEqual({ type: "command_clear", id: "find:1" });
    expect(s.exec().at(-1)).toMatchObject({ plan_id: "plan:pam-1", state: "failed", text: EXEC_TEXT.stopped });
    await s.decide({ ...decision, id: "pam-2", seq: 2 });
    expect(s.exec().at(-1)).toMatchObject({ plan_id: "plan:pam-2", state: "failed", text: CHECK_TEXT.no_target });
  });

  it("후보 자리가 없으면 지금처럼 바로 닫는다", async () => {
    const s = findSetup({ sightings: null });
    await s.decide(decision);
    expect(s.exec().map((l) => [l.state, l.text])).toEqual([["decided", "판단"], ["failed", CHECK_TEXT.no_target]]);
    expect(s.commands()).toEqual([]);
  });

  it("찾기 시작부터 60초가 지나면 낡은 발견을 되풀이하는 중이어도 닫힌다(다시 비추기로 명령 한도가 새로 시작돼도)", async () => {
    const s = findSetup();
    await s.decide(decision);
    const started = s.clock.t;
    s.eye([2.6, 1]);
    let reaims = 0;
    for (let i = 0; i < 10 && !s.exec().some((l) => l.state === "failed"); i++) {
      s.ready(false);
      s.tick();   // 비추기(두 번째부터는 다시 비추기)
      if (s.last().type === "command" && s.last().text === "식탁 위를 비춰 주세요" && i > 0) reaims++;
      const aimAt = s.clock.t;
      s.tick(9_000);
      s.ready(true);
      s.tick();   // 가까이 보기 부탁
      s.clock.t += 3_000;
      // 가까이 보기가 비추기 뒤 사진에서 컵을 찾았지만 그 사진이 10초 넘게 옛것이다(계획 전 기준 10초)
      s.objects([found("cup_3", [2.1, 0.75, 1], aimAt + 500)]);
      s.looks.at(-1)?.done();
    }
    expect(reaims).toBeGreaterThanOrEqual(3);
    const closed = s.exec().find((l) => l.state === "failed")!;
    expect(closed).toMatchObject({ plan_id: "plan:pam-1", text: CHECK_TEXT.no_target });
    expect(closed.at_ms - started).toBeGreaterThan(FIND.totalMs);
    expect(closed.at_ms - started).toBeLessThanOrEqual(FIND.totalMs + 9_250);
  });

  it("명령 글은 모두 「주세요」로 끝나고 질문이 없다", async () => {
    const s = findSetup({ sightings: [sighting(9_000, null)] });
    await s.decide(decision);
    s.eye([2.6, 1]);
    s.tick();
    const texts = [...new Set(s.commands().map((c) => c.text))];
    expect(texts).toEqual(["컵 있던 곳으로 가 주세요", "컵 있던 곳을 비춰 주세요"]);
    for (const t of texts) expect(t.endsWith("주세요") && !t.includes("?")).toBe(true);
  });
});

describe("실행 추적: 계획 대상이 안 보이면 그 마지막 자리에서 찾는다(실행 전 찾기)", () => {
  // 판단 8초, 계획을 받는 때 10초. 컵 cup_1 자리 [2, 0.75, 1], 폰 눈은 처음에 [6, 1](4m 밖). 실행 전 검사는 실제 checkPlan(낡음 3초)
  const AT: [number, number, number] = [2, 0.75, 1];
  const CUP_TASKS = ["컵 치우기", "사용자에게 물어보기"];
  function runSetup(o: { objects: WorldObject[]; over?: Parameters<typeof setup>[0] }) {
    let objects = o.objects;
    let ready = false;
    const looks: ContentsLook[] = [];
    const guards: [string, boolean][] = [];
    const w = (): WorldView => ({ ...world(objects), at_ms: 0 });
    let s: ReturnType<typeof setup>;
    s = setup({
      w, staleMs: 3000,
      check: ((d, p) => checkPlan({ decision: d, tasks: CUP_TASKS, plan: p, world: w(), nowMs: s.clock.t, staleMs: 3000, mode: "test", placed: s.t.placed() })) as TrackerFixture["check"] as () => CheckResult,
      spotReady: () => ready, lookContents: (h) => { looks.push(h); return true; }, guardObject: (id, on) => guards.push([id, on]), ...o.over,
    });
    let eye: [number, number] = [6, 1];
    s.t.onEye(eye);
    const tick = (ms = 250) => { s.clock.t += ms; s.t.onEye(eye); s.t.tick(); };
    return {
      ...s, looks, guards, tick, ready: (v: boolean) => { ready = v; }, eye: (p: [number, number]) => { eye = p; s.t.onEye(p); },
      objects: (x: WorldObject[]) => { objects = x; },
    };
  }
  const seenAt = (ms: number, id = "cup_1", at: [number, number, number] = AT): WorldObject => ({ ...cup("present", "on_table", ms), id, position: at });
  /** 계획을 받고 실행 전 검사를 다시 보는 3초(recheckMs) 동안 막힌 채 둔다: 그 뒤에야 찾기를 시작한다. */
  async function blocked(s: ReturnType<typeof runSetup>) {
    await s.decide(decision);
    expect(s.commands()).toEqual([]);
    for (let i = 0; i < 11; i++) s.tick();
    expect(s.commands()).toEqual([]);
    s.tick();
  }

  it("계획 대상 컵을 5초 전에 마지막으로 봤고 실행 전 검사를 다시 보는 3초에도 못 보면 닫지 않고 붙잡아 그 자리로 가기 명령(계획 명령 줄, 단추 없음)을 보내고 보기 지킴을 건다", async () => {
    const s = runSetup({ objects: [seenAt(5_000)] });
    await blocked(s);
    expect(s.exec().some((l) => l.state === "failed")).toBe(false);
    expect(s.last()).toMatchObject({
      type: "command", id: "plan:pam-1", step: "plan:pam-1:find:cup_1:go:1", text: "식탁으로 가 주세요", kind: "go", near_m: FIND.nearM, choices: [],
      target: { id: "cup_1", label: "식탁", position: AT },
    });
    expect(s.t.openCommand()).toMatchObject({ planId: "plan:pam-1", kind: "command", text: "식탁으로 가 주세요", choices: [] });
    expect(s.guards).toEqual([["cup_1", true]]);
    for (let i = 0; i < 20; i++) s.tick();   // 다시 보기 기한(3초)을 세지 않는다
    expect(s.exec().some((l) => l.state === "failed")).toBe(false);
  });

  // Codex(d2a34f4): 실행 전 검사는 판단 뒤 다시 못 본 컵을 낡음으로 막는데 찾을 자리는 3초 안이면 없다고 해 판단 바로 전에 본 컵을 찾지 않았다
  it("판단 바로 전에 본 컵(3초 안이지만 판단 뒤 다시 못 봄)도 3초 동안 다시 못 보면 찾는다", async () => {
    const s = runSetup({ objects: [seenAt(7_500)] });
    await blocked(s);
    expect(s.last()).toMatchObject({ id: "plan:pam-1", step: "plan:pam-1:find:cup_1:go:1", text: "식탁으로 가 주세요" });
  });

  it("생각 말풍선에 찾기 상태를 쌓는다(계획 판단 id): 시작·못 찾음", async () => {
    const said: [string, string][] = [];
    const s = runSetup({ objects: [seenAt(5_000)], over: { thought: (text, id) => said.push([text, id]) } });
    await blocked(s);
    expect(said).toEqual([["컵이 안 보여서 식탁 쪽을 다시 볼게요", "pam-1"]]);
    s.eye([2.6, 1]);
    s.tick();
    s.ready(true);
    s.tick();
    s.looks[0]!.done();
    s.tick(4_100);
    expect(said.at(-1)).toEqual(["컵을 못 찾았어요", "pam-1"]);
  });

  // Codex(c5d3e6a): 실행 전 찾기 중 폰 대화·승인 대기가 생기고 컵이 다시 보이면 내용물 보류와 달리 첫 명령을 바로 보냈다
  it("찾기에서 풀린 계획도 폰 대화·승인 대기가 있으면 첫 명령을 미루고, 풀리면 보내며, 30초 넘게 막히면 닫는다", async () => {
    let talking = false;
    const s = runSetup({ objects: [seenAt(5_000)], over: { talking: () => talking } });
    await blocked(s);
    expect(s.last()).toMatchObject({ step: "plan:pam-1:find:cup_1:go:1" });
    talking = true;
    s.objects([seenAt(s.clock.t + 250)]);
    s.tick();
    expect(s.commands().some((c) => c.step === "plan:pam-1:1")).toBe(false);
    talking = false;
    s.objects([seenAt(s.clock.t + 250)]);
    s.tick();
    expect(s.last()).toMatchObject({ step: "plan:pam-1:1" });
    const b = runSetup({ objects: [seenAt(5_000)], over: { talking: () => true } });
    await blocked(b);
    for (let i = 0; i < 32; i++) {
      b.objects([seenAt(b.clock.t + 1000)]);
      b.tick(1000);
    }
    expect(b.exec().find((l) => l.state === "failed")).toMatchObject({ text: EXEC_TEXT.phoneBusy });
    expect(b.commands().some((c) => c.step === "plan:pam-1:1")).toBe(false);
  });

  it("막은 그 컵이 다시 보이면 첫 단계를 보낸다(지킴 풂)", async () => {
    const s = runSetup({ objects: [seenAt(5_000)] });
    await blocked(s);
    s.objects([seenAt(s.clock.t + 250)]);
    s.tick();
    expect(s.last()).toMatchObject({ id: "plan:pam-1", step: "plan:pam-1:1" });
    expect(s.guards).toEqual([["cup_1", true], ["cup_1", false]]);
  });

  it("가까이 보기에서만 잡혀 3초를 넘겼으면 새 사진으로 다시 비추고 가까이 본다", async () => {
    const s = runSetup({ objects: [seenAt(5_000)] });
    await blocked(s);
    s.eye([2.6, 1]);
    s.tick();
    const aimAt = s.clock.t;
    expect(s.last()).toMatchObject({ text: "식탁 위를 비춰 주세요", kind: "do" });
    s.tick(4_000);
    s.ready(true);
    s.tick();
    expect(s.looks).toEqual([expect.objectContaining({ planId: "plan:pam-1", objectId: "cup_1", force: true })]);
    // 가까이 보기가 비추기 뒤(판단 뒤) 사진에서 컵을 찾았지만 그 사진이 3초 넘게 옛것
    s.objects([seenAt(aimAt + 500)]);
    s.looks[0]!.done();
    s.ready(false);
    s.tick();
    expect(s.last()).toMatchObject({ id: "plan:pam-1", text: "식탁 위를 비춰 주세요" });
    s.ready(true);
    s.tick();
    expect(s.looks).toHaveLength(2);
    s.objects([seenAt(s.clock.t)]);
    s.tick();
    expect(s.last()).toMatchObject({ step: "plan:pam-1:1" });
  });

  // 가로 키 큰 컵 r4·r5(2026-11-18): 계획 대상 id가 유령이었고 겨눈 자리에 다른 id의 같은 컵이 보였는데 「찾은 뒤 다시 판단」으로 계획이 취소됐다
  it("그 자리 0.5m 안에 다른 id의 같은 무리 물건이 보이면 그 물건을 계획 대상 id로 잇고(linkObject) 계획을 이어 첫 단계를 보낸다", async () => {
    const links: [string, string][] = [];
    let s!: ReturnType<typeof runSetup>;
    s = runSetup({ objects: [seenAt(5_000)], over: { linkObject: (from, to) => {
      links.push([from, to]);
      // World State가 잇는다: 대상 id가 그 자리·보임을 받고 다른 id는 사라짐(옮김 표시)
      s.objects([{ ...seenAt(s.clock.t, to, [2.3, 0.75, 1]) }, { ...seenAt(s.clock.t, from, [2.3, 0.75, 1]), status: "gone", followed_by: to }]);
      return true;
    } } });
    await blocked(s);
    s.objects([{ ...seenAt(5_000), status: "out_of_view" }, { ...seenAt(s.clock.t, "cup_7", [2.3, 0.75, 1]), first_seen_ms: s.clock.t }]);
    s.tick();
    expect(links).toEqual([["cup_7", "cup_1"]]);
    s.tick();
    expect(s.exec().some((l) => l.state === "failed")).toBe(false);
    expect(s.last()).toMatchObject({ id: "plan:pam-1", step: "plan:pam-1:1" });
    // 마시는 그릇 무리의 다른 종류(병)도 0.5m 안이면 잇는다. 0.5m 밖은 잇지 않는다
    const b: [string, string][] = [];
    const t = runSetup({ objects: [seenAt(5_000)], over: { linkObject: (from, to) => { b.push([from, to]); return false; } } });
    await blocked(t);
    const bottle = (id: string, at: [number, number, number]): WorldObject => ({ ...seenAt(t.clock.t, id, at), cls: "bottle", first_seen_ms: t.clock.t });
    t.objects([{ ...seenAt(5_000), status: "gone" }, bottle("bottle_3", [2.6, 0.75, 1])]);
    t.tick();
    expect(b).toEqual([]);
    t.objects([{ ...seenAt(5_000), status: "gone" }, bottle("bottle_2", [2.3, 0.75, 1])]);
    t.tick();
    expect(b).toEqual([["bottle_2", "cup_1"]]);
  });

  // Codex P2(5f230c5): 계획 전부터 따로 있던 옆 컵도 0.5m 안이면 대상 id로 합쳐, 원래 대상이 없어지면 다른 컵에 기존 계획을 실행했다
  it("찾기 전부터 있던 다른 물건(계획을 받을 때 있던 같은 종류, 찾기 시작 전에 처음 본 같은 무리)은 0.5m 안이어도 잇지 않고 「찾은 뒤 다시 판단」으로 닫는다", async () => {
    for (const before of ["plan", "find"] as const) {
      const links: [string, string][] = [];
      const neighbor = (s: { clock: { t: number } }): WorldObject => ({ ...seenAt(s.clock.t, "cup_7", [2.3, 0.75, 1]), ...(before === "find" ? { cls: "bottle" as const, id: "bottle_7", first_seen_ms: 6_000 } : {}) });
      const s = runSetup({ objects: [seenAt(5_000), ...(before === "plan" ? [{ ...seenAt(5_000, "cup_7", [2.3, 0.75, 1]), status: "out_of_view" as const }] : [])],
        over: { linkObject: (from, to) => { links.push([from, to]); return true; } } });
      await blocked(s);
      s.objects([{ ...seenAt(5_000), status: "out_of_view" }, neighbor(s)]);
      s.tick();
      expect(links, before).toEqual([]);
      expect(s.exec().find((l) => l.state === "failed"), before).toMatchObject({ plan_id: "plan:pam-1", text: EXEC_TEXT.foundNew });
    }
  });

  it("그 자리 0.5m 안에 다른 id의 같은 종류 컵만 생기고 잇지 못하면(linkObject 없음·실패) 계획을 「찾은 뒤 다시 판단」으로 닫고 같은 행동 다시 계획 간격에서 뺀다", async () => {
    const s = runSetup({ objects: [seenAt(5_000)], over: { planGapMs: 15_000 } });
    await blocked(s);
    s.objects([{ ...seenAt(5_000), status: "out_of_view" }, seenAt(s.clock.t, "cup_7", [2.2, 0.75, 1])]);
    s.tick();
    expect(s.exec().find((l) => l.state === "failed")).toMatchObject({ plan_id: "plan:pam-1", text: EXEC_TEXT.foundNew });
    expect(s.plans.current()).toMatchObject({ id: "plan:pam-1", status: "cancelled" });
    await s.decide({ ...decision, id: "pam-2", seq: 2, atMs: s.clock.t });
    expect(s.exec().filter((l) => l.plan_id === "plan:pam-2").map((l) => l.text)).not.toContain(EXEC_TEXT.held);
  });

  // 가로 유리컵 실제 판 r2(2026-11-18): 가까이 본 VLM이 그 자리 유리컵을 병으로 답해 bottle_2가 생겼고, 찾기가 컵만 찾아 「대상 물건이 보이지 않아」로 끝났다
  it("그 자리 0.5m 안에 마시는 그릇 무리의 다른 종류(병)만 생겨도 찾던 대상이다(잇지 못하면 「찾은 뒤 다시 판단」으로 닫는다). 0.5m 밖의 병은 찾은 것이 아니다", async () => {
    const s = runSetup({ objects: [seenAt(5_000)] });
    await blocked(s);
    const bottle = (id: string, at: [number, number, number]): WorldObject => ({ ...seenAt(s.clock.t, id, at), cls: "bottle" });
    s.objects([{ ...seenAt(5_000), status: "gone" }, bottle("bottle_3", [2.6, 0.75, 1])]);
    s.tick();
    expect(s.exec().some((l) => l.state === "failed")).toBe(false);
    s.objects([{ ...seenAt(5_000), status: "gone" }, bottle("bottle_2", [2.3, 0.75, 1])]);
    s.tick();
    expect(s.exec().find((l) => l.state === "failed")).toMatchObject({ plan_id: "plan:pam-1", text: EXEC_TEXT.foundNew });
  });

  // 가로 유리컵 실제 판 r6(2026-11-18): 찾던 cup_9가 겨눈 자리에서 다시 보였는데 같은 자리의 다른 id를 찾아 「찾은 뒤 다시 판단」으로 계획을 버렸다
  it("겨눈 자리에서 대상 id가 다시 보이면 더 가까운 다른 id가 있어도 대상을 찾은 것이다(계획을 이어 간다)", async () => {
    const s = runSetup({ objects: [seenAt(5_000)] });
    await blocked(s);
    s.objects([seenAt(s.clock.t, "cup_7", [2.02, 0.75, 1]), seenAt(s.clock.t, "cup_1", [2.2, 0.75, 1])]);
    s.tick();
    expect(s.exec().some((l) => l.state === "failed")).toBe(false);
  });

  it("못 찾으면 낡음 글로 닫는다. 들고 감 보호였던 컵·치운 컵이면 찾지 않는다", async () => {
    const s = runSetup({ objects: [seenAt(5_000)] });
    await blocked(s);
    s.eye([2.6, 1]);
    s.tick();
    s.ready(true);
    s.tick();
    s.looks[0]!.done();
    s.tick(4_100);
    expect(s.exec().find((l) => l.state === "failed")).toMatchObject({ plan_id: "plan:pam-1", text: CHECK_TEXT.stale });
    expect(s.guards.at(-1)).toEqual(["cup_1", false]);
    const carried = runSetup({ objects: [{ ...seenAt(5_000), carried: true }] });
    await carried.decide(decision);
    for (let i = 0; i < 13; i++) carried.tick();
    expect(carried.commands().some((c) => c.step.includes(":find:"))).toBe(false);
    expect(carried.exec().find((l) => l.state === "failed")).toMatchObject({ text: CHECK_TEXT.stale });
  });
});

describe("실행 추적: 사람이 쓰는 물건은 그 사람이 사라질 때까지 지켜본다(쓰는 중 지킴)", () => {
  const fact = (value: string, at = 9_000) => ({ value, at_ms: at, since_ms: at, certainty: "confirmed" as const });
  const NOONCHI = ["컵 치우기", "사용자에게 물어보기", "세탁물 건조기로 옮기기", "에어컨 켜기", "컵에 물 채워 주기", "컵에 콜라 따라 주기"];
  const mug = (): WorldObject => ({ ...cup("present", "on_table", 9_000), facts: { body: fact("opaque"), contents: fact("contents_unknown"), place: fact("on_table") }, contents_gen: 2 });
  type Who = { act?: string; holding?: string[]; count?: number; factAt?: number } | null;
  /** 식탁에 불투명 컵 cup_1(내용물 모름)이 있는 집. who로 사람을 바꾼다(null이면 안 보임, act 활동, holding 든 물건 id, count 보인 사람 수(기본 1),
   *  factAt 활동·듦 사실을 찍은 때(기본 지금)). 사람이 새로 보이면 그때가 since_ms다. 폰 눈은 컵 [2, 1]에서 1m. thoughts: 생각 말풍선에 올린 글. */
  function useSetup(o: { objects?: () => WorldObject[]; over?: Parameters<typeof setup>[0] } = {}) {
    let who: Who = null;
    let since = 0;
    const thoughts: string[] = [];
    const clockAt = { t: 10_000 };
    const w = (): WorldView => {
      const base = world((o.objects ?? (() => [mug()]))());
      if (!who) return base;
      const at = who.factAt ?? clockAt.t;
      const facts = { ...(who.act ? { activity: fact(who.act, at) } : {}), ...(who.holding ? { holding: fact("holding_object", at) } : {}) };
      return { ...base, person: { ...base.person, visible: true, since_ms: since, last_seen_ms: clockAt.t, count: who.count ?? 1, holding: who.holding ?? [], facts } };
    };
    const s = setup({ w, tasks: () => NOONCHI, thought: (text) => thoughts.push(text), lookContents: () => true, topReady: () => false, ...o.over });
    s.t.onEye([3, 1]);
    const tick = (ms = 250) => { s.clock.t += ms; clockAt.t = s.clock.t; s.t.onEye([3, 1]); s.t.tick(); };
    const set = (p: Who) => { if (p && !who) since = s.clock.t; who = p; clockAt.t = s.clock.t; };
    return { ...s, thoughts, tick, who: set };
  }

  it("사람이 컵으로 마시는 것을 보면 내려놓고 계속 있어도 사라질 때까지 계획 밖 가까이 가서 보기를 하지 않고, 생각 말풍선에 「사람이 마시는 중이라 지켜볼게요」를 한 번 올린다", () => {
    const s = useSetup();
    s.who({ act: "drinking" });
    s.tick();
    expect(s.commands()).toEqual([]);
    expect(s.thoughts).toEqual([USE_THOUGHT.act("마시는 중")]);
    expect(s.thoughts).toEqual(["사람이 마시는 중이라 지켜볼게요"]);
    // 사람이 컵을 내려놓고 아무것도 하지 않아도 보이는 동안은 이어 간다
    s.who({});
    for (let i = 0; i < 80; i++) s.tick();
    expect(s.commands()).toEqual([]);
    expect(s.thoughts).toHaveLength(1);
  });

  it("사람이 사라지면 풀고, 다시 나타나 쓰지 않으면 가까이 가서 보며, 또 쓰면 거두고 다시 붙잡는다", () => {
    const s = useSetup();
    s.who({ act: "drinking" });
    s.tick();
    s.who(null);
    s.tick();
    // 계획 밖 가까이 가서 보기는 사람이 보일 때만 한다: 다시 나타나면(쓰지 않음) 바로 보낸다
    s.who({});
    s.tick();
    expect(s.last()).toMatchObject({ id: "peek:1", text: PEEK_TEXT.go("컵") });
    s.who({ holding: ["cup_1"] });
    s.tick();
    expect(s.last()).toEqual({ type: "command_clear", id: "peek:1" });
    expect(s.thoughts).toEqual([USE_THOUGHT.act("마시는 중"), USE_THOUGHT.holding("컵")]);
    for (let i = 0; i < 20; i++) s.tick();
    expect(s.commands().filter((c) => c.speak)).toHaveLength(1);
  });

  it("다른 물건을 쓰는 것은 영향이 없다(병을 들어도 컵은 가까이 가서 본다)", () => {
    const s = useSetup({ objects: () => [mug(), { ...cup("present", "on_table", 9_000), id: "bottle_1", cls: "bottle", position: [4, 0.75, 1] }] });
    s.who({ holding: ["bottle_1"] });
    s.tick();
    expect(s.last()).toMatchObject({ id: "peek:1", text: PEEK_TEXT.go("컵") });
    expect(s.thoughts).toEqual([]);
  });

  it("컵 치우기 계획은 사람이 컵을 쓰는 동안 첫 명령을 미루고(「사람이 쓰는 중이라 기다려요」) 사람이 사라지면 「식탁으로 가 주세요」부터 한다", async () => {
    const s = useSetup({ objects: () => [cup("present", "on_table", 9_000)] });
    s.who({ holding: ["cup_1"] });
    s.tick();
    await s.decide(decision);
    expect(s.commands()).toEqual([]);
    expect(s.exec().at(-1)).toMatchObject({ plan_id: "plan:pam-1", state: "planned", text: EXEC_TEXT.inUse });
    s.who({});
    for (let i = 0; i < 40; i++) s.tick();
    expect(s.commands()).toEqual([]);
    expect(s.exec().filter((l) => l.text === EXEC_TEXT.inUse)).toHaveLength(1);
    s.who(null);
    s.tick();
    expect(s.last()).toMatchObject({ id: "plan:pam-1", text: "식탁으로 가 주세요", speak: true });
  });

  it("사람이 holdMs 넘게 계속 있으면 그 계획을 「사람이 쓰는 중이라 실행하지 않아요」로 닫는다", async () => {
    const s = useSetup({ objects: () => [cup("present", "on_table", 9_000)] });
    s.who({ act: "drinking" });
    s.tick();
    await s.decide(decision);
    for (let i = 0; i * 1000 <= CONTENTS_HOLD.holdMs + 1000; i++) s.tick(1000);
    expect(s.exec().at(-1)).toMatchObject({ plan_id: "plan:pam-1", state: "failed", text: EXEC_TEXT.inUseLong });
    expect(s.commands()).toEqual([]);
  });

  // Codex(638302d use.ts:64): 보인 사람 수가 줄었다는 것만으로 풀어, 컵을 쓰는 사람은 남고 같이 있던 사람만 나가도 보호가 풀렸다.
  // World State는 사람을 한 묶음으로 세어 누가 나갔는지 모르므로 사람이 모두 사라질 때까지 지킨다
  it("같이 있던 사람이 나가 보인 사람 수가 줄어도(누가 나갔는지 모름) 보호를 지키고, 사람이 모두 사라지면 푼다", () => {
    const s = useSetup();
    s.who({ act: "drinking", count: 2 });
    s.tick();
    const drankAt = s.clock.t;
    s.who({ act: "drinking", count: 1, factAt: drankAt });
    for (let i = 0; i < 60; i++) s.tick();
    expect(s.commands()).toEqual([]);
    s.who(null);
    s.tick();
    s.who({});
    s.tick();
    expect(s.last()).toMatchObject({ id: "peek:1", text: PEEK_TEXT.go("컵") });
    expect(s.thoughts).toHaveLength(1);
  });

  // Codex(65d1360 use.ts:25): 종류로 지켜 cup_1을 쓰면 다른 cup_2도 막혔다
  it("쓰는 물건을 알면 그 물건만 지킨다: cup_1을 들면 cup_2는 가까이 가서 보고, 무엇을 들었는지 모르면 컵 모두 기다린다", () => {
    const two = () => [mug(), { ...mug(), id: "cup_2", position: [2.5, 0.75, 1] as [number, number, number], last_seen_ms: 9_500 }];
    const known = useSetup({ objects: two });
    known.who({ holding: ["cup_1"] });
    known.tick();
    expect(known.last()).toMatchObject({ id: "peek:1", step: expect.stringContaining(":peek:cup_2:") });
    const unknown = useSetup({ objects: two });
    unknown.who({ holding: [] });
    for (let i = 0; i < 20; i++) unknown.tick();
    expect(unknown.commands()).toEqual([]);
  });

  // Codex(65d1360 use.ts:64, start.ts:218): 쓰는 중 기다림이 풀리면 폰 대화 중에도 첫 명령이 나갔다
  it("쓰는 중이라 미룬 계획은 풀려도 폰 대화·승인 대기 중이면 첫 명령을 더 미룬다", async () => {
    let talking = false;
    const s = useSetup({ objects: () => [cup("present", "on_table", 9_000)], over: { talking: () => talking } });
    s.who({ holding: ["cup_1"] });
    s.tick();
    await s.decide(decision);
    expect(s.commands()).toEqual([]);
    talking = true;
    s.who(null);
    for (let i = 0; i < 4; i++) s.tick();
    expect(s.commands()).toEqual([]);
    talking = false;
    s.tick();
    expect(s.last()).toMatchObject({ id: "plan:pam-1", text: "식탁으로 가 주세요" });
  });
});

// 2026-11-18 사용자 결정: 계획이 끝나면(완료·그만·실패) 걷지 않고 아는 사실로 사용자 위치를 확인한 뒤 충전 자리로 돌아가 지켜본다. 새 일은 그 자리에서 시작한다
// 2026-11-18 wide-glass q3: 「계획이 맞지 않아 버림」의 까닭이 기록에 없었고({"state":"failed"}), 그 뒤 「방금 계획한 일이라 잠시 뒤 다시 봄」으로 12초를 기다렸다
describe("실행 추적: 계획 검사에서 버린 계획", () => {
  it("버린 까닭(계획 검사의 첫 틀린 단계와 이유)을 실행 기록과 서버 로그에 남기고, 같은 행동을 다시 계획하는 간격 없이 바로 다시 짠다", async () => {
    const plans = new PlanHub(smallFloor(), () => {}, () => "t");
    const w = () => world([cup("present")]);
    const real = testPlanner(llm);
    const logged: string[] = [];
    let n = 0;
    const s = setup({
      plans, w, planGapMs: 60_000, log: (line) => logged.push(line),
      planner: (d, signal) => (n++ === 0
        ? Promise.resolve({ ok: false as const, error: "2번 집기: 집을 물건(cup_9)이 World State에 없습니다" })
        : real.plan(planContext({ decision: d, world: w(), floor: plans.floor() }), signal)),
    });
    await s.decide(decision);
    expect(s.exec().at(-1)).toMatchObject({ plan_id: "plan:pam-1", state: "failed", text: EXEC_TEXT.badPlan, reason: "2번 집기: 집을 물건(cup_9)이 World State에 없습니다" });
    expect(logged.some((l) => l.includes("plan:pam-1") && l.includes("2번 집기: 집을 물건(cup_9)이 World State에 없습니다"))).toBe(true);
    await s.decide({ ...decision, id: "pam-2", seq: 2 });
    expect(s.exec().some((e) => e.text === EXEC_TEXT.held)).toBe(false);
    expect(s.plans.current()).toMatchObject({ id: "plan:pam-2", status: "running" });
  });
});

// 2026-11-18 wide-mug q3: 「컵을 들어 주세요」 중에 폰 든 사람이 보여 PAM이 「컵에 콜라 따라 주기」를 골랐고, 「새 판단으로 바뀜」으로 컵 치우기가 취소됐다
describe("실행 추적: 손대는 단계 중 다른 행동 판단", () => {
  it("집기 중 직접 받은 말 부탁은 집기가 끝나면 한 번만 계획 모드로 보낸다", async () => {
    const s = setup();
    await s.decide(decision);
    s.t.onAnswer("plan:pam-1", "plan:pam-1:1", "done");
    s.t.onRequest({ task: "사용자에게 물어보기", heard: "어떻게 할지 물어봐 줘", atMs: s.clock.t, afterSeq: 1 });
    s.t.tick();
    await s.t.idle();
    expect(s.plans.current()?.id).toBe("plan:pam-1");
    s.t.onAnswer("plan:pam-1", "plan:pam-1:2", "done");
    s.t.tick();
    await s.t.idle();
    expect(s.plans.current()?.id).toBe("plan:say-1");
    s.t.tick();
    expect(s.exec().filter((e) => e.plan_id === "plan:say-1" && e.state === "running")).toHaveLength(1);
  });
  it("집기·내려놓기 단계와 집은 물건을 들고 가는 동안에는 다른 행동 판단으로 계획을 바꾸지 않고 기록만 한다(계획이 끝난 뒤 다시 판단). 가기 단계에서는 바꾼다", async () => {
    const s = setup();
    s.t.onEye([1, 2]);
    await s.decide(decision);
    // 1 가기 단계: 다른 행동 판단은 지금처럼 계획을 바꾼다
    await s.decide(ask("pam-2", 2));
    expect(s.plans.current()).toMatchObject({ id: "plan:pam-2" });
    const t = setup();
    await t.decide(decision);
    t.t.onAnswer("plan:pam-1", "plan:pam-1:1", "done");
    expect(t.last()).toMatchObject({ step: "plan:pam-1:2", text: "컵을 들어 주세요" });
    // 2 집기 단계: 다른 행동 판단은 기록만 한다
    await t.decide(ask("pam-2", 2));
    expect(t.exec().at(-1)).toMatchObject({ plan_id: "plan:pam-2", text: EXEC_TEXT.handling });
    expect(t.plans.current()).toMatchObject({ id: "plan:pam-1", status: "running" });
    // 3 들고 싱크대로 가는 동안도
    t.t.onAnswer("plan:pam-1", "plan:pam-1:2", "done");
    await t.decide(ask("pam-3", 3));
    expect(t.exec().at(-1)).toMatchObject({ plan_id: "plan:pam-3", text: EXEC_TEXT.handling });
    expect(t.plans.current()).toMatchObject({ id: "plan:pam-1", status: "running" });
  });

  it("손대는 단계 중이어도 사람이 말로 한 부탁(들은 말이 든 판단)과 비상(쓰러짐 의심)은 계획을 바꾼다", async () => {
    let w = world([cup("present")]);
    const t = setup({ w: () => w });
    await t.decide(decision);
    t.t.onAnswer("plan:pam-1", "plan:pam-1:1", "done");
    await t.decide({ ...ask("pam-2", 2), textSent: "사람이 말함: 「어떻게 할지 물어봐 줘」" });
    expect(t.plans.current()).toMatchObject({ id: "plan:pam-2" });
    const u = setup({ w: () => w });
    await u.decide(decision);
    u.t.onAnswer("plan:pam-1", "plan:pam-1:1", "done");
    w = { ...w, person: { ...w.person, visible: true, facts: { posture: { value: POSE_FALL, at_ms: 9_000, since_ms: 9_000, certainty: "confirmed" } } } };
    await u.decide(ask("pam-2", 2));
    expect(u.plans.current()).toMatchObject({ id: "plan:pam-2" });
  });

  // Codex(79f25b8 start.ts:151): 가기 단계 중에 요청한 다른 계획이 집기·운반 중에 도착하면 기존 계획을 취소했다
  it("가기 단계에서 만들기 시작한 다른 계획이 손대는 단계 중에 도착하면 그 새 계획은 미루고 기존 계획을 그대로 둔다. 말로 한 부탁이면 바꾼다", async () => {
    for (const spoken of [false, true]) {
      const plans = new PlanHub(smallFloor(), () => {}, () => "t");
      const w = () => world([cup("present")]);
      const real = testPlanner(llm);
      let release: () => void = () => {};
      const s = setup({
        plans, w,
        planner: (d, signal) => {
          const made = real.plan(planContext({ decision: d, world: w(), floor: plans.floor() }), signal);
          return d.id === "pam-2" ? new Promise((done) => { release = () => done(made); }) : made;
        },
      });
      await s.decide(decision);
      expect(s.last()).toMatchObject({ step: "plan:pam-1:1" });
      // 1 가기 단계에서 다른 행동 판단: 계획을 만들기 시작한다(아직 손대는 단계가 아니다)
      s.t.onDecision({ ...ask("pam-2", 2), ...(spoken ? { textSent: "사람이 말함: 「어떻게 할지 물어봐 줘」" } : {}) });
      // 2 그 사이 집기 단계로 넘어간다
      s.t.onAnswer("plan:pam-1", "plan:pam-1:1", "done");
      expect(s.last()).toMatchObject({ step: "plan:pam-1:2" });
      // 3 새 계획이 도착한다
      release();
      await s.t.idle();
      if (spoken) {
        expect(s.plans.current(), "말로 한 부탁").toMatchObject({ id: "plan:pam-2" });
      } else {
        expect(s.plans.current()).toMatchObject({ id: "plan:pam-1", status: "running" });
        expect(s.exec().at(-1)).toMatchObject({ plan_id: "plan:pam-2", state: "failed", text: EXEC_TEXT.handling });
      }
    }
  });

  it("손대는 단계 중 보이는 사람은 폰을 든 사람일 수 있어 쓰는 중 지킴을 그 사람으로 걸지 않는다", async () => {
    let w = world([cup("present")]);
    const said: string[] = [];
    const t = setup({ w: () => w, thought: (text) => said.push(text) });
    await t.decide(decision);
    t.t.onAnswer("plan:pam-1", "plan:pam-1:1", "done");
    w = world([cup("present", "in_hand", 9_500)], "holding_object", 9_500);
    w = { ...w, person: { ...w.person, visible: true, since_ms: 9_500, holding: ["cup_1"] } };
    t.t.tick();
    expect(said.some((x) => x.includes("지켜볼게요"))).toBe(false);
  });
});

describe("실행 추적: 계획이 끝나면 충전 자리로", () => {
  const DOCK_AT: [number, number, number] = [11, 0, 11];
  const withPerson = (w: WorldView, visible: boolean, room: string | null): WorldView => ({ ...w, person: { ...w.person, visible, room: room && "living", room_label: room } });
  function dockSetup(w: () => WorldView, over: Parameters<typeof setup>[0] = {}) {
    const said: string[] = [];
    const s = setup({ w, offsetMinutes: -120, dock: () => DOCK_AT, thought: (text) => said.push(text), ...over });
    const docks = () => s.commands().filter((c) => c.id.startsWith("dock:"));
    /** 눈을 그 자리로 두고 tick. */
    const at = (x: number, z: number, ms = 500) => { s.clock.t += ms; s.t.onEye([x, z]); s.t.tick(); };
    return { ...s, said, docks, at };
  }
  const finishCup = async (s: ReturnType<typeof setup>) => {
    await s.decide(decision);
    for (const n of [1, 2, 3, 4]) s.t.onAnswer("plan:pam-1", `plan:pam-1:${n}`, "done");
  };

  it("계획이 끝나면 걷지 않고 지금 아는 사실로 사용자 위치를 확인한 뒤(지금 자리에서 보기 lookMs) 「충전 자리로 가 주세요」 하나를 보내고, 폰 눈이 충전 자리 1.2m 안에 들면 지우고 지켜본다", async () => {
    const w = withPerson(world([cup("present")]), false, "거실");
    const s = dockSetup(() => w);
    s.t.onEye([5, 1]);
    await finishCup(s);
    expect(s.plans.current()).toMatchObject({ status: "done" });
    // 확인하는 동안은 명령을 보내지 않는다(걷지 않는다)
    s.at(5, 1);
    expect(s.docks()).toEqual([]);
    s.at(5, 1, DOCK.lookMs);
    expect(s.said).toContain(DOCK_TEXT.userLast("거실"));
    expect(s.last()).toMatchObject({
      type: "command", id: "dock:1", step: "dock:1:1", text: "충전 자리로 가 주세요", choices: [{ id: "done", label: "완료" }], kind: "go", near_m: DOCK.nearM, speak: true,
      target: { id: "dock", label: "충전 자리", position: DOCK_AT },
    });
    expect(s.said.at(-1)).toBe(DOCK_TEXT.going);
    // 1.2m 밖이면 그대로 두고, 안에 들면 지우고 지켜본다. 그 뒤 다시 보내지 않는다
    s.at(10, 10);
    expect(s.last().type).toBe("command");
    s.at(10.3, 10.3);
    expect(s.last()).toEqual({ type: "command_clear", id: "dock:1" });
    expect(s.said.at(-1)).toBe(DOCK_TEXT.docked);
    s.at(10.3, 10.3, 20_000);
    expect(new Set(s.docks().map((c) => c.step))).toEqual(new Set(["dock:1:1"]));
    expect(DOCK.nearM).toBe(1.2);
  });

  it("낮에는 새 위치를 기다려 그 방으로 한 번 가고 맞춘 눈으로만 도착을 확인한다", async () => {
    // 보이는 사용자의 위치가 5초 넘게 묵었으면 새 위치를 기다린다
    let seen = -60_000;
    const w = world([cup("present")]);
    const station = {id:"living_standby",name:"거실 대기 자리",room:"living",roles:["standby" as const],position:[5,6] as [number,number],look_at:[4,5] as [number,number],rooms:[],surfaces:[],observes_zone_ids:[]};
    const s = dockSetup(() => ({...w,person:{...w.person,count:1,visible:true,position:[5,6],position_ms:seen,room:"living",room_label:"거실"},
      person_trail:[{position:[5,6] as [number,number],room:"living",at_ms:seen}]}), {
      offsetMinutes:540, stations:{map:()=>({version:1,stations:[station],zones:[],surface_fronts:[],kitchen_entry:null,meal_watch:null}),rev:()=>3,
        target:id=>({id,label:station.name,position:[5,0,6],look:{label:"소파",position:[4,0.6,5]}}),result:()=>{}},
    });
    await finishCup(s);
    s.at(1,1,DOCK.lookMs);
    expect(s.docks()).toHaveLength(0);
    seen=s.clock.t;
    s.at(1,1);
    expect(s.last()).toMatchObject({target:{id:station.id},choices:[],kind:"go"});
    expect(s.t.onAnswer("dock:1","dock:1:1","done")).toBe(false);
    expect(s.t.machineFacts().dock).toBe("room");
    s.at(5,6);
    expect(s.t.machineFacts().dock).toBe("room");
    w.household_photo=arrivalPhoto(s.clock.t,[5,1,6],[4,0.6,5]);
    s.at(5,6);
    expect(s.last()).toMatchObject({type:"command_clear",id:"dock:1"});
    expect(s.t.machineFacts().dock).toBe("standby");
    s.at(1,1);
    expect(s.t.machineFacts().dock).toBeNull();
  });

  it.each([[60_000, true, "living_standby"], [USER_ROOM_MS + 1, true, null], [60_000, false, null]] as const)("낮에 지금 안 보이는 사용자는 혼자 보인 사진의 마지막 발 자리 방(%i ms 전, 혼자 %s)이 5분 안이면 그 방 대기 자리로 간다", async (ago, alone, target) => {
    const w = world([cup("present")]);
    const station = {id:"living_standby",name:"거실 대기 자리",room:"living",roles:["standby" as const],position:[5,6] as [number,number],look_at:[4,5] as [number,number],rooms:[],surfaces:[],observes_zone_ids:[]};
    let now = () => 0;
    // 둘이 보인 사진은 가장 큰 사람의 발 자리만 남기고 사람 자취(person_trail)를 비운다(src/world/state/people.ts): 그 자리는 누구의 방인지 모른다
    const s = dockSetup(() => ({...w,person:{...w.person,count:0,visible:false,position:[5,6],position_ms:now()-ago,room:"living",room_label:"거실"},
      ...(alone ? {person_trail:[{position:[5,6] as [number,number],room:"living",at_ms:now()-ago}]} : {})}), {
      offsetMinutes:540, stations:{map:()=>({version:1,stations:[station],zones:[],surface_fronts:[],kitchen_entry:null,meal_watch:null}),rev:()=>3,
        target:id=>({id,label:station.name,position:[5,0,6],look:null}),result:()=>{}},
    });
    now = () => s.clock.t;
    await finishCup(s);
    s.at(1,1,DOCK.lookMs);
    expect(s.docks().map((c) => c.target?.id ?? null).at(-1) ?? null).toBe(target);
  });

  it("둘이 보인 사진 직후 한 사람의 상체만 보이면(발 자리는 둘이 보일 때의 것) 그 방으로 돌아가지 않는다", async () => {
    const w = world([cup("present")]);
    const station = {id:"living_standby",name:"거실 대기 자리",room:"living",roles:["standby" as const],position:[5,6] as [number,number],look_at:[4,5] as [number,number],rooms:[],surfaces:[],observes_zone_ids:[]};
    let now = () => 0;
    // 지금 한 사람이 보이고 발 자리는 2초 전 것이지만, 그 사진은 둘이 보여 사람 자취가 비었다
    const s = dockSetup(() => ({...w,person:{...w.person,count:1,visible:true,position:[5,6],position_ms:now()-2000,room:"living",room_label:"거실"},person_trail:[]}), {
      offsetMinutes:540, stations:{map:()=>({version:1,stations:[station],zones:[],surface_fronts:[],kitchen_entry:null,meal_watch:null}),rev:()=>3,
        target:id=>({id,label:station.name,position:[5,0,6],look:null}),result:()=>{}},
    });
    now = () => s.clock.t;
    await finishCup(s);
    s.at(1,1,DOCK.lookMs);
    expect(s.docks()).toHaveLength(0);
  });

  it("사용자 위치: 보이면 그 방, 안 보이면 마지막으로 본 방, 둘 다 모르면 모른다고 한다. 이미 충전 자리 1.2m 안이면 명령 없이 지켜본다", async () => {
    for (const [visible, room, line] of [[true, "주방·식당", DOCK_TEXT.userHere("주방·식당")], [false, null, DOCK_TEXT.userUnknown]] as const) {
      const w = withPerson(world([cup("present")]), visible, room);
      const s = dockSetup(() => w);
      s.t.onEye([10.5, 10.5]);
      await finishCup(s);
      s.at(10.5, 10.5, DOCK.lookMs);
      expect(s.said, line).toContain(line);
      expect(s.docks()).toEqual([]);
      expect(s.said.at(-1)).toBe(DOCK_TEXT.docked);
    }
  });

  it("충전 자리로 가는 동안 새 행동 판단은 미루고, 닿으면 새 일을 시작한다. 「그만」은 계획처럼 충전 자리 가기도 그만둔다", async () => {
    const w = withPerson(world([cup("present")]), false, "거실");
    const s = dockSetup(() => w);
    s.t.onEye([5, 1]);
    await finishCup(s);
    s.at(5, 1, DOCK.lookMs);
    expect(s.last()).toMatchObject({ id: "dock:1" });
    await s.decide({ ...decision, id: "pam-2", seq: 2, atMs: s.clock.t });
    expect(s.exec().at(-1)).toMatchObject({ plan_id: "plan:pam-2", text: EXEC_TEXT.docking });
    expect(s.plans.current()).toMatchObject({ id: "plan:pam-1", status: "done" });
    s.at(10.5, 10.5);
    await s.decide({ ...decision, id: "pam-3", seq: 3, atMs: s.clock.t });
    expect(s.plans.current()).toMatchObject({ id: "plan:pam-3", status: "running" });
    // 사용자가 중단한 뒤에는 자동 복귀도 시작하지 않는다.
    expect(s.heard("그만")).toMatchObject({ id: "stop" });
    expect(s.plans.current()).toMatchObject({ id: "plan:pam-3", status: "cancelled" });
    s.at(5, 1, DOCK.lookMs);
    expect(s.docks().some(c => c.id === "dock:2")).toBe(false);
    await s.decide({ ...decision, id: "pam-4", seq: 4, atMs: s.clock.t });
    expect(s.plans.current()).toMatchObject({ id: "plan:pam-4", status: "running" });
  });

  it("폰 눈을 모르면(맞추기 전) 거리 모름으로 보내고, 「완료」 단추나 그 명령에 한 말 「다 했어」로 닿은 것으로 받는다. 다른 명령에 한 말은 버린다", async () => {
    const w = withPerson(world([cup("present")]), false, "거실");
    for (const how of ["button", "voice"] as const) {
      const s = dockSetup(() => w);
      await finishCup(s);
      s.clock.t += DOCK.lookMs;
      s.t.tick();
      expect(s.last()).toMatchObject({ id: "dock:1", vision: "충전 자리까지 거리 모름", choices: [{ id: "done", label: "완료" }] });
      expect(s.t.openCommand()).toMatchObject({ planId: "dock:1", stepId: "dock:1:1", kind: "command", choices: [{ id: "done" }] });
      if (how === "button") {
        expect(s.t.onAnswer("dock:1", "dock:1:9", "done")).toBe(false);
        expect(s.t.onAnswer("dock:1", "dock:1:1", "done")).toBe(true);
      } else {
        expect(s.t.onHeard("다 했어", { kind: "command", id: "plan:pam-1", step: "plan:pam-1:4", pending: [] })).toEqual({ kind: "stale" });
        expect(s.heard("다 했어")).toMatchObject({ id: "done" });
      }
      expect(s.last()).toEqual({ type: "command_clear", id: "dock:1" });
      expect(s.said.at(-1), how).toBe(DOCK_TEXT.docked);
      await s.decide({ ...decision, id: "pam-2", seq: 2, atMs: s.clock.t });
      expect(s.plans.current(), how).toMatchObject({ id: "plan:pam-2", status: "running" });
    }
  });

  // Codex(db7c9d8 dock.ts:107): 쓰러짐 의심을 막힘으로 보지 않아 충전 자리로 계속 보냈고, 그 판단도 「복귀 중」으로 버렸다
  it("충전 자리로 가는 중(확인 포함) 비상(쓰러짐 의심)이 오면 복귀를 바로 거두고, 그 뒤 판단은 미루지 않는다", async () => {
    for (const phase of ["look", "go"] as const) {
      let w = withPerson(world([cup("present")]), false, "거실");
      const s = dockSetup(() => w);
      s.t.onEye([5, 1]);
      await finishCup(s);
      if (phase === "go") {
        s.at(5, 1, DOCK.lookMs);
        expect(s.last()).toMatchObject({ id: "dock:1" });
      }
      w = { ...w, person: { ...w.person, visible: true, facts: { posture: { value: POSE_FALL, at_ms: s.clock.t, since_ms: s.clock.t, certainty: "confirmed" } } } };
      s.at(5, 1);
      if (phase === "go") expect(s.last(), phase).toEqual({ type: "command_clear", id: "dock:1" });
      s.at(5, 1, DOCK.lookMs);
      expect(s.docks().filter((c) => c.speak).length, phase).toBe(phase === "go" ? 1 : 0);
      await s.decide({ ...decision, id: "pam-2", seq: 2, atMs: s.clock.t });
      expect(s.exec().some((e) => e.plan_id === "plan:pam-2" && e.text === EXEC_TEXT.docking), phase).toBe(false);
      expect(s.plans.current(), phase).toMatchObject({ id: "plan:pam-2", status: "running" });
    }
  });

  // Codex(db7c9d8 start.ts:39): 복귀 중 판단을 버리는데 Decider는 그 판단에 쓴 들은 말을 지워, 말로 한 부탁이 도착 뒤 사라졌다
  it("충전 자리로 가는 중 사람이 말로 한 부탁(관찰 텍스트에 들은 말이 든 판단)은 복귀를 멈추고 바로 받는다. 들은 말 없는 판단은 미룬다", async () => {
    const w = withPerson(world([cup("present")]), false, "거실");
    const s = dockSetup(() => w);
    s.t.onEye([5, 1]);
    await finishCup(s);
    s.at(5, 1, DOCK.lookMs);
    expect(s.last()).toMatchObject({ id: "dock:1" });
    await s.decide({ ...decision, id: "pam-2", seq: 2, atMs: s.clock.t, textSent: "[지금] 컵 cup_1 보임" });
    expect(s.exec().at(-1)).toMatchObject({ plan_id: "plan:pam-2", text: EXEC_TEXT.docking });
    await s.decide({ ...decision, id: "pam-3", seq: 3, atMs: s.clock.t, textSent: "[지금] 컵 cup_1 보임\n사람이 말함: 「컵 좀 치워 줘」" });
    expect(s.phone.some((m) => m.type === "command_clear" && m.id === "dock:1")).toBe(true);
    expect(s.plans.current()).toMatchObject({ id: "plan:pam-3", status: "running" });
  });

  it("명령을 낸 적 없이 닫힌 계획(실행 전 검사에서 멈춤)과 충전 자리를 모르는 집에서는 충전 자리로 가지 않는다", async () => {
    const w = withPerson(world([cup("present")]), false, "거실");
    const blocked = dockSetup(() => w, { check: () => ({ ok: false, reason: "unknown_task", text: CHECK_TEXT.unknown_task }) as CheckResult, recheckMs: 0 });
    blocked.t.onEye([5, 1]);
    await blocked.decide(decision);
    blocked.at(5, 1);
    expect(blocked.plans.current()).toMatchObject({ status: "failed" });
    blocked.at(5, 1, DOCK.lookMs);
    blocked.at(5, 1, DOCK.lookMs);
    expect(blocked.docks()).toEqual([]);
    const none = dockSetup(() => w, { dock: () => null });
    none.t.onEye([5, 1]);
    await finishCup(none);
    none.at(5, 1, DOCK.lookMs);
    none.at(5, 1, DOCK.lookMs);
    expect(none.docks()).toEqual([]);
  });
});

// 2026-11-18 wide-glass q3: 「계획이 맞지 않아 버림」의 까닭이 기록에 없었고({"state":"failed"}), 그 뒤 「방금 계획한 일이라 잠시 뒤 다시 봄」으로 12초를 기다렸다
describe("실행 추적: 계획 검사에서 버린 계획", () => {
  it("버린 까닭(계획 검사의 첫 틀린 단계와 이유)을 실행 기록과 서버 로그에 남기고, 같은 행동을 다시 계획하는 간격 없이 바로 다시 짠다", async () => {
    const plans = new PlanHub(smallFloor(), () => {}, () => "t");
    const w = () => world([cup("present")]);
    const real = testPlanner(llm);
    const logged: string[] = [];
    let n = 0;
    const s = setup({
      plans, w, planGapMs: 60_000, log: (line) => logged.push(line),
      planner: (d, signal) => (n++ === 0
        ? Promise.resolve({ ok: false as const, error: "2번 집기: 집을 물건(cup_9)이 World State에 없습니다" })
        : real.plan(planContext({ decision: d, world: w(), floor: plans.floor() }), signal)),
    });
    await s.decide(decision);
    expect(s.exec().at(-1)).toMatchObject({ plan_id: "plan:pam-1", state: "failed", text: EXEC_TEXT.badPlan, reason: "2번 집기: 집을 물건(cup_9)이 World State에 없습니다" });
    expect(logged.some((l) => l.includes("plan:pam-1") && l.includes("2번 집기: 집을 물건(cup_9)이 World State에 없습니다"))).toBe(true);
    await s.decide({ ...decision, id: "pam-2", seq: 2 });
    expect(s.exec().some((e) => e.text === EXEC_TEXT.held)).toBe(false);
    expect(s.plans.current()).toMatchObject({ id: "plan:pam-2", status: "running" });
  });
});

describe("말 부탁 → 계획 모드(request_task, 묻기 답)", () => {
  it("말 부탁은 PAM 판단 번호와 섞이지 않는다: PAM seq가 높아도 첫 말 부탁을 받고, 말 부탁보다 먼저 보낸 PAM 판단은 그 계획을 바꾸지 않으며, 뒤의 PAM 판단(다음 seq)은 그대로 받는다", async () => {
    const t = coachSetup();
    const pam = (id: string, seq: number, atMs: number, action: string): DecisionRecord => ({ ...decision, id, seq, atMs, action });
    await t.decide(pam("pam-9", 9, 9_000, "사용자에게 물어보기"));            // PAM seq 9까지 받음
    t.t.onRequest({ task: RAMEN, heard: "라면 끓이는 법 알려 줘", atMs: 10_000, afterSeq: 10 });   // pam-10은 이미 보냈고 답 전
    await t.t.idle();
    expect(t.exec().find((e) => /^plan:say-/.test(e.plan_id))).toMatchObject({ state: "decided" });
    expect(t.plans.current()).toMatchObject({ id: expect.stringMatching(/^plan:say-/), goal: RAMEN });
    await t.decide(pam("pam-10", 10, 10_000, "컵 치우기"));                  // 말 부탁 전에 보낸 요청의 답(같은 밀리초여도 번호로 가른다)
    expect(t.exec().at(-1)).toMatchObject({ plan_id: "plan:pam-10", text: EXEC_TEXT.late });
    await t.decide(pam("pam-11", 11, 10_000, RAMEN));                         // 뒤에 보낸 요청: 같은 행동이면 진행 중 기록
    expect(t.exec().at(-1)).toMatchObject({ plan_id: "plan:pam-11", text: EXEC_TEXT.same });
    // 말 부탁 판단은 들은 말이 든 판단 기록 꼴이다(계획 전 검사·계획 모드·승인·실행이 PAM 판단과 같다)
    expect(t.decisions().find((d) => d.source === "speech")).toMatchObject({ id: expect.stringMatching(/^say-/), seq: 0, afterSeq: 10, action: RAMEN, textSent: "사람이 말함: 「라면 끓이는 법 알려 줘」", status: "valid" });
  });

  it("말 부탁 계획을 아직 만드는 중에 그보다 먼저 본 관찰의 PAM 판단이 와도 그 계획을 끊지 않는다", async () => {
    let release: (r: PlanResult) => void = () => {};
    const plans = new PlanHub(smallFloor(), () => {}, () => "t");
    const w = () => world([cup("present")]);
    const real = testPlanner(llm);
    const t = setup({ plans, w, planner: (d, signal) => (d.source === "speech" ? new Promise<PlanResult>((r) => { release = r; }) : real.plan(planContext({ decision: d, world: w(), floor: plans.floor() }), signal)) });
    t.t.onRequest({ task: "컵 치우기", heard: "컵 치워 줘", atMs: 10_000, afterSeq: 3 });
    // 말 부탁 전에 보낸 요청의 답(만드는 중인 계획을 기다리지 않고 바로 본다)
    t.t.onDecision({ ...decision, id: "pam-3", seq: 3, atMs: 10_000, action: "사용자에게 물어보기" });
    expect(t.exec().at(-1)).toMatchObject({ plan_id: "plan:pam-3", text: EXEC_TEXT.late });
    const say = t.decisions().find((d) => d.source === "speech")!;
    release(await real.plan(planContext({ decision: say, world: w(), floor: plans.floor() })));
    await t.t.idle();
    expect(plans.current()).toMatchObject({ id: `plan:${say.id}`, status: "running" });
  });

  it("묻기 계획에 「치워 주세요」로 답하면 그 계획을 닫고 컵 치우기를 말 부탁 길로 시작한다. 「그대로 둬요」면 시작하지 않는다", async () => {
    const t = setup({ sentSeq: () => 4 });
    await t.decide({ ...ask("pam-4", 4), atMs: 10_000 });
    await t.answer("plan:pam-4", "clear");
    expect(t.exec()).toContainEqual(expect.objectContaining({ plan_id: "plan:pam-4", state: "done" }));
    expect(t.decisions().at(-1)).toMatchObject({ source: "speech", via: "answer", action: "컵 치우기", afterSeq: 4 });
    await t.t.idle();
    expect(t.exec().at(-1)).toMatchObject({ plan_id: expect.stringMatching(/^plan:say-/) });
    expect(t.plans.current()).toMatchObject({ id: expect.stringMatching(/^plan:say-/), goal: "컵 치우기" });
    const k = setup({ sentSeq: () => 5 });
    await k.decide({ ...ask("pam-5", 5), atMs: 10_000 });
    await k.answer("plan:pam-5", "keep");
    expect(k.decisions().filter((d) => d.source === "speech")).toEqual([]);
  });
});
