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

/** 컵 갈래 시험의 PAM 답(시험 대역): 관찰 텍스트의 [지속] 사실로 고르고, 요청의 tasks에서 이름으로 번호를 찾는다(목록에 없으면 대기 -1).
 *  사람 안 보임 + 컵 비어 있음 → 컵 치우기, + 내용물 있음 → 컵 그대로 두기, + 안이 안 보임 → 사용자에게 물어보기,
 *  사람 먹는 중 + 비어 있음 → 컵에 물 채워 주기, 사람 TV 보는 중 + 비어 있음 → 컵에 콜라 따라 주기, 그 밖 → 대기. */
export function cupBranchPredict(body: Record<string, unknown>): Pred {
  const tasks = body.tasks as string[];
  const facts = String(body.observation_text).split("\n").filter((l) => l.startsWith("[지속] ")).map((l) => l.slice(5));
  const cup = facts.find((l) => /^컵 cup_\d+ /.test(l) && !l.includes("싱크대 안")) ?? "";
  const has = (head: string) => facts.some((l) => l.startsWith(head));
  const pick = (action: string, observation: string, reasoning: string): Pred => ({ observation, reasoning, task_index: tasks.indexOf(action) });
  const wait: Pred = { observation: "할 일이 보이지 않음", reasoning: "맞는 규칙이 없어 기다린다", task_index: -1 };
  if (!cup) return wait;
  const empty = cup.includes("비어 있음");
  if (has("사람 안 보임")) {
    if (empty) return pick("컵 치우기", "사람이 자리를 비웠고 컵이 비어 있음", "자리를 비워 빈 컵을 치운다");
    if (cup.includes("내용물 있음")) return pick("컵 그대로 두기", "사람이 자리를 비웠고 컵에 음료가 남음", "음료가 남아 그대로 둔다");
    if (cup.includes("안이 안 보임")) return pick("사용자에게 물어보기", "사람이 자리를 비웠고 컵 안이 안 보임", "컵 안을 몰라 묻는다");
    return wait;
  }
  if (empty && has("사람 먹는 중")) return pick("컵에 물 채워 주기", "사람이 먹는 중이고 컵이 비어 있음", "식사 중 빈 컵이라 물을 채워 준다");
  if (empty && has("사람 TV 보는 중")) return pick("컵에 콜라 따라 주기", "사람이 TV를 보는 중이고 컵이 비어 있음", "TV를 보는 중 빈 컵이라 콜라를 따라 준다");
  return wait;
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
