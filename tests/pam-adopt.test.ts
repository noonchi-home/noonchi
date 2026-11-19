// 반성 후보의 채택 검사(src/brain/pam/adopt.ts): 석준 님 ai 저장소 pam/trigger_check.py(origin/main 48d56a1)와 tests/test_trigger_check.py의 경우를 그대로 옮겨 같은 답인지 본다.
// 시각은 자정부터 초. 채택(c → a) ⇔ k/n ≥ 0.75 이고 단측 이항검정 P(X ≥ k; n, p0) < 0.001, p0 = max(다른 때 비율, 0.01).
// 로봇 FSM 만들기는 석준 님 predictor_fsm을 사람 상태 FSM 화살표로 옮긴 것이다(통과 후보마다 화살표 하나, 같은 트리거의 묻기 자리를 바꿈).
import { describe, expect, it } from "vitest";
import { CUP_FSM_MEMORY, validateMemory, type FsmMemory } from "../src/brain/decision.js";
import { adoptKey, adoptedFsm, binomialTail, candidateFsmOf, checkCandidate, type CheckDay } from "../src/brain/pam/adopt.js";
import { LEARNED_FSM_MEMORY } from "../scripts/learned-memory.js";

const t = (s: string) => { const [h, m, x] = s.split(":").map(Number); return h! * 3600 + m! * 60 + x!; };
const day = (candidate: string[] = [], action: string[] = [], unseen: [string, string][] = [], start = "07:00:00", end = "08:00:00"): CheckDay =>
  ({ start: t(start), end: t(end), candidate: candidate.map(t), action: action.map(t), unseen: unseen.map(([a, b]) => [t(a), t(b)]) });
const FOLLOWED = day(["07:10:00"], ["07:13:00"]);
const MISSED = day(["07:10:00"], []);
const close = (a: number, b: number, rel = 1e-6) => expect(Math.abs(a - b) <= rel * Math.max(Math.abs(a), Math.abs(b))).toBe(true);

