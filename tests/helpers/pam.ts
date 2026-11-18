// 시험용 PAM LLM 자리(OpenAI 호환 /v1/chat/completions, GET /v1/models): 서버 안 PamClient(src/brain/pam/)가 보낸 판단·반성 메시지를 되읽어
// 요청 값(관찰 텍스트·기억·행동 목록 등)으로 기록하고, 정해진 답 글을 낸다. 서버에는 PAM_LLM_BASE_URL=url(pamLlmEnv)로 붙인다.
import { createServer, type ServerResponse } from "node:http";
import { adaptedTemplate, CHUNKING_PROMPT, MARKING_PROMPT, MEMORY_CHECK_HEAD, MEMORY_CHECK_PROMPT, NIGHT_HEAD, NONE, PamClient, pamSettings, PREDICT_LOG, PREDICT_STATE, PREDICT_TIME, REFLECT_FEEDBACK, REFLECT_LOG, REFLECT_MEMORY, REFLECT_SUMMARY } from "../../src/brain/pam/index.js";
import { ANY_STATE, AWAY_STATE, CUP_FSM_MEMORY, type FsmMemory } from "../../src/brain/decision.js";
import { listenRetry } from "../../src/shared/net.js";

/** 시험 판단 답: list 기억은 task_index, fsm 기억은 state·from·next_index(pam-predict/3). fsm 요청에 task_index로 내면 fsmAnswer가 화살표로 바꾼다. */
type Pred = { observation: string; reasoning: string; task_index?: number; state?: string; from?: string | null; next_index?: number };
/** 판단 요청 값(메시지에서 되읽음). final_time은 메시지에 쓴 Python isoformat 꼴이다. last_state는 직전 사람 상태(unknown이면 null). */
export type PredictView = { role: "predict"; final_time: string; observation_text: string; memory_kind: "list" | "fsm"; memory: unknown; tasks: string[]; last_state: string | null };
/** 반성 요청 값(메시지에서 되읽음). */
export type ReflectView = { role: "reflect"; memory_kind: "list" | "fsm_candidates"; memory: unknown; observation_text: string; action_summary: string; feedback: string | null };
/** 기억 뜻 검사 요청 값(src/brain/pam/memoryCheck.ts): 검사할 후보 FSM. */
export type CheckView = { role: "check"; memory: { initial_state: string; states: { id: string; [k: string]: unknown }[] }; observation_text?: undefined };
/** 덩어리 기록 요청 값: 그날 기록 줄(`HH:MM:SS | 글`). */
export type ChunkView = { role: "chunk"; lines: string[]; observation_text?: undefined; memory?: undefined };
/** 시각 찾기 요청 값: 상태 줄, 물은 (상태, 후보 글), 행동, 덩어리 줄, 기록 줄. */
export type MarkView = { role: "mark"; states: string[]; candidates: [string, string][]; actions: string[]; chunks: string[]; lines: string[]; observation_text?: undefined; memory?: undefined };
export type PamView = PredictView | ReflectView | CheckView | ChunkView | MarkView;
export interface FakePamLlm {
  /** 서버의 PAM_LLM_BASE_URL(…/v1). */
  url: string;
  /** 받은 판단·반성 요청 값(차례대로). */
  bodies: PamView[];
  /** 받은 갈래(predict·reflect) 차례. */
  calls: PamView["role"][];
  /** 실제로 받은 LLM 요청 본문. */
  requests: Record<string, unknown>[];
  close(): Promise<void>;
}
export interface FakePamLlmOptions {
  /** 판단 답(기본 대기 -1). 문자열이면 답 글 그대로. */
  predict?: (v: PredictView) => Pred | string;
  /** 반성 답(기본은 받은 기억 그대로). 문자열이면 답 글 그대로. */
  reflect?: (v: ReflectView) => unknown;
  /** 기억 뜻 검사 답(기본 통과 { ok: true, items: [] }). 문자열이면 답 글 그대로. */
  check?: (v: CheckView) => unknown;
  /** 덩어리 기록 답(기본 기록 줄마다 한 덩어리). */
  chunk?: (v: ChunkView) => unknown;
  /** 시각 찾기 답(기본 물은 것마다 빈 시각, 안 보인 구간 없음). */
  mark?: (v: MarkView) => unknown;
  /** 갈래별 HTTP 상태(예: { predict: 500 }). */
  status?: Partial<Record<PamView["role"], number>>;
  /** 갈래별 답 사용량(기본 0). */
  usage?: Partial<Record<PamView["role"], { prompt_tokens: number; completion_tokens: number }>>;
}

