// 밤 흐름의 시각 찾기 메시지(석준 님 prompts/text/marking.txt를 이 집·사람 상태 FSM에 맞춘 글, 이 저장소 글이라 논문 해시 대상 아님).
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Candidate } from "../../contract/pam.js";
import { PAM_DIR } from "./paper.js";
import type { PamMessage } from "./prompt.js";

const read = (name: string) => readFileSync(join(PAM_DIR, "scenarios", "noonchi", name), "utf8");
export const MARKING_PROMPT = read("marking.txt");
/** 사용자 글 칸 머리(가짜 서버가 되읽는다). */
export const NIGHT_HEAD = { record: "Record:\n", states: "States:\n", candidates: "Candidates to find:\n", actions: "Actions to find:\n" } as const;
/** 빈 목록 칸. */
export const NONE = "-";

/** 후보 글(시각 찾기에서 묻는 글): 사건, 조건이 있으면 괄호로. */
export const candidateText = (c: Candidate) => (c.when ? `${c.on} (${c.when})` : c.on);

export interface MarkInput {
  states: { id: string; description: string }[];
  candidates: { state: string; candidate: Candidate }[];
  actions: string[];
  /** 그날 기록 줄(`HH:MM:SS | 글`). */
  lines: string[];
}

const block = (head: string, lines: readonly string[]) => ({ type: "text" as const, text: head + (lines.length ? lines.join("\n") : NONE) });

/** 시각 찾기 메시지와 물은 (상태, 후보 글) 목록. */
export function markMessages(i: MarkInput): { messages: PamMessage[]; asked: [string, string][] } {
  const asked = i.candidates.map((c) => [c.state, candidateText(c.candidate)] as [string, string]);
  return {
    asked,
    messages: [
      { role: "system", content: MARKING_PROMPT },
      { role: "user", content: [
        block(NIGHT_HEAD.states, i.states.map((s) => `${s.id}: ${s.description}`)),
        block(NIGHT_HEAD.candidates, asked.map(([s, c]) => `${s} | ${c}`)),
        block(NIGHT_HEAD.actions, i.actions),
        block(NIGHT_HEAD.record, i.lines),
      ] },
    ],
  };
}
