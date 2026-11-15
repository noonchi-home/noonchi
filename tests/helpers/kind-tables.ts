// 가전 종류 등록부 구조 검사(tests/kinds-registry.test.ts): src/·ui/src/·scripts/의 TypeScript를 TypeScript 프로그램(구문 트리 + 타입 검사기, TypeScript 7 API)으로 읽어
// src/model/kinds.ts 밖의 가전 종류별 표를 찾는다. 까닭: 가전 종류별 값은 src/model/kinds.ts 등록부 칸으로 둔다(새 종류는 등록부 한 줄 + added_devices.json 한 줄).
// 「종류 이름」은 DeviceKind의 값(등록부 키), 「카메라 설비 이름」은 FixtureClass의 값이다.
import { join, relative, resolve } from "node:path";
import { API, type Checker, type Project, type Type } from "typescript/unstable/sync";
import { SyntaxKind, computeLineStarts, type Node, type SourceFile } from "typescript/unstable/ast";

export const KIND_TABLE_WHY = "가전 종류별 값은 src/model/kinds.ts 등록부 칸으로 둔다(새 종류는 등록부 한 줄 + added_devices.json 한 줄)";

export interface KindTableHit {
  /** 저장소 기준 경로(/ 구분). */
  file: string;
  line: number;
  rule: string;
  /** 그 자리를 품은 선언 이름(없으면 빈 글). */
  name: string;
  /** 그 줄(앞뒤 빈칸 뺌). */
  text: string;
}

/** 잠시 허용(11r-1에서만): ThinQ 읽기·제어·반영 갈래. Task 11r-2에서 어댑터로 옮기며 지운다(11r-2 시험 「kinds registry: TEMP_ALLOW is empty」). */
export const TEMP_ALLOW: readonly { file: string; text: string; why: string }[] = [
  { file: "src/thinq/appliance.ts", text: 'if (kind === "aircon") {', why: "Task 11r-2에서 어댑터로 옮기며 지움" },
  { file: "src/thinq/appliance.ts", text: 'if (kind === "fridge") {', why: "Task 11r-2에서 어댑터로 옮기며 지움" },
  { file: "src/thinq/appliance.ts", text: 'if (kind !== "aircon") return null;', why: "Task 11r-2에서 어댑터로 옮기며 지움" },
  { file: "src/thinq/appliance.ts", text: 'if (spec.kind === "aircon") {', why: "Task 11r-2에서 어댑터로 옮기며 지움" },
  { file: "src/thinq/appliance.ts", text: '} else if (spec.kind === "fridge") {', why: "Task 11r-2에서 어댑터로 옮기며 지움" },
];

/** 종류 이름과 견주는 비교(compare-kind·array-kinds의 includes 꼴)를 허용하는 파일: 말 꾸밈 갈래(밝기·음량·냉방 모드 글, 제어·승인 길이 아니다). */
export const COMPARE_ALLOW = ["src/agent/phrases.ts", "ui/src/bubbles/summary.ts"];

/** 등록부 파일(검사하지 않는다). */
export const REGISTRY_FILE = "src/model/kinds.ts";

export interface KindProject {
  root: string;
  projects: Project[];
  close(): void;
}

/** 저장소 TypeScript 프로젝트(뿌리 tsconfig: src·tests·scripts, ui/tsconfig: ui/src)를 연다. */
export function openKindProject(root: string): KindProject {
  const api = new API({ cwd: root });
  const snap = api.updateSnapshot({ openProjects: [join(root, "tsconfig.json"), join(root, "ui", "tsconfig.json")] });
  return { root, projects: [...snap.getProjects()], close: () => api.close() };
}

const posix = (p: string) => p.replace(/\\/g, "/");

