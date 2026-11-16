// 글 자르기 검사(text-cut): src/**·ui/src/**에서 글을 `.slice(0, n)`·`.substring(0, n)`·`.substr(0, n)`으로 앞에서 자르면 실패한다(n이 음수여도).
// 이모지 같은 대리쌍 가운데가 갈리면 짝 잃은 서로게이트가 남아 PAM 요청 검증·UTF-8 인코딩에서 실패한다(2026-11-16 d71b61d·state.ts 들은 말·phone 말 자르기).
// 글 앞 자르기는 src/shared/cut.ts의 headWithin(글, n) 하나로만 한다. 그 파일만 검사하지 않는다.
// 타입 정보 없이(TypeScript 7에는 JS 컴파일러 API가 없다) 받는 값이 글인지 모양으로 본다: 글 리터럴·템플릿, String(…), 글을 돌려주는 메서드(trim·replace·join…),
// 글에 붙인 concat·slice, split(…) 결과(글 배열)의 원소와 map·forEach 같은 콜백 인자, 「…TEXT」 글 표 함수, 글로 쓰는 이름(text·reason·label·message…),
// 그런 값으로 만든 이름(선언한 블록·함수 안에서만)·string 인자. 배열 자르기는 잡지 않는다. ASCII로 확인된 글(toISOString()·ASCII 리터럴, 그것끼리만 붙인 것)은 잘라도 되고,
// 붙인 값 하나라도 ASCII로 확인되지 않으면 글로 본다. 예외 목록이나 검사를 끄는 인자는 없다.
// 사용: npm run lint (tests/lint-text-cut.test.ts도 같은 검사를 돌린다).
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { isCode, parseCode, walk, type AstNode } from "./domain-ast.js";

export type CutProblem = { file: string; line: number; text: string; fix: string };

/** 글 앞 자르기를 하는 곳(이 파일만 `.slice(0, n)`을 쓴다). */
export const CUT_HELPER = "src/shared/cut.ts";
const FIX = "글 앞을 자를 때 대리쌍(이모지) 가운데가 갈릴 수 있어요. src/shared/cut.ts의 headWithin(글, n)을 쓰세요(끝에서 k자 빼기는 headWithin(글, 글.length - k)).";
const CUTS = new Set(["slice", "substring", "substr"]);
/** 받는 값과 상관없이 글을 돌려주는 메서드. */
const TEXT_METHODS = new Set(["trim", "trimStart", "trimEnd", "replace", "replaceAll", "toLowerCase", "toUpperCase", "toLocaleLowerCase", "toLocaleUpperCase",
  "normalize", "padStart", "padEnd", "repeat", "join", "toString", "toFixed", "charAt"]);
/** 받는 값의 종류(글이면 글, 글 배열이면 글 배열)를 그대로 돌려주는 메서드. */
const SAME_KIND = new Set(["concat", "slice", "substring", "substr", "filter", "reverse", "toReversed", "sort", "toSorted"]);
/** 원소 하나씩 첫 인자로 콜백을 부르는 배열 메서드. */
const EACH = new Set(["map", "forEach", "filter", "flatMap", "some", "every", "find", "findLast", "findIndex", "findLastIndex"]);
/** 글로 쓰는 이름(사람 말·VLM 글·LLM 이유·오류 글·이름표). */
const TEXT_NAMES = /^(text|said|say|speech|heard|message|reason|label|summary|name|title|answer|raw|content|note|caption|description|prompt|query|comment|detail)$/i;
const FUNCTIONS = new Set(["ArrowFunctionExpression", "FunctionExpression", "FunctionDeclaration"]);

/** text: 글 · texts: 글 배열 · ascii: toISOString 글(잘라도 됨) · null: 모름(배열 등). */
type Kind = "text" | "texts" | "ascii" | null;
/** 이름 하나가 뜻하는 값: 그 이름이 보이는 범위(start~end)와 값을 만든 식(init). init이 null이면 모름(인자). */
type Decl = { start: number; end: number; init: AstNode | null; kind?: Kind };

const unwrap = (n: AstNode): AstNode =>
  ["ParenthesizedExpression", "TSNonNullExpression", "ChainExpression", "TSSatisfiesExpression"].includes(n.type) ? unwrap(n.expression) : n;
const propName = (n: AstNode): string | null => (n.type === "MemberExpression" && !n.computed && n.property?.type === "Identifier" ? n.property.name : null);

