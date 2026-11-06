import { describe, expect, it } from "vitest";
import { DEFAULT_BRAIN_CONFIG } from "../src/brain/config.js";
import { MockDecision } from "../src/brain/decision.js";
import { ScriptedDetector, type Detection } from "../src/brain/detector.js";
import { LiveBrain } from "../src/brain/live.js";
import { ScriptedPerceiver, type RawPerception } from "../src/brain/perception.js";
import type { AgentAction, BrainEvent, BrainStage } from "../src/contract/events.js";
import type { PlanView } from "../src/contract/plan.js";
import { PlanHub } from "../src/plan/hub.js";
// fp는 plan-planner.test.ts와 같은 평면도
import { smallFloor } from "./helpers/floor.js";

type Sent = { type: string; plan: PlanView | null };

const stage = (s: BrainStage, generation = 1, at_ms = 0): BrainEvent => ({ type: "brain", stage: s, state: "deciding", text: "", at_ms, evidence_age_ms: null, generation });
const action = (id: string, task = "컵 치우기", active = true): BrainEvent => ({ type: "action", id, task, plan: {} as never, active, at_ms: 1 });
const deviceAct = (extra: Partial<AgentAction> = {}): AgentAction => ({ tool: "turn_on", args: {}, ok: true, deviceId: "tv_1", deviceLabel: "TV", at: "2026-11-06T00:00:00Z", ...extra });

function hubWithLog() {
  const sent: Sent[] = [];
  const hub = new PlanHub(smallFloor(), (m) => sent.push(m as Sent), () => "t");
  return { hub, sent };
}

describe("PlanHub", () => {
  it("컵 치우기 행동이 오면 계획을 보내고, 결과가 오면 끝낸다", () => {
    const sent: unknown[] = [];
    const hub = new PlanHub(smallFloor(), (m) => sent.push(m), () => "t");
    hub.onBrain({ type: "brain", stage: "decide", state: "deciding", text: "", at_ms: 0, evidence_age_ms: null, generation: 1 });
    expect(hub.current()).toBeNull();
    hub.onBrain({ type: "action", id: "a1", task: "컵 치우기", plan: {} as never, active: true, at_ms: 1 });
    expect(hub.current()).toMatchObject({ goal: "컵 치우기", judgment: "할 일을 고르는 중", status: "running" });
    hub.onBrain({ type: "result", id: "a1", task: "컵 치우기", outcome: "cleared", text: "", at_ms: 2 });
    expect(hub.current()?.status).toBe("done");
    expect(sent.at(-1)).toMatchObject({ type: "plan", plan: { status: "done" } });
  });
  it("사람이 돌아오면 취소", () => {
    const hub = new PlanHub(smallFloor(), () => {}, () => "t");
    hub.onBrain({ type: "action", id: "a1", task: "컵 치우기", plan: {} as never, active: true, at_ms: 1 });
    hub.onBrain({ type: "brain", stage: "cancel", state: "in_use", text: "", at_ms: 2, evidence_age_ms: null, generation: 2 });
    expect(hub.current()).toMatchObject({ status: "cancelled", judgment: "사람이 돌아와 멈췄어요" });
  });
});

