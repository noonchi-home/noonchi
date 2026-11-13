// 에이전트 계획 모드 시험의 모델 자리: 가짜 OpenAI 호환 서버(scripts/fake-openai.ts)가 계획 모드 요청(시스템 프롬프트 PLANNER_PROMPT)에
// 행동마다 정한 도구 호출(계획 전체를 한 번에 내는 submit_plan)을 낸다. 공급자는 서버와 같은 createProvider(OpenAI Responses API, OPENAI_BASE_URL)다.
// 대본은 입력 글(src/agent/planInput.ts)에서 id를 읽는다: 식탁·싱크대는 평면도 줄의 종류, 컵은 World State 물건 줄.
import { startFakeOpenAI, type FakeResponse } from "../../scripts/fake-openai.js";
import { ASK_PROMPT } from "../../src/act/prompts.js";
import { taskOf, type Placed } from "../../src/act/tasks.js";
import type { LlmProvider } from "../../src/agent/agent.js";
import { PLANNER_PROMPT } from "../../src/agent/planInput.js";
import { Planner } from "../../src/agent/planner.js";
import { placesOf, type PlanContext, type TaskInfo } from "../../src/agent/planTools.js";
import { Policy } from "../../src/agent/policy.js";
import { createProvider } from "../../src/agent/providers/index.js";
import { deviceViews } from "../../src/agent/tools.js";
import type { WorldView } from "../../src/contract/world.js";
import { MemoryHub } from "../../src/hub/memory.js";
import type { DeviceHub, RoomSpec } from "../../src/hub/types.js";
import type { FloorPlan } from "../../src/plan/floor.js";
import { josa } from "../../src/agent/phrases.js";
import { placeShort } from "../../src/plan/labels.js";
import type { DecisionRecord } from "../../src/world/decide.js";
import type { LlmTurn } from "./llm.js";

/** 입력 글 → 차례 목록(첫 요청, 도구 결과를 받은 뒤 요청, …). */
export type PlanScript = (input: string) => LlmTurn[];

/** 단계 목록 → 한 차례(submit_plan 한 번에 계획 전체, 번호는 배열 순서). */
export const planCalls = (steps: Record<string, unknown>[]): LlmTurn => [["submit_plan", { steps }]];

/** 컵 치우기 네 단계(지금 서버와 같은 명령·조건). 내려놓기(안에 넣기)는 「싱크대 안 사실 또는 싱크대 면의 싱크볼 안이고 손에 없음」이고 사람이 그 컵을 들고 있지 않음.
 *  싱크볼이 없는 싱크대(basin false)면 싱크대 안 사실이고 사람이 그 컵을 들고 있지 않음. */
export function cupSteps(ids: { table: string; sink: string; cup: string; basin?: boolean }): Record<string, unknown>[] {
  const { table, sink, cup, basin = true } = ids;
  const inSink = { object: cup, follow: true, facts: { place: "in_sink" } };
  const notHeld = { not: { person_holding: cup } };
  return [
    { kind: "go", act: "가기", target: table, until: { phone_near: table }, timeout_s: 120 },
    {
      kind: "pick", act: "들기", target: cup,
      until: { any: [{ object: cup, follow: true, facts: { place: "in_hand" } }, { person_holding: "cup" }] }, timeout_s: 120,
    },
    { kind: "go", act: "가기", target: sink, until: { phone_near: sink }, timeout_s: 120 },
    {
      kind: "place", act: "넣기", target: sink, object: cup,
      until: basin
        ? {
          all: [
            { any: [inSink, { all: [{ object: cup, follow: true, surface: sink, part: "basin" }, { not: { object: cup, follow: true, facts: { place: "in_hand" } } }] }] },
            notHeld,
          ],
        }
        : { all: [inSink, notHeld] },
      timeout_s: 120,
    },
  ];
}

/** 채워 주기 글(시험 대본이 쓰는 명령·단계 이름). 음료마다 꺼낼 것 이름이 다르다. */
export const FILL_TEXT = {
  goFridge: { label: "냉장고로 가기", command: "냉장고로 가 주세요" },
  pick: { 물: { label: "물병 꺼내기", command: "물병을 꺼내 주세요" }, 콜라: { label: "콜라 꺼내기", command: "콜라를 꺼내 주세요" } },
  goBack: (place: string) => ({ label: `${josa(place, "으로/로")} 가기`, command: `${josa(place, "으로/로")} 가 주세요` }),
  pour: { 물: { label: "컵에 물 따르기", command: "컵에 물을 따라 주세요" }, 콜라: { label: "컵에 콜라 따르기", command: "컵에 콜라를 따라 주세요" } },
} as const;

