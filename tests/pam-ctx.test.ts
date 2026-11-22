// 규칙 맥락 탐색(src/brain/pam/adopt.ts findRules): 맥락 없음 → 하나(요일·3시간 칸) → 둘(요일 + 시각 칸).
// 2026-11-22 사용자 결정: 비율 0.75 이상 + 우연일 확률 0.01 미만. 맥락 단계의 평소 비율은 남은 기회 전체(맥락 없을 때)의 따라온 비율이고,
// 통과한 것 가운데 맞힌 횟수가 가장 많은 규칙을 고르고 그 규칙이 다룬 기회를 빼고 다시 찾는다. 기대값은 모두 손으로 계산했다.
import { describe, expect, it } from "vitest";
import { checkCandidate, findRules, type CtxDay } from "../src/brain/pam/adopt.js";

const t = (s: string) => { const [h, m, x] = s.split(":").map(Number); return h! * 3600 + m! * 60 + (x ?? 0); };
/** 2026-10-12는 월요일이다. 날짜 i째(0부터). */
const date = (i: number) => new Date(Date.UTC(2026, 9, 12 + i)).toISOString().slice(0, 10);
const dow = (i: number) => i % 7;   // 월 0 … 일 6
/** 하루: 후보 시각들과 행동 시각들. 하루는 07:00~23:00. */
const day = (i: number, candidate: string[], action: string[] = []): CtxDay =>
  ({ date: date(i), start: t("07:00"), end: t("23:00"), candidate: candidate.map(t), action: action.map(t), unseen: [] });
const range = (n: number) => [...Array(n).keys()];
const close = (a: number, b: number, rel = 1e-6) => expect(Math.abs(a - b) <= rel * Math.max(Math.abs(a), Math.abs(b))).toBe(true);
const ctxs = (days: CtxDay[]) => findRules(days).filter((r) => r.ctx !== null).map((r) => r.ctx);

