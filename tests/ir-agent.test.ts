// tests/ir-agent.test.ts
// 등록한 리모컨을 에이전트에 보인다: SignalHub.press·리모컨 켜기·끄기, press_remote 도구·기기 목록, 계획 단계(실행 추적)와 계획 입력 글.
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, expect, it } from "vitest";
import type { RemoteEvent, RemoteRole } from "../src/contract/ir.js";
import type { DecisionRecord } from "../src/contract/events.js";
import type { PlannedCommandMessage } from "../src/contract/phone.js";
import type { WorldView } from "../src/contract/world.js";
import type { RemoteRuntime } from "../src/devices/hub/ir-remotes.js";
import { MemoryHub } from "../src/devices/hub/memory.js";
import { SignalHub, type SignalSource } from "../src/devices/hub/signals.js";
import { describeDevice } from "../src/devices/mapping.js";
import { deviceRunner } from "../src/act/devices.js";
import { PlanHub } from "../src/act/hub.js";
import { ApprovalStore } from "../src/agent/approval.js";
import { AGENT_TOOLS, Agent, Policy, deviceViews, localBackend, runTool } from "../src/agent/index.js";
import type { LlmProvider } from "../src/agent/agent.js";
import { TASK_NAMES } from "../src/act/tasks.js";
import { pamTasks } from "../src/manage/index.js";
import { PLANNER_PROMPT, planInput } from "../src/agent/planInput.js";
import { smallFloor } from "./helpers/floor.js";
import { planCalls, planContext, startFakePlanner, testPlanner, type FakePlanner } from "./helpers/planner.js";
import { testTracker } from "./helpers/tracker-ports.js";

const power = { power: ["on", "off"] };
const tv = { id: "tv_1", label: "TV", room: "living", roomLabel: "거실", twinType: "tv", twinAttrs: power, ...describeDevice("tv", power)! };
const ac = { id: "ac_1", label: "에어컨", room: "living", roomLabel: "거실", twinType: "stand_ac", twinAttrs: power, ...describeDevice("stand_ac", power)! };
const hubs: SignalHub[] = [];
afterEach(async () => { for (const h of hubs.splice(0)) await h.stop(); });

function setup(live: boolean, sources: Record<string, SignalSource> = {}) {
  const sent: string[] = [];
  const pressed = new Set<(e: { device: string; remote: string; button: string; role: RemoteRole }) => void>();
  const rt: RemoteRuntime = {
    list: () => [
      { device: "tv_1", remote: "r_0000000a", label: "거실 TV 리모컨", buttons: [{ id: "b_00000008", label: "전원", role: "toggle" }, { id: "b_00000002", label: "음량 올림", role: null }] },
      { device: "ac_1", remote: "r_0000000b", label: "에어컨 리모컨", buttons: [{ id: "b_000000a1", label: "냉방 켜기", role: "on" }] },
    ],
    send: async (device, button) => { await new Promise((r) => setTimeout(r, 5)); sent.push(`${device}/${button}`); },
    onPressed: (cb) => { pressed.add(cb); return () => { pressed.delete(cb); }; },
  };
  const hub = new SignalHub(new MemoryHub([tv, ac], { tv_1: { power: "on" }, ac_1: { power: "off" } }), sources);
  hubs.push(hub);
  const events: RemoteEvent[] = [];
  hub.onRemote = (e) => events.push(e);
  hub.setRemotes(rt, live);
  return { hub, sent, events, pressMan: (button: string) => { for (const cb of pressed) cb({ device: "tv_1", remote: "r_0000000a", button, role: null }); } };
}

it("실제 모드에서만 단추 신호를 쏘고, 시험 모드는 쏘지 않았다고 답한다", async () => {
  const test = setup(false);
  expect(await test.hub.press("tv_1", "음량 올림")).toEqual({ ok: true, sent: false });
  expect(test.sent).toEqual([]);
  const live = setup(true);
  expect(await live.hub.press("tv_1", "음량 올림", "cmd-1")).toEqual({ ok: true, sent: true });
  expect(live.sent).toEqual(["tv_1/b_00000002"]);
  expect(live.events).toEqual([expect.objectContaining({ kind: "sent", device: "tv_1", button: "b_00000002", command_id: "cmd-1" })]);
  expect(await live.hub.press("tv_1", "채널 올림")).toEqual({ ok: false, error: "리모컨에 「채널 올림」 단추가 없어요. 있는 단추: 전원, 음량 올림" });
  expect(await live.hub.press("ac_9", "x")).toEqual({ ok: false, error: "이 가전에 등록한 리모컨이 없어요." });
});

