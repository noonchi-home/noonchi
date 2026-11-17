// Python과 같은 글 다루기: repr(str), 문자열 목록 repr, str.strip()이 비우는 글, 코드 포인트 순 정렬(sorted).
// 검사 글을 Python PAM과 바이트까지 같게 두어 옮기기 전후 기록을 대조한다.
const PY_SPACE = /^[\t\n\v\f\r\x1c-\x1f \x85\xa0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]*$/;
const NOT_PRINTABLE = /[\p{Cc}\p{Cf}\p{Cs}\p{Co}\p{Cn}\p{Zl}\p{Zp}\p{Zs}]/u;
const hex = (n: number, w: number) => n.toString(16).padStart(w, "0");

/** Python `not s.strip()`. */
export const isPyBlank = (s: string): boolean => PY_SPACE.test(s);

/** Python sorted()의 문자열 차례(코드 포인트). */
export function byCodePoint(a: string, b: string): number {
  const x = [...a];
  const y = [...b];
  for (let k = 0; k < Math.min(x.length, y.length); k++) {
    const d = x[k]!.codePointAt(0)! - y[k]!.codePointAt(0)!;
    if (d) return d;
  }
  return x.length - y.length;
}

/** Python repr(str). */
export function pyRepr(s: string): string {
  const q = s.includes("'") && !s.includes('"') ? '"' : "'";
  let out = q;
  for (const ch of s) {
    if (ch === "\\" || ch === q) out += `\\${ch}`;
    else if (ch === "\t") out += "\\t";
    else if (ch === "\n") out += "\\n";
    else if (ch === "\r") out += "\\r";
    else if (ch !== " " && NOT_PRINTABLE.test(ch)) {
      const c = ch.codePointAt(0)!;
      out += c <= 0xff ? `\\x${hex(c, 2)}` : c <= 0xffff ? `\\u${hex(c, 4)}` : `\\U${hex(c, 8)}`;
    } else out += ch;
  }
  return out + q;
}

/** Python repr(list[str]). */
export const pyList = (xs: string[]): string => `[${xs.map(pyRepr).join(", ")}]`;
