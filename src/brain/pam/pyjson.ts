// Python json.loads(raw, object_pairs_hook=중복 키 거절, parse_constant=상수 거절)와 같은 차례·같은 결과로 읽는다.
// - 중복 키는 객체가 닫힐 때 본다(안쪽 객체가 먼저). NaN·Infinity·-Infinity는 상수 오류, 그 밖 문법 오류는 syntax.
// - 소수점·지수가 있는 수는 PyFloat로 둔다: Python은 1.0을 float로 읽어 정수 칸(task_index) 검사에서 거절한다.
// - 숫자는 ASCII, 문자열 안 제어 문자는 거절(Python strict=True). __proto__도 보통 키로 둔다.
export class PyFloat {
  constructor(readonly value: number) {}
}
export type PyJsonReason = { kind: "syntax"; at: number } | { kind: "duplicate"; key: string } | { kind: "constant"; value: "NaN" | "Infinity" | "-Infinity" };
export class PyJsonFail extends Error {
  constructor(readonly reason: PyJsonReason) {
    super(reason.kind === "syntax" ? `JSON syntax error at char ${reason.at}` : reason.kind === "duplicate" ? `duplicate key: ${reason.key}` : `nonstandard constant: ${reason.value}`);
  }
}

const WS = /[ \t\n\r]*/y;
const STRING = /"(?:[^"\\\u0000-\u001f]|\\(?:["\\/bfnrt]|u[0-9a-fA-F]{4}))*"/y;
const NUMBER = /-?(?:0|[1-9][0-9]*)(\.[0-9]+)?([eE][-+]?[0-9]+)?/y;
const WORDS = [["null", null], ["true", true], ["false", false]] as const;
const CONSTANTS = ["NaN", "Infinity", "-Infinity"] as const;

export function readPyJson(raw: string): unknown {
  let i = 0;
  const skip = () => {
    WS.lastIndex = i;
    WS.exec(raw);
    i = WS.lastIndex;
  };
  const fail = (): never => {
    throw new PyJsonFail({ kind: "syntax", at: i });
  };
  const string = (): string => {
    STRING.lastIndex = i;
    const m = STRING.exec(raw) ?? fail();
    i = STRING.lastIndex;
    return JSON.parse(m[0]) as string;
  };
  const build = (pairs: [string, unknown][]): Record<string, unknown> => {
    const out: Record<string, unknown> = {};
    const seen = new Set<string>();
    for (const [k, v] of pairs) {
      if (seen.has(k)) throw new PyJsonFail({ kind: "duplicate", key: k });
      seen.add(k);
      Object.defineProperty(out, k, { value: v, enumerable: true, writable: true, configurable: true });
    }
    return out;
  };
  const object = (): Record<string, unknown> => {
    i++;
    const pairs: [string, unknown][] = [];
    skip();
    if (raw[i] === "}") {
      i++;
      return build(pairs);
    }
    for (;;) {
      skip();
      if (raw[i] !== '"') fail();
      const key = string();
      skip();
      if (raw[i] !== ":") fail();
      i++;
      pairs.push([key, value()]);
      skip();
      if (raw[i] === ",") { i++; continue; }
      if (raw[i] === "}") { i++; return build(pairs); }
      fail();
    }
  };
  const array = (): unknown[] => {
    i++;
    const out: unknown[] = [];
    skip();
    if (raw[i] === "]") { i++; return out; }
    for (;;) {
      out.push(value());
      skip();
      if (raw[i] === ",") { i++; continue; }
      if (raw[i] === "]") { i++; return out; }
      fail();
    }
  };
  const value = (): unknown => {
    skip();
    const c = raw[i];
    if (c === '"') return string();
    if (c === "{") return object();
    if (c === "[") return array();
    for (const [w, v] of WORDS) if (raw.startsWith(w, i)) { i += w.length; return v; }
    NUMBER.lastIndex = i;
    const m = NUMBER.exec(raw);
    if (m) {
      i = NUMBER.lastIndex;
      const n = Number(m[0]);
      return m[1] || m[2] ? new PyFloat(n) : n === 0 ? 0 : n;
    }
    for (const w of CONSTANTS) if (raw.startsWith(w, i)) throw new PyJsonFail({ kind: "constant", value: w });
    return fail();
  };
  const v = value();
  skip();
  if (i !== raw.length) fail();
  return v;
}

/** PyFloat를 보통 수로 푼다(설정·해시표 읽기). */
export function unwrapFloats(v: unknown): unknown {
  if (v instanceof PyFloat) return v.value;
  if (Array.isArray(v)) return v.map(unwrapFloats);
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, unwrapFloats(x)]));
  return v;
}
