import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { createServer, type IncomingMessage } from "node:http";
import { listenRetry } from "../src/shared/net.js";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Agent, type AgentEvent, type LlmProvider, type StepOptions, type StepResult, type ToolCallResult } from "../src/agent/agent.js";
import { ApprovalStore } from "../src/agent/approval.js";
import { Policy } from "../src/agent/policy.js";
import { buildSystemPrompt } from "../src/agent/prompts.js";
import { AnthropicProvider } from "../src/agent/providers/anthropic.js";
import { agentEndpoint, createProvider, resolveProviderName } from "../src/agent/providers/index.js";
import { OpenAIProvider } from "../src/agent/providers/openai.js";
import { findDevices } from "../src/agent/search.js";
import { AGENT_TOOLS, LEAVE_IT, MCP_TOOLS, TOOLS, localBackend, runTool, toolJsonSchema } from "../src/agent/tools.js";
import { MemoryHub } from "../src/devices/hub/memory.js";
import { loadTwin, resolveTwinStudioDir } from "../src/layout/twin-files.js";
import { ROOMS, homeDevices, makeHome, twin } from "./helpers/home.js";
import { startFakePamLlm, pamClientFor } from "./helpers/pam.js";
import { CUP_FSM_MEMORY, CUP_TASKS } from "../src/brain/decision.js";
import { Decider } from "../src/brain/decide.js";
import { WorldState } from "../src/world/state/world.js";
import { Trigger } from "../src/world/trigger.js";
import { HOME_SCRIPT, startFakeLlm, toolOutputs, type FakeLlm } from "./helpers/llm.js";

const ids = (r: { devices: { id: string }[] }) => r.devices.map((d) => d.id).sort();

describe("findDevices: 한국어 이름·방으로 찾기", () => {
  const devices = homeDevices();
  const find = (q: string) => findDevices(q, devices, ROOMS);

  it("방 + 종류 동의어", () => {
    expect(ids(find("거실 불"))).toEqual(["lamp_living", "light_living"]);
    expect(find("거실 불").rooms).toEqual(["living_room"]);
    expect(ids(find("안방 에어컨"))).toEqual(["ac_master"]);
  });

  it("이름 부분 일치와 조사", () => {
    expect(ids(find("거실 TV"))).toEqual(["tv_living"]);
    expect(ids(find("TV를"))).toEqual(["tv_living"]);
    expect(ids(find("티비"))).toEqual(["tv_living"]);
    expect(ids(find("현관문"))).toEqual(["door_main"]);
    expect(ids(find("안방 커튼"))).toEqual(["curtain_master"]);
    expect(ids(find("에어컨"))).toEqual(["ac_bed2", "ac_living", "ac_master"]);
  });

  it("긴 방 이름을 먼저 본다(안방 욕실 ≠ 안방)", () => {
    expect(find("안방 욕실 등").rooms).toEqual(["bathroom_master"]);
    expect(ids(find("안방 욕실 등"))).toEqual(["light_ensuite"]);
    expect(ids(find("화장실 불"))).toEqual(["light_bath"]);
  });

  it("괄호가 있는 이름과 방 밖에 있는 문", () => {
    expect(ids(find("다용도실 문"))).toEqual(["door_balcony"]);
  });

  it("방만 말하면 그 방 기기 전체, 모르는 말은 빈 결과", () => {
    expect(find("거실").devices.every((d) => d.room === "living_room")).toBe(true);
    expect(find("거실").devices.length).toBeGreaterThan(5);
    expect(find("우주선").devices).toEqual([]);
  });
});

describe("tools: 에이전트·MCP 공용 도구", () => {
  it("계획서의 도구가 모두 있고 설명은 한국어, 스키마는 object", () => {
    const names = TOOLS.map((t) => t.name);
    for (const n of ["list_rooms", "list_devices", "find_devices", "get_state", "turn_on", "turn_off", "set_level", "set_climate", "set_covering", "lock", "unlock", "start", "stop", "set_valve"]) {
      expect(names).toContain(n);
    }
    for (const t of TOOLS) {
      expect(t.description).toMatch(/[가-힣]/);
      const schema = toolJsonSchema(t);
      expect(schema.type).toBe("object");
      expect(schema).not.toHaveProperty("$schema");
    }
    // 승인 확정 도구는 MCP에만(서버 안 LLM이 스스로 승인하지 못하게)
    expect(AGENT_TOOLS.map((t) => t.name)).not.toContain("confirm_action");
    expect(MCP_TOOLS.map((t) => t.name)).toContain("confirm_action");
    // 넘기기 도구는 서버 안 에이전트 전용이다(MCP 목록에 내지 않는다)
    expect(LEAVE_IT).toBe("leave_it");
    expect(AGENT_TOOLS.map((t) => t.name)).toContain("leave_it");
    expect(MCP_TOOLS.map((t) => t.name)).not.toContain("leave_it");
    expect(TOOLS.find((t) => t.name === "leave_it")).toMatchObject({ title: "넘기기", readOnly: true });
  });

  it("turn_on은 상태를 바꾸고 결과에 상태를 담는다", async () => {
    const { hub, policy } = makeHome();
    const r = await runTool("turn_on", { device_id: "tv_living" }, localBackend(hub, policy, ROOMS));
    expect(r.ok).toBe(true);
    expect(r.device).toEqual({ id: "tv_living", label: "거실 TV" });
    expect(twin(hub, "tv_living").power).toBe("on");
  });

  it("set_climate·set_covering·set_level·set_valve 인자 변환", async () => {
    const { hub, policy } = makeHome();
    const b = localBackend(hub, policy, ROOMS);
    expect((await runTool("set_climate", { device_id: "ac_living", setpoint_c: 24, mode: "cool" }, b)).ok).toBe(true);
    expect(hub.get("ac_living")!.matter).toMatchObject({ onOff: true, setpointC: 24, systemMode: "cool" });
    expect((await runTool("set_covering", { device_id: "curtain_master", open_percent: 0 }, b)).ok).toBe(true);
    expect(twin(hub, "curtain_master").curtain).toBe("closed");
    expect((await runTool("set_level", { device_id: "light_living", percent: 30 }, b)).ok).toBe(true);
    expect(hub.get("light_living")!.matter).toMatchObject({ onOff: true, level: 30 });
    expect((await runTool("set_valve", { device_id: "sink_1", open: true }, b)).ok).toBe(true);
    expect(twin(hub, "sink_1").faucet).toBe("on");
  });

  it("unlock은 승인 토큰을 돌려주고 실행하지 않는다", async () => {
    const { hub, policy } = makeHome();
    const b = localBackend(hub, policy, ROOMS);
    const r = await runTool("unlock", { device_id: "door_main" }, b);
    expect(r.ok).toBe(false);
    expect(r.needsConfirmation?.token).toBeTruthy();
    expect(r.needsConfirmation?.reason).toContain("승인");
    expect(twin(hub, "door_main").lock).toBe("locked");
    const c = await runTool("confirm_action", { token: r.needsConfirmation!.token }, b);
    expect(c.ok).toBe(true);
    expect(twin(hub, "door_main").lock).toBe("unlocked");
  });

  it("잘못된 기기·인자·도구는 한국어 오류", async () => {
    const { hub, policy } = makeHome();
    const b = localBackend(hub, policy, ROOMS);
    expect((await runTool("turn_on", { device_id: "nope" }, b)).error).toContain("기기를 찾을 수 없습니다");
    expect((await runTool("set_level", { device_id: "light_living", percent: "많이" }, b)).error).toMatch(/인자/);
    expect((await runTool("fly", {}, b)).error).toContain("알 수 없는 도구");
    expect((await runTool("turn_on", { device_id: "door_bed2" }, b)).error).toContain("센서");
  });

  it("기기 id 대신 정확한 한국어 이름도 받는다", async () => {
    const { hub, policy } = makeHome();
    const r = await runTool("turn_on", { device_id: "거실 TV" }, localBackend(hub, policy, ROOMS));
    expect(r.ok).toBe(true);
    expect(twin(hub, "tv_living").power).toBe("on");
  });

  it("list_rooms·list_devices·find_devices·get_state", async () => {
    const { hub, policy } = makeHome();
    const b = localBackend(hub, policy, ROOMS);
    const rooms = (await runTool("list_rooms", {}, b)).data as { id: string; label: string; deviceCount: number }[];
    expect(rooms.find((r) => r.id === "living_room")).toMatchObject({ label: "거실" });
    expect(rooms.find((r) => r.id === "living_room")!.deviceCount).toBeGreaterThan(5);
    const living = (await runTool("list_devices", { room: "거실", kind: "light" }, b)).data as { id: string }[];
    expect(living.map((d) => d.id).sort()).toEqual(["lamp_living", "light_living"]);
    const found = (await runTool("find_devices", { query: "안방 커튼" }, b)).data as { devices: { id: string; state: Record<string, unknown> }[] };
    expect(found.devices.map((d) => d.id)).toEqual(["curtain_master"]);
    expect(found.devices[0]!.state).toEqual({ curtain: "open" });
    const st = (await runTool("get_state", { device_id: "door_main" }, b)).data as { state: Record<string, unknown> };
    expect(st.state).toEqual({ door: "closed", lock: "locked" });
  });
});

