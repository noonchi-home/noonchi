import { describe, expect, it } from "vitest";
import { MachineLane, goalState, managerState, robotState, safetyState, type RobotFacts } from "../src/machines/view.js";

const idle: RobotFacts = { step: null, dock: null, inspection: null, blocked: false, off: false, observing: false, asking: false };

describe("기계 상태 기록", () => {
  it("현재 계획의 각 단계, 관찰과 충전 복귀를 한 번씩 남긴다", () => {
    const lane = new MachineLane<ReturnType<typeof robotState>>();
    const sample = (facts: RobotFacts, at: number) => lane.change(robotState(facts), at);
    expect(sample(idle, 0)).toMatchObject({ state: "idle", since_ms: 0 });
    const labels = ["식탁으로 가기", "컵 안 보기", "컵 집기", "싱크대로 가기", "컵 놓기"];
    labels.forEach((label, i) => {
      const step = { plan_id: "p1", number: i + 1, label };
      expect(sample({ ...idle, step }, 10 + i)).toEqual({ state: "run", step, since_ms: 10 + i });
      expect(sample({ ...idle, step: { ...step } }, 11 + i)).toBeNull();
    });
    expect(sample({ ...idle, dock: "look" }, 20)?.state).toBe("observe");
    expect(sample({ ...idle, dock: "go" }, 23)?.state).toBe("return");
    expect(sample(idle, 30)?.state).toBe("idle");
    expect(lane.last()).toMatchObject({ state: "idle", since_ms: 30 });
  });

  it("찾기와 내용물 확인에서 걸을 때, 볼 때, 명령을 거둔 때를 구별한다", () => {
    expect(robotState({ ...idle, inspection: "go" }).state).toBe("move");
    expect(robotState({ ...idle, inspection: "look" }).state).toBe("observe");
    expect(robotState({ ...idle, inspection: "go", blocked: true }).state).toBe("recover");
    expect(robotState({ ...idle, off: true }).state).toBe("run");
    expect(robotState({ ...idle, asking: true })).toEqual({ state: "run", step: null });
  });

  it("가전이 켜진 때와 실제 끄기 안내를 구별하고, 관리자는 안전·말 부탁·목표 순서로 맡는다", () => {
    expect(safetyState(false, { hot: [], notices: [] }).state).toBe("normal");
    expect(safetyState(false, { hot: ["hob"], notices: [] }).state).toBe("suspect");
    expect(safetyState(false, { hot: [], notices: ["hob"] }).state).toBe("emergency");
    expect(safetyState(true, { hot: [], notices: [] }).state).toBe("emergency");
    expect(managerState({ emergency: true, requested: true, goal: true, mode: "coach", tasks: [] }).owner).toBe("safety");
    expect(managerState({ emergency: false, requested: true, goal: true, mode: "noonchi", tasks: [] }).owner).toBe("request");
    expect(managerState({ emergency: false, requested: false, goal: true, mode: "noonchi", tasks: [] }).owner).toBe("goal");
  });

  it("목표 계획과 다른 계획의 끝을 구별한다", () => {
    const g = { id: "goal-1", action: "컵 치우기", status: "armed", prep: "waiting", gone_ms: null, reason: null } as const;
    expect(goalState(g, null).state).toBe("armed");
    expect(goalState({ ...g, prep: "planning" }, null).state).toBe("planning");
    expect(goalState({ ...g, status: "fired", prep: "ready", gone_ms: 12 }, null)).toMatchObject({ state: "ready", left_ms: 12 });
    const used = { ...g, status: "used" } as const;
    expect(goalState(used, { goal: "goal-2", status: "done" }).state).toBe("started");
    expect(goalState(used, { goal: "goal-1", status: "done" })).toMatchObject({ state: "done", result: "done" });
    expect(goalState({ ...g, status: "dropped", reason: "stop" }, null)).toMatchObject({ state: "dropped", reason: "stop" });
  });
});
