// 화면 글 검사: web/·ui/src·폰 입구(ui/phone) 아래 HTML·JS·TS·TSX, 서버가 화면에 그대로 내보내는 계획 글(src/act/labels.ts)·World State 글(src/world/labels.ts·낱말 표 src/world/vocab.ts)·가전 종류 등록부 글(src/devices/kinds.ts)·기록 글(src/brain/history/labels.ts)·폰 부탁 글(src/act/prompts.ts)에서
// 사용자에게 보이는 한국어 글을 꺼내, 생각 과정·구현 설명이 들어갔는지 본다.
// 사용: npm run lint (tests/lint-ui-copy.test.ts도 같은 검사를 돌린다)

import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { COPY_RULES, copyRules as planCopyRules } from "../src/shared/copy.js";

export type Copy = { text: string; line: number; start?: number };
export type Problem = { file: string; line: number; text: string; rule: string };

const HANGUL = /[가-힣ㄱ-ㅎ]/;
const lineAt = (src: string, index: number) => src.slice(0, index).split("\n").length;

/** HTML: 주석·script·style을 빼고, 글자 꾸밈 태그는 풀어서 문단 단위로 꺼낸다. title·placeholder·aria-label·alt도 본다. */
export function htmlCopy(src: string): Copy[] {
  const blank = (m: string) => m.replace(/[^\n]/g, " ");
  const code = src.replace(/<!--[\s\S]*?-->/g, blank).replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, blank);
  const out: Copy[] = [];
  for (const m of code.matchAll(/\s(?:title|placeholder|aria-label|alt)="([^"]*)"/g)) {
    out.push({ text: m[1]!, line: lineAt(code, m.index!) });
  }
  const clean = code.replace(/<\/?(b|i|em|strong|span|a|code|kbd|small|mark|u|s)\b[^>]*>/gi, blank);
  for (const m of clean.matchAll(/>([^<]+)/g)) {
    const text = m[1]!.replace(/\s+/g, " ").trim();
    if (text) out.push({ text, line: lineAt(clean, m.index! + m[0].indexOf(m[1]!.trimStart()[0] ?? "")) });
  }
  return out.filter((c) => HANGUL.test(c.text));
}

