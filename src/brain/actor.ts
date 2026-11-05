// 클로이드 행동 단계: 판단 모델이 고른 작업을 행동으로 바꾼다. 지금은 모두 모의(dry_run)다.
// 실제·트윈 기기 명령이나 LG ThinQ 호출을 하지 않는다. 로봇이 없어 "컵 치우기"는 폰으로 사람에게 부탁하고,
// 결과(컵이 치워졌나)는 상태 기계가 새 판정으로 확인한다.

import type { ActionPlan } from "../contract/events.js";

export type { ActionChoice, ActionPlan } from "../contract/events.js";

const NO_COMMAND = "기기 명령은 보내지 않아요";

export function planAction(task: string, id: string): ActionPlan {
  if (task === "컵 치우기") {
    return {
      id, task, kind: "ask_person_to_clear", dry_run: true, check: "cup_gone",
      would: "로봇이 식탁의 컵을 싱크대로 옮긴다",
      dashboard: `실행(모의): 컵 치우기 · 로봇이 없어 폰으로 사람에게 부탁해요 · ${NO_COMMAND}`,
      prompt: { text: "식탁 위 컵을 치워 주세요", choices: [{ id: "done", label: "치웠어요" }, { id: "later", label: "나중에" }] },
    };
  }
  if (task === "사용자에게 물어보기") {
    return {
      id, task, kind: "ask_user", dry_run: true, check: "none",
      would: "사용자에게 컵을 치울지 묻는다",
      dashboard: `실행(모의): 사용자에게 물어보기 · 폰으로 물어요 · ${NO_COMMAND}`,
      prompt: { text: "컵을 치울까요?", choices: [{ id: "clear", label: "치워 주세요" }, { id: "keep", label: "그대로 둬요" }] },
    };
  }
  return {
    id, task, kind: "unsupported", dry_run: true, check: "none", would: task,
    dashboard: `지원하지 않는 작업(${task}) · 기록만 해요 · ${NO_COMMAND}`, prompt: null,
  };
}

/** 답을 결과 글로. 모르는 선택지면 null. */
export function replyText(plan: ActionPlan, choice: string): { outcome: "declined" | "answered" | "pending"; text: string } | null {
  if (plan.kind === "ask_person_to_clear") {
    if (choice === "later") return { outcome: "declined", text: "사용자: 나중에 → 미룸" };
    if (choice === "done") return { outcome: "pending", text: "사용자: 치웠어요 → 컵이 안 보이는지 확인 중" };
  }
  if (plan.kind === "ask_user") {
    if (choice === "clear") return { outcome: "answered", text: "사용자: 치워 주세요 → (모의) 컵 치우기를 할 일로 남김" };
    if (choice === "keep") return { outcome: "answered", text: "사용자: 그대로 둬요 → 대기" };
  }
  return null;
}