it("TV가 아닌 가전은 실제 모드에서 켜기 뜻 단추로 켜고, 트윈도 따라 켜지고, 확인 못 함으로 답한다", async () => {
  const live = setup(true);
  expect(await live.hub.command("ac_1", { type: "on" }, "cmd-2")).toMatchObject({ ok: true, outcome: "unverified" });
  expect(live.sent).toEqual(["ac_1/b_000000a1"]);
  expect(live.hub.get("ac_1")!.twin.power).toBe("on");
  const test = setup(false);
  await test.hub.command("ac_1", { type: "on" });
  expect(test.sent).toEqual([]);
});

it("ThinQ와 짝지은 가전은 리모컨이 있어도 ThinQ 길로 보낸다", async () => {
  const paired = setup(true, { ac_1: { kind: "thinq", deviceId: "thinq-ac" } });
  expect(await paired.hub.command("ac_1", { type: "on" }, "cmd-4")).toMatchObject({ ok: false, error: "ThinQ 연결이 없어 보내지 않았어요." });
  expect(paired.sent).toEqual([]);
});

it("사람이 누른 등록 단추를 알린다", () => {
  const live = setup(true);
  live.pressMan("b_00000002");
  expect(live.events).toEqual([expect.objectContaining({ kind: "pressed", device: "tv_1", button: "b_00000002", command_id: null })]);
});

it("에이전트 도구와 기기 목록에 단추가 보이고, 계획 단계는 끝난 계획이면 쏘지 않는다", async () => {
  const live = setup(true);
  const policy = new Policy();
  expect(deviceViews(live.hub).find((d) => d.id === "tv_1")?.remote).toEqual({ label: "거실 TV 리모컨", buttons: ["전원", "음량 올림"] });
  const listed = await runTool("list_devices", {}, localBackend(live.hub, policy), AGENT_TOOLS);
  expect((listed.data as { id: string; remote_buttons?: string[] }[]).find((d) => d.id === "tv_1")?.remote_buttons).toEqual(["전원", "음량 올림"]);
  const r = await runTool("press_remote", { device_id: "tv_1", button: "음량 올림" }, localBackend(live.hub, policy), AGENT_TOOLS);
  expect(r).toMatchObject({ ok: true, unverified: true });
  const runner = deviceRunner(live.hub, policy);
  const skipped = await runner.run("press_remote", "tv_1", { button: "음량 올림" }, () => false, "cmd-3");
  expect(skipped.ok).toBe(false);
  expect(live.sent).toEqual(["tv_1/b_00000002"]);
});

// ── 계획 입력 글과 실행 추적의 계획 단계 ─────────────────────────────

let llm: FakePlanner;
beforeAll(async () => { llm = await startFakePlanner({}); });
afterAll(async () => { await llm?.close(); });

const AC_TASK = "에어컨 켜기";
const decision: DecisionRecord = {
  id: "pam-1", seq: 1, atMs: 8_000, textSent: "t", finalTime: "x", status: "valid", prediction: { observation: "o", reasoning: "r", task_index: 0 }, action: AC_TASK, memoryVersion: 1,
  world: { objects: [], person_visible: false, vlm_missing: 0, yolo_missing: 0 },
};
/** 트윈 에어컨 전원을 World State 가전 줄로 보인다(계획 단계 until이 본다). */
const worldOf = (hub: SignalHub): WorldView => {
  const p = String(hub.get("ac_1")!.twin.power);
  return {
    at_ms: 0, objects: [], fixtures: [], eye: null, frame_ms: null, vlm_missing: 0, yolo_missing: 0,
    person: { visible: false, since_ms: 0, last_seen_ms: null, count: 0, room: null, room_label: null, position: null, near: [], holding: [], position_ms: null, answered_ms: null, facts: {} },
    devices: [{ id: "ac_1", kind: "aircon", label: "에어컨", status: p, state: [p] as WorldView["devices"][number]["state"], active: false, changed_ms: 0, event_ms: null, started_ms: null, remaining_min: null, history: [] }],
  };
};

const REMOTE_TASK = "리모컨 단추 누르기";
const spoken: DecisionRecord = { ...decision, id: "say-1", seq: 0, textSent: "사람이 말함: 「TV 소리 키워 줘」", action: REMOTE_TASK, source: "speech", prediction: { observation: "o", reasoning: "r", task_index: -1 } };

it("리모컨 단추 줄은 이 집 가전에 리모컨이 있을 때만, press_remote 줄과 들은 말은 리모컨 단추 누르기 계획에만 붙고, 고정 시스템 프롬프트는 바뀌지 않는다", () => {
  const world = worldOf(setup(false).hub);
  const remoteInput = planInput(planContext({ decision: spoken, world, floor: smallFloor(), hub: setup(true).hub }));
  expect(remoteInput).toContain("press_remote는 args");
  expect(remoteInput).toContain("[들은 말] TV 소리 키워 줘");
  expect(remoteInput).toContain("리모컨 단추 전원, 음량 올림");
  const acInput = planInput(planContext({ decision, world, floor: smallFloor(), hub: setup(true).hub }));
  expect(acInput).toContain("리모컨 단추 전원, 음량 올림");
  expect(acInput).not.toContain("press_remote");
  expect(acInput).not.toContain("[들은 말]");
  const plain = new SignalHub(new MemoryHub([tv, ac]));
  hubs.push(plain);
  const without = planInput(planContext({ decision, world, floor: smallFloor(), hub: plain }));
  expect(without).not.toContain("press_remote");
  expect(without).not.toContain("리모컨");
  expect(PLANNER_PROMPT).not.toContain("press_remote");
});

