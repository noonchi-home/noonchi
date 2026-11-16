// 옮김 검사(도메인 나누기 설계 4.1 ④⑤): 두 커밋 사이에서 「import 경로만 달라짐」을 AST로 증명한다. git의 이름 바뀜 찾기는 쓰지 않는다.
// 쓰는 법: tsx scripts/check-moves.ts <앞 커밋> <뒤 커밋> [--moves <대응표 경로>] [--moved] [--only <경로 앞부분>]...
//   대응표(MOVES_DIR/<단계>.json, 그 커밋에 함께 둠)를 안 주면 두 커밋 사이에 새로 생기거나 바뀐 대응표 하나를 쓴다.
//   files: 파일째 옮김(옛 → 새). decls: 선언 하나 옮김("옛 파일#이름" → "새 파일#이름", --moved에서만). new: 새로 만든 입구(index.ts).
//   text: 경로를 조각으로 적은 시험·스크립트. AST 모양(인자 수 포함)이 같아야 하고, 이어진 글자열 조각은 앞에서부터 붙인 경로가
//   조각마다 옮긴 경로(파일·통째로 옮긴 폴더)로만 바뀌어야 한다. 그 밖의 글자열 변화는 실패다. 바뀐 글자열은 따로 확인하게 출력한다.
//   allow: 엄격한 검사가 막는 정상 이동만 실패 첫 줄 → 까닭으로 적어 허용한다(단계마다 검토). 까닭이 없거나 쓰지 않은 허용은 실패다.
//   exceptions: 도메인 검사 예외 목록에 새로 넣는 줄 → { why, until }(scripts/lint-domains.ts chainFailures가 본다).
// 파일마다 (1) import·export … from이 아닌 문장을 정규화한 AST로 견준다. (2) import마다 (이름, type 여부, 정의한 자리 파일#이름)를 견준다.
//   (3) new 파일은 export … from 문장만 있어야 한다. 대응표에 없는 지움·새 파일은 실패다.
//   부수 효과가 있는 import(이름 없는 import, 모듈을 읽을 때 무엇이든 실행하는 모듈)는 파일 안 차례도 같아야 한다.
//   실행 때 남는 값 import 그래프(입구 포함)의 고리 안에 새 import가 생기면 실패다.
// --moved(고리 끊기 단계): 옮긴 선언마다 글·빠짐과 더함·초기화 차례를 보고, 바뀐 파일의 모든 문장에서 자유 이름이 가리키는 정의가 같아야 한다.
//   지운 파일의 이름 없는 맨 위 실행문과 부수 효과 import는 하나하나 받는 파일에 같은 AST·같은 차례로 있어야 한다.
import { execFileSync } from "node:child_process";
import { posix } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { MOVES_DIR, isCode, parseCode, resolveSpec, type AstNode, type Resolved } from "./domain-ast.js";

export { MOVES_DIR };
/** 견주는 곳. */
export const SCOPE = ["src/", "ui/src/", "tests/", "ui/tests/", "scripts/", "ui/scripts/"] as const;
/** 검사 도구: 의존 표·예외 목록이 단계마다 바뀌어 견주지 않는다(따로 검토). */
export const TOOL_FILES = ["scripts/lint-domains.ts", "scripts/check-moves.ts", "scripts/domain-ast.ts"] as const;

export type Tree = Map<string, string>;
export interface Moves {
  files: Record<string, string>;
  decls: Record<string, string>;
  new: string[];
  text: string[];
  allow: Record<string, string>;
  exceptions: Record<string, { why: string; until: string }>;
}
export interface Options { moved?: boolean; only?: readonly string[] }
export interface Result { failures: string[]; notes: string[] }

export function parseMoves(text: string): Moves {
  const raw = JSON.parse(text) as Record<string, unknown>;
  for (const k of Object.keys(raw)) if (!["files", "decls", "new", "text", "allow", "exceptions"].includes(k)) throw new Error(`대응표에 모르는 칸이 있어요: ${k}`);
  return {
    files: (raw.files ?? {}) as Record<string, string>,
    decls: (raw.decls ?? {}) as Record<string, string>,
    new: (raw.new ?? []) as string[],
    text: (raw.text ?? []) as string[],
    allow: (raw.allow ?? {}) as Record<string, string>,
    exceptions: (raw.exceptions ?? {}) as Record<string, { why: string; until: string }>,
  };
}

// ---------- 모듈 읽기 ----------

type DeclKind = "function" | "class" | "var" | "let" | "const" | "type" | "enum" | "other";
interface Decl { index: number; stmt: AstNode; kind: DeclKind }
interface ModInfo {
  body: AstNode[];
  decls: Map<string, Decl[]>;
  exportsLocal: Map<string, string>;
  imports: Map<string, { spec: string; imported: string; type: boolean }>;
  reexports: Map<string, { spec: string; imported: string }>;
  starExports: string[];
}

const isImportLike = (st: AstNode) => st.type === "ImportDeclaration" || (st.type === "ExportNamedDeclaration" && !!st.source) || st.type === "ExportAllDeclaration";

/** 맨 위 문장이 선언하는 이름과 종류(export로 감싼 것은 안을 본다). */
export function declaredBy(st: AstNode): { names: string[]; kind: DeclKind; inner: AstNode } {
  const inner = (st.type === "ExportNamedDeclaration" || st.type === "ExportDefaultDeclaration") && st.declaration ? st.declaration : st;
  switch (inner.type) {
    case "VariableDeclaration":
      return { names: inner.declarations.flatMap((d: AstNode) => patternNames(d.id)), kind: inner.kind === "var" ? "var" : inner.kind === "let" ? "let" : "const", inner };
    case "FunctionDeclaration":
      return { names: inner.id ? [inner.id.name] : st.type === "ExportDefaultDeclaration" ? ["default"] : [], kind: "function", inner };
    case "ClassDeclaration":
      return { names: inner.id ? [inner.id.name] : st.type === "ExportDefaultDeclaration" ? ["default"] : [], kind: "class", inner };
    case "TSInterfaceDeclaration":
    case "TSTypeAliasDeclaration":
      return { names: [inner.id.name], kind: "type", inner };
    case "TSDeclareFunction":
      return { names: inner.id ? [inner.id.name] : [], kind: "type", inner };
    case "TSEnumDeclaration":
      return { names: [inner.id.name], kind: "enum", inner };
    case "TSModuleDeclaration":
      return { names: inner.id?.type === "Identifier" ? [inner.id.name] : [], kind: "other", inner };
    default:
      return { names: st.type === "ExportDefaultDeclaration" ? ["default"] : [], kind: "other", inner };
  }
}

/** 문장이 맡는 이름: 선언 이름, export { a } 목록은 그 지역 이름. 없으면 이름 없는 문장. */
export function namesOf(st: AstNode): string[] {
  if (st.type === "ExportNamedDeclaration" && !st.declaration && !st.source) return (st.specifiers as AstNode[]).map((x) => nameOf(x.local));
  return declaredBy(st).names;
}

/** 이름 없는 맨 위 실행문(모듈을 읽을 때 도는 동작). */
const isAnonRun = (st: AstNode) => !isImportLike(st) && isRuntime(st) && namesOf(st).length === 0;

const EFFECT_NODES = new Set(["CallExpression", "NewExpression", "TaggedTemplateExpression", "AwaitExpression", "ImportExpression", "YieldExpression", "AssignmentExpression", "UpdateExpression"]);
/** 식을 읽을 때(함수 몸통 밖) 실행이 일어나는가. */
function evalEffect(n: unknown): boolean {
  if (Array.isArray(n)) return n.some(evalEffect);
  if (!n || typeof n !== "object") return false;
  const node = n as AstNode;
  if (typeof node.type !== "string") return false;
  if (EFFECT_NODES.has(node.type) || (node.type === "UnaryExpression" && node.operator === "delete")) return true;
  if (node.type === "FunctionExpression" || node.type === "ArrowFunctionExpression" || node.type === "FunctionDeclaration") return false;
  if (node.type === "ClassExpression" || node.type === "ClassDeclaration") return classEffect(node);
  for (const [k, v] of Object.entries(node)) if (k !== "start" && k !== "end" && evalEffect(v)) return true;
  return false;
}
function classEffect(c: AstNode): boolean {
  if (evalEffect(c.superClass) || (c.decorators ?? []).length) return true;
  return (c.body.body as AstNode[]).some((el) => el.type === "StaticBlock" || (el.decorators ?? []).length > 0 || (el.computed && evalEffect(el.key)) || (el.static && el.type !== "MethodDefinition" && evalEffect(el.value)));
}
/** 이름 있는 맨 위 문장이 모듈을 읽을 때 실행하는가(const X = register(), class { static x = boot() } 등). */
function loadsEffect(st: AstNode): boolean {
  if (isImportLike(st) || (st.type === "ExportNamedDeclaration" && !st.declaration)) return false;
  const inner = (st.type === "ExportNamedDeclaration" || st.type === "ExportDefaultDeclaration") && st.declaration ? st.declaration : st;
  switch (inner.type) {
    case "VariableDeclaration": return (inner.declarations as AstNode[]).some((d) => evalEffect(d.init));
    case "ClassDeclaration": case "ClassExpression": return classEffect(inner);
    case "TSEnumDeclaration": return ((inner.body?.members ?? inner.members ?? []) as AstNode[]).some((m) => evalEffect(m.initializer));
    case "FunctionDeclaration": case "TSInterfaceDeclaration": case "TSTypeAliasDeclaration": case "TSDeclareFunction": case "TSModuleDeclaration": return false;
    default: return st.type === "ExportDefaultDeclaration" ? evalEffect(inner) : false;
  }
}

