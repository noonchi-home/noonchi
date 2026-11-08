// 날 색 검사: 대시보드·설정·폰(ui/src, 입구 HTML)과 폰 입구(ui/phone)·web/의 HTML·CSS·JS·TS·TSX에서 날 색 값을 찾는다.
// 날 색: #hex(%23hex), rgb()·hsl()·oklch() 같은 색 함수, CSS 이름 색(white·black…), Tailwind 팔레트(bg-red-500), 임의 색 값([#…]).
// 색은 src/design/tokens.json 하나에서 온다. 그 원본에서 만든 파일(TOKEN_OUTPUTS)만 날 값을 가진다.
// 사용: npm run lint (tests/lint-ui-color.test.ts도 같은 검사를 돌린다)

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { codeStrings } from "./lint-ui-copy.js";

export type ColorProblem = { file: string; line: number; text: string; rule: string };

const ROOT = fileURLToPath(new URL("../", import.meta.url));

/** npm run lint가 보는 곳: 대시보드·설정·폰 코드, 입구 HTML(대시보드·설정·폰), web/. */
export const COLOR_TARGETS = [
  fileURLToPath(new URL("../ui/src/", import.meta.url)),
  fileURLToPath(new URL("../ui/index.html", import.meta.url)),
  fileURLToPath(new URL("../ui/setup/index.html", import.meta.url)),
  fileURLToPath(new URL("../ui/phone/", import.meta.url)),
  fileURLToPath(new URL("../web/", import.meta.url)),
];

/** 토큰 원본(src/design/tokens.json)에서 npm run tokens가 만든 파일. 날 값은 여기에만 있다(src/design/tokens.ts는 검사 범위 밖). */
export const TOKEN_OUTPUTS = ["ui/src/tokens.css"];

export const COLOR_FIX =
  "날 색 대신 src/design/tokens.json의 토큰을 쓰세요. 대시보드·설정·폰 화면은 ui/src/tokens.css의 토큰 class(bg-surface·text-ink…), 트윈·SVG·캔버스 색은 src/design/tokens.ts예요.";
export const ACCENT_FIX = "accent(옛 파랑)는 없어요. 브랜드 색은 brand 토큰(bg-brand·text-brand·var(--brand))을 쓰세요.";

/** CSS 이름 색. transparent·currentColor·inherit는 색이 아니라서 뺀다. */
const NAMED = new Set(("aliceblue antiquewhite aqua aquamarine azure beige bisque black blanchedalmond blue blueviolet brown burlywood cadetblue chartreuse " +
  "chocolate coral cornflowerblue cornsilk crimson cyan darkblue darkcyan darkgoldenrod darkgray darkgreen darkgrey darkkhaki darkmagenta darkolivegreen " +
  "darkorange darkorchid darkred darksalmon darkseagreen darkslateblue darkslategray darkslategrey darkturquoise darkviolet deeppink deepskyblue dimgray " +
  "dimgrey dodgerblue firebrick floralwhite forestgreen fuchsia gainsboro ghostwhite gold goldenrod gray green greenyellow grey honeydew hotpink indianred " +
  "indigo ivory khaki lavender lavenderblush lawngreen lemonchiffon lightblue lightcoral lightcyan lightgoldenrodyellow lightgray lightgreen lightgrey " +
  "lightpink lightsalmon lightseagreen lightskyblue lightslategray lightslategrey lightsteelblue lightyellow lime limegreen linen magenta maroon " +
  "mediumaquamarine mediumblue mediumorchid mediumpurple mediumseagreen mediumslateblue mediumspringgreen mediumturquoise mediumvioletred midnightblue " +
  "mintcream mistyrose moccasin navajowhite navy oldlace olive olivedrab orange orangered orchid palegoldenrod palegreen paleturquoise palevioletred " +
  "papayawhip peachpuff peru pink plum powderblue purple rebeccapurple red rosybrown royalblue saddlebrown salmon sandybrown seagreen seashell sienna " +
  "silver skyblue slateblue slategray slategrey snow springgreen steelblue tan teal thistle tomato turquoise violet wheat white whitesmoke yellow yellowgreen").split(" "));

