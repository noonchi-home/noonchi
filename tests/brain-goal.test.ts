// 미리 세울 목표 고르기(src/brain/goal.ts): 사람 상태 FSM의 지금 상태에서 나가는 화살표 가운데, 사람이 쓰는 종류에 손대는 「떠난 뒤 하는 일」(afterUse) 행동 하나를 고른다.
import { describe, expect, it } from "vitest";
import { goalAhead } from "../src/brain/goal.js";
import { CUP_FSM_MEMORY } from "../src/brain/decision.js";
import { TASKS, tasksFor } from "../src/act/tasks.js";
import { LEARNED_FSM_MEMORY, learnedFsm } from "../scripts/learned-memory.js";

describe("goalAhead (사람 상태 FSM)", () => {
  const tasks = tasksFor("noonchi");
  it("배운 뒤 기억에서 마시는 중이면 그 상태에서 나가는 배운 화살표의 손대는 다 쓴 뒤 행동(컵 치우기)을 고른다", () => {
    expect(goalAhead({ memory: LEARNED_FSM_MEMORY, kind: "fsm", state: "drinking", tasks, cls: "cup" })).toEqual({
      state: "drinking", index: 0, to: "*", on: "사용자가 먹거나 마시기를 끝내고 다른 일로 넘어간다.", when: null, action: "컵 치우기",
    });
  });
  it("배우기 전(seed)에는 떠날 때 화살표가 묻기라 목표를 세우지 않는다(목표는 배운 화살표에서만)", () => {
    expect(goalAhead({ memory: CUP_FSM_MEMORY, kind: "fsm", state: "drinking", tasks, cls: "cup" })).toBeNull();
    expect(goalAhead({ memory: CUP_FSM_MEMORY, kind: "fsm", state: "watching_tv", tasks, cls: "cup" })).toBeNull();
  });
  it("TV 보는 중에서도 그 상태의 컵 치우기를 배웠으면 세운다(옛 FSM은 처음 상태가 아니면 못 골랐다)", () => {
    expect(goalAhead({ memory: LEARNED_FSM_MEMORY, kind: "fsm", state: "watching_tv", tasks, cls: "cup" })).toBeNull();
    expect(goalAhead({ memory: learnedFsm(["drinking", "watching_tv"]), kind: "fsm", state: "watching_tv", tasks, cls: "cup" })).toMatchObject({ when: "같이 마시는 중이었다.", action: "컵 치우기" });
  });
  it("상태를 모르면, 자기 화살표(물 채우기)뿐이면, 다른 종류면 세우지 않는다", () => {
    expect(goalAhead({ memory: LEARNED_FSM_MEMORY, kind: "fsm", state: null, tasks, cls: "cup" })).toBeNull();
    expect(goalAhead({ memory: LEARNED_FSM_MEMORY, kind: "fsm", state: "cooking", tasks, cls: "cup" })).toBeNull();
    expect(goalAhead({ memory: LEARNED_FSM_MEMORY, kind: "fsm", state: "drinking", tasks, cls: "bowl" })).toBeNull();
  });
  it("afterUse 행동만 고른다: 컵에 손대는 채우기·따르기는 사람이 있는 동안 하는 일이라 빠지고, 지금 행동 목록에 없으면(코치 모드) 세우지 않는다", () => {
    expect(TASKS["컵 치우기"]!.afterUse).toBe(true);
    expect(TASKS["컵에 콜라 따라 주기"]!.afterUse).toBeUndefined();
    expect(TASKS["컵에 물 채워 주기"]!.afterUse).toBeUndefined();
    expect(goalAhead({ memory: LEARNED_FSM_MEMORY, kind: "fsm", state: "drinking", tasks: tasksFor("coach"), cls: "cup" })).toBeNull();
    expect(goalAhead({ memory: { rules: [{ trigger: "t", action: "컵 치우기" }] }, kind: "list", state: "drinking", tasks, cls: "cup" })).toBeNull();
  });
});