/** 저장소에서 검사할 파일(src/·ui/src/·scripts/의 .ts·.tsx, 등록부와 .d.ts 제외). */
export function scannedFiles(kp: KindProject): string[] {
  const out = new Set<string>();
  for (const p of kp.projects) {
    for (const f of p.program.getSourceFileNames()) {
      const rel = posix(relative(kp.root, f));
      if (!/^(src|ui\/src|scripts)\//.test(rel) || !/\.tsx?$/.test(rel) || rel.endsWith(".d.ts") || rel === REGISTRY_FILE) continue;
      out.add(rel);
    }
  }
  return [...out].sort();
}

interface Names { kinds: Set<string>; fixtures: Set<string>; others: Set<string>; deviceKind: Type }

const literalValues = (t: Type | undefined): string[] => {
  if (!t) return [];
  const u = t as unknown as { getTypes?: () => readonly Type[]; value?: unknown };
  const parts = (typeof u.getTypes === "function" ? u.getTypes() : undefined) ?? [t];
  return parts.flatMap((x) => (typeof (x as unknown as { value?: unknown }).value === "string" ? [(x as unknown as { value: string }).value] : []));
};

function walk(node: Node, fn: (n: Node) => void): void {
  fn(node);
  node.forEachChild((c) => { walk(c, fn); return undefined; });
}

function find(sf: SourceFile, pred: (n: Node) => boolean): Node | undefined {
  let hit: Node | undefined;
  walk(sf, (n) => { if (!hit && pred(n)) hit = n; });
  return hit;
}

const nameText = (n: Node | undefined): string => (n as unknown as { text?: string } | undefined)?.text ?? "";

/** DeviceKind·감지 종류 이름을 타입 검사기에서 읽는다(등록부를 만들기 전·뒤 모두). */
function names(kp: KindProject): Names & { checker: Checker; project: Project } {
  for (const project of kp.projects) {
    const types = project.program.getSourceFile(join(kp.root, "src", "hub", "types.ts"));
    const vocab = project.program.getSourceFile(join(kp.root, "src", "world", "vocab.ts"));
    if (!types || !vocab) continue;
    const checker = project.checker;
    const spec = find(types, (n) => n.kind === SyntaxKind.InterfaceDeclaration && nameText((n as unknown as { name: Node }).name) === "DeviceSpec");
    const kindProp = spec && find(spec as unknown as SourceFile, (n) => n.kind === SyntaxKind.PropertySignature && nameText((n as unknown as { name: Node }).name) === "kind");
    const deviceKind = checker.getTypeAtLocation((kindProp as unknown as { name: Node }).name)!;
    const alias = (name: string) => {
      const d = find(vocab, (n) => n.kind === SyntaxKind.TypeAliasDeclaration && nameText((n as unknown as { name: Node }).name) === name);
      return literalValues(d ? checker.getTypeAtLocation((d as unknown as { name: Node }).name) : undefined);
    };
    const fixtures = new Set(alias("FixtureClass"));
    const all = alias("ClassKey");
    return { kinds: new Set(literalValues(deviceKind)), fixtures, others: new Set(all.filter((c) => !fixtures.has(c))), deviceKind, checker, project };
  }
  throw new Error("src/hub/types.ts·src/world/vocab.ts를 읽지 못했어요");
}

const FROM_REGISTRY = /\b(KINDS|KIND_ORDER)\b/;
const KIND_TYPE_ANNOTATION = /\bRecord<\s*DeviceKind\b|\bDeviceKind\s*\[\s*\]|Array<\s*DeviceKind\s*>/;

/**
 * 한 파일의 종류별 표 자리. as: 이 파일을 그 저장소 경로에 있는 것처럼 본다(예제 파일 시험).
 * 규칙: type-record(Record<DeviceKind,…>·DeviceKind[] 값 목록 상수), object-keys(종류·카메라 설비 이름 키 둘 이상, 사람·물건·가구 감지 종류가 섞인 감지 종류 표는 뺀다),
 * computed-key(식 타입이 DeviceKind인 계산 키), from-entries(Object.fromEntries에 종류 이름 둘 이상 또는 DeviceKind 키 쌍), array-kinds(배열에 종류 이름 둘 이상),
 * device-kind(deviceKind에 글 값), compare-kind(종류 이름과 견주는 비교·switch case), kind-rules(kind: "<종류 이름>"가 든 배열).
 * 등록부(KINDS·KIND_ORDER)에서 만든 식은 통과한다.
 */
export function findKindTables(kp: KindProject, file: string, opts: { as?: string } = {}): KindTableHit[] {
  const n = names(kp);
  const abs = resolve(kp.root, file);
  let sf: SourceFile | undefined;
  let checker = n.checker;
  for (const p of kp.projects) {
    sf = p.program.getSourceFile(abs);
    if (sf) { checker = p.checker; break; }
  }
  if (!sf) throw new Error(`프로그램에 없는 파일이에요: ${file}`);
  const repoPath = posix(opts.as ?? relative(kp.root, abs));
  const text = sf.text;
  const lineStarts = computeLineStarts(text);
  const lineOf = (pos: number) => {
    let lo = 0, hi = lineStarts.length - 1;
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (lineStarts[mid]! <= pos) lo = mid; else hi = mid - 1; }
    return lo + 1;
  };
  const lineText = (line: number) => text.slice(lineStarts[line - 1], lineStarts[line] ?? text.length).trim();
  const src = (node: Node) => text.slice(node.getStart(sf), node.end);
  const hits: KindTableHit[] = [];
  const owner = (node: Node): string => {
    for (let p: Node | undefined = node; p; p = p.parent) {
      if (p.kind === SyntaxKind.VariableDeclaration || p.kind === SyntaxKind.FunctionDeclaration || p.kind === SyntaxKind.MethodDeclaration
        || p.kind === SyntaxKind.PropertyDeclaration || p.kind === SyntaxKind.PropertyAssignment) {
        const nm = nameText((p as unknown as { name?: Node }).name);
        if (nm) return nm;
      }
    }
    return "";
  };
  const add = (node: Node, rule: string) => {
    const line = lineOf(node.getStart(sf));
    const t = lineText(line);
    if (TEMP_ALLOW.some((a) => a.file === repoPath && a.text === t)) return;
    hits.push({ file: repoPath, line, rule, name: owner(node), text: t });
  };
  const isStr = (node: Node | undefined): boolean => !!node && (node.kind === SyntaxKind.StringLiteral || node.kind === SyntaxKind.NoSubstitutionTemplateLiteral);
  const str = (node: Node) => (node as unknown as { text: string }).text;
  const kindStr = (node: Node | undefined) => !!node && isStr(node) && n.kinds.has(str(node));
  /** 식 타입이 DeviceKind(또는 그 일부 유니언)인가. 이름·속성은 좁히기 전 선언 타입으로 본다(Model 「valve」처럼 좁혀져 종류 이름만 남는 것을 거르려고). any·never·오류 타입은 아니다. */
  const declaredType = (node: Node): Type | undefined => {
    const target = node.kind === SyntaxKind.PropertyAccessExpression ? (node as unknown as { name: Node }).name : node;
    if (target.kind === SyntaxKind.Identifier) {
      const sym = checker.getSymbolAtLocation(target);
      const t = sym ? checker.getTypeOfSymbol(sym) : undefined;
      if (t) return t;
    }
    return checker.getTypeAtLocation(node);
  };
  const isKindType = (node: Node): boolean => {
    const t = declaredType(node);
    if (!t) return false;
    const vals = literalValues(t);
    if (!vals.length) return false;
    const parts = (t as unknown as { getTypes?: () => readonly Type[] }).getTypes?.() ?? [t];
    return vals.length === parts.length && vals.every((v) => n.kinds.has(v));
  };
  /** 이름이 kind인 지역 변수·매개변수나 .kind 속성. */
  const namedKind = (node: Node): boolean =>
    (node.kind === SyntaxKind.Identifier && str(node) === "kind")
    || (node.kind === SyntaxKind.PropertyAccessExpression && nameText((node as unknown as { name: Node }).name) === "kind");
  /** 등록부에서 만든 식 안인가: 그 문장(선언) 글에 KINDS·KIND_ORDER가 있다. */
  const fromRegistry = (node: Node): boolean => {
    for (let p: Node | undefined = node; p; p = p.parent) {
      if (p.kind === SyntaxKind.VariableDeclaration || p.kind === SyntaxKind.ExpressionStatement || p.kind === SyntaxKind.ReturnStatement || p.kind === SyntaxKind.PropertyDeclaration) {
        return FROM_REGISTRY.test(src(p));
      }
    }
    return false;
  };
  const keyName = (prop: Node): string | undefined => {
    const name = (prop as unknown as { name?: Node }).name;
    if (!name) return undefined;
    if (name.kind === SyntaxKind.Identifier || name.kind === SyntaxKind.StringLiteral || name.kind === SyntaxKind.NumericLiteral) return str(name);
    if (name.kind === SyntaxKind.ComputedPropertyName) {
      const e = (name as unknown as { expression: Node }).expression;
      if (isStr(e)) return str(e);
      const vals = literalValues(checker.getTypeAtLocation(e));
      return vals.length === 1 ? vals[0] : undefined;
    }
    return undefined;
  };
  const compareOps = new Set([SyntaxKind.EqualsEqualsEqualsToken, SyntaxKind.ExclamationEqualsEqualsToken, SyntaxKind.EqualsEqualsToken, SyntaxKind.ExclamationEqualsToken]);
  const compareAllowed = COMPARE_ALLOW.includes(repoPath);

  walk(sf, (node) => {
    switch (node.kind) {
      case SyntaxKind.VariableDeclaration: {
        const d = node as unknown as { type?: Node; initializer?: Node };
        if (d.type && d.initializer && KIND_TYPE_ANNOTATION.test(src(d.type)) && !FROM_REGISTRY.test(src(d.initializer))) add(node, "type-record");
        break;
      }
      case SyntaxKind.ObjectLiteralExpression: {
        // 키가 모두 종류·카메라 설비 이름이고 둘 이상. 다른 이름이 섞인 표(감지 종류·트윈 type·Matter 모델 표)와, 다른 유니언으로 키를 정한 표(Record<Model, …>)는 아니다
        const props = (node as unknown as { properties: readonly Node[] }).properties;
        const keys = props.map(keyName);
        const named = (k: string | undefined) => k !== undefined && (n.kinds.has(k) || n.fixtures.has(k));
        if (keys.length < 2 || !keys.every(named) || fromRegistry(node)) break;
        const ctx = checker.getContextualType(node as Parameters<Checker["getContextualType"]>[0]);
        const ctxKeys = ctx ? checker.getPropertiesOfType(ctx).map((sym) => (sym as unknown as { name: string }).name) : [];
        if (ctxKeys.length && !ctxKeys.every((k) => named(k))) break;
        add(node, "object-keys");
        break;
      }
      case SyntaxKind.ComputedPropertyName: {
        const e = (node as unknown as { expression: Node }).expression;
        if (!isStr(e) && isKindType(e) && !fromRegistry(node)) add(node, "computed-key");
        break;
      }
      case SyntaxKind.CallExpression: {
        const c = node as unknown as { expression: Node; arguments: readonly Node[] };
        if (src(c.expression) !== "Object.fromEntries" || !c.arguments[0]) break;
        const arg = c.arguments[0];
        if (FROM_REGISTRY.test(src(arg))) break;
        let strs = 0;
        let kindPair = false;
        walk(arg, (x) => {
          if (kindStr(x)) strs++;
          if (x.kind === SyntaxKind.ArrayLiteralExpression) {
            const first = (x as unknown as { elements: readonly Node[] }).elements[0];
            if (first && (x as unknown as { elements: readonly Node[] }).elements.length >= 2 && !isStr(first) && isKindType(first)) kindPair = true;
          }
        });
        if (strs >= 2 || kindPair) add(node, "from-entries");
        break;
      }
      case SyntaxKind.ArrayLiteralExpression: {
        // 글 원소가 모두 종류 이름이고 둘 이상(감지 종류 목록처럼 다른 이름이 섞인 것은 아니다). 말 꾸밈 파일의 includes 꼴은 비교로 본다
        const els = (node as unknown as { elements: readonly Node[] }).elements;
        const strs = els.filter((e) => isStr(e));
        if (strs.length >= 2 && strs.every((e) => kindStr(e)) && !compareAllowed && !fromRegistry(node)) add(node, "array-kinds");
        const rules = els.filter((e) => e.kind === SyntaxKind.ObjectLiteralExpression
          && (e as unknown as { properties: readonly Node[] }).properties.some((p) => p.kind === SyntaxKind.PropertyAssignment && keyName(p) === "kind" && kindStr((p as unknown as { initializer: Node }).initializer)));
        if (rules.length) add(node, "kind-rules");
        break;
      }
      case SyntaxKind.PropertyAssignment: {
        if (keyName(node) !== "deviceKind") break;
        const v = (node as unknown as { initializer: Node }).initializer;
        if (isStr(v) || (v.kind === SyntaxKind.Identifier && literalValues(checker.getTypeAtLocation(v)).some((x) => n.kinds.has(x)))) add(node, "device-kind");
        break;
      }
      case SyntaxKind.BinaryExpression: {
        if (compareAllowed) break;
        const b = node as unknown as { left: Node; right: Node; operatorToken: Node };
        if (!compareOps.has(b.operatorToken.kind)) break;
        const [lit, other] = kindStr(b.right) ? [b.right, b.left] : kindStr(b.left) ? [b.left, b.right] : [undefined, undefined];
        if (lit && other && (namedKind(other) || isKindType(other))) add(node, "compare-kind");
        break;
      }
      case SyntaxKind.CaseClause: {
        if (compareAllowed) break;
        const e = (node as unknown as { expression: Node }).expression;
        if (!kindStr(e)) break;
        const sw = node.parent?.parent as unknown as { expression?: Node } | undefined;
        if (sw?.expression && (namedKind(sw.expression) || isKindType(sw.expression))) add(node, "compare-kind");
        break;
      }
    }
  });
  return hits;
}

/** 저장소 전체 검사. */
export function findAllKindTables(kp: KindProject): KindTableHit[] {
  return scannedFiles(kp).flatMap((f) => findKindTables(kp, f));
}