describe("PlanHub 번호·다시 계획·눈", () => {
  it("같은 계획을 고칠 때마다 revision +1, 새 계획은 supersedes", () => {
    const sent: { plan: { id: string; revision: number; supersedes?: string } }[] = [];
    const hub = new PlanHub(smallFloor(), (m) => sent.push(m as never), () => "t");
    hub.onBrain({ type: "action", id: "a1", task: "컵 치우기", plan: {} as never, active: true, at_ms: 1 });
    hub.setStep(hub.current()!.id, hub.current()!.steps[0]!.id, "active");
    expect(sent.at(-1)!.plan.revision).toBe(2);
    hub.onBrain({ type: "brain", stage: "decide", state: "deciding", text: "", at_ms: 2, evidence_age_ms: null, generation: 2 });
    hub.onBrain({ type: "action", id: "a2", task: "컵 치우기", plan: {} as never, active: true, at_ms: 3 });
    expect(sent.at(-1)!.plan.supersedes).toBe(sent[0]!.plan.id);
  });
  it("추정 눈은 로봇 위치로 쓰지 않는다", () => {
    const hub = new PlanHub(smallFloor(), () => {}, () => "t");
    hub.onEye([3, 3], true);
    hub.onBrain({ type: "action", id: "a1", task: "컵 치우기", plan: {} as never, active: true, at_ms: 1 });
    expect(hub.current()!.robot.position).toEqual([1, 2]); // smallFloor의 로봇 자리 그대로
  });
  it("맞춘 눈은 다음 계획부터 로봇 자리가 된다", () => {
    const { hub, sent } = hubWithLog();
    hub.onBrain(action("a1"));
    hub.onEye([2, 1], false);
    expect(sent).toHaveLength(1);
    expect(hub.current()!.robot.position).toEqual([1, 2]);
    hub.onBrain(stage("decide", 2));
    hub.onBrain(action("a2"));
    expect(hub.current()!.robot).toEqual({ position: [2, 1], room: "hall" });
    expect(hub.current()!.path[0]).toEqual([2, 1]);
  });
  it("끝난 계획 뒤 새 행동은 다시 계획이 아니다", () => {
    const { hub } = hubWithLog();
    hub.onBrain(action("a1"));
    hub.onBrain({ type: "result", id: "a1", task: "컵 치우기", outcome: "cleared", text: "", at_ms: 2 });
    hub.onBrain(stage("use", 2));
    hub.onBrain(action("a2"));
    expect(hub.current()).toMatchObject({ id: "a2", revision: 1 });
    expect(hub.current()!.supersedes).toBeUndefined();
  });
});

describe("PlanHub 컵 흐름", () => {
  it("첫 단계가 지금 단계, 끝나면 모든 단계 done, 판단은 끝났어요", () => {
    const { hub } = hubWithLog();
    hub.onBrain(stage("act"));
    hub.onBrain(action("a1"));
    expect(hub.current()!.judgment).toBe("컵을 치우러 가요");
    expect(hub.current()!.steps.map((s) => s.status)).toEqual(["active", "pending", "pending", "pending"]);
    hub.onBrain(action("a1", "컵 치우기", false));
    hub.onBrain({ type: "result", id: "a1", task: "컵 치우기", outcome: "cleared", text: "", at_ms: 2 });
    expect(hub.current()).toMatchObject({ status: "done", judgment: "끝났어요" });
    expect(hub.current()!.steps.every((s) => s.status === "done")).toBe(true);
  });
  it("거절·거둠은 cancelled, 확인 못 함은 failed. 남은 단계는 건너뜀", () => {
    const { hub } = hubWithLog();
    hub.onBrain(action("a1"));
    hub.onBrain({ type: "result", id: "a1", task: "컵 치우기", outcome: "withdrawn", text: "", at_ms: 2 });
    expect(hub.current()!.status).toBe("cancelled");
    expect(hub.current()!.steps.map((s) => s.status)).toEqual(["skipped", "skipped", "skipped", "skipped"]);
    hub.onBrain(stage("decide", 2));
    hub.onBrain(action("a2"));
    hub.onBrain({ type: "result", id: "a2", task: "컵 치우기", outcome: "unconfirmed", text: "", at_ms: 3 });
    expect(hub.current()!.status).toBe("failed");
    expect(hub.current()!.steps.map((s) => s.status)).toEqual(["failed", "skipped", "skipped", "skipped"]);
  });
  it("행동을 거두는 action(active false)·다른 id 결과로는 새 계획을 만들지 않는다", () => {
    const { hub, sent } = hubWithLog();
    hub.onBrain(action("a1", "컵 치우기", false));
    hub.onBrain({ type: "result", id: "a9", task: "컵 치우기", outcome: "cleared", text: "", at_ms: 2 });
    expect([hub.current(), sent]).toEqual([null, []]);
  });
  it("사용자에게 물어보기는 폰으로 묻는 한 단계, 판단도 묻는 글", () => {
    const { hub } = hubWithLog();
    hub.onBrain(stage("act"));
    hub.onBrain(action("a1", "사용자에게 물어보기"));
    expect(hub.current()).toMatchObject({ goal: "사용자에게 물어보기", judgment: "치울지 폰으로 물어봐요", path: [], steps: [{ kind: "ask", status: "active" }] });
    hub.onBrain({ type: "result", id: "a1", task: "사용자에게 물어보기", outcome: "answered", text: "", at_ms: 2 });
    expect(hub.current()!.status).toBe("done");
  });
  it("판단 글이 같으면 다시 보내지 않고, 끝난 계획은 뒤 판단으로 바뀌지 않는다", () => {
    const { hub, sent } = hubWithLog();
    hub.onBrain(action("a1"));
    hub.onBrain(stage("confirm"));
    hub.onBrain(stage("confirm"));
    expect(sent.map((m) => m.plan?.judgment)).toEqual(["", "하기 전에 한 번 더 보는 중"]);
    hub.onBrain({ type: "result", id: "a1", task: "컵 치우기", outcome: "cleared", text: "", at_ms: 2 });
    const n = sent.length;
    hub.onBrain(stage("result"));
    hub.onBrain(stage("cancel", 3));
    expect(sent).toHaveLength(n);
    expect(hub.current()).toMatchObject({ status: "done", judgment: "끝났어요" });
  });
  it("판정·존재 기록은 계획과 상관없다", () => {
    const { hub, sent } = hubWithLog();
    hub.onBrain({ type: "perception", at_ms: 0, evidence_age_ms: 0, frames: 1, summary: "", cost_usd: 0 });
    expect(sent).toEqual([]);
  });
});

