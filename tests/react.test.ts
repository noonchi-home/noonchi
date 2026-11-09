// 추론 과정(ReAct): 도구마다 생각(reason) → 행동(도구) → 관찰(결과 문장). reason은 서버 안 에이전트에게만 받는다.

import { describe, expect, it } from "vitest";
import { Agent, type LlmProvider, type StepOptions, type StepResult, type ToolCallResult } from "../src/agent/agent.js";
import { observe } from "../src/agent/observe.js";
import { MCP_TOOLS, toolJsonSchema } from "../src/agent/tools.js";
import { makeHome } from "./helpers/home.js";

/** 정해 둔 도구 호출을 차례로 내는 가짜 공급자. 받은 도구 목록을 남긴다. */
class Scripted implements LlmProvider {
  readonly name = "scripted";
  seen: StepOptions["tools"] = [];
  constructor(private readonly steps: StepResult[]) {}
  createState() {
    return { i: 0 };
  }
  addUserMessage() {}
  async step(state: unknown, opts: StepOptions): Promise<StepResult> {
    this.seen = opts.tools;
    const s = state as { i: number };
    return this.steps[s.i++] ?? { text: "끝", calls: [] };
  }
  addToolResults(_s: unknown, _r: ToolCallResult[]) {}
}

describe("reason(생각)", () => {
  it("서버 안 에이전트 도구에는 reason이 필수이고, MCP 도구에는 없다", async () => {
    const home = makeHome();
    const p = new Scripted([]);
    const agent = new Agent({ hub: home.hub, policy: home.policy, rooms: home.rooms, provider: p });
    await agent.chat("s", "아무 말");
    const turnOn = p.seen.find((t) => t.name === "turn_on")!;
    expect(toolJsonSchema(turnOn).required).toContain("reason");
    expect(toolJsonSchema(MCP_TOOLS.find((t) => t.name === "turn_on")!).properties).not.toHaveProperty("reason");
  });

  it("reason은 실행 전에 떼고 action.reason·관찰과 함께 기록한다", async () => {
    const home = makeHome();
    const p = new Scripted([
      { text: "", calls: [{ id: "1", name: "find_devices", args: { query: "거실 TV", reason: "어느 TV인지 찾으려고" } }] },
      { text: "", calls: [{ id: "2", name: "turn_on", args: { device_id: "tv_living", reason: "거실 TV를 켜 달라고 해서" } }] },
      { text: "켰어요", calls: [] },
    ]);
    const agent = new Agent({ hub: home.hub, policy: home.policy, rooms: home.rooms, provider: p });
    const r = await agent.chat("s", "거실 TV 켜줘");
    expect(r.actions[0]).toMatchObject({ tool: "find_devices", reason: "어느 TV인지 찾으려고", args: { query: "거실 TV" }, observation: "거실 TV · 거실" });
    expect(r.actions[0]!.args).not.toHaveProperty("reason");
    expect(r.actions[1]).toMatchObject({ tool: "turn_on", reason: "거실 TV를 켜 달라고 해서", ok: true });
    expect(r.actions[1]!.observation).toMatch(/켰어요/);
  });

  it("reason이 없어도 실행은 한다(생각 없음으로 기록)", async () => {
    const home = makeHome();
    const p = new Scripted([{ text: "", calls: [{ id: "1", name: "turn_on", args: { device_id: "tv_living" } }] }, { text: "켰어요", calls: [] }]);
    const agent = new Agent({ hub: home.hub, policy: home.policy, rooms: home.rooms, provider: p });
    const r = await agent.chat("s", "TV 켜줘");
    expect(r.actions[0]).toMatchObject({ ok: true });
    expect(r.actions[0]!.reason).toBeUndefined();
  });
});

describe("observe(관찰 문장)", () => {
  it("찾기는 찾은 목록, 없으면 없음", () => {
    expect(observe("find_devices", { ok: true, data: { devices: [{ label: "TV", roomLabel: "방" }, { label: "천장등", roomLabel: "방" }] } })).toBe("TV · 방, 천장등 · 방");
    expect(observe("find_devices", { ok: true, data: { devices: [] } })).toBe("찾은 기기 없음");
    expect(observe("find_objects", { ok: true, data: [{ label: "냉장고", roomLabel: "주방" }] })).toBe("냉장고 · 주방");
    expect(observe("find_objects", { ok: true, data: [] })).toBe("찾은 물건 없음");
    expect(observe("find_object_types", { ok: true, data: [{ label: "공기청정기" }] })).toBe("공기청정기");
  });

  it("제어는 바뀐 상태, 승인 대기, 실패 이유", () => {
    expect(observe("turn_on", { ok: true, message: "TV를 켰어요." })).toBe("TV를 켰어요.");
    expect(observe("unlock", { ok: false, needsConfirmation: { token: "t", reason: "현관문 잠금 해제" } })).toBe("승인 대기 · 현관문 잠금 해제");
    expect(observe("unlock", { ok: false, pendingApproval: { reason: "현관문 잠금 해제" } })).toBe("승인 대기 · 현관문 잠금 해제");
    expect(observe("turn_on", { ok: false, error: "기기를 찾을 수 없습니다: x" })).toBe("실패 · 기기를 찾을 수 없습니다: x");
  });

  it("옮기기·더하기는 방과 자리", () => {
    expect(observe("move_object", { ok: true, data: { label: "냉장고", roomLabel: "방", position: [2.5, 2.6] } })).toBe("냉장고 → 방 (2.50, 2.60)");
    expect(observe("add_object", { ok: true, data: { label: "공기청정기", roomLabel: "방", position: [1, 3] } })).toBe("공기청정기 → 방 (1.00, 3.00)");
    expect(observe("save_layout", { ok: true, data: { count: 2 }, message: "배치 보정 2건을 저장했어요." })).toBe("수정본 2건 저장");
  });
});
