import { describe, expect, it } from "vitest";
import { ExecutionTracker, type TrackerOptions } from "../src/act/track.js";
import type { CheckResult } from "../src/act/check.js";
import type { BrainLog } from "../src/contract/events.js";
import type { WorldChange, WorldObject, WorldView } from "../src/contract/world.js";
import { PlanHub } from "../src/plan/hub.js";
import { EXEC_TEXT } from "../src/plan/labels.js";
import type { DecisionRecord } from "../src/world/decide.js";
import { smallFloor } from "./helpers/floor.js";

type PhoneMsg = { type: string; id: string; active: boolean; [k: string]: unknown };

const cup = (status: WorldObject["status"], seen = 9_000): WorldObject => ({
  id: "cup_1", cls: "cup", position: [2, 0.75, 1], surface: "t", surface_label: "식탁", room: "hall", error_m: 0.1, status,
  first_seen_ms: 0, last_seen_ms: seen, last_in_view_ms: seen, facts: {}, devices: [],
});
const world = (...objects: WorldObject[]): WorldView => ({
  at_ms: 0, objects, person: { visible: false, since_ms: 0, last_seen_ms: null, facts: {} }, devices: [], eye: null, vlm_missing: 0, yolo_missing: 0,
});
const pred = { observation: "o", reasoning: "r", task_index: 0 };
const decision: DecisionRecord = {
  id: "pam-1", seq: 1, atMs: 8_000, textSent: "t", finalTime: "x", status: "valid", prediction: pred, action: "컵 치우기", memoryVersion: 1,
  world: { objects: [], person_visible: false, vlm_missing: 0, yolo_missing: 0 },
};
const ask = (id: string, seq: number): DecisionRecord => ({ ...decision, id, seq, action: "사용자에게 물어보기", prediction: { ...pred, task_index: 1 } });
const gone: WorldChange = { kind: "gone", at_ms: 11_000, subject: "cup_1", text: "컵 cup_1 사라짐", meaningful: true };

function setup(over: Partial<TrackerOptions> & { w?: () => WorldView; check?: () => CheckResult } = {}) {
  const logs: BrainLog[] = [];
  const phone: PhoneMsg[] = [];
  const clock = { t: 10_000, now() { return this.t; } };
  const plans = new PlanHub(smallFloor(), () => {}, () => "t");
  const t = new ExecutionTracker({
    plans, world: over.w ?? (() => world(cup("present"))), check: over.check ?? (() => ({ ok: true })), floor: () => plans.floor(),
    toPhone: (m) => phone.push(m as PhoneMsg), emit: (l) => logs.push(l), clock, ...over,
  });
  const exec = () => logs.flatMap((l) => (l.type === "execution" ? [l] : []));
  return { t, logs, phone, clock, plans, exec };
}

