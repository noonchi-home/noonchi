// 실험 전용(2026-11-22): 뜻 검사 AI에게 보내는 사본에서만 기본 기억의 «먹거나 마시는 칸»을 «마시는 중 하나의 활동»으로 맞춘다.
// 팀 기본 기억은 이 칸(drinking)에 먹기(eating)를 묶어 두는데(활동 목록 drinking·eating), 검사 AI가 «한 칸에는 한 가지 행동»이라며 이 칸을 거절한다.
// 활동 목록만 줄이면 이번에는 «먹기 시작한다»가 든 화살표(마시는 칸으로 가는)가 «목표 상태와 불일치»로 걸려서 화살표 문장의 «먹는다» 표현도 «마신다»로 맞춘다.
// 반성에 쓰는 기억과 채택 계산은 그대로이고, 검사 결과만 이 사본에 대한 것이다.
import type { CandidateFsm } from "../src/contract/pam.js";

const WORDS: [string, string][] = [["먹거나 마시기를", "마시기를"], ["먹거나 마신다", "마신다"], ["먹기 시작한다", "마시기 시작한다"], ["계속 먹는다", "계속 마신다"], ["먹거나 마시는", "마시는"]];
const fix = (t: string) => WORDS.reduce((s, [a, b]) => s.split(a).join(b), t);

export function checkView(memory: CandidateFsm): CandidateFsm {
  const copy = structuredClone(memory);
  for (const s of copy.states) {
    if (s.id === "drinking") { s.activity = ["drinking"]; s.description = "사용자가 마시는 중이다."; }
    for (const e of s.next) e.on = fix(e.on);
  }
  return copy;
}
