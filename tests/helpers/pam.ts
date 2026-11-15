// 시험용 PAM 서비스 자리: pam-predict/2·pam-reflect/2를 받아 본문을 기록하고 정해진 답을 낸다. /health는 입력 한도를 알린다.
import { createServer } from "node:http";
import { listenRetry } from "../../src/server/net.js";

export interface FakePam { url: string; bodies: Record<string, unknown>[]; paths: string[]; close(): Promise<void> }
type Pred = { observation: string; reasoning: string; task_index: number };
export interface FakePamOptions {
  /** 판단 답(기본 대기 -1). 문자열이면 원문(raw_response)으로 그대로 쓴다. */
  predict?: (body: Record<string, unknown>) => Pred | string;
  /** 반성 답(기본은 받은 기억 그대로). */
  reflect?: (body: Record<string, unknown>) => unknown;
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

/** 코치 흐름 시험의 PAM 답(시험 대역): 관찰 텍스트에 「사람이 말함: 「…라면…」」 줄이 있으면 요청 tasks에서 「라면 끓이기 알려 주기」 번호(목록에 없으면 대기 -1), 아니면 대기.
 *  답 글에는 들은 말을 옮기지 않는다. */
export function coachPredict(body: Record<string, unknown>): Pred {
  const tasks = body.tasks as string[];
  const asked = /사람이 말함: 「[^」]*라면[^」]*」/.test(String(body.observation_text));
  const index = asked ? tasks.indexOf("라면 끓이기 알려 주기") : -1;
  return index >= 0 ? { observation: "사용자가 요리 방법을 물음", reasoning: "방법을 물어서 단계마다 알려 준다", task_index: index }
    : { observation: "할 일이 보이지 않음", reasoning: "맞는 규칙이 없어 기다린다", task_index: -1 };
}

/** 시연 네 장면 시험의 PAM 답(시험 대역, tests/demo-e2e.test.ts): 관찰 텍스트의 들은 말·[지속] 사실과 받은 기억으로 고르고, 번호는 요청 tasks에서 이름으로 찾는다.
 *  사람 안 보임 + 빈 컵 → 컵 치우기, 사람 안 보임 + 내용물 → 컵 그대로 두기, 들은 말 「아 덥다」 → 에어컨 켜기,
 *  기억에 「소파에 앉아 TV를 보기 시작」 에어컨 규칙이 있고 사람이 TV 보는 중 → 에어컨 켜기, 들은 말 「이거 어떻게…」 + 전자레인지 보임 → 전자레인지로 데우기 알려 주기,
 *  들은 말에 「라면」 → 라면 끓이기 알려 주기, 그 밖 → 대기(-1). 답 글에는 들은 말을 옮기지 않는다. */
export function demoPredict(body: Record<string, unknown>): Pred {
  const tasks = body.tasks as string[];
  const text = String(body.observation_text);
  const facts = text.split("\n").filter((l) => l.startsWith("[지속] ")).map((l) => l.slice(5));
  const said = (re: RegExp) => [...text.matchAll(/사람이 말함: 「([^」]*)」/g)].some((m) => re.test(m[1]!));
  const has = (head: string) => facts.some((l) => l.startsWith(head));
  const pick = (action: string, observation: string, reasoning: string): Pred => ({ observation, reasoning, task_index: tasks.indexOf(action) });
  const memory = body.memory as { states?: { rules: { trigger: string; action: string }[] }[] } | undefined;
  const habit = (memory?.states ?? []).some((s) => s.rules.some((r) => r.action === "에어컨 켜기" && r.trigger.includes("소파에 앉아 TV를 보기 시작")));
  if (said(/아 덥다/)) return pick("에어컨 켜기", "사용자가 덥다고 말함", "더워해서 에어컨을 켠다");
  if (said(/이거 어떻게/) && /전자레인지/.test(text)) return pick("전자레인지로 데우기 알려 주기", "전자레인지 앞에서 쓰는 법을 물음", "방법을 물어서 단계마다 알려 준다");
  if (said(/라면/)) return pick("라면 끓이기 알려 주기", "사용자가 요리 방법을 물음", "방법을 물어서 단계마다 알려 준다");
  if (habit && has("사람 TV 보는 중")) return pick("에어컨 켜기", "사용자가 소파에서 TV를 봄", "배운 습관대로 에어컨을 켠다");
  const cup = facts.find((l) => /^컵 cup_\d+ /.test(l) && !l.includes("싱크대 안")) ?? "";
  if (cup && has("사람 안 보임")) {
    if (cup.includes("비어 있음")) return pick("컵 치우기", "사람이 자리를 비웠고 컵이 비어 있음", "자리를 비워 빈 컵을 치운다");
    if (cup.includes("내용물 있음")) return pick("컵 그대로 두기", "사람이 자리를 비웠고 컵에 음료가 남음", "음료가 남아 그대로 둔다");
  }
  return { observation: "할 일이 보이지 않음", reasoning: "맞는 규칙이 없어 기다린다", task_index: -1 };
}

/** 에어컨 습관 규칙(반성이 배우는 것)과 라면 습관 규칙(코치 행동이라 반성 뒤 검사가 빼는 것). */
export const DEMO_AIRCON_RULE = { trigger: "사용자가 소파에 앉아 TV를 보기 시작한다.", action: "에어컨 켜기" };
export const DEMO_RAMEN_HABIT = { trigger: "저녁 7시에 사용자가 식탁에 앉는다.", action: "라면 끓이기 알려 주기" };

/** 시연 반성 답(시험 대역): 받은 기억의 watching_tv에 에어컨 습관 규칙을, drinking에 라면 습관 규칙을 더하고(이미 있으면 그대로),
 *  seed 요리 규칙 트리거에 덧붙임을 단 기억을 돌려준다. 반성 뒤 검사(coachGuard)가 라면 습관을 빼고 요리 규칙 글을 seed로 되돌린다. */
export function demoReflect(body: Record<string, unknown>): unknown {
  const memory = structuredClone(body.memory) as { states: { id: string; rules: { trigger: string; action: string }[] }[] };
  const state = (id: string) => memory.states.find((s) => s.id === id);
  const add = (id: string, rule: { trigger: string; action: string }) => {
    const s = state(id);
    if (s && !s.rules.some((r) => r.trigger === rule.trigger && r.action === rule.action)) s.rules.push({ ...rule });
  };
  add("watching_tv", DEMO_AIRCON_RULE);
  add("drinking", DEMO_RAMEN_HABIT);
  const cook = state("cooking")?.rules.find((r) => r.action === "라면 끓이기 알려 주기");
  if (cook && !cook.trigger.includes("라면 봉지")) cook.trigger = `${cook.trigger.replace(/\.$/, "")} 또는 라면 봉지를 든다.`;
  return memory;
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
    if (path === "/reflect") {
      const memory = o.reflect?.(body) ?? body.memory;
      return send(200, { status: "valid", raw_response: JSON.stringify(memory), memory, errors: [] });
    }
    send(404, { error: "없는 경로" });
  });
  const { port } = await listenRetry(server, 0, "127.0.0.1");
  return {
    url: `http://127.0.0.1:${port}`, bodies, paths,
    close: () => new Promise((ok) => { server.closeAllConnections(); server.close(() => ok()); }),
  };
}
