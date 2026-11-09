import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Agent } from "../src/agent/agent.js";
import { createProvider } from "../src/agent/providers/index.js";
import { createApp, type TwinHomeApp } from "../src/server/app.js";
import { ROOMS, makeHome, twin } from "./helpers/home.js";

const ROOT = fileURLToPath(new URL("..", import.meta.url));

type ToolResult = { content: { type: string; text: string }[]; isError?: boolean };

describe("MCP stdio 서버(SDK 클라이언트로 실제 실행)", () => {
  const home = makeHome();
  let app: TwinHomeApp;
  let client: Client;
  let stderr = "";

  beforeAll(async () => {
    const agent = new Agent({ hub: home.hub, policy: home.policy, rooms: ROOMS, provider: createProvider({}).provider }); // 모델은 부르지 않는다
    app = createApp({ hub: home.hub, policy: home.policy, agent, rooms: ROOMS, log: () => {} });
    const { url } = await app.listen(0, "127.0.0.1");
    const env: Record<string, string> = {};
    for (const [k, v] of Object.entries(process.env)) if (typeof v === "string") env[k] = v;
    env.TWIN_HOME_URL = url;
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: ["--import", "tsx", "src/mcp/server.ts"],
      cwd: ROOT,
      env,
      stderr: "pipe",
    });
    transport.stderr?.on("data", (d) => { stderr += String(d); });
    client = new Client({ name: "twin-home-test", version: "0.0.0" });
    await client.connect(transport);
  }, 60_000);

  afterAll(async () => {
    await client?.close();
    await app?.close();
  });

  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const r = (await client.callTool({ name, arguments: args })) as ToolResult;
    const text = r.content.map((c) => c.text).join("\n");
    return { ...r, text, json: JSON.parse(text) as Record<string, any> };
  };

  it("도구 목록: 계획서 도구 + confirm_action", async () => {
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name);
    for (const n of ["list_rooms", "list_devices", "find_devices", "get_state", "turn_on", "turn_off", "set_level", "set_climate", "set_covering", "lock", "unlock", "start", "stop", "set_valve", "confirm_action"]) {
      expect(names).toContain(n);
    }
    const turnOn = tools.find((t) => t.name === "turn_on")!;
    expect(turnOn.description).toMatch(/[가-힣]/);
    expect(turnOn.inputSchema.properties).toHaveProperty("device_id");
  });

  it("list_devices → turn_on(tv_living) → 실제 서버 상태가 바뀐다", async () => {
    const list = await call("list_devices", { room: "거실" });
    expect(list.isError).toBeFalsy();
    expect((list.json.data as { id: string }[]).map((d) => d.id)).toContain("tv_living");
    const r = await call("turn_on", { device_id: "tv_living" });
    expect(r.isError).toBeFalsy();
    expect(r.json).toMatchObject({ ok: true, device: { id: "tv_living" }, state: { power: "on" } });
    expect(twin(home.hub, "tv_living").power).toBe("on");
    const st = await call("get_state", { device_id: "tv_living" });
    expect(st.json.data.state.power).toBe("on");
  }, 30_000);

  it("unlock은 승인 토큰을 돌려주고, confirm_action으로 확정한다", async () => {
    const r = await call("unlock", { device_id: "door_main" });
    expect(r.json.needsConfirmation.token).toBeTruthy();
    expect(twin(home.hub, "door_main").lock).toBe("locked");
    const c = await call("confirm_action", { token: r.json.needsConfirmation.token });
    expect(c.json.ok).toBe(true);
    expect(twin(home.hub, "door_main").lock).toBe("unlocked");
  }, 30_000);

  it("오류는 isError + 한국어 메시지", async () => {
    const r = await call("turn_on", { device_id: "nope" });
    expect(r.isError).toBe(true);
    expect(r.json.error).toContain("기기를 찾을 수 없습니다");
    expect(stderr).not.toMatch(/sk-[A-Za-z0-9]/);
  }, 30_000);
});
