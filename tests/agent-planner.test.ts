// 에이전트 계획 모드(src/agent/planner.ts·planTools.ts)와 어떤 계획이든 돌리는 실행 추적(src/act/track.ts).
// 모델은 같은 주소 자리의 가짜 OpenAI 서버가 도구 호출로 낸다(tests/helpers/planner.ts). 실제 OpenAI는 부르지 않는다.
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { deviceRunner } from "../src/act/devices.js";
import { sayLine } from "../src/act/say.js";
import { TASKS } from "../src/act/tasks.js";
import { ExecutionTracker, type TrackerOptions } from "../src/act/track.js";
import { ApprovalStore, type ApprovalAnswer } from "../src/agent/approval.js";
import { PLANNER_PROMPT, planInput } from "../src/agent/planInput.js";
import { PLAN_LIMITS, PlanDraft, SUBMIT_ARGS, riskyHand, type PlanContext, type TaskInfo } from "../src/agent/planTools.js";
import { Policy } from "../src/agent/policy.js";
import { deviceViews } from "../src/agent/tools.js";
import { CUP_FSM_MEMORY, CUP_TASKS } from "../src/brain/decision.js";
import { PamClient } from "../src/brain/pam.js";
import type { BrainLog } from "../src/contract/events.js";
import type { PlannedCommandMessage } from "../src/contract/phone.js";
import type { WorldDevice, WorldObject, WorldView } from "../src/contract/world.js";
import { MemoryHub } from "../src/hub/memory.js";
import type { DeviceSpec } from "../src/hub/types.js";
import { describeDevice } from "../src/model/mapping.js";
import { PlanHub } from "../src/plan/hub.js";
import { AGAIN_TEXT, APPROVAL_TEXT, EXEC_TEXT, STEP_COMMAND } from "../src/plan/labels.js";
import { floorPlanFrom } from "../src/plan/route.js";
import { Decider, type DecisionRecord } from "../src/world/decide.js";
import { WorldState } from "../src/world/state.js";
import { Trigger } from "../src/world/trigger.js";
import { DEVICE_STATES } from "../src/world/vocab.js";
import { cupPlan } from "./helpers/cup-plan.js";
import { smallFloor } from "./helpers/floor.js";
import { startFakePam } from "./helpers/pam.js";
import { CUP_SCRIPTS, FILL_SCRIPTS, ramenScripts, ramenSteps, cupSteps, fillSteps, idsFrom, planCalls, planContext, startFakePlanner, testPlanner, type FakePlanner, type PlanScript } from "./helpers/planner.js";

// 작은 집: 복도(hall)·주방(kitchen)·후면 발코니(balcony, 바닥 −0.1m라 로봇 이동 가능 방이 아님). 세탁기·건조기는 발코니
const SCENE = {
  plan: {
    rooms: [
      { id: "hall", polygon: [[0, 0], [4, 0], [4, 4], [0, 4]] },
      { id: "kitchen", polygon: [[4, 0], [8, 0], [8, 4], [4, 4]] },
      { id: "balcony", polygon: [[0, 4], [4, 4], [4, 6], [0, 6]], floor_z: -0.1 },
    ],
    doors: [], open_edges: [["hall", "kitchen"], ["hall", "balcony"]],
  },
  objects: [
    { id: "robot", type: "robot", room: "hall", plan: { position: [1, 2] } },
    { id: "table_1", type: "dining_table", room: "kitchen", plan: { position: [7, 3] } },
    { id: "sink_1", type: "sink_counter", room: "kitchen", plan: { position: [5, 1] }, anchors: { basin: [5, 1.2] } },
    { id: "washer_1", type: "washer", room: "balcony", plan: { position: [1, 5.5] } },
    { id: "dryer_1", type: "dryer", room: "balcony", plan: { position: [3, 5.5] } },
  ],
};
const floor = () => floorPlanFrom(structuredClone(SCENE));
/** 냉장고가 있는 같은 집(채워 주기). */
const fridgeFloor = () => floorPlanFrom({ ...structuredClone(SCENE), objects: [...structuredClone(SCENE.objects), { id: "fridge_1", type: "fridge", room: "kitchen", plan: { position: [7.5, 0.5] } }] });

function spec(id: string, label: string, room: string, twinType: string, twinAttrs: Record<string, unknown[]>): DeviceSpec {
  const d = describeDevice(twinType, twinAttrs);
  if (!d) throw new Error(`매핑 없음: ${twinType}`);
  return { id, label, room, roomLabel: room, twinType, twinAttrs, ...d };
}
const DEVICES = [
  spec("ac_living", "거실 에어컨", "hall", "stand_ac", { power: ["off", "on"] }),
  spec("induction_1", "인덕션", "kitchen", "induction_counter", { power: ["off", "on"] }),
  spec("washer_1", "세탁기", "balcony", "washer", { running: [true, false] }),
  spec("dryer_1", "건조기", "balcony", "dryer", { running: [false, true] }),
];

const PERSON: WorldView["person"] = { visible: false, since_ms: 0, last_seen_ms: null, count: 0, room: null, room_label: null, position: null, near: [], holding: [], position_ms: null, answered_ms: null, facts: {} };
const cup = (over: Partial<WorldObject> = {}): WorldObject => ({
  id: "cup_1", cls: "cup", position: [7, 0.75, 3], surface: "table_1", surface_label: "식탁", room: "kitchen", error_m: 0.1, status: "present",
  first_seen_ms: 0, last_seen_ms: 9_000, last_in_view_ms: 9_000, facts: {}, answered_ms: null, devices: [], closer_hold: false, followed_by: null, ...over,
});
/** 허브 상태로 만든 World State 가전(지금 상태 키, 이력은 따로 준다). */
function devicesOf(hub: MemoryHub, history: Record<string, WorldDevice["history"]> = {}): WorldDevice[] {
  return hub.list().map((d) => {
    const twin = hub.get(d.id)!.twin;
    const state = (Object.keys(DEVICE_STATES) as (keyof typeof DEVICE_STATES)[]).filter((k) => twin[DEVICE_STATES[k].attr] === DEVICE_STATES[k].value);
    return { id: d.id, kind: d.kind, label: d.label, status: state.join(" "), state, active: false, changed_ms: 0, event_ms: null, started_ms: null, remaining_min: null, history: history[d.id] ?? [] };
  });
}
/** 분석한 마지막 프레임(frame_ms)은 실제 World State처럼 물건을 마지막으로 본 프레임이다(본 물건이 없으면 null). */
const view = (objects: WorldObject[], devices: WorldDevice[] = []): WorldView => ({
  at_ms: 0, objects, person: PERSON, fixtures: [], devices, eye: null, frame_ms: objects.length ? Math.max(...objects.map((o) => o.last_seen_ms)) : null, vlm_missing: 0, yolo_missing: 0,
});
const decision = (action: string, id = "pam-1", seq = 1): DecisionRecord => ({
  id, seq, atMs: 8_000, textSent: "t", finalTime: "x", status: "valid", prediction: { observation: "관찰", reasoning: "이유", task_index: 0 }, action, memoryVersion: 1,
  world: { objects: [], person_visible: false, vlm_missing: 0, yolo_missing: 0 },
});
const store = (remembered: Record<string, ApprovalAnswer> = {}) => {
  const s = new ApprovalStore(join(mkdtempSync(join(tmpdir(), "plan-")), "approvals.json"), () => "t");
  for (const [k, a] of Object.entries(remembered)) s.answer(k, a);
  return s;
};

const AC: PlanScript = () => [planCalls([{ kind: "device", label: "거실 에어컨 켜기", target: "ac_living", tool: "turn_on", until: { device: "ac_living", state: "on" }, timeout_s: 60 }])];
const COOKTOP: PlanScript = () => [planCalls([{ kind: "device", label: "인덕션 켜기", target: "induction_1", tool: "turn_on", timeout_s: 60 }])];
const laundry = (waitS = 7200): PlanScript => () => [planCalls([
  { kind: "wait", label: "세탁 멈춤", until: { device: "washer_1", state: "stopped" }, timeout_s: waitS, on_timeout: "ask" },
  { kind: "go", label: "세탁기로 가기", target: "washer_1", command: "세탁기로 가 주세요", timeout_s: 300 },
  { kind: "pick", label: "세탁물 꺼내기", target: "washer_1", command: "세탁물을 꺼내 주세요", timeout_s: 300 },
  { kind: "go", label: "건조기로 가기", target: "dryer_1", command: "건조기로 가 주세요", timeout_s: 300 },
  { kind: "place", label: "세탁물 넣기", target: "dryer_1", command: "세탁물을 건조기에 넣어 주세요", timeout_s: 300 },
  { kind: "device", label: "건조기 시작", target: "dryer_1", tool: "start", until: { device: "dryer_1", state: "running" }, timeout_s: 60 },
])];
const COOKTOP_TASK: TaskInfo = { name: "인덕션 켜기", description: "시험용 위험 목록 가전 단계", allow: { kinds: ["device"], need: ["device"], devices: { kinds: ["cooktop"], tools: ["turn_on"] } } };

let llm: FakePlanner;
beforeAll(async () => {
  llm = await startFakePlanner({ ...CUP_SCRIPTS, "에어컨 켜기": AC, "인덕션 켜기": COOKTOP, "세탁물 건조기로 옮기기": laundry() });
});
afterAll(async () => { await llm.close(); });

