import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Agent } from "../src/agent/agent.js";
import { LAYOUT_TOOLS, type LayoutTools } from "../src/agent/layoutTools.js";
import { buildSystemPrompt } from "../src/agent/prompts.js";
import { MCP_TOOLS, localBackend, runTool } from "../src/agent/tools.js";
import { LayoutEditor, type HereResolver } from "../src/layout/editor.js";
import { makeHome } from "./helpers/home.js";
import { CATALOG, scene } from "./helpers/layout.js";
import { startFakeLlm, toolOutputs, type FakeLlm, type LlmTurn } from "./helpers/llm.js";

const temps: string[] = [];
afterAll(() => {
  for (const d of temps) rmSync(d, { recursive: true, force: true });
});

function setup(here?: HereResolver) {
  const dir = mkdtempSync(join(tmpdir(), "twin-home-layout-agent-"));
  temps.push(dir);
  const editor = new LayoutEditor({ homeId: "oneroom", scene: scene(), catalog: CATALOG, savePath: join(dir, "edits.json"), here });
  const layout: LayoutTools = { editor, catalog: CATALOG };
  const home = makeHome();
  const backend = localBackend(home.hub, home.policy, home.rooms, layout);
  return { ...home, editor, layout, backend, dir };
}

describe("배치 도구", () => {
  it("찾기 → 옮기기 → 더하기 → 빼기 → 종류 찾기 → 저장", async () => {
    const { backend, editor, dir } = setup(() => ({ position: [3, 3], from: [3, 2] }));
    const found = await runTool("find_objects", { query: "냉장고" }, backend, LAYOUT_TOOLS);
    expect(found.ok).toBe(true);
    expect((found.data as { id: string }[]).map((o) => o.id)).toEqual(["fridge_1"]);

    const moved = await runTool("move_object", { object_id: "fridge_1", to: "here" }, backend, LAYOUT_TOOLS);
    expect(moved).toMatchObject({ ok: true, device: { id: "fridge_1" } });
    expect(editor.object("fridge_1")!.plan.position).toEqual([3, 3]);
    expect(editor.object("fridge_1")!.plan.facing_deg).toBe(270);

    const nudged = await runTool("move_object", { object_id: "fridge_1", dx: -0.5 }, backend, LAYOUT_TOOLS);
    expect(nudged.ok).toBe(true);
    expect(editor.object("fridge_1")!.plan.position).toEqual([2.5, 3]);

    const empty = await runTool("move_object", { object_id: "fridge_1" }, backend, LAYOUT_TOOLS);
    expect(empty.ok).toBe(false);
    expect(empty.error).toMatch(/자리/);

    const types = await runTool("find_object_types", { query: "공기청정기" }, backend, LAYOUT_TOOLS);
    expect(types.data).toEqual([{ type: "air_purifier", label: "공기청정기", mount: "floor", addable: true, matter: true }]);

    const added = await runTool("add_object", { type: "air_purifier", x: 1, y: 3 }, backend, LAYOUT_TOOLS);
    expect(added).toMatchObject({ ok: true, device: { id: "air_purifier_1", label: "공기청정기" } });
    const badAdd = await runTool("add_object", { type: "air_purifier" }, backend, LAYOUT_TOOLS);
    expect(badAdd.ok).toBe(false);

    const removed = await runTool("remove_object", { object_id: "tv_stand_1" }, backend, LAYOUT_TOOLS);
    expect(removed.message).toMatch(/TV/);
    const fixed = await runTool("remove_object", { object_id: "door_main" }, backend, LAYOUT_TOOLS);
    expect(fixed).toMatchObject({ ok: false });
    expect(fixed.error).toMatch(/뺄 수 없/);

    const saved = await runTool("save_layout", {}, backend, LAYOUT_TOOLS);
    expect(saved.ok).toBe(true);
    expect(saved.message).toMatch(/apply-edits --home oneroom/);
    const file = JSON.parse(readFileSync(join(dir, "edits.json"), "utf8"));
    expect(file.edits.map((e: { op: string; id: string }) => `${e.op}:${e.id}`)).toEqual(["move:fridge_1", "remove:tv_stand_1", "remove:tv_1", "add:air_purifier_1"]);
  });

  it("편집기가 없으면 도구는 오류, MCP에는 배치 도구가 없다", async () => {
    const home = makeHome();
    const r = await runTool("find_objects", { query: "냉장고" }, localBackend(home.hub, home.policy, home.rooms), LAYOUT_TOOLS);
    expect(r.ok).toBe(false);
    expect(MCP_TOOLS.map((t) => t.name)).not.toContain("move_object");
  });

  it("프롬프트는 배치 보정이 켜졌을 때만 배치 규칙을 담는다", () => {
    const { devices, rooms } = makeHome();
    expect(buildSystemPrompt(devices, rooms, { layout: true })).toContain("move_object(to=\"here\")");
    expect(buildSystemPrompt(devices, rooms)).not.toContain("move_object");
  });
});