/** 채워 주기 네 단계: 냉장고로 가기 → 병 꺼내기(병은 냉장고 안이라 안 보여 자리로 집는다) → 컵 자리로 가기 → 따르기(do).
 *  병 집기는 그 종류(bottle) 물건이 손에 있음으로 보일 때, 따르기는 그 컵이 내용물 있음일 때 넘어간다. place는 컵 자리 이름(기본 식탁). */
export function fillSteps(ids: { fridge: string; table: string; cup: string; drink: "물" | "콜라"; place?: string }): Record<string, unknown>[] {
  const { fridge, table, cup, drink } = ids;
  return [
    { kind: "go", act: "가기", target: fridge, until: { phone_near: fridge }, timeout_s: 120 },
    { kind: "pick", act: "꺼내기", item: drink === "물" ? "물병" : "콜라", target: fridge, until: { object: "bottle", facts: { place: "in_hand" } }, timeout_s: 120 },
    { kind: "go", act: "가기", target: table, until: { phone_near: table }, timeout_s: 120 },
    { kind: "do", act: "따르기", item: drink, target: cup, until: { object: cup, follow: true, facts: { contents: "has_contents" } }, timeout_s: 120 },
  ];
}

/** 사용자에게 물어보기: 컵을 치울지 묻는 한 단계. */
export function askSteps(): Record<string, unknown>[] {
  return [{ kind: "ask", question: ASK_PROMPT.text, choices: "clear_keep", timeout_s: 120 }];
}

