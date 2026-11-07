import { describe, expect, it } from "vitest";
import type { AgentAction } from "../src/contract/events.js";
import type { PlanView } from "../src/contract/plan.js";
import { PlanHub } from "../src/plan/hub.js";
// fp는 plan-planner.test.ts와 같은 평면도
import { smallFloor } from "./helpers/floor.js";

type Sent = { type: string; plan: PlanView | null };

const deviceAct = (extra: Partial<AgentAction> = {}): AgentAction => ({ tool: "turn_on", args: {}, ok: true, deviceId: "tv_1", deviceLabel: "TV", at: "2026-11-06T00:00:00Z", ...extra });
const planned = (extra: Partial<PlanView> = {}): PlanView => ({
  id: "x1", revision: 1, origin: "mock", source: "planner", goal: "컵 치우기", judgment: "", dryRun: true,
  robot: { position: null, room: null }, path: [], legs: [], steps: [{ id: "x1:1", kind: "wait", label: "기다리기", status: "active" }],
  status: "running", updatedAt: "2026-11-06T00:00:00Z", ...extra,
});

function hubWithLog() {
  const sent: Sent[] = [];
  const hub = new PlanHub(smallFloor(), (m) => sent.push(m as Sent), () => "t");
  return { hub, sent };
}

describe("PlanHub 눈", () => {
  it("추정 눈은 로봇 위치로 쓰지 않는다", () => {
    const hub = new PlanHub(smallFloor(), () => {}, () => "t");
    hub.onEye([3, 3], true);
    hub.onAgent({ event: "action", sessionId: "s", action: deviceAct() });
    expect(hub.current()!.robot.position).toEqual([1, 2]); // smallFloor의 로봇 자리 그대로
  });
  it("맞춘 눈은 다음 계획부터 로봇 자리가 된다", () => {
    const { hub, sent } = hubWithLog();
    hub.onAgent({ event: "action", sessionId: "s", action: deviceAct() });
    hub.onEye([2, 1], false);
    expect(sent).toHaveLength(1);
    expect(hub.current()!.robot.position).toEqual([1, 2]);
    hub.onAgent({ event: "action", sessionId: "s", action: deviceAct({ at: "2026-11-06T00:00:01Z" }) });
    expect(hub.current()!.robot).toEqual({ position: [2, 1], room: "hall" });
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
  it("진행 중인 다른 출처 계획은 덮지 않는다", () => {
    const { hub } = hubWithLog();
    hub.put(planned());
    hub.onAgent({ event: "action", sessionId: "s", action: deviceAct() });
    expect(hub.current()!.id).toBe("x1");
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