export function patternNames(p: AstNode | null | undefined): string[] {
  if (!p) return [];
  switch (p.type) {
    case "Identifier": return [p.name];
    case "ObjectPattern": return p.properties.flatMap((q: AstNode) => patternNames(q.type === "RestElement" ? q.argument : q.value));
    case "ArrayPattern": return p.elements.flatMap((e: AstNode | null) => patternNames(e));
    case "RestElement": return patternNames(p.argument);
    case "AssignmentPattern": return patternNames(p.left);
    case "TSParameterProperty": return patternNames(p.parameter);
    default: return [];
  }
}

const nameOf = (n: AstNode | null | undefined): string => (!n ? "" : n.type === "Identifier" ? n.name : String(n.value));

class TreeIndex {
  private asts = new Map<string, AstNode>();
  private infos = new Map<string, ModInfo>();
  constructor(readonly tree: Tree, readonly label: string) {}
  exists = (p: string) => this.tree.has(p);
  ast(p: string): AstNode {
    let a = this.asts.get(p);
    if (!a) {
      try { a = parseCode(p, this.tree.get(p) ?? ""); } catch (e) { throw new Error(`${this.label} ${p}를 파싱하지 못했어요: ${(e as Error).message}`); }
      this.asts.set(p, a);
    }
    return a;
  }
  resolve(from: string, spec: string): Resolved { return resolveSpec(from, spec, this.exists); }
  private liveMemo = new Map<string, string[]>();
  /** 모듈을 읽을 때 따라가는 정적 import·export … from 대상(소스 차례). 타입 전용은 빼고, TS 파일에서는 값으로 쓰지 않는 import(실행 때 지워짐)와
   *  skip한 이름만 가져오는 import도 뺀다. JS 파일의 import는 쓰지 않아도 남는다. 이름 없는 import는 늘 남는다.
   *  바깥 패키지(node:*·npm)는 속을 따라가지 않고 부수 효과가 있을 수 있는 점 하나 "pkg:<모듈 글>"로 둔다. */
  liveDeps(p: string, skip?: (local: string) => boolean): string[] {
    const memo = skip ? undefined : this.liveMemo.get(p);
    if (memo) return memo;
    const used = /\.(m?ts|tsx)$/.test(p) ? valueNames(this.ast(p)) : undefined;
    const out: string[] = [];
    for (const st of this.info(p).body) {
      let spec: string | undefined;
      if (st.type === "ImportDeclaration" && st.importKind !== "type") {
        const live = (st.specifiers as AstNode[]).some((sp) => sp.importKind !== "type" && !skip?.(sp.local.name) && (!used || used.has(sp.local.name)));
        if (!st.specifiers.length || live) spec = st.source.value;
      } else if (st.type === "ExportNamedDeclaration" && st.source && st.exportKind !== "type" && (st.specifiers as AstNode[]).some((x) => x.exportKind !== "type")) {
        spec = st.source.value;
      } else if (st.type === "ExportAllDeclaration" && st.exportKind !== "type") {
        spec = st.source.value;
      }
      if (spec === undefined) continue;
      const r = this.resolve(p, spec);
      if ("path" in r) out.push(r.path);
      else if ("external" in r) out.push(`pkg:${r.external}`);
    }
    if (!skip) this.liveMemo.set(p, out);
    return out;
  }
  /** file을 읽을 때 ESM이 평가하는 모듈 차례: 소스 차례로 정적 import·export … from을 따라가는 깊이 우선 뒤차례, 한 번 읽은 모듈은 건너뜀. file이 끝에 온다.
   *  바깥 패키지는 "pkg:<모듈 글>" 점 하나로 그 자리에 둔다(속은 따라가지 않음). */
  loadOrder(file: string, skip?: (local: string) => boolean): string[] {
    const order: string[] = [];
    const seen = new Set<string>();
    const visit = (m: string, deps: string[]) => {
      seen.add(m);
      for (const d of deps) {
        if (seen.has(d)) continue;
        if (d.startsWith("pkg:")) { seen.add(d); order.push(d); }
        else if (this.tree.has(d)) visit(d, this.liveDeps(d));
      }
      order.push(m);
    };
    if (this.tree.has(file)) visit(file, this.liveDeps(file, skip));
    return order;
  }
  private effectMemo = new Map<string, boolean>();
  /** 모듈을 읽을 때 무엇이든 실행한다: 이름 없는 맨 위 실행문, 또는 맨 위 식(초기화·static·export default)의 함수 호출·new·await·태그 템플릿·대입 등. */
  hasEffects(p: string): boolean {
    let v = this.effectMemo.get(p);
    if (v === undefined) { v = this.tree.has(p) && this.info(p).body.some((st) => isAnonRun(st) || loadsEffect(st)); this.effectMemo.set(p, v); }
    return v;
  }
  info(p: string): ModInfo {
    let info = this.infos.get(p);
    if (info) return info;
    const body = this.ast(p).body as AstNode[];
    info = { body, decls: new Map(), exportsLocal: new Map(), imports: new Map(), reexports: new Map(), starExports: [] };
    body.forEach((st, index) => {
      if (st.type === "ImportDeclaration") {
        for (const s of st.specifiers as AstNode[]) {
          const imported = s.type === "ImportDefaultSpecifier" ? "default" : s.type === "ImportNamespaceSpecifier" ? "*" : nameOf(s.imported);
          info!.imports.set(s.local.name, { spec: st.source.value, imported, type: st.importKind === "type" || s.importKind === "type" });
        }
        return;
      }
      if (st.type === "ExportNamedDeclaration" && st.source) {
        for (const s of st.specifiers as AstNode[]) info!.reexports.set(nameOf(s.exported), { spec: st.source.value, imported: nameOf(s.local) });
        return;
      }
      if (st.type === "ExportAllDeclaration") {
        if (st.exported) info!.reexports.set(nameOf(st.exported), { spec: st.source.value, imported: "*" });
        else info!.starExports.push(st.source.value);
        return;
      }
      if (st.type === "ExportNamedDeclaration" && !st.declaration) {
        for (const s of st.specifiers as AstNode[]) info!.exportsLocal.set(nameOf(s.exported), nameOf(s.local));
        return;
      }
      if (st.type === "ExportDefaultDeclaration" && st.declaration?.type === "Identifier") {
        info!.exportsLocal.set("default", st.declaration.name);
        return;
      }
      const { names, kind } = declaredBy(st);
      for (const n of names) {
        (info!.decls.get(n) ?? info!.decls.set(n, []).get(n)!).push({ index, stmt: st, kind });
        if (st.type === "ExportNamedDeclaration") info!.exportsLocal.set(n, n);
        if (st.type === "ExportDefaultDeclaration") info!.exportsLocal.set("default", n);
      }
    });
    this.infos.set(p, info);
    return info;
  }
  /** 모듈이 내보내는 이름의 정의 자리: "파일#이름", 바깥 모듈은 "pkg:모듈#이름". export … from·export *를 따라간다. */
  defOf(file: string, name: string, seen = new Set<string>()): string | undefined {
    if (!this.tree.has(file)) return `missing:${file}`;
    if (name === "*") return `${file}#*`;
    const k = `${file}#${name}`;
    if (seen.has(k)) return undefined;
    seen.add(k);
    const info = this.info(file);
    const local = info.exportsLocal.get(name);
    if (local !== undefined) return this.localDef(file, local, seen);
    const re = info.reexports.get(name);
    if (re) return this.importedDef(file, re.spec, re.imported, seen);
    for (const spec of info.starExports) {
      const r = this.resolve(file, spec);
      if ("path" in r) { const d = this.defOf(r.path, name, seen); if (d && !d.endsWith("?")) return d; }
    }
    return `${file}#${name}?`;
  }
  /** 파일 안 맨 위 이름이 가리키는 정의(선언·import를 따라감). 없으면 전역. */
  localDef(file: string, local: string, seen = new Set<string>()): string {
    const info = this.info(file);
    if (info.decls.has(local)) return `${file}#${local}`;
    const imp = info.imports.get(local);
    if (imp) return this.importedDef(file, imp.spec, imp.imported, seen);
    return `global:${local}`;
  }
  importedDef(file: string, spec: string, imported: string, seen = new Set<string>()): string {
    const r = this.resolve(file, spec);
    if ("external" in r) return `pkg:${spec}#${imported}`;
    if ("missing" in r) return `missing:${spec}`;
    return imported === "*" ? `${r.path}#*` : (this.defOf(r.path, imported, seen) ?? `${r.path}#${imported}?`);
  }
}