class Scope {
  private decls = new Map<string, Decl[]>();
  add(name: string, d: Decl): void {
    this.decls.set(name, [...(this.decls.get(name) ?? []), d]);
  }
  /** pos에서 보이는 가장 안쪽 뜻. */
  at(name: string, pos: number): Decl | undefined {
    return (this.decls.get(name) ?? []).filter((d) => d.start <= pos && pos < d.end).sort((a, b) => a.end - a.start - (b.end - b.start))[0];
  }
}

const ASCII = /^[\x00-\x7f]*$/;
/** 둘 중 하나일 수 있는 값(a ?? b, c ? a : b, a + b): 글이 섞이면 글, ASCII로 확인된 글끼리만 ASCII, 글 하나와 모르는 값이면 글. */
function either(a: Kind, b: Kind): Kind {
  if (a === "text" || b === "text") return "text";
  if (a === "texts" || b === "texts") return "texts";
  if (a === "ascii" && b === "ascii") return "ascii";
  return a === "ascii" || b === "ascii" ? "text" : null;
}

function kindOf(n: AstNode, scope: Scope, depth = 0): Kind {
  if (depth > 6) return null;
  const x = unwrap(n);
  switch (x.type) {
    case "TemplateLiteral": {
      const plain = (x.quasis ?? []).every((q: AstNode) => ASCII.test(q.value?.raw ?? ""));
      return plain && (x.expressions ?? []).every((e: AstNode) => kindOf(e, scope, depth + 1) === "ascii") ? "ascii" : "text";
    }
    case "Literal":
      return typeof x.value === "string" ? (ASCII.test(x.value) ? "ascii" : "text") : null;
    case "TSAsExpression":
      return x.typeAnnotation?.type === "TSStringKeyword" ? "text" : kindOf(x.expression, scope, depth + 1);
    case "LogicalExpression":
      return either(kindOf(x.left, scope, depth + 1), kindOf(x.right, scope, depth + 1));
    case "ConditionalExpression":
      return either(kindOf(x.consequent, scope, depth + 1), kindOf(x.alternate, scope, depth + 1));
    case "BinaryExpression":
      return x.operator === "+" ? either(kindOf(x.left, scope, depth + 1), kindOf(x.right, scope, depth + 1)) : null;
    case "CallExpression": {
      const c = unwrap(x.callee);
      if (c.type === "Identifier" && c.name === "String") return "text";
      const m = propName(c);
      if (m === "toISOString") return "ascii";
      if (m === "split") return "texts";
      if (m && TEXT_METHODS.has(m)) return "text";
      const owner = c.type === "MemberExpression" ? unwrap(c.object) : null;
      if (m === "concat" && owner) {
        // 글에 붙이면 붙인 값 하나라도 ASCII로 확인되지 않으면 글
        const k = kindOf(owner, scope, depth + 1);
        if (k === "texts") return "texts";
        if (k !== "text" && k !== "ascii") return null;
        return k === "ascii" && (x.arguments ?? []).every((a: AstNode) => kindOf(a, scope, depth + 1) === "ascii") ? "ascii" : "text";
      }
      if (m && SAME_KIND.has(m) && owner) {
        const k = kindOf(owner, scope, depth + 1);
        return k === "text" || k === "texts" || k === "ascii" ? k : null;
      }
      if (owner?.type === "Identifier" && /TEXT$/.test(owner.name)) return "text";
      return null;
    }
    case "MemberExpression": {
      if (x.computed) return kindOf(x.object, scope, depth + 1) === "texts" ? "text" : null;
      const p = propName(x);
      return p && TEXT_NAMES.test(p) ? "text" : null;
    }
    case "Identifier": {
      const d = scope.at(x.name, x.start);
      const k = d ? (d.kind ?? (d.init ? kindOf(d.init, scope, depth + 1) : null)) : null;
      return k ?? (TEXT_NAMES.test(x.name) ? "text" : null);
    }
    default:
      return null;
  }
}

