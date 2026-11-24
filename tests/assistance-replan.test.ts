import { expect, it, vi } from "vitest";
import { PlanHub } from "../src/act/index.js";
import { EXEC_TEXT } from "../src/act/labels.js";
import { HistoryDb } from "../src/brain/index.js";
import type { EvidenceRef } from "../src/contract/assistance.js";
import { assistanceOutcome } from "../src/contract/assistance-outcome.js";
import type { DecisionRecord } from "../src/contract/events.js";
import type { WorldObject, WorldView } from "../src/contract/world.js";
import type { AgentPlan, AgentStep } from "../src/contract/plan-work.js";
import { VirtualClock } from "../src/bus/clock.js";
import { floorPlanFrom } from "../src/layout/index.js";
import { HomeTrace } from "../src/server/home/trace.js";
import { SMALL_SCENE } from "./helpers/floor.js";
import { testTracker, type TrackerFixture } from "./helpers/tracker-ports.js";
import { cameraAt } from "./helpers/home-realism.js";

const world: WorldView = {
  at_ms: 1000, frame_ms: null, objects: [], fixtures: [], devices: [], eye: null, vlm_missing: 0, yolo_missing: 0,
  person: { visible: false, count: 0, since_ms: null, last_seen_ms: null, room: "living", room_label: null, position: null,
    position_ms: null, near: [], holding: [], facts: {}, answered_ms: null },
};
const decision: DecisionRecord = {
  id: "d", seq: 1, atMs: 1000, action: "에어컨 켜기", status: "valid", textSent: "", finalTime: "", prediction: null,
  memoryVersion: 1, world: { objects: [], person_visible: false, vlm_missing: 0, yolo_missing: 0 },
};

function rig(ports: Partial<NonNullable<TrackerFixture["assistance"]>> = {}, trace?: HomeTrace) {
  const clock = new VirtualClock(1000);
  const toPhone = vi.fn(), emit = vi.fn(), run = vi.fn();
  const planner = vi.fn(() => ({ ok: false as const, error: "no_plan" }));
  const ended = vi.fn();
  const floor = () => floorPlanFrom(SMALL_SCENE);
  const tracker = testTracker({
    plans: new PlanHub(floor(), () => {}, () => ""), approvals: { memory: () => ({ always: {} }), answer: () => {} }, check: () => ({ ok: true }), planner,
    world: () => world, clock, toPhone, floor, emit, trace, devices: { run, confirm: vi.fn(), cancel: vi.fn() },
    assistance: { boot: "b", homeEpoch: "h#1", home: "h", targetDevice: () => "ac", ended, ...ports },
  });
  return { tracker, clock, toPhone, emit, run, planner, ended };
}

it("publishes a failed activity once before any command, attached to its registered decision", async () => {
  const trace = new HomeTrace("b:h#1", () => 1000, () => {});
  const r = rig({ ended: (attempt, result, ms) => trace.ended(attempt, result, ms) }, trace);
  const selected = trace.event("action", { decision_id: decision.id }, "selected", undefined, { action: decision.action! })!;
  r.tracker.onDecision(decision);
  await r.tracker.idle();
  r.tracker.stop();
  expect(r.toPhone).not.toHaveBeenCalled();
  expect(trace.snapshot().rows.filter(row => row.kind === "EXECUTION")).toEqual([
    expect.objectContaining({ activity_id: selected.activity_id, name: "활동 종료", output: "활동 실패", state: "failed",
      refs: expect.objectContaining({ decision_id: decision.id }) }),
  ]);
});

it("uses a recent hardware read from before the attempt without calling a model or issuing a command", async () => {
  const ref: EvidenceRef = { source: "hub", subjectId: "ac", originId: "device-read:19", observedMs: 900 };
  const choose = vi.fn();
  const r = rig({ readDevice: () => ({ attr: "power", value: true, ref }), evidence: { choose, acquire: vi.fn() } });
  r.tracker.onDecision(decision);
  await r.tracker.idle();
  expect(r.planner).not.toHaveBeenCalled();
  expect(choose).not.toHaveBeenCalled();
  expect(r.run).not.toHaveBeenCalled();
  expect(r.toPhone).not.toHaveBeenCalled();
  expect(r.ended).toHaveBeenCalledTimes(1);
  expect(r.ended.mock.calls[0]?.[1]).toBe("done");
});

