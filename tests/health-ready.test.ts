// 준비 상태(/api/health ready): 추론 모드, VLM·PAM LLM 주소 응답, 에이전트 키와 주소 응답, 기록 DB.
// 모델 주소는 이 시험이 띄운 로컬 가짜 서버나 닿지 않는 로컬 주소다.
import { createServer, type Server } from "node:http";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { HealthView } from "../src/contract/events.js";
import { fetchRetry, listenRetry } from "../src/shared/net.js";
import { startServer, type RunningServer } from "../src/server/start.js";
import { HistoryDb } from "../src/brain/history/db.js";
import { loadEndpoints } from "../src/infer/endpoints.js";
import { makeReady } from "../src/server/ready.js";

let srv: RunningServer | undefined;
let stub: Server | undefined;
afterEach(async () => { await srv?.close(); stub?.close(); srv = stub = undefined; });

async function startStub(): Promise<string> {
  stub = createServer((req, res) => {
    if (req.url === "/v1/models") { res.writeHead(200, { "content-type": "application/json" }); res.end('{"data":[]}'); return; }
    res.writeHead(404); res.end();
  });
  const { port } = await listenRetry(stub, 0, "127.0.0.1");
  return `http://127.0.0.1:${port}`;
}

describe("준비 상태", () => {
  it("추론 모드·모델 주소 응답·PAM LLM·기록 DB를 보인다", async () => {
    const base = await startStub();
    const runtime = mkdtempSync(join(tmpdir(), "rt-"));
    srv = await startServer({ env: {
      HUB: "memory", PORT: "0", RUNTIME_DIR: runtime,
      INFERENCE_MODE: "vllm", VLM_BASE_URL: `${base}/v1`, PAM_LLM_BASE_URL: `${base}/v1`, PAM_LLM_MODEL: "q", OPENAI_API_KEY: "fake-key", OPENAI_BASE_URL: `${base}/v1`,
    }, log: () => {} });
    const h = (await (await fetchRetry(`${srv.url}/api/health`)).json()) as HealthView;
    expect(h.ok).toBe(true);
    expect(h.ready).toMatchObject({ ok: true, inference_mode: "vllm", db: true,
      vlm: { base_url: `${base}/v1`, model: "vlm", key: false, reachable: true },
      pam: { base_url: `${base}/v1`, model: "q", key: false, reachable: true },
      agent: { provider: "openai", base_url: `${base}/v1`, model: "gpt-5.5", key: true, reachable: true } });
    expect(existsSync(join(runtime, "noonchi.db"))).toBe(true);
    expect(JSON.stringify(h)).not.toContain("fake-key");
  });

  it("에이전트 키가 없거나 주소가 답하지 않으면 다른 공급자로 바꾸지 않고 ready.agent가 준비 안 됨이다", async () => {
    const base = await startStub();
    const env = { HUB: "memory", PORT: "0", INFERENCE_MODE: "vllm", VLM_BASE_URL: `${base}/v1`, PAM_LLM_BASE_URL: `${base}/v1` };
    const logs: string[] = [];
    srv = await startServer({ env: { ...env, RUNTIME_DIR: mkdtempSync(join(tmpdir(), "rt-")), OPENAI_BASE_URL: `${base}/v1` }, log: (l) => logs.push(l) });
    let h = (await (await fetchRetry(`${srv.url}/api/health`)).json()) as HealthView;
    expect(h.provider).toBe("openai");
    expect(h.ready).toMatchObject({ ok: false, vlm: { reachable: true }, pam: { reachable: true }, agent: { provider: "openai", key: false } });
    expect(logs.join("\n")).toMatch(/\[경고\].*OPENAI_API_KEY/);
    await srv.close();
    srv = await startServer({ env: { ...env, RUNTIME_DIR: mkdtempSync(join(tmpdir(), "rt-")), OPENAI_API_KEY: "fake-key", OPENAI_BASE_URL: "http://127.0.0.1:9/v1" }, log: () => {} });
    h = (await (await fetchRetry(`${srv.url}/api/health`)).json()) as HealthView;
    expect(h.ready).toMatchObject({ ok: false, agent: { provider: "openai", base_url: "http://127.0.0.1:9/v1", key: true, reachable: false } });
  });

  it("모델 주소가 답하지 않아도 health는 200이고 ready.ok가 false다", async () => {
    srv = await startServer({ env: { HUB: "memory", PORT: "0", RUNTIME_DIR: mkdtempSync(join(tmpdir(), "rt-")),
      VLM_BASE_URL: "http://127.0.0.1:9/v1", PAM_LLM_BASE_URL: "http://127.0.0.1:9/v1", OPENAI_BASE_URL: "http://127.0.0.1:9/v1" }, log: () => {} });
    const r = await fetchRetry(`${srv.url}/api/health`);
    expect(r.status).toBe(200);
    expect(((await r.json()) as HealthView).ready).toMatchObject({ ok: false, inference_mode: "openai", vlm: { reachable: false }, pam: { reachable: false }, agent: { reachable: false }, db: true });
  });

  it("PAM 설정이 틀리면 잠금·DB를 열기 전에 시작을 막아, 같은 폴더로 바로 다시 띄울 수 있다", async () => {
    const runtime = mkdtempSync(join(tmpdir(), "rt-"));
    const base = { HUB: "memory", PORT: "0", RUNTIME_DIR: runtime, VLM_BASE_URL: "http://127.0.0.1:9/v1", PAM_LLM_BASE_URL: "http://127.0.0.1:9/v1", OPENAI_BASE_URL: "http://127.0.0.1:9/v1" };
    for (const bad of [{ PAM_MAX_MODEL_LEN: "16384" }, { PAM_LLM_TIMEOUT_S: "0" }]) {
      await expect(startServer({ env: { ...base, ...bad }, log: () => {} })).rejects.toThrow(/PAM_MAX_MODEL_LEN|PAM_LLM_TIMEOUT_S/);
      expect(existsSync(join(runtime, "noonchi.db")), JSON.stringify(bad)).toBe(false);
    }
    srv = await startServer({ env: base, log: () => {} });
    expect(srv.url).toMatch(/^http:/);
  });

  it("옛 이름 INFERENCE_MODE=mock이면 openai로 띄우고 시작 로그에 경고 한 줄을 남긴다", async () => {
    const lines: string[] = [];
    srv = await startServer({ env: { HUB: "memory", PORT: "0", RUNTIME_DIR: mkdtempSync(join(tmpdir(), "rt-")), INFERENCE_MODE: "mock",
      VLM_BASE_URL: "http://127.0.0.1:9/v1", PAM_LLM_BASE_URL: "http://127.0.0.1:9/v1", OPENAI_BASE_URL: "http://127.0.0.1:9/v1" }, log: (l) => lines.push(l) });
    expect(lines.filter((l) => l.includes("INFERENCE_MODE"))).toEqual(["[경고] INFERENCE_MODE=mock은 openai로 읽어요"]);
    const r = await fetchRetry(`${srv.url}/api/health`);
    expect(((await r.json()) as HealthView).ready).toMatchObject({ inference_mode: "openai" });
  });

  it("PAM_LLM_BASE_URL이 OpenRouter 주소면 PAM 주소를 부르지 않고 준비 안 됨이며 그 까닭을 싣는다", async () => {
    const endpoints = loadEndpoints({ PAM_LLM_BASE_URL: "https://openrouter.ai/api/v1", VLM_BASE_URL: "http://127.0.0.1:9/v1" });
    const asked: string[] = [];
    const fetchImpl = (async (url: string) => { asked.push(String(url)); return new Response("{}", { status: 200 }); }) as unknown as typeof fetch;
    const db = HistoryDb.open(":memory:");
    const ready = await makeReady({ endpoints, agent: { provider: "openai", baseUrl: "http://127.0.0.1:9/v1", model: "m", apiKey: "k" } as never, db, fetchImpl })();
    expect(ready.ok).toBe(false);
    expect(ready.pam).toMatchObject({ reachable: false, reason: "OpenRouter는 더 쓰지 않아요, PAM_LLM_BASE_URL을 지우세요" });
    expect(asked.some((u) => u.includes("openrouter"))).toBe(false);
  });

  it("잘못된 추론 모드면 서버가 뜨지 않는다", async () => {
    await expect(startServer({ env: { HUB: "memory", PORT: "0", RUNTIME_DIR: mkdtempSync(join(tmpdir(), "rt-")), INFERENCE_MODE: "replay" }, log: () => {} }))
      .rejects.toThrow(/openai 또는 vllm/);
  });
});