/** 정해 둔 도구 호출을 내는 말 요청 모델: 첫 차례에 request_task(리모컨 단추 누르기), 다음 차례에 짧은 답. 받은 도구 이름을 남긴다. */
async function askAgent(hub: SignalHub) {
  const tools: string[][] = [];
  const requested: string[][] = [];
  const provider: LlmProvider = {
    name: "scripted", createState: () => ({ round: 0 }), addUserMessage: () => {}, addToolResults: () => {},
    step: async (state, opts) => {
      tools.push(opts.tools.map((t) => t.name));
      const s = state as { round: number };
      return s.round++ === 0 ? { text: "", calls: [{ id: "c1", name: "request_task", args: { task: REMOTE_TASK, reason: "TV 소리를 키워 달라고 해서" } }] } : { text: "네.", calls: [] };
    },
  };
  const agent = new Agent({ hub, policy: new Policy(), provider, onRequest: (task, heard) => { requested.push([task, heard]); return { ok: true, message: "받았어요" }; } });
  const r = await agent.chat("s1", "TV 소리 키워 줘");
  return { tools: tools[0]!, requested, action: r.actions[0] };
}

it("리모컨 단추 누르기는 말 부탁으로만 받는다: PAM 목록에 없고, 말 요청 에이전트는 press_remote 없이 이 할 일로 넘기며, 리모컨이 없는 집은 받지 않는다", async () => {
  expect(TASK_NAMES).not.toContain(REMOTE_TASK);
  expect([...pamTasks("noonchi", true), ...pamTasks("coach", true)]).not.toContain(REMOTE_TASK);
  const withRemote = await askAgent(setup(true).hub);
  expect(withRemote.tools).toContain("request_task");
  expect(withRemote.tools).not.toContain("press_remote");
  expect(withRemote.requested).toEqual([[REMOTE_TASK, "TV 소리 키워 줘"]]);
  const plain = new SignalHub(new MemoryHub([tv, ac]));
  hubs.push(plain);
  const without = await askAgent(plain);
  expect(without.requested).toEqual([]);
  expect(without.action).toMatchObject({ tool: "request_task", ok: false, error: "이 집에 등록한 리모컨이 없어요." });
});

/** 에어컨 켜기 계획을 실제 기기 단계로 돌린다. change로 첫 단계(가전)를 바꿀 수 있다. */
async function runPlan(hub: SignalHub, change?: (step: any) => any) {
  const phone: PlannedCommandMessage[] = [];
  const clock = { t: 10_000, now() { return this.t; } };
  const plans = new PlanHub(smallFloor(), () => {}, () => "t");
  const approvals = new ApprovalStore(join(mkdtempSync(join(tmpdir(), "ir-agent-")), "homes", "h", "approvals.json"), () => "t");
  approvals.answer(`task:${AC_TASK}`, "approve");
  llm.scripts[AC_TASK] = () => [planCalls([
    { kind: "device", label: "거실 에어컨 켜기", target: "ac_1", tool: "turn_on", until: { device: "ac_1", state: "on" }, timeout_s: 60 },
    { kind: "say", notice: "끝", timeout_s: 10 },
  ])];
  const planner = testPlanner(llm);
  const t = testTracker({
    plans, world: () => worldOf(hub), check: () => ({ ok: true }), floor: () => plans.floor(), planGapMs: 0, clock, approvals,
    planner: async (d, signal) => {
      const r = await planner.plan(planContext({ decision: d, world: worldOf(hub), floor: plans.floor(), hub }), signal);
      if (r.ok && change) r.plan.steps[0] = change(r.plan.steps[0]!);
      return r;
    },
    toPhone: (m) => phone.push(m), emit: () => {}, locate: () => undefined,
    devices: deviceRunner(hub, new Policy()), handDevices: () => [{ id: "ac_1", kind: "aircon", label: "에어컨" }],
  });
  t.onDecision(decision);
  await t.idle();
  for (let i = 0; i < 6 && plans.current()?.status !== "done"; i++) {
    await new Promise((r) => setTimeout(r, 20));
    clock.t += 5_000;
    t.onWorld();
    t.tick();
  }
  return plans.current();
}

