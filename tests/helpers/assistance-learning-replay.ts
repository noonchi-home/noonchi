import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bindAssistanceAnswers, checkDecision, checkPlan, deviceRunner, emitRobotCommand, ExecutionTracker, PlanHub, progressRoutes, publishAssistanceOutcome } from "../../src/act/index.js";
import { tasksFor } from "../../src/act/tasks.js";
import { Policy } from "../../src/agent/index.js";
import { memoryApprovals } from "../../src/agent/approval.js";
import { PlanDraft } from "../../src/agent/planTools.js";
import { Decider, HistoryDb, memoryForDay, NightReflection, runReflection } from "../../src/brain/index.js";
import { CUP_FSM_MEMORY } from "../../src/brain/decision.js";
import { candidateFsmOf } from "../../src/brain/pam/adopt.js";
import { BusNode, MemoryBus, Outbox, VirtualClock, type NodeName } from "../../src/bus/index.js";
import { assistanceContext, type AssistanceOutcome } from "../../src/contract/assistance-outcome.js";
import type { DeviceSpec } from "../../src/contract/devices.js";
import type { DecisionRecord } from "../../src/contract/events.js";
import type { PlannedCommand } from "../../src/contract/phone.js";
import type { WorldView } from "../../src/contract/world.js";
import { MemoryHub } from "../../src/devices/hub/memory.js";
import { managerRoutes } from "../../src/manage/node.js";
import { historyRoutes } from "../../src/record/index.js";
import { settle } from "../../src/record/replay.js";
import { assistanceResident, HomeAssistance } from "../../src/server/home/assistance.js";
import type { HomeCore } from "../../src/server/home/core.js";
import { applyPhoneProgress } from "../../src/server/home/phone.js";
import { Trigger, WorldState } from "../../src/world/index.js";
import { localTime } from "../fixtures/assistance/learning.js";
import { LOOK_VIEW } from "./camera.js";
import { smallFloor } from "./floor.js";
import { pamClientFor, pamView } from "./pam.js";
import { planContext } from "./planner.js";

export interface Evening {
  date: string;
  captured: string;
  arrived: string;
  activity: string;
  people: number;
  resident: string;
  reply?: string;
  speech?: string;
}

const home = "learning-home";
const action = "에어컨 켜기";
const device: DeviceSpec = {
  id: "ac_living", label: "에어컨", room: "living", roomLabel: "거실", twinType: "aircon", kind: "aircon",
  capabilities: ["onoff", "climate"], matterDeviceType: "RoomAirConditionerDevice", sensors: [], twinAttrs: { power: ["off", "on"] },
};
const tasks = tasksFor("noonchi");

/** Keeps the provider wire shape and rejects every request outside of the fixture. */
function fixturePam() {
  const base = "http://learning.invalid/v1";
  return pamClientFor({ url: base }, { fetchImpl: async (input, init) => {
    const req = new Request(input, init);
    if (req.url !== base + "/chat/completions" || req.method !== "POST") throw new Error("Offline fixture attempted network traffic");
    const view = pamView(await req.json());
    const output = view.role === "predict" ? {
        observation: "거주자가 TV를 보고 있어요", reasoning: "지금 행동을 골라요", state: "watching_tv",
        from: view.last_state === "watching_tv" ? "watching_tv" : "away", next_index: 1,
      } : view.role === "reflect" ? candidateFsmOf(CUP_FSM_MEMORY)
        : view.role === "check" ? { ok: true, items: [] }
          : view.role === "chunk" ? { chunks: [] } : { candidates: [], actions: [], unseen: [] };
    return Response.json({ model: "fixture", choices: [{ message: { content: JSON.stringify(output) }, finish_reason: "stop" }] });
  } });
}