// 스크립트대로 도구를 부르는 가짜 LLM
class ScriptedProvider implements LlmProvider {
  readonly name = "scripted";
  steps: StepOptions[] = [];
  results: ToolCallResult[][] = [];
  constructor(private readonly script: (round: number, opts: StepOptions) => StepResult) {}
  createState() {
    return { round: 0 };
  }
  addUserMessage(): void {}
  async step(state: unknown, opts: StepOptions): Promise<StepResult> {
    this.steps.push(opts);
    const s = state as { round: number };
    return this.script(s.round++, opts);
  }
  addToolResults(_state: unknown, results: ToolCallResult[]): void {
    this.results.push(results);
  }
}

describe("Agent: 도구 호출 루프", () => {
  it("도구 호출은 최대 6라운드, 마지막은 도구 없이 답한다", async () => {
    const { hub, policy } = makeHome();
    const p = new ScriptedProvider((round, opts) =>
      opts.allowTools ? { text: "", calls: [{ id: `c${round}`, name: "get_state", args: { device_id: "tv_living" } }] } : { text: "끝", calls: [] });
    const agent = new Agent({ hub, policy, rooms: ROOMS, provider: p });
    const r = await agent.chat("s1", "TV 상태 계속 봐줘");
    expect(p.steps).toHaveLength(7);
    expect(p.steps.slice(0, 6).every((s) => s.allowTools)).toBe(true);
    expect(p.steps[6]!.allowTools).toBe(false);
    expect(r.actions.filter((a) => a.tool === "get_state")).toHaveLength(6);
    expect(r.reply).toBe("끝");
  });

  it("승인 토큰은 LLM에게 숨기고 사용자(화면)에게만 준다", async () => {
    const { hub, policy } = makeHome();
    const p = new ScriptedProvider((round) =>
      round === 0 ? { text: "", calls: [{ id: "u1", name: "unlock", args: { device_id: "door_main" } }] } : { text: "현관문을 열까요?", calls: [] });
    const agent = new Agent({ hub, policy, rooms: ROOMS, provider: p });
    const r = await agent.chat("s1", "문 열어");
    const token = r.pendingConfirmations[0]!.token;
    expect(token).toBeTruthy();
    expect(r.pendingConfirmations[0]).toMatchObject({ deviceId: "door_main", deviceLabel: "현관문" });
    const seen = JSON.stringify(p.results);
    expect(seen).not.toContain(token);
    expect(seen).toContain("승인");
    expect(twin(hub, "door_main").lock).toBe("locked");
  });

  it("공급자 오류는 한국어 답으로 바꾼다", async () => {
    const { hub, policy } = makeHome();
    const p = new ScriptedProvider(() => {
      throw new Error("boom");
    });
    const agent = new Agent({ hub, policy, rooms: ROOMS, provider: p });
    const r = await agent.chat("s1", "불 켜줘");
    expect(r.reply).toContain("실패");
    expect(r.actions).toEqual([]);
  });
});

// 에이전트 + 실제 OpenAI 공급자 + 가짜 OpenAI 호환 서버(같은 주소 자리, OPENAI_BASE_URL)
let llm: FakeLlm;
beforeAll(async () => { llm = await startFakeLlm({ ...HOME_SCRIPT }); });
afterAll(async () => { await llm?.close(); });

function llmAgent(events?: AgentEvent[]) {
  const home = makeHome();
  const agent = new Agent({ hub: home.hub, policy: home.policy, rooms: ROOMS, provider: llm.provider(), onEvent: (e) => events?.push(e) });
  return { ...home, agent };
}
/** 이 시험이 보낸 요청만 보려고 지금까지 보낸 수를 적어 둔다. */
const sent = () => {
  const from = llm.bodies().length;
  return () => llm.bodies().slice(from);
};

