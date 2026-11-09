// 시험용 PAM 서비스 자리: pam-predict/2·pam-reflect/2를 받아 본문을 기록하고 정해진 답을 낸다. /health는 입력 한도를 알린다.
import { createServer } from "node:http";
import { listenRetry } from "../../src/server/net.js";

export interface FakePam { url: string; bodies: Record<string, unknown>[]; paths: string[]; close(): Promise<void> }
type Pred = { observation: string; reasoning: string; task_index: number };
export interface FakePamOptions {
  /** 판단 답(기본 대기 -1). 문자열이면 원문(raw_response)으로 그대로 쓴다. */
  predict?: (body: Record<string, unknown>) => Pred | string;
  /** 경로별로 HTTP 상태를 바꾼다(예: { "/predict": 500 }). */
  status?: Record<string, number>;
  limits?: Record<string, number> | null;
}

export async function startFakePam(o: FakePamOptions = {}): Promise<FakePam> {
  const bodies: Record<string, unknown>[] = [];
  const paths: string[] = [];
  const server = createServer(async (req, res) => {
    let raw = "";
    for await (const c of req) raw += c;
    const path = new URL(req.url ?? "/", "http://x").pathname;
    paths.push(`${req.method} ${path}`);
    const send = (status: number, v: unknown) => { res.writeHead(status, { "content-type": "application/json" }); res.end(JSON.stringify(v)); };
    if (o.status?.[path]) return send(o.status[path]!, { error: "시험 오류" });
    if (req.method === "GET" && path === "/health") {
      return send(200, { ok: true, llm: { base_url: "http://fake/v1", model: "q", reachable: true },
        ...(o.limits === null ? {} : { limits: o.limits ?? { max_model_len: 32768, predict_input_bytes: 80_000, reflect_input_bytes: 40_000 } }) });
    }
    const body = JSON.parse(raw) as Record<string, unknown>;
    bodies.push(body);
    if (path === "/predict") {
      const answer = o.predict?.(body) ?? { observation: "o", reasoning: "r", task_index: -1 };
      const rawResponse = typeof answer === "string" ? answer : JSON.stringify(answer);
      let pred: Pred | null = null;
      try { pred = JSON.parse(rawResponse) as Pred; } catch { /* 원문이 JSON이 아님 */ }
      const tasks = body.tasks as string[];
      if (!pred || typeof pred.task_index !== "number") return send(200, { status: "invalid", raw_response: rawResponse, prediction: null, selected_action: null, errors: ["bad"] });
      return send(200, { status: "valid", raw_response: rawResponse, prediction: pred, selected_action: pred.task_index === -1 ? null : tasks[pred.task_index], errors: [] });
    }
    if (path === "/reflect") return send(200, { status: "valid", raw_response: JSON.stringify(body.memory), memory: body.memory, errors: [] });
    send(404, { error: "없는 경로" });
  });
  const { port } = await listenRetry(server, 0, "127.0.0.1");
  return {
    url: `http://127.0.0.1:${port}`, bodies, paths,
    close: () => new Promise((ok) => { server.closeAllConnections(); server.close(() => ok()); }),
  };
}