/** 입력 글에서 식탁·싱크대(평면도 종류)와 보이는 컵(World State, 「이미 치움」이 아닌 첫 컵) id, 싱크대 줄에 싱크볼이 있는가. */
export function idsFrom(input: string): { table: string; sink: string; cup: string; basin: boolean } {
  const line = (type: string) => new RegExp(`^- (\\S+) .*\\[${type}\\].*$`, "m").exec(input);
  const sink = line("sink_counter");
  return {
    table: line("dining_table")?.[1] ?? "", sink: sink?.[1] ?? "", basin: / · 싱크볼 \[/.test(sink?.[0] ?? ""),
    cup: /^- 물건 (cup_\d+) 컵 · (present|out_of_view)(?! · 이미 치움)/m.exec(input)?.[1] ?? "",
  };
}

/** 입력 글에서 냉장고(평면도 종류)와 보이는 컵(「이미 치움」이 아닌 첫 컵), 그 컵이 놓인 면(평면도 id, 없으면 식탁)과 그 면의 짧은 이름. */
export function fillIdsFrom(input: string): { fridge: string; table: string; cup: string; place: string } {
  const line = (type: string) => new RegExp(`^- (\\S+) .*\\[${type}\\].*$`, "m").exec(input);
  const cup = /^- 물건 (cup_\d+) 컵 · (?:present|out_of_view)(?! · 이미 치움) · 면 (\S+)/m.exec(input);
  const at = cup && cup[2] !== "없음" ? new RegExp(`^- ${cup[2]} .*\\[(\\w+)\\]`, "m").exec(input) : null;
  return {
    fridge: line("fridge")?.[1] ?? "", cup: cup?.[1] ?? "",
    table: at ? cup![2]! : line("dining_table")?.[1] ?? "", place: (at && placeShort(at[1]!)) || "식탁",
  };
}

/** 채워 주기 대본: 입력 글의 [할 일] 줄(행동 이름)로 물·콜라를 고른다. */
export const FILL_SCRIPTS: Record<string, PlanScript> = {
  "컵에 물 채워 주기": (input) => [planCalls(fillSteps({ ...fillIdsFrom(input), drink: "물" }))],
  "컵에 콜라 따라 주기": (input) => [planCalls(fillSteps({ ...fillIdsFrom(input), drink: "콜라" }))],
};

/** 라면 끓이기 알려 주기 시험 대본 13단계(라면 단계 글은 여기에만 있다. src에는 없다):
 *  수납장으로 가기 · 냄비 꺼내기 · 싱크대로 가기 · 물 받기 · 인덕션으로 가기 · 냄비 올리기 · 인덕션 켜기(손으로, 안전 문구) · 알림 · 기다리기 ·
 *  면과 스프 넣기 · 기다리기 · 인덕션 끄기(손으로) · 알림. 비전으로 볼 수 있는 것(폰 위치·무언가 들고 있음)만 until이고 나머지는 「완료」·말로 넘긴다.
 *  waitS: 기다리는 초(기본 240, 흐름 시험은 줄인다). */
export function ramenSteps(ids: { cabinet: string; sink: string; cooktop: string; cooktopDevice: string; waitS?: number }): Record<string, unknown>[] {
  const { cabinet, sink, cooktop, cooktopDevice, waitS = 240 } = ids;
  const go = (target: string) => ({ kind: "go", act: "가기", target, until: { phone_near: target }, timeout_s: 120 });
  const wait = (notice: string) => ({ kind: "wait", notice, until: { elapsed_s: waitS }, timeout_s: Math.max(10, waitS + 60) });
  return [
    go(cabinet),
    { kind: "pick", act: "꺼내기", item: "냄비", target: cabinet, until: { person_fact: "holding", value: "holding_object" }, timeout_s: 120 },
    go(sink),
    { kind: "do", act: "물 받기", item: "냄비", target: sink, timeout_s: 180 },
    go(cooktop),
    { kind: "place", act: "올리기", item: "냄비", target: cooktop, timeout_s: 120 },
    { kind: "do", act: "켜기", target: cooktopDevice, hand_device: { id: cooktopDevice, to: "on" }, timeout_s: 120 },
    { kind: "say", notice: "물 끓기", timeout_s: 10 },
    wait("물 끓기"),
    { kind: "do", act: "넣기", item: "면과 스프", target: cooktop, timeout_s: 180 },
    wait("익기"),
    { kind: "do", act: "끄기", target: cooktopDevice, hand_device: { id: cooktopDevice, to: "off" }, timeout_s: 120 },
    { kind: "say", notice: "끝", item: "라면", timeout_s: 10 },
  ];
}

/** 입력 글에서 수납장·싱크대·인덕션(평면도 종류)과 인덕션 가전([가전] 줄의 cooktop) id. */
export function ramenIdsFrom(input: string): { cabinet: string; sink: string; cooktop: string; cooktopDevice: string } {
  const line = (type: string) => new RegExp(`^- (\\S+) .*\\[${type}\\]`, "m").exec(input)?.[1] ?? "";
  return { cabinet: line("kitchen_cabinet"), sink: line("sink_counter"), cooktop: line("induction_counter"), cooktopDevice: /^- (\S+) .*\[cooktop /m.exec(input)?.[1] ?? "" };
}

/** 라면 끓이기 알려 주기 대본. waitS: 기다리는 초(기본 240). */
export const ramenScripts = (waitS?: number): Record<string, PlanScript> => ({
  "라면 끓이기 알려 주기": (input) => [planCalls(ramenSteps({ ...ramenIdsFrom(input), ...(waitS === undefined ? {} : { waitS }) }))],
});

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

/** 시험 계획 입력: 행동 설명·평면도 물건 이름(종류 짧은 이름)·가전 목록, 실행 추적이 이미 치운 물건(placed). */
export function planContext(o: {
  decision: DecisionRecord; world: WorldView; floor: FloorPlan; hub?: DeviceHub; rooms?: RoomSpec[]; nowIso?: string; task?: TaskInfo; placed?: Placed;
  /** 배치 이름(서버는 배치 편집기 이름)·카탈로그 종류 이름. 없으면 종류 짧은 이름만. */
  names?: ReadonlyMap<string, string>; typeLabel?: (type: string) => string | undefined;
}): PlanContext {
  const task = o.task ?? taskOf(o.decision.action);
  if (!task) throw new Error(`행동 목록에 없는 행동: ${o.decision.action}`);
  return {
    decision: o.decision, task, world: o.world, floor: o.floor, rooms: o.rooms ?? [], devices: o.hub ? deviceViews(o.hub) : [], nowIso: o.nowIso ?? "2026-11-10T00:00:00.000Z",
    // 서버와 같은 평면도 줄(src/agent/planTools.ts placesOf). 배치 이름이 없으면 종류 짧은 이름을 배치 이름으로 쓴다
    places: placesOf(o.floor, { names: o.names ?? new Map([...o.floor.objects.values()].flatMap((p) => { const s = placeShort(p.type); return s ? [[p.id, s] as [string, string]] : []; })), typeLabel: o.typeLabel }),
    ...(o.placed ? { placed: o.placed } : {}),
  };
}

/** 가짜 서버에 붙은 계획 모드 에이전트. */
export function testPlanner(llm: FakePlanner, o: { timeoutMs?: number; maxRounds?: number } = {}): Planner {
  return new Planner({ provider: llm.provider(), timeoutMs: o.timeoutMs, maxRounds: o.maxRounds });
}
