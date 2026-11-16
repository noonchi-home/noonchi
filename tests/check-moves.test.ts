// 옮김 검사(scripts/check-moves.ts, 도메인 나누기 설계 4.1 ④⑤): 「import 경로만 달라짐」은 통과하고,
// import 뒤 실행문 덧붙임·이름 바꿈·다른 파일로 가져옴·대응표에 없는 지움·초기화 차례 바뀜·이름이 다른 정의를 가리킴은 실패해야 한다.
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { MOVES_DIR, checkMoves, parseMoves, runCli, type Moves } from "../scripts/check-moves.js";

const tree = (files: Record<string, string>) => new Map(Object.entries(files));
const M = (m: Partial<Moves> = {}): Moves => ({ files: {}, decls: {}, new: [], text: [], allow: {}, exceptions: {}, ...m });
const run = (before: Record<string, string>, after: Record<string, string>, moves: Partial<Moves> = {}, moved = false) => checkMoves(tree(before), tree(after), M(moves), { moved });

// 파일째 옮김 한 건: src/sync/aligner.ts → src/phone/sync/aligner.ts
const BEFORE = {
  "src/agent/phrases.ts": "export const josa = (s: string) => s;\n",
  "src/sync/aligner.ts": 'import { josa } from "../agent/phrases.js";\nexport const ALIGN = 1;\nexport function align(x: number) { return x + ALIGN; }\nexport const label = josa("x");\n',
  "src/phone/server.ts": 'import { align } from "../sync/aligner.js";\nexport const s = align(1);\n',
  "src/world/align.ts": "export function align(x: number) { return x; }\n",
  "tests/aligner.test.ts": 'import { align } from "../src/sync/aligner.js";\nvi.mock("../src/sync/aligner.js");\nconst p = "src/sync/aligner.ts";\nexport const t = [align, p];\n',
};
const AFTER = {
  "src/agent/phrases.ts": BEFORE["src/agent/phrases.ts"],
  "src/phone/sync/aligner.ts": 'import { josa } from "../../agent/phrases.js";\nexport const ALIGN = 1;\nexport function align(x: number) { return x + ALIGN; }\nexport const label = josa("x");\n',
  "src/phone/server.ts": 'import { align } from "./sync/aligner.js";\nexport const s = align(1);\n',
  "src/world/align.ts": BEFORE["src/world/align.ts"],
  "tests/aligner.test.ts": 'import { align } from "../src/phone/sync/aligner.js";\nvi.mock("../src/phone/sync/aligner.js");\nconst p = "src/phone/sync/aligner.ts";\nexport const t = [align, p];\n',
};
const MOVE = { files: { "src/sync/aligner.ts": "src/phone/sync/aligner.ts" } };

