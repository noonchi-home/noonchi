// 논문 설정·프롬프트를 읽는다. 프롬프트는 source_map.json의 sha256과 같을 때만 읽는다(한 바이트라도 다르면 실패).
// 자리 끼워 넣기는 한 번만 훑어서, 끼워 넣은 기억 JSON 안의 중괄호는 그대로 둔다.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";
import { repoPath } from "../../shared/paths.js";
import { ContractError } from "../decision.js";
import { byCodePoint, pyList } from "./py.js";
import { PyFloat, PyJsonFail, readPyJson, unwrapFloats } from "./pyjson.js";

/** 이 폴더(프롬프트·설정·시나리오). 파일 자리(import.meta.url)는 src/shared/paths.ts만 쓴다(도메인 검사). */
export const PAM_DIR = repoPath("src/brain/pam/");
export const PROMPT_IDS = ["predictor_no_memory", "predictor_list", "predictor_fsm", "reflector_list_build", "reflector_list_update", "reflector_fsm_build", "reflector_fsm_update"] as const;
export type PromptId = (typeof PROMPT_IDS)[number];
export const PLACEHOLDER = /\{(window|tasks_block|n_tasks_minus_one|rules_block|fsm_block)\}/g;

export interface RoleConfig { temperature: number; enable_thinking: boolean }
export interface PaperConfig { model: string; predictor: RoleConfig; reflector: RoleConfig }

/** utf-8-sig로 읽고 중복 키·NaN 같은 상수를 거절한다. */
export function readStrictJson(path: string, o: { keepFloats?: boolean } = {}): unknown {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch (e) {
    throw new ContractError(`Cannot read JSON ${path}: ${(e as Error).message}`);
  }
  if (text.startsWith("\ufeff")) text = text.slice(1);
  try {
    const v = readPyJson(text);
    return o.keepFloats ? v : unwrapFloats(v);
  } catch (e) {
    if (!(e instanceof PyJsonFail)) throw e;
    const r = e.reason;
    const why = r.kind === "duplicate" ? `Duplicate JSON key: ${r.key}` : r.kind === "constant" ? `Invalid JSON constant: ${r.value}` : e.message;
    throw new ContractError(`Cannot read JSON ${path}: ${why}`);
  }
}

const EXPECTED: Record<"predictor" | "reflector", Record<string, number | boolean | ["float", number]>> = {
  predictor: { temperature: ["float", 0.3], enable_thinking: false, frame_count: 5, frame_stride_seconds: 2, interval_seconds: 1 },
  reflector: { temperature: ["float", 0.3], enable_thinking: true, frame_count: 200 },
};

/** 논문 설정(config/paper.json)이 논문 값 그대로인지 보고 읽는다. 값의 Python 타입(float·int·bool)까지 같아야 한다. */
export function loadPaperConfig(dir = PAM_DIR): PaperConfig {
  const c = readStrictJson(join(dir, "config", "paper.json"), { keepFloats: true }) as Record<string, unknown>;
  if (!c || typeof c !== "object" || c.model !== "Qwen3.5-27B") throw new ContractError("The paper profile must use Qwen3.5-27B.");
  for (const [role, want] of Object.entries(EXPECTED)) {
    const got = c[role] as Record<string, unknown> | undefined;
    if (!got || typeof got !== "object" || Array.isArray(got)) throw new ContractError(`Paper settings for ${role} must be an object.`);
    for (const [k, w] of Object.entries(want)) {
      const a = got[k];
      const same = Array.isArray(w) ? a instanceof PyFloat && a.value === w[1] : typeof w === "number" ? typeof a === "number" && a === w : a === w;
      if (!same) throw new ContractError(`Paper setting differs: ${role}.${k}`);
    }
  }
  return unwrapFloats(c) as PaperConfig;
}

export function loadPrompt(id: string, dir = PAM_DIR): { text: string; source: Record<string, unknown> } {
  if (!(PROMPT_IDS as readonly string[]).includes(id)) throw new ContractError(`Unknown paper prompt: ${id}`);
  const map = readStrictJson(join(dir, "prompts", "source_map.json")) as { prompts: Record<string, { file: string; sha256: string }> };
  const src = map.prompts[id]!;
  const path = resolve(dir, src.file);
  const rel = relative(resolve(dir, "prompts", "paper"), path);
  if (rel.startsWith("..") || isAbsolute(rel)) throw new ContractError("A paper prompt must be under prompts/paper.");
  const raw = readFileSync(path);
  if (createHash("sha256").update(raw).digest("hex") !== src.sha256) throw new ContractError(`Paper prompt hash mismatch: ${id}`);
  return { text: new TextDecoder("utf-8", { fatal: true }).decode(raw), source: { id, ...src } };
}

/** 자리를 한 번만 훑어 바꾼다. 템플릿이 쓰는 자리와 준 값의 이름이 같아야 한다. */
export function render(template: string, values: Record<string, string>): string {
  const needed = new Set([...template.matchAll(PLACEHOLDER)].map((m) => m[1]!));
  const given = Object.keys(values);
  if (needed.size !== given.length || given.some((k) => !needed.has(k))) {
    throw new ContractError(`Prompt substitution mismatch: expected ${pyList([...needed].sort(byCodePoint))}`);
  }
  return template.replace(PLACEHOLDER, (_m, name: string) => values[name]!);
}
