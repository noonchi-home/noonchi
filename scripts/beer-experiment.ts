// 시연 2번 간추린 실험 실행(2026-11-22): 합성 기록 21일을 기록 DB에 쓰고 밤마다 반성·채택 검사(runNight)를 돌려, 맥락 규칙이 몇째 밤에 처음 생기는지 본다.
//   npx tsx scripts/beer-experiment.ts --fake                         가짜 AI가 정답처럼 답한다(돈 0). 호출 종류별 요청 크기(입력량)를 잰다.
//   npx tsx scripts/beer-experiment.ts --real --out <폴더> [--openrouter] [--max-usd 5] [--nights 21] [--only 날짜,날짜,...]
//        실제 AI로 돌린다(돈 든다). 기본은 OpenAI gpt-5.4-mini(환경변수 OPENAI_API_KEY). --openrouter면 OpenRouter의 qwen/qwen3.5-27b(환경변수 OPENROUTER_API_KEY, 가격 순 제공자).
//        --only: 이 날짜의 밤만 돌린다(나머지 날의 기록은 그대로 있어서 뒤 밤이 덩어리·시각 찾기를 대신 처리한다). 건너뛴 밤은 반성·뜻 검사를 하지 않을 뿐이다.
//        열쇠는 환경변수에서만 읽고 출력하지 않는다.
//        기록 DB를 <폴더>/noonchi.db에 두고 이미 끝난 밤은 건너뛴다(끊겨도 같은 호출을 되풀이하지 않는다). 밤마다 결과를 <폴더>/nights.jsonl에 한 줄씩 쓴다.
//        누적 비용이 --max-usd(기본 5달러)를 넘으면 그 밤 뒤에 멈춘다.
// 비용 어림(100만 토큰당): gpt-5.4-mini 기본 요금(공식 모델 페이지, 2026-11-22) 입력 $0.75·캐시 입력 $0.075·출력 $4.50. OpenRouter qwen/qwen3.5-27b는 가장 싼 제공자(Alibaba Cloud Int.)의
// 공개 가격 입력 $0.195·출력 $1.56(캐시 가격은 찾지 못해 입력과 같게 본다). prompt에 캐시된 토큰이 들어 있다고 본다. 실제 비용은 OpenRouter가 보고하는 값(usage.cost)과 잔액 변화로 다시 확인한다.
import { appendFileSync, mkdirSync, readFileSync, mkdtempSync } from "node:fs";
import { request as httpsRequest } from "node:https";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HistoryDb } from "../src/brain/history/db.js";
import { runNight, type NightResult } from "../src/brain/history/night.js";
import { PamClient, type CallOptions, type MemoryVerdict } from "../src/brain/pam/index.js";
import type { CandidateFsm } from "../src/contract/pam.js";
import { pamSettings } from "../src/brain/pam/settings.js";
import type { PamUsage } from "../src/contract/events.js";
import { checkView } from "./beer-check-view.js";
import { BEER_CANDIDATES, beerRecords, fakeChunk, fakeMark, groundMark } from "./beer-experiment-records.js";
import { pamClientFor, pamView, startFakePamLlm, type MarkView } from "../tests/helpers/pam.js";

const text = (m: { content: string | { text?: string }[] }) => (typeof m.content === "string" ? m.content : m.content.map((c) => c.text ?? "").join(""));
const HANGUL = /[가-힣]/g;
const arg = (name: string) => { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] : undefined; };
type Price = { in: number; cached: number; out: number };   // 달러 / 100만 토큰
const GPT_MINI: Price = { in: 0.75, cached: 0.075, out: 4.5 };
const QWEN_OPENROUTER: Price = { in: 0.195, cached: 0.195, out: 1.56 };
const usd = (u: { prompt: number; completion: number; cached: number }, p: Price) => ((u.prompt - u.cached) * p.in + u.cached * p.cached + u.completion * p.out) / 1e6;

/** 실험 전용: 뜻 검사 AI에게 보내는 사본만 checkView(scripts/beer-check-view.ts)로 맞춘다. 반성·채택 계산은 원래 기억 그대로다. */
class ExperimentPamClient extends PamClient {
  override async checkMemory(memory: CandidateFsm, call: CallOptions = {}): Promise<MemoryVerdict> {
    return super.checkMemory(checkView(memory), call);
  }
}

