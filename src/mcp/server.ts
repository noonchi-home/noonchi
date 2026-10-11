// MCP stdio 서버: 에이전트 도구(src/agent/tools.ts)를 그대로 노출하고, 실행 중인 twin-home 서버 REST(TWIN_HOME_URL)를 부른다.
// Claude Code: claude mcp add twin-home -- npx tsx src/mcp/server.ts
// stdout은 MCP 프로토콜 전용이다. 로그는 stderr로만 쓴다.

import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { MCP_TOOLS, runTool, type ToolBackend } from "../agent/tools.js";
import { DEFAULT_TWIN_HOME_URL, httpBackend } from "./client.js";

const INSTRUCTIONS = `twin-home: 가상 아파트(디지털 트윈)의 Matter 가전을 제어합니다.
- 먼저 find_devices(한국어 이름·방)나 list_devices로 기기 id를 찾고, turn_on/turn_off/set_level/set_climate/set_covering/lock/unlock/start/stop/set_valve로 제어하세요.
- 현관문 잠금 해제, 인덕션 켜기, 전자레인지 시작은 needsConfirmation(token)을 돌려줍니다. 사용자에게 승인을 물은 뒤, 승인했을 때만 confirm_action(token)을 부르세요.
- 문 열림·충전 같은 센서는 바꿀 수 없습니다.`;

export function createMcpServer(backend: ToolBackend): McpServer {
  const server = new McpServer({ name: "twin-home", version: "0.1.0" }, { instructions: INSTRUCTIONS });
  for (const tool of MCP_TOOLS) {
    server.registerTool(
      tool.name,
      {
        title: tool.title,
        description: tool.description,
        inputSchema: tool.schema.shape,
        annotations: { title: tool.title, readOnlyHint: tool.readOnly ?? false, openWorldHint: false },
      },
      async (args: unknown) => {
        const r = await runTool(tool.name, args, backend);
        return {
          content: [{ type: "text" as const, text: JSON.stringify(r, null, 2) }],
          isError: !r.ok && !r.needsConfirmation,
        };
      },
    );
  }
  return server;
}

async function main(): Promise<void> {
  dotenv.config({ quiet: true });
  const url = process.env.TWIN_HOME_URL?.trim() || DEFAULT_TWIN_HOME_URL;
  const server = createMcpServer(httpBackend(url));
  await server.connect(new StdioServerTransport());
  process.stderr.write(`[twin-home mcp] stdio 대기 중 · REST ${url}\n`);
}

function isEntry(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  const norm = (p: string) => (process.platform === "win32" ? resolve(p).toLowerCase() : resolve(p)).replace(/\.(ts|js)$/, "");
  return norm(fileURLToPath(import.meta.url)) === norm(entry);
}

if (isEntry()) {
  main().catch((e) => {
    process.stderr.write(`[twin-home mcp] 시작 실패: ${(e as Error).stack ?? e}\n`);
    process.exit(1);
  });
}
