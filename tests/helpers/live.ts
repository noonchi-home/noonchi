// e2e 테스트 도우미: REST 호출, WS 이벤트 모으기, MCP stdio 클라이언트.
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import WebSocket from "ws";
import { fetchRetry } from "../../src/server/net.js";

export type Msg = Record<string, any>;

const ROOT = fileURLToPath(new URL("../..", import.meta.url));

export async function api(url: string, path: string, body?: unknown): Promise<{ status: number; json: Msg }> {
  const res = await fetchRetry(url + path, body === undefined
    ? {}
    : { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  return { status: res.status, json: (await res.json()) as Msg };
}

/** /events에 붙어 메시지를 모은다. since(n) 뒤의 state 이벤트만 골라 볼 수 있다. */
export async function listenEvents(url: string) {
  const ws = new WebSocket(url.replace(/^http/, "ws") + "/events");
  const messages: Msg[] = [];
  ws.on("message", (data) => messages.push(JSON.parse(String(data)) as Msg));
  await new Promise<void>((resolve, reject) => {
    ws.once("open", () => resolve());
    ws.once("error", reject);
  });
  const states = (from = 0) => messages.slice(from).filter((m) => m.type === "state").map((m) => m.state as Msg);
  const waitFor = async (pred: (m: Msg) => boolean, ms = 5000) => {
    const start = Date.now();
    for (;;) {
      const found = messages.find(pred);
      if (found) return found;
      if (Date.now() - start > ms) throw new Error("WS 메시지를 기다리다 시간 초과");
      await new Promise((r) => setTimeout(r, 20));
    }
  };
  return { ws, messages, states, waitFor, close: () => ws.close() };
}

type ToolResult = { content: { type: string; text: string }[]; isError?: boolean };

/** MCP stdio 서버(src/mcp/server.ts)를 실제로 띄워 SDK 클라이언트로 붙는다. */
export async function mcpClient(twinHomeUrl: string) {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) if (typeof v === "string") env[k] = v;
  env.TWIN_HOME_URL = twinHomeUrl;
  const transport = new StdioClientTransport({ command: process.execPath, args: ["--import", "tsx", "src/mcp/server.ts"], cwd: ROOT, env, stderr: "pipe" });
  let stderr = "";
  transport.stderr?.on("data", (d) => { stderr += String(d); });
  const client = new Client({ name: "twin-home-e2e", version: "0.0.0" });
  await client.connect(transport);
  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const r = (await client.callTool({ name, arguments: args })) as ToolResult;
    const text = r.content.map((c) => c.text).join("\n");
    return { isError: r.isError, json: JSON.parse(text) as Msg };
  };
  return { client, call, stderr: () => stderr, close: () => client.close() };
}