it("does not emit even an approval or a planner call for a deferred proactive request", () => {
  const r = rig({ interventionFor: () => "defer_proactive" });
  r.tracker.onDecision(decision);
  expect(r.planner).not.toHaveBeenCalled();
  expect(r.toPhone).not.toHaveBeenCalled();
  expect(r.run).not.toHaveBeenCalled();
});

it("does not turn a proactive decision into a direct request because the observation contains unrelated speech", () => {
  const r = rig({ interventionFor: () => "defer_proactive" });
  r.tracker.onDecision({ ...decision, action: "물 한 잔 가져다주기", textSent: "들은 말: 지금 몇 시야?" });
  expect(r.planner).not.toHaveBeenCalled();
  expect(r.toPhone).not.toHaveBeenCalled();
});

const step = (id: string, kind: AgentStep["kind"], target: string, object: string | null = null): AgentStep => ({
  id, kind, target, object, label: kind, command: "해주세요", prompt: null, text: null, device: null, hand: null,
  caution: null, until: null, timeoutMs: 60000, onTimeout: "fail",
});
function plan(d: DecisionRecord, steps: AgentStep[]): AgentPlan {
  return { task: d.action!, steps, view: { id: "plan:" + d.id, revision: 1, source: "agent", goal: "테스트", judgment: "", dryRun: false,
    robot: { position: null, room: null }, path: [], legs: [], status: "planned", updatedAt: new Date(d.atMs).toISOString(),
    steps: steps.map(s => ({ id: s.id, kind: s.kind === "go" ? "move" : "act", label: s.label, status: "pending" })) } };
}
function cameraWorld(room: string, count: number, t: number, surface: string | null, held = false): WorldView {
  const cup: WorldObject = { id: "cup_1", cls: "cup", position: [6, .8, 2], surface, surface_label: null, room, error_m: .05,
    status: "present", first_seen_ms: 800, last_seen_ms: t, last_in_view_ms: t, facts: {
      place: { value: held ? "in_hand" : "on_table", certainty: "confirmed", at_ms: t, since_ms: t },
      contents: { value: "has_contents", certainty: "confirmed", at_ms: t, since_ms: t },
    }, answered_ms: t, devices: [], closer_hold: false, followed_by: null };
  return { ...world, at_ms: t, objects: [cup],
    person: { ...world.person, room, visible: true, count, holding: held ? [cup.id] : [], position_ms: t },
    household_photo: { id: "frame-" + t, at_ms: t, serial: t,
      proof: { camera: cameraAt([5, 1], [6, 2]), seats: "clear", person_count: count, dining_food: "unknown",
        person: { position: [6, 2], room, seated: false, attention: "elsewhere" } } } };
}
function movement(start: WorldView, planner: TrackerFixture["planner"], ports: Partial<NonNullable<TrackerFixture["assistance"]>> = {}, trace?: HomeTrace) {
  const clock = new VirtualClock(1000), commands = vi.fn(), ended = vi.fn(), emit = vi.fn();
  const floor = () => floorPlanFrom({ ...SMALL_SCENE, objects: [...SMALL_SCENE.objects,
    { id: "hall_table", room: "hall", type: "dining_table", plan: { position: [2, 2] } }] });
  const approvals = { memory: () => ({ always: {} }), answer: () => {} };
  let w = start;
  const tracker = testTracker({
    plans: new PlanHub(floor(), () => {}, () => ""), approvals, check: () => ({ ok: true }), planner, world: () => w,
    clock, toPhone: commands, floor, emit, trace,
    assistance: { boot: "b", homeEpoch: "h#1", home: "h", resident: v => v.person.count === 1 ? "member" : null, ended, ...ports },
  });
  return { tracker, commands, ended, emit, photo: (next: WorldView) => { clock.set(next.at_ms); w = next; tracker.onWorld(); } };
}