const HEX = /(?<![\w&])#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})(?![\w-])/g;
const PCT_HEX = /%23(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})(?![0-9a-fA-F])/g;
const COLOR_FN = /(?<![\w-])(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\(/gi;
const UTIL = "(?:bg|text|border(?:-[xytrblse])?|ring(?:-offset)?|inset-ring|outline|fill|stroke|decoration|divide|placeholder|caret|accent|shadow|inset-shadow|drop-shadow|from|via|to)";
const PALETTE = new RegExp(`^-?${UTIL}-(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|mauve|olive|mist|taupe)-(?:50|[1-9]00|950)(?:/.+)?$`);
const NAMED_UTIL = new RegExp(`^-?${UTIL}-([a-z]+)(?:/.+)?$`);
const ARBITRARY = /\[[^\]]*(?:#[0-9a-fA-F]{3,8}|(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch)\()/;
const ACCENT_UTIL = /^-?(?:bg|text|border(?:-[xytrblse])?|ring|fill|stroke|outline|decoration|shadow|from|via|to|divide|caret|placeholder)-accent(?:\/.+)?$/;
const ACCENT_VAR = /var\(--(?:color-)?accent\)/g;
/** 이 이름 뒤에 오는 글자는 색이다(캔버스·SVG 속성·style 칸). */
const COLOR_SLOT = /(?:fillStyle|strokeStyle|shadowColor|(?<![\w-])(?:fill|stroke|color|background(?:Color)?|border(?:Color)?|outline(?:Color)?|stopColor|floodColor|caretColor|accentColor|textDecorationColor))\s*[:=]\s*\{?\s*$/;
const CSS_DECL_NAMED = /(?<![\w-])(?:color|background(?:-color)?|border(?:-color)?|fill|stroke|outline(?:-color)?)\s*:\s*[^;"'`]*?(?<![\w-])([a-zA-Z]+)(?![\w-(])/g;

const lineAt = (src: string, index: number) => src.slice(0, index).split("\n").length;
const blank = (m: string) => m.replace(/[^\n]/g, " ");

type Hit = { at: number; text: string; rule: string };

/** class 한 낱말에서 변형(hover:·max-sm:·data-[…]:)과 !를 뗀 몸. */
function baseOf(token: string): string {
  let depth = 0;
  let cut = 0;
  for (let i = 0; i < token.length; i++) {
    const c = token[i];
    if (c === "[" || c === "(") depth++;
    else if (c === "]" || c === ")") depth--;
    else if (c === ":" && depth === 0) cut = i + 1;
  }
  return token.slice(cut).replace(/^!|!$/g, "");
}

/** 글 한 덩어리(문자열·속성 값)의 날 색. at은 src 안 자리. */
function stringHits(text: string, at: number, ui: boolean): Hit[] {
  const out: Hit[] = [];
  const marked: [number, number][] = [];
  for (const m of text.matchAll(/\S+/g)) {
    const token = m[0];
    const base = baseOf(token);
    const rule = ARBITRARY.test(base) ? "임의 색 값"
      : PALETTE.test(base) ? "Tailwind 팔레트"
        : NAMED.has(NAMED_UTIL.exec(base)?.[1] ?? "") ? "이름 색"
          : !ui && ACCENT_UTIL.test(base) ? "accent" : null;
    if (rule) {
      out.push({ at: at + m.index!, text: token, rule });
      marked.push([m.index!, m.index! + token.length]);
    }
  }
  const free = (i: number) => !marked.some(([a, b]) => i >= a && i < b);
  for (const [re, rule] of [[HEX, "#hex"], [PCT_HEX, "#hex"], [COLOR_FN, "색 함수"]] as const) {
    for (const m of text.matchAll(re)) if (free(m.index!)) out.push({ at: at + m.index!, text: m[0], rule });
  }
  if (!ui) for (const m of text.matchAll(ACCENT_VAR)) if (free(m.index!)) out.push({ at: at + m.index!, text: m[0], rule: "accent" });
  for (const m of text.matchAll(CSS_DECL_NAMED)) {
    if (NAMED.has(m[1]!.toLowerCase())) out.push({ at: at + m.index! + m[0].lastIndexOf(m[1]!), text: m[1]!, rule: "이름 색" });
  }
  return out;
}

/** CSS: 선언 값만 본다(선택자·@media 조건은 보지 않는다). */
function cssHits(css: string, base: number, ui: boolean): Hit[] {
  const code = css.replace(/\/\*[\s\S]*?\*\//g, blank);
  const out: Hit[] = [];
  for (const m of code.matchAll(/([-\w]+)\s*:\s*([^;{}]+)(?=[;}])/g)) {
    const value = m[2]!;
    const at = base + m.index! + m[0].length - value.length;
    for (const [re, rule] of [[HEX, "#hex"], [COLOR_FN, "색 함수"]] as const) {
      for (const h of value.matchAll(re)) out.push({ at: at + h.index!, text: h[0], rule });
    }
    for (const w of value.matchAll(/(?<![\w-])([a-zA-Z]+)(?![\w(-])/g)) {
      if (NAMED.has(w[1]!.toLowerCase())) out.push({ at: at + w.index!, text: w[1]!, rule: "이름 색" });
    }
    if (!ui) for (const h of value.matchAll(ACCENT_VAR)) out.push({ at: at + h.index!, text: h[0], rule: "accent" });
  }
  return out;
}

/** JS·TS·TSX: 문자열·템플릿·JSX 속성 글만 본다(주석·코드 이름은 보지 않는다). 이름 색은 색 자리(fillStyle =, fill=, color:)의 글만. */
function codeHits(src: string, jsx: boolean, ui: boolean): Hit[] {
  const out: Hit[] = [];
  for (const s of codeStrings(src, jsx)) {
    const at = s.start + 1; // 따옴표 다음
    out.push(...stringHits(s.text, at, ui));
    const word = s.text.trim().toLowerCase();
    if (NAMED.has(word) && COLOR_SLOT.test(src.slice(Math.max(0, s.start - 40), s.start))) out.push({ at, text: s.text.trim(), rule: "이름 색" });
  }
  return out;
}

/** HTML: <style>은 CSS로, <script>는 JS로, 나머지 속성 값(파비콘 data URI·style="…")에서 날 색을 찾는다. */
function htmlHits(src: string, ui: boolean): Hit[] {
  const code = src.replace(/<!--[\s\S]*?-->/g, blank);
  const out: Hit[] = [];
  for (const m of code.matchAll(/(<style\b[^>]*>)([\s\S]*?)<\/style>/gi)) out.push(...cssHits(m[2]!, m.index! + m[1]!.length, ui));
  for (const m of code.matchAll(/(<script\b[^>]*>)([\s\S]*?)<\/script>/gi)) {
    out.push(...codeHits(m[2]!, false, ui).map((h) => ({ ...h, at: h.at + m.index! + m[1]!.length })));
  }
  const rest = code.replace(/<(style|script)\b[\s\S]*?<\/\1>/gi, blank);
  for (const m of rest.matchAll(/\sstyle="([^"]*)"/g)) out.push(...cssHits(`{${m[1]}}`, m.index! + m[0].indexOf('"'), ui));
  for (const m of rest.matchAll(/=\s*"([^"]*)"/g)) {
    const at = m.index! + m[0].indexOf('"') + 1;
    for (const [re, rule] of [[HEX, "#hex"], [PCT_HEX, "#hex"]] as const) for (const h of m[1]!.matchAll(re)) out.push({ at: at + h.index!, text: h[0], rule });
  }
  for (const m of rest.matchAll(/\s(?:fill|stroke|color|bgcolor)="([a-zA-Z]+)"/g)) {
    if (NAMED.has(m[1]!.toLowerCase())) out.push({ at: m.index! + m[0].indexOf('"') + 1, text: m[1]!, rule: "이름 색" });
  }
  return out;
}

/** 파일 하나의 날 색. file은 저장소 기준 경로(ui/src/…, ui/phone/…). 토큰에서 만든 파일은 보지 않는다. */
export function fileColors(file: string, src: string): ColorProblem[] {
  const path = file.replace(/\\/g, "/");
  if (TOKEN_OUTPUTS.some((t) => path === t || path.endsWith(`/${t}`))) return [];
  const ui = /(^|\/)ui\/src\/components\/ui\//.test(path);
  const hits = path.endsWith(".html") ? htmlHits(src, ui)
    : path.endsWith(".css") ? cssHits(src, 0, ui)
      : codeHits(src, path.endsWith(".tsx") || path.endsWith(".jsx"), ui);
  const seen = new Set<string>();
  return hits
    .sort((a, b) => a.at - b.at)
    .filter((h) => { const k = `${h.at}:${h.text}`; if (seen.has(k)) return false; seen.add(k); return true; })
    .map((h) => ({ file: path, line: lineAt(src, h.at), text: h.text, rule: h.rule }));
}

const shown = (file: string) => relative(ROOT, file).replace(/\\/g, "/");

/** 볼 파일: .html·.css·.js·.ts·.tsx. 타입 선언·시험·node_modules와 토큰에서 만든 파일은 뺀다. 파일을 주면 그 파일 하나. */
function walk(dir: string): string[] {
  if (statSync(dir).isFile()) return [dir];
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    if (e.isDirectory()) return e.name === "tests" || e.name === "node_modules" ? [] : walk(p);
    if (!/\.(html|css|js|ts|tsx)$/.test(e.name) || /\.d\.ts$|\.test\.[jt]sx?$/.test(e.name)) return [];
    return TOKEN_OUTPUTS.includes(shown(p)) ? [] : [p];
  });
}

export function colorFiles(targets: string[]): string[] {
  return targets.flatMap(walk);
}

export function lintUiColor(targets: string[]): ColorProblem[] {
  return colorFiles(targets).flatMap((file) => fileColors(shown(file), readFileSync(file, "utf8")));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const problems = lintUiColor(COLOR_TARGETS);
  for (const p of problems) console.log(`${p.file}:${p.line}  [${p.rule}] ${p.text}`);
  if (problems.some((p) => p.rule !== "accent")) console.log(`  → ${COLOR_FIX}`);
  if (problems.some((p) => p.rule === "accent")) console.log(`  → ${ACCENT_FIX}`);
  if (problems.length) console.log(`날 색 ${problems.length}곳`);
  process.exitCode = problems.length ? 1 : 0;
}