/** 변수 선언이 보이는 범위: let·const는 가장 가까운 블록·for·함수·파일, var는 가장 가까운 함수·파일. */
const BLOCKS = new Set(["BlockStatement", "StaticBlock", "ForStatement", "ForInStatement", "ForOfStatement", "SwitchStatement", "Program", ...FUNCTIONS]);
function declRange(ancestors: readonly AstNode[]): { start: number; end: number } {
  const isVar = ancestors.at(-1)?.type === "VariableDeclaration" && ancestors.at(-1)?.kind === "var";
  for (let i = ancestors.length - 1; i >= 0; i--) {
    const a = ancestors[i]!;
    if (isVar ? FUNCTIONS.has(a.type) || a.type === "Program" : BLOCKS.has(a.type)) return { start: a.start, end: a.end };
  }
  return { start: 0, end: Infinity };
}

/** 이 파일의 이름 뜻: 변수 값(선언한 블록·함수 안), 함수 인자(그 함수 안: string 타입이면 글, 글 배열 콜백의 첫 인자면 글, 아니면 모름). */
function scopeOf(program: AstNode): Scope {
  const scope = new Scope();
  walk(program, (n, ancestors) => {
    if (n.type === "VariableDeclarator" && n.id?.type === "Identifier" && n.init) scope.add(n.id.name, { ...declRange(ancestors), init: n.init });
    if (FUNCTIONS.has(n.type)) {
      for (const p of n.params ?? []) {
        const id = p.type === "AssignmentPattern" ? p.left : p;
        if (id?.type !== "Identifier") continue;
        const typed = id.typeAnnotation?.typeAnnotation?.type === "TSStringKeyword";
        scope.add(id.name, { start: n.start, end: n.end, init: null, kind: typed ? "text" : null });
      }
    }
  });
  // 글 배열 콜백의 첫 인자는 글이다(lines.filter(…).map((l) => …)처럼 이어진 것도 보게 두 번 돈다)
  for (let pass = 0; pass < 2; pass++) {
    walk(program, (n) => {
      if (n.type !== "CallExpression") return;
      const c = unwrap(n.callee);
      const m = propName(c);
      const fn = n.arguments?.[0] ? unwrap(n.arguments[0]) : null;
      if (!m || !EACH.has(m) || !fn || !FUNCTIONS.has(fn.type) || kindOf(c.object, scope) !== "texts") return;
      const first = fn.params?.[0];
      if (first?.type === "Identifier") scope.add(first.name, { start: fn.start, end: fn.end - 1, init: null, kind: "text" });
    });
  }
  return scope;
}

const isZero = (n: AstNode | undefined) => !!n && unwrap(n).type === "Literal" && unwrap(n).value === 0;

/** 파일 하나의 글 앞 자르기. */
export function fileProblems(file: string, src: string): CutProblem[] {
  if (file === CUT_HELPER) return [];
  const program = parseCode(file, src);
  const scope = scopeOf(program);
  const out: CutProblem[] = [];
  walk(program, (n) => {
    if (n.type !== "CallExpression") return;
    const callee = unwrap(n.callee);
    const m = propName(callee);
    if (!m || !CUTS.has(m) || !isZero(n.arguments?.[0]) || n.arguments.length < 2) return;
    if (kindOf(callee.object, scope) !== "text") return;
    out.push({ file, line: src.slice(0, n.start).split("\n").length, text: src.slice(n.start, n.end).replace(/\s+/g, " "), fix: FIX });
  });
  return out;
}

/** src/**·ui/src/** 코드 파일(시험 파일 빼고). */
export function listFiles(root: string): string[] {
  const out: string[] = [];
  const visit = (dir: string) => {
    if (!existsSync(dir)) return;
    for (const name of readdirSync(dir)) {
      if (name === "node_modules" || name === "dist") continue;
      const p = join(dir, name);
      if (statSync(p).isDirectory()) visit(p);
      else out.push(relative(root, p).split(sep).join("/"));
    }
  };
  visit(join(root, "src"));
  visit(join(root, "ui", "src"));
  return out.filter((f) => isCode(f) && !/\.test\.[cm]?[jt]sx?$/.test(f)).sort();
}

export function lintTextCut(root: string): CutProblem[] {
  return listFiles(root).flatMap((f) => fileProblems(f, readFileSync(join(root, f), "utf8")));
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const problems = lintTextCut(fileURLToPath(new URL("..", import.meta.url)));
  for (const p of problems) console.error(`${p.file}:${p.line}  [text-cut] ${p.text}\n  → ${p.fix}`);
  if (problems.length) {
    console.error(`글 자르기 검사: ${problems.length}곳`);
    process.exit(1);
  }
  console.log("글 자르기 검사 통과");
}
