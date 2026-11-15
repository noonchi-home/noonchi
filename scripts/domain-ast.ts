// 도메인 검사(scripts/lint-domains.ts)와 옮김 검사(scripts/check-moves.ts)가 같이 쓰는 파서·import 읽기·모듈 경로 풀기.
// 파서는 rolldown/parseAst(oxc)다. TypeScript 7에는 JS 컴파일러 API가 없다(도메인 나누기 설계 4.1).
// 경로는 모두 저장소 뿌리 기준 posix 경로("src/act/track.ts")다.
import { isBuiltin } from "node:module";
import { posix } from "node:path";
import { parseAst } from "rolldown/parseAst";

/** oxc ESTree 노드(TS 노드 포함). 칸은 노드 종류마다 달라 넓게 둔다. */
export type AstNode = { type: string; start: number; end: number; [key: string]: any };

/** 단계마다 둔 옮김 대응표 폴더(scripts/check-moves.ts, 도메인 나누기 설계 4.1). */
export const MOVES_DIR = "docs/superpowers/specs/2026-11-16-domain-split/moves/";

/** 파싱하는 코드 파일 확장자. */
export const CODE_EXT = [".ts", ".tsx", ".mts", ".js", ".jsx", ".mjs"] as const;
export const isCode = (path: string) => CODE_EXT.some((e) => path.endsWith(e)) && !path.endsWith(".d.ts");

export function parseCode(path: string, text: string): AstNode {
  const lang = path.endsWith(".tsx") ? "tsx" : /\.m?ts$/.test(path) ? "ts" : "jsx";
  return parseAst(text, { lang }, path) as unknown as AstNode;
}

/** 노드의 자식(위치 칸 빼고). */
export function childrenOf(node: AstNode): { key: string; node: AstNode }[] {
  const out: { key: string; node: AstNode }[] = [];
  for (const [key, v] of Object.entries(node)) {
    if (key === "start" || key === "end" || key === "range" || key === "loc") continue;
    if (Array.isArray(v)) {
      for (const c of v) if (c && typeof c === "object" && typeof c.type === "string") out.push({ key, node: c as AstNode });
    } else if (v && typeof v === "object" && typeof (v as AstNode).type === "string") out.push({ key, node: v as AstNode });
  }
  return out;
}

/** 깊이 우선으로 돈다. visit에 조상 목록(가까운 것이 끝)을 함께 준다. false를 돌려주면 그 아래로 들어가지 않는다. */
export function walk(node: AstNode, visit: (n: AstNode, ancestors: AstNode[]) => boolean | void, ancestors: AstNode[] = []): void {
  if (visit(node, ancestors) === false) return;
  ancestors.push(node);
  for (const c of childrenOf(node)) walk(c.node, visit, ancestors);
  ancestors.pop();
}

/** 가져온 이름 하나. imported: 원래 이름("default"·"*"·이름), local: 이 파일에서 쓰는 이름(다시 내보내기는 내보낸 이름). */
export interface ImportName { imported: string; local: string; type: boolean }

/** import·export … from·import()·타입 자리 import("…") 하나. */
export interface ImportRef {
  spec: string;
  kind: "import" | "reexport" | "dynamic" | "require" | "type-query";
  /** 실행 때 지워진다(import type, 이름이 모두 type, 타입 자리 import("…")). */
  typeOnly: boolean;
  names: ImportName[];
  node: AstNode;
}

const nameOf = (n: AstNode | null | undefined): string => (!n ? "" : n.type === "Identifier" ? n.name : String(n.value));

/** 글자 그대로인 모듈 글: "…"·식 없는 `…`. 아니면 undefined. */
export function literalSpec(n: AstNode | null | undefined): string | undefined {
  if (n?.type === "Literal" && typeof n.value === "string") return n.value;
  if (n?.type === "TemplateLiteral" && n.expressions.length === 0) return String(n.quasis[0]?.value?.cooked ?? "");
  return undefined;
}

const isRequire = (n: AstNode) => n.type === "CallExpression" && n.callee?.type === "Identifier" && n.callee.name === "require" && n.arguments.length >= 1;