describe("맥락 탐색(findRules)", () => {
  it("매일 하는 습관은 맥락 없이 통과하고 거기서 멈춘다. checkCandidate와 같은 숫자", () => {
    const days = range(14).map((i) => day(i, ["19:00"], ["19:02"]));
    const rules = findRules(days);
    expect(rules).toHaveLength(1);
    expect(rules[0]).toMatchObject({ ctx: null, passed: true, n: 14, k: 14 });
    expect(rules[0]).toMatchObject(checkCandidate(days));
  });

  it("토요일에만 하는 습관: 4주(4번 중 4번, 평소 4/28)는 요일 토요일 하나로 통과, 3주는 겨우 통과, 2주는 탈락", () => {
    const week = (weeks: number) => range(weeks * 7).map((i) => day(i, ["19:00"], dow(i) === 5 ? ["19:02"] : []));
    const four = findRules(week(4));
    expect(four[0]).toMatchObject({ ctx: null, passed: false, n: 28, k: 4 });
    expect(four).toHaveLength(2);
    expect(four[1]).toMatchObject({ ctx: { dow: 5 }, n: 4, k: 4, passed: true });
    close(four[1]!.base_rate, 4 / 28); close(four[1]!.p_value, (4 / 28) ** 4);          // 0.14⁴ ≈ 0.00042
    const three = findRules(week(3));
    expect(three[1]).toMatchObject({ ctx: { dow: 5 }, n: 3, k: 3 });
    close(three[1]!.p_value, (3 / 21) ** 3);                                                // ≈ 0.0029 < 0.01
    expect(ctxs(week(2))).toEqual([]);                                                       // 0.143² ≈ 0.020
  });

  it("토요일·일요일 둘 다: 규칙이 요일마다 하나씩 나뉜다(토요일을 고르고 그 기회를 빼고 다시 찾아 일요일)", () => {
    const days = range(28).map((i) => day(i, ["19:00"], dow(i) >= 5 ? ["19:02"] : []));
    expect(ctxs(days)).toEqual([{ dow: 5 }, { dow: 6 }]);
    const rules = findRules(days);
    close(rules[1]!.base_rate, 8 / 28); close(rules[1]!.p_value, (8 / 28) ** 4);            // 토요일 4/4, 평소 29%
    close(rules[2]!.base_rate, 4 / 24); close(rules[2]!.p_value, (4 / 24) ** 4);            // 일요일: 토요일 4번을 뺀 24번 중 4번
  });

  it("월·수·금에만: 요일 하나씩은 증거가 4번뿐이라 4주로는 못 잡고(0.43⁴ ≈ 0.034) 6주에 셋 다 잡는다", () => {
    const mwf = (weeks: number) => range(weeks * 7).map((i) => day(i, ["19:00"], [0, 2, 4].includes(dow(i)) ? ["19:02"] : []));
    expect(ctxs(mwf(4))).toEqual([]);
    const six = findRules(mwf(6));
    expect(six.filter((r) => r.ctx).map((r) => r.ctx)).toEqual([{ dow: 0 }, { dow: 2 }, { dow: 4 }]);
    close(six[1]!.p_value, (18 / 42) ** 6);                                                  // 월요일 6/6, 평소 18/42 = 43% → 0.0062
  });

  it("아침·저녁에만 약을 먹는 사람: 시각 칸 하나씩 규칙 둘(6~9시, 18~21시)", () => {
    // 하루 물 8번(07:30·10:00·12:00·14:00·16:00·17:00·19:30·21:30), 약은 07:30과 19:30 뒤 2분
    const water = ["07:30", "10:00", "12:00", "14:00", "16:00", "17:00", "19:30", "21:30"];
    const days = range(14).map((i) => day(i, water, ["07:32", "19:32"]));
    const rules = findRules(days);
    expect(rules[0]).toMatchObject({ ctx: null, passed: false, n: 112, k: 28 });             // 25% < 75%
    expect(rules.slice(1).map((r) => [r.ctx, r.n, r.k])).toEqual([[{ slot: 2 }, 14, 14], [{ slot: 6 }, 14, 14]]);
    close(rules[1]!.base_rate, 28 / 112);
    close(rules[2]!.base_rate, 14 / 98);                                                      // 아침 14번을 빼고 남은 98번 중 14번
  });

  it("요일 하나·시각 하나로는 안 되고 둘이 함께여야 통과: 토요일 저녁에만(토요일 낮 TV는 맥주 없음)", () => {
    const days = range(28).map((i) => day(i, dow(i) === 5 ? ["14:00", "19:00"] : ["19:00"], dow(i) === 5 ? ["19:02"] : []));
    const rules = findRules(days);
    expect(rules[0]).toMatchObject({ passed: false, n: 32, k: 4 });
    expect(rules).toHaveLength(2);
    expect(rules[1]).toMatchObject({ ctx: { dow: 5, slot: 6 }, n: 4, k: 4 });
    close(rules[1]!.p_value, (4 / 32) ** 4);                                                  // 0.125⁴ ≈ 0.00024
  });

  it("맥락이 기회 전체와 같으면(평소와 다르지 않으면) 통과하지 못한다: 매일 절반만 따라오는 경우", () => {
    const days = range(28).map((i) => day(i, ["19:00"], i % 2 ? ["19:02"] : []));
    expect(ctxs(days)).toEqual([]);
  });

  it("못 본 회차는 세지 않는다: 안 보인 구간에 걸린 기회는 n에 안 들어간다", () => {
    const days = range(28).map((i) => ({ ...day(i, ["19:00"], dow(i) === 5 ? ["19:02"] : []), unseen: dow(i) === 2 ? [[t("19:00") + 1, t("22:00")] as [number, number]] : [] }));
    const rules = findRules(days);
    expect(rules[0]).toMatchObject({ n: 24, k: 4, unknown: 4 });                              // 수요일 4번은 못 봄
    expect(rules[1]).toMatchObject({ ctx: { dow: 5 }, n: 4, k: 4 });
  });

  it("같은 기록이면 같은 답이다(순서가 정해져 있다)", () => {
    const days = range(28).map((i) => day(i, ["19:00"], dow(i) >= 5 ? ["19:02"] : []));
    expect(findRules(days)).toEqual(findRules(days));
  });
});