const REGEX_BEFORE = /[(,=:[!&|?{};+\-*%<>~^]$|^$|\b(return|typeof|case|in|of)$/;
/** 이 뒤에 오는 `<`는 JSX 시작이다(식이 올 자리). 이름·`)`·`]` 뒤의 `<`는 비교나 TS 제네릭이다. */
const JSX_BEFORE = /[(,=:[!&|?{};]$|^$|=>$|\b(return|default|yield|await|else|do)$/;
/** 글자 꾸밈 태그: 한 문단 안에 있다고 보고 풀어서 이어 붙인다(htmlCopy와 같은 목록). */
const INLINE_TAG = /^(b|i|em|strong|span|a|code|kbd|small|mark|u|s)$/;
const ENTITY: Record<string, string> = { rarr: "→", rArr: "⇒", larr: "←", gt: ">", lt: "<", amp: "&", nbsp: " ", quot: '"', apos: "'", middot: "·" };
const decodeEntities = (t: string) =>
  t.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e: string) =>
    e[0] === "#" ? String.fromCodePoint(e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : Number(e.slice(1))) : ENTITY[e] ?? m);

/**
 * JS·TS(·TSX) 글 꺼내기. 주석·정규식은 건너뛰고 문자열·템플릿 글을 꺼낸다(템플릿의 ${…}는 「…」로).
 * console.* 안의 글은 화면 글이 아니라서 뺀다. jsx면 JSX 글과 속성 글도 꺼낸다.
 */
function codeCopy(src: string, jsx: boolean, all = false): Copy[] {
  const out: Copy[] = [];
  let i = 0;
  let code = ""; // 지금까지 본 코드(정규식·JSX·console 판단용). 문자열·정규식·JSX 덩어리는 「0」 하나로 둔다
  const push = (text: string, start: number) => {
    if (all) { out.push({ text, line: lineAt(src, start), start }); return; }
    if (!HANGUL.test(text)) return;
    if (/console\.\w+\([^;]*$/.test(code.slice(-300))) return;
    out.push({ text: text.replace(/\s+/g, " ").trim(), line: lineAt(src, start) });
  };

  /** 따옴표 문자열·템플릿을 읽어 글을 돌려준다. 템플릿 ${…} 안은 코드로 읽는다(그 안 문자열은 따로 꺼낸다). */
  const readString = (quote: string): string => {
    let s = "";
    i++;
    while (i < src.length && src[i] !== quote) {
      if (src[i] === "\\") { s += src[i + 1] ?? ""; i += 2; continue; }
      if (quote === "`" && src[i] === "$" && src[i + 1] === "{") {
        i += 2;
        code += "{";
        scan(true);
        code += "}";
        s += "…";
        continue;
      }
      s += src[i];
      i++;
    }
    i++;
    return s;
  };

  const skipComment = (): boolean => {
    if (src[i] === "/" && src[i + 1] === "/") { const e = src.indexOf("\n", i); i = e < 0 ? src.length : e; return true; }
    if (src[i] === "/" && src[i + 1] === "*") { const e = src.indexOf("*/", i + 2); i = e < 0 ? src.length : e + 2; return true; }
    return false;
  };

  /** 코드를 읽는다. untilBrace면 짝이 안 맞는 `}`에서 멈추고 그 `}`를 넘긴다. */
  const scan = (untilBrace: boolean) => {
    let depth = 0;
    while (i < src.length) {
      const c = src[i]!;
      if (skipComment()) continue;
      if (c === "'" || c === '"' || c === "`") { const start = i; push(readString(c), start); code += "0"; continue; }
      if (c === "/" && REGEX_BEFORE.test(code.trimEnd())) {
        i++;
        let cls = false;
        while (i < src.length && (cls || src[i] !== "/")) {
          if (src[i] === "\\") i++;
          else if (src[i] === "[") cls = true;
          else if (src[i] === "]") cls = false;
          i++;
        }
        i++;
        while (/[a-z]/i.test(src[i] ?? "")) i++;
        code += "0";
        continue;
      }
      if (jsx && c === "<" && JSX_BEFORE.test(code.trimEnd()) && isJsxStart()) { readElement(null); code += "0"; continue; }
      if (untilBrace) {
        if (c === "{") depth++;
        else if (c === "}" && depth-- === 0) { i++; return; }
      }
      code += c;
      i++;
    }
  };

  /** `<T,>`·`<T extends …>`(TSX 제네릭 화살표 함수)는 JSX가 아니다. */
  const isJsxStart = () => {
    const m = /^<(>|[A-Za-z_$][\w$.:-]*)(\s*,|\s+extends\b)?/.exec(src.slice(i, i + 80));
    return !!m && !m[2];
  };

  type Chunk = { text: string; start: number };
  const add = (acc: Chunk, text: string, at: number) => {
    if (acc.start < 0 && text.trim()) acc.start = at;
    acc.text += text;
  };
  const flush = (acc: Chunk) => {
    if (all) { acc.text = ""; acc.start = -1; return; }
    const text = decodeEntities(acc.text).replace(/\s+/g, " ").trim();
    if (HANGUL.test(text)) out.push({ text, line: lineAt(src, acc.start) });
    acc.text = "";
    acc.start = -1;
  };

  /** `{…}` 식. 글자 덩어리 안이면 식 자리를 「…」로 두고, 문자열 하나뿐인 식은 그 글을 그대로 이어 붙인다. */
  const readExpression = (acc: Chunk | null) => {
    const open = i;
    i++;
    code += "{";
    const rest = src.slice(i);
    const onlyComments = /^(\s|\/\*[\s\S]*?\*\/|\/\/[^\n]*\n)*\}/.exec(rest);
    if (onlyComments) { i += onlyComments[0].length; code += "}"; return; }
    const lead = /^\s*/.exec(rest)![0].length;
    const q = src[i + lead];
    if (q === "'" || q === '"' || q === "`") {
      i += lead;
      const start = i;
      const s = readString(q);
      const tail = /^\s*\}/.exec(src.slice(i));
      if (tail && acc) { add(acc, s, start); i += tail[0].length; code += "0}"; return; }
      push(s, start);
      code += "0";
    }
    if (acc) add(acc, "…", open);
    scan(true);
    code += "}";
  };

  /** `<`에서 시작하는 JSX 요소 하나를 읽는다. acc가 있으면(꾸밈 태그) 부모 글 덩어리에 이어 붙인다. */
  const readElement = (parent: Chunk | null) => {
    const acc: Chunk = parent ?? { text: "", start: -1 };
    i++; // <
    const name = /^[\w$.:-]*/.exec(src.slice(i))![0];
    i += name.length;
    // 속성
    while (i < src.length) {
      const c = src[i]!;
      if (/\s/.test(c)) { i++; continue; }
      if (skipComment()) continue;
      if (c === "/" && src[i + 1] === ">") { i += 2; return; }
      if (c === ">") { i++; break; }
      if (c === "{") { readExpression(null); continue; }
      const attr = /^[\w$:.-]+/.exec(src.slice(i));
      if (!attr) { i++; continue; }
      i += attr[0].length;
      const eq = /^\s*=\s*/.exec(src.slice(i));
      if (!eq) continue;
      i += eq[0].length;
      const v = src[i];
      if (v === '"' || v === "'") {
        const end = src.indexOf(v, i + 1);
        const stop = end < 0 ? src.length : end;
        push(src.slice(i + 1, stop), i);
        i = stop + 1;
      } else if (v === "{") readExpression(null);
      else if (v === "<") readElement(null);
    }
    // 자식
    while (i < src.length) {
      const c = src[i]!;
      if (c === "<" && src[i + 1] === "/") {
        const end = src.indexOf(">", i);
        i = end < 0 ? src.length : end + 1;
        if (!parent) flush(acc);
        return;
      }
      if (c === "<") {
        const child = /^<([\w$.:-]*)/.exec(src.slice(i))![1]!;
        if (INLINE_TAG.test(child)) readElement(acc);
        else { flush(acc); readElement(null); }
        continue;
      }
      if (c === "{") { readExpression(acc); continue; }
      add(acc, c, i);
      i++;
    }
    if (!parent) flush(acc);
  };

  scan(false);
  return out.sort((a, b) => a.line - b.line);
}

/** JS: 주석·정규식은 건너뛰고 문자열·템플릿 글을 꺼낸다(템플릿의 ${…}는 「…」로). console.* 안의 글은 화면 글이 아니라서 뺀다. */
export function jsCopy(src: string): Copy[] {
  return codeCopy(src, false);
}

/** 문자열·템플릿·JSX 속성 글을 모두 꺼낸다(한국어가 아니어도, JSX 글은 빼고). start는 src 안 글이 시작하는 자리다. 꾸밈 검사(lint-ui-color·lint-ui-parts)가 쓴다. */
export function codeStrings(src: string, jsx: boolean): (Copy & { start: number })[] {
  return codeCopy(src, jsx, true) as (Copy & { start: number })[];
}

/** TSX: jsCopy에 더해 JSX 글(`>`와 `<` 사이, {식}은 「…」, 꾸밈 태그는 풀어서 한 덩어리)과 속성 글(title·placeholder·aria-label·alt 등)을 꺼낸다. */
export function tsxCopy(src: string): Copy[] {
  return codeCopy(src, true);
}

// 화면 글 규칙(생각 과정·구현 설명 표시)은 서버가 에이전트 계획 글을 검사할 때도 쓰므로 src/shared/copy.ts에 둔다.
export { MAX_COPY } from "../src/shared/copy.js";

/** 설명 칸: 제목·버튼·상태 말고 덧붙이는 설명 문단을 담는 자리. */
const BLURB_CLASS = /\bclass(?:Name)?\s*[=:]\s*["'`][^"'`]*?(?<![\w-])(sub|note|help|hint|desc|touch-help)(?![\w-])/g;
const BLURB_FIX = "설명 칸(.sub·.note·.help 같은 덧붙임 문단)을 만들지 마세요. 제목·버튼·상태 글로 충분해요.";

/** 화면 글 한 덩어리 검사. 걸린 규칙 이름(없으면 빈 배열). */
export function copyRules(text: string): string[] {
  return planCopyRules(text);
}

export function ruleFix(name: string): string {
  return name === "설명 칸" ? BLURB_FIX : COPY_RULES.find((r) => r.name === name)?.fix ?? "";
}

/** 설명 칸 클래스를 쓰는 줄. 주석 속은 보지 않는다. */
export function blurbSlots(src: string): Copy[] {
  const code = src.replace(/<!--[\s\S]*?-->|\/\*[\s\S]*?\*\/|(^|[^:])\/\/.*$/gm, (m) => m.replace(/[^\n]/g, " "));
  return [...code.matchAll(BLURB_CLASS)].map((m) => ({ text: m[1]!, line: lineAt(code, m.index!) }));
}

/** 화면 글을 볼 파일: .html·.js·.ts·.tsx. 타입 선언(.d.ts)·시험(tests/, *.test.*)·node_modules는 뺀다. 파일을 주면 그 파일 하나. */
function walk(dir: string): string[] {
  if (statSync(dir).isFile()) return [dir];
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    if (e.isDirectory()) return e.name === "tests" || e.name === "node_modules" ? [] : walk(p);
    return /\.(html|js|ts|tsx)$/.test(e.name) && !/\.d\.ts$|\.test\.[jt]sx?$/.test(e.name) ? [p] : [];
  });
}