// ---------- 이름 범위(옮긴 선언 안의 자유 이름, 모듈을 읽을 때 쓰는 이름) ----------

interface Scope { names: Set<string>; parent?: Scope }
interface RefCtx { inType: boolean; inFn: boolean }
type OnRef = (name: string, ctx: RefCtx) => void;

const bound = (name: string, s: Scope | undefined): boolean => { for (let c = s; c; c = c.parent) if (c.names.has(name)) return true; return false; };

/** var·함수 선언(함수 맨 위)처럼 끌어올려지는 이름. 안쪽 함수로는 들어가지 않는다. */
function hoisted(stmts: AstNode[]): string[] {
  const out: string[] = [];
  const visit = (n: AstNode | null | undefined) => {
    if (!n || typeof n !== "object") return;
    if (n.type === "VariableDeclaration" && n.kind === "var") out.push(...n.declarations.flatMap((d: AstNode) => patternNames(d.id)));
    if (/Function|Class/.test(n.type) && n.type !== "VariableDeclaration") return;
    for (const v of Object.values(n)) {
      if (Array.isArray(v)) v.forEach((c) => c && typeof c.type === "string" && visit(c));
      else if (v && typeof v === "object" && typeof (v as AstNode).type === "string") visit(v as AstNode);
    }
  };
  stmts.forEach(visit);
  return out;
}

/** 블록 맨 위의 let·const·class·function·타입 선언 이름. */
function lexical(stmts: AstNode[]): string[] {
  return stmts.flatMap((st) => {
    const inner = st.type === "ExportNamedDeclaration" && st.declaration ? st.declaration : st;
    if (inner.type === "VariableDeclaration") return inner.kind === "var" ? [] : inner.declarations.flatMap((d: AstNode) => patternNames(d.id));
    if (["FunctionDeclaration", "ClassDeclaration", "TSInterfaceDeclaration", "TSTypeAliasDeclaration", "TSEnumDeclaration"].includes(inner.type)) return inner.id ? [inner.id.name] : [];
    return [];
  });
}

const typeParamNames = (tp: AstNode | null | undefined): string[] => (tp?.params ?? []).map((p: AstNode) => (p.name?.type === "Identifier" ? p.name.name : nameOf(p.name)));
const leftmost = (n: AstNode): AstNode | undefined => (n.type === "Identifier" || n.type === "JSXIdentifier" ? n : n.left ? leftmost(n.left) : n.object ? leftmost(n.object) : undefined);

function inferNames(n: AstNode | null | undefined, out: string[] = []): string[] {
  if (!n || typeof n !== "object") return out;
  if (n.type === "TSInferType") out.push(n.typeParameter?.name?.name ?? nameOf(n.typeParameter?.name));
  for (const v of Object.values(n)) {
    if (Array.isArray(v)) v.forEach((c) => c && typeof c.type === "string" && inferNames(c, out));
    else if (v && typeof v === "object" && typeof (v as AstNode).type === "string") inferNames(v as AstNode, out);
  }
  return out;
}

/** 노드 안에서 쓴 이름(그 노드 안에서 묶이지 않은 것)을 onRef로 낸다. inType: 타입 자리, inFn: 함수 몸통 안(모듈을 읽을 때 돌지 않음). */
export function visitRefs(node: AstNode | null | undefined, scope: Scope | undefined, ctx: RefCtx, onRef: OnRef): void {
  if (!node || typeof node !== "object") return;
  const v = (n: AstNode | null | undefined, s: Scope | undefined = scope, c: RefCtx = ctx) => visitRefs(n, s, c, onRef);
  const vs = (ns: (AstNode | null)[] | undefined, s: Scope | undefined = scope, c: RefCtx = ctx) => (ns ?? []).forEach((n) => v(n, s, c));
  const typ = { ...ctx, inType: true };
  const ref = (id: AstNode | undefined, c: RefCtx = ctx) => { if (id?.name && !bound(id.name, scope)) onRef(id.name, c); };
  const child = (names: string[]): Scope => ({ names: new Set(names), parent: scope });
  /** 묶는 자리(이름은 쓰지 않음): 기본값·계산 키·타입만 본다. */
  const pattern = (p: AstNode | null | undefined, s: Scope | undefined, c: RefCtx) => {
    if (!p) return;
    switch (p.type) {
      case "Identifier": v(p.typeAnnotation, s, { ...c, inType: true }); return;
      case "ObjectPattern":
        for (const q of p.properties as AstNode[]) {
          if (q.type === "RestElement") pattern(q.argument, s, c);
          else { if (q.computed) v(q.key, s, c); pattern(q.value, s, c); }
        }
        v(p.typeAnnotation, s, { ...c, inType: true });
        return;
      case "ArrayPattern": (p.elements as (AstNode | null)[]).forEach((e) => pattern(e, s, c)); v(p.typeAnnotation, s, { ...c, inType: true }); return;
      case "RestElement": pattern(p.argument, s, c); v(p.typeAnnotation, s, { ...c, inType: true }); return;
      case "AssignmentPattern": pattern(p.left, s, c); v(p.right, s, c); return;
      case "TSParameterProperty": pattern(p.parameter, s, c); return;
      default: v(p, s, c);
    }
  };
  const fn = (n: AstNode) => {
    const body: AstNode[] = n.body?.type === "BlockStatement" ? n.body.body : [];
    const s: Scope = child([
      ...(n.type === "FunctionExpression" && n.id ? [n.id.name] : []),
      ...typeParamNames(n.typeParameters),
      ...(n.params as AstNode[]).flatMap(patternNames),
      ...hoisted(body),
      ...lexical(body),
    ]);
    const inner = { ...ctx, inFn: true };
    vs(n.typeParameters?.params, s, { ...inner, inType: true });
    for (const p of n.params as AstNode[]) pattern(p, s, inner);
    v(n.returnType, s, { ...inner, inType: true });
    if (n.body?.type === "BlockStatement") vs(n.body.body, s, inner);
    else v(n.body, s, inner);
  };
  switch (node.type) {
    case "Identifier": ref(node); return;
    case "Literal": case "TemplateElement": case "ThisExpression": case "Super": case "MetaProperty":
    case "BreakStatement": case "ContinueStatement": case "TSImportType": case "JSXText": case "JSXClosingElement": case "JSXClosingFragment": case "JSXOpeningFragment":
      return;
    case "ImportDeclaration": case "ExportAllDeclaration": return;
    case "ExportNamedDeclaration":
      if (node.source) return;
      if (node.declaration) v(node.declaration);
      else for (const s of node.specifiers as AstNode[]) ref(s.local);
      return;
    case "MemberExpression": v(node.object); if (node.computed) v(node.property); return;
    case "Property": if (node.computed) v(node.key); v(node.value); return;
    case "LabeledStatement": v(node.body); return;
    case "VariableDeclaration": for (const d of node.declarations as AstNode[]) { pattern(d.id, scope, ctx); v(d.init); } return;
    case "FunctionDeclaration": case "FunctionExpression": case "ArrowFunctionExpression": fn(node); return;
    case "TSDeclareFunction": case "TSDeclareMethod": {
      const s = child([...typeParamNames(node.typeParameters), ...(node.params as AstNode[]).flatMap(patternNames)]);
      for (const p of node.params as AstNode[]) pattern(p, s, typ);
      v(node.returnType, s, typ);
      return;
    }
    case "ClassDeclaration": case "ClassExpression": {
      const s = child([...(node.id ? [node.id.name] : []), ...typeParamNames(node.typeParameters)]);
      vs(node.typeParameters?.params, s, typ);
      v(node.superClass, s);
      v(node.superTypeArguments ?? node.superTypeParameters, s, typ);
      vs(node.implements, s, typ);
      vs(node.decorators, s);
      for (const el of node.body.body as AstNode[]) {
        if (el.computed) v(el.key, s);
        vs(el.decorators, s);
        if (el.type === "StaticBlock") { const b = { names: new Set([...lexical(el.body), ...hoisted(el.body)]), parent: s }; vs(el.body, b); continue; }
        if (el.type === "TSIndexSignature") { v(el, s, typ); continue; }
        v(el.typeAnnotation, s, typ);
        if (el.value) v(el.value, s, el.type === "MethodDefinition" || el.type === "TSAbstractMethodDefinition" || !el.static ? { ...ctx, inFn: true } : ctx);
      }
      return;
    }
    case "BlockStatement": case "StaticBlock": vs(node.body, child([...lexical(node.body), ...(node.type === "StaticBlock" ? hoisted(node.body) : [])])); return;
    case "ForStatement": case "ForInStatement": case "ForOfStatement": {
      const decl = node.type === "ForStatement" ? node.init : node.left;
      const s = child(decl?.type === "VariableDeclaration" && decl.kind !== "var" ? decl.declarations.flatMap((d: AstNode) => patternNames(d.id)) : []);
      for (const [k, c] of Object.entries(node)) if (c && typeof c === "object" && k !== "start" && k !== "end") visitRefs(c as AstNode, s, ctx, onRef);
      return;
    }
    case "CatchClause": { const s = child(patternNames(node.param)); pattern(node.param, s, ctx); v(node.body, s); return; }
    case "SwitchStatement": { v(node.discriminant); const s = child(lexical((node.cases as AstNode[]).flatMap((c) => c.consequent))); for (const c of node.cases as AstNode[]) { v(c.test, s); vs(c.consequent, s); } return; }
    case "TSTypeAnnotation": case "TSTypeParameterInstantiation": v(node.typeAnnotation ?? null, scope, typ); vs(node.params, scope, typ); return;
    case "TSTypeReference": ref(leftmost(node.typeName), typ); v(node.typeArguments ?? node.typeParameters, scope, typ); return;
    case "TSQualifiedName": ref(leftmost(node), typ); return;
    case "TSTypeQuery": if (node.exprName?.type !== "TSImportType") ref(leftmost(node.exprName), typ); v(node.typeArguments, scope, typ); return;
    case "TSInterfaceHeritage": case "TSClassImplements": ref(leftmost(node.expression), typ); v(node.typeArguments, scope, typ); return;
    case "TSInterfaceDeclaration": { const s = child(typeParamNames(node.typeParameters)); vs(node.typeParameters?.params, s, typ); vs(node.extends, s, typ); v(node.body, s, typ); return; }
    case "TSTypeAliasDeclaration": { const s = child([...typeParamNames(node.typeParameters), ...inferNames(node.typeAnnotation)]); vs(node.typeParameters?.params, s, typ); v(node.typeAnnotation, s, typ); return; }
    case "TSTypeParameter": v(node.constraint, scope, typ); v(node.default, scope, typ); return;
    case "TSPropertySignature": if (node.computed) v(node.key, scope, typ); v(node.typeAnnotation, scope, typ); return;
    case "TSMethodSignature": case "TSCallSignatureDeclaration": case "TSConstructSignatureDeclaration": case "TSFunctionType": case "TSConstructorType": {
      if (node.computed) v(node.key, scope, typ);
      const s = child([...typeParamNames(node.typeParameters), ...(node.params as AstNode[]).flatMap(patternNames)]);
      vs(node.typeParameters?.params, s, typ);
      for (const p of node.params as AstNode[]) pattern(p, s, typ);
      v(node.returnType, s, typ);
      return;
    }
    case "TSIndexSignature": for (const p of node.parameters as AstNode[]) v(p.typeAnnotation, scope, typ); v(node.typeAnnotation, scope, typ); return;
    case "TSMappedType": {
      const key = node.typeParameter?.name?.name ?? node.key?.name;
      const s = child(key ? [key] : []);
      v(node.typeParameter?.constraint ?? node.constraint, s, typ);
      v(node.nameType, s, typ);
      v(node.typeAnnotation, s, typ);
      return;
    }
    case "TSConditionalType": {
      v(node.checkType, scope, typ);
      const s = child(inferNames(node.extendsType));
      v(node.extendsType, s, typ);
      v(node.trueType, s, typ);
      v(node.falseType, scope, typ);
      return;
    }
    case "TSTypePredicate": v(node.typeAnnotation, scope, typ); return;
    case "TSAsExpression": case "TSSatisfiesExpression": case "TSTypeAssertion": v(node.expression); v(node.typeAnnotation, scope, typ); return;
    case "TSEnumDeclaration": for (const m of (node.body?.members ?? node.members ?? []) as AstNode[]) v(m.initializer); return;
    case "TSModuleDeclaration": return;
    case "JSXOpeningElement": {
      const root = leftmost(node.name);
      if (root && (node.name.type === "JSXMemberExpression" || /^[A-Z]/.test(root.name))) ref(root);
      for (const a of node.attributes as AstNode[]) v(a.type === "JSXAttribute" ? a.value : a.argument);
      v(node.typeArguments, scope, typ);
      return;
    }
    default:
      for (const [k, c] of Object.entries(node)) {
        if (k === "start" || k === "end") continue;
        if (Array.isArray(c)) c.forEach((x) => x && typeof x.type === "string" && v(x));
        else if (c && typeof c === "object" && typeof (c as AstNode).type === "string") v(c as AstNode);
      }
  }
}

