// 통과한 «후보 + 맥락»으로 로봇 FSM 화살표 만들기(src/brain/pam/adopt.ts adoptedFsm의 ctxs 인자)와 맥락 탐색(findRules)을 잇는다.
import { describe, expect, it } from "vitest";
import type { Ctx } from "../src/contract/pam.js";
import { CUP_FSM_MEMORY, validateCandidateFsm, validateMemory, type FsmMemory } from "../src/brain/decision.js";
import { adoptKey, adoptedFsm, candidateFsmOf, findRules, type CtxDay } from "../src/brain/pam/adopt.js";

const LEAVE_ON = "사용자가 먹거나 마시기를 끝내고 다른 일로 넘어간다.";
const withClear = () => {
  const c = candidateFsmOf(CUP_FSM_MEMORY);
  c.states.find((s) => s.id === "drinking")!.rules.push({ to: "*", action: "컵 치우기", candidates: [{ on: LEAVE_ON }] });
  return c;
};
const drink = (m: FsmMemory) => m.states.find((s) => s.id === "drinking")!;
const KEY = adoptKey("drinking", "컵 치우기", { on: LEAVE_ON });

describe("맥락이 있는 로봇 FSM 화살표 만들기", () => {
  it("맥락 목록이 있으면 묻기 화살표는 그대로 두고 맥락마다 행동 화살표를 끝에 더한다", () => {
    const sat: Ctx = { dow: 5 }, sun: Ctx = { dow: 6 };
    const out = adoptedFsm(withClear(), new Set([KEY]), CUP_FSM_MEMORY, new Map([[KEY, [sat, sun]]]));
    const before = drink(CUP_FSM_MEMORY).next;
    expect(drink(out).next).toHaveLength(before.length + 2);
    expect(drink(out).next.slice(0, before.length)).toEqual(before);                  // 묻기를 포함해 예전 화살표는 그대로
    expect(drink(out).next.slice(before.length)).toEqual([
      { to: "*", on: LEAVE_ON, action: "컵 치우기", ctx: sat },
      { to: "*", on: LEAVE_ON, action: "컵 치우기", ctx: sun },
    ]);
    expect(validateMemory(out, "fsm")).toBe(out);
  });
  it("맥락 목록이 없거나 비어 있으면 예전과 같다(맥락 없는 화살표가 묻기 자리를 바꾼다)", () => {
    const plain = adoptedFsm(withClear(), new Set([KEY]), CUP_FSM_MEMORY);
    expect(drink(plain).next[0]).toEqual({ to: "*", on: LEAVE_ON, action: "컵 치우기" });
    expect(adoptedFsm(withClear(), new Set([KEY]), CUP_FSM_MEMORY, new Map([[KEY, []]]))).toEqual(plain);
  });
  it("사용자가 정한 습관과 같은 트리거 후보는 맥락이 있어도 넣지 않는다", () => {
    const water = CUP_FSM_MEMORY.states[0]!.next[1]!;
    const c = withClear();
    c.states[0]!.rules.push({ to: "drinking", action: "컵 치우기", candidates: [{ on: water.on, when: water.when! }] });
    const key = adoptKey("drinking", "컵 치우기", { on: water.on, when: water.when! });
    expect(adoptedFsm(c, new Set([key]), CUP_FSM_MEMORY, new Map([[key, [{ dow: 5 }]]]))).toEqual(CUP_FSM_MEMORY);
  });
  it("맥락만 다른 화살표는 후보 FSM으로 되돌릴 때 후보 하나로 합친다(후보는 서로 달라야 한다)", () => {
    const out = adoptedFsm(withClear(), new Set([KEY]), CUP_FSM_MEMORY, new Map([[KEY, [{ dow: 5 }, { dow: 6 }]]]));
    const back = candidateFsmOf(out);
    expect(back.states.find((s) => s.id === "drinking")!.rules).toEqual([{ to: "*", action: "컵 치우기", candidates: [{ on: LEAVE_ON }] }]);
    expect(() => validateCandidateFsm(back as never)).not.toThrow();
  });
});

describe("맥락 탐색 → 로봇 FSM", () => {
  const date = (i: number) => new Date(Date.UTC(2026, 9, 12 + i)).toISOString().slice(0, 10);
  const day = (i: number, hit: boolean): CtxDay => ({ date: date(i), start: 7 * 3600, end: 23 * 3600, candidate: [19 * 3600], action: hit ? [19 * 3600 + 120] : [], unseen: [] });
  it("토요일에만 하는 습관 4주 → 토요일 맥락 화살표 하나", () => {
    const days = Array.from({ length: 28 }, (_, i) => day(i, i % 7 === 5));
    const ctxs = findRules(days).flatMap((r) => (r.ctx ? [r.ctx] : []));
    expect(ctxs).toEqual([{ dow: 5 }]);
    const out = adoptedFsm(withClear(), new Set([KEY]), CUP_FSM_MEMORY, new Map([[KEY, ctxs]]));
    expect(drink(out).next.at(-1)).toEqual({ to: "*", on: LEAVE_ON, action: "컵 치우기", ctx: { dow: 5 } });
  });
});