export function copyFiles(dirs: string[]): string[] {
  return dirs.flatMap(walk);
}

export function fileCopy(file: string, src: string): Copy[] {
  if (file.endsWith(".html")) return htmlCopy(src);
  if (file.endsWith(".tsx")) return tsxCopy(src);
  return jsCopy(src);
}

const ROOT = fileURLToPath(new URL("../", import.meta.url));
/** npm run lint가 보는 곳: 폰 화면, 대시보드·설정 화면, 서버가 만들어 화면에 그대로 내보내는 계획 글·World State 글·기록 글·폰 부탁 글. */
export const COPY_TARGETS = [
  fileURLToPath(new URL("../web/", import.meta.url)),
  fileURLToPath(new URL("../ui/src/", import.meta.url)),
  fileURLToPath(new URL("../ui/phone/", import.meta.url)),
  fileURLToPath(new URL("../src/act/labels.ts", import.meta.url)),
  fileURLToPath(new URL("../src/world/labels.ts", import.meta.url)),
  fileURLToPath(new URL("../src/world/vocab.ts", import.meta.url)),
  // 가전 종류 등록부: 종류 이름·종류별 상태 글·안전 문구가 화면에 그대로 나간다
  fileURLToPath(new URL("../src/devices/kinds.ts", import.meta.url)),
  fileURLToPath(new URL("../src/brain/history/labels.ts", import.meta.url)),
  fileURLToPath(new URL("../src/act/prompts.ts", import.meta.url)),
  // Android 앱 리모컨 등록 글
  fileURLToPath(new URL("../apps/android/ir-remotes.ts", import.meta.url)),
  fileURLToPath(new URL("../apps/android/ConnectedRemotes.tsx", import.meta.url)),
];
/** 보고에 쓸 경로: 저장소 안이면 저장소 기준(ui/src/phone/PhoneScreen.tsx, ui/src/…), 밖이면 검사한 폴더 이름부터. */
const shown = (dir: string, file: string) => {
  const r = relative(ROOT, file);
  return (r.startsWith("..") ? relative(dirname(dir.replace(/[\\/]+$/, "")), file) : r).replace(/\\/g, "/");
};

