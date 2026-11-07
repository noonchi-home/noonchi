// 21st.dev 부품 검사. 화면에 보이는 부품은 21st.dev 부품을 그대로 쓰거나 받은 코드를 고친 것만 쓴다.
// (1) ui/src/components/ui/ 파일마다 맨 위에 출처 줄(21st.dev 이름·id·작성자/slug)과 바꾼 것 줄이 있다.
// (2) 그 밖의 화면 코드(ui/src)는 부품을 놓기만 한다: 요소에 꾸밈 class(배경·글자색·테두리·모서리·그림자·링·흐림·글꼴)나 꾸밈 style이 없다.
//     배치 class(flex·grid·gap·여백·크기·위치·inset·z·overflow·order·정렬·숨김·pointer-events·transform)는 된다. three.js 장면 코드는 규칙 밖이다.
// 사용: npm run lint (tests/lint-ui-parts.test.ts도 같은 검사를 돌린다)

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { codeStrings } from "./lint-ui-copy.js";

export type PartsProblem = { file: string; line: number; text: string; rule: string };

const ROOT = fileURLToPath(new URL("../", import.meta.url));
export const PARTS_TARGET = fileURLToPath(new URL("../ui/src/", import.meta.url));

export const HEADER_FIX =
  "ui/src/components/ui에는 21st.dev에서 받은 코드만 둬요(mcp__21st__get_component). 맨 위에 「// 21st.dev「이름」(id N, 작성자/slug) 받은 코드.」 줄과 그다음 「// 바꾼 것: …」 줄을 두세요.";
export const PARTS_FIX =
  "화면 코드는 부품을 놓기만 해요. 배경·글자색·테두리·모서리·그림자·링·흐림·글꼴은 ui/src/components/ui의 21st.dev 부품을 쓰세요. 맞는 부품이 없으면 21st.dev에서 받아 그 폴더에 두세요.";

const HEADER = /^\/\/ 21st\.dev「[^」]+」\(id \d+, [\w.-]+\/[\w.-]+\) 받은 코드\.$/;
const CHANGED = /^\/\/ 바꾼 것: \S/;