export async function replayLearning(evenings: readonly Evening[], record = true, direct?: string) {
  const folder = mkdtempSync(join(tmpdir(), "learning-replay-"));
  const db = HistoryDb.open(join(folder, "history.db"));
  const clock = new VirtualClock(localTime(evenings[0]!.date, "18:19:00"));
  const bus = new MemoryBus({ clock });
  const subscribe = bus.subscribe.bind(bus);
  bus.subscribe = (topic, group, deliver, options) => {
    if (!record && topic === "/act/assistance_outcome" && group === "recorder") {
      return Promise.resolve({ start() {}, async stop() {}, lost: () => 0 });
    }
    return subscribe(topic, group, deliver, options);
  };
  const pam = fixturePam();
  const decisions: { date: string; decision: DecisionRecord }[] = [];
  const commands: { date: string; command: PlannedCommand }[] = [];
  const emitted: AssistanceOutcome[] = [];
  const trace: unknown[] = [];
  let nightly: ReturnType<typeof runReflection> | undefined;
  const night = new NightReflection({ bus, clock, boot: "learning", at: "23:30", offsetMinutes: db.offsetMinutes,
    run: (day, signal) => nightly = runReflection(db, pam, day, { signal, now: () => clock.now() }),
  });
  await night.start();
  try {
    for (const fixture of evenings) {
      await clock.advanceTo(localTime(fixture.date, fixture.arrived), async () => { if (nightly) await nightly; });
      const now = () => clock.now();
      const recordedAt = localTime(fixture.date, fixture.captured);
      const world: WorldView = new WorldState({ surfaces: () => [], floorAt: () => 0, roomAt: () => null, devices: () => [] }).view(now());
      const photoId = "photo-" + fixture.date;
      world.person = { ...world.person, visible: true, count: fixture.people, room: "living", position: [1, 1],
        position_ms: recordedAt, facts: { activity: { value: fixture.activity, at_ms: recordedAt, since_ms: recordedAt, certainty: "confirmed" } } };
      world.household_photo = { id: photoId, at_ms: recordedAt, answered_ms: now(), serial: 1, proof: {
        camera: LOOK_VIEW, seats: "clear", person_count: fixture.people, dining_food: "unknown",
        person: { position: [1, 1], room: "living", seated: true, attention: "toward_tv" },
      } };
      const epoch = { boot: "learning", home: home + "#" + fixture.date };
      const node = (name: NodeName) => new BusNode({ bus, clock, epoch, name, log: line => trace.push(line) });
      const act = node("act"), phone = node("phone"), brain = node("brain"), manager = node("manager"), recorder = node("recorder");
      const nodes = [act, phone, brain, manager, recorder];
      managerRoutes(manager, clock);
      const out = new Outbox(act, { clock, log: () => {} });
      const brainOut = new Outbox(brain, { clock, log: () => {} });
      historyRoutes(recorder, db, { now, machinesOnly: true });
      const resident = (view: WorldView) => assistanceResident(view, fixture.resident, now(), 10_000);
      const interventionFor = (d: DecisionRecord, view: WorldView) => d.source === "speech" || !d.action ? "default"
        : db.policyFor(home, resident(view), { action: d.action, context: assistanceContext(d, view) }, db.dayOf(now()));
      const bridge = new HomeAssistance({ home, epoch, world: () => world, resident, now,
        publish: outcome => { emitted.push(outcome); publishAssistanceOutcome(out, outcome); } });
      const plans = new PlanHub(smallFloor(), m => { if (m.type === "plan" && m.plan) bridge.onPlan(m.plan); });
      const hub = new MemoryHub([device], { ac_living: { power: "off" } });
      const events = { emit: (event: unknown) => { trace.push(event); } };
      bindAssistanceAnswers(events, answer => bridge.answer(answer));
      const tracker = new ExecutionTracker({
        plans, clock, approvals: memoryApprovals(), askFirst: true, planGapMs: 0,
        assistance: { boot: epoch.boot, homeEpoch: epoch.home },
        state: { view: () => world }, layout: { floor: () => plans.floor() },
        phone: { toPhone: cmd => emitRobotCommand(out, cmd) },
        brain: {}, observe: {}, goals: {}, events, appliances: { run: deviceRunner(hub, new Policy()) },
        manager: { offerSpeech: decision => {
          out.push("/manager/request", { kind: "speech", input: { decision, rev: 1, assist: "noonchi", at_ms: now(),
            check: checkDecision({ decision, tasks, world }) } });
        } },
        check: (d, plan) => checkPlan({ decision: d, tasks, plan, world, nowMs: now(), staleMs: 10_000, mode: "test" }),
        planner: d => new PlanDraft(planContext({ decision: d, world, floor: plans.floor(), hub })).submit({ steps: [{
          kind: "device", label: "에어컨 켜기", target: device.id, tool: "turn_on", timeout_s: 60,
        }] }),
      });
      const core = { tracker, closed: false, keepHeard: false, followupFeedback: new Map(), out: { act: out }, nowMs: now } as unknown as HomeCore;
      progressRoutes(act, p => applyPhoneProgress(core, p), now);
      act.on("/manager/order", ({ input, gate, resumed }) => {
        if (gate === "take") bridge.admit(input.decision);
        tracker.onOrder(input.decision, gate, resumed, input.check);
      });
      phone.on("/act/phone_changes", msg => {
        if (!("cmd" in msg) || msg.cmd.type !== "command") return;
        commands.push({ date: fixture.date, command: msg.cmd });
      });
      const decider = new Decider({
        node: () => brain, pam, world: { view: () => world },
        trigger: new Trigger({ mode: "event", periodMs: 1000, minGapMs: 0, idleStopMs: 1e9, liveMs: 10_000, maxInflight: 1 }, now()),
        tasks: () => tasks, memory: () => memoryForDay(db, fixture.date), emit: () => {}, clock, offsetMinutes: db.offsetMinutes, interventionFor,
        onDecision: d => {
          decisions.push({ date: fixture.date, decision: d });
          brainOut.push("/brain/decision", { decision: d, rev: 1, check: d.action ? checkDecision({ decision: d, tasks, world }) : { ok: true },
            assist: "noonchi", at_ms: now() });
        },
      });
      const barrier = async () => { await settle(bus, nodes); await tracker.idle(); await settle(bus, nodes); };
      for (const n of nodes) { await n.prepare(); n.start(); }
      try {
        for (let i = 0; i < 2; i++) {
          decider.onChanges([{ kind: "heard", at_ms: now(), subject: "person",
            text: i === 1 && fixture.speech ? `사람이 말함: 「${fixture.speech}」` : "거주자가 TV를 보고 있다.", meaningful: true }]);
          decider.tick();
          await decider.idle();
          await barrier();
        }
        const shown = commands.filter(c => c.date === fixture.date).at(-1)?.command;
        if (shown?.choices?.some(c => c.id === fixture.reply) && fixture.reply) {
          await phone.publish("/phone/progress", { kind: "button", req: "response-" + fixture.date,
            plan_id: shown.id, step: shown.step, choice: fixture.reply, expires_ms: now() + 1000 });
          await barrier();
        }
        if (direct && fixture === evenings.at(-1)) {
          tracker.onRequest({ task: action, heard: direct, atMs: now(), afterSeq: decider.sentSeq() });
          await barrier();
        }
      } finally {
        tracker.stop();
        decider.stop();
        for (const n of nodes) await n.stop();
        await hub.stop();
      }
    }
    return { decisions, commands, emitted, trace, rows: db.list({ kinds: ["assistance_outcome"] }),
      policy: db.policyFor(home, evenings.at(-1)!.resident, { action, context: '["state","watching_tv"]' }, evenings.at(-1)!.date) };
  } finally {
    await night.close();
    await bus.close();
    db.close();
    rmSync(folder, { force: true, recursive: true });
  }
}
