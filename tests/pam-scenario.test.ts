// PAM 반성 지시문 바꾸기(services/pam/scenarios/noonchi/scenario.json)의 행동 이름 줄은 우리 행동 목록(src/act/tasks.ts)과 같아야 한다.
// 반성이 낸 규칙의 행동은 이 이름 그대로여야 판단이 고를 수 있고, 코치 행동은 반성이 손대지 않게 따로 적는다.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { TASK_NAMES, TASKS } from "../src/act/tasks.js";

const scenario = JSON.parse(readFileSync("services/pam/scenarios/noonchi/scenario.json", "utf8")) as { prompt_replacements: { old: string; new: string }[] };
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