describe("옮김 검사: 파일째 옮김", () => {
  it("import 경로·모듈 글(vi.mock)·옮긴 파일 경로 글만 바뀌면 통과한다", () => {
    expect(run(BEFORE, AFTER, MOVE).failures).toEqual([]);
  });

  it("입구(index.ts)를 거쳐 같은 정의를 가져오게 바뀐 것은 통과한다", () => {
    const after = { ...AFTER, "src/phone/index.ts": 'export { align } from "./sync/aligner.js";\n', "tests/aligner.test.ts": AFTER["tests/aligner.test.ts"].replace('import { align } from "../src/phone/sync/aligner.js"', 'import { align } from "../src/phone/index.js"') };
    expect(run(BEFORE, after, { ...MOVE, new: ["src/phone/index.ts"] }).failures).toEqual([]);
  });

  it("import 뒤에 실행문을 덧붙이면 실패한다", () => {
    const after = { ...AFTER, "src/phone/server.ts": 'import { align } from "./sync/aligner.js";\nalign(2);\nexport const s = align(1);\n' };
    const f = run(BEFORE, after, MOVE).failures;
    expect(f).toHaveLength(1);
    expect(f[0]).toMatch(/^src\/phone\/server\.ts: import가 아닌 문장이 달라요\(1번째\)/);
  });

  it("옮긴 파일 안의 이름을 바꾸면 실패한다", () => {
    const after = { ...AFTER, "src/phone/sync/aligner.ts": AFTER["src/phone/sync/aligner.ts"].replace("function align(", "function alignTo(") };
    expect(run(BEFORE, after, MOVE).failures.join("\n")).toMatch(/src\/phone\/sync\/aligner\.ts\(옛 src\/sync\/aligner\.ts\): import가 아닌 문장이 달라요/);
  });

  it("가져온 이름의 별칭을 바꾸면 실패한다", () => {
    const after = { ...AFTER, "src/phone/server.ts": 'import { align as a } from "./sync/aligner.js";\nexport const s = a(1);\n' };
    const f = run(BEFORE, after, MOVE).failures.join("\n");
    expect(f).toContain("import가 아닌 문장이 달라요");
    expect(f).toContain("뒤에만: import a = src/phone/sync/aligner.ts#align");
  });

  it("같은 이름을 다른 파일에서 가져오면 실패한다", () => {
    const after = { ...AFTER, "src/phone/server.ts": 'import { align } from "../world/align.js";\nexport const s = align(1);\n' };
    const f = run(BEFORE, after, MOVE).failures;
    // aligner.ts는 맨 위에서 josa("x")를 불러 부수 효과 모듈이라, 그 모듈을 더는 읽지 않는 것도 함께 실패한다
    expect(f).toEqual([
      "src/phone/server.ts: import가 가리키는 정의가 달라요\n  앞에만: import align = src/phone/sync/aligner.ts#align\n  뒤에만: import align = src/world/align.ts#align",
      "src/phone/server.ts: 부수 효과가 있는 import의 차례가 달라요\n  앞: effect src/phone/sync/aligner.ts\n  뒤: ",
    ]);
  });

  it("대응표에 없는 지움과 새 파일은 실패한다", () => {
    const f = run(BEFORE, AFTER, {}).failures;
    expect(f).toContain("대응표에 없는 지움: src/sync/aligner.ts");
    expect(f).toContain("대응표에 없는 새 파일: src/phone/sync/aligner.ts");
  });

  it("new 입구에는 export … from 문장만 둔다", () => {
    const after = { ...AFTER, "src/phone/index.ts": 'export { align } from "./sync/aligner.js";\nexport const x = 1;\n' };
    expect(run(BEFORE, after, { ...MOVE, new: ["src/phone/index.ts"] }).failures).toEqual(["새 파일 src/phone/index.ts에 export … from이 아닌 문장이 있어요: export const x = 1;"]);
  });

  it("text 파일은 경로 조각이 옮긴 경로로만 바뀌면 되고 바뀐 글자열을 알려 준다. 조각을 다시 나누거나 글자열 밖이 바뀌면 실패한다", () => {
    const before = { ...BEFORE, "tests/release.test.ts": 'const f = join(ROOT, "src", "sync", "aligner.ts");\nexport const g = f;\n' };
    const after = { ...AFTER, "tests/release.test.ts": 'const f = join(ROOT, "src", "phone/sync", "aligner.ts");\nexport const g = f;\n' };
    expect(run(before, after, MOVE).failures.join("\n")).toContain("tests/release.test.ts: import가 아닌 문장이 달라요");
    const ok = run(before, after, { ...MOVE, text: ["tests/release.test.ts"] });
    expect(ok.failures).toEqual([]);
    expect(ok.notes).toEqual(['tests/release.test.ts: 바뀐 글자열(따로 확인): "phone/sync"']);
    const regroup = { ...AFTER, "tests/release.test.ts": 'const f = join(ROOT, "src", "phone", "sync/aligner.ts");\nexport const g = f;\n' };
    expect(run(before, regroup, { ...MOVE, text: ["tests/release.test.ts"] }).failures.join("\n")).toContain("tests/release.test.ts: import가 아닌 문장이 달라요");
    const bad = { ...after, "tests/release.test.ts": 'const f = join(ROOT, "src", "phone/sync", "aligner.ts");\nexport const g = [f];\n' };
    expect(run(before, bad, { ...MOVE, text: ["tests/release.test.ts"] }).failures.join("\n")).toContain("tests/release.test.ts: import가 아닌 문장이 달라요");
  });

  it("대응표 모양: 모르는 칸은 거절한다", () => {
    expect(() => parseMoves('{ "files": {}, "moved": [] }')).toThrow(/모르는 칸/);
    expect(parseMoves(readFileSync(join(import.meta.dirname, "..", MOVES_DIR, "1.json"), "utf8"))).toEqual(M());
  });
});

// 선언 하나 옮김(--moved): DecisionRecord를 world/decide.ts에서 계약으로
const D_BEFORE = {
  "src/contract/plan.ts": "export interface Plan { id?: string }\n",
  "src/contract/events.ts": "export interface Ev { id: string }\n",
  "src/world/decide.ts": 'import type { Plan } from "../contract/plan.js";\nexport interface DecisionRecord { plan: Plan; at: number }\nexport function decide(): DecisionRecord { return { plan: {}, at: 0 }; }\n',
  "tests/decide.test.ts": 'import type { DecisionRecord } from "../src/world/decide.js";\nexport const r: DecisionRecord | null = null;\n',
};
const D_AFTER = {
  "src/contract/plan.ts": D_BEFORE["src/contract/plan.ts"],
  "src/contract/events.ts": 'import type { Plan } from "./plan.js";\nexport interface Ev { id: string }\nexport interface DecisionRecord { plan: Plan; at: number }\n',
  "src/world/decide.ts": 'import type { Plan } from "../contract/plan.js";\nimport type { DecisionRecord } from "../contract/events.js";\nexport function decide(): DecisionRecord { return { plan: {}, at: 0 }; }\n',
  "tests/decide.test.ts": 'import type { DecisionRecord } from "../src/contract/events.js";\nexport const r: DecisionRecord | null = null;\n',
};
const D_MOVE = { decls: { "src/world/decide.ts#DecisionRecord": "src/contract/events.ts#DecisionRecord" } };