/** 맨 위 문장 하나의 자유 이름(타입 자리 포함). 문장이 선언하는 맨 위 이름도 모듈 이름으로 본다(묶지 않음). */
function freeNames(st: AstNode): { all: Set<string>; evalTime: Set<string> } {
  const all = new Set<string>();
  const evalTime = new Set<string>();
  visitRefs(st, undefined, { inType: false, inFn: false }, (name, c) => { all.add(name); if (!c.inType && !c.inFn) evalTime.add(name); });
  return { all, evalTime };
}

/** 파일에서 값 자리로 쓴 이름(가림은 보지 않음, 넓게). */
function valueNames(program: AstNode): Set<string> {
  const out = new Set<string>();
  for (const st of program.body as AstNode[]) if (!isImportLike(st)) visitRefs(st, undefined, { inType: false, inFn: false }, (n, c) => { if (!c.inType) out.add(n); });
  return out;
}

const isRuntime = (st: AstNode): boolean => {
  if (isImportLike(st)) return false;
  const inner = (st.type === "ExportNamedDeclaration" || st.type === "ExportDefaultDeclaration") && st.declaration ? st.declaration : st;
  if (inner.declare) return false;
  if (st.type === "ExportNamedDeclaration" && !st.declaration) return false;
  return !["TSInterfaceDeclaration", "TSTypeAliasDeclaration", "TSDeclareFunction", "TSModuleDeclaration", "TSExportAssignment", "TSNamespaceExportDeclaration", "TSImportEqualsDeclaration", "EmptyStatement"].includes(inner.type);
};

// ---------- 정규화한 AST ----------

const SKIP_KEYS = new Set(["start", "end", "range", "loc", "raw"]);

function normalize(node: unknown, str: (s: string) => string): unknown {
  if (Array.isArray(node)) return node.map((n) => normalize(n, str));
  if (!node || typeof node !== "object") return node;
  const n = node as AstNode;
  const out: Record<string, unknown> = {};
  for (const [k, val] of Object.entries(n)) {
    if (SKIP_KEYS.has(k)) continue;
    if (n.type === "Literal" && k === "value" && typeof val === "string") out[k] = str(val);
    else if (n.type === "TemplateElement" && k === "value" && val && typeof val === "object") out[k] = { cooked: str(String((val as { cooked?: string }).cooked ?? "")), raw: str(String((val as { raw?: string }).raw ?? "")) };
    else out[k] = normalize(val, str);
  }
  return out;
}

/** 두 문장 목록을 최장 공통 차례로 맞추고, 맞지 않은 자리를 [옛 번호, 새 번호]로 낸다(바뀐 것은 둘 다, 지운 것은 새 번호 없음, 더한 것은 옛 번호 없음). */
function diffPairs(n: number, m: number, same: (i: number, j: number) => boolean): [number | undefined, number | undefined][] {
  const eq: boolean[][] = Array.from({ length: n }, (_, i) => Array.from({ length: m }, (_, j) => same(i, j)));
  const L: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) L[i]![j] = eq[i]![j] ? L[i + 1]![j + 1]! + 1 : Math.max(L[i + 1]![j]!, L[i]![j + 1]!);
  const out: [number | undefined, number | undefined][] = [];
  let i = 0;
  let j = 0;
  const gap: { old: number[]; nu: number[] } = { old: [], nu: [] };
  const flush = () => {
    const k = Math.min(gap.old.length, gap.nu.length);
    for (let x = 0; x < k; x++) out.push([gap.old[x], gap.nu[x]]);
    for (const x of gap.old.slice(k)) out.push([x, undefined]);
    for (const x of gap.nu.slice(k)) out.push([undefined, x]);
    gap.old = [];
    gap.nu = [];
  };
  while (i < n || j < m) {
    if (i < n && j < m && eq[i]![j]) { flush(); i++; j++; }
    else if (j >= m || (i < n && L[i + 1]![j]! >= L[i]![j + 1]!)) gap.old.push(i++);
    else gap.nu.push(j++);
  }
  flush();
  return out;
}

