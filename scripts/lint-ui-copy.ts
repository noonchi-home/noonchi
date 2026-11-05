// 화면 글 검사: web/ 아래 HTML·JS에서 사용자에게 보이는 한국어 글을 꺼내, 생각 과정·구현 설명이 들어갔는지 본다.
// 사용: npm run lint (tests/lint-ui-copy.test.ts도 같은 검사를 돌린다)

import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

export type Copy = { text: string; line: number };
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

/** JS: 주석·정규식은 건너뛰고 문자열·템플릿 글을 꺼낸다(템플릿의 ${…}는 「…」로). console.* 안의 글은 화면 글이 아니라서 뺀다. */
export function jsCopy(src: string): Copy[] {
  const out: Copy[] = [];
  let i = 0;
  let code = ""; // 지금까지 본 코드(정규식 판단·console 판단용)
  const readString = (quote: string): string => {
    let s = "";
    i++;
    while (i < src.length && src[i] !== quote) {
      if (src[i] === "\\") { s += src[i + 1] ?? ""; i += 2; continue; }
      if (quote === "`" && src[i] === "$" && src[i + 1] === "{") {
        i += 2;
        let depth = 1;
        while (i < src.length && depth > 0) {
          if (src[i] === "{") depth++;
          else if (src[i] === "}") depth--;
          else if (src[i] === "'" || src[i] === '"' || src[i] === "`") { const q = src[i]!; const start = i; const inner = readString(q); push(inner, start); continue; }
          if (depth > 0) i++;
        }
        i++;
        s += "…";
        continue;
      }
      s += src[i];
      i++;
    }
    i++;
    return s;
  };
  const push = (text: string, start: number) => {
    if (!HANGUL.test(text)) return;
    if (/console\.\w+\([^;]*$/.test(code.slice(-300))) return;
    out.push({ text: text.replace(/\s+/g, " ").trim(), line: lineAt(src, start) });
  };
  while (i < src.length) {
    const c = src[i]!;
    if (c === "/" && src[i + 1] === "/") { const e = src.indexOf("\n", i); i = e < 0 ? src.length : e; continue; }
    if (c === "/" && src[i + 1] === "*") { const e = src.indexOf("*/", i + 2); i = e < 0 ? src.length : e + 2; continue; }
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
    code += c;
    i++;
  }
  return out;
}

export const MAX_COPY = 60;

// 화면 글은 사용자가 할 일과 지금 상태만. 아래는 생각 과정·구현 설명이 들어갔다는 표시다. 오류 글에 고치는 법을 적는다.
const RULES: { name: string; hit: (text: string) => boolean; fix: string }[] = [
  { name: "흐름 나열", hit: (t) => /→|⇒|->|=>/.test(t), fix: "화살표로 단계·흐름을 늘어놓지 마세요. 단계는 단계 표시(#steps) 하나로 보여요." },
  // 「(으)로」 같은 조사 겹쳐 쓰기는 설명이 아니다
  { name: "괄호 설명", hit: (t) => [...t.matchAll(/\(([^)]*)\)/g)].some((m) => /[가-힣a-z]/i.test(m[1]!) && !/^(으|이|은|는|을|를|과|와|가|아|야)$/.test(m[1]!)), fix: "괄호로 덧붙인 설명을 빼세요. 꼭 필요한 말이면 본문에 바로 쓰세요." },
  { name: "긴 설명", hit: (t) => t.replace(/<[^>]+>/g, "").length > MAX_COPY, fix: `한 덩어리는 ${MAX_COPY}자까지예요. 할 일·지금 상태만 남기고 이유·동작 원리는 docs/로 옮기세요.` },
  { name: "구현 이름", hit: (t) => /\b[A-Z][A-Z0-9]*_[A-Z0-9_]+\b|\b[\w-]+\.(json|ts|mjs|onnx)\b|twin-studio|SSOT|엔진/.test(t), fix: "환경변수·파일·저장소 이름, 엔진 같은 내부 말을 화면에 쓰지 마세요. 서버 로그나 README에 두세요." },
];

/** 설명 칸: 제목·버튼·상태 말고 덧붙이는 설명 문단을 담는 자리. */
const BLURB_CLASS = /\bclass(?:Name)?\s*[=:]\s*["'`][^"'`]*?(?<![\w-])(sub|note|help|hint|desc|touch-help)(?![\w-])/g;
const BLURB_FIX = "설명 칸(.sub·.note·.help 같은 덧붙임 문단)을 만들지 마세요. 제목·버튼·상태 글로 충분해요.";

/** 화면 글 한 덩어리 검사. 걸린 규칙 이름(없으면 빈 배열). */
export function copyRules(text: string): string[] {
  return RULES.filter((r) => r.hit(text)).map((r) => r.name);
}

export function ruleFix(name: string): string {
  return name === "설명 칸" ? BLURB_FIX : RULES.find((r) => r.name === name)?.fix ?? "";
}

/** 설명 칸 클래스를 쓰는 줄. 주석 속은 보지 않는다. */
export function blurbSlots(src: string): Copy[] {
  const code = src.replace(/<!--[\s\S]*?-->|\/\*[\s\S]*?\*\/|(^|[^:])\/\/.*$/gm, (m) => m.replace(/[^\n]/g, " "));
  return [...code.matchAll(BLURB_CLASS)].map((m) => ({ text: m[1]!, line: lineAt(code, m.index!) }));
}

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    if (e.isDirectory()) return walk(p);
    return /\.(html|js)$/.test(e.name) ? [p] : [];
  });
}

export function lintUiCopy(webDir: string): Problem[] {
  const problems: Problem[] = [];
  for (const file of walk(webDir)) {
    const src = readFileSync(file, "utf8");
    const copies = file.endsWith(".html") ? htmlCopy(src) : jsCopy(src);
    for (const c of copies) for (const rule of copyRules(c.text)) problems.push({ file: relative(webDir, file), line: c.line, text: c.text, rule });
    for (const s of blurbSlots(src)) problems.push({ file: relative(webDir, file), line: s.line, text: `.${s.text}`, rule: "설명 칸" });
  }
  return problems.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const webDir = fileURLToPath(new URL("../web/", import.meta.url));
  if (process.argv.includes("--dump")) {
    for (const file of walk(webDir)) {
      const src = readFileSync(file, "utf8");
      for (const c of file.endsWith(".html") ? htmlCopy(src) : jsCopy(src)) console.log(`${relative(webDir, file)}:${c.line}\t${c.text.length}\t${c.text}`);
    }
  } else {
    const problems = lintUiCopy(webDir);
    for (const p of problems) console.log(`web/${p.file.replace(/\\/g, "/")}:${p.line}  [${p.rule}] ${p.text.slice(0, 80)}`);
    for (const rule of new Set(problems.map((p) => p.rule))) console.log(`  → ${rule}: ${ruleFix(rule)}`);
    process.exitCode = problems.length ? 1 : 0;
  }
}