describe("옮김 검사 --moved: 선언 옮김", () => {
  it("선언을 계약으로 옮기고 시험이 계약에서 가져오게 바뀐 것은 통과한다", () => {
    expect(run(D_BEFORE, D_AFTER, D_MOVE, true).failures).toEqual([]);
  });

  it("decls는 --moved로만 본다", () => {
    expect(run(D_BEFORE, D_AFTER, D_MOVE, false).failures).toContain("decls(선언 옮김)는 --moved로만 봐요");
  });

  it("옮긴 선언의 글이 바뀌면 실패한다", () => {
    const after = { ...D_AFTER, "src/contract/events.ts": D_AFTER["src/contract/events.ts"].replace("at: number", "at: string") };
    expect(run(D_BEFORE, after, D_MOVE, true).failures.join("\n")).toContain("옮긴 선언의 글이 달라요: src/world/decide.ts#DecisionRecord → src/contract/events.ts#DecisionRecord");
  });

  it("대응표에 없이 선언이 사라지거나 생기면 실패한다", () => {
    const after = { ...D_AFTER, "src/contract/events.ts": D_AFTER["src/contract/events.ts"] + "export interface Extra { x: 1 }\n" };
    expect(run(D_BEFORE, after, D_MOVE, true).failures.join("\n")).toContain("대응표에 없이 생긴 선언: src/contract/events.ts#Extra");
    expect(run(D_BEFORE, D_AFTER, {}, true).failures.join("\n")).toContain("대응표에 없이 사라진 선언: src/world/decide.ts#DecisionRecord");
  });

  it("초기화 차례: 읽는 선언보다 앞에 두거나 옛 차례를 바꾸면 실패하고, 끌어올려지는 function·전역(Object)은 된다", () => {
    const before = { "src/model/kinds.ts": "export const KINDS = { a: 1 };\nexport const KIND_ORDER = Object.keys(KINDS);\nexport const FIRST = first();\nexport function first() { return KIND_ORDER[0]; }\n" };
    const decls = {
      "src/model/kinds.ts#KINDS": "src/devices/kinds.ts#KINDS",
      "src/model/kinds.ts#KIND_ORDER": "src/devices/kinds.ts#KIND_ORDER",
      "src/model/kinds.ts#FIRST": "src/devices/kinds.ts#FIRST",
      "src/model/kinds.ts#first": "src/devices/kinds.ts#first",
    };
    expect(run(before, { "src/devices/kinds.ts": before["src/model/kinds.ts"] }, { decls }, true).failures).toEqual([]);
    const swapped = { "src/devices/kinds.ts": "export const KIND_ORDER = Object.keys(KINDS);\nexport const KINDS = { a: 1 };\nexport const FIRST = first();\nexport function first() { return KIND_ORDER[0]; }\n" };
    const f = run(before, swapped, { decls }, true).failures;
    expect(f).toContain("src/devices/kinds.ts: src/model/kinds.ts에서 온 문장의 차례가 바뀌었어요(export const KINDS = { a: 1 };)");
    expect(f).toContain("src/devices/kinds.ts: `KINDS`을 선언하기 전에 읽어요(초기화 차례, export const KIND_ORDER = Object.keys(KINDS);)");
  });

  it("이름이 가리키는 정의: 새 파일의 같은 이름 선언에 잡히면 실패한다", () => {
    const before = {
      "src/a.ts": "const LIMIT = 1;\nexport function f() { return LIMIT; }\nexport const g = LIMIT;\n",
      "src/b.ts": "const LIMIT = 2;\nexport const h = LIMIT;\n",
    };
    const after = { "src/a.ts": "const LIMIT = 1;\nexport const g = LIMIT;\n", "src/b.ts": "const LIMIT = 2;\nexport const h = LIMIT;\nexport function f() { return LIMIT; }\n" };
    expect(run(before, after, { decls: { "src/a.ts#f": "src/b.ts#f" } }, true).failures).toContain("옮긴 선언 src/b.ts#f: 이름 `LIMIT`이 옮기기 전에는 src/a.ts#LIMIT, 뒤에는 src/b.ts#LIMIT를 가리켜요");
  });

  it("이름이 가리키는 정의: 옮긴 선언 안의 지역 이름이 모듈 이름을 가리면 그 지역을 가리켜 통과한다", () => {
    const before = {
      "src/a.ts": "const Pose = 1;\nexport function f() { const Pose = 2; return Pose; }\nexport const k = Pose;\n",
      "src/b.ts": "const Pose = 3;\nexport const m = Pose;\n",
    };
    const after = { "src/a.ts": "const Pose = 1;\nexport const k = Pose;\n", "src/b.ts": "const Pose = 3;\nexport const m = Pose;\nexport function f() { const Pose = 2; return Pose; }\n" };
    expect(run(before, after, { decls: { "src/a.ts#f": "src/b.ts#f" } }, true).failures).toEqual([]);
  });

  it("이름이 가리키는 정의: 전역(Math)이 새 파일의 같은 이름 선언에 잡히면 실패한다", () => {
    const before = { "src/a.ts": "export const r = () => Math.max(1, 2);\n", "src/b.ts": "const Math = { max: () => 0 };\nexport const z = Math;\n" };
    const after = { "src/a.ts": "", "src/b.ts": "const Math = { max: () => 0 };\nexport const z = Math;\nexport const r = () => Math.max(1, 2);\n" };
    expect(run(before, after, { decls: { "src/a.ts#r": "src/b.ts#r" } }, true).failures).toContain("옮긴 선언 src/b.ts#r: 이름 `Math`이 옮기기 전에는 global:Math, 뒤에는 src/b.ts#Math를 가리켜요");
  });

  it("옮긴 파일끼리 실행 때 값 import 고리가 새로 생기면 실패한다(타입 import 고리는 아님)", () => {
    const before = {
      "src/a.ts": 'import { b } from "./b.js";\nexport const base = 1;\nexport const helper = () => base;\nexport const a = () => b;\n',
      "src/b.ts": "export const b = 1;\n",
    };
    const after = {
      "src/a.ts": 'import { b } from "./b.js";\nexport const base = 1;\nexport const a = () => b;\n',
      "src/b.ts": 'import { base } from "./a.js";\nexport const b = 1;\nexport const helper = () => base;\n',
    };
    expect(run(before, after, { decls: { "src/a.ts#helper": "src/b.ts#helper" } }, true).failures).toEqual(["실행 때 값 import 고리에 새 import가 생겼어요: src/b.ts → src/a.ts(고리: src/a.ts · src/b.ts)"]);
    const typeBefore = { ...before, "src/a.ts": 'import { b } from "./b.js";\nexport type Base = number;\nexport type Helper = Base;\nexport const a = () => b;\n' };
    const typeAfter = { "src/a.ts": 'import { b } from "./b.js";\nexport type Base = number;\nexport const a = () => b;\n', "src/b.ts": 'import type { Base } from "./a.js";\nexport const b = 1;\nexport type Helper = Base;\n' };
    expect(run(typeBefore, typeAfter, { decls: { "src/a.ts#Helper": "src/b.ts#Helper" } }, true).failures).toEqual([]);
  });
});

