// 반성 뒤 검사(src/brain/history/habits.ts): 배운 화살표 줄(learnedEdges), 배우지 않는 행동 후보 빼기(settingsGuard), 후보 FSM 코드 검사(validateCandidateFsm).
import { describe, expect, it } from "vitest";
import { CUP_FSM_MEMORY, validateCandidateFsm } from "../src/brain/decision.js";
import { candidateFsmOf } from "../src/brain/pam/adopt.js";
import { learnedEdges, settingsGuard } from "../src/brain/history/habits.js";

describe("반성 뒤 검사(후보 FSM)", () => {
  it("배운 화살표는 행동 있는 화살표 가운데 전에 없던 것이다", () => {
    const proposed = structuredClone(CUP_FSM_MEMORY);
    proposed.states[0]!.next.push({ to: "away", on: "사용자가 외출하러 나간다.", action: "컵 치우기" });
    expect(learnedEdges(CUP_FSM_MEMORY, proposed)).toEqual([{ from: "drinking", to: "away", on: "사용자가 외출하러 나간다.", when: null, action: "컵 치우기" }]);
  });
  it("배우는 행동이 아닌 후보(코치·물 채우기)는 빼고 기록하고, 컵 치우기·에어컨 켜기 후보는 남긴다", () => {
    const c = candidateFsmOf(CUP_FSM_MEMORY);
    c.states.find((s) => s.id === "cooking")!.rules.push({ to: "cooking", action: "라면 끓이기 알려 주기", candidates: [{ on: "라면 얘기를 한다." }] });
    c.states.find((s) => s.id === "drinking")!.rules.push(
      { to: "drinking", action: "컵에 물 채워 주기", candidates: [{ on: "사용자가 물을 다 마신다." }] },
      { to: "*", action: "컵 치우기", candidates: [{ on: "사용자가 먹거나 마시기를 끝내고 다른 일로 넘어간다." }] },
    );
    c.states.find((s) => s.id === "away")!.rules.push({ to: "watching_tv", action: "에어컨 켜기", candidates: [{ on: "사용자가 돌아와 TV를 본다." }] });
    const out = settingsGuard(c);
    expect(out.candidates.states.flatMap((s) => s.rules.map((r) => r.action))).toEqual(["컵 치우기", "에어컨 켜기"]);
    expect(out.notes).toEqual(expect.arrayContaining([
      expect.objectContaining({ from: "cooking", on: "라면 얘기를 한다.", kept: false, reason: "coach" }),
      expect.objectContaining({ from: "drinking", on: "사용자가 물을 다 마신다.", kept: false, reason: "settings" }),
    ]));
  });
  it("반성이 seed 상태 id를 바꾸거나 빼거나, seed 상태의 하는 일 값을 옮기면 코드 검사가 거절한다(정한 습관이 붙는 상태가 바뀌지 않게)", () => {
    const renamed = candidateFsmOf(CUP_FSM_MEMORY);
    renamed.states.find((s) => s.id === "cooking")!.id = "making_food";
    for (const s of renamed.states) for (const e of s.next) if (e.to === "cooking") e.to = "making_food";
    expect(() => validateCandidateFsm(renamed, CUP_FSM_MEMORY)).toThrow(/seed state 'cooking' is required/);
    const moved = candidateFsmOf(CUP_FSM_MEMORY);
    moved.states.find((s) => s.id === "watching_tv")!.activity = [];
    moved.states.push({ id: "tv_time", description: "사용자가 TV를 본다.", activity: ["watching_tv"], next: [], rules: [] });
    expect(() => validateCandidateFsm(moved, CUP_FSM_MEMORY)).toThrow(/activity of seed state 'watching_tv' must stay/);
  });
  it("후보 FSM 코드 검사(석준 님 validate_candidate_memory를 화살표 모양으로): 후보 1~3개·서로 다름, (출발, 행동)마다 규칙 하나, 같은 (사건·조건) 하나, 옛 모양(rules[{trigger}])은 칸이 틀림", () => {
    const base = () => candidateFsmOf(CUP_FSM_MEMORY);
    expect(validateCandidateFsm(base(), CUP_FSM_MEMORY)).toEqual(base());
    const drink = (c: ReturnType<typeof base>) => c.states.find((s) => s.id === "drinking")!;
    const four = base(); drink(four).rules.push({ to: "*", action: "컵 치우기", candidates: [{ on: "a" }, { on: "b" }, { on: "c" }, { on: "d" }] });
    expect(() => validateCandidateFsm(four, CUP_FSM_MEMORY)).toThrow(/expected 1 to 3 candidates/);
    const same = base(); drink(same).rules.push({ to: "*", action: "컵 치우기", candidates: [{ on: "a" }, { on: "a" }] });
    expect(() => validateCandidateFsm(same, CUP_FSM_MEMORY)).toThrow(/candidates must differ/);
    const twice = base(); drink(twice).rules.push({ to: "*", action: "컵 치우기", candidates: [{ on: "a" }] }, { to: "away", action: "컵 치우기", candidates: [{ on: "b" }] });
    expect(() => validateCandidateFsm(twice, CUP_FSM_MEMORY)).toThrow(/one rule per action/);
    const clash = base(); drink(clash).rules.push({ to: "*", action: "컵 치우기", candidates: [{ on: "사용자가 요리를 마치고 먹기 시작한다." }] });
    drink(clash).next.push({ to: "cooking", on: "사용자가 요리를 마치고 먹기 시작한다." });
    expect(() => validateCandidateFsm(clash, CUP_FSM_MEMORY)).toThrow(/duplicate transition/);
    const old = { initial_state: "away", states: [{ id: "away", description: "d", rules: [{ trigger: "t", action: "컵 치우기" }], next: [] }] };
    expect(() => validateCandidateFsm(old, CUP_FSM_MEMORY)).toThrow(/incorrect fields/);
    expect(() => validateCandidateFsm(CUP_FSM_MEMORY, CUP_FSM_MEMORY)).toThrow(/incorrect fields/);
  });
});