/** 서버에 넘길 PAM LLM 환경(가짜 서버 주소, 실제 키 대신 가짜 키). */
export const pamLlmEnv = (pam: Pick<FakePamLlm, "url">) => ({ PAM_LLM_BASE_URL: pam.url, PAM_LLM_API_KEY: "fake-key" });

/** 가짜 PAM LLM에 붙은 PamClient(vllm 모드 표, 문맥 길이 등은 env로 바꾼다). */
export const pamClientFor = (pam: Pick<FakePamLlm, "url">, o: { env?: Record<string, string>; timeoutMs?: number; fetchImpl?: typeof fetch } = {}) =>
  new PamClient({ settings: pamSettings({ INFERENCE_MODE: "vllm", ...pamLlmEnv(pam), ...o.env }), timeoutMs: o.timeoutMs, fetchImpl: o.fetchImpl });

const WAIT: Pred = { observation: "o", reasoning: "r", task_index: -1 };
const PLACE = /\{(window|tasks_block|n_tasks_minus_one|rules_block|fsm_block)\}/;

/** 끼워 넣은 프롬프트에서 자리 값을 되읽는다(render의 거꾸로). 맞지 않으면 null. */
function unrender(template: string, text: string): Record<string, string> | null {
  const parts = template.split(new RegExp(PLACE.source, "g"));
  if (!text.startsWith(parts[0]!)) return null;
  let at = parts[0]!.length;
  const out: Record<string, string> = {};
  for (let k = 1; k < parts.length; k += 2) {
    const next = parts[k + 1]!;
    const end = k + 2 >= parts.length ? (text.endsWith(next) ? text.length - next.length : -1) : text.indexOf(next, at);
    if (end < at) return null;
    out[parts[k]!] = text.substring(at, end);
    at = end + next.length;
  }
  return out;
}

/** LLM 요청 본문 → 판단·반성 요청 값. */
export function pamView(body: { messages: { content: string | { text: string }[] }[] }): PamView {
  const system = body.messages[0]!.content as string;
  const parts = (body.messages[1]!.content as { text: string }[]).map((p) => p.text);
  if (system === MEMORY_CHECK_PROMPT) return { role: "check", memory: JSON.parse(parts[0]!.substring(MEMORY_CHECK_HEAD.length)) };
  const list = (text: string, head: string) => { const rest = text.substring(head.length); return rest === NONE ? [] : rest.split("\n"); };
  if (system === CHUNKING_PROMPT) return { role: "chunk", lines: list(parts[0]!, NIGHT_HEAD.record) };
  if (system === MARKING_PROMPT) {
    return {
      role: "mark", states: list(parts[0]!, NIGHT_HEAD.states), candidates: list(parts[1]!, NIGHT_HEAD.candidates).map((l) => { const i = l.indexOf(" | "); return [l.substring(0, i), l.substring(i + 3)] as [string, string]; }),
      actions: list(parts[2]!, NIGHT_HEAD.actions), chunks: list(parts[3]!, NIGHT_HEAD.chunks), lines: list(parts[4]!, NIGHT_HEAD.record),
    };
  }
  for (const kind of ["fsm", "list"] as const) {
    const v = unrender(adaptedTemplate(`predictor_${kind}`), system);
    if (v) {
      const last = parts[0]!.substring(PREDICT_STATE.length);
      return { role: "predict", memory_kind: kind, memory: JSON.parse(v[kind === "fsm" ? "fsm_block" : "rules_block"]!),
        tasks: v.tasks_block!.split("\n").map((l, i) => l.substring(`${i}: `.length)),
        final_time: parts[1]!.substring(PREDICT_TIME.length), observation_text: parts[2]!.substring(PREDICT_LOG.length), last_state: last === "unknown" ? null : last };
    }
    if (system === adaptedTemplate(`reflector_${kind}_update`)) {
      const t = parts[1]!;
      const s = t.indexOf(REFLECT_SUMMARY);
      const rest = t.substring(s + REFLECT_SUMMARY.length);
      const f = rest.indexOf(REFLECT_FEEDBACK);
      // fsm 반성 프롬프트는 후보 FSM 반성(fsm_candidates)이 쓴다
      return { role: "reflect", memory_kind: kind === "fsm" ? "fsm_candidates" : kind, memory: JSON.parse(t.substring(REFLECT_MEMORY.length, s)), observation_text: parts[0]!.substring(REFLECT_LOG.length),
        action_summary: f < 0 ? rest : rest.substring(0, f), feedback: f < 0 ? null : rest.substring(f + REFLECT_FEEDBACK.length) };
    }
  }
  throw new Error("PAM 판단·반성·뜻 검사 메시지가 아닙니다");
}

