// 에이전트 계획 모드 시험의 모델 자리: 가짜 OpenAI 호환 서버(scripts/fake-openai.ts)가 계획 모드 요청(시스템 프롬프트 PLANNER_PROMPT)에
// 행동마다 정한 도구 호출(계획 전체를 한 번에 내는 submit_plan)을 낸다. 공급자는 서버와 같은 createProvider(OpenAI Responses API, OPENAI_BASE_URL)다.
// 대본은 입력 글(src/agent/planInput.ts)에서 id를 읽는다: 식탁·싱크대는 평면도 줄의 종류, 컵은 World State 물건 줄.
import { startFakeOpenAI, type FakeResponse } from "../../scripts/fake-openai.js";
import { ASK_PROMPT } from "../../src/act/prompts.js";
import { taskOf } from "../../src/act/tasks.js";
import type { LlmProvider } from "../../src/agent/agent.js";
import { PLANNER_PROMPT } from "../../src/agent/planInput.js";
import { Planner } from "../../src/agent/planner.js";
import type { PlanContext, TaskInfo } from "../../src/agent/planTools.js";
import { Policy } from "../../src/agent/policy.js";
import { createProvider } from "../../src/agent/providers/index.js";
import { deviceViews } from "../../src/agent/tools.js";
import type { WorldView } from "../../src/contract/world.js";
import { MemoryHub } from "../../src/hub/memory.js";
import type { DeviceHub, RoomSpec } from "../../src/hub/types.js";
import type { FloorPlan } from "../../src/plan/floor.js";
import { STEP_COMMAND, STEP_LABEL, placeShort } from "../../src/plan/labels.js";
import type { DecisionRecord } from "../../src/world/decide.js";
import type { LlmTurn } from "./llm.js";

/** 입력 글 → 차례 목록(첫 요청, 도구 결과를 받은 뒤 요청, …). */
export type PlanScript = (input: string) => LlmTurn[];

/** 단계 목록 → 한 차례(submit_plan 한 번에 계획 전체, 번호는 배열 순서). */
export const planCalls = (steps: Record<string, unknown>[]): LlmTurn => [["submit_plan", { steps }]];

/** 컵 치우기 네 단계(지금 서버와 같은 명령·조건). 내려놓기는 싱크대 안 사실, 또는 싱크대 면 위이고 손에 없음. */
export function cupSteps(ids: { table: string; sink: string; cup: string }): Record<string, unknown>[] {
  const { table, sink, cup } = ids;
  return [
    { kind: "go", label: STEP_LABEL.goTable, target: table, command: STEP_COMMAND.goTable, until: { phone_near: table }, timeout_s: 120 },
    {
      kind: "pick", label: STEP_LABEL.pickCup, target: cup, command: STEP_COMMAND.pickCup,
      until: { any: [{ object: cup, follow: true, facts: { place: "in_hand" } }, { person_holding: "cup" }] }, timeout_s: 120,
    },
    { kind: "go", label: STEP_LABEL.goSink, target: sink, command: STEP_COMMAND.goSink, until: { phone_near: sink }, timeout_s: 120 },
    {
      kind: "place", label: STEP_LABEL.placeCup, target: sink, object: cup, command: STEP_COMMAND.placeCup,
      until: {
        any: [
          { object: cup, follow: true, facts: { place: "in_sink" } },
          { all: [{ object: cup, follow: true, surface: sink }, { not: { object: cup, follow: true, facts: { place: "in_hand" } } }] },
        ],
      },
      timeout_s: 120,
    },
  ];
}

/** 사용자에게 물어보기: 컵을 치울지 묻는 한 단계. */
export function askSteps(): Record<string, unknown>[] {
  return [{ kind: "ask", label: STEP_LABEL.askUser, question: ASK_PROMPT.text, choices: ASK_PROMPT.choices.map(({ id, label, words, reply }) => ({ id, label, words, reply })), timeout_s: 120 }];
}

/** 입력 글에서 식탁·싱크대(평면도 종류)와 보이는 컵(World State) id. */
export function idsFrom(input: string): { table: string; sink: string; cup: string } {
  const place = (type: string) => new RegExp(`^- (\\S+) .*\\[${type}\\]`, "m").exec(input)?.[1] ?? "";
  return { table: place("dining_table"), sink: place("sink_counter"), cup: /^- 물건 (cup_\d+) 컵 · (present|out_of_view)/m.exec(input)?.[1] ?? "" };
}