describe("실행 추적", () => {
  it("판단 → 계획 → 실행 중(폰 부탁) → 결과 확인 → 완료, 단계마다 기록하고 계획을 닫는다", () => {
    let w = world(cup("present"));
    const { t, phone, plans, exec } = setup({ w: () => w });
    t.onDecision(decision);
    expect(phone[0]).toMatchObject({ type: "action", id: "plan:pam-1", task: "컵 치우기", text: "식탁 위 컵을 치워 주세요", speak: true, active: true, dry_run: true });
    expect(plans.current()).toMatchObject({ id: "plan:pam-1", status: "running" });
    t.onReply("plan:pam-1", "done");
    w = world(cup("gone"));
    t.onWorld([gone]);
    expect(exec().map((l) => l.state)).toEqual(["decided", "planned", "running", "verifying", "done"]);
    expect(exec().every((l) => l.plan_id === "plan:pam-1")).toBe(true);
    expect(plans.current()?.status).toBe("done");
    expect(phone.at(-1)).toMatchObject({ id: "plan:pam-1", active: false });
  });

  it("부탁 중에 사람이 먼저 치워도 결과 확인을 거쳐 완료", () => {
    const { t, exec } = setup();
    t.onDecision(decision);
    t.onWorld([{ ...gone, subject: "cup_9" }]);
    expect(t.current()).toMatchObject({ state: "running" });
    t.onWorld([gone]);
    expect(exec().map((l) => l.state).slice(-2)).toEqual(["verifying", "done"]);
  });

  it("검사가 통과할 때까지 tick마다 다시 보고, 그 사이 통과하면 실행한다", () => {
    let ok = false;
    const { t, clock, phone } = setup({ check: () => (ok ? { ok: true } : { ok: false, reason: "stale", text: "x" }), recheckMs: 3000 });
    t.onDecision(decision);
    expect(t.current()).toMatchObject({ state: "planned" });
    clock.t += 1000;
    t.tick();
    expect(t.current()).toMatchObject({ state: "planned" });
    ok = true;
    t.tick();
    expect(t.current()).toMatchObject({ state: "running" });
    expect(phone.filter((m) => m.active)).toHaveLength(1);
  });

  it("recheckMs가 지나도 검사를 통과하지 못하면 실패로 끝내고 이유를 남긴다. 대기는 기록만", () => {
    const { t, logs, plans, phone } = setup({ check: () => ({ ok: false, reason: "in_hand", text: "사람이 그 물건을 쓰는 중이라 실행하지 않아요" }), recheckMs: 0 });
    t.onDecision(decision);
    t.tick();
    expect(logs.at(-1)).toMatchObject({ type: "execution", state: "failed", text: "사람이 그 물건을 쓰는 중이라 실행하지 않아요" });
    expect(plans.current()?.status).toBe("failed");
    expect(phone).toEqual([]);
    t.onDecision({ ...decision, id: "pam-2", seq: 2, action: null, prediction: { ...pred, task_index: -1 } });
    expect(logs.at(-1)).toMatchObject({ type: "execution", plan_id: "plan:pam-2", state: "decided", text: EXEC_TEXT.wait });
    t.onDecision({ ...decision, id: "pam-3", seq: 3, status: "failed", action: null, prediction: null, error: "e" });
    expect(logs.at(-1)).toMatchObject({ type: "execution", plan_id: "plan:pam-3", state: "decided", text: EXEC_TEXT.decisionFailed });
  });

  it("periodic처럼 같은 판단이 연달아 와도 폰 부탁은 한 번이고 그 계획이 완료까지 간다", () => {
    let w = world(cup("present"));
    const { t, logs, phone } = setup({ w: () => w });
    for (let s = 1; s <= 4; s++) t.onDecision({ ...decision, id: `pam-${s}`, seq: s });
    expect(phone.filter((m) => m.active)).toHaveLength(1);
    const planId = t.current()!.planId;
    expect(planId).toBe("plan:pam-1");
    expect(logs.filter((l) => l.type === "execution" && l.text === EXEC_TEXT.same).map((l) => l.type === "execution" && l.plan_id)).toEqual(["plan:pam-2", "plan:pam-3", "plan:pam-4"]);
    t.onReply(planId, "done");
    w = world(cup("gone"));
    t.onWorld([gone]);
    expect(t.current()).toMatchObject({ planId, state: "done" });
  });

  it("지금 계획보다 먼저 보낸 판단의 답이 늦게 오면 버린다", () => {
    const { t, logs, phone } = setup();
    t.onDecision(ask("pam-5", 5));
    t.onDecision({ ...decision, id: "pam-4", seq: 4 });
    expect(t.current()).toMatchObject({ planId: "plan:pam-5", state: "running" });
    expect(logs.at(-1)).toMatchObject({ type: "execution", plan_id: "plan:pam-4", text: EXEC_TEXT.late });
    expect(phone.filter((m) => m.active)).toHaveLength(1);
  });

  it("다른 행동을 고른 새 판단은 진행 중 계획을 바꾼다", () => {
    const { t, phone, plans, exec } = setup();
    t.onDecision(decision);
    t.onDecision(ask("pam-2", 2));
    expect(exec().find((l) => l.plan_id === "plan:pam-1" && l.state === "failed")).toMatchObject({ text: EXEC_TEXT.superseded });
    expect(phone.map((m) => [m.id, m.active])).toEqual([["plan:pam-1", true], ["plan:pam-1", false], ["plan:pam-2", true]]);
    expect(plans.current()).toMatchObject({ id: "plan:pam-2", supersedes: "plan:pam-1", status: "running" });
  });

  it("물어보기는 답을 받으면 완료, 집기 부탁은 나중에면 실패, 다른 계획 답은 무시", () => {
    const a = setup();
    a.t.onDecision(ask("pam-1", 1));
    a.t.onReply("plan:other", "keep");
    expect(a.t.current()).toMatchObject({ state: "running" });
    a.t.onReply("plan:pam-1", "keep");
    expect(a.exec().at(-1)).toMatchObject({ state: "done", text: "완료: 그대로 둬요" });
    const b = setup();
    b.t.onDecision(decision);
    b.t.onReply("plan:pam-1", "later");
    expect(b.exec().at(-1)).toMatchObject({ state: "failed", text: EXEC_TEXT.declined });
  });

  it("답을 누를 때 이미 사라진 물건이면 바로 완료, 결과를 제한 시간 안에 못 보면 실패", () => {
    let w = world(cup("present"));
    const a = setup({ w: () => w });
    a.t.onDecision(decision);
    w = world(cup("gone"));
    a.t.onReply("plan:pam-1", "done");
    expect(a.exec().map((l) => l.state).slice(-2)).toEqual(["verifying", "done"]);
    const b = setup({ verifyTimeoutMs: 5000 });
    b.t.onDecision(decision);
    b.t.onReply("plan:pam-1", "done");
    b.clock.t += 5001;
    b.t.tick();
    expect(b.exec().at(-1)).toMatchObject({ state: "failed", text: EXEC_TEXT.timeout });
    const c = setup({ verifyTimeoutMs: 5000 });
    c.t.onDecision(ask("pam-1", 1));
    c.clock.t += 5001;
    c.t.tick();
    expect(c.exec().at(-1)).toMatchObject({ state: "failed", text: EXEC_TEXT.noAnswer });
  });

  it("열린 부탁(폰 질문)을 알려 주고, 멈추면 더 기록하지 않는다", () => {
    const { t, logs } = setup();
    expect(t.openRequest()).toBeNull();
    t.onDecision(ask("pam-1", 1));
    expect(t.openRequest()).toMatchObject({ planId: "plan:pam-1", task: "사용자에게 물어보기", choices: [{ id: "clear" }, { id: "keep" }] });
    t.stop();
    const n = logs.length;
    t.onDecision({ ...decision, id: "pam-2", seq: 2 });
    t.tick();
    expect(logs).toHaveLength(n);
  });
});
