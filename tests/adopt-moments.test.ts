// 후보 발생마다 판정(src/brain/pam/adopt-moments.ts): 채택 셈(checkCandidate)과 같은 창 규칙. 판정을 세면 n·k·못 봄과 같다.
import { describe, expect, it } from "vitest";
import { checkCandidate, type CheckDay } from "../src/brain/pam/adopt.js";
import { candidateMoments } from "../src/brain/pam/adopt-moments.js";

const DAYS: (CheckDay & { asked?: number[] })[] = [
  { start: 0, end: 86_400, candidate: [100, 1000, 1100], action: [170, 1200], unseen: [], asked: [1200] },
  { start: 0, end: 86_400, candidate: [2000, 5000], action: [], unseen: [[4900, 5600]], answered: [2100] },
  { start: 0, end: 86_400, candidate: [8000], action: [8400], unseen: [] },
];

describe("후보 발생마다 판정", () => {
  it("창 안 행동은 따라옴(먼저 온 행동 시각, 답으로 센 행동이면 via answer), 같은 후보가 다시 나오면 창이 거기서 끝난다", () => {
    expect(candidateMoments(DAYS[0]!)).toEqual([
      { at: 100, verdict: "followed", action_at: 170, via: "person" },
      { at: 1000, verdict: "not_followed", action_at: null, via: null },
      { at: 1100, verdict: "followed", action_at: 1200, via: "answer" },
    ]);
    expect(candidateMoments(DAYS[1]!).map((m) => m.verdict)).toEqual(["answered_no", "unseen"]);
    expect(candidateMoments(DAYS[2]!).map((m) => m.verdict)).toEqual(["not_followed"]);
  });

  it("판정을 세면 채택 셈의 n·k·못 봄과 같다", () => {
    const all = DAYS.flatMap((d) => candidateMoments(d));
    const r = checkCandidate(DAYS);
    expect(all.filter((m) => m.verdict === "followed").length).toBe(r.k);
    expect(all.filter((m) => m.verdict !== "unseen").length).toBe(r.n);
    expect(all.filter((m) => m.verdict === "unseen").length).toBe(r.unknown);
  });
});
