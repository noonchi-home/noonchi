// 에이전트 시험의 LLM 자리: 가짜 OpenAI 호환 서버(scripts/fake-openai.ts)를 에이전트 주소(OPENAI_BASE_URL)에 붙인다.
// 공급자는 서버와 같은 createProvider(OpenAI Responses API)다. 사용자 말마다 정한 차례(도구 호출 → 글)를 내고, 정하지 않은 말에는 「가짜 답」.
// 계획 모드 요청(PAM 행동 → 계획)에는 tests/helpers/planner.ts 대본(기본: 지금 서버와 같은 컵 치우기·물어보기)을 낸다.
import { startFakeOpenAI, type FakeResponse } from "../../scripts/fake-openai.js";
import type { LlmProvider } from "../../src/agent/agent.js";
import { createProvider } from "../../src/agent/providers/index.js";
import { CUP_SCRIPTS, plannerRespond, type PlanScript } from "./planner.js";

/** 한 차례: 글이면 답, [도구 이름, 인자] 목록이면 도구 호출. */
export type LlmTurn = string | [name: string, args: Record<string, unknown>][];
/** 사용자 말 → 차례 목록(첫 요청, 도구 결과를 받은 뒤 요청, …). */
export type LlmScript = Record<string, LlmTurn[]>;

export interface FakeLlm {
  url: string;
  /** startServer env에 더하는 에이전트 키·주소. */
  env: { OPENAI_API_KEY: string; OPENAI_BASE_URL: string };
  /** 사용자 말의 차례. 시험 중에 더하거나 바꾼다. */
  script: LlmScript;
  /** 이 주소 자리에 붙은 공급자(서버와 같은 createProvider). */
  provider(): LlmProvider;
  /** 에이전트가 보낸 POST /v1/responses 본문(보낸 순서). */
  bodies(): any[];
  close(): Promise<void>;
}

const userText = (item: any): string | null => (item?.role === "user" && typeof item.content === "string" ? item.content : null);

/** 요청의 마지막 사용자 말과 그 뒤에 받은 도구 결과 묶음 수(몇 번째 차례인가). */
export function turnOf(body: any): { said: string; round: number } | null {
  const input: any[] = Array.isArray(body?.input) ? body.input : [];
  let i = input.length - 1;
  while (i >= 0 && userText(input[i]) === null) i--;
  if (i < 0) return null;
  let round = 0;
  for (let k = i + 1; k < input.length; k++) if (input[k]?.type === "function_call_output" && input[k - 1]?.type !== "function_call_output") round++;
  return { said: userText(input[i])!, round };
}

/** 에이전트가 이 차례의 모델에게 돌려준 도구 결과(function_call_output, JSON). */
export function toolOutputs(body: any): any[] {
  return (Array.isArray(body?.input) ? body.input : []).filter((x: any) => x?.type === "function_call_output").map((x: any) => JSON.parse(x.output));
}

export async function startFakeLlm(script: LlmScript = {}, plans: Record<string, PlanScript> = CUP_SCRIPTS): Promise<FakeLlm> {
  const planning = plannerRespond(plans);
  const fake = await startFakeOpenAI({
    respond: (body): FakeResponse | null => {
      const planned = planning(body);
      if (planned) return planned;
      const t = turnOf(body);
      const turn = t ? out.script[t.said]?.[t.round] : undefined;
      if (turn === undefined) return null;
      return typeof turn === "string" ? { text: turn } : { calls: turn.map(([name, args]) => ({ name, args })) };
    },
  });
  const env = { OPENAI_API_KEY: "fake-key", OPENAI_BASE_URL: `${fake.url}/v1` };
  const out: FakeLlm = {
    url: fake.url, env, script,
    provider: () => createProvider(env).provider,
    bodies: () => fake.requests.filter((r) => r.method === "POST" && r.path.endsWith("/responses")).map((r) => r.body),
    close: () => fake.close(),
  };
  return out;
}

/** 시험 집(tests/helpers/home.ts)과 실제 아파트 트윈의 같은 id로 쓴 데모 요청. */
export const HOME_SCRIPT: LlmScript = {
  "거실 TV 켜줘": [[["turn_on", { device_id: "tv_living", reason: "거실 TV를 켜 달라고 해서" }]], "거실 TV를 켰어요."],
  "거실 불 켜고 TV 꺼줘": [
    [["find_devices", { query: "거실 불", reason: "거실 조명을 찾으려고" }]],
    [["turn_on", { device_id: "light_living", reason: "거실 불을 켜 달라고 해서" }], ["turn_on", { device_id: "lamp_living", reason: "거실 불을 켜 달라고 해서" }],
      ["turn_off", { device_id: "tv_living", reason: "TV를 꺼 달라고 해서" }]],
    "거실 불을 켜고 TV를 껐어요.",
  ],
  "에어컨 24도로 맞춰줘": [[["set_climate", { device_id: "ac_living", setpoint_c: 24, reason: "에어컨을 24도로 맞추려고" }]], "스탠드 에어컨을 24°C로 맞췄어요."],
  "안방 커튼 닫아줘": [[["set_covering", { device_id: "curtain_master", open_percent: 0, reason: "안방 커튼을 닫으려고" }]], "안방 커튼을 닫았어요."],
  "현관문 열어줘": [[["unlock", { device_id: "door_main", reason: "현관문을 열어 달라고 해서" }]], "현관문을 열려면 승인이 필요해요. 열까요?"],
};
