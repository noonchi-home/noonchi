// 집 실행 묶음의 미리 세운 목표 잇기(src/server/home/act.ts publishGoal): 목표가 바뀌면 전환은 /brain/goal_changes(RELIABLE)로, 최신 보기는 /brain/goal(STATE)로 내
// 녹화에 남고, 대시보드로 {type:"goal"}을 보내며, 접속한 대시보드에 다시 보낼 마지막 목표를 둔다.
import { describe, expect, it } from "vitest";
import { HistoryDb } from "../src/brain/index.js";
import { BusNode, MemoryBus, Outbox, realClock } from "../src/bus/index.js";
import type { PendingGoal } from "../src/contract/goal.js";
import { Bag, settle, startRecorder } from "../src/record/index.js";
import { goalRecorder, publishGoal } from "../src/server/home/act.js";

const EPOCH = { boot: "b1", home: "h#1" };
const GOAL: PendingGoal = {
  id: "goal-1", action: "컵 치우기", state: "left_cup", trigger: "t", object: "cup_1", cls: "cup", status: "armed", prep: "waiting", reason: null, text: "컵을 두고 자리를 뜨면 컵을 치울게요",
  armed_ms: 1, ready_ms: null, gone_ms: null, fired_ms: null, plan: null,
};

describe("미리 세운 목표 잇기", () => {
  it("목표가 바뀌면 전환은 /brain/goal_changes로 모두 녹화되고 /brain/goal은 마지막 보기이며, 대시보드로 {type:\"goal\"}을 보내고 마지막 목표를 둔다", async () => {
    const bus = new MemoryBus();
    const bag = Bag.open(":memory:");
    const db = HistoryDb.open(":memory:");
    const rec = await startRecorder({ bus, epoch: EPOCH, db, bag });
    rec.start();
    const goal = new BusNode({ name: "goal", bus, epoch: EPOCH, log: () => {} });
    await goal.prepare();
    goal.start();
    const sent: unknown[] = [];
    const core = { out: { goal: new Outbox(goal, { clock: realClock, log: () => {} }) }, app: { broadcast: (m: unknown) => sent.push(m) }, goal: null } as unknown as Parameters<typeof publishGoal>[0];
    const checking: PendingGoal = {...GOAL,status:"checking",prep:"ready",checking_ms:3,check_until_ms:300003,departure_rev:8,meal:{zone:"seat",surface:"table",activity:"drinking"}};
    const steps: PendingGoal[] = [GOAL, { ...GOAL, prep: "planning" }, { ...GOAL, prep: "ready" }, checking, { ...checking, status: "fired", confirmed_ms:4 }];
    for (const g of steps) publishGoal(core, g);
    expect(await core.out.goal!.drain(2000)).toBe(true);
    await settle(bus, [goal, rec]);
    const rows = bag.range(0, Number.MAX_SAFE_INTEGER);
    const of = (topic: string) => rows.filter(({ e }) => e.topic === topic).map(({ e }) => (e.body as { goal: PendingGoal }).goal);
    expect(of("/brain/goal_changes")).toEqual(steps);
    expect(of("/brain/goal").at(-1)).toMatchObject({ status: "fired", prep: "ready" });
    expect(sent).toEqual(steps.map((goal) => ({ type: "goal", goal })));
    expect(core.goal).toMatchObject({ status: "fired" });
    const goals = db.list({ kinds: ["goal"] });
    expect(goals.map((r) => r.at_ms)).toEqual(rows.filter(({ e }) => e.topic === "/brain/goal_changes").map(({ e }) => e.header.stamp));
    expect(goals.map((r) => r.text)).toEqual(["세움 · 컵 치우기", "계획 미리 만드는 중", "계획 준비됨", "사용자 상태 확인 중", "TV 시청 확인"]);
    await goal.stop();
    await rec.stop();
    await bus.close();
    db.close();
    bag.close();
  });
});