describe("채택 검사(석준 님 trigger_check 그대로)", () => {
  it("이항 꼬리 확률", () => {
    for (const [[k, n, p], want] of [[[2, 2, 0.01], 1e-4], [[6, 7, 0.01], 6.94e-12], [[4, 5, 0.2], 0.00672], [[9, 10, 0.8], 0.3758096384], [[0, 3, 0.5], 1.0]] as const) close(binomialTail(k, n, p), want);
  });
  it("따라온 이틀은 바닥값으로 통과, 하루는 모자람", () => {
    const two = checkCandidate([FOLLOWED, FOLLOWED]);
    expect([two.n, two.k, two.unknown, two.base_rate, two.p0, two.passed]).toEqual([2, 2, 0, 0, 0.01, true]);
    close(two.p_value, 1e-4, 1e-9);
    const one = checkCandidate([FOLLOWED]);
    expect([one.rate, one.passed]).toEqual([1, false]);
    close(one.p_value, 0.01, 1e-9);
  });
  it("5분은 세고 2초 뒤는 안 센다, 후보 앞 행동은 안 센다", () => {
    expect(checkCandidate([day(["07:10:00"], ["07:15:00"])]).k).toBe(1);
    expect(checkCandidate([day(["07:10:00"], ["07:15:02"])]).k).toBe(0);
    expect(checkCandidate([day(["07:10:00"], ["07:09:00"])])).toMatchObject({ n: 1, k: 0 });
  });
  it("안 보인 창에 행동이 없으면 못 봄", () => {
    const gone = day(["12:30:00"], [], [["12:30:04", "17:00:00"]], "12:00:00", "17:00:00");
    const seen = day(["12:30:00"], ["12:32:00"], [["12:32:06", "17:00:00"]], "12:00:00", "17:00:00");
    expect(checkCandidate([gone, seen])).toMatchObject({ n: 1, k: 1, unknown: 1 });
  });
  it("다른 때 비율은 다른 칸에서, 안 보인 칸은 뺀다", () => {
    const r = checkCandidate([day(["07:00:00"], ["07:03:00", "07:21:00", "07:41:00"])]);
    expect([r.n, r.k, r.passed]).toEqual([1, 1, false]);
    close(r.base_rate, 0.2); close(r.p0, 0.2); close(r.p_value, 0.2);
    close(checkCandidate([day(["07:00:00"], ["07:03:00", "07:12:00"], [["07:30:00", "08:00:00"]])]).base_rate, 0.25);
  });
  it("75%는 통과, 2/3는 아님", () => {
    const four = checkCandidate([FOLLOWED, FOLLOWED, FOLLOWED, MISSED]);
    expect([four.rate, four.passed]).toEqual([0.75, true]);
    const three = checkCandidate([FOLLOWED, FOLLOWED, MISSED]);
    close(three.rate, 2 / 3); expect(three.passed).toBe(false);
  });
  it("잦은 행동은 일곱째 밤에야 통과", () => {
    const week = [1, 2, 3, 4, 5, 6, 7].map((n) => day(["07:00:00"], [...(n === 3 ? [] : ["07:03:00"]), "07:21:00", "07:41:00"]));
    const n6 = checkCandidate(week.slice(0, 6)), n7 = checkCandidate(week);
    close(n6.p_value, 0.0016); expect(n6.passed).toBe(false);
    close(n7.p_value, 0.0003712); expect(n7.passed).toBe(true);
  });
  it("행동 앞 마지막 후보만 공로, 저마다 행동이 따라오면 모두 셈, 본 되풀이는 앞 것을 안 따라온 것으로 끝낸다", () => {
    expect(checkCandidate([day(["07:10:00", "07:11:00", "07:12:00"], ["07:14:00"])])).toMatchObject({ n: 3, k: 1, passed: false });
    expect(checkCandidate([day(["07:10:00", "07:20:00", "07:30:00"], ["07:12:00", "07:22:00", "07:32:00"])])).toMatchObject({ n: 3, k: 3 });
    expect(checkCandidate([day(["12:30:00", "12:31:00"], [], [["12:31:10", "17:00:00"]], "12:00:00", "17:00:00")])).toMatchObject({ n: 1, k: 0, unknown: 1 });
  });
  it("로봇이 그 일을 한 구간(unseen에 더함)에 사람 행동·답이 없으면 못 봄, 「그대로 둬요」 답(answered)이 있는 창은 안 보였어도 따라오지 않은 것(이 계획이 더한 칸)", () => {
    const robot = day(["08:00:00"], [], [["08:00:03", "08:01:40"]], "07:30:00", "09:00:00");   // 떠남 → 로봇이 바로 치움(running → done)
    expect(checkCandidate([FOLLOWED, FOLLOWED, robot])).toMatchObject({ n: 2, k: 2, unknown: 1, passed: true });
    const keep: CheckDay = { ...day(["08:00:00"], [], [["08:00:01", "09:00:00"]], "07:30:00", "09:00:00"), answered: [t("08:01:30")] };   // 떠나서 안 보임 + 「그대로 둬요」
    expect(checkCandidate([keep])).toMatchObject({ n: 1, k: 0, unknown: 0 });
    expect(checkCandidate([{ ...keep, answered: [] }])).toMatchObject({ n: 0, unknown: 1 });
  });
  it("1분 창은 그다음 1분만 세고 다른 때 칸도 1분이다, 한 번도 없으면 통과 못 함", () => {
    const late = day(["07:10:00"], ["07:11:30"]);
    expect(checkCandidate([late]).k).toBe(1);
    expect(checkCandidate([late], 60).k).toBe(0);
    expect(checkCandidate([day(["07:10:00"], ["07:10:59"])], 60).k).toBe(1);
    close(checkCandidate([day(["07:00:00"], ["07:00:30", "07:05:10"], [], "07:00:00", "07:10:00")], 60).base_rate, 1 / 8);
    expect(checkCandidate([day([], ["07:13:00"])])).toMatchObject({ n: 0, passed: false });
    expect(() => checkCandidate([FOLLOWED], 0)).toThrow(/positive whole number/);
  });
});