/** text 파일 문장 비교: 모양(배열 길이·인자 수)이 같아야 한다. 이어진 글자열 조각은 그대로 같거나, 앞에서부터 붙인 경로가 조각마다
 *  mapText(옛 경로) = 새 경로여야 한다(조각을 나누거나 합치거나, "/"를 더하거나 빼면 붙인 경로가 달라져 실패). */
function textSame(a: unknown, b: unknown, strOld: (s: string) => string, strNew: (s: string) => string, mapText: (s: string) => string): boolean {
  const isStr = (x: unknown): x is AstNode => !!x && typeof x === "object" && (x as AstNode).type === "Literal" && typeof (x as AstNode).value === "string";
  const run = (olds: string[], news: string[]) => {
    if (olds.every((o, i) => strOld(o) === strNew(news[i]!))) return true;
    let po = "";
    let pn = "";
    for (let i = 0; i < olds.length; i++) {
      const o = olds[i]!;
      const n = news[i]!;
      po = i ? `${po}/${o}` : o;
      pn = i ? `${pn}/${n}` : n;
      if (mapText(po) !== pn) return false;
    }
    return true;
  };
  const cmp = (x: unknown, y: unknown): boolean => {
    if (Array.isArray(x) || Array.isArray(y)) {
      if (!Array.isArray(x) || !Array.isArray(y) || x.length !== y.length) return false;
      for (let i = 0; i < x.length;) {
        if (isStr(x[i]) && isStr(y[i])) {
          let j = i;
          while (j < x.length && isStr(x[j]) && isStr(y[j])) j++;
          if (!run(x.slice(i, j).map((v: AstNode) => v.value), y.slice(i, j).map((v: AstNode) => v.value))) return false;
          i = j;
          continue;
        }
        if (!cmp(x[i], y[i])) return false;
        i++;
      }
      return true;
    }
    if (!x || !y || typeof x !== "object" || typeof y !== "object") return x === y;
    const xn = x as AstNode;
    const yn = y as AstNode;
    if (isStr(xn) && isStr(yn)) return run([xn.value], [yn.value]);
    if (xn.type === "TemplateElement" && yn.type === "TemplateElement") return xn.tail === yn.tail && run([String(xn.value?.cooked)], [String(yn.value?.cooked)]);
    const keys = new Set([...Object.keys(xn), ...Object.keys(yn)].filter((k) => !SKIP_KEYS.has(k)));
    for (const k of keys) if (!cmp(xn[k], yn[k])) return false;
    return true;
  };
  return cmp(a, b);
}

const snippet = (text: string, n: AstNode) => text.slice(n.start, n.end).replace(/\s+/g, " ").slice(0, 160);

// ---------- 검사 ----------