/** OpenRouter가 알려 준 제공자·비용(호출마다 모은다). */
interface OrStats { providers: Map<string, number>; reportedUsd: number; calls: number }

/** 실험 전용(2026-11-24): 노드의 기본 fetch는 답 본문이 300초 동안 한 바이트도 안 오면 끊는다(TypeError). 생각을 켠 호출은 생각이 끝나야 답이 와서 이 한도에 걸린다(10-31 밤 뜻 검사에서 만남).
 *  그래서 본문 시간 한도가 없는 https 요청으로 보내고 같은 모양의 Response를 돌려준다. 제품 코드는 그대로다. */
function postOnce(url: string, headers: ConstructorParameters<typeof Headers>[0] | undefined, body: string): Promise<Response> {
  return new Promise((resolve, reject) => {
    const h: Record<string, string> = {};
    new Headers(headers).forEach((v, k) => { h[k] = v; });
    h["content-length"] = String(Buffer.byteLength(body));
    const req = httpsRequest(url, { method: "POST", headers: h }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (c: Buffer) => chunks.push(c));
      res.on("end", () => resolve(new Response(Buffer.concat(chunks), { status: res.statusCode ?? 0, headers: res.headers as Record<string, string> })));
      res.on("error", reject);
    });
    req.on("error", reject);
    const hard = setTimeout(() => req.destroy(new Error("호출이 20분을 넘어 끊음")), 1_200_000);
    req.on("close", () => clearTimeout(hard));
    req.end(body);
  });
}

/** 연결이 끊기면(ECONNRESET 등) 같은 요청을 최대 3번까지 다시 보낸다(11-24 세 번째 시도에서 647초 뒤 끊김을 만남). HTTP 상태 오류는 다시 보내지 않는다. */
async function postNoBodyTimeout(url: string, headers: ConstructorParameters<typeof Headers>[0] | undefined, body: string): Promise<Response> {
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await postOnce(url, headers, body);
      // 호출이 너무 몰리거나(429) 제공자가 잠깐 막히면(502·503·504) 기다렸다가 다시 보낸다(제공자를 Alibaba로 고정해 다른 제공자로 넘어가지 못한다)
      if ([429, 502, 503, 504].includes(res.status) && attempt < 6) { console.log(`  [HTTP ${res.status}, ${attempt * 20}초 뒤 다시 보냄 ${attempt}/5]`); await new Promise((r) => setTimeout(r, attempt * 20_000)); continue; }
      // 제공자가 생성 도중 오류를 내면(HTTP 200인데 finish_reason이 error) 같은 요청을 다시 보낸다
      const j = await res.clone().json().catch(() => null) as { choices?: { finish_reason?: string }[] } | null;
      if (j?.choices?.[0]?.finish_reason === "error" && attempt < 3) { console.log(`  [제공자 오류(finish_reason=error), 다시 보냄 ${attempt}/2]`); continue; }
      // 생각이 길이 제한(16,384 토큰)을 넘어 답이 잘리면(finish_reason=length) 같은 요청을 다시 보낸다(온도 0.3이라 다시 쓰면 달라진다). 제한 자체는 팀 설정 그대로다.
      if (j?.choices?.[0]?.finish_reason === "length" && attempt < 3) { console.log(`  [답이 길이 제한에서 잘림(finish_reason=length), 다시 보냄 ${attempt}/2]`); continue; }
      return res;
    }
    catch (e) {
      if (attempt >= 6) throw e;
      console.log(`  [연결 끊김, ${attempt * 20}초 뒤 다시 보냄 ${attempt}/5] ${(e as Error).message}`);
      await new Promise((r) => setTimeout(r, attempt * 20_000));
    }
  }
}

/** OpenRouter(Qwen3.5-27B)로 가는 클라이언트. 노닌치는 주소가 openrouter.ai이면 호출을 막아 두므로(제품 설정 점검용, src/infer/endpoints.ts) 막히지 않는 가짜 주소를 두고,
 *  호출 함수(fetchImpl)가 실제 주소로 바꿔 보낸다(제품 코드는 그대로). vLLM 모드의 Qwen용 생각 켜기·끄기(chat_template_kwargs.enable_thinking)를 OpenRouter 형식(reasoning.enabled)으로 바꾸고,
 *  제공자는 Alibaba로 고정하며(11-24: 가격 순 선택은 Chutes로도 갔고, Chutes가 낀 시도는 길이 잘림 3번·검사 거절 1번으로 실패, Alibaba만 쓴 시도는 AI 품질 실패가 없었다) 사용량·비용 보고(usage.include)를 켠다. */
