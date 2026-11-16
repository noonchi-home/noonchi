// 글 앞 자르기: 사람 말·VLM 글·LLM 이유·오류 글처럼 바깥에서 들어온 글은 여기서만 자른다(scripts/lint-text-cut.ts가 다른 곳의 `.slice(0, n)`을 막는다).
// 이모지 같은 대리쌍 가운데를 자르면 짝 잃은 서로게이트가 남아 PAM 요청 검증·UTF-8 인코딩에서 실패한다.

/**
 * 앞에서 max 단위(UTF-16, brain 검사 checkInput의 `length`와 같은 단위) 안으로 자른다. 대리쌍 가운데는 자르지 않고 그 앞에서 끊는다.
 */
export function headWithin(s: string, max: number): string {
  if (s.length <= max) return s;
  let end = Math.max(0, max);
  const before = s.charCodeAt(end - 1);
  if (end > 0 && before >= 0xd800 && before <= 0xdbff) end--;
  return s.slice(0, end);
}
