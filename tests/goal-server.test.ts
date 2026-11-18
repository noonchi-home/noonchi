// 집 실행 묶음의 미리 세운 목표 잇기(src/server/home/act.ts publishGoal): 목표가 바뀌면 전환은 /brain/goal_changes(RELIABLE)로, 최신 보기는 /brain/goal(STATE)로 내
// 녹화에 남고, 대시보드로 {type:"goal"}을 보내며, 접속한 대시보드에 다시 보낼 마지막 목표를 둔다.
import { describe, expect, it } from "vitest";
import { HistoryDb } from "../src/brain/index.js";
import { BusNode, MemoryBus, Outbox, realClock } from "../src/bus/index.js";
import type { PendingGoal } from "../src/contract/goal.js";
import { Bag, startRecorder } from "../src/record/index.js";
import { publishGoal } from "../src/server/home/act.js";

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
    const act = new BusNode({ name: "act", bus, epoch: EPOCH, log: () => {} });
    await act.prepare();
    act.start();
    const sent: unknown[] = [];
    const core = { out: { act: new Outbox(act, { clock: realClock, log: () => {} }) }, app: { broadcast: (m: unknown) => sent.push(m) }, goal: null } as unknown as Parameters<typeof publishGoal>[0];
    const steps: PendingGoal[] = [GOAL, { ...GOAL, prep: "planning" }, { ...GOAL, prep: "ready" }, { ...GOAL, status: "fired", prep: "ready" }];
    for (const g of steps) publishGoal(core, g);
    expect(await core.out.act!.drain(2000)).toBe(true);
    await new Promise((r) => setTimeout(r, 50));
    await rec.idle();
    const rows = bag.range(0, Number.MAX_SAFE_INTEGER);
    const of = (topic: string) => rows.filter(({ e }) => e.topic === topic).map(({ e }) => (e.body as { goal: PendingGoal }).goal);
    expect(of("/brain/goal_changes").map((g) => `${g.status}/${g.prep}`)).toEqual(["armed/waiting", "armed/planning", "armed/ready", "fired/ready"]);
    expect(of("/brain/goal").at(-1)).toMatchObject({ status: "fired", prep: "ready" });
    expect(sent).toEqual(steps.map((goal) => ({ type: "goal", goal })));
    expect(core.goal).toMatchObject({ status: "fired" });
    expect(db.list({})).toEqual([]);
  });
});
