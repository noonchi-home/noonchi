// 폰 AR 마스코트 말풍선 글(src/phone/mascot.ts): 열린 계획의 판단 글, 없으면 마지막 판단의 관찰. 대시보드가 받는 계획·판단과 같은 자료다.
import { describe, expect, it } from "vitest";
import type { BrainLog } from "../src/contract/events.js";
import type { PlanView } from "../src/contract/plan.js";
import { MascotLine } from "../src/phone/mascot.js";

const world = { objects: [], person_visible: false, vlm_missing: 0, yolo_missing: 0 };
const decision = (over: Partial<Extract<BrainLog, { type: "decision" }>> = {}): BrainLog => ({
  type: "decision", at_ms: 1, id: "pam-1", seq: 1, text_sent: "관찰", status: "valid",
  prediction: { observation: "빈 컵이 식탁에 남음", reasoning: "자리를 비워 컵을 치운다", task_index: 0 }, action: "컵 치우기", memory_version: 1, world, ...over,
});
const plan = (over: Partial<PlanView> = {}): PlanView => ({
  id: "plan:pam-1", revision: 1, source: "brain", goal: "컵 치우기", judgment: "자리를 비워 컵을 치운다", dryRun: true,
  robot: { position: null, room: null }, path: [], legs: [], steps: [], status: "planned", updatedAt: "2026-11-08T00:00:00Z", ...over,
});

describe("마스코트 말풍선 글", () => {
  it("아직 판단이 없으면 없음", () => {
    expect(new MascotLine().text()).toBeNull();
  });

  it("열린 계획이 없으면 마지막 판단의 관찰", () => {
    const line = new MascotLine();
    line.onBrain(decision());
    expect(line.text()).toBe("빈 컵이 식탁에 남음");
    line.onBrain(decision({ id: "pam-2", prediction: { observation: "  사람이 식탁에 앉음 ", reasoning: "기다린다", task_index: -1 }, action: null }));
    expect(line.text()).toBe("사람이 식탁에 앉음");
  });

  it("계획이 열려 있으면(planned·running) 그 판단 글, 닫히면 다시 관찰", () => {
    const line = new MascotLine();
    line.onBrain(decision());
    line.onPlan(plan());
    expect(line.text()).toBe("자리를 비워 컵을 치운다");
    line.onPlan(plan({ status: "running", judgment: "컵을 싱크대로 옮긴다" }));
    expect(line.text()).toBe("컵을 싱크대로 옮긴다");
    for (const status of ["done", "cancelled", "failed"] as const) {
      line.onPlan(plan({ status }));
      expect(line.text(), status).toBe("빈 컵이 식탁에 남음");
    }
  });

  it("판단 글이 빈 계획(에이전트 기기 행동)이면 관찰. 계획이 없어져도 관찰", () => {
    const line = new MascotLine();
    line.onBrain(decision());
    line.onPlan(plan({ source: "agent", judgment: " " }));
    expect(line.text()).toBe("빈 컵이 식탁에 남음");
    line.onPlan(null);
    expect(line.text()).toBe("빈 컵이 식탁에 남음");
  });

  it("판단 실패·빈 관찰·다른 기록은 마지막 관찰을 바꾸지 않는다", () => {
    const line = new MascotLine();
    line.onBrain(decision());
    line.onBrain(decision({ id: "pam-2", status: "failed", prediction: null, action: null, error: "PAM 응답 없음" }));
    line.onBrain(decision({ id: "pam-3", prediction: { observation: "", reasoning: "", task_index: -1 }, action: null }));
    line.onBrain({ type: "world_change", at_ms: 2, kind: "appeared", text: "컵이 보임" } as BrainLog);
    expect(line.text()).toBe("빈 컵이 식탁에 남음");
  });
});