/** 글자 그대로가 아닌 import(식)·require(식). 경로를 변수로 넘기면 도메인 검사가 따라가지 못한다. */
export function nonLiteralLoads(program: AstNode): AstNode[] {
  const out: AstNode[] = [];
  walk(program, (n) => {
    if ((n.type === "ImportExpression" && literalSpec(n.source) === undefined) || (isRequire(n) && literalSpec(n.arguments[0]) === undefined)) out.push(n);
  });
  return out;
}

/** 맨 위 import·export from 문장과, 코드 안의 import("…")·require("…")·타입 자리 import("…")를 모두 읽는다. 글자 그대로가 아닌 것은 nonLiteralLoads가 낸다. */
export function importsOf(program: AstNode): ImportRef[] {
  const refs: ImportRef[] = [];
  for (const st of program.body as AstNode[]) {
    if (st.type === "ImportDeclaration") {
      const declType = st.importKind === "type";
      const names: ImportName[] = (st.specifiers as AstNode[]).map((s) => ({
        imported: s.type === "ImportDefaultSpecifier" ? "default" : s.type === "ImportNamespaceSpecifier" ? "*" : nameOf(s.imported),
        local: s.local.name as string,
        type: declType || s.importKind === "type",
      }));
      refs.push({ spec: st.source.value, kind: "import", typeOnly: declType || (names.length > 0 && names.every((n) => n.type)), names, node: st });
    } else if (st.type === "ExportNamedDeclaration" && st.source) {
      const declType = st.exportKind === "type";
      const names: ImportName[] = (st.specifiers as AstNode[]).map((s) => ({ imported: nameOf(s.local), local: nameOf(s.exported), type: declType || s.exportKind === "type" }));
      refs.push({ spec: st.source.value, kind: "reexport", typeOnly: declType || (names.length > 0 && names.every((n) => n.type)), names, node: st });
    } else if (st.type === "ExportAllDeclaration") {
      const declType = st.exportKind === "type";
      refs.push({ spec: st.source.value, kind: "reexport", typeOnly: declType, names: [{ imported: "*", local: st.exported ? nameOf(st.exported) : "*", type: declType }], node: st });
    }
  }
  walk(program, (n) => {
    const dyn = n.type === "ImportExpression" ? literalSpec(n.source) : undefined;
    const req = isRequire(n) ? literalSpec(n.arguments[0]) : undefined;
    if (dyn !== undefined || req !== undefined) {
      refs.push({ spec: (dyn ?? req)!, kind: dyn !== undefined ? "dynamic" : "require", typeOnly: false, names: [{ imported: "*", local: "*", type: false }], node: n });
    } else if (n.type === "TSImportType") {
      const lit = n.source ?? n.argument?.literal ?? n.argument;
      if (lit?.type === "Literal" && typeof lit.value === "string") {
        refs.push({ spec: lit.value, kind: "type-query", typeOnly: true, names: [{ imported: "*", local: "*", type: true }], node: n });
      }
    }
  });
  return refs;
}

export type Resolved = { path: string } | { external: string; builtin: boolean } | { missing: string };

/** 모듈 글을 파일로 푼다. 상대 경로(.js는 .ts로도 봄, 확장자 없음은 .ts·.tsx·…·index), 화면의 "@/…"(ui/src/), 그 밖은 바깥 모듈. */
export function resolveSpec(from: string, spec: string, exists: (path: string) => boolean): Resolved {
  let base: string | undefined;
  if (spec.startsWith("./") || spec.startsWith("../")) base = posix.normalize(posix.join(posix.dirname(from), spec));
  else if (spec.startsWith("@/") && from.startsWith("ui/")) base = posix.join("ui/src", spec.slice(2));
  if (base === undefined) return { external: spec, builtin: isBuiltin(spec) };
  const ext = posix.extname(base);
  const stem = base.slice(0, base.length - ext.length);
  const tries =
    ext === ".js" ? [`${stem}.ts`, `${stem}.tsx`, base]
    : ext === ".mjs" ? [`${stem}.mts`, base]
    : ext === ".jsx" ? [`${stem}.tsx`, base]
    : ext && ext !== "." ? [base]
    : [".ts", ".tsx", ".js", ".jsx", ".mjs", "/index.ts", "/index.tsx", "/index.js"].map((e) => base + e);
  const hit = tries.find(exists);
  return hit ? { path: hit } : { missing: spec };
}
