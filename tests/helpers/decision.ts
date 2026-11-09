// 시험용 판단 모델: 사실(컵 안)만 보고 정한다. 빈 컵 → 컵 치우기, 남음 → 대기, 모름 → 묻기(목록에 없으면 대기).
// 실제 판단은 PAM 서비스(src/brain/pam.ts PamDecision)다.
import { checkInput, validatePrediction, type DecisionFacts, type DecisionInput, type DecisionModel, type Prediction } from "../../src/brain/decision.js";

export class ScriptedDecision implements DecisionModel {
  readonly name = "scripted";

  whatIf(facts: DecisionFacts, tasks: string[]): number {
    if (facts.contents === "empty") return tasks.indexOf("컵 치우기");
    if (facts.contents === "not_empty") return -1;
    return tasks.indexOf("사용자에게 물어보기");
  }

  async decide(input: DecisionInput): Promise<Prediction> {
    checkInput(input);
    const index = this.whatIf(input.facts, input.tasks);
    const said = { empty: "컵이 비어 있음", not_empty: "컵에 음료가 남아 있음", unknown: "컵 안을 확인할 수 없음" }[input.facts.contents];
    const reasoning = index === -1 ? `${said} → 기다린다` : `${said} → ${input.tasks[index]}`;
    return validatePrediction({ observation: `사용자는 자리에 없고 ${said}`, reasoning, task_index: index }, input.tasks);
  }
}