/** 실행 추적 + 계획 모드 에이전트(가짜 모델) + 메모리 허브·정책. w: World State(허브 가전 상태를 넣는다). */
function rig(o: { objects?: () => WorldObject[]; history?: () => Record<string, WorldDevice["history"]>; approvals?: ApprovalStore; task?: TaskInfo; over?: Partial<TrackerOptions>; initial?: Record<string, Record<string, unknown>> } = {}) {
  const logs: BrainLog[] = [];
  const phone: PlannedCommandMessage[] = [];
  const clock = { t: 10_000, now() { return this.t; } };
  const plans = new PlanHub(floor(), () => {}, () => "t");
  const hub = new MemoryHub(DEVICES, o.initial ?? { washer_1: { running: true } });
  const policy = new Policy();
  const planner = testPlanner(llm);
  const w = () => view(o.objects?.() ?? [], devicesOf(hub, o.history?.()));
  const ctx = (d: DecisionRecord): PlanContext => planContext({ decision: d, world: w(), floor: plans.floor(), hub, task: o.task });
  const planned: DecisionRecord[] = [];
  const t = new ExecutionTracker({
    plans, world: w, check: () => ({ ok: true }), floor: () => plans.floor(), planGapMs: 0, clock, approvals: o.approvals ?? store(),
    planner: (d, signal) => { planned.push(d); return planner.plan(ctx(d), signal); },
    devices: deviceRunner(hub, policy), toPhone: (m) => phone.push(m), emit: (l) => logs.push(l), ...o.over,
  });
  const decide = async (d: DecisionRecord) => { t.onDecision(d); await t.idle(); };
  const settle = () => new Promise((r) => setTimeout(r, 30));
  const exec = () => logs.flatMap((l) => (l.type === "execution" ? [l] : []));
  const spoken = () => phone.flatMap((m) => (m.type === "command" && m.speak ? [m.text] : []));
  const steps = () => plans.current()!.steps.map((s) => s.status);
  return { t, decide, settle, clock, plans, hub, policy, phone, logs, exec, spoken, steps, planned };
}