/** 컵 치우기·물어보기 대본(지금 서버와 같은 계획). */
export const CUP_SCRIPTS: Record<string, PlanScript> = {
  "컵 치우기": (input) => [planCalls(cupSteps(idsFrom(input)))],
  "사용자에게 물어보기": () => [planCalls(askSteps())],
};

const isPlanning = (body: any) => body?.instructions === PLANNER_PROMPT;

/** 계획 입력(첫 사용자 말), 행동 이름, 몇 번째 차례인가(앞 도구 결과 묶음·다시 부탁한 말 수). */
export function planTurn(body: any): { input: string; action: string | null; round: number } | null {
  const items: any[] = Array.isArray(body?.input) ? body.input : [];
  const firstAt = items.findIndex((x) => x?.role === "user" && typeof x.content === "string");
  if (firstAt < 0) return null;
  const input = items[firstAt].content as string;
  let round = 0;
  for (let k = firstAt + 1; k < items.length; k++) {
    if (items[k]?.type === "function_call_output" && items[k - 1]?.type !== "function_call_output") round++;
    else if (items[k]?.role === "user") round++;
  }
  return { input, action: /^\[할 일\] (.+?):/m.exec(input)?.[1] ?? null, round };
}

/** 가짜 OpenAI 서버의 respond: 계획 모드 요청에 그 행동 대본의 차례를 낸다. 대본이 끝났거나 없으면 글 답(도구 없음). 계획 모드가 아니면 null. */
export function plannerRespond(scripts: Record<string, PlanScript>): (body: any) => FakeResponse | null {
  return (body) => {
    if (!isPlanning(body)) return null;
    const t = planTurn(body);
    const turn = t?.action ? scripts[t.action]?.(t.input)[t.round] : undefined;
    if (turn === undefined) return { text: "계획을 끝냈어요." };
    return typeof turn === "string" ? { text: turn } : { calls: turn.map(([name, args]) => ({ name, args })) };
  };
}

export interface FakePlanner {
  url: string;
  env: { OPENAI_API_KEY: string; OPENAI_BASE_URL: string };
  scripts: Record<string, PlanScript>;
  provider(): LlmProvider;
  /** 계획 모드 요청 본문(보낸 순서). */
  bodies(): any[];
  close(): Promise<void>;
}

/** 계획 모드 대본을 내는 가짜 OpenAI 서버. reply는 VLM(chat completions) 답을 정할 때. */
export async function startFakePlanner(scripts: Record<string, PlanScript> = { ...CUP_SCRIPTS }, o: { reply?: (body: any) => string | null } = {}): Promise<FakePlanner> {
  const out = { scripts } as FakePlanner;
  const fake = await startFakeOpenAI({ reply: o.reply, respond: (body) => plannerRespond(out.scripts)(body) });
  const env = { OPENAI_API_KEY: "fake-key", OPENAI_BASE_URL: `${fake.url}/v1` };
  return Object.assign(out, {
    url: fake.url, env,
    provider: () => createProvider(env).provider,
    bodies: () => fake.requests.filter((r) => r.method === "POST" && r.path.endsWith("/responses") && isPlanning(r.body)).map((r) => r.body),
    close: () => fake.close(),
  });
}

/** 시험 계획 입력: 행동 설명·평면도 물건 이름(종류 짧은 이름)·가전 목록. */
export function planContext(o: { decision: DecisionRecord; world: WorldView; floor: FloorPlan; hub?: DeviceHub; rooms?: RoomSpec[]; nowIso?: string; task?: TaskInfo }): PlanContext {
  const task = o.task ?? taskOf(o.decision.action);
  if (!task) throw new Error(`행동 목록에 없는 행동: ${o.decision.action}`);
  return {
    decision: o.decision, task, world: o.world, floor: o.floor, rooms: o.rooms ?? [], devices: o.hub ? deviceViews(o.hub) : [], nowIso: o.nowIso ?? "2026-11-10T00:00:00.000Z",
    places: [...o.floor.objects.values()].map((p) => ({ id: p.id, type: p.type, room: p.room, position: p.position, name: placeShort(p.type) ?? p.id, short: placeShort(p.type) ?? p.id })),
  };
}

/** 가짜 서버에 붙은 계획 모드 에이전트. */
export function testPlanner(llm: FakePlanner, o: { timeoutMs?: number; maxRounds?: number } = {}): Planner {
  return new Planner({ provider: llm.provider(), timeoutMs: o.timeoutMs, maxRounds: o.maxRounds });
}
