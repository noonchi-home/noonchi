// 가전 종류 등록부 구조 검사(tests/kinds-registry.test.ts): src/·ui/src/·scripts/의 TypeScript를 TypeScript 프로그램(구문 트리 + 타입 검사기, TypeScript 7 API)으로 읽어
// src/devices/kinds.ts 밖의 가전 종류별 표를 찾는다. 까닭: 가전 종류별 값은 src/devices/kinds.ts 등록부 칸으로 둔다(새 종류는 등록부 한 줄 + added_devices.json 한 줄).
// 「종류 이름」은 DeviceKind의 값(등록부 키), 「카메라 설비 이름」은 FixtureClass의 값이다.
import { join, relative, resolve } from "node:path";
import { API, type Checker, type Project, type Type } from "typescript/unstable/sync";
import { SyntaxKind, computeLineStarts, type Node, type SourceFile } from "typescript/unstable/ast";

export const KIND_TABLE_WHY = "가전 종류별 값은 src/devices/kinds.ts 등록부 칸으로 둔다(새 종류는 등록부 한 줄 + added_devices.json 한 줄)";

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

/** 잠시 허용 목록(파일·줄 내용과 까닭). 비어 있어야 한다(tests/kinds-registry.test.ts 「kinds registry: TEMP_ALLOW is empty」). */
export const TEMP_ALLOW: readonly { file: string; text: string; why: string }[] = [];

/** 종류·카메라 설비 이름이 키·글로 둘 이상 나와도 가전 종류 표가 아닌 표(파일·선언 이름과 까닭). object-keys·array-kinds 규칙에서만 뺀다. */
export const TABLE_ALLOW: readonly { file: string; name: string; why: string }[] = [
  { file: "src/world/vocab.ts", name: "CLASSES", why: "감지 종류(COCO) 낱말 표: 사람·물건·가구·가전 설비 종류가 함께 있다" },
  { file: "src/world/vocab-doc.ts", name: "CLASS_DOC", why: "감지 종류(COCO) 낱말 표의 문서 글(계기 예)" },
  { file: "scripts/demo-start.ts", name: "DEMO_STARTS", why: "시연 장면 이름 → 시작 위치 표(장면 이름 tv·microwave가 종류 이름과 겹친다)" },
  { file: "src/phone/sync/classes.ts", name: "LANDMARK_KEYS", why: "위치 맞추기 기준점 감지 종류(COCO) 목록" },
  { file: "src/phone/sync/landmarks.ts", name: "LANDMARK_TYPES", why: "기준점 감지 종류(COCO) → 트윈 type 표" },
  { file: "src/plan/labels.ts", name: "PLACE_SHORT", why: "평면도 물건 트윈 type → 짧은 이름 표(가구 포함)" },
  { file: "src/devices/mapping.ts", name: "MODEL_KEY", why: "Matter 모델 → 요약 키 표(모델 이름이 종류 이름과 겹친다)" },
  { file: "src/devices/kinds-check.ts", name: "CAPABILITY_COMMANDS", why: "기능(capability) → 낼 수 있는 명령 표(기능 이름 fan·covering·lock·valve가 종류 이름과 겹친다)" },
];

/** 종류 이름과 견주는 비교(compare-kind·array-kinds의 includes 꼴)를 허용하는 파일: 말 꾸밈 갈래(밝기·음량·냉방 모드 글, 제어·승인 길이 아니다). */
export const COMPARE_ALLOW = ["src/agent/phrases.ts", "ui/src/bubbles/summary.ts"];

/** 등록부 파일(검사하지 않는다). */
export const REGISTRY_FILE = "src/devices/kinds.ts";

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

interface Names { kinds: Set<string>; fixtures: Set<string>; deviceKind: Type }

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
    const types = project.program.getSourceFile(join(kp.root, "src", "devices/hub", "types.ts"));
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
    return { kinds: new Set(literalValues(deviceKind)), fixtures: new Set(alias("FixtureClass")), deviceKind, checker, project };
  }
  throw new Error("src/devices/hub/types.ts·src/world/vocab.ts를 읽지 못했어요");
}

const FROM_REGISTRY = /\b(KINDS|KIND_ORDER)\b/;
const KIND_TYPE_ANNOTATION = /\bRecord<\s*DeviceKind\b|\bDeviceKind\s*\[\s*\]|Array<\s*DeviceKind\s*>/;

/**
 * 한 파일의 종류별 표 자리. as: 이 파일을 그 저장소 경로에 있는 것처럼 본다(예제 파일 시험).
 * 규칙: type-record(Record<DeviceKind,…>·DeviceKind[] 값 목록 상수), object-keys(종류·카메라 설비 이름 키 둘 이상, TABLE_ALLOW 표는 뺀다),
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
  /** 그 자리를 품은 선언이 TABLE_ALLOW에 있는가. */
  const tableAllowed = (node: Node): boolean => {
    for (let p: Node | undefined = node; p; p = p.parent) {
      if (p.kind === SyntaxKind.VariableDeclaration) {
        const nm = nameText((p as unknown as { name?: Node }).name);
        if (TABLE_ALLOW.some((a) => a.file === repoPath && a.name === nm)) return true;
      }
    }
    return false;
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
        // 종류·카메라 설비 이름인 키가 둘 이상(다른 키가 섞여도). 가전 종류 표가 아닌 표는 TABLE_ALLOW로 뺀다
        const props = (node as unknown as { properties: readonly Node[] }).properties;
        const named = props.map(keyName).filter((k) => k !== undefined && (n.kinds.has(k) || n.fixtures.has(k)));
        if (named.length >= 2 && !fromRegistry(node) && !tableAllowed(node)) add(node, "object-keys");
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
        // 종류 이름 글이 둘 이상(다른 글이 섞여도). 가전 종류 목록이 아닌 목록은 TABLE_ALLOW로 빼고, 말 꾸밈 파일의 includes 꼴은 비교로 본다
        const els = (node as unknown as { elements: readonly Node[] }).elements;
        if (els.filter((e) => kindStr(e)).length >= 2 && !compareAllowed && !fromRegistry(node) && !tableAllowed(node)) add(node, "array-kinds");
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