describe("PlanHub 에이전트 기기 행동", () => {
  it("기기 행동은 계획 하나로 보낸다", () => {
    const { hub, sent } = hubWithLog();
    hub.onAgent({ event: "action", sessionId: "s", action: deviceAct() });
    expect(sent.at(-1)).toMatchObject({ type: "plan", plan: { source: "agent", goal: "TV 켜기", status: "done", path: [] } });
  });
  it("기기를 바꾸지 않는 도구·답·다른 이벤트는 무시", () => {
    const { hub, sent } = hubWithLog();
    hub.onAgent({ event: "action", sessionId: "s", action: deviceAct({ tool: "get_state" }) });
    hub.onAgent({ event: "reply", sessionId: "s", message: "", reply: "", actions: [], pendingConfirmations: [] });
    expect(sent).toEqual([]);
  });
  it("진행 중인 컵 계획은 덮지 않는다", () => {
    const { hub } = hubWithLog();
    hub.onBrain(action("a1"));
    hub.onAgent({ event: "action", sessionId: "s", action: deviceAct() });
    expect(hub.current()!.id).toBe("a1");
  });
  it("승인 대기는 planned, 승인하면 done, 취소하면 cancelled", () => {
    const { hub } = hubWithLog();
    const pending = { token: "tok", deviceId: "tv_1", deviceLabel: "TV", command: { type: "on" as const }, reason: "", expiresAt: "" };
    hub.onAgent({ event: "action", sessionId: "s", action: deviceAct({ ok: false, needsConfirmation: true }) });
    hub.onAgent({ event: "pending", sessionId: "s", pending });
    expect(hub.current()).toMatchObject({ status: "planned", steps: [{ status: "pending" }] });
    hub.onAgent({ event: "confirmed", sessionId: "s", token: "tok", ok: true, reply: "", deviceId: "tv_1" });
    expect(hub.current()).toMatchObject({ status: "done", revision: 2, steps: [{ status: "done" }] });

    hub.onAgent({ event: "action", sessionId: "s", action: deviceAct({ ok: false, needsConfirmation: true, at: "2026-11-06T00:00:01Z" }) });
    hub.onAgent({ event: "pending", sessionId: "s", pending: { ...pending, token: "tok2" } });
    hub.onAgent({ event: "cancelled", sessionId: "s", token: "tok2" });
    expect(hub.current()).toMatchObject({ status: "cancelled", steps: [{ status: "skipped" }] });
  });
});

