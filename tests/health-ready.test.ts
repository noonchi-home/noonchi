// 준비 상태(/api/health ready): 추론 모드, VLM 주소 응답, PAM 서비스와 그 LLM 응답, 기록 DB.
// 모델 주소는 이 시험이 띄운 로컬 가짜 서버나 닿지 않는 로컬 주소다.
import { createServer, type Server } from "node:http";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { HealthView } from "../src/contract/events.js";
import { fetchRetry, listenRetry } from "../src/server/net.js";
import { startServer, type RunningServer } from "../src/server/start.js";

let srv: RunningServer | undefined;
let stub: Server | undefined;
afterEach(async () => { await srv?.close(); stub?.close(); srv = stub = undefined; });

async function startStub(): Promise<string> {
  stub = createServer((req, res) => {
    if (req.url === "/v1/models") { res.writeHead(200, { "content-type": "application/json" }); res.end('{"data":[]}'); return; }
    if (req.url === "/health") { res.writeHead(200, { "content-type": "application/json" }); res.end('{"ok":true,"llm":{"base_url":"http://x/v1","model":"q","reachable":true}}'); return; }
    res.writeHead(404); res.end();
  });
  const { port } = await listenRetry(stub, 0, "127.0.0.1");
  return `http://127.0.0.1:${port}`;
}

describe("준비 상태", () => {
  it("추론 모드·모델 주소 응답·PAM·기록 DB를 보인다", async () => {
    const base = await startStub();
    const runtime = mkdtempSync(join(tmpdir(), "rt-"));
    srv = await startServer({ env: {
      HUB: "memory", PORT: "0", AGENT_PROVIDER: "mock", RUNTIME_DIR: runtime,
      INFERENCE_MODE: "live", VLM_BASE_URL: `${base}/v1`, PAM_URL: base,
    }, log: () => {} });
    const h = (await (await fetchRetry(`${srv.url}/api/health`)).json()) as HealthView;
    expect(h.ok).toBe(true);
    expect(h.ready).toMatchObject({ ok: true, inference_mode: "live", db: true,
      vlm: { base_url: `${base}/v1`, model: "vlm", key: false, reachable: true },
      pam: { url: base, reachable: true, llm: { model: "q", reachable: true } } });
    expect(existsSync(join(runtime, "noonchi.db"))).toBe(true);
  });

  it("모델 주소가 답하지 않아도 health는 200이고 ready.ok가 false다", async () => {
    srv = await startServer({ env: { HUB: "memory", PORT: "0", AGENT_PROVIDER: "mock", RUNTIME_DIR: mkdtempSync(join(tmpdir(), "rt-")),
      VLM_BASE_URL: "http://127.0.0.1:9/v1", PAM_URL: "http://127.0.0.1:9" }, log: () => {} });
    const r = await fetchRetry(`${srv.url}/api/health`);
    expect(r.status).toBe(200);
    expect(((await r.json()) as HealthView).ready).toMatchObject({ ok: false, inference_mode: "mock", vlm: { reachable: false }, pam: { reachable: false, llm: null }, db: true });
  });

  it("잘못된 추론 모드면 서버가 뜨지 않는다", async () => {
    await expect(startServer({ env: { HUB: "memory", PORT: "0", AGENT_PROVIDER: "mock", RUNTIME_DIR: mkdtempSync(join(tmpdir(), "rt-")), INFERENCE_MODE: "replay" }, log: () => {} }))
      .rejects.toThrow(/mock 또는 live/);
  });
});