describe("Agent + OpenAI 공급자(가짜 서버): 한국어 요청", () => {
  it("거실 TV 켜줘 → 모델의 turn_on(tv_living) → 켜짐, 결과를 모델에 돌려주고 모델 답을 낸다", async () => {
    const { hub, agent } = llmAgent();
    const bodies = sent();
    const r = await agent.chat("s", "거실 TV 켜줘");
    expect(r.provider).toBe("openai");
    expect(r.actions).toEqual([expect.objectContaining({ tool: "turn_on", args: { device_id: "tv_living" }, ok: true, reason: "거실 TV를 켜 달라고 해서" })]);
    expect(twin(hub, "tv_living").power).toBe("on");
    expect(r.reply).toBe("거실 TV를 켰어요.");
    const [first, second] = bodies();
    expect(first).toMatchObject({ model: "gpt-5.5", tool_choice: "auto", input: [{ role: "user", content: "거실 TV 켜줘" }] });
    expect(toolOutputs(second)).toEqual([expect.objectContaining({ ok: true, device: { id: "tv_living", label: "거실 TV" } })]);
  });

  it("거실 불 켜고 TV 꺼줘 → 찾기 뒤 한 차례에 세 도구 → 두 조명 켜짐, TV 꺼짐", async () => {
    const { hub, agent } = llmAgent();
    await hub.command("tv_living", { type: "on" });
    const r = await agent.chat("s", "거실 불 켜고 TV 꺼줘");
    expect(r.actions.map((a) => a.tool)).toEqual(["find_devices", "turn_on", "turn_on", "turn_off"]);
    expect(twin(hub, "light_living").power).toBe("on");
    expect(twin(hub, "lamp_living").power).toBe("on");
    expect(twin(hub, "tv_living").power).toBe("off");
  });

  it("현관문 열어줘 → 승인 요청 → '응' → 잠금 해제(모델을 다시 부르지 않음)", async () => {
    const { hub, agent } = llmAgent();
    const bodies = sent();
    const r1 = await agent.chat("s", "현관문 열어줘");
    expect(r1.pendingConfirmations).toHaveLength(1);
    expect(r1.pendingConfirmations[0]).toMatchObject({ deviceId: "door_main", command: { type: "unlock" } });
    expect(r1.reply).toContain("승인");
    expect(twin(hub, "door_main").lock).toBe("locked");
    // 모델은 토큰 없이 승인 대기만 본다
    expect(toolOutputs(bodies()[1])[0]).toMatchObject({ ok: false, pendingApproval: { reason: expect.stringContaining("승인") } });
    expect(JSON.stringify(bodies())).not.toContain(r1.pendingConfirmations[0]!.token);
    const asked = bodies().length;
    const r2 = await agent.chat("s", "응");
    expect(bodies()).toHaveLength(asked);
    expect(twin(hub, "door_main").lock).toBe("unlocked");
    expect(r2.pendingConfirmations).toEqual([]);
    expect(r2.actions[0]).toMatchObject({ tool: "unlock", ok: true });
    expect(r2.reply).toContain("현관문");
  });

  it("늘 듣는 실제 폰의 말(heard)은 '응'·'네'·'어'로 승인하지 않고 모델에게 보낸다. 들은 말로는 분명한 '승인해 줘'도 확정하지 않고, 그 승인 대기 token 하나에 답할 때(answerToken)만 확정한다", async () => {
    const { hub, policy, agent } = llmAgent();
    await agent.chat("s", "현관문 열어줘", { heard: true });
    for (const said of ["응", "네", "어", "예 진행해 줘"]) {
      expect((await agent.chat("s", said, { heard: true })).reply, said).toBe("가짜 답");
      expect(twin(hub, "door_main").lock).toBe("locked");
    }
    expect(policy.pending()).toHaveLength(1);
    await agent.chat("s", "승인해 줘", { heard: true });
    expect(twin(hub, "door_main").lock).toBe("locked");
    expect(policy.pending()).toHaveLength(1);
    const r = await agent.answerToken(policy.pending()[0]!.token, "approve");
    expect(r.ok).toBe(true);
    expect(twin(hub, "door_main").lock).toBe("unlocked");
  });

  it("승인 버튼(agent.confirm)으로도 확정하고, 확정한 일은 다음 요청의 대화에 남는다", async () => {
    const events: AgentEvent[] = [];
    const { hub, agent } = llmAgent(events);
    const bodies = sent();
    const r1 = await agent.chat("s", "현관문 열어줘");
    const c = await agent.confirm(r1.pendingConfirmations[0]!.token);
    expect(c.ok).toBe(true);
    expect(c.reply).toContain("현관문");
    expect(twin(hub, "door_main").lock).toBe("unlocked");
    expect(agent.pending("s")).toEqual([]);
    expect(events.some((e) => e.event === "confirmed")).toBe(true);
    // 같은 토큰은 다시 못 쓴다
    expect((await agent.confirm(r1.pendingConfirmations[0]!.token)).ok).toBe(false);
    await agent.chat("s", "고마워");
    expect(bodies().at(-1).input).toContainEqual({ role: "assistant", content: c.reply });
  });

  it("'아니'는 대기 중인 승인을 취소한다", async () => {
    const { hub, policy, agent } = llmAgent();
    await agent.chat("s", "현관문 열어줘");
    const r = await agent.chat("s", "아니 취소해");
    expect(r.reply).toContain("취소");
    expect(policy.pending()).toEqual([]);
    expect(twin(hub, "door_main").lock).toBe("locked");
  });

  it("다른 세션의 '응'은 남의 승인을 확정하지 않고 모델에게 간다", async () => {
    const { hub, agent } = llmAgent();
    await agent.chat("a", "현관문 열어줘");
    const r = await agent.chat("b", "응");
    expect(r.reply).toBe("가짜 답");
    expect(twin(hub, "door_main").lock).toBe("locked");
  });

  it("세션 대화를 기억한다: 다음 요청에 앞 요청·도구 호출·답을 함께 보낸다", async () => {
    const { agent } = llmAgent();
    const bodies = sent();
    await agent.chat("s", "거실 TV 켜줘");
    await agent.chat("s", "에어컨 24도로 맞춰줘");
    const input = bodies().find((b) => b.input.some((x: any) => x.content === "에어컨 24도로 맞춰줘")).input;
    expect(input[0]).toEqual({ role: "user", content: "거실 TV 켜줘" });
    expect(input).toContainEqual(expect.objectContaining({ type: "function_call", name: "turn_on" }));
    expect(input).toContainEqual(expect.objectContaining({ role: "assistant" }));
    // 다른 세션은 따로
    const other = sent();
    await agent.chat("t", "에어컨 24도로 맞춰줘");
    expect(other()[0].input).toEqual([{ role: "user", content: "에어컨 24도로 맞춰줘" }]);
  });

  it("모델이 고른 인자대로 실행한다: 에어컨 24도·커튼 닫기·밝기 30%·보일러·로봇청소기", async () => {
    llm.script["집안일 해줘"] = [[
      ["set_climate", { device_id: "ac_living", setpoint_c: 24 }], ["set_covering", { device_id: "curtain_master", open_percent: 0 }],
      ["set_level", { device_id: "light_living", percent: 30 }], ["turn_on", { device_id: "boiler_1" }], ["start", { device_id: "robot_vacuum_1" }],
    ], "다 했어요."];
    llm.script["청소기 멈춰"] = [[["stop", { device_id: "robot_vacuum_1" }]], "멈췄어요."];
    const { hub, agent } = llmAgent();
    const r = await agent.chat("s", "집안일 해줘");
    expect(r.actions.every((a) => a.ok)).toBe(true);
    expect(hub.get("ac_living")!.matter).toMatchObject({ onOff: true, setpointC: 24 });
    expect(twin(hub, "curtain_master").curtain).toBe("closed");
    expect(hub.get("light_living")!.matter).toMatchObject({ onOff: true, level: 30 });
    expect(twin(hub, "boiler_1").heating).toBe("on");
    expect(twin(hub, "robot_vacuum_1").running).toBe(true);
    await agent.chat("s", "청소기 멈춰");
    expect(twin(hub, "robot_vacuum_1").running).toBe(false);
  });

  it("현관문 잠그기는 바로, 인덕션 켜기는 승인 필요", async () => {
    llm.script["현관문 잠가줘"] = [[["lock", { device_id: "door_main" }]], "잠갔어요."];
    llm.script["인덕션 켜줘"] = [[["turn_on", { device_id: "induction_1" }]], "켤까요?"];
    const { hub, agent } = llmAgent();
    await hub.command("door_main", { type: "unlock" });
    await agent.chat("s", "현관문 잠가줘");
    expect(twin(hub, "door_main").lock).toBe("locked");
    const r = await agent.chat("s", "인덕션 켜줘");
    expect(r.pendingConfirmations[0]).toMatchObject({ deviceId: "induction_1" });
    expect(twin(hub, "induction_1").power).toBe("off");
  });

  it("센서 문은 바꾸지 않고, 그 이유를 모델에게 돌려준다", async () => {
    llm.script["작은방 문 열어줘"] = [[["unlock", { device_id: "door_bed2" }]], "작은방 문은 센서라 열 수 없어요."];
    const { hub, agent } = llmAgent();
    const bodies = sent();
    const r = await agent.chat("s", "작은방 문 열어줘");
    expect(twin(hub, "door_bed2").door).toBe("closed");
    expect(r.actions[0]).toMatchObject({ ok: false, error: expect.stringContaining("센서") });
    expect(toolOutputs(bodies()[1])[0].error).toContain("센서");
  });

  it("시스템 프롬프트는 바라는 것을 돌려 말한 혼잣말을 가전 요청으로 보지 않게 한다", () => {
    expect(buildSystemPrompt(homeDevices(), ROOMS).split("\n")).toContain(
      "- 「아 덥다」처럼 바라는 것을 직접 시키지 않은 혼잣말은 가전 요청이 아니다. leave_it만 부른다. 「에어컨 켜 줘」처럼 시킨 말만 가전 도구를 부른다.",
    );
  });

  it("「아 덥다」에 모델이 leave_it만 부르면 폰 답은 빈 글이고 가전은 그대로다. 그 말은 관찰 텍스트 줄(사람이 말함)로 판단 호출에 간다", async () => {
    llm.script["아 덥다"] = [[["leave_it", { reason: "시킨 말이 아니라서" }]], "에어컨을 켤까요?"];
    const { hub, agent } = llmAgent();
    const before = JSON.stringify(hub.list().map((d) => hub.get(d.id)!.twin));
    const r = await agent.chat("phone", "아 덥다", { heard: true });
    expect(r.reply).toBe("");
    expect(r.actions.map((a) => a.tool)).toEqual(["leave_it"]);
    expect(JSON.stringify(hub.list().map((d) => hub.get(d.id)!.twin))).toBe(before);
    // 서버(src/server/home/phone.ts)는 같은 말을 World State 들은 말로 넣고 판단 호출이 관찰 텍스트에 싣는다
    const pam = await startFakePamLlm();
    try {
      const world = new WorldState({ surfaces: () => [], floorAt: () => 0, roomAt: () => null, devices: () => [] });
      const clock = { t: Date.parse("2026-11-13T03:00:00Z"), now() { return this.t; } };
      const d = new Decider({
        pam: pamClientFor(pam), world, trigger: new Trigger({ mode: "event", minGapMs: 0, periodMs: 1000, idleStopMs: 1e9, liveMs: 10_000, maxInflight: 1 }, 0),
        tasks: () => [...CUP_TASKS], memory: () => ({ memory: CUP_FSM_MEMORY, kind: "fsm" as const, version: 0 }), emit: () => {}, offsetMinutes: 540, clock,
      });
      d.onChanges(world.heard("아 덥다", clock.t));
      d.tick();
      await d.idle();
      expect(String((pam.bodies.at(-1) as { observation_text: string }).observation_text)).toContain("사람이 말함: 「아 덥다」");
    } finally {
      await pam.close();
    }
  });

  it("가전 요청이 아닌 말에 모델이 leave_it만 부르면 답은 빈 글이다(실제 폰은 보이지도 읽지도 않는다). 가전은 바뀌지 않는다", async () => {
    llm.script["라면 끓이는 법 알려 줘"] = [[["leave_it", { reason: "가전 요청이 아니라서" }]], "라면은 물을 끓이고 면을 넣어요."];
    const events: AgentEvent[] = [];
    const { hub, agent } = llmAgent(events);
    const before = JSON.stringify(hub.list().map((d) => hub.get(d.id)!.twin));
    const r = await agent.chat("phone", "라면 끓이는 법 알려 줘", { heard: true });
    expect(r.reply).toBe("");
    expect(r.actions.map((a) => [a.tool, a.ok])).toEqual([["leave_it", true]]);
    expect(r.pendingConfirmations).toEqual([]);
    expect(JSON.stringify(hub.list().map((d) => hub.get(d.id)!.twin))).toBe(before);
    expect(events.find((e) => e.event === "reply")).toMatchObject({ reply: "" });
  });

  it("들은 말(heard) 차례의 에이전트 방송에는 그 말을 싣지 않는다: reply 이벤트 message는 「들은 말 있음」, 답 글·도구 까닭에 옮긴 그 말도 뺀다. 돌려주는 답(폰이 읽는 글)은 그대로", async () => {
    const SAID = "아 덥다 거실 TV 켜줘";
    llm.script[SAID] = [[["turn_on", { device_id: "tv_living", reason: `「${SAID}」라고 해서` }]], `「${SAID}」 하셔서 거실 TV를 켰어요.`];
    const events: AgentEvent[] = [];
    const { agent } = llmAgent(events);
    const r = await agent.chat("phone", SAID, { heard: true });
    expect(r.reply).toBe(`「${SAID}」 하셔서 거실 TV를 켰어요.`);
    expect(events.find((e) => e.event === "reply")).toMatchObject({ message: "들은 말 있음", reply: "「들은 말」 하셔서 거실 TV를 켰어요." });
    expect(JSON.stringify(events)).not.toContain(SAID);
    // 들은 말이 아닌 요청(대시보드·MCP)은 그대로 싣는다
    const typed: AgentEvent[] = [];
    await llmAgent(typed).agent.chat("s", SAID);
    expect(typed.find((e) => e.event === "reply")).toMatchObject({ message: SAID });
    // 남기기 설정(KEEP_HEARD_TEXT)을 켜면 들은 말도 그대로 싣는다
    const kept: AgentEvent[] = [];
    const home = makeHome();
    await new Agent({ hub: home.hub, policy: home.policy, rooms: ROOMS, provider: llm.provider(), onEvent: (e) => kept.push(e), keepHeard: true }).chat("phone", SAID, { heard: true });
    expect(kept.find((e) => e.event === "reply")).toMatchObject({ message: SAID });
  });

  it("들은 말 차례에 내보내는 action 이벤트는 통째로 가린다(인자·결과 글·관찰·까닭). 실행 인자와 돌려주는 action은 그대로다", async () => {
    const SAID = "거실 TV 어디 있지";
    llm.script[SAID] = [[["find_devices", { query: SAID, reason: "찾으려고" }]], "거실에 TV가 있어요."];
    const events: AgentEvent[] = [];
    const { agent } = llmAgent(events);
    const r = await agent.chat("phone", SAID, { heard: true });
    expect(r.actions[0]).toMatchObject({ tool: "find_devices", args: { query: SAID }, ok: true });
    const action = events.find((e) => e.event === "action");
    expect(action).toMatchObject({ action: { tool: "find_devices", args: { query: "들은 말" } } });
    expect(JSON.stringify(events)).not.toContain(SAID);
  });

  it("상태를 조회한 뒤의 답이라도 위험 가전을 켜라는 글은 폰으로 나가지 않는다", async () => {
    llm.script["인덕션 켜져 있어?"] = [[["get_state", { device_id: "induction_1", reason: "상태를 보려고" }]], "인덕션이 꺼져 있어요. 인덕션을 켜 주세요."];
    const { agent } = llmAgent();
    expect((await agent.chat("phone", "인덕션 켜져 있어?", { heard: true })).reply).not.toContain("켜 주세요");
  });

  it("까닭이 길어도 들은 말은 가린 뒤에 자른다(인용 중간이 잘려 원문 일부가 남지 않는다)", async () => {
    const SAID = "거실 텔레비전 좀 켜 줄래 지금 바로";
    llm.script[SAID] = [[["turn_on", { device_id: "tv_living", reason: `${"가".repeat(185)}「${SAID}」` }]], "거실 TV를 켰어요."];
    const events: AgentEvent[] = [];
    const { agent } = llmAgent(events);
    await agent.chat("phone", SAID, { heard: true });
    const shown = JSON.stringify(events);
    expect(shown).not.toContain("거실 텔레비");
    expect(events.find((e) => e.event === "action")).toMatchObject({ action: { reason: `${"가".repeat(185)}「들은 말」` } });
  });

  it("leave_it과 가전 도구를 같이 부르면 가전 결과를 말한다", async () => {
    llm.script["아 덥다 거실 TV 켜줘"] = [[["leave_it", {}], ["turn_on", { device_id: "tv_living", reason: "TV를 켜 달라고 해서" }]], "거실 TV를 켰어요."];
    const { hub, agent } = llmAgent();
    const r = await agent.chat("phone", "아 덥다 거실 TV 켜줘", { heard: true });
    expect(r.reply).toBe("거실 TV를 켰어요.");
    expect(hub.get("tv_living")!.twin.power).toBe("on");
  });

  it("도구 호출 없는 답은 그대로 낸다", async () => {
    const { agent } = llmAgent();
    const r = await agent.chat("s", "안녕");
    expect(r.actions).toEqual([]);
    expect(r.reply).toBe("가짜 답");
  });

  it("상태 질문은 get_state 결과를 모델에게 돌려준다", async () => {
    llm.script["현관문 상태 알려줘"] = [[["get_state", { device_id: "door_main" }]], "현관문은 닫혀 있고 잠겨 있어요."];
    const { agent } = llmAgent();
    const bodies = sent();
    const r = await agent.chat("s", "현관문 상태 알려줘");
    expect(r.actions[0]).toMatchObject({ tool: "get_state", ok: true });
    expect(toolOutputs(bodies()[1])[0].data.state).toEqual({ door: "closed", lock: "locked" });
  });

  it("onEvent로 action·reply 이벤트를 낸다", async () => {
    const events: AgentEvent[] = [];
    const { agent } = llmAgent(events);
    await agent.chat("s", "거실 TV 켜줘");
    expect(events.some((e) => e.event === "action" && e.sessionId === "s")).toBe(true);
    expect(events.some((e) => e.event === "reply")).toBe(true);
  });
});

