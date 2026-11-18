// 계획 모드 차례 기록(2026-11-18 tall e1: 미리 만들기가 「모델 차례 3번 안에 맞는 계획을 내지 못함」만 남겨 차례마다 무엇을 버렸는지 몰랐다),
// 한 차례에 틀린 단계를 모두 돌려주기(첫 틀린 단계만 돌려주면 단계마다 한 차례씩 써 3차례를 넘긴다), until 모양 오류의 자리.
// 모델은 같은 주소 자리의 가짜 OpenAI 서버가 도구 호출로 낸다(tests/helpers/planner.ts).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Planner, planRoundLine, planRoundText, type PlanRound } from "../src/agent/planner.js";
import { PLANNER_PROMPT } from "../src/agent/planInput.js";
import { PlanDraft, SUBMIT_ARGS } from "../src/agent/planTools.js";
import type { DecisionRecord } from "../src/contract/events.js";
import type { WorldObject, WorldView } from "../src/contract/world.js";
import { conditionProblems } from "../src/world/conditions.js";
import { smallFloor } from "./helpers/floor.js";
import { cupSteps, idsFrom, planCalls, planContext, startFakePlanner, type FakePlanner, type PlanScript } from "./helpers/planner.js";

const PERSON: WorldView["person"] = { visible: false, since_ms: 0, last_seen_ms: null, count: 0, room: null, room_label: null, position: null, near: [], holding: [], position_ms: null, answered_ms: null, facts: {} };
const CUP: WorldObject = {
  id: "cup_1", cls: "cup", position: [7, 0.75, 3], surface: "table_1", surface_label: "식탁", room: "kitchen", error_m: 0.1, status: "present",
  first_seen_ms: 0, last_seen_ms: 9_000, last_in_view_ms: 9_000, facts: {}, answered_ms: null, devices: [], closer_hold: false, followed_by: null,
};
const WORLD: WorldView = { at_ms: 0, objects: [CUP], person: PERSON, fixtures: [], devices: [], eye: null, frame_ms: 9_000, vlm_missing: 0, yolo_missing: 0 };
const DECISION: DecisionRecord = {
  id: "pam-5", seq: 5, atMs: 8_000, textSent: "t", finalTime: "x", status: "valid", prediction: { observation: "관찰", reasoning: "이유", task_index: 0 }, action: "컵 치우기", memoryVersion: 1,
  world: { objects: [], person_visible: false, vlm_missing: 0, yolo_missing: 0 },
};
const ctx = () => planContext({ decision: DECISION, world: WORLD, floor: smallFloor(), nowIso: "t" });
const IDS = { table: "table_1", sink: "sink_1", cup: "cup_1" };
/** 사람이 든 물건 조건에 물건 조건 칸(follow)을 붙인 단계: 집기·놓기 둘 다 같은 실수를 한다. */
const followOnHeld = (steps: Record<string, unknown>[]) => JSON.parse(JSON.stringify(steps).replaceAll(/\{"person_holding":"([^"]+)"\}/g, '{"person_holding":"$1","follow":true}')) as Record<string, unknown>[];

let llm: FakePlanner;
beforeAll(async () => { llm = await startFakePlanner(); });
afterAll(async () => { await llm.close(); });

describe("계획 검사: 한 차례에 틀린 단계를 모두 돌려준다", () => {
  it("집기·놓기 두 단계가 틀리면 두 단계의 번호와 까닭을 한 번에 돌려주고, 맞는 단계는 말하지 않는다", () => {
    const r = new PlanDraft(ctx()).submit({ steps: followOnHeld(cupSteps(IDS)) });
    expect(r.ok).toBe(false);
    const error = r.ok ? "" : r.error;
    expect(error).toMatch(/^2번 단계: until이 조건 낱말 모양이 아닙니다: any\.1: 쓰지 않는 키 follow\. /);
    expect(error).toMatch(/ 4번 단계: until이 조건 낱말 모양이 아닙니다: all\.1\.not: 쓰지 않는 키 follow\. /);
    expect(error).not.toMatch(/[13]번 단계/);
    expect(error).toMatch(/계획 전체를 고쳐 submit_plan으로 다시 보내세요\.$/);
  });

  it("지시문과 도구 설명은 틀린 단계마다 까닭이 오고, follow는 물건 조건(object)에만 쓴다고 말한다", () => {
    const lines = PLANNER_PROMPT.split("\n");
    expect(lines.find((l) => l.startsWith("- 결과가 오류면"))).toBe("- 결과가 오류면 틀린 단계마다 번호와 까닭이 온다. 그 단계를 모두 고친 계획 전체를 submit_plan으로 다시 낸다. 답 글은 쓰지 않는다.");
    expect(lines.find((l) => l.startsWith("- place:"))).toContain(`물건 조건({"object": …})은 모두 follow: true로 쓴다. person_holding에는 follow를 쓰지 않는다.`);
    expect(SUBMIT_ARGS.shape.steps.element.shape.until.description).toContain(`물건 조건({"object": …})은 모두 follow: true(person_holding에는 쓰지 않음)`);
  });
});

describe("until 모양 오류의 자리(conditionProblems)", () => {
  it("합집합 오류(「Invalid input」)를 그 자리 조건 종류의 까닭으로 내려가 말한다", () => {
    // 2026-11-18 전: 놓기 조건 안 한 칸의 자리 사실 값이 틀리면 「(전체): Invalid input」만 돌려줘 어디를 고칠지 몰랐다
    expect(conditionProblems({ all: [{ any: [{ object: "cup_1", follow: true, facts: { place: "in_basin" } }] }, { not: { person_holding: "cup_1" } }] }))
      .toEqual(["all.0.any.0.facts.place: 조건 낱말에 없는 값 \"in_basin\""]);
    expect(conditionProblems({ object: "cup_1", follow: true, facts: { place: "in_sink" }, room: "kitchen" })).toEqual(["(전체): 쓰지 않는 키 room"]);
    expect(conditionProblems({ any: [{ object: "cup_1", follow: true, facts: { place: "in_hand" } }, { person_holding: "cup", follow: true }] })).toEqual(["any.1: 쓰지 않는 키 follow"]);
    expect(conditionProblems({ phone_near: "table_1" })).toEqual([]);
  });

  it("계획 검사의 until 오류도 그 자리를 말한다", () => {
    const steps = cupSteps(IDS);
    const bad = JSON.parse(JSON.stringify(steps).replace('"in_sink"', '"in_basin"')) as Record<string, unknown>[];
    const r = new PlanDraft(ctx()).submit({ steps: bad });
    expect(r.ok ? "" : r.error).toMatch(/^4번 단계: until이 조건 낱말 모양이 아닙니다: all\.0\.any\.0\.facts\.place: 조건 낱말에 없는 값 "in_basin"/);
  });
});

describe("계획 모드 차례 기록(onRound)", () => {
  const run = async (turns: PlanScript) => {
    const rounds: PlanRound[] = [];
    llm.scripts["컵 치우기"] = turns;
    const r = await new Planner({ provider: llm.provider(), onRound: (x) => rounds.push(x) }).plan(ctx());
    return { r, rounds };
  };

  it("차례마다 계획 id·할 일·차례 번호·시간·토큰·모델이 낸 단계·버린 까닭(통과면 null)·마지막 차례인지를 낸다", async () => {
    const { r, rounds } = await run((input) => {
      const steps = cupSteps(idsFrom(input));
      return [planCalls([steps[0]!, { ...steps[1]!, act: "넣기" }, steps[2]!, steps[3]!]), planCalls(steps)];
    });
    expect(r.ok).toBe(true);
    expect(rounds).toHaveLength(2);
    expect(rounds[0]).toMatchObject({ plan: "plan:pam-5", task: "컵 치우기", n: 1, rounds: 3, last: false, usage: { input: 10, output: 5 } });
    expect(rounds[0]!.error).toMatch(/^2번 단계: pick에는 act 넣기를 쓰지 않습니다/);
    expect(rounds[0]!.error).not.toContain("submit_plan");
    expect((rounds[0]!.steps as { act?: string }[]).map((s) => s.act)).toEqual(["가기", "넣기", "가기", "넣기"]);
    expect(rounds[0]!.ms).toBeGreaterThanOrEqual(0);
    expect(rounds[1]).toMatchObject({ n: 2, error: null, last: true });
  });

  it("세 차례 다 틀리면 세 차례를 다 내고, 마지막 차례에 last가 참이다. 답 글만 낸 차례도 센다", async () => {
    const { r, rounds } = await run((input) => {
      const steps = cupSteps(idsFrom(input));
      const bad = planCalls([steps[0]!, { ...steps[1]!, act: "넣기" }, steps[2]!, steps[3]!]);
      return [bad, "글 답", bad];
    });
    expect(r).toMatchObject({ ok: false, error: "모델 차례 3번 안에 맞는 계획을 내지 못함" });
    expect(rounds.map((x) => [x.n, x.last, x.error === null])).toEqual([[1, false, false], [2, false, false], [3, true, false]]);
    expect(rounds[1]).toMatchObject({ steps: null, error: "submit_plan 없이 답 글만 냄" });
  });

  it("로그 줄은 차례·시간·토큰·버린 까닭·낸 단계와 틀린 단계 JSON이고, 기록 줄은 차례·시간·까닭이다", () => {
    const steps = followOnHeld(cupSteps(IDS));
    const round: PlanRound = {
      plan: "plan:goal-1", task: "컵 치우기", n: 1, rounds: 3, ms: 2412, usage: { model: "m", input: 6100, cached: 4000, output: 900, reasoning: 300 },
      steps, error: "2번 단계: until: …. 4번 단계: until: ….", last: false,
    };
    const line = planRoundLine(round);
    expect(line).toMatch(/^\[계획 모드\] plan:goal-1 컵 치우기 1\/3차례 2\.4초 · 토큰 입력 6100\(캐시 4000\)·출력 900\(생각 300\) · 버림 · 2번 단계: until: …\. 4번 단계: until: …\./);
    expect(line).toContain(" · 낸 단계: go 가기 table_1 / pick 들기 cup_1 / go 가기 sink_1 / place 넣기 sink_1 cup_1");
    expect(line).toContain(` · 틀린 단계 2: ${JSON.stringify(steps[1])}`);
    expect(line).toContain(` · 틀린 단계 4: ${JSON.stringify(steps[3])}`);
    expect(planRoundText(round)).toBe("계획 모드 1/3차례 2.4초 · 버림 · 2번 단계: until: …. 4번 단계: until: ….");
    expect(planRoundText({ ...round, n: 3, last: true })).toBe("계획 모드 3/3차례 2.4초 · 버림 · 2번 단계: until: …. 4번 단계: until: …. · 못 냄");
    expect(planRoundText({ ...round, error: null, last: true })).toBe("계획 모드 1/3차례 2.4초 · 통과");
    expect(planRoundLine({ ...round, usage: null, error: null, steps: null })).toBe("[계획 모드] plan:goal-1 컵 치우기 1/3차례 2.4초 · 토큰 모름 · 통과");
  });
});