export function checkMoves(before: Tree, after: Tree, moves: Moves, opts: Options = {}): Result {
  const failures: string[] = [];
  const notes: string[] = [];
  // 실패를 모두 모은 뒤 대응표 allow를 견준다: allow 한 줄은 실패 첫 줄 하나에 꼭 하나만 맞아야 그 실패를 허용한다
  const raw: string[] = [];
  const fail = (m: string) => { raw.push(m); };
  const B = new TreeIndex(before, "앞");
  const A = new TreeIndex(after, "뒤");
  const inScope = (p: string) => isCode(p) && SCOPE.some((s) => p.startsWith(s)) && !(TOOL_FILES as readonly string[]).includes(p);
  const only = (p: string) => !opts.only?.length || opts.only.some((s) => p.startsWith(s));
  const files = moves.files;
  const moved = !!opts.moved;
  if (!moved && Object.keys(moves.decls).length) fail("decls(선언 옮김)는 --moved로만 봐요");

  const mapFile = (p: string) => files[p] ?? p;
  const mapDef = (d: string): string => {
    if (moves.decls[d]) return moves.decls[d]!;
    const m = /^(.*)#(.*)$/.exec(d);
    if (!m || d.startsWith("pkg:") || d.startsWith("global:") || d.startsWith("missing:")) return d;
    return `${mapFile(m[1]!)}#${m[2]}`;
  };

  // 옛 경로 글 → 새 경로 글(확장자 있음·없음·.js)
  const pathText = new Map<string, string>();
  for (const [o, n] of Object.entries(files)) {
    const stem = (p: string) => p.replace(/\.(tsx?|mts|jsx?|mjs)$/, "");
    pathText.set(o, n);
    pathText.set(stem(o), stem(n));
    pathText.set(`${stem(o)}.js`, `${stem(n)}.js`);
  }

  // text 파일: 글 안의 옮긴 경로(파일·확장자 없음·.js, 파일을 모두 같은 꼴로 옮긴 폴더)를 새 경로로. 경로 경계에서만 바꾼다
  const textPairs = new Map(pathText);
  for (const [o, n] of Object.entries(files)) {
    if (posix.basename(o) !== posix.basename(n)) continue;
    let od = posix.dirname(o);
    let nd = posix.dirname(n);
    while (od !== "." && nd !== "." && od !== nd) {
      const tailOk = [...before.keys()].filter((p) => p.startsWith(`${od}/`)).every((p) => files[p] === `${nd}/${p.slice(od.length + 1)}`);
      if (tailOk) textPairs.set(od, nd);
      if (posix.basename(od) !== posix.basename(nd)) break;
      od = posix.dirname(od);
      nd = posix.dirname(nd);
    }
  }
  const esc = (x: string) => x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const textRe = textPairs.size ? new RegExp(`(?<![\\w.-])(${[...textPairs.keys()].sort((a, b) => b.length - a.length).map(esc).join("|")})(?![\\w.-])`, "g") : undefined;
  const mapText = (x: string) => (textRe ? x.replace(textRe, (m) => textPairs.get(m) ?? m) : x);

  // 옮긴 선언(파일#이름)
  const declOut = new Map<string, Set<string>>();
  const declIn = new Map<string, Set<string>>();
  for (const [o, n] of Object.entries(moves.decls)) {
    const [of, on] = o.split("#") as [string, string];
    const [nf, nn] = n.split("#") as [string, string];
    if (!of || !on || !nf || !nn) { fail(`decls 칸 모양이 틀렸어요: ${o} → ${n}("파일#이름")`); continue; }
    if (on !== nn) fail(`옮긴 선언의 이름이 바뀌었어요: ${o} → ${n}`);
    (declOut.get(of) ?? declOut.set(of, new Set()).get(of)!).add(on);
    (declIn.get(nf) ?? declIn.set(nf, new Set()).get(nf)!).add(nn);
  }

  // 견줄 짝: [옛 경로, 새 경로]
  const pairs: [string | null, string | null][] = [];
  const pairedNew = new Set<string>();
  for (const [o, n] of Object.entries(files)) {
    if (!before.has(o)) fail(`대응표 files의 옛 파일이 앞 커밋에 없어요: ${o}`);
    if (!after.has(n)) fail(`대응표 files의 새 파일이 뒤 커밋에 없어요: ${n}`);
    if (after.has(o) && !Object.values(files).includes(o)) fail(`옮겼다는 옛 파일이 뒤 커밋에도 남아 있어요: ${o}`);
    if (before.has(n) && !files[n]) fail(`옮겨 간 새 파일이 앞 커밋에 이미 있어요: ${n}`);
  }
  for (const p of [...before.keys()].filter(inScope).sort()) {
    if (files[p]) { pairs.push([p, files[p]!]); pairedNew.add(files[p]!); continue; }
    if (after.has(p)) { pairedNew.add(p); if (before.get(p) !== after.get(p)) pairs.push([p, p]); continue; }
    pairs.push([p, null]);
  }
  for (const p of [...after.keys()].filter(inScope).sort()) {
    if (pairedNew.has(p) || Object.values(files).includes(p)) continue;
    pairs.push([null, p]);
  }
  for (const n of moves.new) if (before.has(n)) fail(`new의 파일이 앞 커밋에 이미 있어요: ${n}`);

  const mapFileFor = (I: TreeIndex, p: string) => (I === B ? mapFile(p) : p);
  /** 이 파일을 읽을 때 ESM이 실제로 평가하는 모듈 차례(loadOrder)에서 부수 효과 모듈("effect 경로", 옛 쪽은 대응표로 옮긴 경로)과 바깥 패키지 점("pkg:…")만 뽑은 열.
   *  skip은 이 파일 자신의 import에서 뺄 이름(--moved에서 옮긴 선언 때문에 더하거나 뺀 import). */
  const effects = (I: TreeIndex, file: string, _map: (d: string) => string, skip: (local: string) => boolean) =>
    I.loadOrder(file, skip).filter((m) => m !== file && (m.startsWith("pkg:") || I.hasEffects(m))).map((m) => (m.startsWith("pkg:") ? m : `effect ${mapFileFor(I, m)}`));

  // --moved: 지운 파일의 이름 없는 맨 위 실행문은 하나하나 그 파일의 선언을 받은 파일에 같은 AST로 있어야 한다.
  // 지운 파일의 부수 효과 import도 받은 파일에 같은 차례로 있어야 한다(받은 파일의 import 검사에서는 그 줄을 뺀다)
  const anonIn = new Map<string, Set<AstNode>>();
  const anonOrigin = new Map<AstNode, [string, number]>();
  const claimedEffects = new Map<string, string[]>();
  if (moved) {
    for (const [o, n] of pairs) {
      if (n !== null || !o || !declOut.has(o) || !only(o)) continue;
      const receivers = [...new Set(Object.entries(moves.decls).filter(([k]) => k.startsWith(`${o}#`)).map(([, v]) => v.split("#")[0]!))].filter((r) => after.has(r));
      const runtime = B.info(o).body.filter(isRuntime);
      for (const st of B.info(o).body.filter(isAnonRun)) {
        const want = JSON.stringify(normalize(st, (x) => pathText.get(x) ?? x));
        const hit = receivers.flatMap((r) => A.info(r).body.map((x) => [r, x] as const))
          .find(([r, x]) => isAnonRun(x) && !anonIn.get(r)?.has(x) && JSON.stringify(normalize(x, (y) => y)) === want);
        if (!hit) { fail(`지운 파일 ${o}의 이름 없는 실행문이 새 자리에 없어요: ${snippet(before.get(o)!, st)}`); continue; }
        (anonIn.get(hit[0]) ?? anonIn.set(hit[0], new Set()).get(hit[0])!).add(hit[1]);
        anonOrigin.set(hit[1], [o, runtime.indexOf(st)]);
      }
      const recvSeq = new Map(receivers.map((r) => [r, effects(A, r, (d) => d, () => false)]));
      const last = new Map<string, number>();
      const usedAt = new Map<string, Set<number>>();
      for (const item of effects(B, o, mapDef, () => false)) {
        let placed = false;
        let outOfOrder: string | undefined;
        for (const r of receivers) {
          const seq = recvSeq.get(r)!;
          const used = usedAt.get(r) ?? usedAt.set(r, new Set()).get(r)!;
          const idx = seq.findIndex((x, i) => x === item && !used.has(i) && i > (last.get(r) ?? -1));
          if (idx >= 0) {
            used.add(idx);
            last.set(r, idx);
            (claimedEffects.get(r) ?? claimedEffects.set(r, []).get(r)!).push(item);
            placed = true;
            break;
          }
          if (outOfOrder === undefined && seq.some((x, i) => x === item && !used.has(i))) outOfOrder = r;
        }
        if (!placed && outOfOrder) {
          // 차례만 바뀐 줄: 받은 파일의 import 검사에서 두 번 말하지 않게 그 줄을 받은 것으로 친다
          const seq = recvSeq.get(outOfOrder)!;
          const used = usedAt.get(outOfOrder)!;
          used.add(seq.findIndex((x, i) => x === item && !used.has(i)));
          (claimedEffects.get(outOfOrder) ?? claimedEffects.set(outOfOrder, []).get(outOfOrder)!).push(item);
        }
        if (!placed) fail(outOfOrder ? `지운 파일 ${o}의 부수 효과 import 차례가 ${outOfOrder}에서 바뀌었어요: ${item}` : `지운 파일 ${o}의 부수 효과 import가 새 자리에 없어요: ${item}`);
      }
    }
  }

  const textFiles = new Set(moves.text);
  for (const [o, n] of pairs) {
    if (!only((n ?? o)!)) continue;
    if (n === null) {
      // 지움: 대응표 files에 없으면 실패. --moved에서는 선언을 모두 decls로 옮긴 파일만 된다(이름 없는 실행문은 위에서 새 자리를 본다)
      const out = declOut.get(o!);
      const info = B.info(o!);
      const rest = info.body.filter((st) => !isImportLike(st) && namesOf(st).length > 0 && !namesOf(st).every((x) => out?.has(x)));
      if (!(moved && out && rest.length === 0)) fail(`대응표에 없는 지움: ${o}`);
      continue;
    }
    if (o === null) {
      if (!moves.new.includes(n)) {
        if (!(moved && declIn.has(n))) { fail(`대응표에 없는 새 파일: ${n}`); continue; }
      }
      const info = A.info(n);
      const ins = declIn.get(n);
      const claimed = anonIn.get(n);
      const bad = info.body.filter((st) => !(st.type === "ExportNamedDeclaration" && st.source) && st.type !== "ExportAllDeclaration" && !(moved && ins && namesOf(st).length > 0 && namesOf(st).every((x) => ins.has(x))) && !claimed?.has(st) && st.type !== "ImportDeclaration");
      if (moves.new.includes(n) && info.body.some((st) => st.type === "ImportDeclaration")) fail(`새 입구 ${n}에 import가 있어요. 입구는 export … from 문장만 둬요`);
      for (const st of bad) fail(`새 파일 ${n}에 export … from이 아닌 문장이 있어요: ${snippet(after.get(n)!, st)}`);
      continue;
    }
    comparePair(o, n);
  }

  function comparePair(o: string, n: string) {
    const oldText = before.get(o)!;
    const newText = after.get(n)!;
    const oi = B.info(o);
    const ni = A.info(n);
    const outNames = declOut.get(o) ?? new Set<string>();
    const inNames = declIn.get(n) ?? new Set<string>();
    const keep = (names: Set<string>, side: string, file: string) => (st: AstNode) => {
      if (isImportLike(st)) return false;
      if (side === "뒤" && anonIn.get(file)?.has(st)) return false;
      const d = namesOf(st);
      const hit = d.filter((x) => names.has(x));
      if (hit.length && hit.length !== d.length) fail(`${side} ${file}: 문장 하나가 선언하는 이름(${d.join("·")}) 가운데 일부만 옮겼어요`);
      return hit.length === 0;
    };
    // (1) import가 아닌 문장
    const isText = textFiles.has(n);
    const strOld = (s: string) => {
      if (s.startsWith("./") || s.startsWith("../")) { const r = B.resolve(o, s); if ("path" in r) return `@mod:${mapFile(r.path)}`; }
      return isText ? mapText(s) : (pathText.get(s) ?? s);
    };
    const strNew = (s: string) => {
      if (s.startsWith("./") || s.startsWith("../")) { const r = A.resolve(n, s); if ("path" in r) return `@mod:${r.path}`; }
      return s;
    };
    const os = oi.body.filter(keep(outNames, "앞", o));
    const ns = ni.body.filter(keep(inNames, "뒤", n));
    const oj = isText ? [] : os.map((x) => JSON.stringify(normalize(x, strOld)));
    const nj = isText ? [] : ns.map((x) => JSON.stringify(normalize(x, strNew)));
    const same = (i: number, j: number) => (isText ? textSame(os[i], ns[j], strOld, strNew, mapText) : oj[i] === nj[j]);
    const at = `${n}${o !== n ? `(옛 ${o})` : ""}: import가 아닌 문장이 달라요`;
    for (const [i, j] of diffPairs(os.length, ns.length, same)) {
      const a = i === undefined ? undefined : os[i];
      const b = j === undefined ? undefined : ns[j];
      fail(`${at}(${j === undefined ? `앞 ${i! + 1}` : j + 1}번째)\n  앞: ${a ? snippet(oldText, a) : "(없음)"}\n  뒤: ${b ? snippet(newText, b) : "(없음)"}`);
    }
    if (textFiles.has(n)) {
      const ol: string[] = [];
      const nl: string[] = [];
      collectStrings(B.ast(o), ol);
      collectStrings(A.ast(n), nl);
      const had = new Set(ol);
      const changed = [...new Set(nl.filter((x) => !had.has(x)))];
      if (changed.length) notes.push(`${n}: 바뀐 글자열(따로 확인): ${changed.map((x) => JSON.stringify(x)).join(", ")}`);
    }
    // (2) import마다 (이름, type, 정의한 자리)
    const tuples = (I: TreeIndex, file: string, map: (d: string) => string) => {
      const out: string[] = [];
      for (const st of I.info(file).body) {
        if (st.type === "ImportDeclaration") {
          if (!st.specifiers.length) {
            const r = I.resolve(file, st.source.value);
            out.push(`side ${"path" in r ? mapFileFor(I, r.path) : st.source.value}`);
          }
          for (const s of st.specifiers as AstNode[]) {
            const imported = s.type === "ImportDefaultSpecifier" ? "default" : s.type === "ImportNamespaceSpecifier" ? "*" : nameOf(s.imported);
            const t = st.importKind === "type" || s.importKind === "type";
            out.push(`import ${s.local.name}${t ? " type" : ""} = ${map(I.importedDef(file, st.source.value, imported))}`);
          }
        } else if (st.type === "ExportNamedDeclaration" && st.source) {
          for (const s of st.specifiers as AstNode[]) {
            const t = st.exportKind === "type" || s.exportKind === "type";
            out.push(`export ${nameOf(s.exported)}${t ? " type" : ""} = ${map(I.importedDef(file, st.source.value, nameOf(s.local)))}`);
          }
        } else if (st.type === "ExportAllDeclaration") {
          out.push(`export ${st.exported ? nameOf(st.exported) : "*"}${st.exportKind === "type" ? " type" : ""} = ${map(I.importedDef(file, st.source.value, "*"))}`);
        }
      }
      return out.sort();
    };
    const ot = tuples(B, o, mapDef);
    const nt = tuples(A, n, (d) => d);
    // --moved: 옮긴 선언 때문에 생기는 import 차이만 된다. 뒤에 더한 import는 옮겨 나간 선언(이제 가져와 씀)이거나 옮겨 온 선언이 쓰는 이름,
    // 앞에만 있던 import는 옮겨 나간 선언만 쓰던 이름이거나 옮겨 온 선언(이제 이 파일에 있음)이다. 가리키는 정의는 위 이름 검사가 본다.
    const localOf = (t: string) => /^(?:import|export) (\S+)/.exec(t)?.[1] ?? "";
    const freeOf = (I: TreeIndex, file: string, names: Set<string>) =>
      new Set(I.info(file).body.filter((st) => declaredBy(st).names.some((x) => names.has(x))).flatMap((st) => [...freeNames(declaredBy(st).inner).all]));
    const outFree = moved && outNames.size ? freeOf(B, o, outNames) : new Set<string>();
    const inFree = moved && inNames.size ? freeOf(A, n, inNames) : new Set<string>();
    const claimed = claimedEffects.get(n) ?? [];
    const missingNew = nt.filter((t) => !ot.includes(t) && !(t.startsWith("import ") && (outNames.has(localOf(t)) || inFree.has(localOf(t)))) && !(t.startsWith("side ") && (claimed.includes(`effect ${t.slice(5)}`) || claimed.includes(`pkg:${t.slice(5)}`))));
    const restUses = new Set(ni.body.filter((st) => !isImportLike(st) && !declaredBy(st).names.some((x) => inNames.has(x))).flatMap((st) => [...freeNames(st).all]));
    const missingOld = ot.filter((t) => !nt.includes(t) && !(t.startsWith("import ") && ((outFree.has(localOf(t)) && !restUses.has(localOf(t))) || inNames.has(localOf(t)))));
    if (missingNew.length || missingOld.length) {
      fail(`${n}${o !== n ? `(옛 ${o})` : ""}: import가 가리키는 정의가 달라요\n${missingOld.map((t) => `  앞에만: ${t}`).join("\n")}${missingOld.length && missingNew.length ? "\n" : ""}${missingNew.map((t) => `  뒤에만: ${t}`).join("\n")}`);
    }
    // 부수 효과가 있는 import는 파일 안 차례대로 견준다(지운 파일에서 받은 줄은 위에서 따로 봤으니 뺀다)
    const oe = effects(B, o, mapDef, (l) => moved && ((outFree.has(l) && !restUses.has(l)) || inNames.has(l)));
    const left = [...claimed];
    const ne = effects(A, n, (d) => d, (l) => moved && (outNames.has(l) || inFree.has(l))).filter((x) => {
      const i = left.indexOf(x);
      if (i < 0) return true;
      left.splice(i, 1);
      return false;
    });
    if (JSON.stringify(oe) !== JSON.stringify(ne)) fail(`${n}${o !== n ? `(옛 ${o})` : ""}: 부수 효과가 있는 import의 차례가 달라요\n  앞: ${oe.join(" → ")}\n  뒤: ${ne.join(" → ")}`);
  }

  if (moved) movedChecks();
  valueCycles();

  function movedChecks() {
    // 글: 옮긴 선언의 정규화한 AST
    const findDecl = (I: TreeIndex, file: string, name: string) => I.tree.has(file) ? I.info(file).decls.get(name) ?? [] : [];
    for (const [o, n] of Object.entries(moves.decls)) {
      const [of, on] = o.split("#") as [string, string];
      const [nf, nn] = n.split("#") as [string, string];
      const a = findDecl(B, of, on);
      const b = findDecl(A, nf, nn);
      if (!a.length) { fail(`옮긴 선언이 앞 커밋에 없어요: ${o}`); continue; }
      if (!b.length) { fail(`옮긴 선언이 뒤 커밋에 없어요: ${n}`); continue; }
      const strO = (s: string) => pathText.get(s) ?? s;
      const ja = JSON.stringify(a.map((d) => normalize(declaredBy(d.stmt).inner, strO)));
      const jb = JSON.stringify(b.map((d) => normalize(declaredBy(d.stmt).inner, (s) => s)));
      if (ja !== jb) fail(`옮긴 선언의 글이 달라요: ${o} → ${n}\n  앞: ${snippet(before.get(of)!, a[0]!.stmt)}\n  뒤: ${snippet(after.get(nf)!, b[0]!.stmt)}`);
      // 이름이 가리키는 정의
      for (const d of a) {
        for (const name of freeNames(declaredBy(d.stmt).inner).all) {
          const od = mapDef(B.localDef(of, name));
          const nd = A.localDef(nf, name);
          if (od !== nd) fail(`옮긴 선언 ${n}: 이름 \`${name}\`이 옮기기 전에는 ${od}, 뒤에는 ${nd}를 가리켜요`);
        }
      }
    }
    // 바뀐 파일의 옮기지 않은 문장(받은 이름 없는 실행문 포함)도 자유 이름이 가리키는 정의가 같아야 한다(옮겨 온 import가 전역 이름을 가리는 것 등)
    for (const [o, n] of pairs) {
      if (!n || !only(n)) continue;
      const ins = declIn.get(n) ?? new Set<string>();
      const claimed = anonIn.get(n);
      for (const st of A.info(n).body) {
        if (isImportLike(st)) continue;
        const names = namesOf(st);
        if (names.length && names.every((x) => ins.has(x))) continue;
        const from = claimed?.has(st) ? anonOrigin.get(st)![0] : o;
        if (!from) continue;
        for (const name of freeNames(st).all) {
          const od = mapDef(B.localDef(from, name));
          const nd = A.localDef(n, name);
          if (od !== nd) fail(`${n}: 이름 \`${name}\`이 옮기기 전에는 ${od}, 뒤에는 ${nd}를 가리켜요(${snippet(after.get(n)!, st)})`);
        }
      }
    }
    // 빠짐·더함: 바뀐 파일 전체의 맨 위 선언 모음
    const oldDecls = new Set<string>();
    const newDecls = new Set<string>();
    for (const [o, n] of pairs) {
      if (o) for (const name of B.info(o).decls.keys()) oldDecls.add(mapDef(`${o}#${name}`));
      if (n) for (const name of A.info(n).decls.keys()) newDecls.add(`${n}#${name}`);
    }
    for (const d of oldDecls) if (!newDecls.has(d)) fail(`대응표에 없이 사라진 선언: ${d}`);
    for (const d of newDecls) if (!oldDecls.has(d)) fail(`대응표에 없이 생긴 선언: ${d}`);
    // 초기화 차례
    const runtimeIndex = (I: TreeIndex, file: string) => I.info(file).body.filter(isRuntime);
    for (const [o, n] of pairs) {
      if (!n) continue;
      const ins = declIn.get(n) ?? new Set<string>();
      const nb = runtimeIndex(A, n);
      const ob = o ? runtimeIndex(B, o).filter((st) => !declaredBy(st).names.some((x) => declOut.get(o)?.has(x))) : [];
      const origin = new Map<AstNode, [string, number]>();
      let k = 0;
      for (const st of nb) {
        const names = declaredBy(st).names;
        if (anonOrigin.has(st) && anonIn.get(n)?.has(st)) {
          origin.set(st, anonOrigin.get(st)!);
        } else if (names.length && names.every((x) => ins.has(x))) {
          const src = Object.entries(moves.decls).find(([, v]) => v === `${n}#${names[0]}`)?.[0];
          if (src) {
            const [of, on] = src.split("#") as [string, string];
            const idx = runtimeIndex(B, of).findIndex((s) => declaredBy(s).names.includes(on));
            origin.set(st, [of, idx]);
          }
        } else if (o) {
          const os = ob[k++];
          if (os) origin.set(st, [o, runtimeIndex(B, o).indexOf(os)]);
        }
      }
      const last = new Map<string, number>();
      for (const st of nb) {
        const or = origin.get(st);
        if (!or) continue;
        const prev = last.get(or[0]);
        if (prev !== undefined && or[1] < prev) fail(`${n}: ${or[0]}에서 온 문장의 차례가 바뀌었어요(${snippet(after.get(n)!, st)})`);
        last.set(or[0], or[1]);
      }
      // 모듈을 읽을 때 쓰는 이름은 앞쪽 선언·function 선언·import·전역이어야 한다
      const info = A.info(n);
      nb.forEach((st) => {
        const mine = declaredBy(st).names.some((x) => ins.has(x)) || !!anonIn.get(n)?.has(st);
        for (const name of freeNames(st).evalTime) {
          const ds = info.decls.get(name);
          if (!ds) continue;
          const declMoved = ins.has(name);
          if (!mine && !declMoved) continue;
          const at = info.body.indexOf(st);
          if (ds.some((d) => d.kind === "function" || d.index < at)) continue;
          if (ds.every((d) => d.kind === "type")) continue;
          fail(`${n}: \`${name}\`을 선언하기 전에 읽어요(초기화 차례, ${snippet(after.get(n)!, st)})`);
        }
      });
    }
  }

  /** 실행 때 남는 값 import 그래프(입구 포함)의 고리 안에 앞에 없던 import가 생기면 하나마다 실패한다(입구로 바꾼 import도). 필요한 것은 대응표 allow에 적는다. */
  function valueCycles() {
    const valueGraph = (I: TreeIndex) => {
      const g = new Map<string, string[]>();
      for (const f of [...I.tree.keys()].filter(inScope)) {
        let used: Set<string>;
        try { used = valueNames(I.ast(f)); } catch { continue; }
        const out: string[] = [];
        for (const st of I.info(f).body) {
          let spec: string | undefined;
          if (st.type === "ImportDeclaration" && st.importKind !== "type") {
            const vals = (st.specifiers as AstNode[]).filter((s) => s.importKind !== "type");
            if (!st.specifiers.length || vals.some((s) => used.has(s.local.name))) spec = st.source.value;
          } else if (st.type === "ExportNamedDeclaration" && st.source && st.exportKind !== "type" && (st.specifiers as AstNode[]).some((s) => s.exportKind !== "type")) spec = st.source.value;
          else if (st.type === "ExportAllDeclaration" && st.exportKind !== "type") spec = st.source.value;
          if (spec === undefined) continue;
          const r = I.resolve(f, spec);
          if ("path" in r) out.push(r.path);
        }
        g.set(f, out);
      }
      return g;
    };
    const gb = valueGraph(B);
    const ga = valueGraph(A);
    const ca = components(ga);
    const groups = new Map<number, string[]>();
    for (const [f, c] of ca) (groups.get(c) ?? groups.set(c, []).get(c)!).push(f);
    const old = new Set<string>();
    for (const [u, vs] of gb) for (const v of vs) old.add(`${mapFile(u)}\n${mapFile(v)}`);
    for (const u of [...ga.keys()].sort()) {
      for (const v of [...new Set(ga.get(u))].sort()) {
        const c = ca.get(u);
        if (c === undefined || c !== ca.get(v) || old.has(`${u}\n${v}`)) continue;
        fail(`실행 때 값 import 고리에 새 import가 생겼어요: ${u} → ${v}(고리: ${[...groups.get(c)!].sort().join(" · ")})`);
      }
    }
  }

  const firstLine = (m: string) => m.split("\n")[0]!;
  const hits = new Map<string, number>();
  for (const m of raw) hits.set(firstLine(m), (hits.get(firstLine(m)) ?? 0) + 1);
  for (const m of raw) {
    const key = firstLine(m);
    if (Object.hasOwn(moves.allow, key) && hits.get(key) === 1) notes.push(`허용(대응표): ${key} — ${moves.allow[key]}`);
    else failures.push(m);
  }
  for (const [key, why] of Object.entries(moves.allow)) {
    const count = hits.get(key) ?? 0;
    if (!String(why ?? "").trim()) failures.push(`대응표 allow의 까닭이 비었어요: ${key}`);
    else if (count === 0) failures.push(`대응표 allow에 있는데 생기지 않은 실패예요: ${key}`);
    else if (count > 1) failures.push(`대응표 allow 한 줄이 실패 ${count}개에 맞아요: ${key}`);
  }
  return { failures, notes };
}

