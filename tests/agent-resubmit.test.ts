// 미리 만든 계획 다시 내기(src/agent/planTools.ts resubmit): 모델을 다시 부르지 않고, 모델이 낸 submit_plan 인자를 새 판단·지금 World State로 계획 검사에 다시 넣는다.
// 미리 세운 목표의 계획(ahead)은 목표 물건만 쓴다(컵이 둘이어도 다른 컵 계획을 받지 않는다).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PlanDraft, resubmit, type AgentPlan } from "../src/agent/planTools.js";
import { planInput } from "../src/agent/planInput.js";
import type { DecisionRecord } from "../src/contract/events.js";
import type { WorldObject, WorldView } from "../src/contract/world.js";
import { smallFloor } from "./helpers/floor.js";
import { cupSteps, planContext, startFakePlanner, testPlanner, type FakePlanner } from "./helpers/planner.js";

let llm: FakePlanner;
beforeAll(async () => { llm = await startFakePlanner(); });
afterAll(async () => { await llm.close(); });

const cupAt = (id: string, over: Partial<WorldObject> = {}): WorldObject => ({
  id, cls: "cup", position: [7, 0.75, 3], surface: "t", surface_label: "식탁", room: "hall", error_m: 0.1, status: "present", first_seen_ms: 0, last_seen_ms: 9_000, last_in_view_ms: 9_000,
  facts: { place: { value: "on_table", at_ms: 9_000, since_ms: 9_000, certainty: "confirmed" } }, answered_ms: null, devices: [], closer_hold: false, followed_by: null, ...over,
});
const view = (objects: WorldObject[]): WorldView => ({
  at_ms: 10_000, objects, person: { visible: false, since_ms: 9_000, last_seen_ms: null, count: 0, room: null, room_label: null, position: null, near: [], holding: [], position_ms: null, answered_ms: null, facts: {} },
  fixtures: [], devices: [], eye: null, frame_ms: 9_000, vlm_missing: 0, yolo_missing: 0,
});
const decision = (id: string, prediction: DecisionRecord["prediction"] = { observation: "사람이 컵을 두고 자리를 비움", reasoning: "습관대로 치운다", task_index: 0 }): DecisionRecord => ({
  id, seq: 1, atMs: 8_000, textSent: "t", finalTime: "x", status: "valid", prediction, action: "컵 치우기", memoryVersion: 1, world: { objects: [], person_visible: false, vlm_missing: 0, yolo_missing: 0 },
});
const AHEAD = { trigger: "t", on: "사용자가 컵을 두고 자리를 떠나 보이지 않는다.", object: "cup_1" };
/** 목표 기록(goal-1, PAM 판단이 아니라 prediction 없음)으로 만든 계획. */
async function prepared(world: WorldView): Promise<AgentPlan> {
  const r = await testPlanner(llm).plan({ ...planContext({ decision: decision("goal-1", null), world, floor: smallFloor() }), ahead: AHEAD });
  if (!r.ok) throw new Error(r.error);
  return r.plan;
}