describe("PlanHub task planner 계획", () => {
  const planned = (extra: Partial<PlanView> = {}): PlanView => ({
    id: "x1", revision: 1, origin: "mock", source: "planner", goal: "컵 치우기", judgment: "", dryRun: true,
    robot: { position: null, room: null }, path: [], legs: [], steps: [{ id: "x1:1", kind: "wait", label: "기다리기", status: "active" }],
    status: "running", updatedAt: "2026-11-06T00:00:00Z", ...extra,
  });
  it("받은 origin을 그대로 두고 보낸다", () => {
    const { hub, sent } = hubWithLog();
    hub.put(planned());
    expect(sent.at(-1)).toMatchObject({ type: "plan", plan: { id: "x1", origin: "mock", revision: 1 } });
  });
  it("같은 id를 다시 받으면 번호는 지금보다 크게", () => {
    const { hub } = hubWithLog();
    hub.put(planned());
    hub.setStep("x1", "x1:1", "done");
    expect(hub.current()).toMatchObject({ revision: 2, status: "done" });
    hub.put(planned({ revision: 2, judgment: "다시 보는 중" }));
    expect(hub.current()).toMatchObject({ revision: 3, judgment: "다시 보는 중" });
    hub.put(planned({ revision: 9 }));
    expect(hub.current()!.revision).toBe(9);
  });
  it("없는 계획·단계는 false", () => {
    const { hub } = hubWithLog();
    expect(hub.setStep("x1", "x1:1", "done")).toBe(false);
    hub.put(planned());
    expect(hub.setStep("x1", "x1:9", "done")).toBe(false);
    expect(hub.setStep("x1", "x1:1", "failed")).toBe(true);
    expect(hub.current()!.status).toBe("failed");
  });
});

describe("실제 컵 두뇌(LiveBrain) 메시지로 계획", () => {
  it("행동이 나오면 컵 계획이 running, 나중에로 답하면 cancelled. 대시보드 메시지 그대로 받는다", async () => {
    const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);
    const PHOTO = Buffer.from([0xff, 0xd8, 0x02, 0xff, 0xd9]);
    const base: RawPerception = {
      person_present: "no", person_holding_cup: "no", drinking: "no", cup_visible: "yes", cup_support: "table",
      cup_contents: { visible: false, value: "unknown", certain: false }, note: "",
    };
    const drinking: RawPerception = { ...base, person_present: "yes", person_holding_cup: "yes", drinking: "yes", cup_support: "hand" };
    const person: Detection = { label: "person", score: 0.9, box: [0, 0, 1, 1], cls: 0 };
    const cup: Detection = { label: "cup", score: 0.8, box: [0, 0, 1, 1], cls: 41 };
    let now = 0;
    let phase: "drink" | "away" = "drink";
    const { hub, sent } = hubWithLog();
    hub.onDashboard({ type: "eye", eye: {} });
    const live = new LiveBrain({
      config: { ...DEFAULT_BRAIN_CONFIG, awayMs: 2000 },
      perceiver: new ScriptedPerceiver((frames) => {
        if (frames.length === 1 && frames[0]!.jpeg === PHOTO) return { ...base, cup_contents: { visible: true, value: "empty", certain: true } };
        return phase === "drink" ? drinking : base;
      }),
      detector: new ScriptedDetector(() => (phase === "drink" ? [person, cup] : [cup])),
      decision: new MockDecision(),
      surfaces: () => [],
      toDashboard: (m) => hub.onDashboard(m), toPhone: () => {},
      clock: { now: () => now }, tickMs: 60_000,
    });
    const step = async (t: number) => {
      now = t;
      live.onFrame(JPEG, { receivedAtMs: t, capturedAt: t - 20, timeErrMs: 5, eye: null });
      await live.idle();
      live.brain.tick();
      await live.idle();
    };
    try {
      for (let t = 0; t <= 2000; t += 84) await step(t);
      phase = "away";
      for (let t = 2084; t <= 7000; t += 84) await step(t);
      expect(sent).toEqual([]);
      now = 7050;
      live.onPhoto(PHOTO, { receivedAtMs: 7050, capturedAt: 7040, timeErrMs: 5, eye: null });
      await live.idle();
      for (let t = 7084; t <= 18_000 && !hub.current(); t += 84) await step(t);
      const plan = hub.current()!;
      expect(plan).toMatchObject({ source: "brain", goal: "컵 치우기", judgment: "컵을 치우러 가요", status: "running", revision: 1, path: [[1, 2], [4, 2], expect.any(Array), expect.any(Array)] });
      live.onReply(plan.id, "later");
      expect(hub.current()).toMatchObject({ id: plan.id, status: "cancelled" });
      expect(sent.every((m) => m.type === "plan")).toBe(true);
    } finally {
      await live.close();
    }
  }, 30_000);
});
