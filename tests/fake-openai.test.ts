// 가짜 OpenAI 호환 서버: 정해진 답만 내고, 받은 요청을 기록한다. 실제 API를 부르지 않는다.
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { startFakeOpenAI, type FakeServer } from "../scripts/fake-openai.js";
import { fetchRetry } from "../src/server/net.js";

const ROOT = fileURLToPath(new URL("..", import.meta.url));

let f: FakeServer | undefined;
afterEach(async () => { await f?.close(); f = undefined; });
const post = (path: string, body: unknown) =>
  fetchRetry(`${f!.url}${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }).then((r) => r.json() as Promise<any>);
const chat = (body: unknown) => post("/v1/chat/completions", body);

describe("가짜 OpenAI 호환 서버", () => {
  it("장면 스키마면 감지 번호마다 관찰을 낸다", async () => {
    f = await startFakeOpenAI();
    const r = await chat({ model: "m", response_format: { type: "json_schema", json_schema: { name: "scene_observation", schema: {} } },
      messages: [{ role: "user", content: [{ type: "text", text: 'Detections: [{"id":"d1","class":"cup","box":[1,2,3,4]}]' }] }] });
    expect(JSON.parse(r.choices[0].message.content)).toEqual({ scene: "unknown", observations: [{ object_id: "d1", state: "contents_unknown" }], summary: "가짜 장면" });
  });

  it("PAM 판단이면 대기, 반성이면 받은 기억을 그대로 낸다", async () => {
    f = await startFakeOpenAI();
    const p = await chat({ model: "q", messages: [{ role: "system", content: "You are a task inference module ..." }, { role: "user", content: "x" }] });
    expect(JSON.parse(p.choices[0].message.content).task_index).toBe(-1);
    expect(p.choices[0].finish_reason).toBe("stop");
    const mem = { initial_state: "a", states: [{ id: "a", description: "d", rules: [], next: [] }] };
    const r = await chat({ model: "q", messages: [{ role: "system", content: "You are observing a person's daily activities to build a procedural memory" },
      { role: "user", content: [{ type: "text", text: `Current memory:\n${JSON.stringify(mem, null, 2)}\n\nSummary:\ns` }] }] });
    expect(JSON.parse(r.choices[0].message.content)).toEqual(mem);
  });

  it("요청을 기록하고 /v1/models·/health에 답한다", async () => {
    f = await startFakeOpenAI({ reply: () => '{"ok":1}' });
    expect((await fetchRetry(`${f.url}/v1/models`)).ok).toBe(true);
    expect((await fetchRetry(`${f.url}/health`)).ok).toBe(true);
    const r = await chat({ model: "m", messages: [] });
    expect(r.choices[0].message.content).toBe('{"ok":1}');
    expect(f.requests.at(-1)).toMatchObject({ method: "POST", path: "/v1/chat/completions", body: { model: "m" } });
  });

  it("에이전트(OpenAI Responses API)에 도구 호출 없는 글 답을 낸다", async () => {
    f = await startFakeOpenAI();
    const r = await post("/v1/responses", { model: "m", input: [{ role: "user", content: "안녕" }] });
    expect(r).toMatchObject({ object: "response", status: "completed", output_text: "가짜 답" });
    expect(r.output[0]).toMatchObject({ type: "message", role: "assistant", content: [{ type: "output_text", text: "가짜 답" }] });
  });

  it("명령으로 띄우면 첫 줄에 포트를 찍고 그 포트에서 답한다", async () => {
    const child = spawn(process.execPath, ["--import", "tsx", "scripts/fake-openai.ts", "--port", "0"], { cwd: ROOT, stdio: ["ignore", "pipe", "inherit"] });
    try {
      const line = await new Promise<string>((ok, no) => {
        let out = "";
        child.stdout!.on("data", (c: Buffer) => { out += c.toString("utf8"); if (out.includes("\n")) ok(out.split("\n")[0]!.trim()); });
        child.once("exit", (code) => no(new Error(`끝남 ${code}`)));
      });
      expect(line).toMatch(/^listening \d+$/);
      expect((await fetchRetry(`http://127.0.0.1:${line.split(" ")[1]}/v1/models`)).ok).toBe(true);
    } finally {
      child.kill();
    }
  });
});
