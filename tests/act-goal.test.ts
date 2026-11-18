// 미리 세운 목표(src/act/track/goal.ts): 사람이 컵을 쓰는 것을 보면 습관 FSM 한 걸음 앞의 「컵 치우기」를 목표로 세우고 계획을 미리 만들어 둔다.
// 사람이 떠나면 판단을 바로 부르게 하고, PAM이 같은 행동을 고르면 미리 만든 계획을 다시 검사해 첫 명령을 낸다(계획 모드를 다시 부르지 않는다).
// 계획 모델은 같은 주소 자리의 가짜 OpenAI 서버(tests/helpers/planner.ts), 시계는 시험 시계(clock.t)다. smallFloor: 식탁 table_1 [7, 3], 싱크대 sink_1 [5, 1].
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ExecutionTracker, type TrackerOptions } from "../src/act/track/tracker.js";
import type { TrackCore } from "../src/act/track/core.js";
import { PlanHub } from "../src/act/hub.js";
import { checkPlan } from "../src/act/check.js";
import { tasksFor } from "../src/act/tasks.js";
import { APPROVAL_TEXT, EXEC_TEXT, USE_THOUGHT } from "../src/act/labels.js";
import { Decider } from "../src/brain/decide.js";
import { Trigger } from "../src/world/trigger.js";
import { pamClientFor, startFakePamLlm } from "./helpers/pam.js";
import { ApprovalStore } from "../src/agent/approval.js";
import { resubmit, type PlanAhead } from "../src/agent/planTools.js";
import { CUP_FSM_MEMORY } from "../src/brain/decision.js";
import type { BrainLog, DecisionRecord } from "../src/contract/events.js";
import type { PendingGoal } from "../src/contract/goal.js";
import type { PlannedCommandMessage } from "../src/contract/phone.js";
import type { WorldObject, WorldView } from "../src/contract/world.js";
import { POSE_FALL } from "../src/world/vocab.js";
import { smallFloor } from "./helpers/floor.js";
import { planContext, planTurn, startFakePlanner, testPlanner, type FakePlanner } from "./helpers/planner.js";

let llm: FakePlanner;
beforeAll(async () => { llm = await startFakePlanner(); });
afterAll(async () => { await llm.close(); });

const NOONCHI = tasksFor("noonchi");
const PLACES: Record<string, { label: string; position: [number, number, number] }> = {
  table_1: { label: "식탁", position: [7, 0.75, 3] }, sink_1: { label: "싱크대", position: [5, 0.9, 1] },
};
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
function goalSetup(o: { over?: Partial<TrackerOptions>; state?: string | null } = {}) {
  const clock = { t: 10_000, now() { return this.t; } };
  let who: Who = null;
  let since = 0;
  let goneAt = 0;
  let objects: WorldObject[] = [cupOn({ seen: clock.t })];
  const w = (): WorldView => {
    const facts = who
      ? { ...(who.act ? { activity: fact(who.act, clock.t) } : {}), ...(who.holding ? { holding: fact("holding_object", clock.t) } : {}), ...(who.posture ? { posture: fact(who.posture, clock.t) } : {}) }
      : {};
    return {
      at_ms: clock.t, objects, fixtures: [], devices: [], eye: null, frame_ms: clock.t, vlm_missing: 0, yolo_missing: 0,
      person: { visible: !!who, since_ms: who ? since : goneAt, last_seen_ms: who ? clock.t : null, count: who ? 1 : 0, room: null, room_label: null, position: null, near: [], holding: who?.holding ?? [], position_ms: null, answered_ms: null, facts },
    };
  };
  const goals: PendingGoal[] = [];
  const thoughts: string[] = [];
  const logs: BrainLog[] = [];
  const phone: PlannedCommandMessage[] = [];
  let nudged = 0;
  const plans = new PlanHub(smallFloor(), () => {}, () => "t");
  const planner = testPlanner(llm);
  const approvals = new ApprovalStore(join(mkdtempSync(join(tmpdir(), "goal-")), "homes", "h", "approvals.json"), () => "t");
  const ctx = (d: DecisionRecord, ahead?: PlanAhead) => ({ ...planContext({ decision: d, world: w(), floor: plans.floor() }), ...(ahead ? { ahead } : {}) });
  const t = new ExecutionTracker({
    plans, world: w, floor: () => plans.floor(), planGapMs: 0, approvals, clock, tasks: () => NOONCHI, locate: (id) => PLACES[id],
    planner: (d, signal, ahead) => planner.plan(ctx(d, ahead), signal),
    check: (d, p, seenSince) => checkPlan({ decision: d, tasks: NOONCHI, plan: p, world: w(), nowMs: clock.t, staleMs: 3000, mode: "test", ...(seenSince !== undefined ? { seenSince } : {}) }),
    reuse: (d, plan) => resubmit(plan, ctx(d)),
    habit: () => ({ memory: CUP_FSM_MEMORY, kind: "fsm", state: o.state === undefined ? "drinking" : o.state, version: 1 }),
    onGoal: (g) => goals.push(g), nudge: () => { nudged++; }, thought: (text) => thoughts.push(text),
    toPhone: (m) => phone.push(m), emit: (l) => logs.push(l), ...o.over,
  });
  t.onEye([3, 1]);
  const tick = (ms = 250) => {
    clock.t += ms;
    objects = objects.map((x) => (x.status === "present" ? { ...x, last_seen_ms: clock.t, last_in_view_ms: clock.t } : x));
    t.onEye([3, 1]);
    t.tick();
  };
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
  const decide = async (d: DecisionRecord) => { t.onDecision(d); await t.idle(); };
  const commands = () => phone.flatMap((m) => (m.type === "command" ? [m] : []));
  const planCalls = () => llm.bodies().length;
  const states = () => goals.map((g) => `${g.status}/${g.prep}`);
  return { t, clock, tick, person, gone, setObjects, goals, states, thoughts, logs, phone, commands, decide, planCalls, nudged: () => nudged, world: w };
}

describe("미리 세운 목표: 세우기와 미리 만들기", () => {
  it("사람이 컵으로 마시는 것을 보면 「컵 치우기」 목표를 세우고 메시지 상자에 「컵을 두고 자리를 뜨면 컵을 치울게요」를 한 번 올린다. 폰 명령은 없다", async () => {
    const s = goalSetup();
    s.person({ act: "drinking" });
    s.tick();
    expect(s.goals[0]).toMatchObject({ id: "goal-1", action: "컵 치우기", state: "left_cup", object: "cup_1", cls: "cup", status: "armed", prep: "waiting", reason: null, text: "컵을 두고 자리를 뜨면 컵을 치울게요" });
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
    for (const over of [{ habit: () => null }, { tasks: () => tasksFor("coach") }] as Partial<TrackerOptions>[]) {
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
        tasks: () => NOONCHI, memory: () => ({ memory: CUP_FSM_MEMORY, kind: "fsm", version: 1 }), emit: () => {}, offsetMinutes: 540, clock: s.clock, onDecision: (d) => s.t.onDecision(d),
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
    expect(s.goals.find((g) => g.status === "dropped")).toMatchObject({ reason: "other" });
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
    const docking = () => ({ id: "dock:1", sent: null, spokeAt: s.clock.t, visionAt: s.clock.t, phase: "look" as const, at: [11, 0, 11] as [number, number, number], since: s.clock.t, startedAt: s.clock.t, decision: "pam-0" });
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
    expect(last(s)).toMatchObject({ status: "dropped", reason: "other" });
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