it("records a single cancelled outcome when closer evidence invalidates a plan still being drafted", async () => {
  const db = HistoryDb.open(":memory:");
  try {
    const d = { ...decision, action: "컵에 물 채워 주기" };
    const trace = new HomeTrace("b:h#1", () => 1000, () => {});
    const selected = trace.event("action", { decision_id: d.id }, "selected")!;
    let resolvePlan!: (result: Awaited<ReturnType<TrackerFixture["planner"]>>) => void;
    const pending = new Promise<Awaited<ReturnType<TrackerFixture["planner"]>>>(resolve => { resolvePlan = resolve; });
    const record = vi.fn<NonNullable<NonNullable<TrackerFixture["assistance"]>["ended"]>>((attempt, execution, ms, proofs) => {
      db.recordAssistanceOutcome(assistanceOutcome(attempt, execution, ms, proofs));
      trace.ended(attempt, execution, ms);
    });
    const r = movement(cameraWorld("kitchen", 1, 1000, "table_1"), () => pending, { ended: record }, trace);
    r.tracker.onDecision(d);
    const changed = cameraWorld("kitchen", 1, 1200, "table_1");
    changed.objects[0]!.closer_rev = { contents: 1 };
    changed.objects[0]!.facts.contents = { value: "empty", at_ms: 1200, since_ms: 1200, certainty: "confirmed" };
    r.photo(changed);
    resolvePlan({ ok: true, plan: plan(d, [step("pick", "pick", "table_1", "cup_1")]) });
    await r.tracker.idle();
    r.tracker.onDecision(d);
    r.tracker.stop();
    expect(r.emit.mock.calls.map(([message]) => message.text)).toContain(EXEC_TEXT.closerNewer);
    expect(r.commands.mock.calls.filter(([m]) => m.type === "command")).toHaveLength(0);
    expect(record).toHaveBeenCalledTimes(1);
    const rows = trace.snapshot().rows;
    const guard = rows.find(row => row.kind === "GUARDRAIL")!;
    expect(rows.filter(row => row.kind === "EXECUTION")).toEqual([
      expect.objectContaining({ activity_id: selected.activity_id, name: "활동 종료", output: "활동 취소", state: "cancelled", cause_id: guard.id }),
    ]);
    expect(db.list({ kinds: ["assistance_outcome"] }).map(row => row.data)).toEqual([
      expect.objectContaining({ execution: "cancelled", reaction: "unknown", proof: null, key: { boot: "b", homeEpoch: "h#1", attemptId: d.id, gen: 0 } }),
    ]);
  } finally { db.close(); }
});

it("cancels a draft displaced by safety and resumes the waiting direct request as a fresh attempt", async () => {
  let finishFirst!: () => void;
  const planner = vi.fn<TrackerFixture["planner"]>().mockImplementationOnce(d => new Promise(resolve => {
    finishFirst = () => resolve({ ok: true, plan: plan(d, [step("pick", "pick", "table_1", "cup_1")]) });
  })).mockImplementation(d => ({ ok: true, plan: plan(d, [step("pick", "pick", "table_1", "cup_1")]) }));
  const r = movement(cameraWorld("kitchen", 1, 1000, "table_1"), planner);
  r.tracker.onRequest({ task: "컵 치우기", heard: "컵 치워 줘", atMs: 1000, afterSeq: 0 });
  const fall = cameraWorld("kitchen", 1, 1200, "table_1");
  fall.person.facts = { ...fall.person.facts, posture: { value: "fall_suspected", at_ms: 1200, since_ms: 1200, certainty: "confirmed" } };
  r.photo(fall);
  finishFirst();
  await r.tracker.idle();
  expect(r.ended).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ request: "direct" }), "cancelled", 1200, []);
  expect(r.tracker.openCommand()).toBeNull();
  r.photo(cameraWorld("kitchen", 1, 1500, "table_1"));
  r.tracker.tick();
  await r.tracker.idle();
  expect(planner).toHaveBeenCalledTimes(2);
  expect(r.tracker.openCommand()?.stepId).toBe("pick");
  r.tracker.stop();
  expect(r.ended.mock.calls[1]?.[0].key.attemptId).not.toBe(r.ended.mock.calls[0]?.[0].key.attemptId);
});

it("does not fail the active pickup when the selected cup appears in hand", () => {
  const d = { ...decision, action: "컵 치우기" };
  const r = movement(cameraWorld("kitchen", 1, 1000, "table_1"),
    current => ({ ok: true, plan: plan(current, [step("pick", "pick", "table_1", "cup_1"), step("place", "place", "sink_1", "cup_1")]) }));
  r.tracker.onDecision(d);
  expect(r.tracker.openCommand()?.stepId).toBe("pick");
  r.photo(cameraWorld("kitchen", 1, 1200, null, true));
  expect(r.tracker.current()?.state).toBe("running");
  expect(r.ended).not.toHaveBeenCalled();
});