describe("옮김 검사: 빠져나가는 꼴", () => {
  const REL_BEFORE = 'const f = join(ROOT, "src", "sync", "aligner.ts");\nexpect(state()).toBe("on");\nconst a = "x";\nconst b = "y";\nconst t = `${f}:on`;\nexport const g = [f, a, b, t];\n';
  const relAfter = (from: string, to: string, path = 'join(ROOT, "src", "phone/sync", "aligner.ts")') =>
    ({ ...AFTER, "tests/release.test.ts": REL_BEFORE.replace('join(ROOT, "src", "sync", "aligner.ts")', path).replace(from, to) });
  const relBefore = { ...BEFORE, "tests/release.test.ts": REL_BEFORE };
  const TEXT = { ...MOVE, text: ["tests/release.test.ts"] };

  it("text 파일에서 경로가 아닌 글자열(상태 글·글자열 맞바꿈·템플릿)이 바뀌면 실패한다", () => {
    for (const [from, to] of [['toBe("on")', 'toBe("off")'], ['const a = "x";\nconst b = "y";', 'const a = "y";\nconst b = "x";'], ["`${f}:on`", "`${f}:off`"]]) {
      expect(run(relBefore, relAfter(from!, to!), TEXT).failures.join("\n"), to).toContain("tests/release.test.ts: import가 아닌 문장이 달라요");
    }
  });

  it("text 파일은 인자 모양이 같고 조각이 대응표의 옛 경로 → 새 경로로만 바뀐 것만 받는다. 조각 수가 바뀌면 실패하고 allow로만 된다", () => {
    expect(run(relBefore, relAfter("", ""), TEXT).failures).toEqual([]);
    const more = run(relBefore, relAfter("", "", 'join(ROOT, "src", "phone", "sync", "aligner.ts")'), TEXT).failures;
    expect(more).toEqual(['tests/release.test.ts: import가 아닌 문장이 달라요(1번째)\n  앞: const f = join(ROOT, "src", "sync", "aligner.ts");\n  뒤: const f = join(ROOT, "src", "phone", "sync", "aligner.ts");']);
    expect(run(relBefore, relAfter("", "", 'join(ROOT, "src", "phone", "sync", "aligner.ts")'), { ...TEXT, allow: { [more[0]!.split("\n")[0]!]: "조각을 나눠 적음" } }).failures).toEqual([]);
    expect(run(relBefore, relAfter("", "", 'join(ROOT, "src", "world", "aligner.ts")'), TEXT).failures.join("\n")).toContain("tests/release.test.ts: import가 아닌 문장이 달라요");
  });

  it("text 파일: 글자 인자를 붙이면 같아 보여도 실제 경로가 다른 꼴(resolve(ROOT, \"a\", \"/b\") → resolve(ROOT, \"a//b\"))은 실패한다", () => {
    const before = { ...BEFORE, "tests/release.test.ts": 'const p = resolve(ROOT, "a", "/b");\nexport const q = p;\n' };
    const after = { ...AFTER, "tests/release.test.ts": 'const p = resolve(ROOT, "a//b");\nexport const q = p;\n' };
    expect(run(before, after, TEXT).failures.join("\n")).toContain("tests/release.test.ts: import가 아닌 문장이 달라요");
    const slash = { ...AFTER, "tests/release.test.ts": 'const p = resolve(ROOT, "a", "//b");\nexport const q = p;\n' };
    expect(run(before, slash, TEXT).failures.join("\n")).toContain("tests/release.test.ts: import가 아닌 문장이 달라요");
  });

  it("지운 파일의 이름 없는 실행문(init())을 빼먹으면 실패하고, 새 자리에 같은 AST로 옮기면 통과한다", () => {
    const before = { "src/a.ts": "export const x = 1;\nexport function init() { return x; }\ninit();\n" };
    const decls = { "src/a.ts#x": "src/b.ts#x", "src/a.ts#init": "src/b.ts#init" };
    expect(run(before, { "src/b.ts": "export const x = 1;\nexport function init() { return x; }\n" }, { decls }, true).failures).toEqual(["지운 파일 src/a.ts의 이름 없는 실행문이 새 자리에 없어요: init();"]);
    expect(run(before, { "src/b.ts": "export const x = 1;\nexport function init() { return x; }\ninit();\n" }, { decls }, true).failures).toEqual([]);
  });

  it("지운 파일의 부수 효과 import(import \"./init.js\")를 버리면 실패하고, 받은 파일에 같은 차례로 있으면 통과한다", () => {
    const lib = { "src/i1.ts": 'console.log("1");\n', "src/i2.ts": 'console.log("2");\n' };
    const before = { ...lib, "src/a.ts": 'import "./i1.js";\nimport "./i2.js";\nexport const x = 1;\n', "src/b.ts": "export const y = 2;\n" };
    const decls = { "src/a.ts#x": "src/b.ts#x" };
    const after = (imports: string) => ({ ...lib, "src/b.ts": `${imports}export const y = 2;\nexport const x = 1;\n` });
    expect(run(before, after(""), { decls }, true).failures).toEqual([
      "지운 파일 src/a.ts의 부수 효과 import가 새 자리에 없어요: effect src/i1.ts",
      "지운 파일 src/a.ts의 부수 효과 import가 새 자리에 없어요: effect src/i2.ts",
    ]);
    expect(run(before, after('import "./i2.js";\nimport "./i1.js";\n'), { decls }, true).failures).toEqual(["지운 파일 src/a.ts의 부수 효과 import 차례가 src/b.ts에서 바뀌었어요: effect src/i2.ts"]);
    expect(run(before, after('import "./i1.js";\nimport "./i2.js";\n'), { decls }, true).failures).toEqual([]);
  });

  it("옮겨 온 함수용 import가 남아 있던 문장의 전역 이름(fetch)을 가리면 실패한다", () => {
    const before = {
      "src/http.ts": "export const fetch = (u: string) => u;\n",
      "src/a.ts": 'import { fetch } from "./http.js";\nexport const f = () => fetch("a");\n',
      "src/b.ts": 'export const g = () => fetch("b");\n',
    };
    const after = { "src/http.ts": before["src/http.ts"], "src/a.ts": "", "src/b.ts": 'import { fetch } from "./http.js";\nexport const g = () => fetch("b");\nexport const f = () => fetch("a");\n' };
    expect(run(before, after, { decls: { "src/a.ts#f": "src/b.ts#f" } }, true).failures).toEqual([
      'src/b.ts: 이름 `fetch`이 옮기기 전에는 global:fetch, 뒤에는 src/http.ts#fetch를 가리켜요(export const g = () => fetch("b");)',
    ]);
  });

  it("값 고리에 새 import가 생기면 모두 실패한다(a → index → a, 전부터 있던 고리 사이에 입구가 끼는 것도). allow에 적은 것만 된다", () => {
    const before = { "src/act/help.ts": "export const helper = () => 1;\n", "src/act/track.ts": 'import { helper } from "./help.js";\nexport const t = helper();\n' };
    const after = {
      "src/act/help.ts": before["src/act/help.ts"],
      "src/act/index.ts": 'export { helper } from "./help.js";\nexport { t } from "./track.js";\n',
      "src/act/track.ts": 'import { helper } from "./index.js";\nexport const t = helper();\n',
    };
    for (const moved of [false, true]) {
      expect(run(before, after, { new: ["src/act/index.ts"] }, moved).failures, String(moved)).toEqual([
        "실행 때 값 import 고리에 새 import가 생겼어요: src/act/index.ts → src/act/track.ts(고리: src/act/index.ts · src/act/track.ts)",
        "실행 때 값 import 고리에 새 import가 생겼어요: src/act/track.ts → src/act/index.ts(고리: src/act/index.ts · src/act/track.ts)",
      ]);
    }
    const cb = { "src/x/a.ts": 'import { b } from "./b.js";\nexport const a = () => b;\n', "src/x/b.ts": 'import { a } from "./a.js";\nexport const b = () => a;\n' };
    const ca = { "src/x/index.ts": 'export { b } from "./b.js";\n', "src/x/a.ts": 'import { b } from "./index.js";\nexport const a = () => b;\n', "src/x/b.ts": cb["src/x/b.ts"] };
    const f = run(cb, ca, { new: ["src/x/index.ts"] }).failures;
    expect(f).toEqual([
      "실행 때 값 import 고리에 새 import가 생겼어요: src/x/a.ts → src/x/index.ts(고리: src/x/a.ts · src/x/b.ts · src/x/index.ts)",
      "실행 때 값 import 고리에 새 import가 생겼어요: src/x/index.ts → src/x/b.ts(고리: src/x/a.ts · src/x/b.ts · src/x/index.ts)",
    ]);
    const allow = Object.fromEntries(f.map((x) => [x, "전부터 있던 a ↔ b 고리에 입구가 낌"]));
    const ok = run(cb, ca, { new: ["src/x/index.ts"], allow });
    expect(ok.failures).toEqual([]);
    expect(ok.notes).toContain(`허용(대응표): ${f[0]} — 전부터 있던 a ↔ b 고리에 입구가 낌`);
  });

  it("allow는 그 한 불일치만 넘기고 뒤 문장도 끝까지 견준다", () => {
    const before = { ...BEFORE, "src/phone/server.ts": 'import { align } from "../sync/aligner.js";\nexport const s = align(1);\nexport const ok = (x: boolean) => x;\n' };
    const after = (rest: string) => ({ ...AFTER, "src/phone/server.ts": `import { align } from "./sync/aligner.js";\nalign(2);\nexport const s = align(1);\n${rest}` });
    const first = run(before, after("export const ok = (x: boolean) => x;\n"), MOVE).failures;
    expect(first).toEqual(["src/phone/server.ts: import가 아닌 문장이 달라요(1번째)\n  앞: (없음)\n  뒤: align(2);"]);
    const allow = { ...MOVE, allow: { [first[0]!.split("\n")[0]!]: "시연용 호출" } };
    expect(run(before, after("export const ok = (x: boolean) => x;\n"), allow).failures).toEqual([]);
    // 뒤 문장(승인 판단)을 바꾸면 앞 불일치를 allow로 넘겨도 실패한다
    expect(run(before, after("export const ok = (x: boolean) => !x;\n"), allow).failures).toEqual([
      "src/phone/server.ts: import가 아닌 문장이 달라요(3번째)\n  앞: export const ok = (x: boolean) => x;\n  뒤: export const ok = (x: boolean) => !x;",
    ]);
  });

  it("allow 한 줄은 정확히 한 실패에만 맞아야 한다", () => {
    const before = { "src/http.ts": "export const fetch = (u: string) => u;\n", "src/a.ts": 'import { fetch } from "./http.js";\nexport const f = () => fetch("a");\n', "src/b.ts": 'fetch("b");\nfetch("b");\n' };
    const after = { "src/http.ts": before["src/http.ts"], "src/a.ts": "", "src/b.ts": 'import { fetch } from "./http.js";\nfetch("b");\nfetch("b");\nexport const f = () => fetch("a");\n' };
    const decls = { "src/a.ts#f": "src/b.ts#f" };
    const f = run(before, after, { decls }, true).failures;
    expect(f).toHaveLength(2);
    expect(f[0]).toBe(f[1]);
    expect(run(before, after, { decls, allow: { [f[0]!]: "까닭" } }, true).failures).toEqual([...f, `대응표 allow 한 줄이 실패 2개에 맞아요: ${f[0]}`]);
  });

  it("allow는 까닭이 있어야 하고, 쓰지 않은 allow는 실패한다", () => {
    expect(run(BEFORE, AFTER, { ...MOVE, allow: { "없는 실패": "까닭" } }).failures).toEqual(["대응표 allow에 있는데 생기지 않은 실패예요: 없는 실패"]);
    const after = { ...AFTER, "src/phone/server.ts": 'import { align } from "./sync/aligner.js";\nalign(2);\nexport const s = align(1);\n' };
    const key = run(BEFORE, after, MOVE).failures[0]!.split("\n")[0]!;
    expect(run(BEFORE, after, { ...MOVE, allow: { [key]: " " } }).failures).toEqual([`대응표 allow의 까닭이 비었어요: ${key}`]);
  });

  it("입구로 import하면 입구가 다시 내보내는 모듈까지 실제로 읽히는 차례를 견준다(입구가 다른 초기화를 더 읽으면 실패)", () => {
    const lib = {
      "src/x/reg.ts": "export const reg = register();\nfunction register() { return 1; }\n",
      "src/x/boot.ts": "export const boot = start();\nfunction start() { return 1; }\n",
      "src/x/pure.ts": "export const pure = 1;\n",
      "src/x/index.ts": 'export { boot } from "./boot.js";\nexport { reg } from "./reg.js";\n',
      "src/x/only.ts": 'export { pure } from "./pure.js";\nexport { reg } from "./reg.js";\n',
    };
    const main = (spec: string) => ({ ...lib, "src/main.ts": `import { reg } from "${spec}";\nexport const m = reg;\n` });
    expect(run(main("./x/reg.js"), main("./x/index.js")).failures).toEqual([
      "src/main.ts: 부수 효과가 있는 import의 차례가 달라요\n  앞: effect src/x/reg.ts\n  뒤: effect src/x/boot.ts → effect src/x/reg.ts",
    ]);
    expect(run(main("./x/reg.js"), main("./x/only.js")).failures).toEqual([]);
  });

  it("입구 → 다시 내보낸 모듈 → import \"./register.js\"처럼 깊이 더해지는 초기화도 읽히는 차례에 들어간다", () => {
    const lib = {
      "src/x/plain.ts": "export const reg = 1;\n",
      "src/x/other.ts": 'import "./register.js";\nexport const other = 2;\n',
      "src/x/register.ts": 'console.log("register");\n',
      "src/x/index.ts": 'export { reg } from "./plain.js";\nexport { other } from "./other.js";\n',
    };
    const main = (spec: string) => ({ ...lib, "src/main.ts": `import { reg } from "${spec}";\nexport const m = reg;\n` });
    expect(run(main("./x/plain.js"), main("./x/index.js")).failures).toEqual([
      "src/main.ts: 부수 효과가 있는 import의 차례가 달라요\n  앞: \n  뒤: effect src/x/register.ts",
    ]);
  });

  it("검사하는 파일 자신의 export … from 차례도 본다(입구의 re-export 두 줄 맞바꾸기는 실패)", () => {
    const lib = { "src/x/a.ts": 'export const a = init("a");\nfunction init(s: string) { return s; }\n', "src/x/b.ts": 'export const b = init("b");\nfunction init(s: string) { return s; }\n' };
    const before = { ...lib, "src/x/index.ts": 'export { a } from "./a.js";\nexport { b } from "./b.js";\n' };
    const after = { ...lib, "src/x/index.ts": 'export { b } from "./b.js";\nexport { a } from "./a.js";\n' };
    expect(run(before, after).failures).toEqual([
      "src/x/index.ts: 부수 효과가 있는 import의 차례가 달라요\n  앞: effect src/x/a.ts → effect src/x/b.ts\n  뒤: effect src/x/b.ts → effect src/x/a.ts",
    ]);
  });

  it("외부 패키지 import도 차례 열에 하나의 점(pkg:이름)으로 넣는다: import \"dotenv/config\"와 내부 초기화 맞바꾸기는 실패", () => {
    const lib = { "src/init.ts": "export const cfg = read();\nfunction read() { return process.env.X; }\n" };
    const D = 'import "dotenv/config";';
    const I = 'import { cfg } from "./init.js";';
    const main = (lines: string[]) => ({ ...lib, "src/main.ts": `${lines.join("\n")}\nexport const m = cfg;\n` });
    expect(run(main([D, I]), main([I, D])).failures).toEqual([
      "src/main.ts: 부수 효과가 있는 import의 차례가 달라요\n  앞: pkg:dotenv/config → effect src/init.ts\n  뒤: effect src/init.ts → pkg:dotenv/config",
    ]);
    // 값으로 쓰는 외부 import도 점으로 남고, 타입 전용·값으로 안 쓰는 TS import는 빠진다
    const N = 'import { join } from "node:path";';
    const T = 'import type { Server } from "node:http";';
    const U = 'import { readFileSync } from "node:fs";';
    const m2 = (lines: string[]) => ({ ...lib, "src/main.ts": `${lines.join("\n")}\nexport const m = [cfg, join];\n` });
    expect(run(m2([N, I]), m2([I, N])).failures).toEqual([
      "src/main.ts: 부수 효과가 있는 import의 차례가 달라요\n  앞: pkg:node:path → effect src/init.ts\n  뒤: effect src/init.ts → pkg:node:path",
    ]);
    expect(run(m2([T, U, I, N]), m2([I, T, U, N])).failures).toEqual([]);
  });

  it("줄 차례가 바뀌어도 ESM이 평가하는 차례(깊이 우선 뒤차례)가 같으면 통과한다", () => {
    const lib = { "src/x/a.ts": 'export const a = init("a");\nfunction init(s: string) { return s; }\n', "src/x/b.ts": 'import { a } from "./a.js";\nexport const b = init(a);\nfunction init(s: string) { return s; }\n' };
    const before = { ...lib, "src/x/index.ts": 'export { a } from "./a.js";\nexport { b } from "./b.js";\n' };
    const after = { ...lib, "src/x/index.ts": 'export { b } from "./b.js";\nexport { a } from "./a.js";\n' };
    expect(run(before, after).failures).toEqual([]);
  });

  it("JS 파일은 값으로 쓰지 않는 import도 실행 때 남으니 차례를 본다(TS 파일만 지워진다)", () => {
    const lib = { "src/x/a.ts": 'console.log("a");\n', "src/x/b.ts": 'console.log("b");\n' };
    const js = (lines: string[]) => ({ ...lib, "ui/src/phone/core/boot.js": `${lines.join("\n")}\nexport const k = 1;\n` });
    const A1 = 'import { a } from "../../../../src/x/a.js";';
    const B1 = 'import { b } from "../../../../src/x/b.js";';
    expect(run(js([A1, B1]), js([B1, A1])).failures).toEqual([
      "ui/src/phone/core/boot.js: 부수 효과가 있는 import의 차례가 달라요\n  앞: effect src/x/a.ts → effect src/x/b.ts\n  뒤: effect src/x/b.ts → effect src/x/a.ts",
    ]);
    const ts = (lines: string[]) => ({ ...lib, "src/y/boot.ts": `${lines.join("\n")}\nexport const k = 1;\n` });
    const A2 = 'import { a } from "../x/a.js";';
    const B2 = 'import { b } from "../x/b.js";';
    expect(run(ts([A2, B2]), ts([B2, A2])).failures).toEqual([]);
  });

  it("새 자기 import(선언을 합치며 자기 파일 뒤쪽 const를 별칭으로 먼저 읽음)는 실패한다", () => {
    const before = { "src/a.ts": 'import { x as bx } from "./b.js";\nexport const y = bx;\n', "src/b.ts": "export const x = 1;\n" };
    const after = { "src/a.ts": 'import { x as bx } from "./a.js";\nexport const y = bx;\nexport const x = 1;\n', "src/b.ts": "" };
    expect(run(before, after, { decls: { "src/b.ts#x": "src/a.ts#x" } }, true).failures).toEqual(["실행 때 값 import 고리에 새 import가 생겼어요: src/a.ts → src/a.ts(고리: src/a.ts)"]);
  });

  it("맨 위에서 함수 호출·new·static 초기화를 하는 모듈(const X = register())도 부수 효과 모듈로 보고 import 차례를 지킨다", () => {
    const lib = {
      "src/reg.ts": "export const reg = register();\nfunction register() { return 1; }\n",
      "src/cls.ts": "export class C { static x = boot(); }\nfunction boot() { return 1; }\n",
      "src/made.ts": "export const made = new Map();\n",
      "src/lazy.ts": "export const lazy = () => register();\nfunction register() { return 1; }\n",
    };
    const I = { reg: 'import { reg } from "./reg.js";', cls: 'import { C } from "./cls.js";', made: 'import { made } from "./made.js";', lazy: 'import { lazy } from "./lazy.js";' };
    const main = (lines: string[]) => ({ ...lib, "src/main.ts": `${lines.join("\n")}\nexport const m = [reg, C, made, lazy];\n` });
    const before = main([I.reg, I.cls, I.made, I.lazy]);
    for (const order of [[I.cls, I.reg, I.made, I.lazy], [I.reg, I.made, I.cls, I.lazy]]) {
      expect(run(before, main(order)).failures.join("\n"), order.join(" ")).toContain("src/main.ts: 부수 효과가 있는 import의 차례가 달라요");
    }
    expect(run(before, main([I.lazy, I.reg, I.cls, I.made])).failures).toEqual([]);
  });

  it("부수 효과가 있는 import(이름 없는 import, 맨 위 실행문이 있는 모듈)의 차례를 바꾸면 실패한다. 부수 효과 없는 모듈은 된다", () => {
    const lib = {
      "src/init.ts": 'console.log("init");\n',
      "src/run.ts": 'console.log("run");\n',
      "src/reg.ts": "export const reg = 1;\nregister();\nfunction register() {}\n",
      "src/pure.ts": "export const pure = 1;\n",
      "src/pure2.ts": "export const pure2 = 2;\n",
    };
    const I = { init: 'import "./init.js";', run: 'import "./run.js";', reg: 'import { reg } from "./reg.js";', pure: 'import { pure } from "./pure.js";', pure2: 'import { pure2 } from "./pure2.js";' };
    const main = (lines: string[]) => ({ ...lib, "src/main.ts": `${lines.join("\n")}\nexport const m = [reg, pure, pure2];\n` });
    const before = main([I.init, I.run, I.reg, I.pure, I.pure2]);
    for (const order of [[I.run, I.init, I.reg, I.pure, I.pure2], [I.reg, I.init, I.run, I.pure, I.pure2]]) {
      expect(run(before, main(order)).failures.join("\n")).toContain("src/main.ts: 부수 효과가 있는 import의 차례가 달라요");
    }
    expect(run(before, main([I.init, I.run, I.reg, I.pure2, I.pure])).failures).toEqual([]);
  });
});

