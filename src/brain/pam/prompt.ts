// 논문 프롬프트로 판단·반성 메시지를 만든다. 판단 규칙은 그대로 두고 사진이 들어가던 자리에 관찰 텍스트를 넣는다.
import { join } from "node:path";
import { loadPaperConfig, loadPrompt, PAM_DIR, PLACEHOLDER, render, type PromptId } from "./paper.js";
import type { PredictRequest, ReflectRequest } from "./request.js";
import { adaptPrompt, loadScenario, loadScenarioTasks, type Adaptation } from "./scenario.js";

export type PamMessage = { role: "system"; content: string } | { role: "user"; content: { type: "text"; text: string }[] };
export interface Generation { temperature: number; enable_thinking: boolean }
export interface Built { messages: PamMessage[]; generation: Generation }

export const PREDICT_STATE = "Person state at the previous decision: ";
export const PREDICT_TIME = "Wall-clock time of the final observation: ";
export const PREDICT_LOG = "Observation log (oldest to newest):\n";
export const REFLECT_LOG = "Today's observations, provided as a chronological time-stamped log:\n";
export const REFLECT_MEMORY = "Current memory:\n";
export const REFLECT_SUMMARY = "\n\nSummary:\n";
export const REFLECT_FEEDBACK = "\n\nHuman feedback:\n";

const SCENARIO = loadScenario(join(PAM_DIR, "scenarios", "noonchi", "scenario.json"));
loadScenarioTasks(SCENARIO);
const adapted = new Map<PromptId, { text: string; adaptation: Adaptation }>();
const adapt = (id: PromptId) => adapted.get(id) ?? adapted.set(id, adaptPrompt(loadPrompt(id).text, SCENARIO)).get(id)!;

/** 노닌치 바꾸기를 적용한 프롬프트(가짜 LLM 서버가 요청을 되읽을 때도 쓴다). */
export const adaptedTemplate = (id: PromptId): string => adapt(id).text;
export const adaptation = (id: PromptId): Adaptation => adapt(id).adaptation;
/** 그 역할의 생성 설정(논문 config/paper.json). 기억 뜻 검사는 반성 값을 쓴다. */
export const generation = (role: "predictor" | "reflector"): Generation => {
  const c = loadPaperConfig()[role];
  return { temperature: c.temperature, enable_thinking: c.enable_thinking };
};
const memoryJson = (m: unknown) => JSON.stringify(m, null, 2);

export function buildPredictMessages(r: PredictRequest): Built {
  const template = adaptedTemplate(`predictor_${r.memory_kind}`);
  const values: Record<string, string> = {
    n_tasks_minus_one: String(r.tasks.length - 1),
    tasks_block: r.tasks.map((t, i) => `${i}: ${t}`).join("\n"),
    [r.memory_kind === "list" ? "rules_block" : "fsm_block"]: memoryJson(r.memory),
  };
  const needed = new Set([...template.matchAll(PLACEHOLDER)].map((m) => m[1]!));
  return {
    messages: [
      { role: "system", content: render(template, Object.fromEntries(Object.entries(values).filter(([k]) => needed.has(k)))) },
      { role: "user", content: [{ type: "text", text: PREDICT_STATE + (r.last_state ?? "unknown") }, { type: "text", text: PREDICT_TIME + r.final_time }, { type: "text", text: PREDICT_LOG + r.observation_text }] },
    ],
    generation: generation("predictor"),
  };
}

export function buildReflectMessages(r: ReflectRequest): Built {
  let text = REFLECT_MEMORY + memoryJson(r.memory) + REFLECT_SUMMARY + r.action_summary;
  if (r.feedback) text += REFLECT_FEEDBACK + r.feedback;
  return {
    messages: [
      // 후보 FSM 반성은 fsm 반성 프롬프트(노닌치 바꾸기가 후보 FSM 답 모양으로 바꾼다)
      { role: "system", content: adaptedTemplate(r.memory_kind === "list" ? "reflector_list_update" : "reflector_fsm_update") },
      { role: "user", content: [{ type: "text", text: REFLECT_LOG + r.observation_text }, { type: "text", text }] },
    ],
    generation: generation("reflector"),
  };
}