describe("Agent + 승인 규칙: 말로 시킨 가전 명령", () => {
  const BOTH = [{ id: "approve", label: "승인" }, { id: "reject", label: "거절" }];
  /** 승인 기억 파일을 쓰는 정책과 에이전트. old: 미리 써 둔 예전 기억 파일 내용. */
  function approvalAgent(old?: unknown) {
    llm.script["거실 불 켜 줘"] = [[["turn_on", { device_id: "light_living", reason: "거실 불을 켜 달라고 해서" }]], "거실 천장등을 켰어요."];
    llm.script["현관문 열어 줘"] = [[["unlock", { device_id: "door_main", reason: "현관문을 열어 달라고 해서" }]], "열까요?"];
    const path = join(mkdtempSync(join(tmpdir(), "agent-ap-")), "approvals.json");
    if (old !== undefined) writeFileSync(path, JSON.stringify(old));
    const approvals = new ApprovalStore(path, () => "t");
    const { hub } = makeHome();
    const policy = new Policy({ approvals });
    const agent = new Agent({ hub, policy, rooms: ROOMS, provider: llm.provider() });
    return { hub, policy, agent, approvals };
  }

  it("말로 「거실 불 켜 줘」 → 승인 없이 바로 켠다", async () => {
    const { hub, agent } = approvalAgent();
    const r = await agent.chat("s", "거실 불 켜 줘", { heard: true });
    expect(r.pendingConfirmations).toEqual([]);
    expect(r.actions[0]).toMatchObject({ tool: "turn_on", ok: true });
    expect(twin(hub, "light_living").power).toBe("on");
  });

  it("「현관문 열어 줘」 → 위험 목록이라 대기, 답은 승인·거절 둘. 예전에 승인을 기억해 둔 적이 있어도 또 묻는다", async () => {
    const { hub, agent } = approvalAgent({ always: { "device:door_main:unlock": "t0" }, never: {} });
    const r = await agent.chat("s", "현관문 열어 줘", { heard: true });
    expect(r.pendingConfirmations).toEqual([expect.objectContaining({ deviceId: "door_main", choices: BOTH })]);
    expect(twin(hub, "door_main").lock).toBe("locked");
  });

  it("예전 파일에 「하지 마」로 남은 가전 명령도 말로 시키면 바로 한다(하지 마 기억은 버린다)", async () => {
    const { hub, agent, approvals } = approvalAgent({ always: {}, never: { "device:light_living:on": "t0" } });
    const r = await agent.chat("s", "거실 불 켜 줘", { heard: true });
    expect(r.pendingConfirmations).toEqual([]);
    expect(twin(hub, "light_living").power).toBe("on");
    expect(approvals.memory()).toEqual({ always: {} });
  });

  it("예전 파일에 「하지 마」로 남은 위험 목록 명령도 답 둘로 묻는다", async () => {
    const { hub, agent } = approvalAgent({ always: {}, never: { "device:door_main:unlock": "t0" } });
    const r = await agent.chat("s", "현관문 열어 줘", { heard: true });
    expect(r.pendingConfirmations).toEqual([expect.objectContaining({ deviceId: "door_main", choices: BOTH })]);
    expect(twin(hub, "door_main").lock).toBe("locked");
  });

  it("위험 목록의 답은 둘 다 이번만: 「승인」은 열고 기억하지 않아 다음에 또 묻고, 「거절」은 열지 않고 기억하지 않는다", async () => {
    const { hub, agent, approvals } = approvalAgent();
    const r1 = await agent.chat("s", "현관문 열어 줘", { heard: true });
    const c = await agent.confirm(r1.pendingConfirmations[0]!.token, "approve");
    expect(c.ok).toBe(true);
    expect(twin(hub, "door_main").lock).toBe("unlocked");
    expect(approvals.memory()).toEqual({ always: {} });
    await hub.command("door_main", { type: "lock" });
    const r2 = await agent.chat("s", "현관문 열어 줘", { heard: true });
    expect(r2.pendingConfirmations).toEqual([expect.objectContaining({ deviceId: "door_main", choices: BOTH })]);
    const n = await agent.confirm(r2.pendingConfirmations[0]!.token, "reject");
    expect(n.ok).toBe(false);
    expect(n.reply).toBe("현관문 잠금 풀기는 하지 않을게요.");
    expect(twin(hub, "door_main").lock).toBe("locked");
    expect(approvals.memory()).toEqual({ always: {} });
    expect(agent.pending("s")).toEqual([]);
    const r3 = await agent.chat("s", "현관문 열어 줘", { heard: true });
    expect(r3.pendingConfirmations).toEqual([expect.objectContaining({ deviceId: "door_main", choices: BOTH })]);
  });

  it("들은 말로는 승인 대기에 답하지 않는다(answerAll 없음): 들은 「승인」「거절」「좋아요」는 모델에게 가고 대기는 그대로다", async () => {
    const { hub, policy, agent } = approvalAgent();
    await agent.chat("s", "현관문 열어 줘", { heard: true });
    for (const said of ["승인", "거절", "좋아요", "하지 마"]) {
      await agent.chat("s", said, { heard: true });
      expect(policy.pending(), said).toHaveLength(1);
      expect(twin(hub, "door_main").lock, said).toBe("locked");
    }
  });

  it("answerToken은 그 승인 대기 하나만 답하고 같이 대기 중인 다른 것은 그대로다. 지금 대기가 아닌 token이면 ok false. 답은 둘 다 기억하지 않는다", async () => {
    llm.script["인덕션 켜 줘"] = [[["turn_on", { device_id: "induction_1", reason: "인덕션을 켜 달라고 해서" }]], "켤까요?"];
    const { hub, policy, agent, approvals } = approvalAgent();
    const a = (await agent.chat("s", "현관문 열어 줘", { heard: true })).pendingConfirmations[0]!.token;
    const b = (await agent.chat("s", "인덕션 켜 줘", { heard: true })).pendingConfirmations.find((p) => p.deviceId === "induction_1")!.token;
    expect(agent.pending("s").map((p) => p.token).sort()).toEqual([a, b].sort());
    expect(await agent.answerToken(a, "approve")).toMatchObject({ ok: true });
    expect(twin(hub, "door_main").lock).toBe("unlocked");
    expect(twin(hub, "induction_1").power).toBe("off");
    expect(agent.pending("s").map((p) => p.token)).toEqual([b]);
    expect(await agent.answerToken(a, "approve")).toMatchObject({ ok: false });
    expect(await agent.answerToken(b, "reject")).toMatchObject({ ok: true, reply: expect.stringContaining("하지 않을게요") });
    expect(policy.pending()).toEqual([]);
    expect(twin(hub, "induction_1").power).toBe("off");
    expect(approvals.memory()).toEqual({ always: {} });
  });

  it("실제 폰이 들은 주변 말에 승인·거절 말이 들어 있어도 답으로 받지 않는다", async () => {
    const ambient = ["승인 받았다고 했잖아", "그거 좋아 보여", "아니 그게 아니라", "하지 마라고 했잖아", "거절당했어", "응", "네"];
    for (const said of ambient) llm.script[said] = ["네."];
    const { hub, policy, agent } = approvalAgent();
    await agent.chat("s", "현관문 열어 줘", { heard: true });
    for (const said of ambient) {
      await agent.chat("s", said, { heard: true });
      expect(twin(hub, "door_main").lock, said).toBe("locked");
      expect(policy.pending(), said).toHaveLength(1);
    }
  });
});