it("실제 모드 계획의 에어컨 켜기 단계(until 켜짐)는 리모컨 켜기 단추를 쏘고 트윈이 켜져 끝나며, 그 계획 요청의 도구 모양에는 press_remote가 없다", async () => {
  const live = setup(true);
  const before = llm.bodies().length;
  expect(await runPlan(live.hub)).toMatchObject({ status: "done" });
  const tools = llm.bodies().slice(before).map((b) => JSON.stringify(b.tools));
  expect(tools.length).toBeGreaterThan(0);
  expect(tools.join("")).toContain("turn_on");
  expect(tools.join("")).not.toContain("press_remote");
  expect(live.sent).toEqual(["ac_1/b_000000a1"]);
});

/** 「TV 소리 키워 줘」 말 부탁을 실행 추적에 넣는다. 계획 모델은 먼저 없는 단추(채널 올림)를 내고, 검사 오류를 받으면 음량 올림으로 고친다. */
async function runRemoteRequest(hub: SignalHub) {
  const clock = { t: 10_000, now() { return this.t; } };
  const plans = new PlanHub(smallFloor(), () => {}, () => "t");
  const approvals = new ApprovalStore(join(mkdtempSync(join(tmpdir(), "ir-agent-")), "homes", "h", "approvals.json"), () => "t");
  approvals.answer(`task:${REMOTE_TASK}`, "approve");
  const press = (button: string) => [{ kind: "device", label: "TV 음량 올림", target: "tv_1", tool: "press_remote", args: { button }, timeout_s: 60 }];
  llm.scripts[REMOTE_TASK] = () => [planCalls(press("채널 올림")), planCalls(press("음량 올림"))];
  const before = llm.bodies().length;
  const planner = testPlanner(llm);
  const spokenDecisions: DecisionRecord[] = [];
  const t = testTracker({
    onSpeech: (d) => spokenDecisions.push(d),
    plans, world: () => worldOf(hub), check: () => ({ ok: true }), floor: () => plans.floor(), planGapMs: 0, clock, approvals,
    planner: (d, signal) => planner.plan(planContext({ decision: d, world: worldOf(hub), floor: plans.floor(), hub }), signal),
    toPhone: () => {}, emit: () => {}, locate: () => undefined,
    devices: deviceRunner(hub, new Policy()), handDevices: () => [{ id: "ac_1", kind: "aircon", label: "에어컨" }],
  });
  t.onRequest({ task: REMOTE_TASK, heard: "TV 소리 키워 줘", atMs: clock.t, afterSeq: 0 });
  await t.idle();
  for (let i = 0; i < 6 && plans.current()?.status !== "done"; i++) {
    await new Promise((r) => setTimeout(r, 20));
    clock.t += 5_000;
    t.onWorld();
    t.tick();
  }
  const sent = llm.bodies().slice(before);
  return { plan: plans.current(), bodies: sent.map((b) => JSON.stringify(b)), tools: sent.map((b) => JSON.stringify(b.tools)), spoken: spokenDecisions };
}

it("「TV 소리 키워 줘」 말 부탁은 리모컨 단추 누르기 계획이 되고, 없는 단추는 계획 검사가 돌려보내며, 실제 모드에서만 음량 올림 신호를 보내고 끝난다", async () => {
  const live = setup(true);
  const r = await runRemoteRequest(live.hub);
  expect(r.plan).toMatchObject({ status: "done", steps: [{ kind: "device", label: "TV 음량 올림" }] });
  expect(live.sent).toEqual(["tv_1/b_00000002"]);
  expect(r.bodies).toHaveLength(2);
  expect(r.bodies[0]).toContain("[들은 말] TV 소리 키워 줘");
  expect(r.bodies[1]).toContain("리모컨에 「채널 올림」 단추가 없습니다. 있는 단추: 전원, 음량 올림");
  expect(r.tools[0]).toContain("press_remote");
  // 판단 기록의 행동 번호는 그 판단의 목록(행동 목록 뒤에 붙인 말 부탁 할 일)을 가리킨다
  const said = r.spoken[0]!;
  expect([said.source, said.action, said.tasks?.[said.prediction!.task_index]]).toEqual(["speech", REMOTE_TASK, REMOTE_TASK]);
  const test = setup(false);
  expect((await runRemoteRequest(test.hub)).plan).toMatchObject({ status: "done" });
  expect(test.sent).toEqual([]);
});

it("실제 모드 계획의 press_remote 단계(until 없음)는 신호를 보내면 끝난다", async () => {
  const live = setup(true);
  const plan = await runPlan(live.hub, (step) => ({ ...step, label: "TV 음량 올림", until: null, device: { tool: "press_remote", deviceId: "tv_1", args: { button: "음량 올림" } } }));
  expect(plan).toMatchObject({ status: "done" });
  expect(live.sent).toEqual(["tv_1/b_00000002"]);
});
