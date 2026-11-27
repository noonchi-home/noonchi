// Agent Trace가 사람 상태 FSM이 한 일을 고정 낱말로 보인다: FSM 판단 줄의 상태·화살표, 행동 선택 줄의 화살표 조건과 배운 화살표,
// 목표를 버린 까닭, 실행 전 검사 통과 항목, 사람이 떠난 뒤 첫 명령 시간. 모델이 쓴 글·기억의 사건 글은 줄에 싣지 않는다.
import { afterEach, describe, expect, it } from "vitest";
import { LEARNED_FSM_MEMORY } from "../scripts/learned-memory.js";
import { CUP_TASKS } from "../src/brain/decision.js";
import { Decider } from "../src/brain/decide.js";
import type { AttemptKey } from "../src/contract/assistance.js";
import type { GoalDrop, PendingGoal } from "../src/contract/goal.js";
import type { PlannedCommand } from "../src/contract/phone.js";
import type { WorldObject } from "../src/contract/world.js";
import { HomeTrace } from "../src/server/home/trace.js";
import type { PlaneSurface } from "../src/world/index.js";
import { WorldState } from "../src/world/state/world.js";
import { Trigger } from "../src/world/trigger.js";
import { pamClientFor, startFakePamLlm, type FakePamLlm } from "./helpers/pam.js";

let pam: FakePamLlm | undefined;
afterEach(async () => { await pam?.close(); pam = undefined; });

const memory = () => ({ memory: LEARNED_FSM_MEMORY, kind: "fsm" as const, version: 0 });
const trigger = () => new Trigger({ mode: "event", minGapMs: 0, periodMs: 1000, idleStopMs: 1e9, liveMs: 10_000, maxInflight: 1 }, 0);
const emptyWorld = () => new WorldState({ surfaces: () => [], floorAt: () => 0, roomAt: () => null, devices: () => [] });
/** 배운 기억에서 마시는 중 → 다른 상태로 가며 컵을 치우는 화살표 번호. */
const leaveEdge = LEARNED_FSM_MEMORY.states.find(s => s.id === "drinking")!.next.findIndex(e => e.action === "컵 치우기");
type Answer = { observation: string; reasoning: string; state: string; from: string | null; next_index: number };
/** 사람이 돌아와 마신다(자리에 없음 → 먹거나 마시는 중, 행동 없음). 화살표는 직전 상태에서만 나가 떠남 화살표 앞에 둔다. */
const arrive: Answer = { observation: "o", reasoning: "r", state: "drinking", from: "away", next_index: 0 };

/** 판단을 차례로 부르고 둘째 판단(pam-2)의 줄을 돌려준다. */
async function decide(answers: Answer[]) {
  let n = 0;
  pam = await startFakePamLlm({ predict: () => answers[n++]! });
  const trace = new HomeTrace("b:h#1", () => 1000, () => {});
  const d = new Decider({ pam: pamClientFor(pam), world: emptyWorld(), trigger: trigger(), tasks: () => [...CUP_TASKS], memory,
    emit: () => {}, offsetMinutes: 540, trace });
  for (let i = 0; i < answers.length; i++) {
    d.onChanges([{ kind: "person_gone", at_ms: 900 + i, subject: "person", text: "사람 안 보임", meaningful: true }]);
    d.tick();
    await d.idle();
  }
  d.stop();
  return trace.snapshot().rows.filter(row => row.refs.decision_id === "pam-2");
}

const cup: WorldObject = {
  id: "cup_1", cls: "cup", position: [2, 0.75, 0], surface: "table_1", surface_label: "식탁", room: "kitchen", error_m: 0.1, status: "present",
  first_seen_ms: 0, last_seen_ms: 900, last_in_view_ms: 900, facts: {}, answered_ms: null, devices: [], closer_hold: false, followed_by: null,
} as WorldObject;
const table = { id: "table_1", label: "식탁", center: [2, 0], top: 0.75, radius: 0.6 } as PlaneSurface;
function homeTrace() {
  const trace = new HomeTrace("b:h#1", () => 9000, () => {});
  trace.objects = () => [cup];
  trace.surfaces = () => [table];
  return trace;
}
const goal = (over: Partial<PendingGoal>): PendingGoal => ({
  id: "goal-1", action: "컵 치우기", state: "drinking", trigger: "t", object: "cup_1", cls: "cup", status: "armed", prep: "ready", reason: null,
  text: null, armed_ms: 0, ready_ms: 0, gone_ms: null, fired_ms: null, plan: null, ...over,
});

