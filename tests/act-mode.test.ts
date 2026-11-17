// 모드 정하기 한 곳(src/act/mode.ts, 2026-11-18 사용자 결정): 평소에는 눈치 모드다. 코치 모드는 비상(쓰러짐 의심·켠 위험 가전 끄기 안내가 유효)이거나
// 사람이 말로 코치 행동을 부탁해 그 코치 계획이 열려 있을 때만이고, 그 계획이 끝나고 비상이 풀리면 눈치 모드로 돌아온다. PAM 행동 목록은 모드를 따른다.
import { describe, expect, it } from "vitest";
import { modeNow, pamTasks } from "../src/act/mode.js";
import { TASK_NAMES, TASKS, tasksFor } from "../src/act/tasks.js";
import type { PlanView } from "../src/contract/plan.js";
import type { WorldView } from "../src/contract/world.js";
import { POSE_FALL } from "../src/world/vocab.js";

const fallen = { person: { facts: { posture: { value: POSE_FALL } } } } as unknown as WorldView;
const sitting = { person: { facts: { posture: { value: "sitting" } } } } as unknown as WorldView;
const calm = { world: sitting, offNotices: [] as string[], coaching: false };
const COACH = TASK_NAMES.filter((n) => TASKS[n]!.coach);

describe("지금 모드(modeNow)", () => {
  it("평소에는 눈치 모드다: 사람이 있어도, 눈치 행동을 골라도", () => {
    expect(modeNow(calm)).toBe("noonchi");
    expect(modeNow({ ...calm, world: null })).toBe("noonchi");
    expect(modeNow({ ...calm, action: "컵 치우기" })).toBe("noonchi");
    expect(modeNow({ ...calm, action: null })).toBe("noonchi");
  });

  it("비상이면 코치 모드다: 쓰러짐 의심, 켠 위험 가전 끄기 안내가 떠 있거나 줄에서 기다림. 풀리면 눈치 모드로 돌아온다", () => {
    expect(modeNow({ ...calm, world: fallen })).toBe("coach");
    expect(modeNow({ ...calm, offNotices: ["induction_1"] })).toBe("coach");
    expect(modeNow({ ...calm, world: fallen, action: "컵 치우기" })).toBe("coach");
    expect(modeNow(calm)).toBe("noonchi");
  });

  it("코치 행동 계획이 열려 있거나 만드는 중이면 코치 모드고, 이번 판단이 코치 행동을 골랐으면 코치 모드다. 계획이 끝나면 눈치 모드로 돌아온다", () => {
    expect(modeNow({ ...calm, coaching: true })).toBe("coach");
    for (const action of COACH) expect(modeNow({ ...calm, action }), action).toBe("coach");
    expect(modeNow({ ...calm, coaching: false })).toBe("noonchi");
  });

  // 2026-11-18 전체 시험: 계획 방송(PlanHub)이 실행 추적이 그 계획을 받기(planned) 전에 말풍선을 다시 보게 해 코치 계획 시작에 눈치 → 코치 → 눈치 → 코치로 깜빡였다
  it("열린 계획(planned·running)의 행동이 코치 행동이면 코치 모드다(실행 추적이 그 계획을 받기 전 사이도). 닫힌 계획은 아니다", () => {
    const plan = (goal: string, status: PlanView["status"]) => ({ goal, status }) as PlanView;
    expect(modeNow({ ...calm, plan: plan("라면 끓이기 알려 주기", "planned") })).toBe("coach");
    expect(modeNow({ ...calm, plan: plan("라면 끓이기 알려 주기", "running") })).toBe("coach");
    expect(modeNow({ ...calm, plan: plan("라면 끓이기 알려 주기", "done") })).toBe("noonchi");
    expect(modeNow({ ...calm, plan: plan("컵 치우기", "running") })).toBe("noonchi");
    expect(modeNow({ ...calm, plan: null })).toBe("noonchi");
  });
});

describe("PAM 행동 목록(pamTasks)", () => {
  it("눈치 모드는 눈치 행동만이다. 사람이 방금 말했으면(관찰 텍스트에 들은 말) 말로 부탁한 코치 행동을 고를 수 있게 모든 행동이다(순서는 행동 목록 그대로)", () => {
    expect(pamTasks("noonchi", false)).toEqual(TASK_NAMES.filter((n) => !TASKS[n]!.coach));
    for (const c of COACH) expect(pamTasks("noonchi", false)).not.toContain(c);
    expect(pamTasks("noonchi", true)).toEqual([...TASK_NAMES]);
  });

  it("코치 모드는 코치 행동과 「사용자에게 물어보기」다(들은 말과 상관없음)", () => {
    expect(pamTasks("coach", false)).toEqual(tasksFor("coach"));
    expect(pamTasks("coach", true)).toEqual(tasksFor("coach"));
    expect(pamTasks("coach", false)).toEqual(TASK_NAMES.filter((n) => TASKS[n]!.coach || n === "사용자에게 물어보기"));
  });
});
