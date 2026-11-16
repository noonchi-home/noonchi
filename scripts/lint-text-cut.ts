// 글 자르기 검사(text-cut): src/**·ui/src/**에서 글을 `.slice(0, n)`·`.substring(0, n)`·`.substr(0, n)`으로 앞에서 자르면 실패한다.
// 이모지 같은 대리쌍 가운데가 갈리면 짝 잃은 서로게이트가 남아 PAM 요청 검증·UTF-8 인코딩에서 실패한다(2026-11-16 d71b61d·state.ts 들은 말·phone 말 자르기).
// 글 앞 자르기는 src/shared/cut.ts의 headWithin(글, n) 하나로만 한다. 그 파일만 검사하지 않는다.
// 타입 정보 없이(TypeScript 7에는 JS 컴파일러 API가 없다) 받는 값이 글인지 모양으로 본다: 글 리터럴·템플릿, String(…), 글을 돌려주는 메서드(trim·replace·join…),
// split(…)[i], 「…TEXT」 글 표 함수, 글로 쓰는 이름(text·reason·label·message…), 이 파일에서 그런 값으로 만든 이름·string 인자. 배열 자르기는 잡지 않는다.
// toISOString() 글(ASCII만)은 잘라도 된다. 예외 목록이나 검사를 끄는 인자는 없다.
// 사용: npm run lint (tests/lint-text-cut.test.ts도 같은 검사를 돌린다).
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { isCode, parseCode, walk, type AstNode } from "./domain-ast.js";

export type CutProblem = { file: string; line: number; text: string; fix: string };

/** 글 앞 자르기를 하는 곳(이 파일만 `.slice(0, n)`을 쓴다). */
export const CUT_HELPER = "src/shared/cut.ts";
const FIX = "글 앞을 자를 때 대리쌍(이모지) 가운데가 갈릴 수 있어요. src/shared/cut.ts의 headWithin(글, n)을 쓰세요.";
const CUTS = new Set(["slice", "substring", "substr"]);
/** 글을 돌려주는 메서드. */
const TEXT_METHODS = new Set(["trim", "trimStart", "trimEnd", "replace", "replaceAll", "toLowerCase", "toUpperCase", "toLocaleLowerCase", "toLocaleUpperCase",
  "normalize", "padStart", "padEnd", "repeat", "join", "toString", "toFixed", "charAt", "concat"]);
/** 글로 쓰는 이름(사람 말·VLM 글·LLM 이유·오류 글·이름표). */
const TEXT_NAMES = /^(text|said|say|speech|heard|message|reason|label|summary|name|title|answer|raw|content|note|caption|description|prompt|query|comment|detail)$/i;

const unwrap = (n: AstNode): AstNode =>
  ["ParenthesizedExpression", "TSNonNullExpression", "ChainExpression", "TSSatisfiesExpression"].includes(n.type) ? unwrap(n.expression) : n;
const propName = (n: AstNode): string | null => (n.type === "MemberExpression" && !n.computed && n.property?.type === "Identifier" ? n.property.name : null);

/** 받는 값이 글인가: "text"(글) · "ascii"(toISOString 글, 잘라도 됨) · null(모름·배열). */
function kindOf(n: AstNode, decls: Map<string, AstNode>, depth = 0): "text" | "ascii" | null {
  if (depth > 4) return null;
  const x = unwrap(n);
  switch (x.type) {
    case "TemplateLiteral":
      return "text";
    case "Literal":
      return typeof x.value === "string" ? "text" : null;
    case "TSAsExpression":
      return x.typeAnnotation?.type === "TSStringKeyword" ? "text" : kindOf(x.expression, decls, depth + 1);
    case "LogicalExpression":
      return kindOf(x.left, decls, depth + 1) ?? kindOf(x.right, decls, depth + 1);
    case "ConditionalExpression":
      return kindOf(x.consequent, decls, depth + 1) ?? kindOf(x.alternate, decls, depth + 1);
    case "CallExpression": {
      const c = unwrap(x.callee);
      if (c.type === "Identifier" && c.name === "String") return "text";
      const m = propName(c);
      if (m === "toISOString") return "ascii";
      if (m && TEXT_METHODS.has(m)) return "text";
      const owner = c.type === "MemberExpression" ? unwrap(c.object) : null;
      if (owner?.type === "Identifier" && /TEXT$/.test(owner.name)) return "text";
      return null;
    }
    case "MemberExpression": {
      if (x.computed) {
        const o = unwrap(x.object);
        return o.type === "CallExpression" && propName(unwrap(o.callee)) === "split" ? "text" : null;
      }
      const p = propName(x);
      return p && TEXT_NAMES.test(p) ? "text" : null;
    }
    case "Identifier": {
      const d = decls.get(x.name);
      if (d) {
        const k = kindOf(d, decls, depth + 1);
        if (k) return k;
      }
      return TEXT_NAMES.test(x.name) ? "text" : null;
    }
    default:
      return null;
  }
}

/** 이 파일에서 이름 → 그 값을 만든 식(const x = …) 또는 string 타입 인자(가짜 Literal ""). */
function declsOf(program: AstNode): Map<string, AstNode> {
  const out = new Map<string, AstNode>();
  walk(program, (n) => {
    if (n.type === "VariableDeclarator" && n.id?.type === "Identifier" && n.init) out.set(n.id.name, n.init);
    if (n.type === "Identifier" && n.typeAnnotation?.typeAnnotation?.type === "TSStringKeyword") out.set(n.name, { type: "Literal", value: "", start: n.start, end: n.end });
  });
  return out;
}

const isNegative = (n: AstNode | undefined) => {
  const x = n ? unwrap(n) : undefined;
  return !!x && ((x.type === "UnaryExpression" && x.operator === "-") || (x.type === "Literal" && typeof x.value === "number" && x.value < 0));
};
const isZero = (n: AstNode | undefined) => !!n && unwrap(n).type === "Literal" && unwrap(n).value === 0;

/** 파일 하나의 글 앞 자르기. */
export function fileProblems(file: string, src: string): CutProblem[] {
  if (file === CUT_HELPER) return [];
  const program = parseCode(file, src);
  const decls = declsOf(program);
  const out: CutProblem[] = [];
  walk(program, (n) => {
    if (n.type !== "CallExpression") return;
    const callee = unwrap(n.callee);
    const m = propName(callee);
    if (!m || !CUTS.has(m) || !isZero(n.arguments?.[0]) || n.arguments.length < 2 || isNegative(n.arguments[1])) return;
    if (kindOf(callee.object, decls) !== "text") return;
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
