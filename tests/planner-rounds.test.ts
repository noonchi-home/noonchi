// 계획 모드 차례 기록(2026-11-18 tall e1: 미리 만들기가 「모델 차례 3번 안에 맞는 계획을 내지 못함」만 남겨 차례마다 무엇을 버렸는지 몰랐다),
// 한 차례에 틀린 단계를 모두 돌려주기(첫 틀린 단계만 돌려주면 단계마다 한 차례씩 써 3차례를 넘긴다), until 모양 오류의 자리.
// 모델은 같은 주소 자리의 가짜 OpenAI 서버가 도구 호출로 낸다(tests/helpers/planner.ts).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Planner, planRoundLine, planRoundText, type PlanRound } from "../src/agent/planner.js";
import { PLANNER_PROMPT, planInput } from "../src/agent/planInput.js";
import { PlanDraft, SUBMIT_ARGS, planTools, resubmit } from "../src/agent/planTools.js";
import { floorPlanFrom } from "../src/layout/route.js";
import type { DecisionRecord } from "../src/contract/events.js";
import type { WorldObject, WorldView } from "../src/contract/world.js";
import { conditionProblems } from "../src/world/conditions.js";
import { SMALL_SCENE, smallFloor } from "./helpers/floor.js";
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

// 2026-11-19 plan1 세 판 차례 기록(미리 만들기 cup_0): 첫 차례가 늘 act 없이 item "cup"을 냈고, item 오류는 36개 값 목록만 말해 다음 차례에 person_holding까지 「컵」으로 바꿨다.
// 방 id로 간 차례는 그 방 물건 8개 목록(식탁 없음)에서 탁자를 골라 컵이 없는 탁자로 가는 계획이 통과했다(tall: 「탁자로 가 주세요」, 판정 실패).
describe("plan1 차례 기록에서 찾은 첫 차례 실수", () => {
  const SCENE_TT = {
    ...SMALL_SCENE,
    objects: [
      ...SMALL_SCENE.objects.slice(0, 1), { id: "coffee_table_1", type: "coffee_table", room: "kitchen", plan: { position: [5, 3] } },
      { id: "microwave_1", type: "microwave", room: "kitchen", plan: { position: [7.6, 0.2] } }, ...SMALL_SCENE.objects.slice(1),
    ],
  };
  const ttCtx = (objects: WorldObject[] = [CUP]) => planContext({ decision: DECISION, world: { ...WORLD, objects }, floor: floorPlanFrom(structuredClone(SCENE_TT)), nowIso: "t" });
  /** plan1 glass 1차례(act 없음, item "cup")를 이 집 id로. */
  const sloppy = () => cupSteps(IDS).map((s) => {
    const { act: _act, ...rest } = s;
    return s.kind === "pick" || s.kind === "place" ? { ...rest, object: "cup_1", item: "cup" } : rest;
  });

  // 세 판 첫 차례가 모두 사람 단계에 act를 쓰지 않고 item "cup"을 냈다: 지시문의 item 줄 「(그 종류 이름을 쓴다)」·도구 설명 「없으면 … 종류 이름」을
  // 「종류 이름을 item에 쓴다」로 읽었고, 예는 「go 가기 table_1」 줄임꼴이라 act 칸이 보이지 않았다
  it("지시문·도구 설명은 사람 단계마다 act를 꼭 쓰고 World State 물건 pick·place에는 item을 쓰지 않는다고 말하고, 예는 submit_plan steps 한 칸 JSON 그대로다", () => {
    const lines = PLANNER_PROMPT.split("\n");
    expect(lines.find((l) => l.startsWith("- act"))).toMatch(/^- act는 사람 단계\(go·pick·place·do\)마다 꼭 쓴다: go 가기 /);
    const item = lines.find((l) => l.startsWith("- item"))!;
    expect(item).toContain("pick·place가 World State 물건이면 item을 쓰지 않는다(서버가 그 물건 종류 이름으로 부른다).");
    expect(item).not.toContain("그 종류 이름을 쓴다");
    const shape = SUBMIT_ARGS.shape.steps.element.shape;
    expect(shape.act.description).toMatch(/^사람 단계\(go·pick·place·do\)마다 꼭 쓴다: /);
    expect(shape.item.description).toContain("pick·place가 World State 물건이면 쓰지 않는다(서버가 그 물건 종류 이름으로 부른다)");
    expect(shape.item.description).not.toContain("없으면 object·target 물건의 종류 이름");
    // 예: 번호 뒤가 submit_plan steps 한 칸 JSON이고 시험 대본과 같다(사람 단계는 act가 있고 World State 물건 집기·놓기에 item이 없다)
    const at = lines.indexOf("예(컵 치우기, 식탁 table_1 위 컵 cup_1, 싱크볼이 있는 싱크대 sink_1). submit_plan steps:");
    expect(at).toBeGreaterThan(0);
    const example = lines.slice(at + 1, at + 5).map((l) => JSON.parse(l.replace(/^\d\. /, "")) as Record<string, unknown>);
    expect(example).toEqual(cupSteps({ table: "table_1", sink: "sink_1", cup: "cup_1" }));
    expect(example.every((s) => typeof s.act === "string" && s.item === undefined)).toBe(true);
  });

  it("[미리 세운 목표] 줄은 그때를 기다리거나 할지 묻는 단계를 넣지 말라고 한다(tall plan1 1차례 wait, mug 1차례 ask)", () => {
    const input = planInput({ ...ctx(), ahead: { trigger: "사용자가 컵을 두고 자리를 떠나 보이지 않는다.", on: null, object: "cup_1" } });
    expect(input).toContain("[미리 세운 목표] 목표 물건 cup_1. 사람이 아직 쓰는 중이다. 「사용자가 컵을 두고 자리를 떠나 보이지 않는다.」가 되면 서버가 이 계획을 시작한다. 그때를 기다리거나 할지 묻는 단계 없이 그 뒤에 할 단계만 계획하고, 물건은 cup_1만 쓴다.");
  });

  it("submit_plan 도구 설명도 틀린 단계마다 번호와 까닭이 한 번에 온다고 말한다", () => {
    const d = planTools(new PlanDraft(ctx()))[0]!.description;
    expect(d).toContain("틀린 단계마다 번호와 까닭을 한 번에 돌려주니");
    expect(d).not.toContain("첫 틀린 단계");
  });

  it("item이 물건 이름 목록에 없으면 값 목록 대신 그 값과 고칠 길(World State 물건이면 item을 뺀다)을 말하고, 같은 단계의 다른 틀린 칸(act 없음)도 함께 말한다", () => {
    const r = new PlanDraft(ctx()).submit({ steps: sloppy() });
    const error = r.ok ? "" : r.error;
    expect(error).not.toContain("Invalid option");
    expect(error).not.toContain("세탁물");
    expect(error).toMatch(/2번 단계: item: 물건 이름 목록에 없는 값 "cup"\(World State 물건을 집거나 놓으면 item을 쓰지 않는다\); pick에는 act가 있어야 합니다\./);
    expect(error).toMatch(/4번 단계: item: 물건 이름 목록에 없는 값 "cup"\(World State 물건을 집거나 놓으면 item을 쓰지 않는다\); place에는 act가 있어야 합니다\./);
    expect(error).toMatch(/1번 단계: go에는 act가 있어야 합니다\./);
  });

  it("go target이 방 id면 그 방 물건 목록 맨 앞에 World State 물건이 놓인 면을 둔다", () => {
    const steps = cupSteps(IDS);
    const r = new PlanDraft(ttCtx()).submit({ steps: [{ ...steps[0]!, target: "kitchen", until: { phone_near: "kitchen" } }, ...steps.slice(1)] });
    expect(r.ok ? "" : r.error).toMatch(/^1번 단계: go target은 평면도 물건 id여야 합니다\(방 id 아님\): kitchen\. 그 방 물건: table_1, /);
  });

  it("집기 앞 가기는 그 물건이 놓인 자리로 간다: 다른 면으로 가는 계획은 버리고 그 자리 id를 말한다(다시 내기 검사도 같다)", () => {
    const steps = cupSteps(IDS);
    const wrong = [{ ...steps[0]!, target: "coffee_table_1", until: { phone_near: "coffee_table_1" } }, ...steps.slice(1)];
    const r = new PlanDraft(ttCtx()).submit({ steps: wrong });
    expect(r.ok ? "" : r.error).toMatch(/^1번 go target\(coffee_table_1\)은 2번에서 집을 물건 cup_1이 놓인 자리가 아닙니다\. 그 자리 table_1로 가세요\./);
    expect(new PlanDraft(ttCtx()).submit({ steps }).ok).toBe(true);
    // 미리 만든 계획을 다시 낼 때 컵이 다른 면에 있으면 그 계획을 쓰지 않는다
    const made = new PlanDraft(ttCtx()).submit({ steps });
    if (!made.ok) throw new Error(made.error);
    const moved = resubmit(made.plan, ttCtx([{ ...CUP, surface: "coffee_table_1", surface_label: "탁자", position: [5, 0.45, 3] }]));
    expect(moved.ok ? "" : moved.error).toMatch(/^1번 go target\(table_1\)은 2번에서 집을 물건 cup_1이 놓인 자리가 아닙니다\. 그 자리 coffee_table_1로 가세요\./);
  });

  // Codex 검토(2fa3bbb..59d8570 P2): 처음 World State 면으로만 견줘, 앞 단계에서 옮긴 물건을 다시 집는 정상 계획을 「처음 면으로 가세요」로 버렸다
  describe("계획 안에서 물건 자리를 이어 간다: 처음 집기는 World State 면, 다시 집기는 앞 놓기 자리", () => {
    const steps = cupSteps(IDS);
    const pick = steps[1]!;
    const until = (to: string) => ({ phone_near: to });
    /** 식탁 컵을 탁자에 옮겨 놓고, 탁자에서 다시 집어 싱크대에 넣기. */
    const moveTwice = (repickFrom: string) => [
      steps[0]!, pick,
      { kind: "go", act: "가기", target: "coffee_table_1", until: until("coffee_table_1"), timeout_s: 120 },
      { kind: "place", act: "올리기", target: "coffee_table_1", object: "cup_1", timeout_s: 120 },
      ...(repickFrom === "coffee_table_1" ? [] : [{ kind: "go", act: "가기", target: repickFrom, until: until(repickFrom), timeout_s: 120 }]),
      pick, steps[2]!, steps[3]!,
    ];
    /** 식탁 컵을 전자레인지에 넣었다가 꺼내 싱크대에 넣기. */
    const inAndOut = [
      steps[0]!, pick,
      { kind: "go", act: "가기", target: "microwave_1", until: until("microwave_1"), timeout_s: 120 },
      { kind: "place", act: "넣기", target: "microwave_1", object: "cup_1", timeout_s: 120 },
      { ...pick, act: "꺼내기" }, steps[2]!, steps[3]!,
    ];

    it("옮겨 놓고 다시 옮기기: 탁자에서 다시 집는 계획은 받고, 다시 집으러 처음 면(식탁)으로 가면 앞 놓기 자리(탁자)를 말하며 버린다", () => {
      expect(new PlanDraft(ttCtx()).submit({ steps: moveTwice("coffee_table_1") })).toMatchObject({ ok: true });
      const r = new PlanDraft(ttCtx()).submit({ steps: moveTwice("table_1") });
      expect(r.ok ? "" : r.error).toMatch(/^5번 go target\(table_1\)은 6번에서 집을 물건 cup_1이 놓인 자리가 아닙니다\(4번에서 놓은 자리\)\. 그 자리 coffee_table_1로 가세요\./);
    });

    it("넣었다 꺼내기: 전자레인지에 넣은 컵을 그 자리에서 꺼내는 계획은 받는다", () => {
      const r = new PlanDraft(ttCtx()).submit({ steps: inAndOut });
      expect(r.ok ? "" : r.error).toBe("");
    });

    it("다시 내기(resubmit)도 같은 규칙: 지금 World State로 처음 집기만 견주고, 다시 집기는 앞 놓기 자리와 견준다", () => {
      for (const plan of [moveTwice("coffee_table_1"), inAndOut]) {
        const made = new PlanDraft(ttCtx()).submit({ steps: plan });
        if (!made.ok) throw new Error(made.error);
        expect(resubmit(made.plan, ttCtx())).toMatchObject({ ok: true });
        // 다시 낼 때 컵이 이미 탁자에 있으면 처음 가기(식탁)가 틀린다
        const moved = resubmit(made.plan, ttCtx([{ ...CUP, surface: "coffee_table_1", surface_label: "탁자", position: [5, 0.45, 3] }]));
        expect(moved.ok ? "" : moved.error).toMatch(/^1번 go target\(table_1\)은 2번에서 집을 물건 cup_1이 놓인 자리가 아닙니다\. 그 자리 coffee_table_1로 가세요\./);
      }
    });
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
