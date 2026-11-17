// 시나리오(scenarios/noonchi/scenario.json)의 글자 바꾸기를 논문 프롬프트에 적용한다. 논문 파일은 바꾸지 않는다.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { ContractError, validateTasks } from "../decision.js";
import { isPyBlank } from "./py.js";
import { readStrictJson } from "./paper.js";

export interface Replacement { old: string; new: string; reason: string }
export interface Scenario {
  id: string; tasks_file: string; memory_files: Record<string, string>; prompt_replacements: Replacement[];
  action_labels_ko?: string[]; configPath: string; configSha256: string;
}
export interface Adaptation { applied: (Replacement & { occurrences: number })[]; adapted_template_sha256: string }

const nonblank = (v: unknown): v is string => typeof v === "string" && !isPyBlank(v);

export function loadScenario(path: string): Scenario {
  const full = resolve(path);
  const v = readStrictJson(full) as Record<string, unknown>;
  if (!v || typeof v !== "object" || Array.isArray(v)) throw new ContractError("Scenario configuration must be an object.");
  for (const k of ["id", "tasks_file"]) if (!nonblank(v[k])) throw new ContractError(`Scenario requires ${k}.`);
  if (!v.memory_files || typeof v.memory_files !== "object" || Array.isArray(v.memory_files)) throw new ContractError("Scenario requires memory_files.");
  const changes = v.prompt_replacements;
  if (!Array.isArray(changes) || !changes.length) throw new ContractError("Scenario requires documented prompt substitutions.");
  for (const c of changes) {
    if (!c || typeof c !== "object" || !["old", "new", "reason"].every((k) => nonblank((c as Record<string, unknown>)[k]))) {
      throw new ContractError("Each scenario change needs old, new, and reason strings.");
    }
  }
  return { ...(v as unknown as Scenario), configPath: full, configSha256: createHash("sha256").update(readFileSync(full)).digest("hex") };
}

function scenarioFile(s: Scenario, name: "tasks_file"): string {
  const root = dirname(s.configPath);
  const path = resolve(root, s[name]);
  const rel = relative(root, path);
  if (rel.startsWith("..") || isAbsolute(rel)) throw new ContractError("Scenario data files must remain within the scenario directory.");
  return path;
}

export function loadScenarioTasks(s: Scenario): string[] {
  const tasks = validateTasks(readStrictJson(scenarioFile(s, "tasks_file")));
  const labels = s.action_labels_ko;
  if (labels !== undefined && (!Array.isArray(labels) || labels.length !== tasks.length || labels.some((l) => !nonblank(l)))) {
    throw new ContractError("Korean action labels must correspond one-to-one with the task list.");
  }
  return tasks;
}

/** 바꾸기를 차례로 적용하고 몇 번 맞았는지 남긴다. 하나도 안 맞으면 실패. 바꿀 글의 `$`는 그대로 둔다(함수로 바꾼다). */
export function adaptPrompt(template: string, s: Pick<Scenario, "prompt_replacements">): { text: string; adaptation: Adaptation } {
  let text = template;
  const applied: Adaptation["applied"] = [];
  for (const c of s.prompt_replacements) {
    const occurrences = text.split(c.old).length - 1;
    if (occurrences) {
      text = text.replaceAll(c.old, () => c.new);
      applied.push({ old: c.old, new: c.new, reason: c.reason, occurrences });
    }
  }
  if (!applied.length) throw new ContractError("No scenario substitutions matched this paper prompt.");
  return { text, adaptation: { applied, adapted_template_sha256: createHash("sha256").update(text, "utf8").digest("hex") } };
}