function collectStrings(n: unknown, out: string[]): void {
  if (Array.isArray(n)) { n.forEach((c) => collectStrings(c, out)); return; }
  if (!n || typeof n !== "object") return;
  const node = n as AstNode;
  if (node.type === "ImportDeclaration" || node.type === "ExportAllDeclaration" || (node.type === "ExportNamedDeclaration" && node.source)) return;
  if (node.type === "Literal" && typeof node.value === "string") out.push(node.value);
  for (const [k, v] of Object.entries(node)) if (k !== "start" && k !== "end") collectStrings(v, out);
}

/** 강하게 이어진 묶음 번호(크기 1이고 제 고리 없는 것도 번호를 받는다). */
function components(g: Map<string, string[]>): Map<string, number> {
  const index = new Map<string, number>();
  const low = new Map<string, number>();
  const onStack = new Set<string>();
  const stack: string[] = [];
  const comp = new Map<string, number>();
  let counter = 0;
  let id = 0;
  for (const start of g.keys()) {
    if (index.has(start)) continue;
    const work: { n: string; i: number }[] = [{ n: start, i: 0 }];
    index.set(start, counter); low.set(start, counter); counter++; stack.push(start); onStack.add(start);
    while (work.length) {
      const top = work[work.length - 1]!;
      const succ = g.get(top.n) ?? [];
      if (top.i < succ.length) {
        const m = succ[top.i++]!;
        if (!index.has(m)) { index.set(m, counter); low.set(m, counter); counter++; stack.push(m); onStack.add(m); work.push({ n: m, i: 0 }); }
        else if (onStack.has(m)) low.set(top.n, Math.min(low.get(top.n)!, index.get(m)!));
        continue;
      }
      work.pop();
      if (work.length) { const p = work[work.length - 1]!.n; low.set(p, Math.min(low.get(p)!, low.get(top.n)!)); }
      if (low.get(top.n) === index.get(top.n)) { let m: string; do { m = stack.pop()!; onStack.delete(m); comp.set(m, id); } while (m !== top.n); id++; }
    }
  }
  return comp;
}