describe("로봇 FSM 만들기(석준 님 predictor_fsm을 화살표로)", () => {
  const LEAVE_ON = "사용자가 먹거나 마시기를 끝내고 다른 일로 넘어간다.";
  const withClear = () => {
    const c = candidateFsmOf(CUP_FSM_MEMORY);   // seed를 후보 FSM 모양으로: seed 행동 화살표는 rules에 들지 않는다
    c.states.find((s) => s.id === "drinking")!.rules.push({ to: "*", action: "컵 치우기", candidates: [{ on: LEAVE_ON }, { on: "사용자가 외출하러 나간다." }] });
    return c;
  };
  it("통과 전에는 seed 그대로(떠날 때 묻기), 통과하면 같은 트리거의 묻기 화살표 자리가 컵 치우기가 되어 배운 뒤 기억과 같다. 후보 FSM은 그대로다", () => {
    const c = withClear();
    const before = structuredClone(c);
    expect(adoptedFsm(c, new Set(), CUP_FSM_MEMORY)).toEqual(CUP_FSM_MEMORY);
    const out = adoptedFsm(c, new Set([adoptKey("drinking", "컵 치우기", { on: LEAVE_ON })]), CUP_FSM_MEMORY);
    expect(out).toEqual(LEARNED_FSM_MEMORY);
    expect(validateMemory(out, "fsm")).toBe(out);
    expect(c).toEqual(before);
  });
  it("다른 트리거 후보는 끝에 더하고 묻기 화살표는 남는다. 사용자가 정한 습관 화살표는 후보가 없어도 늘 그대로다", () => {
    const out = adoptedFsm(withClear(), new Set([adoptKey("drinking", "컵 치우기", { on: "사용자가 외출하러 나간다." })]), CUP_FSM_MEMORY);
    const drink = out.states.find((s) => s.id === "drinking")!;
    expect(drink.next.map((e) => e.action ?? null)).toEqual(["사용자에게 물어보기", "컵에 물 채워 주기", "컵 치우기"]);
    expect(drink.next.at(-1)).toEqual({ to: "*", on: "사용자가 외출하러 나간다.", action: "컵 치우기" });
    const settings = (m: FsmMemory) => m.states.flatMap((s) => s.next.filter((e) => e.action && e.action !== "사용자에게 물어보기" && e.action !== "컵 치우기"));
    expect(settings(out)).toEqual(settings(CUP_FSM_MEMORY));
  });
  it("사용자가 정한 습관과 같은 트리거인 후보, 배우는 행동이 아닌 후보는 통과로 와도 넣지 않는다", () => {
    const c = withClear();
    const water = CUP_FSM_MEMORY.states[0]!.next[1]!;
    // 같은 트리거 = 같은 사건(on)과 조건(when): seed 물 채우기는 조건 「식탁에 앉아 있다.」가 있다
    const same = { on: water.on, when: water.when! };
    c.states[0]!.rules.push({ to: "drinking", action: "컵 치우기", candidates: [same] }, { to: "away", action: "컵에 콜라 따라 주기", candidates: [{ on: "사용자가 외출하러 나간다." }] });
    const out = adoptedFsm(c, new Set([adoptKey("drinking", "컵 치우기", same), adoptKey("drinking", "컵에 콜라 따라 주기", { on: "사용자가 외출하러 나간다." })]), CUP_FSM_MEMORY);
    expect(out).toEqual(CUP_FSM_MEMORY);
  });
  it("말없이 TV 보기 시작 → 에어컨 켜기 후보는 통과하면 자리에 없음의 진입 화살표에 그 자리에서 붙고, 덥다·부채질 → 에어컨(정한 습관)은 같은 트리거 후보가 와도 그대로다", () => {
    const away = (m: FsmMemory) => m.states.find((s) => s.id === "away")!;
    const enter = away(CUP_FSM_MEMORY).next.findIndex((e) => e.to === "watching_tv");
    const TV_START_ON = away(CUP_FSM_MEMORY).next[enter]!.on;   // 「사용자가 돌아와 TV를 본다.」
    const c = candidateFsmOf(CUP_FSM_MEMORY);
    const hot = CUP_FSM_MEMORY.states[1]!.next[1]!;
    c.states.find((s) => s.id === "away")!.rules.push({ to: "watching_tv", action: "에어컨 켜기", candidates: [{ on: TV_START_ON }] });
    c.states.find((s) => s.id === "watching_tv")!.rules.push({ to: "watching_tv", action: "에어컨 켜기", candidates: [{ on: hot.on }] });
    const out = adoptedFsm(c, new Set([adoptKey("away", "에어컨 켜기", { on: TV_START_ON }), adoptKey("watching_tv", "에어컨 켜기", { on: hot.on })]), CUP_FSM_MEMORY);
    expect(away(out).next[enter]).toEqual({ to: "watching_tv", on: TV_START_ON, action: "에어컨 켜기" });
    expect(away(out).next).toHaveLength(away(CUP_FSM_MEMORY).next.length);
    expect(out.states.find((s) => s.id === "watching_tv")!.next).toEqual(CUP_FSM_MEMORY.states[1]!.next);
  });
  it("후보 FSM이 seed 상태의 하는 일 값을 바꿔 와도 로봇 FSM의 seed 상태는 seed 하는 일 값을 쓴다(정한 습관이 붙는 상태가 바뀌지 않는다)", () => {
    const c = candidateFsmOf(CUP_FSM_MEMORY);
    c.states.find((s) => s.id === "watching_tv")!.activity = ["using_laptop"];
    expect(adoptedFsm(c, new Set(), CUP_FSM_MEMORY).states.find((s) => s.id === "watching_tv")!.activity).toEqual(["watching_tv"]);
  });
  it("후보 FSM 모양으로 바꾸기(candidateFsmOf): 행동 없는 화살표는 next로, seed가 아닌 행동 화살표는 후보 하나짜리 rules로", () => {
    const seed = candidateFsmOf(CUP_FSM_MEMORY);
    expect(seed.states.every((s) => s.rules.length === 0)).toBe(true);
    expect(seed.states.find((s) => s.id === "away")!.next).toEqual(CUP_FSM_MEMORY.states.find((s) => s.id === "away")!.next);
    expect(candidateFsmOf(LEARNED_FSM_MEMORY).states.find((s) => s.id === "drinking")!.rules).toEqual([{ to: "*", action: "컵 치우기", candidates: [{ on: LEAVE_ON }] }]);
  });
});