describe("에이전트의 배치 말(OpenAI 공급자, 가짜 서버)", () => {
  const here = (query: string, id: string): LlmTurn[] => [
    [["find_objects", { query, reason: `${query}을 찾으려고` }]],
    [["move_object", { object_id: id, to: "here", reason: "조준점 자리로 옮기려고" }]],
    `${query}를 여기로 옮겼어요.`,
  ];
  let llm: FakeLlm;
  beforeAll(async () => {
    llm = await startFakeLlm({
      "냉장고 위치 여기로 맞춰줘": here("냉장고", "fridge_1"), "냉장고는 여기 있어": here("냉장고", "fridge_1"),
      "TV는 여기로 옮겨줘": here("TV", "tv_1"),
      "피아노는 여기 있어": [[["find_objects", { query: "피아노" }]], "피아노를 찾지 못했어요."],
      "배치 저장해": [[["save_layout", {}]], "배치를 저장했어요."],
    });
  });
  afterAll(async () => { await llm?.close(); });
  const agentOf = (s: ReturnType<typeof setup>) => new Agent({ hub: s.hub, policy: s.policy, rooms: s.rooms, provider: llm.provider(), layout: s.layout });

  it.each(["냉장고 위치 여기로 맞춰줘", "냉장고는 여기 있어"])("'%s' → 모델의 find_objects → move_object(here) → 조준점으로 옮김", async (said) => {
    const s = setup(() => ({ position: [3, 3] }));
    const r = await agentOf(s).chat("s", said);
    expect(r.actions.map((a) => a.tool)).toEqual(["find_objects", "move_object"]);
    expect(r.actions[1]).toMatchObject({ ok: true, deviceId: "fridge_1", args: { object_id: "fridge_1", to: "here" } });
    expect(s.editor.object("fridge_1")!.plan.position).toEqual([3, 3]);
  });

  it("조준점이 없으면 옮기지 않고 그 이유를 모델에게 돌려준다", async () => {
    const s = setup(() => ({ error: "조준점이 바닥에 닿지 않았어요." }));
    const from = llm.bodies().length;
    const r = await agentOf(s).chat("s", "TV는 여기로 옮겨줘");
    expect(r.actions.at(-1)).toMatchObject({ tool: "move_object", ok: false, error: expect.stringMatching(/조준점/) });
    expect(toolOutputs(llm.bodies().slice(from).at(-1)).at(-1).error).toMatch(/조준점/);
  });

  it("없는 물건은 빈 찾기 결과를 모델에게 돌려준다", async () => {
    const s = setup(() => ({ position: [3, 3] }));
    const from = llm.bodies().length;
    const r = await agentOf(s).chat("s", "피아노는 여기 있어");
    expect(r.actions.map((a) => a.tool)).toEqual(["find_objects"]);
    expect(toolOutputs(llm.bodies().slice(from).at(-1))[0]).toMatchObject({ ok: true, data: [], message: expect.stringMatching(/피아노/) });
  });

  it("'배치 저장해' → save_layout → 수정본 파일", async () => {
    const s = setup(() => ({ position: [3, 3] }));
    const agent = agentOf(s);
    await agent.chat("s", "냉장고 위치 여기로 맞춰줘");
    const r = await agent.chat("s", "배치 저장해");
    expect(r.actions.map((a) => a.tool)).toEqual(["save_layout"]);
    expect(r.actions[0]!.message).toMatch(/1건/);
    expect(existsSync(join(s.dir, "edits.json"))).toBe(true);
  });

  it("배치 보정이 꺼져 있으면 모델에게 배치 도구를 주지 않고, 불러도 실행하지 않는다", async () => {
    const home = makeHome();
    const from = llm.bodies().length;
    const agent = new Agent({ hub: home.hub, policy: home.policy, rooms: home.rooms, provider: llm.provider() });
    const r = await agent.chat("s", "냉장고 위치 여기로 맞춰줘");
    const tools = llm.bodies()[from].tools.map((t: { name: string }) => t.name);
    expect(tools).toContain("turn_on");
    expect(tools).not.toContain("move_object");
    expect(r.actions.every((a) => !a.ok)).toBe(true);
  });
});
