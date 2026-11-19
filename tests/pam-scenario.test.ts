// PAM 반성 지시문 바꾸기(src/brain/pam/scenarios/noonchi/scenario.json)의 행동 이름 줄은 우리 행동 목록(src/act/tasks.ts)과 같아야 한다.
// 반성이 낸 규칙의 행동은 이 이름 그대로여야 판단이 고를 수 있고, 코치 행동은 반성이 손대지 않게 따로 적는다.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { TASK_NAMES, TASKS } from "../src/act/tasks.js";

const scenario = JSON.parse(readFileSync("src/brain/pam/scenarios/noonchi/scenario.json", "utf8")) as { prompt_replacements: { old: string; new: string }[] };
const ACTION = "- action: exactly one of these task names, copied character for character: ";
const COACH = "- Coaching tasks (";
const lineOf = (head: string) => scenario.prompt_replacements.flatMap((c) => c.new.split("\n")).find((l) => l.startsWith(head));

describe("반성 지시문의 행동 이름 줄", () => {
  it("행동 이름 줄이 TASK_NAMES 전부를 그 순서로 담는다", () => {
    const line = lineOf(ACTION);
    expect(line, "행동 이름 줄").toBeDefined();
    const names = line!.slice(ACTION.length).split(". ")[0]!.split(", ");
    expect(names).toEqual([...TASK_NAMES]);
  });

  it("코치 행동 줄이 coach: true인 행동 전부를 담는다", () => {
    const line = lineOf(COACH);
    expect(line, "코치 행동 줄").toBeDefined();
    const names = line!.slice(COACH.length, line!.indexOf(")")).split(", ");
    expect(names).toEqual(TASK_NAMES.filter((n) => TASKS[n]!.coach));
  });
});

// 판단 지시문(사람 상태 FSM 답 칸). 2026-11-19 실제 모델(wide-glass pfsm1): 사람이 떠난 직후 「state away, from drinking, next_index -1」로 답해 판단 실패가 났고
// 다음 판단에서야 컵 치우기 화살표가 나와 첫 명령이 한 판(약 2.5초) 늦었다. 화살표는 모델이 정한다(서버가 대신 고르지 않는다)
describe("판단 지시문의 화살표 쓰는 법", () => {
  const all = scenario.prompt_replacements.map((c) => c.new).join("\n");
  it("지금 상태가 직전 상태와 다르면 직전 상태의 화살표(도착이 지금 상태이거나 *)가 일어난 것으로 답하게 한다", () => {
    expect(all).toContain("When the current state differs from the previous state, the person's activity changed, so a transition of the previous state happened: answer the one whose `to` is the current state or '*'");
  });
  it("화살표가 없으면 from은 직전 상태가 아니라 null이다", () => {
    expect(all).toContain("When no transition happened, `from` is null (not the previous state) and `next_index` is -1.");
  });
});