describe("미리 만든 계획 다시 내기", () => {
  it("새 판단으로 다시 내면 모델을 부르지 않고, 계획·단계 id와 판단 글은 새 판단 것이며 명령·조건은 같다", async () => {
    const w = view([cupAt("cup_1")]);
    const pre = await prepared(w);
    const calls = llm.bodies().length;
    const r = resubmit(pre, planContext({ decision: decision("pam-7"), world: w, floor: smallFloor() }));
    expect(llm.bodies()).toHaveLength(calls);
    if (!r.ok) throw new Error(r.error);
    expect(r.plan.view.id).toBe("plan:pam-7");
    expect(r.plan.steps.map((s) => s.id)).toEqual(pre.steps.map((_, i) => `plan:pam-7:${i + 1}`));
    expect(r.plan.steps.map((s) => [s.kind, s.command, s.until])).toEqual(pre.steps.map((s) => [s.kind, s.command, s.until]));
    expect(r.plan.view.judgment).toBe("습관대로 치운다");
  });

  it("컵이 옮겨져 새 id가 붙으면(followed_by cup_1 → cup_2) 계획의 물건 id를 cup_2로 바꿔 낸다", async () => {
    const pre = await prepared(view([cupAt("cup_1")]));
    const moved = view([cupAt("cup_1", { status: "gone", followed_by: "cup_2" }), cupAt("cup_2", { position: [7.3, 0.75, 3] })]);
    const r = resubmit(pre, planContext({ decision: decision("pam-8"), world: moved, floor: smallFloor() }));
    if (!r.ok) throw new Error(r.error);
    expect(JSON.stringify(r.plan.steps)).not.toContain("cup_1");
    expect(r.plan.steps.find((s) => s.kind === "pick")!.object).toBe("cup_2");
  });

  it("컵이 이어진 물건 없이 사라졌거나, 이미 치운 물건(placed)이거나, submit_plan 인자가 없거나, 다른 할 일의 계획이면 내지 않는다", async () => {
    const pre = await prepared(view([cupAt("cup_1")]));
    const fp = smallFloor();
    expect(resubmit(pre, planContext({ decision: decision("pam-9"), world: view([cupAt("cup_1", { status: "gone" })]), floor: fp })).ok).toBe(false);
    expect(resubmit(pre, planContext({ decision: decision("pam-9"), world: view([cupAt("cup_1")]), floor: fp, placed: new Map([["cup_1", { target: "sink_1", atMs: 1 }]]) })).ok).toBe(false);
    expect(resubmit({ ...pre, submitted: undefined }, planContext({ decision: decision("pam-9"), world: view([cupAt("cup_1")]), floor: fp })).ok).toBe(false);
    expect(resubmit({ ...pre, task: "사용자에게 물어보기" }, planContext({ decision: decision("pam-9"), world: view([cupAt("cup_1")]), floor: fp })).ok).toBe(false);
  });

  it("미리 세운 목표의 계획은 목표 물건만 쓴다: 컵이 둘이면 다른 컵을 집는 계획은 그 까닭으로 버린다(Codex 26bff0f Task 4:910)", () => {
    const fp = smallFloor();
    const w = view([cupAt("cup_1"), cupAt("cup_2", { position: [7.4, 0.75, 3] })]);
    const ctx = { ...planContext({ decision: decision("goal-1", null), world: w, floor: fp }), ahead: AHEAD };
    const ids = { table: "table_1", sink: "sink_1" };
    const other = new PlanDraft(ctx).submit({ steps: cupSteps({ ...ids, cup: "cup_2" }) });
    expect(other.ok).toBe(false);
    expect(!other.ok && other.error).toContain("미리 세운 목표의 물건은 cup_1입니다");
    expect(new PlanDraft(ctx).submit({ steps: cupSteps({ ...ids, cup: "cup_1" }) }).ok).toBe(true);
    // 목표가 아닌 보통 계획은 어느 컵이든 받는다
    expect(new PlanDraft({ ...ctx, ahead: undefined }).submit({ steps: cupSteps({ ...ids, cup: "cup_2" }) }).ok).toBe(true);
  });

  it("계획 입력: 미리 세운 목표가 있으면 [미리 세운 목표] 줄에 next 글과 목표 물건을 넣고, 없으면 그 줄이 없다", () => {
    const ctx = planContext({ decision: decision("goal-1", null), world: view([cupAt("cup_1")]), floor: smallFloor() });
    expect(planInput(ctx)).not.toContain("[미리 세운 목표]");
    expect(planInput({ ...ctx, ahead: AHEAD }))
      .toContain("[미리 세운 목표] 목표 물건 cup_1. 사람이 아직 쓰는 중이다. 「사용자가 컵을 두고 자리를 떠나 보이지 않는다.」가 되면 서버가 이 계획을 시작한다. 그때를 기다리거나 할지 묻는 단계 없이 그 뒤에 할 단계만 계획하고, 물건은 cup_1만 쓴다.");
  });
});

// 2026-11-18 d1: 컵이 놓이기 전 미리 만든 계획은 대신 물건(cup_0)으로 만들고, 사람이 떠난 뒤 확정된 컵 id로 묶어 다시 낸다
describe("미리 만든 계획 다시 내기: 대신 물건", () => {
  it("계획 모드는 입력 World State에 대신 물건(ahead.stand)을 넣어 그 물건으로 계획하고, 입력에 그 물건이 사람이 쓰는 것을 둘 자리라고 적는다", async () => {
    const stand = cupAt("cup_0");
    const ctx = { ...planContext({ decision: decision("goal-1", null), world: view([]), floor: smallFloor() }), ahead: { ...AHEAD, object: "cup_0", stand } };
    expect(planInput(ctx)).toContain("cup_0");
    const r = await testPlanner(llm).plan(ctx);
    if (!r.ok) throw new Error(r.error);
    expect(r.plan.steps.find((s) => s.kind === "pick")!.object).toBe("cup_0");
  });

  it("다시 낼 때 rename으로 대신 물건 id를 확정된 컵 id로 바꿔 지금 World State로 검사한다", async () => {
    const stand = cupAt("cup_0");
    const pre = await testPlanner(llm).plan({ ...planContext({ decision: decision("goal-1", null), world: view([]), floor: smallFloor() }), ahead: { ...AHEAD, object: "cup_0", stand } });
    if (!pre.ok) throw new Error(pre.error);
    const w = view([cupAt("cup_4")]);
    const r = resubmit(pre.plan, planContext({ decision: decision("pam-9"), world: w, floor: smallFloor() }), { cup_0: "cup_4" });
    if (!r.ok) throw new Error(r.error);
    expect(JSON.stringify(r.plan.steps)).not.toContain("cup_0");
    expect(r.plan.steps.find((s) => s.kind === "pick")!.object).toBe("cup_4");
    expect(resubmit(pre.plan, planContext({ decision: decision("pam-10"), world: w, floor: smallFloor() })).ok).toBe(false);
  });
});