describe("계획 모드: 컵 치우기", () => {
  it("가짜 모델의 도구 호출로 만든 컵 계획은 지금 서버와 같은 네 명령·조건이고, 화면 계획은 컵 계획 모양(cupPlan)과 같다", async () => {
    const before = llm.bodies().length;
    const d = decision("컵 치우기");
    const r = await testPlanner(llm).plan(planContext({ decision: d, world: view([cup()]), floor: smallFloor(), nowIso: "t" }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.plan.view).toEqual({ ...cupPlan(smallFloor(), "plan:pam-1", "t", { id: "cup_1", position: [7, 0.75, 3] })!, judgment: "이유" });
    expect(r.plan.steps.map((s) => [s.kind, s.command])).toEqual([
      ["go", STEP_COMMAND.goTable], ["pick", STEP_COMMAND.pickCup], ["go", STEP_COMMAND.goSink], ["place", STEP_COMMAND.placeCup],
    ]);
    // 내려놓기(안에 넣기)는 「싱크대 안 사실 또는 싱크대 면(그 단계 target)의 싱크볼 안이고 손에 없음」이고, 자리 사실이 와도 사람이 그 컵을 들고 있지 않음
    expect(r.plan.steps.map((s) => s.until)).toEqual([
      { phone_near: "table_1" },
      { any: [{ object: "cup_1", follow: true, facts: { place: "in_hand" } }, { person_holding: "cup" }] },
      { phone_near: "sink_1" },
      {
        all: [
          {
            any: [
              { object: "cup_1", follow: true, facts: { place: "in_sink" } },
              { all: [{ object: "cup_1", follow: true, surface: "sink_1", part: "basin" }, { not: { object: "cup_1", follow: true, facts: { place: "in_hand" } } }] },
            ],
          },
          { not: { person_holding: "cup_1" } },
        ],
      },
    ]);
    expect(r.plan.steps.every((s) => s.timeoutMs === 120_000 && s.onTimeout === "fail")).toBe(true);
    // 한 번 부르고 한 차례로 끝난다. 입력은 할 일·판단·World State·평면도·손·승인·조건 낱말, 도구는 계획 전체를 내는 submit_plan 하나(기기를 바꾸는 도구 없음)
    const bodies = llm.bodies().slice(before);
    expect(bodies).toHaveLength(1);
    expect(bodies[0].instructions).toBe(PLANNER_PROMPT);
    const input = bodies[0].input[0].content as string;
    for (const part of [
      "[할 일] 컵 치우기:", "[PAM 판단] 관찰: 관찰 / 이유: 이유", "- 물건 cup_1 컵 · present", "- table_1 식탁 [dining_table]", "- sink_1 싱크대 [sink_counter] · 방 kitchen · 자리 [5, 1] · 싱크볼 [5, 1.2]",
      "[손] 폰 자리 [1, 2] · 방 hall", "[승인]", "person_holding",
    ]) {
      expect(input, part).toContain(part);
    }
    expect(bodies[0].tools.map((x: { name: string }) => x.name)).toEqual(["submit_plan"]);
    // 모델이 바로 계획을 내게 그 함수를 지정하고, 응답 하나에 제출 하나만 받는다
    expect(bodies[0]).toMatchObject({ tool_choice: { type: "function", name: "submit_plan" }, parallel_tool_calls: false });
    expect(bodies[0].max_output_tokens).toBe(6000);
  });

  it("지시문은 놓기 until을 자리 사실 또는 트윈 자리(놓을 자리에 있고 손에 없음)의 any와 사람이 들고 있지 않음을 all로 묶게 하고, 위에 놓기는 면 위, 안에 넣기는 싱크볼 안으로 나눈다. 예의 컵 놓기 조건은 시험 대본과 같다", () => {
    const lines = PLANNER_PROMPT.split("\n");
    const place = lines.find((l) => l.startsWith("- place:"))!;
    expect(place).toContain("「그 물건 자리 사실 또는 트윈 자리 조건(놓을 자리에 있고 손에 없음)」을 any로 묶고, 그 any와 「사람이 그 물건을 들고 있지 않음」(not person_holding)을 all로 묶는다.");
    expect(place).toContain("사람이 그 물건을 들고 있다고 보이면(person_holding) 자리 사실이 와도 넘기지 않는다.");
    const onTop = lines.find((l) => l.startsWith("  - 위에 놓기"))!;
    expect(onTop).toContain(`{"all": [{"any": [{"object": id, "follow": true, "facts": {"place": "on_table"}}, {"all": [{"object": id, "follow": true, "surface": target}, {"not": {"object": id, "follow": true, "facts": {"place": "in_hand"}}}]}]}, {"not": {"person_holding": id}}]}`);
    const inside = lines.find((l) => l.startsWith("  - 안에 넣기"))!;
    expect(inside).toContain("면 위만으로는 넘기지 않는다(싱크볼 옆 조리대도 같은 면이다).");
    expect(inside).toContain(`{"all": [{"any": [{"object": id, "follow": true, "facts": {"place": "in_sink"}}, {"all": [{"object": id, "follow": true, "surface": target, "part": "basin"}, {"not": {"object": id, "follow": true, "facts": {"place": "in_hand"}}}]}]}, {"not": {"person_holding": id}}]}`);
    expect(inside).toContain("싱크볼이 없으면 트윈 자리 조건 없이 자리 사실과 not person_holding을 all로 묶는다.");
    expect(lines).toContain("예(컵 치우기, 식탁 table_1 위 컵 cup_1, 싱크볼이 있는 싱크대 sink_1)");
    const example = lines.find((l) => l.startsWith("4. place sink_1 object cup_1"))!;
    expect(JSON.parse(example.slice(example.indexOf(" until ") + 7))).toEqual(cupSteps({ table: "table_1", sink: "sink_1", cup: "cup_1" })[3]!.until);
    // 도구 설명(submit_plan 단계 until 칸)도 같은 모양을 말한다
    expect(SUBMIT_ARGS.shape.steps.element.shape.until.description).toContain(
      "place는 자리 사실 또는 트윈 자리(손에 없음, not in_hand)를 any로 묶고, 그 any와 사람이 들고 있지 않음(not person_holding)을 all로 묶는다. 트윈 자리는 위에 놓기면 놓을 면(target) 위, 안에 넣기(싱크대)면 그 면의 싱크볼 안(part basin)",
    );
  });

  it("지시문에 do 줄과 안 보이는 물건 집기 줄, 채워 주기 예가 있다. 예의 조건은 시험 대본과 같다", () => {
    const lines = PLANNER_PROMPT.split("\n");
    expect(lines.find((l) => l.startsWith("- 로봇이 없다."))).toContain("사람이 할 일은 go·pick·place·do 단계로 만들고");
    const act = lines.find((l) => l.startsWith("- do:"))!;
    expect(act).toContain("그 자리에서 사람이 하는 일(따르기·붓기). target은 그 일을 받는 World State 물건 id(없으면 평면도 id). command는 「주세요」로 끝난다.");
    expect(act).toContain(`비전으로 볼 수 있으면 until을 쓴다(컵에 따르기: {"object": id, "follow": true, "facts": {"contents": "has_contents"}}).`);
    expect(act).toContain("못 보면 until 없이 두면 사람이 「완료」로 넘긴다.");
    const unseen = lines.find((l) => l.startsWith("- 안 보이는 물건 집기"))!;
    expect(unseen).toContain(`pick target은 그 자리(평면도 id), until은 그 종류 물건이 손에 있음({"object": 종류, "facts": {"place": "in_hand"}}).`);
    // 든 것을 모를 때도 참인 조건(person_holding 종류)은 병 집기에 쓰지 않게 한다
    expect(unseen).toContain(`{"person_holding": 종류}는 든 것을 모를 때도 참이라 다른 물건을 들어도 넘어가니 쓰지 않는다.`);
    expect(lines).toContain("예(컵에 물 채워 주기, 냉장고 fridge_1, 식탁 table_1 위 빈 컵 cup_1)");
    const want = fillSteps({ fridge: "fridge_1", table: "table_1", cup: "cup_1", drink: "물" });
    const example = ["1. go fridge_1", "2. pick fridge_1", "3. go table_1", "4. do cup_1"].map((head) => lines.find((l) => l.startsWith(head))!);
    example.forEach((line, i) => {
      expect(line, String(i)).toContain(`「${want[i]!.command as string}」`);
      expect(JSON.parse(line.slice(line.indexOf(" until ") + 7)), String(i)).toEqual(want[i]!.until);
    });
  });

  it("가짜 모델의 도구 호출로 만든 물 채워 주기 계획은 네 명령·조건 그대로다", async () => {
    llm.scripts = { ...llm.scripts, ...FILL_SCRIPTS };
    const r = await testPlanner(llm).plan(planContext({ decision: decision("컵에 물 채워 주기"), world: view([cup()]), floor: fridgeFloor(), nowIso: "t" }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.plan.task).toBe("컵에 물 채워 주기");
    expect(r.plan.steps.map((s) => [s.kind, s.target, s.command, s.until])).toEqual([
      ["go", "fridge_1", "냉장고로 가 주세요", { phone_near: "fridge_1" }],
      ["pick", "fridge_1", "물병을 꺼내 주세요", { object: "bottle", facts: { place: "in_hand" } }],
      ["go", "table_1", "식탁으로 가 주세요", { phone_near: "table_1" }],
      ["do", "cup_1", "컵에 물을 따라 주세요", { object: "cup_1", follow: true, facts: { contents: "has_contents" } }],
    ]);
    expect(r.plan.view.steps.map((s) => [s.kind, s.label])).toEqual([["move", "냉장고로 가기"], ["act", "물병 꺼내기"], ["move", "식탁으로 가기"], ["act", "컵에 물 따르기"]]);
    expect(r.plan.view.path.length).toBeGreaterThan(1);
    // 입력 글의 할 일 줄에 쓸 수 있는 단계가 있다
    expect(llm.bodies().at(-1).input[0].content).toContain("[할 일] 컵에 물 채워 주기: 사람이 식사 중인데 컵이 비어 있으면 사람이 냉장고에서 물병을 꺼내 와 컵에 물을 따르게 한다.\n- 쓸 수 있는 단계: go, pick, do, place");
  });

  it("콜라 따라 주기 계획의 둘째·넷째 명령은 「콜라를 꺼내 주세요」·「컵에 콜라를 따라 주세요」다. 컵이 탁자 위면 셋째는 그 탁자로 가기다", async () => {
    llm.scripts = { ...llm.scripts, ...FILL_SCRIPTS };
    const cola = decision("컵에 콜라 따라 주기");
    const r = await testPlanner(llm).plan(planContext({ decision: cola, world: view([cup()]), floor: fridgeFloor(), nowIso: "t" }));
    expect(r.ok && r.plan.steps.map((s) => s.command)).toEqual(["냉장고로 가 주세요", "콜라를 꺼내 주세요", "식탁으로 가 주세요", "컵에 콜라를 따라 주세요"]);
    const withSofa = floorPlanFrom({ ...structuredClone(SCENE), objects: [...structuredClone(SCENE.objects), { id: "fridge_1", type: "fridge", room: "kitchen", plan: { position: [7.5, 0.5] } }, { id: "tea_1", type: "coffee_table", room: "hall", plan: { position: [2, 3] } }] });
    const onTea = cup({ position: [2, 0.4, 3], surface: "tea_1", surface_label: "탁자", room: "hall" });
    const t = await testPlanner(llm).plan(planContext({ decision: cola, world: view([onTea]), floor: withSofa, nowIso: "t" }));
    expect(t.ok && t.plan.steps.map((s) => [s.kind, s.target, s.command])).toEqual([
      ["go", "fridge_1", "냉장고로 가 주세요"], ["pick", "fridge_1", "콜라를 꺼내 주세요"], ["go", "tea_1", "탁자로 가 주세요"], ["do", "cup_1", "컵에 콜라를 따라 주세요"],
    ]);
  });

  describe("코치 지시문과 시험 대본의 긴 계획", () => {
    const RAMEN = "라면 끓이기 알려 주기";
    // 수납장·인덕션이 있는 주방(인덕션은 가전 induction_1과 같은 id)
    const kitchen = () => floorPlanFrom({ ...structuredClone(SCENE), objects: [...structuredClone(SCENE.objects),
      { id: "cabinet_1", type: "kitchen_cabinet", room: "kitchen", plan: { position: [4.5, 3.5] } }, { id: "induction_1", type: "induction_counter", room: "kitchen", plan: { position: [6, 0.5] } }] });
    const rctx = () => planContext({ decision: decision(RAMEN), world: view([]), floor: kitchen(), hub: new MemoryHub(DEVICES), nowIso: "t" });

    it("지시문에 코치 절이 있고, 그 요리의 단계나 낱말(라면·냄비)은 지시문에 없다", () => {
      const lines = PLANNER_PROMPT.split("\n");
      const at = lines.indexOf("코치(쓸 수 있는 단계에 device가 없는 할 일)");
      expect(at).toBeGreaterThan(0);
      expect(lines.slice(at + 1, at + 7)).toEqual([
        "- 사람이 스스로 하는 일을 처음부터 끝까지 단계마다 알려 준다. 한 단계에 할 일 하나. 클로이드는 가전을 조작하지 않는다.",
        "- 자리를 옮겨야 하면 go를 먼저 둔다. 물건을 꺼내면 pick, 올려놓으면 place, 그 자리에서 하는 일(받기·넣기·켜기·끄기)은 do.",
        `- 비전이 볼 수 있는 것만 until로 쓴다: 폰 위치(phone_near), 무언가 들고 있음({"person_fact": "holding", "value": "holding_object"}), 싱크대 물 흐름({"fixture": "sink", "facts": {"use": "water_running"}}), 가전 상태(device). 볼 수 없는 일은 until 없이 둔다(사람이 「완료」나 말로 넘긴다).`,
        "- 손으로 가전을 켜거나 끄는 do에는 hand_device를 쓴다. 불·열이 나는 가전을 켜는 do에는 caution(안전 한 줄)을 쓰고, 계획 안에서 그 가전을 끄는 do를 꼭 둔다.",
        `- 시간이 걸리는 일(물 끓기, 익기)은 say로 한 줄 알린 뒤 wait {"elapsed_s": 초}.`,
        "- [지난 수업]이 있으면 그 단계 이름(label)과 순서를 그대로 쓴다.",
      ]);
      expect(PLANNER_PROMPT).not.toMatch(/라면|냄비/);
      expect(PLANNER_PROMPT).toContain("단계 수는 [할 일]의 「단계 한도」까지다.");
    });

    it("계획 입력의 [할 일] 줄에 쓸 수 있는 단계가 go, pick, place, do, wait, say로 나오고 단계 한도가 14개다. 컵 치우기는 8개다", () => {
      const input = planInput(rctx());
      expect(input).toContain(`[할 일] ${RAMEN}: 사람이 라면을 끓이려 하거나 방법을 물으면`);
      expect(input.split("\n").slice(1, 3)).toEqual(["- 쓸 수 있는 단계: go, pick, place, do, wait, say", "- 단계 한도: 14개"]);
      expect(input).toContain("- induction_1 인덕션 [cooktop 인덕션]");
      expect(planInput(planContext({ decision: decision("컵 치우기"), world: view([cup()]), floor: floor() })).split("\n")[2]).toBe("- 단계 한도: 8개");
    });

    it("계획 입력에 [지난 수업] 줄이 있다(코치 행동이고 기록이 있을 때): 몇 번 했는지와 단계마다 혼자 해낸 횟수", () => {
      const lesson = { task: RAMEN, runs: 2, updatedAt: "t", steps: [{ label: "냄비 꺼내기", alone: 2 }, { label: "물 받기", alone: 0 }] };
      const input = planInput({ ...rctx(), lesson });
      expect(input).toContain("[지난 수업] 2번 함\n- 냄비 꺼내기 · 혼자 2번\n- 물 받기 · 혼자 0번\n[손]");
      expect(planInput(rctx())).not.toContain("[지난 수업]");
      expect(planInput({ ...rctx(), lesson: null })).not.toContain("[지난 수업]");
    });

    it("가짜 모델의 도구 호출로 만든 라면 계획은 13단계이고 사람 명령이 모두 「주세요」로 끝나며 화면 단계 종류가 맞다. 불 켜기에는 안전 문구가, 끝에는 불 끄기가 있다", async () => {
      llm.scripts = { ...llm.scripts, ...ramenScripts() };
      const r = await testPlanner(llm).plan(rctx());
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.plan.steps.map((s) => [s.kind, s.target, s.command ?? s.text])).toEqual([
        ["go", "cabinet_1", "수납장으로 가 주세요"], ["pick", "cabinet_1", "냄비를 꺼내 주세요"], ["go", "sink_1", "싱크대로 가 주세요"], ["do", "sink_1", "냄비에 물을 받아 주세요"],
        ["go", "induction_1", "인덕션으로 가 주세요"], ["place", "induction_1", "냄비를 인덕션에 올려 주세요"], ["do", "induction_1", "인덕션을 켜 주세요"],
        ["say", null, "물이 끓을 때까지 기다려요."], ["wait", null, null], ["do", "induction_1", "면과 스프를 넣어 주세요"], ["wait", null, null],
        ["do", "induction_1", "인덕션을 꺼 주세요"], ["say", null, "라면이 다 됐어요."],
      ]);
      for (const s of r.plan.steps.filter((x) => ["go", "pick", "place", "do"].includes(x.kind))) expect(s.command, s.label).toMatch(/주세요$/);
      expect(r.plan.view.steps.map((s) => s.kind)).toEqual(["move", "act", "move", "act", "move", "act", "act", "ask", "wait", "act", "wait", "act", "ask"]);
      expect(r.plan.steps[6]).toMatchObject({ hand: { deviceId: "induction_1", to: "on" }, caution: "냄비가 뜨거워져요." });
      expect(r.plan.steps[11]).toMatchObject({ hand: { deviceId: "induction_1", to: "off" }, caution: null });
      expect(r.plan.steps[1]!.until).toEqual({ person_fact: "holding", value: "holding_object" });
      expect(r.plan.steps[8]!.until).toEqual({ elapsed_s: 240 });
      // 가전 단계가 없다: 클로이드는 가전을 조작하지 않는다
      expect(r.plan.steps.some((s) => s.kind === "device" || s.device)).toBe(false);
      // 기다리기를 줄인 판(흐름 시험용)
      expect(ramenSteps({ cabinet: "cabinet_1", sink: "sink_1", cooktop: "induction_1", cooktopDevice: "induction_1", waitS: 2 }).filter((s) => s.kind === "wait").map((s) => s.until)).toEqual([{ elapsed_s: 2 }, { elapsed_s: 2 }]);
    });
  });

  it("계획 입력: 싱크볼이 있는 평면도 자리는 싱크볼 점을, 싱크볼 안 물건은 면 뒤에 「싱크볼 안」을 쓴다", () => {
    const inBasin = { ...cup(), surface: "sink_1", surface_part: "basin" as const };
    const input = planInput(planContext({ decision: decision("컵 치우기"), world: view([inBasin]), floor: smallFloor(), nowIso: "t" }));
    expect(input).toContain("- 물건 cup_1 컵 · present · 면 sink_1 싱크볼 안 · ");
    expect(input).toContain("- table_1 식탁 [dining_table] · 방 kitchen · 자리 [7, 3]\n");
  });

  it("실행 추적이 이미 치운 물건(placed)은 계획 입력 물건 줄에 「이미 치움」을 붙이고, 그 물건을 집거나 놓는 계획은 제출 검사가 버린다", () => {
    const two = view([{ ...cup(), surface: "sink_1", surface_part: "basin" }, cup({ id: "cup_2", last_seen_ms: 8_000 })]);
    const placed = new Map([["cup_1", { target: "sink_1", part: "basin" as const, atMs: 9_000 }]]);
    const c = planContext({ decision: decision("컵 치우기"), world: two, floor: floor(), placed });
    const input = planInput(c);
    expect(input).toContain("- 물건 cup_1 컵 · present · 이미 치움 · 면 sink_1 싱크볼 안 · ");
    expect(input).toContain("- 물건 cup_2 컵 · present · 면 table_1 · ");
    expect(PLANNER_PROMPT.split("\n")).toContain("- World State 물건 줄에 「이미 치움」이 붙은 물건은 앞 계획이 이미 놓기를 끝낸 것이다. pick·place 물건으로 쓰지 않는다.");
    // 치운 컵을 대상으로 삼은 계획은 집기 단계에서 버리고, 치우지 않은 컵은 받는다
    const ids = { table: "table_1", sink: "sink_1" };
    expect(new PlanDraft(c).submit({ steps: cupSteps({ ...ids, cup: "cup_1" }) })).toMatchObject({ ok: false, error: expect.stringMatching(/^2번 단계: .*이미 치운 물건입니다.*cup_1/) });
    expect(new PlanDraft(c).submit({ steps: cupSteps({ ...ids, cup: "cup_2" }) })).toMatchObject({ ok: true });
    const d = new PlanDraft(c);
    expect(d.add({ step: 1, ...cupSteps({ ...ids, cup: "cup_1" })[3]! })).toMatchObject({ ok: false, error: expect.stringMatching(/이미 치운 물건입니다.*cup_1/) });
    // 치운 것이 없으면 표시도 검사도 없다
    expect(planInput(planContext({ decision: decision("컵 치우기"), world: two, floor: floor() }))).not.toContain("이미 치움");
    expect(new PlanDraft(planContext({ decision: decision("컵 치우기"), world: two, floor: floor() })).submit({ steps: cupSteps({ ...ids, cup: "cup_1" }) })).toMatchObject({ ok: true });
  });
});

describe("계획 모드: 기기 단계와 승인", () => {
  it("에어컨 켜기는 처음이면 첫 단계 전에 묻고, 승인 뒤 기기 단계가 정책을 거쳐 켜고 상태가 켜짐이면 완료. 기기 단계는 실제 폰 명령이 없다", async () => {
    const approvals = store();
    const { t, decide, settle, phone, hub, plans, exec } = rig({ approvals });
    await decide(decision("에어컨 켜기"));
    expect(plans.current()).toMatchObject({ goal: "에어컨 켜기", dryRun: false, steps: [{ kind: "device", label: "거실 에어컨 켜기", target: { deviceId: "ac_living" } }] });
    expect(phone).toEqual([{ type: "command", id: "plan:pam-1", step: "plan:pam-1:approve", text: APPROVAL_TEXT.ask("에어컨 켜기"), vision: null, choices: [{ id: "approve", label: "승인" }, { id: "reject", label: "거절" }], target: null, speak: true }]);
    expect(hub.get("ac_living")!.twin.power).toBe("off");
    expect(t.onAnswer("plan:pam-1", "plan:pam-1:approve", "approve")).toBe(true);
    await settle();
    expect(hub.get("ac_living")!.twin.power).toBe("on");
    t.tick();
    expect(plans.current()).toMatchObject({ status: "done" });
    expect(exec().map((l) => l.state)).toEqual(["decided", "planned", "running", "done"]);
    expect(phone.slice(1)).toEqual([{ type: "command_clear", id: "plan:pam-1" }]);
    expect(approvals.memory()).toEqual({ always: { "task:에어컨 켜기": "t" } });
  });

  it("위험 목록 가전 단계는 승인한 할 일이어도 그 단계에서 늘 묻고 기억하지 않는다. 거절이면 켜지 않고 취소로 닫는다", async () => {
    const approvals = store({ "task:인덕션 켜기": "approve" });
    const a = rig({ approvals, task: COOKTOP_TASK });
    await a.decide(decision("인덕션 켜기"));
    await a.settle();
    expect(a.phone.at(-1)).toMatchObject({ type: "command", step: "plan:pam-1:1:approve", text: "인덕션 켜기를 할까요?", choices: [{ id: "approve", label: "승인" }, { id: "reject", label: "거절" }] });
    expect(a.hub.get("induction_1")!.twin.power).toBe("off");
    expect(a.t.onAnswer("plan:pam-1", "plan:pam-1:1:approve", "approve")).toBe(true);
    await a.settle();
    expect(a.hub.get("induction_1")!.twin.power).toBe("on");
    expect(a.plans.current()).toMatchObject({ status: "done" });
    expect(approvals.memory()).toEqual({ always: { "task:인덕션 켜기": "t" } });
    const b = rig({ approvals, task: COOKTOP_TASK });
    await b.decide(decision("인덕션 켜기"));
    await b.settle();
    expect(b.t.onHeard("거절")).toMatchObject({ id: "reject" });
    expect(b.hub.get("induction_1")!.twin.power).toBe("off");
    expect(b.plans.current()).toMatchObject({ status: "cancelled" });
    expect(b.exec().at(-1)).toMatchObject({ state: "failed", text: APPROVAL_TEXT.refused });
    expect(b.policy.pending()).toEqual([]);
  });
});

describe("계획 모드: 행동 중 기다리기", () => {
  it("세탁물 옮기기: 세탁이 멈출 때까지 실제 폰에는 아무것도 보내지 않고 대시보드 진행도만 기다리기, 멈추면 사람 단계 명령, 마지막에 건조기를 켠다", async () => {
    const r = rig({ approvals: store({ "task:세탁물 건조기로 옮기기": "approve" }) });
    await r.decide(decision("세탁물 건조기로 옮기기"));
    const plan = r.plans.current()!;
    expect(plan.steps.map((s) => s.kind)).toEqual(["wait", "move", "act", "move", "act", "device"]);
    // 발코니는 바닥이 낮아 로봇은 못 가지만 사람이 걷는 길은 이어진다
    expect(plan.legs).toHaveLength(2);
    expect(r.steps()).toEqual(["active", "pending", "pending", "pending", "pending", "pending"]);
    expect(r.phone).toEqual([]);
    expect(r.t.waiting()).toBe(true);
    expect(sayLine({ plan: r.plans.current(), command: null, world: null, nowMs: 0 })).toBe("세탁 멈춤을 기다리고 있어요.");
    // 기다리는 동안 다른 행동 판단은 쓰지 않는다
    r.clock.t += 5_000;
    await r.decide({ ...decision("컵 치우기", "pam-2", 2), atMs: r.clock.t });
    expect(r.exec().at(-1)).toMatchObject({ plan_id: "plan:pam-2", text: EXEC_TEXT.busy });
    expect(r.planned.map((d) => d.id)).toEqual(["pam-1"]);
    for (let i = 0; i < 4; i++) { r.clock.t += 60_000; r.t.tick(); }
    expect(r.phone).toEqual([]);
    expect((await r.hub.command("washer_1", { type: "stop" })).ok).toBe(true);
    r.t.onWorld();
    expect(r.spoken()).toEqual(["세탁기로 가 주세요"]);
    expect(r.t.waiting()).toBe(false);
    for (const [i, text] of [[2, "세탁물을 꺼내 주세요"], [3, "건조기로 가 주세요"], [4, "세탁물을 건조기에 넣어 주세요"]] as const) {
      r.t.onAnswer("plan:pam-1", `plan:pam-1:${i}`, "done");
      expect(r.spoken().at(-1)).toBe(text);
    }
    r.t.onAnswer("plan:pam-1", "plan:pam-1:5", "done");
    expect(r.phone.at(-1)).toEqual({ type: "command_clear", id: "plan:pam-1" });
    await r.settle();
    expect(r.hub.get("dryer_1")!.twin.running).toBe(true);
    r.t.onWorld();
    expect(r.plans.current()).toMatchObject({ status: "done" });
  });

  it("기다리기가 시간 안에 끝나지 않으면 실제 폰에 계속할지 한 번 묻고, 계속이면 시간만 더 주고(폰 명령 없음) 또 넘으면 실패, 그만이면 취소", async () => {
    llm.scripts["세탁물 건조기로 옮기기"] = laundry(60);
    try {
      const a = rig({ approvals: store({ "task:세탁물 건조기로 옮기기": "approve" }) });
      await a.decide(decision("세탁물 건조기로 옮기기"));
      a.clock.t += 60_001;
      a.t.tick();
      expect(a.phone).toEqual([{
        type: "command", id: "plan:pam-1", step: "plan:pam-1:1:again", text: AGAIN_TEXT.ask("세탁 멈춤"), vision: null,
        choices: [{ id: "continue", label: "계속" }, { id: "stop", label: "그만" }], target: null, speak: true,
      }]);
      expect(AGAIN_TEXT.ask("세탁 멈춤")).toBe("세탁 멈춤을 계속할까요?");
      expect(a.t.onAnswer("plan:pam-1", "plan:pam-1:1:again", "continue")).toBe(true);
      expect(a.phone.at(-1)).toEqual({ type: "command_clear", id: "plan:pam-1" });
      a.clock.t += 59_000;
      a.t.tick();
      expect(a.plans.current()).toMatchObject({ status: "running" });
      a.clock.t += 1_001;
      a.t.tick();
      expect(a.exec().at(-1)).toMatchObject({ state: "failed", text: EXEC_TEXT.timeout });
      expect(a.plans.current()).toMatchObject({ status: "failed" });
      const b = rig({ approvals: store({ "task:세탁물 건조기로 옮기기": "approve" }) });
      await b.decide(decision("세탁물 건조기로 옮기기"));
      b.clock.t += 60_001;
      b.t.tick();
      expect(b.t.onHeard("그만")).toMatchObject({ id: "stop" });
      expect(b.plans.current()).toMatchObject({ status: "cancelled" });
    } finally {
      llm.scripts["세탁물 건조기로 옮기기"] = laundry();
    }
  });

  it("기다리는 동안 실제 폰 명령이 없어도 말 「그만」은 계획을 그만둔다", async () => {
    const r = rig({ approvals: store({ "task:세탁물 건조기로 옮기기": "approve" }) });
    await r.decide(decision("세탁물 건조기로 옮기기"));
    expect(r.t.openCommand()).toBeNull();
    expect(r.t.onHeard("그만해")).toMatchObject({ id: "stop" });
    expect(r.plans.current()).toMatchObject({ status: "cancelled" });
    expect(r.t.waiting()).toBe(false);
  });

  it("행동 중 기다리는 동안 판단 호출은 PAM을 부르지 않고 한 번 기록한다", async () => {
    const pam = await startFakePam();
    try {
      const logs: BrainLog[] = [];
      let hold = true;
      const d = new Decider({
        pam: new PamClient({ url: pam.url }), world: new WorldState({ surfaces: () => [], floorAt: () => 0, roomAt: () => null, devices: () => [] }),
        trigger: new Trigger({ mode: "event", minGapMs: 0, periodMs: 1000, idleStopMs: 1e9, liveMs: 10_000, maxInflight: 1 }, 0),
        tasks: () => [...CUP_TASKS], memory: () => ({ memory: CUP_FSM_MEMORY, kind: "fsm" as const, version: 0 }), emit: (l) => logs.push(l), offsetMinutes: 540,
        clock: { now: () => 10_000 }, hold: () => hold,
      });
      d.onChanges([{ kind: "person_gone", at_ms: 9000, subject: "person", text: "사람 안 보임", meaningful: true }]);
      d.tick();
      d.tick();
      await d.idle();
      expect(pam.bodies).toEqual([]);
      expect(logs.filter((l) => l.type === "trigger").map((l) => l.type === "trigger" && l.text)).toEqual(["할 일 중 기다리는 동안 판단을 멈춤"]);
      hold = false;
      d.tick();
      await d.idle();
      expect(pam.bodies).toHaveLength(1);
    } finally {
      await pam.close();
    }
  });
});

describe("계획 모드: 계획 검사", () => {
  const ctx = (action = "컵 치우기"): PlanContext => planContext({ decision: decision(action), world: view([cup()]), floor: floor(), hub: new MemoryHub(DEVICES) });
  const cupIds = { table: "table_1", sink: "sink_1", cup: "cup_1" };
  const ok = (draft: PlanDraft, step: number, s: Record<string, unknown>) => expect(draft.add({ step, ...s })).toMatchObject({ ok: true, step });
  const bad = (s: Record<string, unknown>, why: RegExp, action?: string) => {
    const r = new PlanDraft(ctx(action)).add({ step: 1, ...s });
    expect(r.ok, JSON.stringify(s)).toBe(false);
    expect(r.ok ? "" : r.error).toMatch(why);
  };
  const go = cupSteps(cupIds)[0]!;

  it("사람 명령은 「주세요」로 끝나고, 대상·조건 낱말·시간·화면 글이 맞아야 한다", () => {
    bad({ ...go, command: "식탁으로 갈게요" }, /주세요/);
    bad({ ...go, target: "table_9" }, /평면도 물건 id/);
    bad({ ...go, target: "kitchen" }, /그 방 물건: table_1, sink_1/);
    bad({ ...go, until: { object: "cup_1", facts: { place: "on_moon" } } }, /조건 낱말/);
    bad({ ...go, until: { phone_near: "table_9" } }, /없는 자리/);
    bad({ ...go, until: { object: "cup_7", facts: { place: "in_hand" } } }, /없는 물건 id/);
    bad({ ...go, timeout_s: 5 }, /10~1800/);
    bad({ ...go, label: "식탁 → 싱크대" }, /화면 글/);
    bad({ ...cupSteps(cupIds)[1]!, target: "bottle_1" }, /World State 물건/);
    // 놓기 조건의 면은 배치에 있는 자리다
    const place = cupSteps(cupIds)[3]!;
    bad({ ...place, until: JSON.parse(JSON.stringify(place.until).replace(`"surface":"sink_1"`, `"surface":"sink_9"`)) }, /until: 없는 자리: sink_9/);
    // 싱크볼 안 조건은 싱크볼이 있는 자리만
    bad({ ...place, until: JSON.parse(JSON.stringify(place.until).replace(`"surface":"sink_1"`, `"surface":"table_1"`)) }, /until: 싱크볼이 없는 자리: table_1/);
  });

  it("그 할 일에 쓸 수 있는 단계만 받는다: 컵 치우기에 가전·기다리기를 붙이면 버리고, 가전 단계는 target 하나와 그 도구가 만드는 상태만 본다", () => {
    bad({ kind: "device", label: "세탁기 시작", target: "washer_1", tool: "start", timeout_s: 60 }, /device 단계를 쓰지 않습니다/);
    bad({ kind: "wait", label: "잠시", until: { elapsed_s: 5 }, timeout_s: 60 }, /wait 단계를 쓰지 않습니다/);
    bad({ kind: "device", label: "건조기 시작", target: "washer_1", tool: "start", timeout_s: 60 }, /washer 가전을 쓰지 않습니다/, "세탁물 건조기로 옮기기");
    bad({ kind: "device", label: "건조기 시작", target: "dryer_1", tool: "start", args: { device_id: "washer_1" }, timeout_s: 60 }, /device_id/, "세탁물 건조기로 옮기기");
    bad({ kind: "device", label: "건조기 시작", target: "dryer_1", tool: "start", until: { elapsed_s: 0 }, timeout_s: 60 }, /device until/, "세탁물 건조기로 옮기기");
    bad({ kind: "device", label: "건조기 시작", target: "dryer_1", tool: "start", until: { device: "dryer", state: "running" }, timeout_s: 60 }, /device until/, "세탁물 건조기로 옮기기");
    bad({ kind: "device", label: "에어컨 끄기", target: "ac_living", tool: "turn_off", timeout_s: 60 }, /turn_off 도구를 쓰지 않습니다/, "에어컨 켜기");
    bad({ kind: "wait", label: "세탁 멈춤", timeout_s: 60 }, /until가 있어야/, "세탁물 건조기로 옮기기");
    bad({ kind: "wait", label: "세탁 멈춤", until: { elapsed_s: 60 }, timeout_s: 20_000 }, /10~14400/, "세탁물 건조기로 옮기기");
  });

  it("코치 행동(라면 끓이기 알려 주기)에는 device 단계를 쓸 수 없고 do가 꼭 있어야 한다", () => {
    const RAMEN = "라면 끓이기 알려 주기";
    bad({ kind: "device", label: "인덕션 켜기", target: "induction_1", tool: "turn_on", timeout_s: 60 }, /device 단계를 쓰지 않습니다. 쓸 수 있는 단계: go, pick, place, do, wait, say/, RAMEN);
    const d = new PlanDraft(ctx(RAMEN));
    ok(d, 1, { kind: "go", label: "싱크대로 가기", target: "sink_1", command: "싱크대로 가 주세요", timeout_s: 120 });
    expect(d.finish()).toMatchObject({ ok: false, error: expect.stringMatching(/do 단계가 있어야/) });
    ok(d, 2, { kind: "do", label: "물 받기", target: "sink_1", command: "물을 받아 주세요", timeout_s: 120 });
    expect(d.finish()).toMatchObject({ ok: true });
  });

  it("단계는 번호 순서대로 두고, 틀리면 그 번호부터 지워 같은 번호로 고쳐 보내게 하며, 빠진 단계가 있으면 끝내지 않는다", () => {
    const d = new PlanDraft(ctx());
    const steps = cupSteps(cupIds);
    expect(d.add({ step: 2, ...steps[1]! })).toMatchObject({ ok: false, error: expect.stringMatching(/1번부터/) });
    ok(d, 1, steps[0]!);
    expect(d.add({ step: 2, ...steps[1]!, command: "컵을 들게요" })).toMatchObject({ ok: false, error: expect.stringMatching(/^2번 단계: .*주세요/) });
    expect(d.add({ step: 3, ...steps[2]! })).toMatchObject({ ok: false, error: expect.stringMatching(/2번부터/) });
    expect(d.finish()).toMatchObject({ ok: false, error: expect.stringMatching(/2번 단계가 틀린 채/) });
    ok(d, 2, steps[1]!);
    ok(d, 3, steps[2]!);
    expect(d.finish()).toMatchObject({ ok: false, error: expect.stringMatching(/place 단계가 있어야/) });
    ok(d, 3, steps[2]!);
    ok(d, 4, steps[3]!);
    expect(d.finish()).toMatchObject({ ok: true, plan: { steps: [{ kind: "go" }, { kind: "pick" }, { kind: "go" }, { kind: "place" }] } });
    // 알림은 지금 상태를 알리는 말이다(클로이드가 스스로 하겠다는 말이 아니다)
    bad({ kind: "say", label: "알림", text: "세탁물을 건조기로 옮길게요", timeout_s: 10 }, /게요/, "에어컨 켜기");
    // World State에 없는 것(세탁물)을 조건에 쓰면 조건 없이 두라고 알려 준다
    bad({ kind: "pick", label: "세탁물 꺼내기", target: "washer_1", command: "세탁물을 꺼내 주세요", until: { person_holding: "cloth" }, timeout_s: 60 }, /until 없이/, "세탁물 건조기로 옮기기");
  });

  it("단계는 8개까지, 질문은 마지막에만, 내려놓기 물건은 앞에서 집은 물건이다", () => {
    const many = new PlanDraft(ctx());
    for (let i = 1; i <= 8; i++) ok(many, i, go);
    expect(many.add({ step: 9, ...go })).toMatchObject({ ok: false, error: expect.stringMatching(/8개까지/) });
    const ask = new PlanDraft(ctx("사용자에게 물어보기"));
    const q = { kind: "ask", label: "폰으로 물어보기", question: "컵을 치울까요?", choices: [{ id: "a", label: "네" }, { id: "b", label: "아니요" }], timeout_s: 120 };
    ok(ask, 1, q);
    ok(ask, 2, { kind: "say", label: "알림", text: "컵이 그대로 있어요", timeout_s: 10 });
    expect(ask.finish()).toMatchObject({ ok: false, error: expect.stringMatching(/마지막 단계/) });
    const view2 = view([cup(), cup({ id: "cup_2", last_seen_ms: 8_000 })]);
    const swap = new PlanDraft(planContext({ decision: decision("컵 치우기"), world: view2, floor: floor() }));
    cupSteps(cupIds).slice(0, 3).forEach((s, i) => ok(swap, i + 1, s));
    ok(swap, 4, { ...cupSteps(cupIds)[3]!, object: "cup_2", until: { object: "cup_2", follow: true, facts: { place: "in_sink" } } });
    expect(swap.finish()).toMatchObject({ ok: false, error: expect.stringMatching(/앞에서 집은 물건/) });
  });

  describe("do 단계와 집는 물건 종류(채워 주기)", () => {
    const WATER = "컵에 물 채워 주기";
    const fillIds = { fridge: "fridge_1", table: "table_1", cup: "cup_1", drink: "물" as const };
    const bottle = cup({ id: "bottle_1", cls: "bottle", position: [7.5, 1, 0.6], surface: null, surface_label: null });
    const fctx = (action = WATER, objects: WorldObject[] = [cup()]): PlanContext => planContext({ decision: decision(action), world: view(objects), floor: fridgeFloor(), hub: new MemoryHub(DEVICES) });
    const fbad = (s: Record<string, unknown>, why: RegExp, c: PlanContext = fctx()) => {
      const r = new PlanDraft(c).add({ step: 1, ...s });
      expect(r.ok, JSON.stringify(s)).toBe(false);
      expect(r.ok ? "" : r.error).toMatch(why);
    };
    const [goFridge, pick, goTable, pour] = fillSteps(fillIds) as [Record<string, unknown>, Record<string, unknown>, Record<string, unknown>, Record<string, unknown>];

    it("물 채워 주기 계획(go 냉장고 · pick 냉장고 · go 식탁 · do 컵)은 통과하고 화면 단계 종류는 move·act·move·act다", () => {
      const r = new PlanDraft(fctx()).submit({ steps: fillSteps(fillIds) });
      expect(r).toMatchObject({ ok: true });
      if (!r.ok) return;
      expect(r.plan.steps.map((s) => [s.kind, s.target, s.object, s.command])).toEqual([
        ["go", "fridge_1", null, "냉장고로 가 주세요"], ["pick", "fridge_1", null, "물병을 꺼내 주세요"], ["go", "table_1", null, "식탁으로 가 주세요"], ["do", "cup_1", null, "컵에 물을 따라 주세요"],
      ]);
      expect(r.plan.steps[3]!.until).toEqual({ object: "cup_1", follow: true, facts: { contents: "has_contents" } });
      expect(r.plan.view.steps.map((s) => s.kind)).toEqual(["move", "act", "move", "act"]);
      expect(r.plan.view.steps.map((s) => s.target?.objectId)).toEqual(["fridge_1", "fridge_1", "table_1", "cup_1"]);
      expect(r.plan.view.steps[3]!.target).toEqual({ objectId: "cup_1", position: [7, 3] });
      expect(r.plan.view.goal).toBe(WATER);
    });

    it("do에는 target과 command가 있어야 하고 object를 쓰면 버린다. until은 없어도 된다", () => {
      fbad({ ...pour, target: undefined }, /do에는 target가 있어야/);
      fbad({ ...pour, command: undefined }, /do에는 command가 있어야/);
      fbad({ ...pour, command: "컵에 물을 따를게요" }, /주세요/);
      fbad({ ...pour, object: "cup_1" }, /do에는 object를 쓰지 않습니다/);
      fbad({ ...pour, timeout_s: 5 }, /do timeout_s는 10~1800초/);
      fbad({ ...pour, target: "cup_9" }, /do target은 보이는 World State 물건 id나 평면도 id여야 합니다: cup_9/);
      expect(new PlanDraft(fctx()).add({ step: 1, ...pour, until: undefined })).toMatchObject({ ok: true });
      // 평면도 자리에서 하는 일도 받는다(컵이 안 보일 때)
      expect(new PlanDraft(fctx()).add({ step: 1, ...pour, target: "table_1", until: undefined })).toMatchObject({ ok: true });
    });

    it("do target이 World State 물건이면 그 행동의 대상 종류(컵)여야 하고, 이미 치운 물건이면 버린다", () => {
      fbad({ ...pour, target: "bottle_1", until: undefined }, /이 할 일은 cup 물건에 합니다/, fctx(WATER, [cup(), bottle]));
      const placed = new Map([["cup_1", { target: "sink_1", atMs: 9_000 }]]);
      fbad(pour, /이미 치운 물건/, { ...fctx(), placed });
    });

    it("채워 주기의 pick은 병이 안 보이면 평면도 id(냉장고)만으로 통과하고, 병이 보이면 그 병 id를 받으며, 컵을 집으면 버린다", () => {
      expect(new PlanDraft(fctx()).add({ step: 1, ...pick })).toMatchObject({ ok: true });
      const seen = new PlanDraft(fctx(WATER, [cup(), bottle]));
      expect(seen.add({ step: 1, ...pick, target: "bottle_1", until: { object: "bottle_1", follow: true, facts: { place: "in_hand" } } })).toMatchObject({ ok: true });
      fbad({ ...pick, target: "cup_1", until: undefined }, /이 할 일은 bottle 물건을 집습니다/);
      fbad({ kind: "place", label: "컵 넣기", target: "fridge_1", object: "cup_1", command: "컵을 넣어 주세요", timeout_s: 120 }, /이 할 일은 bottle 물건을 내려놓습니다/);
    });

    it("컵 치우기의 pick은 지금처럼 컵만 받는다(컵이 안 보이는 평면도 id 집기는 버린다). 컵 치우기에는 do를 쓰지 않는다", () => {
      const c = fctx("컵 치우기", [cup(), bottle]);
      fbad({ ...cupSteps(cupIds)[1]!, target: "table_1", until: undefined }, /이 할 일은 cup 물건을 집습니다/, c);
      fbad({ ...cupSteps(cupIds)[1]!, target: "bottle_1", until: undefined }, /이 할 일은 cup 물건을 집습니다/, c);
      expect(new PlanDraft(c).add({ step: 1, ...cupSteps(cupIds)[1]! })).toMatchObject({ ok: true });
      fbad(pour, /do 단계를 쓰지 않습니다/, c);
    });

    it("채워 주기에 do가 빠지면 끝내지 않는다", () => {
      const d = new PlanDraft(fctx());
      [goFridge, pick, goTable].forEach((s, i) => ok(d, i + 1, s));
      expect(d.finish()).toMatchObject({ ok: false, error: expect.stringMatching(/do 단계가 있어야/) });
      ok(d, 4, pour);
      expect(d.finish()).toMatchObject({ ok: true });
    });
  });

  describe("코치 계획: 14단계, 손으로 켜고 끄는 가전, 안전 문구", () => {
    const RAMEN = "라면 끓이기 알려 주기";
    const go = { kind: "go", label: "싱크대로 가기", target: "sink_1", command: "싱크대로 가 주세요", timeout_s: 120 };
    const on = { kind: "do", label: "인덕션 켜기", target: "induction_1", command: "인덕션을 켜 주세요", hand_device: { id: "induction_1", to: "on" }, caution: "냄비가 뜨거워져요.", timeout_s: 120 };
    const off = { kind: "do", label: "인덕션 끄기", target: "induction_1", command: "인덕션을 꺼 주세요", hand_device: { id: "induction_1", to: "off" }, timeout_s: 120 };
    // 인덕션이 평면도에도 있는 집
    const cfloor = () => floorPlanFrom({ ...structuredClone(SCENE), objects: [...structuredClone(SCENE.objects), { id: "induction_1", type: "induction_counter", room: "kitchen", plan: { position: [6, 0.5] } }] });
    const cctx = (action = RAMEN): PlanContext => planContext({ decision: decision(action), world: view([]), floor: cfloor(), hub: new MemoryHub(DEVICES) });
    const cbad = (s: Record<string, unknown>, why: RegExp, action = RAMEN) => {
      const r = new PlanDraft(cctx(action)).add({ step: 1, ...s });
      expect(r.ok, JSON.stringify(s)).toBe(false);
      expect(r.ok ? "" : r.error).toMatch(why);
    };

    it("코치 행동은 14단계까지 받고 15단계는 버린다. 컵 치우기는 지금처럼 9단계를 버린다", () => {
      expect([PLAN_LIMITS.maxSteps, PLAN_LIMITS.hardMaxSteps]).toEqual([8, 14]);
      const many = (n: number, action: string) => new PlanDraft(cctx(action)).submit({ steps: [...Array.from({ length: n - 1 }, () => go), action === RAMEN ? { kind: "do", label: "물 받기", target: "sink_1", command: "물을 받아 주세요", timeout_s: 120 } : go] });
      expect(many(14, RAMEN)).toMatchObject({ ok: true });
      expect(many(15, RAMEN)).toMatchObject({ ok: false, error: expect.stringMatching(/단계는 14개까지/) });
      expect(many(9, "컵 치우기")).toMatchObject({ ok: false, error: expect.stringMatching(/단계는 8개까지/) });
      const d = new PlanDraft(cctx("컵 치우기"));
      for (let i = 1; i <= 8; i++) ok(d, i, go);
      expect(d.add({ step: 9, ...go })).toMatchObject({ ok: false, error: expect.stringMatching(/8개까지/) });
      // 도구 인자 한도는 가장 긴 계획(14)이고, 행동마다 한도는 제출 검사가 본다
      expect(SUBMIT_ARGS.safeParse({ steps: Array.from({ length: 14 }, () => go) }).success).toBe(true);
      expect(SUBMIT_ARGS.safeParse({ steps: Array.from({ length: 15 }, () => go) }).success).toBe(false);
    });

    it("인덕션을 켜는 do에 caution이 없으면 버리고, caution이 부탁·다짐 말이면 버린다", () => {
      cbad({ ...on, caution: undefined }, /caution\(안전 한 줄\)이 있어야 합니다/);
      cbad({ ...on, caution: "조심해 주세요" }, /caution은 지금 상태를 알리는 말/);
      cbad({ ...on, caution: "불을 켤게요" }, /caution은 지금 상태를 알리는 말/);
      cbad({ ...on, caution: "뜨거워요 → 조심" }, /화면 글 규칙/);
      expect(new PlanDraft(cctx()).add({ step: 1, ...on })).toMatchObject({ ok: true });
    });

    it("켜기만 있고 끄기가 없으면 끝내지 않는다. 끄는 do가 뒤에 있으면 끝내고, 실행 단계에 손으로 다루는 가전과 안전 문구가 남는다", () => {
      const d = new PlanDraft(cctx());
      ok(d, 1, on);
      expect(d.finish()).toMatchObject({ ok: false, error: expect.stringMatching(/켠 가전은 계획 안에서 끕니다/) });
      // 끄기가 켜기보다 앞에 있는 것은 끈 것이 아니다
      const wrong = new PlanDraft(cctx());
      ok(wrong, 1, off);
      ok(wrong, 2, on);
      expect(wrong.finish()).toMatchObject({ ok: false, error: expect.stringMatching(/켠 가전은 계획 안에서 끕니다/) });
      ok(d, 2, off);
      const r = d.finish();
      expect(r).toMatchObject({ ok: true });
      if (!r.ok) return;
      expect(r.plan.steps.map((s) => [s.kind, s.hand, s.caution])).toEqual([
        ["do", { deviceId: "induction_1", to: "on" }, "냄비가 뜨거워져요."], ["do", { deviceId: "induction_1", to: "off" }, null],
      ]);
      const devices = cctx().devices;
      expect(r.plan.steps.map((s) => riskyHand(s, devices))).toEqual([true, false]);
      // 화면 계획은 사람 단계(act)다: 가전 단계(device)가 아니라 실제 가전을 부르지 않는다
      expect(r.plan.view.steps.map((s) => s.kind)).toEqual(["act", "act"]);
      expect(r.plan.view.dryRun).toBe(true);
    });

    it("hand_device·caution은 do에만 쓰고, hand_device는 이 집 가전이어야 하며 until은 없거나 그 가전 상태 하나다", () => {
      cbad({ ...go, hand_device: { id: "induction_1", to: "on" } }, /go에는 hand_device를 쓰지 않습니다/);
      cbad({ ...go, caution: "뜨거워요." }, /go에는 caution를 쓰지 않습니다/);
      cbad({ ...on, hand_device: { id: "induction_9", to: "on" } }, /이 집에 없는 가전입니다: induction_9/);
      cbad({ ...on, hand_device: { id: "induction_1", to: "toggle" } }, /hand_device/);
      cbad({ ...on, until: { elapsed_s: 3 } }, /hand_device until은 \{"device": "induction_1", "state": on\|/);
      cbad({ ...on, until: { device: "induction_1", state: "off" } }, /hand_device until/);
      expect(new PlanDraft(cctx()).add({ step: 1, ...on, until: { device: "induction_1", state: "on" } })).toMatchObject({ ok: true });
      expect(new PlanDraft(cctx()).add({ step: 1, ...off, until: { device: "induction_1", state: "off" } })).toMatchObject({ ok: true });
    });

    it("위험 목록이 아닌 가전(에어컨)을 손으로 켜는 do는 caution 없이 통과하고 끄기가 없어도 끝낸다", () => {
      const d = new PlanDraft(cctx());
      ok(d, 1, { kind: "do", label: "에어컨 켜기", target: "table_1", command: "에어컨을 켜 주세요", hand_device: { id: "ac_living", to: "on" }, timeout_s: 120 });
      const r = d.finish();
      expect(r).toMatchObject({ ok: true });
      if (r.ok) expect(riskyHand(r.plan.steps[0]!, cctx().devices)).toBe(false);
    });
  });

  it("틀린 계획만 내는 모델이면 차례 한도 안에 끝내지 못해 버리고, 실행 추적은 실제 폰에 아무것도 보내지 않는다", async () => {
    llm.scripts["에어컨 켜기"] = () => Array.from({ length: 6 }, () => [["submit_plan", { steps: [{ kind: "device", label: "켜기", target: "ac_9", tool: "turn_on", timeout_s: 60 }] }]] as [string, Record<string, unknown>][]);
    try {
      const r = rig({ approvals: store({ "task:에어컨 켜기": "approve" }) });
      await r.decide(decision("에어컨 켜기"));
      expect(r.exec().map((l) => [l.state, l.text])).toEqual([["decided", EXEC_TEXT.decided], ["failed", EXEC_TEXT.badPlan]]);
      expect(r.phone).toEqual([]);
      expect(r.plans.current()).toBeNull();
    } finally {
      llm.scripts["에어컨 켜기"] = AC;
    }
  });
});

describe("계획 모드: 판단마다 한 번", () => {
  it("같은 행동 판단이 tick마다 와도 계획을 만드는 동안·진행 중에는 다시 부르지 않고, 끝난 뒤에도 15초 안에는 다시 부르지 않는다", async () => {
    const before = llm.bodies().length;
    const objects = [cup()];
    const r = rig({ objects: () => objects, approvals: store({ "task:컵 치우기": "approve" }), over: { planGapMs: 15_000 } });
    for (let s = 1; s <= 5; s++) {
      r.t.onDecision(decision("컵 치우기", `pam-${s}`, s));
      r.t.tick();
    }
    await r.t.idle();
    expect(r.planned.map((d) => d.id)).toEqual(["pam-1"]);
    expect(llm.bodies().length - before).toBe(1);
    expect(r.exec().filter((l) => l.text === EXEC_TEXT.same).map((l) => l.plan_id)).toEqual(["plan:pam-2", "plan:pam-3", "plan:pam-4", "plan:pam-5"]);
    for (let s = 1; s <= 20; s++) { r.clock.t += 250; r.t.tick(); }
    for (let s = 1; s <= 4; s++) r.t.onAnswer("plan:pam-1", `plan:pam-1:${s}`, "done");
    expect(r.plans.current()).toMatchObject({ status: "done" });
    await r.decide(decision("컵 치우기", "pam-6", 6));
    expect(r.exec().at(-1)).toMatchObject({ plan_id: "plan:pam-6", text: EXEC_TEXT.held });
    r.clock.t += 15_000;
    await r.decide(decision("컵 치우기", "pam-7", 7));
    expect(r.planned.map((d) => d.id)).toEqual(["pam-1", "pam-7"]);
    expect(llm.bodies().length - before).toBe(2);
  });

  it("계획을 만드는 동안 「그만」이면 그 호출을 끊고 답을 쓰지 않는다. 다른 행동 판단이 오면 앞 호출을 끊는다", async () => {
    const signals: AbortSignal[] = [];
    const plans = new PlanHub(smallFloor(), () => {}, () => "t");
    const logs: BrainLog[] = [];
    const t = new ExecutionTracker({
      plans, world: () => view([cup()]), check: () => ({ ok: true }), floor: () => plans.floor(), approvals: store(), toPhone: () => {}, emit: (l) => logs.push(l),
      planner: (_d, signal) => { signals.push(signal); return new Promise(() => {}); },
    });
    t.onDecision(decision("컵 치우기"));
    t.onDecision(decision("사용자에게 물어보기", "pam-2", 2));
    expect(signals.map((s) => s.aborted)).toEqual([true, false]);
    expect(t.onHeard("그만해")).toMatchObject({ id: "stop" });
    expect(signals[1]!.aborted).toBe(true);
    expect(logs.filter((l) => l.type === "execution" && l.state === "failed").map((l) => l.type === "execution" && [l.plan_id, l.text])).toEqual([
      ["plan:pam-1", EXEC_TEXT.superseded], ["plan:pam-2", EXEC_TEXT.stopped],
    ]);
    expect(t.onHeard("그만해")).toBeNull();
  });

  it("계획 모드에 쓰는 행동 목록에는 설명과 쓸 수 있는 단계가 있다", () => {
    expect(Object.keys(TASKS)).toContain("세탁물 건조기로 옮기기");
    expect(deviceViews(new MemoryHub(DEVICES)).map((d) => d.kind)).toEqual(["aircon", "cooktop", "washer", "dryer"]);
  });
});

describe("계획 모드: 경합·시간 한도", () => {
  it("다른 행동 계획을 만드는 사이 진행 중 계획이 기다리기 단계에 들어가면 새 계획을 쓰지 않는다", async () => {
    const r = rig({ approvals: store({ "task:세탁물 건조기로 옮기기": "approve", "task:에어컨 켜기": "approve" }) });
    // 세탁물 옮기기 첫 단계(사람 단계) 중에 에어컨 판단이 와 계획을 만드는 사이, 세탁물 계획이 기다리기 단계에 들어간다
    llm.scripts["세탁물 건조기로 옮기기"] = () => [planCalls([
      { kind: "go", label: "세탁기로 가기", target: "washer_1", command: "세탁기로 가 주세요", timeout_s: 300 },
      { kind: "wait", label: "세탁 멈춤", until: { device: "washer_1", state: "stopped" }, timeout_s: 7200 },
      { kind: "pick", label: "세탁물 꺼내기", target: "washer_1", command: "세탁물을 꺼내 주세요", timeout_s: 300 },
      { kind: "place", label: "세탁물 넣기", target: "dryer_1", command: "세탁물을 건조기에 넣어 주세요", timeout_s: 300 },
      { kind: "device", label: "건조기 시작", target: "dryer_1", tool: "start", timeout_s: 60 },
    ])];
    try {
      await r.decide(decision("세탁물 건조기로 옮기기"));
      expect(r.spoken()).toEqual(["세탁기로 가 주세요"]);
      llm.scripts["에어컨 켜기"] = () => [planCalls([{ kind: "device", label: "거실 에어컨 켜기", target: "ac_living", tool: "turn_on", timeout_s: 60 }])];
      r.t.onDecision({ ...decision("에어컨 켜기", "pam-2", 2), atMs: r.clock.t });
      r.t.onAnswer("plan:pam-1", "plan:pam-1:1", "done");
      expect(r.t.waiting()).toBe(true);
      await r.t.idle();
      expect(r.exec().find((l) => l.plan_id === "plan:pam-2" && l.state === "failed")).toMatchObject({ text: EXEC_TEXT.busy });
      expect(r.plans.current()).toMatchObject({ id: "plan:pam-1", status: "running" });
      expect(r.hub.get("ac_living")!.twin.power).toBe("off");
    } finally {
      llm.scripts["세탁물 건조기로 옮기기"] = laundry();
      llm.scripts["에어컨 켜기"] = AC;
    }
  });

  it("기록만 한 새 판단보다 먼저 보낸 다른 행동 판단이 늦게 오면 쓰지 않는다", async () => {
    const r = rig({ objects: () => [cup()], approvals: store({ "task:컵 치우기": "approve" }) });
    await r.decide(decision("컵 치우기", "pam-1", 1));
    await r.decide(decision("컵 치우기", "pam-3", 3));
    await r.decide(decision("에어컨 켜기", "pam-2", 2));
    expect(r.exec().at(-1)).toMatchObject({ plan_id: "plan:pam-2", text: EXEC_TEXT.late });
    expect(r.planned.map((d) => d.id)).toEqual(["pam-1"]);
  });

  it("시간 한도가 지난 뒤 온 관찰로는 넘기지 않고 시간 초과로 닫는다. 위험 가전 승인을 기다린 시간은 단계 시간에 넣지 않는다", async () => {
    const a = rig({ objects: () => [cup()], approvals: store({ "task:컵 치우기": "approve" }) });
    await a.decide(decision("컵 치우기"));
    a.clock.t += 120_001;
    a.t.onEye([7, 3]);
    a.t.onWorld();
    expect(a.exec().at(-1)).toMatchObject({ state: "failed", text: EXEC_TEXT.timeout });
    const b = rig({ approvals: store({ "task:인덕션 켜기": "approve" }), task: COOKTOP_TASK });
    await b.decide(decision("인덕션 켜기"));
    await b.settle();
    b.clock.t += 90_000;
    b.t.tick();
    expect(b.t.onAnswer("plan:pam-1", "plan:pam-1:1:approve", "approve")).toBe(true);
    b.t.tick();
    await b.settle();
    expect(b.plans.current()).toMatchObject({ status: "done" });
    expect(b.hub.get("induction_1")!.twin.power).toBe("on");
  });

  it("멈추면(집을 닫을 때) 기다리던 위험 가전 승인 토큰을 버린다", async () => {
    const r = rig({ approvals: store({ "task:인덕션 켜기": "approve" }), task: COOKTOP_TASK });
    await r.decide(decision("인덕션 켜기"));
    await r.settle();
    expect(r.policy.pending()).toHaveLength(1);
    r.t.stop();
    expect(r.policy.pending()).toEqual([]);
  });

  it("person_holding: 종류면 그 종류 아무 물건, id면 그 id만(같은 종류 다른 물건은 아님), 든 것을 모르면 참", async () => {
    const { evaluate } = await import("../src/world/conditions.js");
    const holding = (held: string[]): WorldView => ({
      ...view([]), person: { ...PERSON, visible: true, holding: held, facts: { holding: { value: "holding_object", at_ms: 10_000, since_ms: 10_000, certainty: "confirmed" } } },
    });
    const x = { nowMs: 10_000, sinceMs: 9_000, locate: () => null, roomOf: () => null };
    expect(evaluate({ person_holding: "cup" }, holding(["cup_2"]), x)).toBe(true);
    expect(evaluate({ person_holding: "cup_1" }, holding(["cup_2"]), x)).toBe(false);
    expect(evaluate({ person_holding: "cup_1" }, holding(["cup_2"]), { ...x, follow: () => ["cup_2"] })).toBe(true);
    expect(evaluate({ person_holding: "cup" }, holding(["book_1"]), x)).toBe(false);
    expect(evaluate({ person_holding: "cup" }, holding([]), x)).toBe(true);
  });
});

describe("계획 모드: 코드 리뷰 2회차 고침", () => {
  const cupIds = { table: "table_1", sink: "sink_1", cup: "cup_1" };
  const ctx = (): PlanContext => planContext({ decision: decision("컵 치우기"), world: view([cup()]), floor: floor() });

  it("submit_plan은 낼 때마다 계획 전체를 새로 검사한다: 모양이 틀린 단계가 하나라도 있으면 그 번호와 까닭을 돌려주고 끝내지 않으며, 고친 전체를 다시 내면 끝난다", () => {
    const d = new PlanDraft(ctx());
    const good = cupSteps(cupIds);
    const bad = [good[0]!, { kind: "pick", label: 3 }, good[2]!, good[3]!];
    expect(d.submit({ steps: bad })).toMatchObject({ ok: false, error: expect.stringMatching(/^2번 단계: .*계획 전체를 고쳐 submit_plan으로 다시 보내세요/s) });
    expect(d.finished).toBeNull();
    // 앞 제출의 단계가 남지 않는다(1번만 낸 계획은 필요한 단계가 없어 버린다)
    expect(d.submit({ steps: [good[0]!] })).toMatchObject({ ok: false, error: expect.stringMatching(/pick, place 단계가 있어야/) });
    expect(d.submit({ steps: good })).toMatchObject({ ok: true, plan: { steps: [{ kind: "go" }, { kind: "pick" }, { kind: "go" }, { kind: "place" }] } });
    // 끝낸 계획은 그대로다(다음 제출이 바꾸지 않는다). 빈 계획은 받지 않는다
    expect(d.submit({ steps: [good[0]!] })).toMatchObject({ ok: true, plan: { steps: [{}, {}, {}, {}] } });
    expect(new PlanDraft(ctx()).submit({ steps: [] })).toMatchObject({ ok: false, error: expect.stringMatching(/단계가 없습니다/) });
  });

  it("틀린 계획을 내면 까닭을 돌려받아 고친 전체를 한 번 더 내고, 그 두 번째로 끝난다", async () => {
    const before = llm.bodies().length;
    llm.scripts["컵 치우기"] = (input) => {
      const steps = cupSteps(idsFrom(input));
      return [planCalls([steps[0]!, { ...steps[1]!, command: "컵을 들게요" }, steps[2]!, steps[3]!]), planCalls(steps)];
    };
    try {
      const r = await testPlanner(llm).plan(planContext({ decision: decision("컵 치우기"), world: view([cup()]), floor: smallFloor(), nowIso: "t" }));
      expect(r).toMatchObject({ ok: true, plan: { steps: [{ kind: "go" }, { kind: "pick" }, { kind: "go" }, { kind: "place" }] } });
      const bodies = llm.bodies().slice(before);
      expect(bodies).toHaveLength(2);
      expect(bodies[1].input).toContainEqual(expect.objectContaining({ type: "function_call_output", output: expect.stringMatching(/2번 단계: .*주세요/) }));
    } finally {
      llm.scripts["컵 치우기"] = CUP_SCRIPTS["컵 치우기"]!;
    }
  });

  it("가전 단계는 같은 가전 자리에서 사람이 하는 단계 뒤에 둔다(넣기 전에 건조기를 켜지 않는다)", () => {
    const d = new PlanDraft(planContext({ decision: decision("세탁물 건조기로 옮기기"), world: view([]), floor: floor(), hub: new MemoryHub(DEVICES) }));
    const steps = [
      { kind: "device", label: "건조기 시작", target: "dryer_1", tool: "start", timeout_s: 60 },
      { kind: "go", label: "세탁기로 가기", target: "washer_1", command: "세탁기로 가 주세요", timeout_s: 300 },
      { kind: "pick", label: "세탁물 꺼내기", target: "washer_1", command: "세탁물을 꺼내 주세요", timeout_s: 300 },
      { kind: "place", label: "세탁물 넣기", target: "dryer_1", command: "세탁물을 건조기에 넣어 주세요", timeout_s: 300 },
    ];
    steps.forEach((s, i) => expect(d.add({ step: i + 1, ...s })).toMatchObject({ ok: true }));
    expect(d.finish()).toMatchObject({ ok: false, error: expect.stringMatching(/1번 가전 단계는 .*4번 단계 뒤/) });
  });

  it("시간 한도가 지난 「완료」·승인 답은 받지 않고 시간 초과·답 없음으로 닫는다. 늦은 승인은 기억하지 않는다", async () => {
    const a = rig({ objects: () => [cup()], approvals: store({ "task:컵 치우기": "approve" }) });
    await a.decide(decision("컵 치우기"));
    a.clock.t += 120_001;
    expect(a.t.onAnswer("plan:pam-1", "plan:pam-1:1", "done")).toBe(false);
    expect(a.exec().at(-1)).toMatchObject({ state: "failed", text: EXEC_TEXT.timeout });
    const approvals = store();
    const b = rig({ objects: () => [cup()], approvals });
    await b.decide(decision("컵 치우기"));
    b.clock.t += 120_001;
    expect(b.t.onAnswer("plan:pam-1", "plan:pam-1:approve", "approve")).toBe(false);
    expect(b.exec().at(-1)).toMatchObject({ state: "failed", text: EXEC_TEXT.noAnswer });
    expect(approvals.memory()).toEqual({ always: {} });
  });

  it("들고 다니다 시야 밖이 된 컵은 내려놓기 자리(싱크대) 가까이에서 새로 보인 컵에만 잇는다", async () => {
    let objects = [cup()];
    const r = rig({ objects: () => objects, approvals: store({ "task:컵 치우기": "approve" }) });
    await r.decide(decision("컵 치우기"));
    const at = (t: number) => ({ value: "in_hand", at_ms: t, since_ms: t, certainty: "confirmed" as const });
    r.t.onAnswer("plan:pam-1", "plan:pam-1:1", "done");
    objects = [cup({ facts: { place: at(r.clock.t) } })];
    r.t.onWorld();
    r.t.onAnswer("plan:pam-1", "plan:pam-1:3", "done");
    expect(r.steps()).toEqual(["done", "done", "done", "active"]);
    const sink = (t: number) => ({ place: { value: "in_sink", at_ms: t, since_ms: t, certainty: "confirmed" as const } });
    // 식탁 자리(싱크대에서 2.8m)에 새로 보인 컵은 잇지 않는다
    objects = [cup({ status: "out_of_view", last_seen_ms: r.clock.t - 1 }), cup({ id: "cup_2", position: [7, 0.75, 3], first_seen_ms: r.clock.t, last_seen_ms: r.clock.t, facts: sink(r.clock.t) })];
    r.t.onWorld();
    expect(r.plans.current()).toMatchObject({ status: "running" });
    objects = [...objects, cup({ id: "cup_3", position: [5, 0.9, 1], first_seen_ms: r.clock.t, last_seen_ms: r.clock.t, facts: sink(r.clock.t) })];
    r.t.onWorld();
    expect(r.plans.current()).toMatchObject({ status: "done" });
  });
});