function openRouterClient(key: string, stats: OrStats, dumpPath?: string, groundMarks = false): PamClient {
  const settings = pamSettings({ INFERENCE_MODE: "vllm", PAM_LLM_BASE_URL: "http://openrouter-qwen.invalid/v1", PAM_LLM_MODEL: "qwen/qwen3.5-27b", PAM_LLM_API_KEY: key, PAM_LLM_TIMEOUT_S: "900" });
  const fetchImpl: typeof fetch = async (url, init) => {
    const u = new URL(typeof url === "string" ? url : url instanceof URL ? url.href : url.url);
    const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
    const kw = body.chat_template_kwargs as { enable_thinking?: boolean } | undefined;
    delete body.chat_template_kwargs;
    // 노닌치는 밤의 AI 호출 넷(덩어리·반성·뜻 검사·시각 찾기)을 모두 반성용 설정(생각 켬, 온도 0.3)으로 보낸다. 이 실험에서는 세 호출(반성·뜻 검사·시각 찾기)만 생각을 켜고
    // 구조만 다루는 덩어리 만들기는 생각을 끄고 온도 0으로 보낸다. 시각 찾기도 처음에는 끄고 돌렸다가 맥주 꺼내기를 «캔 치우기»에 잘못 붙였다(2026-11-22, 10-17 하루치: 끄면 틀리고 켜면 둘 다 맞음).
    // 호출 종류는 시스템 프롬프트 첫 문장으로 가른다. (뜻 검사가 기본 기억을 거절하는 것은 생각 설정 때문이 아니다: ExperimentPamClient 설명 참고)
    const first = (body.messages as { content: unknown }[] | undefined)?.[0]?.content;
    const firstText = typeof first === "string" ? first : Array.isArray(first) ? first.map((c: { text?: string }) => c.text ?? "").join("") : "";
    const reflect = firstText.startsWith("You are observing a person");
    const check = firstText.startsWith("You check a person-activity finite-state machine");
    // 뜻 검사에 간 후보 기억을 파일에 남긴다(거절돼도 Qwen이 쓴 후보 글을 볼 수 있게. 제품은 거절된 후보를 저장하지 않는다)
    if (check && dumpPath) appendFileSync(dumpPath, `${JSON.stringify({ at: new Date().toISOString(), request: (body.messages as { content: unknown }[]).slice(1) })}
`);
    const mark = firstText.startsWith("You find when given events happened");
    // --ground-marks: 시각 찾기는 AI를 부르지 않고 합성 기록이 아는 사건 시각으로 답한다(덩어리·반성·뜻 검사만 실제 AI)
    if (mark && groundMarks) {
      console.log("  [호출] 시각 찾기: 합성 정답(AI 안 부름)");
      const content = JSON.stringify(groundMark(pamView(body as never) as MarkView));
      return new Response(JSON.stringify({ id: "ground", object: "chat.completion", created: 0, model: "ground-truth", choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop" }], usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 } }), { status: 200, headers: { "content-type": "application/json" } });
    }
    const thinks = reflect || check || mark;
    const thinking = thinks && kw?.enable_thinking === true;
    const sent = { ...body, ...(thinks ? {} : { temperature: 0 }), reasoning: { enabled: thinking }, provider: { order: ["alibaba"], allow_fallbacks: false }, usage: { include: true } };
    const t0 = Date.now();
    const think = `${reflect ? "반성" : check ? "뜻 검사" : mark ? "시각 찾기" : "덩어리"} 생각 ${thinking ? "켬" : "끔"}`;
    const size = JSON.stringify(sent).length;
    let res: Response;
    try {
      res = await postNoBodyTimeout(`https://openrouter.ai/api/v1${u.pathname.replace(/^\/v1/, "")}`, init?.headers, JSON.stringify(sent));
    } catch (e) {
      console.log(`  [호출 실패] 본문 ${size}자, ${think}, ${Math.round((Date.now() - t0) / 1000)}초, ${(e as Error).name}: ${(e as Error).message}`);
      throw e;
    }
    console.log(`  [호출] 본문 ${size}자, ${think}, HTTP ${res.status}, 머리 도착 ${Math.round((Date.now() - t0) / 1000)}초`);
    res.clone().json().then((raw: unknown) => {
      const j = raw as { provider?: string; usage?: { cost?: number } };
      stats.calls++;
      if (j.provider) stats.providers.set(j.provider, (stats.providers.get(j.provider) ?? 0) + 1);
      if (typeof j.usage?.cost === "number") stats.reportedUsd += j.usage.cost;
    }).catch(() => {});
    return res;
  };
  return new ExperimentPamClient({ settings, fetchImpl });
}

/** 밤을 하나씩 돌린다. emit으로 그 밤의 사용량을 받고, 밤마다 한 줄 요약을 돌려준다. */
async function runNights(db: HistoryDb, client: PamClient, days: string[], dir: string, o: { maxUsd: number; price: Price; log?: string; skipDone?: boolean }): Promise<number> {
  let total = 0;
  for (const day of days) {
    if (o.skipDone && db.list({ kinds: ["reflection"], limit: 1_000 }).some((r) => (r.data as { day?: string; ok?: boolean } | null)?.day === day && (r.data as { ok?: boolean }).ok === true)) { console.log(`${day}: 이미 끝난 밤이라 건너뜀`); continue; }
    let usage: PamUsage | undefined;
    const started = Date.now();
    const res = await runNight(db, client, day, { dir, emit: (l) => { if (l.type === "reflection" && (l as { usage?: PamUsage }).usage) usage = (l as { usage?: PamUsage }).usage; } });
    const night = usage ? usd(usage, o.price) : 0;
    total += night;
    const line = res.ok
      ? (() => {
          const r = res as Extract<NightResult, { ok: true }>;
          return { day, ok: true, new_edges: r.learned.map((e) => ({ from: e.from, action: e.action, ctx: e.ctx ?? null })), active: r.active.length,
            checks: r.checks.map((c) => ({ state: c.state, action: c.action, on: c.on, when: c.when, n: c.n, k: c.k, rate: c.rate, p_value: c.p_value, passed: c.passed, ctx_rules: c.ctx_rules ?? [] })) };
        })()
      : { day, ok: false, error: (res as { error: string }).error };
    const row = { ...line, usage: usage ? { prompt: usage.prompt, completion: usage.completion, cached: usage.cached } : null, night_usd: Number(night.toFixed(4)), seconds: Math.round((Date.now() - started) / 1000) };
    if (o.log) appendFileSync(o.log, `${JSON.stringify(row)}\n`);
    const c = res.ok ? (res as Extract<NightResult, { ok: true }>) : null;
    console.log(`${day}: ${c ? `ok 새 화살표 ${c.learned.length}개(누적 ${c.active.length}) 후보 ${c.checks.length}개` : `실패 ${(res as { error: string }).error}`} | 토큰 입력 ${usage?.prompt ?? 0} 출력 ${usage?.completion ?? 0} | 이 밤 $${night.toFixed(3)} 누적 $${total.toFixed(3)} | ${row.seconds}초`);
    if (total > o.maxUsd) { console.log(`누적 비용이 상한 $${o.maxUsd}를 넘어 멈춥니다.`); break; }
  }
  return total;
}

async function main(): Promise<void> {
  const real = process.argv.includes("--real");
  if (!real && !process.argv.includes("--fake")) { console.error("--fake(가짜 AI 시운전) 또는 --real --out <폴더>(실제 AI)를 고르세요."); process.exit(2); }
  if (real) {
    const viaOpenRouter = process.argv.includes("--openrouter");
    const keyName = viaOpenRouter ? "OPENROUTER_API_KEY" : "OPENAI_API_KEY";
    const key = process.env[keyName];
    const out = arg("--out");
    if (!key) { console.error(`환경변수 ${keyName}가 없습니다.`); process.exit(2); }
    if (!out) { console.error("--out <폴더>가 필요합니다(기록 DB와 결과를 둘 곳)."); process.exit(2); }
    mkdirSync(out, { recursive: true });
    const db = HistoryDb.open(join(out, "noonchi.db"));
    const fresh = db.list({ kinds: ["detection"], limit: 1 }).length === 0;   // 이어 하기: 기록이 이미 있으면 다시 쓰지 않는다
    const stats = fresh ? beerRecords(db) : null;
    const days = stats?.days ?? JSON.parse(readFileSync(join(out, "days.json"), "utf8")) as string[];
    if (stats) appendFileSync(join(out, "days.json"), JSON.stringify(stats.days));
    const only = arg("--only")?.split(",").map((d) => d.trim()).filter(Boolean);
    if (only?.some((d) => !days.includes(d))) { console.error(`--only에 기록에 없는 날짜가 있습니다: ${only.filter((d) => !days.includes(d)).join(", ")}`); process.exit(2); }
    const nights = Number(arg("--nights") ?? days.length);
    const runDays = only ? days.filter((d) => only.includes(d)) : days.slice(0, nights);
    const maxUsd = Number(arg("--max-usd") ?? 5);
    // 열쇠는 이 클라이언트 설정에만 들어가고 출력하지 않는다
    const orStats: OrStats = { providers: new Map(), reportedUsd: 0, calls: 0 };
    const client = viaOpenRouter ? openRouterClient(key, orStats, join(out, "check-inputs.jsonl"), process.argv.includes("--ground-marks")) : new ExperimentPamClient({ settings: pamSettings({ INFERENCE_MODE: "openai", OPENAI_API_KEY: key }) });
    const price = viaOpenRouter ? QWEN_OPENROUTER : GPT_MINI;
    console.log(`실제 AI 실험 시작: 모델 ${viaOpenRouter ? "qwen/qwen3.5-27b (OpenRouter, 가격 순 제공자)" : pamSettings({ INFERENCE_MODE: "openai", OPENAI_API_KEY: "x" }).model}, ${runDays.length}밤${only ? `(${runDays.join(", ")})` : ""}, 상한 ${maxUsd}, 결과 폴더 ${out}`);
    const total = await runNights(db, client, runDays, join(out, "copies"), { maxUsd, price, log: join(out, "nights.jsonl"), skipDone: true });
    console.log(`끝. 이번 실행 비용 어림 ${total.toFixed(3)}`);
    if (viaOpenRouter) console.log(`OpenRouter가 보고한 값: 호출 ${orStats.calls}번, 제공자별 ${JSON.stringify([...orStats.providers])}, 보고 비용 합계 ${orStats.reportedUsd.toFixed(4)}`);
    return;
  }
  const pam = await startFakePamLlm({ chunk: fakeChunk, reflect: () => BEER_CANDIDATES, check: () => ({ ok: true, items: [] }), mark: fakeMark });
  try {
    const db = HistoryDb.open(":memory:");
    const stats = beerRecords(db);
    const total = Object.values(stats.linesByDay).reduce((a, b) => a + b, 0);
    console.log(`기록: ${stats.days.length}일 ${total}줄 (하루 평균 ${Math.round(total / stats.days.length)}줄), 토요일 ${stats.saturdays.length}번, 낮 TV 토요일 ${stats.daytimeSaturdays.length}번`);
    await runNights(db, pamClientFor(pam), stats.days, mkdtempSync(join(tmpdir(), "beer-exp-")), { maxUsd: 1e9, price: GPT_MINI });
    const by = new Map<string, { calls: number; hangul: number; other: number }>();
    pam.requests.forEach((req, i) => {
      const role = pam.calls[i] ?? "?";
      const joined = (req.messages as { content: string | { text?: string }[] }[]).map(text).join("\n");
      const h = (joined.match(HANGUL) ?? []).length;
      const cur = by.get(role) ?? { calls: 0, hangul: 0, other: 0 };
      by.set(role, { calls: cur.calls + 1, hangul: cur.hangul + h, other: cur.other + joined.length - h });
    });
    let lo = 0, hi = 0;
    console.log("호출 종류 | 호출 수 | 한글 글자 | 그 밖 글자 | 입력 토큰 어림(낮~높)");
    for (const [role, v] of [...by.entries()].sort()) {
      const a = Math.round(v.hangul * 0.6 + v.other * 0.22), b = Math.round(v.hangul * 1.2 + v.other * 0.3);
      lo += a; hi += b;
      console.log(`${role} | ${v.calls} | ${v.hangul} | ${v.other} | ${a.toLocaleString()} ~ ${b.toLocaleString()}`);
    }
    console.log(`합계 입력 토큰 어림: ${lo.toLocaleString()} ~ ${hi.toLocaleString()}`);
  } finally {
    await pam.close();
  }
}

main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