describe("FSM 판단·행동 선택 줄", () => {
  it("FSM 판단 줄은 답을 읽은 뒤 닫혀 화살표 출발 상태 → 지금 상태이고, 행동 선택 줄은 화살표 조건 → 일 · 배운 전이다", async () => {
    const rows = await decide([arrive, { observation: "컵을 두고 나감", reasoning: "자리를 비워 치운다", state: "away", from: "drinking", next_index: leaveEdge }]);
    expect(rows.find(row => row.kind === "LLM")).toMatchObject({ name: "FSM 판단", input: "먹거나 마시는 중", output: "자리에 없음", state: "done" });
    expect(rows.find(row => row.name === "행동 선택")).toMatchObject({ input: "컵을 두고 자리를 뜨면", output: "컵 치우기 · 배운 전이", state: "done" });
    expect(JSON.stringify(rows)).not.toMatch(/컵을 두고 나감|자리를 비워 치운다|사용자가/);
  });

  it("화살표가 없으면 FSM 판단 줄은 집 상태 → 지금 상태이고 대기 판단 줄은 그대로다", async () => {
    const rows = await decide([arrive, { observation: "o", reasoning: "r", state: "drinking", from: null, next_index: -1 }]);
    expect(rows.find(row => row.kind === "LLM")).toMatchObject({ name: "FSM 판단", input: "집 상태 · 습관", output: "먹거나 마시는 중" });
    expect(rows.find(row => row.name === "대기 판단")).toMatchObject({ input: "집 상태 · 행동 목록", output: "지켜보기" });
  });
});

describe("목표를 버린 까닭", () => {
  it("까닭 11가지가 저마다 짧은 글이다", () => {
    const want: Record<GoalDrop, string> = {
      took: "컵을 들고 감", back: "사람이 돌아옴", moved: "컵이 옮겨짐", replaced: "다른 판단이 맡음", safety: "안전 알림 먼저",
      mode: "지금 행동 목록에 없음", dock: "충전 자리로 가는 중", expired: "준비 시간 지남", pam: "떠난 뒤 판단이 고르지 않음",
      stale: "준비한 계획을 쓸 수 없음", stop: "그만하라고 함",
    };
    const trace = homeTrace();
    for (const [reason, text] of Object.entries(want) as [GoalDrop, string][]) {
      trace.goal(goal({ id: `goal-${reason}`, status: "dropped", reason }));
      const row = trace.snapshot().rows.filter(r => r.name === "목표 준비" && r.refs.goal_id === `goal-${reason}`).at(-1)!;
      expect(row.output, reason).toBe(text);
    }
  });
});

describe("실행 전 검사 통과 줄", () => {
  it("본 항목과 통과를 대상 컵 자리와 함께 한 줄로 낸다", () => {
    const trace = homeTrace();
    const row = trace.event("check", { plan_id: "plan:pam-2", object_id: "cup_1" }, "check_passed", undefined, { checks: ["same", "free"] })!;
    expect(row).toMatchObject({ kind: "GUARDRAIL", name: "실행 전 검사", input: "컵 1 · 식탁", output: "같은 컵 · 아무도 안 듦 · 통과", state: "done" });
    const fill = trace.event("check", { plan_id: "plan:pam-3", object_id: "cup_1" }, "check_passed", undefined, { checks: ["same", "empty", "free"] })!;
    expect(fill.output).toBe("같은 컵 · 빈 컵 · 아무도 안 듦 · 통과");
  });
});

describe("첫 명령 시간", () => {
  const key: AttemptKey = { boot: "b", homeEpoch: "h#1", attemptId: "pam-2", gen: 0 };
  const attempt = { key, home: "h", user: null, action: "컵 치우기", context: null, request: "proactive" as const, startedMs: 2000 };
  const command = { type: "command", id: "plan:pam-2", step: "plan:pam-2:1", kind: "go", text: "식탁으로 가 주세요", choices: [], target: null } as unknown as PlannedCommand;
  const step = { id: "plan:pam-2:1", kind: "move" as const, label: "식탁으로 가기", status: "active" as const, started_ms: 4500 };

  it("사람이 떠난 목표로 시작한 활동이 끝나면 종료 요약에 떠난 뒤 첫 명령까지 걸린 시간을 붙인다", () => {
    const trace = homeTrace();
    trace.goal(goal({ status: "fired", gone_ms: 1000, fired_ms: 1200 }));
    trace.link({ decision_id: "pam-2", attempt: key }, { goal_id: "goal-1" });
    trace.link({ plan_id: "plan:pam-2", attempt: key }, { decision_id: "pam-2" });
    trace.command(command, step);
    trace.ended(attempt, "done", 9000);
    expect(trace.snapshot().rows.find(row => row.name === "활동 종료")).toMatchObject({ state: "done", output: "활동 완료 · 첫 명령 3.5초" });
  });

  it("떠난 때를 모르는 활동은 종료 글만 낸다", () => {
    const trace = homeTrace();
    trace.link({ plan_id: "plan:pam-2", attempt: key }, { decision_id: "pam-2" });
    trace.command(command, step);
    trace.ended(attempt, "done", 9000);
    expect(trace.snapshot().rows.find(row => row.name === "활동 종료")).toMatchObject({ output: "활동 완료" });
  });
});