/** 화면 글 검사 예외: 사용자가 승인한 글만. file은 저장소 기준 경로, text는 꺼낸 글 그대로(템플릿 ${…}는 「…」). until이 지나면 「예외 기한 지남」 문제다. */
export const COPY_EXCEPTIONS: readonly { file: string; text: string; why: string; until: string }[] = [
  { file: "ui/src/dashboard/reflection-words.ts", text: "…% (…% 이상) · 우연일 확률 … (… 미만) · …", why: "밤 반성 채택 검사 글: 따라온 비율·우연일 확률의 기준을 괄호로 보인다(사용자 결정 2026-11-27)", until: "2027-02-28" },
];

export function lintUiCopy(dirs: string[], today = new Date().toISOString().slice(0, 10)): Problem[] {
  const problems: Problem[] = [];
  const live = COPY_EXCEPTIONS.filter((x) => x.until >= today);
  const excused = (file: string, text: string) => live.some((x) => x.file === file && x.text === text);
  for (const dir of dirs) {
    for (const file of walk(dir)) {
      const src = readFileSync(file, "utf8");
      const name = shown(dir, file);
      for (const c of fileCopy(file, src)) {
        if (excused(name, c.text)) continue;
        for (const rule of copyRules(c.text)) problems.push({ file: name, line: c.line, text: c.text, rule });
      }
      for (const s of blurbSlots(src)) problems.push({ file: name, line: s.line, text: `.${s.text}`, rule: "설명 칸" });
    }
  }
  for (const x of COPY_EXCEPTIONS) if (x.until < today) problems.push({ file: x.file, line: 0, text: x.text, rule: "예외 기한 지남" });
  return problems.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const dirs = COPY_TARGETS;
  if (process.argv.includes("--dump")) {
    for (const dir of dirs) {
      for (const file of walk(dir)) {
        for (const c of fileCopy(file, readFileSync(file, "utf8"))) console.log(`${shown(dir, file)}:${c.line}\t${c.text.length}\t${c.text}`);
      }
    }
  } else {
    const problems = lintUiCopy(dirs);
    for (const p of problems) console.log(`${p.file}:${p.line}  [${p.rule}] ${p.text.slice(0, 80)}`);
    for (const rule of new Set(problems.map((p) => p.rule))) console.log(`  → ${rule}: ${ruleFix(rule)}`);
    process.exitCode = problems.length ? 1 : 0;
  }
}
