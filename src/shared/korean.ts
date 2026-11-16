// 한국어 글 도우미: 받침에 맞는 조사, 비교용 글 다듬기, 끝 조사 떼기. 도메인 지식이 없다.
import { headWithin } from "./cut.js";

/** 받침에 맞는 조사. 한글이 아니면(TV 등) 받침 없음으로 본다. */
export function josa(word: string, pair: "을/를" | "이/가" | "은/는" | "으로/로" | "과/와"): string {
  const [withBatchim, without] = pair.split("/") as [string, string];
  const last = word.trim().slice(-1);
  const code = last.charCodeAt(0) - 0xac00;
  if (code < 0 || code > 11171) return word + without;
  const jong = code % 28;
  if (pair === "으로/로") return word + (jong === 0 || jong === 8 ? without : withBatchim); // ㄹ받침은 "로"
  return word + (jong === 0 ? without : withBatchim);
}

const PARTICLES = ["에서", "으로", "이랑", "한테", "까지", "부터", "랑", "을", "를", "이", "가", "은", "는", "도", "의", "에", "로", "만", "좀"];

/** 비교용: 소문자, 괄호 안·띄어쓰기·가운뎃점·문장부호 제거. */
export function compact(s: string): string {
  return s.toLowerCase().replace(/\([^)]*\)/g, "").replace(/[\s·.,!?~'"]/g, "");
}

export function stripParticle(token: string): string {
  for (const p of PARTICLES) {
    if (token.length > p.length && token.endsWith(p)) return headWithin(token, token.length - p.length);
  }
  return token;
}