it("withdraws the old destination and asks to put the held object down safely", () => {
  const r = movement(cameraWorld("kitchen", 1, 1000, "sink_1"), current => ({
    ok: true, plan: plan(current, [step("pick", "pick", "sink_1", "cup_1"), step("go-old", "go", "table_1"), step("place-old", "place", "table_1", "cup_1")]),
  }));
  r.tracker.onDecision({ ...decision, action: "물 한 잔 가져다주기" });
  r.photo(cameraWorld("hall", 1, 1200, null, true));
  expect(r.tracker.onAnswer("plan:d", "pick", "done")).toBe(true);
  const handoff = r.tracker.openCommand();
  expect(handoff?.stepId).toMatch(/:safe-place$/);
  expect(r.commands.mock.calls.some(([m]) => m.step === "go-old" || m.step === "place-old")).toBe(false);
  expect(r.tracker.onAnswer("plan:d", handoff!.stepId, "done")).toBe(true);
  expect(r.ended.mock.calls[0]?.[1]).toBe("cancelled");
});

it("verify_first holds the first delivery command until the bound recipient is actually observed", async () => {
  const r = movement(cameraWorld("kitchen", 0, 1000, "sink_1"), current => ({
    ok: true, plan: plan(current, [step("go", "go", "table_1"), step("place", "place", "table_1", "cup_1")]),
  }), {
    resident: () => "member", interventionFor: () => "verify_first",
    evidence: { choose: async () => ({ tool: "wait_for_new_photo" }), acquire: async () => null },
  });
  r.tracker.onDecision({ ...decision, action: "물 한 잔 가져다주기" });
  expect(r.tracker.openCommand()).toBeNull();
  expect(r.commands).not.toHaveBeenCalled();
  r.photo(cameraWorld("kitchen", 1, 1300, "sink_1"));
  r.tracker.tick();
  expect(r.tracker.openCommand()?.stepId).toBe("go");
});

it("does not attribute the same cup held by an unidentified person to the recipient", () => {
  const d = { ...decision, action: "물 한 잔 가져다주기" };
  const r = movement(cameraWorld("kitchen", 1, 1000, "sink_1"), current => ({
    ok: true, plan: plan(current, [step("go", "go", "table_1"), step("place", "place", "table_1", "cup_1")]),
  }));
  r.tracker.onDecision(d);
  r.photo(cameraWorld("kitchen", 2, 1200, null, true));
  expect(r.ended).not.toHaveBeenCalled();
  r.photo(cameraWorld("kitchen", 1, 1300, null, true));
  expect(r.ended).toHaveBeenCalledWith(expect.objectContaining({user: "member"}), "done", 1300,
    [expect.objectContaining({ kind: "self_resolved" })]);
});

it("withdraws the old phone command and keeps the attempt when the empty-handed recipient changes rooms", async () => {
  const d = { ...decision, action: "물 한 잔 가져다주기" };
  const planner = vi.fn<TrackerFixture["planner"]>(current => {
    const dest = current.id === d.id ? "table_1" : "hall_table";
    return { ok: true, plan: plan(current, [step("go", "go", dest), step("place", "place", dest, "cup_1")]) };
  });
  const r = movement(cameraWorld("kitchen", 1, 1000, "sink_1"), planner);
  r.tracker.onDecision(d);
  r.photo(cameraWorld("hall", 1, 1200, "sink_1"));
  await r.tracker.idle();
  expect(planner).toHaveBeenCalledTimes(2);
  expect(r.tracker.onAnswer("plan:d", "go", "done")).toBe(false);
  expect(r.tracker.openCommand()?.planId).toMatch(/^plan:d:replacement:/);
  r.tracker.onHeard("그만");
  expect(r.ended).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
    key: { boot: "b", homeEpoch: "h#1", attemptId: "d", gen: 1 },
  }), "cancelled", 1200, []);
});

it("ignores a replacement planner that answers after stop", async () => {
  const d = { ...decision, action: "물 한 잔 가져다주기" };
  let next!: (value: Awaited<ReturnType<TrackerFixture["planner"]>>) => void;
  const r = movement(cameraWorld("kitchen", 1, 1000, "sink_1"), current => current.id === d.id
    ? { ok: true, plan: plan(current, [step("go", "go", "table_1"), step("place", "place", "table_1", "cup_1")]) }
    : new Promise(resolve => { next = resolve; }));
  r.tracker.onDecision(d);
  r.photo(cameraWorld("hall", 1, 1200, "sink_1"));
  await Promise.resolve();
  r.tracker.onHeard("그만");
  const count = r.commands.mock.calls.length;
  next({ ok: true, plan: plan({ ...d, id: "late" }, [step("go", "go", "hall_table"), step("place", "place", "hall_table", "cup_1")]) });
  await r.tracker.idle();
  expect(r.commands).toHaveBeenCalledTimes(count);
  expect(r.ended).toHaveBeenCalledTimes(1);
});