/** fsm 요청에 행동 번호(task_index)로 낸 시험 답을 pam-predict/3 답(state·from·next_index)으로 바꾼다(시험 도우미만 찾는다):
 *  요청에 실린 기억에서 그 행동의 화살표를 찾는다. 직전 상태(last_state, 없으면 처음 상태)에 있으면 그것, 없으면 그 행동 화살표가 있는 첫 상태. state는 화살표 도착("*"면 away).
 *  대기이거나 기억에 그 행동 화살표가 없으면 화살표 없음(-1, state는 직전 상태, 모르면 처음 상태): seed 기억으로 도는 시험이 몰래 치우지 않는다.
 *  이미 state를 낸 답과 list 요청은 그대로다. */
export function fsmAnswer(v: PredictView, a: Pred): Pred {
  if (v.memory_kind !== "fsm" || a.task_index === undefined || "state" in a) return a;
  const m = v.memory as FsmMemory;
  const { task_index, ...rest } = a;
  const action = task_index >= 0 ? v.tasks[task_index] : undefined;
  const known = v.last_state !== null && m.states.some((x) => x.id === v.last_state) ? v.last_state : m.initial_state;
  const edgeOf = (st: FsmMemory["states"][number]) => st.next.findIndex((e) => action !== undefined && e.action === action);
  const order = [...m.states.filter((x) => x.id === known), ...m.states.filter((x) => x.id !== known)];
  const from = order.find((x) => edgeOf(x) >= 0);
  if (!from) return { ...rest, state: known, from: null, next_index: -1 };
  const i = edgeOf(from);
  const to = from.next[i]!.to;
  return { ...rest, state: to === ANY_STATE ? AWAY_STATE : to, from: from.id, next_index: i };
}

/** 관찰 텍스트 [지속] 물건 줄(면 줄 하나 + 사실마다 한 줄)을 컵마다 한 글로 묶어, 싱크대 안이 아닌 첫 컵의 글(없으면 빈 글). */
function cupFacts(facts: string[]): string {
  const byCup = new Map<string, string[]>();
  for (const l of facts) {
    const id = /^컵 (cup_\d+) /.exec(l)?.[1];
    if (id) byCup.set(id, [...(byCup.get(id) ?? []), l]);
  }
  return [...byCup.values()].map((ls) => ls.join(" / ")).find((t) => !t.includes("싱크대 안")) ?? "";
}

/** 컵 갈래 시험의 PAM 답(시험 대역): 관찰 텍스트의 [지속] 사실로 고르고, 요청의 tasks에서 이름으로 번호를 찾는다(목록에 없으면 대기 -1).
 *  사람 안 보임 + 손에 없는 컵 → 컵 치우기(seed 습관: 컵을 두고 떠나면 내용물과 상관없이 치움),
 *  사람 먹는 중 + 비어 있음 → 컵에 물 채워 주기, 사람 TV 보는 중 + 비어 있음 → 컵에 콜라 따라 주기, 그 밖 → 대기. */