describe("옮김 검사: 타입 선언 파일", () => {
  it(".d.ts·.d.mts·.d.cts 타입 선언 파일은 코드로 읽지 않는다(값 없는 선언이라 파서가 거절함)", () => {
    const decl = (n: number) => `export const WIN: { before: number };\nexport declare function f${n}(): void;\n`;
    expect(run({ ...BEFORE, "ui/scripts/judge.d.mts": decl(1) }, { ...AFTER, "ui/scripts/judge.d.mts": decl(2) }, MOVE).failures).toEqual([]);
  });
});

describe("옮김 검사: git 두 커밋", () => {
  const roots: string[] = [];
  afterEach(() => { while (roots.length) rmSync(roots.pop()!, { recursive: true, force: true }); });
  const git = (root: string, ...args: string[]) => execFileSync("git", ["-C", root, "-c", "user.name=t", "-c", "user.email=t@example.com", "-c", "core.autocrlf=false", ...args], { encoding: "utf8" }).trim();
  const write = (root: string, files: Record<string, string | null>) => {
    for (const [p, t] of Object.entries(files)) {
      if (t === null) { rmSync(join(root, p)); continue; }
      mkdirSync(dirname(join(root, p)), { recursive: true });
      writeFileSync(join(root, p), t);
    }
  };

  it("두 커밋 사이에 새로 생긴 대응표 하나로 견준다", () => {
    const root = mkdtempSync(join(tmpdir(), "moves-git-"));
    roots.push(root);
    git(root, "init", "-q");
    write(root, BEFORE);
    git(root, "add", "-A");
    git(root, "commit", "-q", "-m", "before");
    const a = git(root, "rev-parse", "HEAD");
    write(root, { ...Object.fromEntries(Object.keys(BEFORE).map((k) => [k, null])), ...AFTER, [`${MOVES_DIR}3a.json`]: JSON.stringify(MOVE) });
    git(root, "add", "-A");
    git(root, "commit", "-q", "-m", "after");
    const b = git(root, "rev-parse", "HEAD");
    const r = runCli(root, [a, b]);
    expect(r.failures).toEqual([]);
    expect(r.notes).toEqual([`대응표: ${MOVES_DIR}3a.json`]);
    expect(() => runCli(root, [b, b])).toThrow(/하나여야 해요\(0개/);
  }, 30_000);
});
