// 가짜 OpenAI 호환 서버: 정해진 답만 내고 밖으로 나가지 않는다. 자동 시험·CI·키 없는 컨테이너 확인에서 모델 주소 자리에 붙인다.
//   npx tsx scripts/fake-openai.ts --port 8500 [--host 0.0.0.0]    (0이면 빈 포트, 첫 줄 "listening <포트>")
// 답: 장면 스키마(scene_observation) → 감지 번호마다 contents_unknown, PAM 판단(task inference module) → 대기(-1),
//     PAM 반성(procedural memory) → 받은 Current memory 그대로, 에이전트(POST /v1/responses) → respond가 정한 도구 호출·글, 없으면 글 답 「가짜 답」.
//     respond는 Promise도 돌려줄 수 있다(시험에서 답을 붙잡아 두기).
import { createServer } from "node:http";
import { pathToFileURL } from "node:url";
import { listenRetry } from "../src/server/net.js";

export interface FakeRequest { method: string; path: string; body: any }
export interface FakeServer { url: string; requests: FakeRequest[]; close(): Promise<void> }
/** 에이전트(POST /v1/responses) 한 번의 답: 도구 호출(function_call)과 글. */
export interface FakeResponse { text?: string; calls?: { name: string; args: Record<string, unknown> }[] }

const textOf = (content: unknown): string => typeof content === "string" ? content
  : Array.isArray(content) ? content.map((p: { type?: string; text?: string }) => (p.type === "text" ? p.text ?? "" : "")).join("\n") : "";

export function defaultReply(body: any): string {
  const messages: { role: string; content: unknown }[] = Array.isArray(body?.messages) ? body.messages : [];
  const system = messages.filter((m) => m.role === "system").map((m) => textOf(m.content)).join("\n");
  const user = messages.filter((m) => m.role === "user").map((m) => textOf(m.content)).join("\n");
  if (body?.response_format?.json_schema?.name === "scene_observation") {
    const m = /Detections: (\[.*\])/.exec(user);
    const dets: { id: string }[] = m ? JSON.parse(m[1]!) : [];
    return JSON.stringify({ scene: "unknown", observations: dets.map((d) => ({ object_id: d.id, state: "contents_unknown" })), summary: "가짜 장면" });
  }
  if (system.includes("procedural memory")) {
    const m = /Current memory:\n([\s\S]*?)\n\nSummary:/.exec(user);
    if (m) return JSON.stringify(JSON.parse(m[1]!));
  }
  if (system.includes("task inference module")) return JSON.stringify({ observation: "가짜 관찰", reasoning: "가짜 판단", task_index: -1 });
  return JSON.stringify({ ok: true });
}

export async function startFakeOpenAI(o: { port?: number; host?: string; reply?: (body: any) => string | null; respond?: (body: any) => FakeResponse | null | Promise<FakeResponse | null> } = {}): Promise<FakeServer> {
  const requests: FakeRequest[] = [];
  const server = createServer(async (req, res) => {
    const send = (status: number, v: unknown) => { res.writeHead(status, { "content-type": "application/json" }); res.end(JSON.stringify(v)); };
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    const raw = Buffer.concat(chunks).toString("utf8");
    const path = new URL(req.url ?? "/", "http://x").pathname;
    let body: any = null;
    try { body = raw ? JSON.parse(raw) : null; } catch { return send(400, { error: { message: "본문이 JSON이 아닙니다" } }); }
    requests.push({ method: req.method ?? "GET", path, body });
    if (req.method === "GET" && (path === "/v1/models" || path === "/models")) return send(200, { object: "list", data: [{ id: "fake", object: "model" }] });
    if (req.method === "GET" && path === "/health") return send(200, { ok: true });
    if (req.method === "POST" && /\/chat\/completions$/.test(path)) {
      const content = o.reply?.(body) ?? defaultReply(body);
      return send(200, { id: `fake-${requests.length}`, object: "chat.completion", model: body?.model ?? "fake",
        choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop" }],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } });
    }
    if (req.method === "POST" && /\/responses$/.test(path)) {
      const n = requests.length;
      const r = (await o.respond?.(body)) ?? { text: "가짜 답" };
      const text = r.text ?? "";
      const output = [
        ...(r.calls ?? []).map((c, i) => ({ type: "function_call", id: `fc-${n}-${i}`, call_id: `call-${n}-${i}`, name: c.name, arguments: JSON.stringify(c.args), status: "completed" })),
        ...(text ? [{ type: "message", id: `msg-${n}`, role: "assistant", status: "completed", content: [{ type: "output_text", text, annotations: [] }] }] : []),
      ];
      return send(200, { id: `resp-${n}`, object: "response", created_at: 0, status: "completed", model: body?.model ?? "fake",
        output, output_text: text, usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 } });
    }
    send(404, { error: { message: `없는 경로: ${path}` } });
  });
  const host = o.host ?? "127.0.0.1";
  const { port } = await listenRetry(server, o.port ?? 0, host);
  return {
    url: `http://${host === "0.0.0.0" ? "127.0.0.1" : host}:${port}`, requests,
    close: () => new Promise((ok) => { server.closeAllConnections(); server.close(() => ok()); }),
  };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const arg = (k: string) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : undefined; };
  const f = await startFakeOpenAI({ port: Number(arg("--port") ?? 8500), host: arg("--host") ?? "127.0.0.1" });
  console.log(`listening ${new URL(f.url).port}`);
  for (const sig of ["SIGTERM", "SIGINT"] as const) process.once(sig, () => { void f.close().then(() => process.exit(0)); });
}