export function cupBranchPredict(body: Record<string, unknown>): Pred {
  const tasks = body.tasks as string[];
  const facts = String(body.observation_text).split("\n").filter((l) => l.startsWith("[지속] ")).map((l) => l.slice(5));
  const cup = cupFacts(facts);
  const has = (head: string) => facts.some((l) => l.startsWith(head));
  const pick = (action: string, observation: string, reasoning: string): Pred => ({ observation, reasoning, task_index: tasks.indexOf(action) });
  const wait: Pred = { observation: "할 일이 보이지 않음", reasoning: "맞는 규칙이 없어 기다린다", task_index: -1 };
  if (!cup) return wait;
  const empty = cup.includes("비어 있음");
  if (has("사람 안 보임")) {
    if (!cup.includes("손에 있음")) return pick("컵 치우기", "사람이 컵을 두고 자리를 비움", "컵을 두고 떠나면 치우는 습관대로 치운다");
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
 *  사람 안 보임 + 손에 없는 컵 → 기억의 마시는 중에서 떠나는 화살표 행동(배우기 전 묻기, 배운 뒤 컵 치우기), 들은 말 「아 덥다」 → 에어컨 켜기,
 *  기억의 자리에 없음 → TV 보는 중 화살표에 에어컨 켜기가 있고(배운 말없는 에어컨) 사람이 TV 보는 중 → 에어컨 켜기, 들은 말 「이거 어떻게…」 + 전자레인지 보임 → 전자레인지로 데우기 알려 주기,
 *  들은 말에 「라면」 → 라면 끓이기 알려 주기, 그 밖 → 대기(-1). 답 글에는 들은 말을 옮기지 않는다. */
export function demoPredict(body: Record<string, unknown>): Pred {
  const tasks = body.tasks as string[];
  const text = String(body.observation_text);
  const facts = text.split("\n").filter((l) => l.startsWith("[지속] ")).map((l) => l.slice(5));
  const said = (re: RegExp) => [...text.matchAll(/사람이 말함: 「([^」]*)」/g)].some((m) => re.test(m[1]!));
  const has = (head: string) => facts.some((l) => l.startsWith(head));
  const pick = (action: string, observation: string, reasoning: string): Pred => ({ observation, reasoning, task_index: tasks.indexOf(action) });
  const states = ((body.memory as { states?: unknown } | undefined)?.states ?? []) as { id: string; next?: { to: string; on: string; action?: string }[] }[];
  const next = (id: string) => (Array.isArray(states) ? states.find((s) => s.id === id)?.next ?? [] : []);
  const habit = next("away").some((e) => e.to === DEMO_AIRCON_RULE.to && e.on === DEMO_AIRCON_RULE.on && e.action === DEMO_AIRCON_RULE.action);
  const leave = next("drinking").find((e) => e.to === ANY_STATE && e.action)?.action ?? "컵 치우기";
  if (said(/아 덥다/)) return pick("에어컨 켜기", "사용자가 덥다고 말함", "더워해서 에어컨을 켠다");
  if (said(/이거 어떻게/) && /전자레인지/.test(text)) return pick("전자레인지로 데우기 알려 주기", "전자레인지 앞에서 쓰는 법을 물음", "방법을 물어서 단계마다 알려 준다");
  if (said(/라면/)) return pick("라면 끓이기 알려 주기", "사용자가 요리 방법을 물음", "방법을 물어서 단계마다 알려 준다");
  if (habit && has("사람 TV 보는 중")) return pick("에어컨 켜기", "사용자가 소파에서 TV를 봄", "배운 습관대로 에어컨을 켠다");
  const cup = cupFacts(facts);
  if (cup && has("사람 안 보임") && !cup.includes("손에 있음")) return pick(leave, "사람이 컵을 두고 자리를 비움", "마시는 중에서 떠나는 화살표대로 한다");
  return { observation: "할 일이 보이지 않음", reasoning: "맞는 규칙이 없어 기다린다", task_index: -1 };
}

/** 말없는 에어컨 화살표(반성 후보, 채택 검사를 지나면 자리에 없음 상태에 붙는다): seed 진입 화살표 「사용자가 돌아와 TV를 본다.」에 에어컨 켜기.
 *  라면 습관 후보(코치 행동이라 반성 뒤 검사가 뺀다). */
export const DEMO_AIRCON_RULE = { to: "watching_tv", on: CUP_FSM_MEMORY.states.find((s) => s.id === "away")!.next.find((e) => e.to === "watching_tv")!.on, action: "에어컨 켜기" };
export const DEMO_RAMEN_HABIT = { on: "저녁 7시에 사용자가 식탁에 앉는다.", action: "라면 끓이기 알려 주기" };
const DEMO_LEAVE_ON = CUP_FSM_MEMORY.states.find((s) => s.id === "drinking")!.next.find((e) => e.to === ANY_STATE)!.on;

/** 시연 반성 답(시험 대역, 후보 FSM 종류): 받은 후보 FSM에 마시는 중 → * 컵 치우기 후보, 자리에 없음 → TV 보는 중 에어컨 켜기 후보,
 *  마시는 중 → 요리하는 중 라면 습관 후보를 더한다(이미 있으면 그대로). 반성 뒤 검사(settingsGuard)가 라면 습관을 빼고, 채택 검사가 나머지를 정한다. */
export function demoReflect(body: Record<string, unknown>): unknown {
  const memory = structuredClone(body.memory) as { states: { id: string; next: { to: string; on: string }[]; rules: { to: string; action: string; candidates: { on: string; when?: string }[] }[] }[] };
  // 같은 사건은 한 상태에 한 번: 후보가 행동 없는 화살표 자리를 맡는다(seed 화살표는 로봇 FSM이 그대로 둔다)
  const add = (id: string, rule: { to: string; action: string; on: string }) => {
    const s = memory.states.find((x) => x.id === id);
    if (!s) return;
    s.next = s.next.filter((e) => e.on !== rule.on);
    const same = s.rules.find((r) => r.action === rule.action);
    if (!same) s.rules.push({ to: rule.to, action: rule.action, candidates: [{ on: rule.on }] });
    else if (!same.candidates.some((c) => c.on === rule.on)) same.candidates.push({ on: rule.on });
  };
  add("drinking", { to: ANY_STATE, action: "컵 치우기", on: DEMO_LEAVE_ON });
  add("away", DEMO_AIRCON_RULE);
  add("drinking", { to: "cooking", ...DEMO_RAMEN_HABIT });
  return memory;
}

const fsmAnswerOf = (v: PredictView, a: Pred | string): Pred | string => (typeof a === "string" ? a : fsmAnswer(v, a));
/** 기본 덩어리: 기록 줄마다 한 덩어리(같은 시각 줄은 하나로). */
const everyLine = (v: ChunkView) => ({ chunks: [...new Map(v.lines.map((l) => [l.substring(0, 8), l])).values()].map((l) => ({ start: l.substring(0, 8), end: l.substring(0, 8), text: l.substring(11) })) });
/** 기본 시각 찾기: 물은 것마다 빈 시각, 안 보인 구간 없음. */
const nothingFound = (v: MarkView) => ({ candidates: v.candidates.map(([state, candidate]) => ({ state, candidate, times: [] })), actions: v.actions.map((action) => ({ action, times: [] })), unseen: [] });

const usageOf = (u?: { prompt_tokens: number; completion_tokens: number }) =>
  ({ prompt_tokens: u?.prompt_tokens ?? 0, completion_tokens: u?.completion_tokens ?? 0, total_tokens: (u?.prompt_tokens ?? 0) + (u?.completion_tokens ?? 0) });

export async function startFakePamLlm(o: FakePamLlmOptions = {}): Promise<FakePamLlm> {
  const bodies: PamView[] = [];
  const calls: PamView["role"][] = [];
  const requests: Record<string, unknown>[] = [];
  const send = (res: ServerResponse, status: number, b: unknown) => {
    res.writeHead(status, { "content-type": "application/json" });
    res.end(JSON.stringify(b));
  };
  const server = createServer(async (req, res) => {
    if (req.method === "GET" && req.url === "/v1/models") return send(res, 200, { object: "list", data: [] });
    // 조각을 모아 한 번에 읽는다(조각마다 글로 바꾸면 조각 끝에 걸린 한글이 깨져 관찰 텍스트가 달라진다)
    const parts: Buffer[] = [];
    for await (const c of req) parts.push(c as Buffer);
    const raw = Buffer.concat(parts).toString("utf8");
    const body = JSON.parse(raw) as Record<string, unknown> & { messages: { content: string | { text: string }[] }[]; model: string };
    requests.push(body);
    const v = pamView(body);
    bodies.push(v);
    calls.push(v.role);
    const status = o.status?.[v.role];
    if (status && status !== 200) return send(res, status, { error: { message: "시험 오류" } });
    const answer = v.role === "predict" ? fsmAnswerOf(v, o.predict?.(v) ?? WAIT) : v.role === "check" ? (o.check?.(v) ?? { ok: true, items: [] })
      : v.role === "chunk" ? (o.chunk?.(v) ?? everyLine(v)) : v.role === "mark" ? (o.mark?.(v) ?? nothingFound(v)) : (o.reflect?.(v) ?? v.memory);
    const content = typeof answer === "string" ? answer : JSON.stringify(answer);
    send(res, 200, { id: "fake", object: "chat.completion", created: 0, model: body.model,
      choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop" }], usage: usageOf(o.usage?.[v.role]) });
  });
  const { port } = await listenRetry(server, 0, "127.0.0.1");
  return {
    url: `http://127.0.0.1:${port}/v1`, bodies, calls, requests,
    close: () => new Promise((ok) => { server.closeAllConnections(); server.close(() => ok()); }),
  };
}
