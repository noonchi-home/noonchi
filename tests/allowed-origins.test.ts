// 허용 출처(ALLOWED_ORIGINS): tailscale serve 주소에서 연 대시보드가 쓰기 요청과 /events를 쓴다. 다른 출처는 막는다.
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { originChecker } from "../src/server/app.js";
import { fetchRetry } from "../src/server/net.js";
import { startServer, type RunningServer } from "../src/server/start.js";
import { openWebSocket } from "./helpers/ws.js";

const TS = "https://noonchi.tail1234.ts.net";
let srv: RunningServer | undefined;
afterEach(async () => { await srv?.close(); srv = undefined; });

const wsOpen = (url: string, origin: string) => openWebSocket(url, { options: { origin } }).then((ws) => { ws.close(); return true; }, () => false);

describe("허용 출처", () => {
  it("이 PC와 ALLOWED_ORIGINS만 허용한다", () => {
    const ok = originChecker(`${TS}/, https://other.ts.net:8443`);
    expect(ok("http://127.0.0.1:5173")).toBe(true);
    expect(ok(TS)).toBe(true);
    expect(ok("https://other.ts.net:8443")).toBe(true);
    expect(ok("https://evil.example")).toBe(false);
    expect(originChecker(undefined)(TS)).toBe(false);
  });

  it("주소가 아닌 값은 시작을 막는다", () => {
    expect(() => originChecker("noonchi.ts.net")).toThrow(/ALLOWED_ORIGINS/);
  });

  it("tailscale 주소에서 연 대시보드가 /events에 붙고 쓰기 요청을 보낸다", async () => {
    srv = await startServer({ env: { HUB: "memory", PORT: "0", AGENT_PROVIDER: "mock", ALLOWED_ORIGINS: TS, RUNTIME_DIR: mkdtempSync(join(tmpdir(), "rt-")) }, log: () => {} });
    const ws = srv.url.replace(/^http/, "ws") + "/events";
    expect(await wsOpen(ws, TS)).toBe(true);
    expect(await wsOpen(ws, "https://evil.example")).toBe(false);
    const post = (path: string, origin: string, body: unknown) => fetchRetry(`${srv!.url}${path}`, { method: "POST", headers: { origin, "content-type": "application/json" }, body: JSON.stringify(body) });
    expect((await post("/api/agent/chat", TS, { message: "안녕" })).status).not.toBe(403);
    expect((await post("/api/agent/chat", "https://evil.example", { message: "안녕" })).status).toBe(403);
    expect((await post("/api/setup/done", TS, {})).status).not.toBe(403);
    expect((await post("/api/setup/done", "https://evil.example", {})).status).toBe(403);
  });
});
