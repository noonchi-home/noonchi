// 옮기기 전 Python PAM이 만든 정답(tests/fixtures/pam-golden/out)과 TS 결과를 비교한다.
// 프롬프트에 따라 바뀌는 정답(메시지·전송 바이트·토큰 추정·바꾸기 결과·입력 한도)은 toMatchFileSnapshot이다. 프롬프트를 일부러 바꿨으면 `npx vitest run tests/pam-golden.test.ts -u`로 새 정답을 쓰고 차이를 본다.
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { adaptation, buildPredictMessages, buildReflectMessages, estimateTokens, PamAnswerError, PamBudgetError, PamClient, PamLinkError, PamLlm, pamLimits, PamRequestError, pamSettings, parseMemory, parsePrediction, predictRequest, reflectRequest, type Generation, type PamMessage } from "../src/brain/pam/index.js";
import { loadEndpoints } from "../src/infer/endpoints.js";

const DIR = new URL("./fixtures/pam-golden/", import.meta.url);
const inputs = JSON.parse(readFileSync(new URL("inputs.json", DIR), "utf8"));
const out = (name: string) => JSON.parse(readFileSync(new URL(`out/${name}`, DIR), "utf8"));
const pretty = (v: unknown) => JSON.stringify(v, null, 2) + "\n";
const JSON_ERR = /^JSON syntax error at char \d+$/;
const norm = (e: string) => (JSON_ERR.test(e) ? "<json>" : e);
const MAX = { maxModelLen: 32768, maxTokens: { predictor: 2048, reflector: 16384 } };

async function sameFile(name: string, text: string) {
  expect(existsSync(new URL(`out/${name}`, DIR)), `정답 파일 ${name}`).toBe(true);
  await expect(text).toMatchFileSnapshot(`./fixtures/pam-golden/out/${name}`);
}

describe("Python과 같은 결과", () => {
  it("판단·반성 메시지와 토큰 추정", async () => {
    const tokens: Record<string, number> = {};
    for (const c of inputs.predict) {
      const built = buildPredictMessages(predictRequest(c.request));
      await sameFile(`${c.id}.messages.json`, pretty(built));
      tokens[c.id] = estimateTokens(built.messages);
    }
    for (const c of inputs.reflect) {
      const built = buildReflectMessages(reflectRequest(c.request));
      await sameFile(`${c.id}.messages.json`, pretty(built));
      tokens[c.id] = estimateTokens(built.messages);
    }
    await sameFile("tokens.json", pretty(tokens));
  });

  it("노닌치 바꾸기 적용 결과", async () => {
    const ids = ["predictor_fsm", "predictor_list", "reflector_fsm_update", "reflector_list_update"] as const;
    await sameFile("adaptation.json", pretty(Object.fromEntries(ids.map((id) => [id, adaptation(id)]))));
  });

  it("판단 답 검사(parse_prediction)", () => {
    const got = inputs.parse.map((c: { id: string; raw: string; tasks: string[] }) => {
      const r = parsePrediction(c.raw, c.tasks);
      return { id: c.id, result: { ...r, errors: r.errors.map(norm) } };
    });
    expect(got).toEqual(out("parse.json"));
  });

  it("반성 답 검사(parse_memory)", () => {
    const got = inputs.memory.map((c: { id: string; raw: string; kind: "list" | "fsm" }) => {
      const r = parseMemory(c.raw, c.kind);
      return r.ok ? { id: c.id, ok: true, memory: r.memory } : { id: c.id, ok: false, error: norm(r.error) };
    });
    expect(got).toEqual(out("memory.json"));
  });

  it("입력 한도(limits, 프롬프트 길이를 따라 바뀐다)", async () => {
    const len = (env: Record<string, string>) => Number(env.PAM_MAX_MODEL_LEN?.trim() || 32768);
    const got = inputs.limits.map((env: Record<string, string>) => ({ env, limits: pamLimits({ ...MAX, maxModelLen: len(env) }) }));
    await sameFile("limits.json", pretty(got));
  });
});