/** 출처 줄 검사. 맨 위 "use client"·빈 줄 다음 첫 주석 줄이 출처 줄이고, 바로 다음 줄이 바꾼 것 줄이다. */
export function headerProblems(file: string, src: string): PartsProblem[] {
  const lines = src.split(/\r?\n/);
  let i = 0;
  while (i < lines.length && (/^\s*$/.test(lines[i]!) || /^["']use client["'];?$/.test(lines[i]!.trim()))) i++;
  const head = lines[i]?.trim() ?? "";
  if (!HEADER.test(head)) return [{ file, line: i + 1, text: head.slice(0, 80), rule: "출처 줄" }];
  const next = lines[i + 1]?.trim() ?? "";
  if (!CHANGED.test(next)) return [{ file, line: i + 2, text: next.slice(0, 80), rule: "바꾼 것 줄" }];
  return [];
}

/** 꾸밈 class 몸(변형을 뗀 것). 배치·움직임 class는 여기 없다. */
const VISUAL = [
  /^bg-/, /^text-(?!(?:left|center|right|justify|start|end|wrap|nowrap|balance|pretty|ellipsis|clip)$)/,
  /^border(?:-(?!(?:collapse|separate|spacing)(?:-|$)).*)?$/, /^rounded(?:-.*)?$/, /^(?:inset-)?shadow(?:-.*)?$/, /^(?:inset-)?ring(?:-.*)?$/,
  /^outline(?:-.*)?$/, /^(?:backdrop-.+|blur(?:-.*)?|drop-shadow(?:-.*)?|brightness-.+|contrast-.+|saturate-.+|grayscale|invert|sepia|hue-rotate-.+)$/,
  /^font-/, /^(?:leading|tracking)-/, /^(?:italic|underline|overline|line-through|uppercase|lowercase|capitalize|antialiased)$/,
  /^(?:fill|stroke|decoration|divide|placeholder|caret|accent|from|via|to)-/,
  // 임의 속성 class: [background:…]·[border-radius:…]·[box-shadow:…]·[font-size:…]·[filter:…]
  /^\[(?:-webkit-)?(?:background|color|border|outline|box-shadow|text-shadow|font|line-height|letter-spacing|filter|backdrop-filter|fill|stroke|text-decoration|caret-color|accent-color)(?:-[\w-]+)?:/,
];
/** 꾸밈 inline style 칸(React style 객체·DOM el.style). left·top·transform·opacity는 자리·움직임이라 된다. */
const VISUAL_STYLE = /^(?:background\w*|color|border\w*|outline\w*|boxShadow|textShadow|backdropFilter|WebkitBackdropFilter|filter|font\w*|lineHeight|letterSpacing|fill|stroke|textDecoration\w*|cssText)$/;

/** class 낱말 몸: hover:·max-sm:·data-[…]: 같은 변형과 !, 음수 -를 뗀다. */
function baseOf(token: string): string {
  let depth = 0;
  let cut = 0;
  for (let i = 0; i < token.length; i++) {
    const c = token[i];
    if (c === "[" || c === "(") depth++;
    else if (c === "]" || c === ")") depth--;
    else if (c === ":" && depth === 0) cut = i + 1;
  }
  return token.slice(cut).replace(/^!|!$/g, "").replace(/^-/, "");
}

const lineAt = (src: string, index: number) => src.slice(0, index).split("\n").length;
/** pos가 JSX 여는 태그(<Tag … 안)에 있는지. 따옴표 글과 {식}은 건너뛰고, 그 밖의 >·/>·;를 만나면 태그 밖이다. */
function insideJsxTag(src: string, pos: number): boolean {
  const before = src.slice(Math.max(0, pos - 600), pos);
  const tags = [...before.matchAll(/<[A-Za-z][\w.]*(?=[\s>/])/g)];
  const last = tags[tags.length - 1];
  if (!last) return false;
  const body = before.slice(last.index! + last[0].length);
  let depth = 0;
  let quote = "";
  for (let i = 0; i < body.length; i++) {
    const c = body[i]!;
    if (quote) { if (c === quote) quote = ""; continue; }
    if (c === '"' || c === "'" || c === "`") quote = c;
    else if (c === "{") depth++;
    else if (c === "}") depth--;
    else if (depth === 0 && (c === ";" || (c === ">" && body[i - 1] !== "="))) return false;
  }
  return true;
}

/** class를 받는 속성: className·class와 이름이 ClassName으로 끝나는 속성(contentClassName 등). */
const CLASS_ATTR = /^(?:className|class|\w*ClassName)$/;

const blankComments = (src: string) => src.replace(/\/\*[\s\S]*?\*\/|(^|[^:"'`])\/\/.*$/gm, (m) => m.replace(/[^\n]/g, " "));

/** 화면 코드 파일 하나의 꾸밈. three.js를 쓰는 장면 코드는 보지 않는다. */
export function screenProblems(file: string, src: string): PartsProblem[] {
  if (/^\s*import\b[^;]*from\s+["']three(?:\/[^"']*)?["']/m.test(src)) return [];
  const hits: { at: number; text: string; rule: string }[] = [];
  const jsx = file.endsWith(".tsx");
  for (const s of codeStrings(src, jsx)) {
    // class를 받지 않는 JSX 속성 값(variant="outline", aria-label="…")은 class가 아니다. const cls="…" 같은 변수는 본다
    const attr = /([A-Za-z_][\w-]*)=\s*\{?\s*$/.exec(src.slice(Math.max(0, s.start - 60), s.start));
    if (attr && !CLASS_ATTR.test(attr[1]!) && jsx && insideJsxTag(src, s.start - attr[0].length)) continue;
    for (const m of s.text.matchAll(/\S+/g)) {
      if (VISUAL.some((re) => re.test(baseOf(m[0])))) hits.push({ at: s.start + 1 + m.index!, text: m[0], rule: "꾸밈 class" });
    }
  }
  const code = blankComments(src);
  // React style 객체: style={{ … }}의 첫 단계 칸 이름
  for (const m of code.matchAll(/\bstyle=\{\{/g)) {
    let depth = 2;
    let i = m.index! + m[0].length;
    const start = i;
    while (i < code.length && depth > 0) {
      if (code[i] === "{") depth++;
      else if (code[i] === "}") depth--;
      i++;
    }
    const body = code.slice(start, i - 2);
    let d = 0;
    for (let j = 0; j < body.length; j++) {
      const c = body[j]!;
      if (c === "{" || c === "(" || c === "[") d++;
      else if (c === "}" || c === ")" || c === "]") d--;
      else if (d === 0 && /[A-Za-z_$"']/.test(c) && (j === 0 || /[\s,{]/.test(body[j - 1]!))) {
        const key = /^["']?([A-Za-z_$][\w$-]*)["']?\s*:/.exec(body.slice(j));
        if (key) {
          if (VISUAL_STYLE.test(key[1]!)) hits.push({ at: start + j, text: key[1]!, rule: "꾸밈 style" });
          j += key[0].length - 1;
        }
      }
    }
  }
  // 변수로 넘긴 style(style={s})은 칸을 볼 수 없어 실패로 본다. 자리는 style={{ left, top }}로 바로 쓴다
  if (jsx) for (const m of code.matchAll(/\bstyle=\{(?!\{)\s*([^}]*?)\s*\}/g)) hits.push({ at: m.index!, text: `style={${m[1]}}`, rule: "꾸밈 style" });
  // SVG·아이콘 색 속성(fill="…", stroke="…", color=…)
  if (jsx) for (const m of code.matchAll(/<[A-Za-z][\w.]*\b[^<>]*?\s(fill|stroke|stopColor|color)=/g)) {
    hits.push({ at: m.index! + m[0].lastIndexOf(m[1]!), text: m[1]!, rule: "꾸밈 style" });
  }
  // DOM: el.style.background = …, el.style.setProperty("color", …)
  for (const m of code.matchAll(/\.style\.(\w+)\s*=(?!=)/g)) if (VISUAL_STYLE.test(m[1]!)) hits.push({ at: m.index! + 7, text: m[1]!, rule: "꾸밈 style" });
  for (const m of code.matchAll(/\.style\.setProperty\(\s*["'`]([\w-]+)/g)) {
    const key = m[1]!.replace(/-(\w)/g, (_, c: string) => c.toUpperCase());
    if (VISUAL_STYLE.test(key)) hits.push({ at: m.index!, text: m[1]!, rule: "꾸밈 style" });
  }
  return hits.sort((a, b) => a.at - b.at).map((h) => ({ file, line: lineAt(src, h.at), text: h.text, rule: h.rule }));
}

const shown = (file: string) => relative(ROOT, file).replace(/\\/g, "/");
const isPart = (file: string) => /[\\/]ui[\\/]src[\\/]components[\\/]ui[\\/]/.test(file);

function walk(dir: string): string[] {
  if (statSync(dir).isFile()) return [dir];
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    if (e.isDirectory()) return e.name === "tests" || e.name === "node_modules" ? [] : walk(p);
    return /\.(ts|tsx)$/.test(e.name) && !/\.d\.ts$|\.test\.tsx?$/.test(e.name) ? [p] : [];
  });
}

/** 화면 코드: ui/src 아래 .ts·.tsx 중 ui/src/components/ui 밖. */
export function screenFiles(dir: string): string[] {
  return walk(dir).filter((f) => !isPart(f));
}

/** 21st.dev 부품 파일: ui/src/components/ui 아래 .ts·.tsx. */
export function partFiles(dir: string): string[] {
  return walk(dir).filter(isPart);
}

export function lintUiParts(dir: string): PartsProblem[] {
  return [
    ...partFiles(dir).flatMap((f) => headerProblems(shown(f), readFileSync(f, "utf8"))),
    ...screenFiles(dir).flatMap((f) => screenProblems(shown(f), readFileSync(f, "utf8"))),
  ];
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const problems = lintUiParts(PARTS_TARGET);
  for (const p of problems) console.log(`${p.file}:${p.line}  [${p.rule}] ${p.text}`);
  if (problems.some((p) => p.rule === "출처 줄" || p.rule === "바꾼 것 줄")) console.log(`  → ${HEADER_FIX}`);
  if (problems.some((p) => p.rule.startsWith("꾸밈"))) console.log(`  → ${PARTS_FIX}`);
  if (problems.length) console.log(`21st.dev 부품 검사 ${problems.length}곳`);
  process.exitCode = problems.length ? 1 : 0;
}