const realDir = resolveTwinStudioDir();
describe.skipIf(!existsSync(join(realDir, "data", "apartment", "placement.json")) && !existsSync(join(realDir, "apartment", "scene.json")))("Agent + OpenAI 공급자(가짜 서버): 실제 트윈 데이터", () => {
  it("거실 불 켜고 TV 꺼줘 / 현관문 열어줘 → 승인 후 열림", async () => {
    const data = loadTwin(realDir);
    const hub = MemoryHub.fromTwin(data);
    const policy = new Policy();
    const tv = data.devices.find((d) => d.kind === "tv" && d.room === "living_room")!;
    const lights = data.devices.filter((d) => d.kind === "light" && d.room === "living_room");
    const lock = data.devices.find((d) => d.kind === "lock")!;
    expect(lights.length).toBeGreaterThan(0);
    llm.script["실제 집: 거실 불 켜고 TV 꺼줘"] = [[...lights.map((l): [string, Record<string, unknown>] => ["turn_on", { device_id: l.id }]), ["turn_off", { device_id: tv.id }]], "했어요."];
    llm.script["실제 집: 현관문 열어줘"] = [[["unlock", { device_id: lock.id }]], "열까요?"];
    const agent = new Agent({ hub, policy, rooms: data.rooms, provider: llm.provider() });
    await hub.command(tv.id, { type: "on" });
    await agent.chat("s", "실제 집: 거실 불 켜고 TV 꺼줘");
    for (const l of lights) expect(hub.get(l.id)!.twin.power).toBe("on");
    expect(hub.get(tv.id)!.twin.power).toBe("off");
    const r = await agent.chat("s", "실제 집: 현관문 열어줘");
    expect(r.pendingConfirmations).toHaveLength(1);
    await agent.chat("s", "응");
    expect(hub.get(lock.id)!.twin.lock).toBe("unlocked");
  });
});

