// 기억 뜻 검사(LLM): 반성이 낸 후보 FSM의 상태가 사람이 하는 일인지(물건·장소·로봇 행동·시간대가 섞이지 않았는지), 조건(when)이 사람 쪽 사실만인지,
// 합쳐야 할 비슷한 상태가 있는지 PAM LLM에 한 번 묻는다. 모양(정답이 분명한 것)은 코드 검사(src/brain/decision.ts validateCandidateFsm)가 먼저 본다.
// 지시문은 이 저장소 글(scenarios/noonchi/memory_check.txt, 논문 해시 대상 아님)이고, 부르는 길은 판단·반성과 같은 PAM LLM 통로(src/brain/pam/llm.ts)다.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { CandidateFsm } from "../../contract/pam.js";
import { ContractError } from "../decision.js";
import { PAM_DIR } from "./paper.js";
import { pyList, pyRepr, isPyBlank, byCodePoint } from "./py.js";
import { readPyJson } from "./pyjson.js";
import type { PamMessage } from "./prompt.js";

/** 뜻 검사 지시문(시스템 글). */
export const MEMORY_CHECK_PROMPT = readFileSync(join(PAM_DIR, "scenarios", "noonchi", "memory_check.txt"), "utf8");
/** 사용자 글 머리(기억 JSON 앞). */
export const MEMORY_CHECK_HEAD = "Memory:\n";

export interface MemoryVerdict { ok: boolean; items: { kind: "state" | "condition" | "merge"; ref: string; ok: boolean; why: string }[] }

/** 답을 읽을 수 없을 때의 거절 판정. */
export const UNREADABLE: MemoryVerdict = { ok: false, items: [{ kind: "state", ref: "*", ok: false, why: "검사 답을 읽을 수 없음" }] };

const KINDS = ["state", "condition", "merge"] as const;

function fields(value: unknown, want: string[], path: string): Record<string, unknown> {
  const proto = value && typeof value === "object" ? Object.getPrototypeOf(value) : undefined;
  if (typeof value !== "object" || value === null || Array.isArray(value) || (proto !== Object.prototype && proto !== null)) throw new ContractError(`${path}: expected an object`);
  const actual = Object.keys(value);
  const missing = want.filter((f) => !actual.includes(f)).sort(byCodePoint);
  const extra = actual.filter((k) => !want.includes(k)).map(pyRepr).sort(byCodePoint);
  if (missing.length || extra.length) throw new ContractError(`${path}: incorrect fields (missing=${pyList(missing)}, extra=${pyList(extra)})`);
  return value as Record<string, unknown>;
}
const words = (v: unknown, path: string): string => {
  if (typeof v !== "string" || isPyBlank(v)) throw new ContractError(`${path}: expected a nonempty string`);
  return v;
};
const flag = (v: unknown, path: string): boolean => {
  if (typeof v !== "boolean") throw new ContractError(`${path}: expected true or false`);
  return v;
};

/** 엄격한 JSON 판정: 칸이 정확하고(ok·items, 항목은 kind·ref·ok·why), ok는 items가 모두 통과일 때만 참이어야 한다. 아니면 ContractError. */
export function parseVerdict(raw: string): MemoryVerdict {
  const v = fields(readPyJson(raw), ["ok", "items"], "verdict");
  const ok = flag(v.ok, "verdict.ok");
  if (!Array.isArray(v.items)) throw new ContractError("verdict.items: expected an array");
  const items = v.items.map((x, i) => {
    const p = `verdict.items[${i}]`;
    const it = fields(x, ["kind", "ref", "ok", "why"], p);
    const kind = words(it.kind, `${p}.kind`);
    if (!(KINDS as readonly string[]).includes(kind)) throw new ContractError(`${p}.kind: expected state, condition or merge`);
    return { kind: kind as MemoryVerdict["items"][number]["kind"], ref: words(it.ref, `${p}.ref`), ok: flag(it.ok, `${p}.ok`), why: words(it.why, `${p}.why`) };
  });
  if (ok !== items.every((x) => x.ok)) throw new ContractError("verdict.ok: must be true only when every item is ok");
  return { ok, items };
}

/** 뜻 검사 메시지(시스템 지시문 + 기억 JSON). */
export function memoryCheckMessages(memory: CandidateFsm): PamMessage[] {
  return [
    { role: "system", content: MEMORY_CHECK_PROMPT },
    { role: "user", content: [{ type: "text", text: MEMORY_CHECK_HEAD + JSON.stringify(memory, null, 2) }] },
  ];
}
