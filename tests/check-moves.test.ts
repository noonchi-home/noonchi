// 옮김 검사(scripts/check-moves.ts, 도메인 나누기 설계 4.1 ④⑤): 「import 경로만 달라짐」은 통과하고,
// import 뒤 실행문 덧붙임·이름 바꿈·다른 파일로 가져옴·대응표에 없는 지움·초기화 차례 바뀜·이름이 다른 정의를 가리킴은 실패해야 한다.
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { MOVES_DIR, checkMoves, parseMoves, runCli, type Moves } from "../scripts/check-moves.js";

const tree = (files: Record<string, string>) => new Map(Object.entries(files));
const M = (m: Partial<Moves> = {}): Moves => ({ files: {}, decls: {}, new: [], text: [], ...m });
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
    expect(f).toEqual(["src/phone/server.ts: import가 가리키는 정의가 달라요\n  앞에만: import align = src/phone/sync/aligner.ts#align\n  뒤에만: import align = src/world/align.ts#align"]);
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

  it("text 파일은 글자열만 바뀌어도 되고 바뀐 글자열을 알려 준다. 글자열 밖이 바뀌면 실패한다", () => {
    const before = { ...BEFORE, "tests/release.test.ts": 'const f = join(ROOT, "src", "sync", "aligner.ts");\nexport const g = f;\n' };
    const after = { ...AFTER, "tests/release.test.ts": 'const f = join(ROOT, "src", "phone", "sync/aligner.ts");\nexport const g = f;\n' };
    expect(run(before, after, MOVE).failures.join("\n")).toContain("tests/release.test.ts: import가 아닌 문장이 달라요");
    const ok = run(before, after, { ...MOVE, text: ["tests/release.test.ts"] });
    expect(ok.failures).toEqual([]);
    expect(ok.notes).toEqual(['tests/release.test.ts: 바뀐 글자열(따로 확인): "phone", "sync/aligner.ts"']);
    const bad = { ...after, "tests/release.test.ts": 'const f = join(ROOT, "src", "phone", "sync/aligner.ts");\nexport const g = [f];\n' };
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
    expect(run(before, after, { decls: { "src/a.ts#helper": "src/b.ts#helper" } }, true).failures).toEqual(["옮긴 파일끼리 실행 때 값 import 고리가 새로 생겼어요: src/a.ts · src/b.ts"]);
    const typeBefore = { ...before, "src/a.ts": 'import { b } from "./b.js";\nexport type Base = number;\nexport type Helper = Base;\nexport const a = () => b;\n' };
    const typeAfter = { "src/a.ts": 'import { b } from "./b.js";\nexport type Base = number;\nexport const a = () => b;\n', "src/b.ts": 'import type { Base } from "./a.js";\nexport const b = 1;\nexport type Helper = Base;\n' };
    expect(run(typeBefore, typeAfter, { decls: { "src/a.ts#Helper": "src/b.ts#Helper" } }, true).failures).toEqual([]);
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