// Python 정답의 전송 갈래: live(vLLM) → vllm, mock + PAM_LLM_PROVIDER=openai → openai. OpenRouter 갈래는 2026-11-17에 뺐다.
const TRANSPORTS = { vllm: { INFERENCE_MODE: "vllm" }, openai: { INFERENCE_MODE: "openai", OPENAI_API_KEY: "k" } };
/** Python 설정 env → 지금 이름(INFERENCE_MODE live → vllm, PAM_LLM_PROVIDER=openai → INFERENCE_MODE=openai). */
function nowEnv(env: Record<string, string>): Record<string, string> {
  const { PAM_LLM_PROVIDER, ...rest } = env;
  if (PAM_LLM_PROVIDER === "openai") return { ...rest, INFERENCE_MODE: "openai" };
  return rest.INFERENCE_MODE?.trim() === "live" ? { ...rest, INFERENCE_MODE: "vllm" } : rest;
}
const NOW_MODE: Record<string, string> = { live: "vllm", mock: "openai" };

async function wire(env: Record<string, string>, built: { messages: PamMessage[]; generation: Generation }, role: "predictor" | "reflector") {
  let line = "";
  const fetchImpl = (async (url: string | URL, init?: RequestInit) => {
    const auth = new Headers(init?.headers).get("authorization");
    line = `POST ${url}\nauthorization: ${auth ?? "-"}\n\n${init?.body}`;
    return Response.json({ choices: [{ message: { content: "{}" }, finish_reason: "stop" }] });
  }) as typeof fetch;
  await new PamLlm(pamSettings(env), { fetchImpl }).complete(built.messages, built.generation, role, 5000);
  return line;
}

describe("Python과 같은 전송", () => {
  it("판단·반성 LLM 요청(주소·authorization·본문 바이트)이 세 갈래 모두 같다", async () => {
    for (const [cases, build, role] of [[inputs.predict, (r: unknown) => buildPredictMessages(predictRequest(r)), "predictor"], [inputs.reflect, (r: unknown) => buildReflectMessages(reflectRequest(r)), "reflector"]] as const) {
      for (const c of cases) {
        const built = build(c.request);
        let text = "";
        for (const [t, env] of Object.entries(TRANSPORTS)) text += `=== ${t} ===\n${await wire(env, built, role)}\n`;
        await sameFile(`${c.id}.wire.txt`, text);
      }
    }
  });

  it("설정(모드 표·덮어쓰기·오류 글, 모드 이름은 지금 이름으로)", () => {
    const got = inputs.settings.map((c: { id: string; env: Record<string, string> }) => {
      try {
        const env = nowEnv(c.env);
        const s = pamSettings(env);
        return { id: c.id, settings: { mode: loadEndpoints(env).mode, base_url: s.baseUrl, model: s.model, api_key: s.apiKey, thinking: s.thinking,
          extra: s.extraBody, timeout_s: s.timeoutMs / 1000, max_tokens: s.maxTokens, max_model_len: s.maxModelLen } };
      } catch (e) {
        return { id: c.id, error: (e as Error).message };
      }
    });
    const want = (out("settings.json") as { id: string; settings?: { mode: string } }[]).map((c) => (c.settings ? { ...c, settings: { ...c.settings, mode: NOW_MODE[c.settings.mode] } } : c));
    expect(got).toEqual(want);
  });

  it("요청 결과: 400→PamRequestError, 413→PamBudgetError, 200 invalid→PamAnswerError, 502→PamLinkError, 보낸 횟수까지 같다", async () => {
    const got = [];
    for (const c of inputs.requests) {
      let sent = 0;
      const fetchImpl = (async () => { sent++; return Response.json(c.llm.json, { status: c.llm.status }); }) as typeof fetch;
      const pam = new PamClient({ settings: pamSettings({ INFERENCE_MODE: "vllm" }), fetchImpl });
      let status = 200;
      let answer: string | null = "valid";
      try {
        if (c.route === "predict") await pam.predict(c.body);
        else await pam.reflect(c.body, c.body.memory_kind);
      } catch (e) {
        if (e instanceof PamAnswerError) answer = "invalid";
        else {
          answer = null;
          if (e instanceof PamRequestError) status = 400;
          else if (e instanceof PamBudgetError) status = 413;
          else if (e instanceof PamLinkError) status = 502;
          else throw e;
        }
      }
      got.push({ id: c.id, status, answer, sent });
    }
    expect(got).toEqual(out("requests.json"));
  });
});