// ---------- git ----------

/** 커밋 하나의 파일(견주는 곳의 코드 파일과 대응표). */
export function gitTree(root: string, ref: string): Tree {
  const names = execFileSync("git", ["-C", root, "ls-tree", "-r", "-z", "--name-only", ref], { maxBuffer: 1 << 28 })
    .toString("utf8").split("\0").filter((p) => p && ((isCode(p) && SCOPE.some((s) => p.startsWith(s))) || (p.startsWith(MOVES_DIR) && p.endsWith(".json"))));
  const out = execFileSync("git", ["-C", root, "cat-file", "--batch"], { input: names.map((n) => `${ref}:${n}`).join("\n") + "\n", maxBuffer: 1 << 30 });
  const tree: Tree = new Map();
  let pos = 0;
  for (const name of names) {
    const nl = out.indexOf(10, pos);
    const header = out.subarray(pos, nl).toString("utf8");
    const size = Number(header.split(" ")[2]);
    if (!Number.isFinite(size)) throw new Error(`git cat-file이 ${name}를 못 읽었어요: ${header}`);
    tree.set(name, out.subarray(nl + 1, nl + 1 + size).toString("utf8"));
    pos = nl + 1 + size + 1;
  }
  return tree;
}

export function runCli(root: string, args: string[]): Result {
  const pos = args.filter((a, i) => !a.startsWith("--") && !["--moves", "--only"].includes(args[i - 1] ?? ""));
  const [beforeRef, afterRef] = pos;
  if (!beforeRef || !afterRef) throw new Error("쓰는 법: tsx scripts/check-moves.ts <앞 커밋> <뒤 커밋> [--moves <대응표>] [--moved] [--only <경로>]…");
  const before = gitTree(root, beforeRef);
  const after = gitTree(root, afterRef);
  let movesPath = args[args.indexOf("--moves") + 1];
  if (!args.includes("--moves")) {
    const changed = [...after.keys()].filter((p) => p.startsWith(MOVES_DIR) && before.get(p) !== after.get(p));
    if (changed.length !== 1) throw new Error(`두 커밋 사이에 새로 생기거나 바뀐 대응표가 하나여야 해요(${changed.length}개: ${changed.join(", ")}). --moves로 주세요`);
    movesPath = changed[0];
  }
  const text = after.get(movesPath!);
  if (text === undefined) throw new Error(`뒤 커밋에 대응표가 없어요: ${movesPath}`);
  const only = args.flatMap((a, i) => (args[i - 1] === "--only" ? [a] : []));
  const result = checkMoves(before, after, parseMoves(text), { moved: args.includes("--moved"), only });
  result.notes.unshift(`대응표: ${movesPath}`);
  return result;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const root = fileURLToPath(new URL("..", import.meta.url));
  try {
    const { failures, notes } = runCli(root, process.argv.slice(2));
    for (const n of notes) console.log(n);
    for (const f of failures) console.error(f);
    if (failures.length) { console.error(`옮김 검사 실패 ${failures.length}개`); process.exit(1); }
    console.log("옮김 검사 통과: import 경로만 달라졌어요");
  } catch (e) {
    console.error((e as Error).message);
    process.exit(2);
  }
}