describe("시스템 프롬프트·공급자 선택", () => {
  it("프롬프트에 방·기기 id·승인 규칙이 들어간다", () => {
    const p = buildSystemPrompt(homeDevices(), ROOMS);
    expect(p).toContain("거실");
    expect(p).toContain("tv_living");
    expect(p).toContain("승인");
    expect(p).toMatch(/짧게/);
    expect(p.split("\n")).toContain("- 가전 제어·배치·외부 연락 요청이 아닌 말(혼잣말, 하는 법을 묻는 말, 주변 대화)에는 leave_it만 부르고 답 글을 쓰지 않는다.");
    expect(p).toMatch(/AS센터 전화를 부탁하면 call_service\(kind as_center.*보호자 연락이 필요하면 call_service\(kind guardian.*늘 사용자 승인을 먼저 묻는다/);
  });

  it("AGENT_PROVIDER > ANTHROPIC_API_KEY > openai, 공급자는 openai·anthropic뿐이다", () => {
    expect(resolveProviderName({ AGENT_PROVIDER: "openai", ANTHROPIC_API_KEY: "x" })).toEqual({ name: "openai" });
    expect(resolveProviderName({ ANTHROPIC_API_KEY: "x", OPENAI_API_KEY: "y" })).toEqual({ name: "anthropic" });
    expect(resolveProviderName({ OPENAI_API_KEY: "y" })).toEqual({ name: "openai" });
    expect(resolveProviderName({})).toEqual({ name: "openai" });
    const old = resolveProviderName({ AGENT_PROVIDER: "mock" });
    expect(old.name).toBe("openai");
    expect(old.warning).toMatch(/AGENT_PROVIDER=mock.*openai\|anthropic/);
  });

  it("공급자 기본 모델·주소와 키 비노출", () => {
    const secret = "sk-test-SECRET-123";
    const a = createProvider({ AGENT_PROVIDER: "anthropic", ANTHROPIC_API_KEY: secret });
    expect(a.provider.name).toBe("anthropic");
    expect(a.provider.model).toBe("claude-opus-5-5");
    const o = createProvider({ AGENT_PROVIDER: "openai", OPENAI_API_KEY: secret });
    expect(o.provider.model).toBe("gpt-5.5");
    expect(JSON.stringify(a) + JSON.stringify(o)).not.toContain(secret);
    expect(agentEndpoint({ OPENAI_API_KEY: secret })).toMatchObject({ provider: "openai", baseUrl: "https://api.openai.com/v1", model: "gpt-5.5", apiKey: secret });
    expect(agentEndpoint({ ANTHROPIC_API_KEY: secret, ANTHROPIC_MODEL: "m" })).toMatchObject({ provider: "anthropic", baseUrl: "https://api.anthropic.com", model: "m" });
    expect(agentEndpoint({ OPENAI_BASE_URL: "http://127.0.0.1:9/v1/" }).baseUrl).toBe("http://127.0.0.1:9/v1");
  });

  it("키가 없어도 다른 공급자로 바꾸지 않는다: 그 공급자로 뜨고 경고, 부르면 요청 없이 키가 없다고 실패한다", async () => {
    for (const env of [{}, { AGENT_PROVIDER: "openai" }, { AGENT_PROVIDER: "anthropic" }] as Record<string, string>[]) {
      const { provider, warning } = createProvider(env);
      expect(provider.name).toBe(env.AGENT_PROVIDER ?? "openai");
      expect(warning).toMatch(/(OPENAI|ANTHROPIC)_API_KEY/);
      const { hub, policy } = makeHome();
      const r = await new Agent({ hub, policy, rooms: ROOMS, provider }).chat("s", "거실 TV 켜줘");
      expect(r.reply).toMatch(/실패.*(OPENAI|ANTHROPIC)_API_KEY/);
      expect(r.actions).toEqual([]);
    }
    // 키가 없으면 가짜 서버 주소를 줘도 보내지 않는다
    const before = llm.bodies().length;
    const { provider } = createProvider({ OPENAI_BASE_URL: llm.env.OPENAI_BASE_URL });
    const { hub, policy } = makeHome();
    await new Agent({ hub, policy, rooms: ROOMS, provider }).chat("s", "거실 TV 켜줘");
    expect(llm.bodies()).toHaveLength(before);
  });
});

// ── 공급자 배선: 가짜 HTTP API로 요청 모양과 도구 루프를 확인(진짜 키 없이) ──

interface Seen { path: string; headers: IncomingMessage["headers"]; body: any }

async function fakeApi(responses: unknown[]) {
  const seen: Seen[] = [];
  const server = createServer(async (req, res) => {
    let raw = "";
    for await (const c of req) raw += c;
    seen.push({ path: req.url ?? "", headers: req.headers, body: raw ? JSON.parse(raw) : undefined });
    const next = responses.shift();
    res.writeHead(next ? 200 : 500, { "content-type": "application/json" });
    res.end(JSON.stringify(next ?? { error: { message: "no more responses" } }));
  });
  await listenRetry(server, 0, "127.0.0.1");
  const port = (server.address() as AddressInfo).port;
  return { seen, url: `http://127.0.0.1:${port}`, close: () => new Promise<void>((r) => server.close(() => r())) };
}

describe("공급자 배선(가짜 API)", () => {
  it("anthropic: claude-opus-5-5, effort, fallbacks, tool_use → tool_result 루프", async () => {
    const msg = (content: unknown[], stop: string) => ({ id: "msg_1", type: "message", role: "assistant", model: "claude-opus-5-5", content, stop_reason: stop, stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 } });
    const api = await fakeApi([
      msg([{ type: "thinking", thinking: "", signature: "sig" }, { type: "tool_use", id: "toolu_1", name: "turn_on", input: { device_id: "tv_living" } }], "tool_use"),
      msg([{ type: "text", text: "거실 TV를 켰어요." }], "end_turn"),
    ]);
    try {
      const { hub, policy } = makeHome();
      const provider = new AnthropicProvider({ apiKey: "test-key", baseURL: api.url });
      const agent = new Agent({ hub, policy, rooms: ROOMS, provider });
      const r = await agent.chat("s", "거실 TV 켜줘");
      expect(r.reply).toBe("거실 TV를 켰어요.");
      expect(twin(hub, "tv_living").power).toBe("on");
      const [first, second] = api.seen;
      expect(first!.path).toContain("/v1/messages");
      expect(first!.body).toMatchObject({ model: "claude-opus-5-5", tool_choice: { type: "auto" }, output_config: { effort: "low" }, fallbacks: "default" });
      expect(first!.body).not.toHaveProperty("thinking");
      expect(String(first!.headers["anthropic-beta"])).toContain("server-side-fallback-2026-07-01");
      expect(first!.body.tools.find((t: any) => t.name === "turn_on").input_schema.type).toBe("object");
      expect(first!.body.tools.map((t: any) => t.name)).not.toContain("confirm_action");
      // 생각 블록을 포함한 응답을 그대로 돌려보내고, 도구 결과를 붙인다
      const msgs = second!.body.messages;
      expect(msgs[1].content[0].type).toBe("thinking");
      expect(msgs[2].content[0]).toMatchObject({ type: "tool_result", tool_use_id: "toolu_1" });
    } finally {
      await api.close();
    }
  });

  it("openai: Responses API function_call → function_call_output 루프", async () => {
    const resp = (output: unknown[]) => ({ id: "resp_1", object: "response", created_at: 0, model: "gpt-5.5", status: "completed", output, parallel_tool_calls: true, tool_choice: "auto", tools: [] });
    const api = await fakeApi([
      resp([{ type: "function_call", id: "fc_1", call_id: "call_1", name: "turn_on", arguments: JSON.stringify({ device_id: "tv_living" }), status: "completed" }]),
      resp([{ type: "message", id: "msg_1", role: "assistant", status: "completed", content: [{ type: "output_text", text: "거실 TV를 켰어요.", annotations: [] }] }]),
    ]);
    try {
      const { hub, policy } = makeHome();
      const provider = new OpenAIProvider({ apiKey: "test-key", baseURL: api.url + "/v1" });
      const agent = new Agent({ hub, policy, rooms: ROOMS, provider });
      const r = await agent.chat("s", "거실 TV 켜줘");
      expect(r.reply).toBe("거실 TV를 켰어요.");
      expect(twin(hub, "tv_living").power).toBe("on");
      const [first, second] = api.seen;
      expect(first!.path).toBe("/v1/responses");
      expect(first!.body).toMatchObject({ model: "gpt-5.5", tool_choice: "auto" });
      expect(first!.body.tools[0]).toMatchObject({ type: "function" });
      expect(typeof first!.body.instructions).toBe("string");
      expect(second!.body.input).toContainEqual(expect.objectContaining({ type: "function_call_output", call_id: "call_1" }));
    } finally {
      await api.close();
    }
  });

  it("한 도구만 부르게 하면(forceTool) openai는 그 함수를 지정하고 병렬 호출을 끈다. anthropic은 생각이 늘 켜져 지정을 못 해 auto에 병렬 호출만 끈다. 도구를 막으면(allowTools false) 그것이 먼저다", async () => {
    const resp = (output: unknown[]) => ({ id: "resp_1", object: "response", created_at: 0, model: "gpt-5.5", status: "completed", output, parallel_tool_calls: false, tool_choice: "auto", tools: [] });
    const call = resp([{ type: "function_call", id: "fc_1", call_id: "call_1", name: "turn_on", arguments: "{}", status: "completed" }]);
    const msg = (content: unknown[], stop: string) => ({ id: "msg_1", type: "message", role: "assistant", model: "claude-opus-5-5", content, stop_reason: stop, stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 } });
    const use = msg([{ type: "tool_use", id: "toolu_1", name: "turn_on", input: {} }], "tool_use");
    const tool = TOOLS.find((t) => t.name === "turn_on")!;
    const oapi = await fakeApi([call, call]);
    const aapi = await fakeApi([use, use]);
    try {
      const openai = new OpenAIProvider({ apiKey: "test-key", baseURL: oapi.url + "/v1" });
      expect((await openai.step(openai.createState(), { system: "s", tools: [tool], allowTools: true, forceTool: "turn_on" })).calls).toHaveLength(1);
      await openai.step(openai.createState(), { system: "s", tools: [tool], allowTools: false, forceTool: "turn_on" });
      expect(oapi.seen[0]!.body).toMatchObject({ tool_choice: { type: "function", name: "turn_on" }, parallel_tool_calls: false });
      expect(oapi.seen[1]!.body).toMatchObject({ tool_choice: "none" });
      const anthropic = new AnthropicProvider({ apiKey: "test-key", baseURL: aapi.url });
      expect((await anthropic.step(anthropic.createState(), { system: "s", tools: [tool], allowTools: true, forceTool: "turn_on" })).calls).toHaveLength(1);
      await anthropic.step(anthropic.createState(), { system: "s", tools: [tool], allowTools: false, forceTool: "turn_on" });
      expect(aapi.seen[0]!.body).toMatchObject({ tool_choice: { type: "auto", disable_parallel_tool_use: true } });
      expect(aapi.seen[1]!.body).toMatchObject({ tool_choice: { type: "none" } });
    } finally {
      await oapi.close();
      await aapi.close();
    }
  });

  it("도구를 꼭 부르게 하면(requireTool) openai는 required·병렬 끔, anthropic은 auto·병렬 끔. forceTool이 먼저다. 응답 사용량을 돌려준다", async () => {
    const usage = { input_tokens: 100, input_tokens_details: { cached_tokens: 40 }, output_tokens: 7, output_tokens_details: { reasoning_tokens: 3 }, total_tokens: 107 };
    const resp = (output: unknown[]) => ({ id: "resp_1", object: "response", created_at: 0, model: "gpt-5.5", status: "completed", output, parallel_tool_calls: false, tool_choice: "required", tools: [], usage });
    const call = resp([{ type: "function_call", id: "fc_1", call_id: "call_1", name: "turn_on", arguments: "{}", status: "completed" }]);
    const msg = (content: unknown[], stop: string) => ({ id: "msg_1", type: "message", role: "assistant", model: "claude-opus-5-5", content, stop_reason: stop, stop_sequence: null,
      usage: { input_tokens: 10, output_tokens: 3, cache_read_input_tokens: 5 } });
    const use = msg([{ type: "tool_use", id: "toolu_1", name: "turn_on", input: {} }], "tool_use");
    const tool = TOOLS.find((t) => t.name === "turn_on")!;
    const oapi = await fakeApi([call, call, call]);
    const aapi = await fakeApi([use]);
    try {
      const openai = new OpenAIProvider({ apiKey: "test-key", baseURL: oapi.url + "/v1" });
      const r = await openai.step(openai.createState(), { system: "s", tools: [tool], allowTools: true, requireTool: true });
      expect(r.calls).toHaveLength(1);
      // 생각 토큰(output 가운데)도 알려 주면 남긴다(계획 모드 차례 기록이 생각이 켜졌는지 본다)
      expect(r.usage).toEqual({ model: "gpt-5.5", input: 100, cached: 40, output: 7, reasoning: 3 });
      await openai.step(openai.createState(), { system: "s", tools: [tool], allowTools: true, requireTool: true, forceTool: "turn_on" });
      await openai.step(openai.createState(), { system: "s", tools: [tool], allowTools: false, requireTool: true });
      expect(oapi.seen[0]!.body).toMatchObject({ tool_choice: "required", parallel_tool_calls: false });
      expect(oapi.seen[1]!.body).toMatchObject({ tool_choice: { type: "function", name: "turn_on" }, parallel_tool_calls: false });
      expect(oapi.seen[2]!.body).toMatchObject({ tool_choice: "none" });
      expect(oapi.seen[2]!.body).not.toHaveProperty("parallel_tool_calls");
      const anthropic = new AnthropicProvider({ apiKey: "test-key", baseURL: aapi.url });
      const a = await anthropic.step(anthropic.createState(), { system: "s", tools: [tool], allowTools: true, requireTool: true });
      expect(a.calls).toHaveLength(1);
      expect(a.usage).toEqual({ model: "claude-opus-5-5", input: 15, cached: 5, output: 3 });
      expect(aapi.seen[0]!.body).toMatchObject({ tool_choice: { type: "auto", disable_parallel_tool_use: true } });
    } finally {
      await oapi.close();
      await aapi.close();
    }
  });
});