describe("기계 상태 통로와 기록", () => {
  it("로봇 전이는 같은 봉투가 다시 와도 한 줄이며 늦게 붙은 구독자는 끝의 상태와 시각을 받는다", async () => {
    const bus = new MemoryBus();
    const bag = Bag.open(":memory:");
    const db = HistoryDb.open(":memory:");
    const rec = await startRecorder({ bus, epoch: EPOCH, db, bag });
    const act = new BusNode({ name: "act", bus, epoch: EPOCH });
    const late = new BusNode({ name: "phone", bus, epoch: EPOCH });
    const seen: unknown[] = [];
    late.on("/robot/state", (body) => { seen.push(body); });
    try {
      await act.prepare();
      act.start();
      rec.start();
      const phases = [
        { state: "observe" as const, step: null, since_ms: 1000 },
        { state: "return" as const, step: null, since_ms: 4000 },
      ];
      const idle = { state: "idle" as const, since_ms: 900, id: null, action: null, left_ms: null, reason: null, result: null };
      const goalNode = new BusNode({ name: "goal", bus, epoch: EPOCH });
      try { await goalNode.publish("/goal/changes", idle); } finally { await goalNode.stop(); }
      for (const body of phases) {
        await act.publish("/robot/state", body);
        const event = act.envelope("/robot/changes", body);
        await act.send(event);
        await act.send(event);
      }
      await late.prepare();
      late.start();
      await settle(bus, [act, rec, late]);
      expect(seen).toEqual([phases[1]]);
      expect(db.list({ kinds: ["goal"] })).toMatchObject([{ at_ms: 900, text: "대기", data: idle }]);
      const rows = db.list({ kinds: ["robot"] });
      expect(rows.map((r) => r.data)).toEqual(phases);
      expect(rows.map((r) => r.text)).toEqual(["살펴보는 중", "충전 자리로 가는 중"]);
      expect(bag.range(0, Number.MAX_SAFE_INTEGER, { topics: ["/robot/changes"] }).map((r) => r.e.body)).toEqual(phases);
    } finally {
      await late.stop();
      await rec.stop();
      await act.stop();
      await bus.close();
      bag.close();
      db.close();
    }
  });
});

describe("미리 세운 목표 기록(기록 DB goal 줄, 영상 판정 시각표가 읽는다)", () => {
  it("전환마다 「세움 · 컵 치우기」·「계획 미리 만드는 중」·「계획 준비됨」·「사람 떠남 · 판단 부름」·「준비한 계획으로 시작」 줄을 남기고, 버림은 까닭을 붙인다", () => {
    const db = HistoryDb.open(":memory:");
    const record = goalRecorder(db);
    const steps: PendingGoal[] = [
      GOAL, { ...GOAL, prep: "planning" }, { ...GOAL, prep: "ready" }, { ...GOAL, status: "fired", prep: "ready" }, { ...GOAL, status: "used", prep: "ready" },
      { ...GOAL, id: "goal-2" }, { ...GOAL, id: "goal-2", status: "dropped", reason: "back" },
    ];
    steps.forEach((g, i) => record(g, 1000 + i));
    const rows = db.list({ kinds: ["goal"] });
    expect(rows.map((r) => r.text)).toEqual([
      "세움 · 컵 치우기", "계획 미리 만드는 중", "계획 준비됨", "사람 떠남 · 판단 부름", "준비한 계획으로 시작", "세움 · 컵 치우기", "버림 · 다시 나타남",
    ]);
    expect(rows[0]).toMatchObject({ subject: "goal-1", data: { status: "armed", prep: "waiting", object: "cup_1" } });
  });
});

describe("미리 세운 목표 기록: 준비한 계획을 버린 까닭", () => {
  it("까닭(error)이 있으면 버림은 「준비한 계획 버림 · <까닭>」, 미리 만들기 실패는 「계획 못 만듦 · <까닭>」이고, data의 까닭(reason)은 실행 기록과 같은 칸에 글로 싣는다(버린 종류는 drop)", () => {
    const db = HistoryDb.open(":memory:");
    const record = goalRecorder(db);
    record(GOAL, 1);
    record({ ...GOAL, prep: "failed", error: "모델 차례 3번 안에 맞는 계획을 내지 못함" }, 2);
    record({ ...GOAL, id: "goal-2" }, 3);
    record({ ...GOAL, id: "goal-2", status: "dropped", reason: "stale", error: "1번 단계: 계획 검사 까닭" }, 4);
    record({ ...GOAL, id: "goal-3" }, 5);
    record({ ...GOAL, id: "goal-3", status: "dropped", reason: "took" }, 6);
    const rows = db.list({ kinds: ["goal"] });
    expect(rows.map((r) => r.text)).toEqual([
      "세움 · 컵 치우기", "계획 못 만듦 · 모델 차례 3번 안에 맞는 계획을 내지 못함", "세움 · 컵 치우기", "준비한 계획 버림 · 1번 단계: 계획 검사 까닭", "세움 · 컵 치우기", "버림 · 들고 나감",
    ]);
    expect(rows[1]!.data).toMatchObject({ prep: "failed", reason: "모델 차례 3번 안에 맞는 계획을 내지 못함" });
    expect(rows[3]!.data).toMatchObject({ status: "dropped", drop: "stale", reason: "1번 단계: 계획 검사 까닭" });
    expect(rows[5]!.data).toMatchObject({ status: "dropped", drop: "took" });
    expect(rows[5]!.data).not.toHaveProperty("reason");
  });
});
