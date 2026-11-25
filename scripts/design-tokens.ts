// 디자인 토큰 만들기: 원본 src/design/tokens.json 하나에서 화면마다 쓰는 파일을 만든다.
//   ui/src/tokens.css      대시보드·설정·폰(Tailwind @theme와 :root 변수, 화면 글 크기는 html[data-surface])
//   src/design/tokens.ts   트윈·SVG·캔버스(폰 조준점·초점 그림 포함)·3D 계획·3D 장면 색(TS 값)
//   ui/src/phone/core/font-faces.js  폰 인코딩 워커가 FontFace로 넣는 글꼴 조각 목록(꾸러미 CSS에서 만든다, 파일은 ui 빌드가 ?url로 묶는다)
//   ui/src/mobile/mokryeon-plan.svg  평면도 글자가 든 글꼴 조각(<style> 부분만 바꾼다)
// 같이 옮기는 것: 글꼴 라이선스를 ui/public/fonts/로.
// 원본의 {"ref": 이름}은 hex(또는 rgb(… / α))로, 값이 더 있는 {"ref": 이름, width, opacity}는 { color, width, opacity }로 푼다.
// 사용: npm run tokens (tests/design-tokens.test.ts가 만든 파일이 원본과 같은지 본다)

import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

type Json = string | number | boolean | null | Json[] | { [k: string]: Json };
type Obj = { [k: string]: Json };
type Surface = "phone" | "setup" | "hub1440" | "hub1920";

export interface Tokens {
  name: string;
  version: string;
  color: Record<string, { value: string; css: string }>;
  colorRgba: Record<string, { ref: string; alpha: number; css: string }>;
  alias: Record<string, { ref: string; css: string }>;
  shadow: Record<string, string>;
  radius: Record<string, number | string>;
  font: { sans: { family: string }; mono: { family: string }; canvas: string; weightFloor: number; weights: Record<string, number> };
  type: Record<string, { size: Record<Surface, number | null>; lineHeight: Record<Surface, number | null>; weight: number; tracking: string }>;
  motion: { duration: Record<string, number>; easing: Record<string, string> };
  overlayLine: Obj;
  twin: Obj;
  viz: Obj;
  scene3d: Obj;
}

export const SOURCE = "src/design/tokens.json";
export const OUTPUTS = ["ui/src/tokens.css", "src/design/tokens.ts"] as const;

const rgb = (hex: string, alpha: number) => {
  const n = parseInt(hex.slice(1), 16);
  return `rgb(${(n >> 16) & 255} ${(n >> 8) & 255} ${n & 255} / ${alpha})`;
};

/** 토큰 이름 → 값. color는 hex, colorRgba는 rgb(… / α), alias는 가리키는 토큰의 값. */
export function resolver(t: Tokens) {
  const value = (name: string): string => {
    if (t.color[name]) return t.color[name]!.value;
    const a = t.colorRgba[name];
    if (a) return rgb(value(a.ref), a.alpha);
    const al = t.alias[name];
    if (al) return value(al.ref);
    throw new Error(`${SOURCE}: 없는 토큰 ${name}`);
  };
  /** 객체 안 {"ref"}를 푼다. ref만 있으면 값 글, 다른 칸이 있으면 { color, …나머지 }. */
  const deep = (v: Json): Json => {
    if (Array.isArray(v)) return v.map(deep);
    if (v && typeof v === "object") {
      if (typeof v.ref === "string") {
        const { ref, css: _css, ...rest } = v;
        const c = value(ref as string);
        return Object.keys(rest).length ? { color: c, ...Object.fromEntries(Object.entries(rest).map(([k, x]) => [k, deep(x)])) } : c;
      }
      return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, deep(x)]));
    }
    return v;
  };
  return { value, deep };
}

const HEAD = (t: Tokens, line: string) => `${line} 만든 파일: ${SOURCE}(${t.name} ${t.version})에서 npm run tokens가 만든다. 고칠 때는 원본을 고치고 npm run tokens를 돌린다.`;
const px = (v: number | string) => (typeof v === "number" ? `${v}px` : v);
const cssName = (css: string) => css.replace(/^--/, "");

/** 그림자 틀: {shade/0.05} → rgb(… / 0.05), {line} → var(--line). */
function shadow(t: Tokens, value: (n: string) => string, tpl: string): string {
  return tpl.replace(/\{([\w-]+)(?:\/([\d.]+))?\}/g, (_, name: string, alpha?: string) => (alpha ? rgb(value(name), Number(alpha)) : `var(--${name})`));
}

function rootVars(t: Tokens, value: (n: string) => string): string[] {
  return [
    ...Object.values(t.color).map((c) => `  ${c.css}: ${c.value};`),
    ...Object.entries(t.colorRgba).map(([n, c]) => `  ${c.css}: ${value(n)};`),
    ...Object.values(t.alias).map((a) => `  ${a.css}: var(${t.color[a.ref]?.css ?? `--${a.ref}`});`),
    ...Object.entries(t.motion.duration).map(([k, v]) => `  --motion-duration-${k}: ${v}ms;`),
    ...Object.entries(t.motion.easing).map(([k, v]) => `  --motion-ease-${k}: ${v};`),
  ];
}

function typeVars(t: Tokens, s: Surface): string[] {
  return Object.entries(t.type).flatMap(([name, ty]) => {
    const size = ty.size[s];
    const lh = ty.lineHeight[s];
    return size == null || lh == null ? [] : [`  --type-${name}-size: ${size}px;`, `  --type-${name}-line: ${lh}px;`];
  });
}

function uiCss(t: Tokens, value: (n: string) => string): string {
  const names = [...Object.values(t.color).map((c) => c.css), ...Object.values(t.colorRgba).map((c) => c.css), ...Object.values(t.alias).map((c) => c.css)];
  return [
    HEAD(t, "/*") + " */",
    "@theme {",
    `  --font-sans: ${t.font.sans.family};`,
    `  --font-mono: ${t.font.mono.family};`,
    // Tailwind 기본 굵기 변수(thin~medium)도 덮어서 font-normal·font-medium 같은 class가 바닥 밑으로 내려가지 않게 한다
    ...Object.entries(t.font.weights).map(([k, v]) => `  --font-weight-${k}: ${v};`),
    ...Object.entries(t.radius).map(([k, v]) => `  --${k}: ${px(v)};`),
    ...Object.entries(t.shadow).map(([k, v]) => `  --${k}: ${shadow(t, value, v)};`),
    "}",
    "",
    "@theme inline {",
    ...names.map((css) => `  --color-${cssName(css)}: var(${css});`),
    ...Object.entries(t.type).flatMap(([name, ty]) => [
      `  --text-${name}: var(--type-${name}-size);`,
      `  --text-${name}--line-height: var(--type-${name}-line);`,
      `  --text-${name}--letter-spacing: ${ty.tracking === "0" ? "0em" : ty.tracking};`,
      `  --text-${name}--font-weight: ${ty.weight};`,
    ]),
    "}",
    "",
    ":root {",
    ...rootVars(t, value),
    ...typeVars(t, "setup"),
    "}",
    "",
    'html[data-surface="phone"] {',
    ...typeVars(t, "phone"),
    "}",
    "",
    'html[data-surface="hub"] {',
    ...typeVars(t, "hub1440"),
    "}",
    "",
    "@media (min-width: 1680px) {",
    '  html[data-surface="hub"] {',
    ...typeVars(t, "hub1920").map((l) => `  ${l}`),
    "  }",
    "}",
    "",
  ].join("\n");
}

/** 캔버스 글꼴: font.canvas 틀의 글꼴 이름 부분. */
const canvasFamily = (t: Tokens) => /\}px (.+?)`/.exec(t.font.canvas)?.[1] ?? t.font.sans.family;

const js = (v: unknown) => JSON.stringify(v, null, 2);

function designTs(t: Tokens, value: (n: string) => string, deep: (v: Json) => Json): string {
  const color = Object.fromEntries(Object.keys(t.color).map((n) => [n, value(n)]));
  const rgba = Object.fromEntries(Object.keys(t.colorRgba).map((n) => [n, value(n)]));
  const alias = Object.fromEntries(Object.keys(t.alias).map((n) => [n, value(n)]));
  return [
    HEAD(t, "//"),
    "// 트윈 위 표시·SVG·캔버스·3D 계획(VIZ)·3D 장면(scene3d) 색은 여기 값만 쓴다.",
    "",
    `export const color = ${js(color)} as const;`,
    "",
    `export const rgba = ${js(rgba)} as const;`,
    "",
    `export const alias = ${js(alias)} as const;`,
    "",
    `export const overlayLine = ${js(deep(t.overlayLine))} as const;`,
    "",
    `export const twin = ${js(deep(t.twin))} as const;`,
    "",
    `export const viz = ${js(deep(t.viz))} as const;`,
    "",
    `export const scene3d = ${js(deep(t.scene3d))} as const;`,
    "",
    `export const font = ${js({ sans: t.font.sans.family, mono: t.font.mono.family, canvas: canvasFamily(t), weights: t.font.weights })} as const;`,
    "",
    "export type ColorToken = keyof typeof color;",
    "",
  ].join("\n");
}

/** 굵기 바닥(font.weightFloor) 밑 굵기가 있으면 멈춘다. */
function checkWeights(t: Tokens): void {
  const low = [
    ...Object.entries(t.font.weights).map(([k, w]) => [`font.weights.${k}`, w] as const),
    ...Object.entries(t.type).map(([k, ty]) => [`type.${k}.weight`, ty.weight] as const),
  ].filter(([, w]) => w < t.font.weightFloor);
  if (low.length) throw new Error(`${SOURCE}: ${low.map(([k, w]) => `${k}=${w}`).join(", ")} 굵기는 ${t.font.weightFloor} 이상이어야 해요`);
}

/** 원본에서 만든 파일 둘: 저장소 기준 경로 → 내용. */
export function renderTokens(t: Tokens): Record<(typeof OUTPUTS)[number], string> {
  checkWeights(t);
  const { value, deep } = resolver(t);
  return {
    "ui/src/tokens.css": uiCss(t, value),
    "src/design/tokens.ts": designTs(t, value, deep),
  };
}

export const repoPath = (p: string) => fileURLToPath(new URL(`../${p}`, import.meta.url));
export const readTokens = (): Tokens => JSON.parse(readFileSync(repoPath(SOURCE), "utf8")) as Tokens;

const FONT_PKG = "ui/node_modules/pretendard";
/** 화면 입구가 import하는 동적 부분집합 CSS(꾸러미 안 경로). 조각 파일은 그 옆 woff2-dynamic-subset/에 있다. */
const FONT_DIR = "dist/web/variable";
const FONT_CSS = `${FONT_DIR}/pretendardvariable-dynamic-subset.css`;
export const FONT_FACES = "ui/src/phone/core/font-faces.js";

/** 그대로 옮기는 파일: 글꼴 라이선스. */
export function copies(): { from: string; to: string }[] {
  return [{ from: `${FONT_PKG}/dist/LICENSE.txt`, to: "ui/public/fonts/OFL-pretendard.txt" }];
}

/** 꾸러미 CSS의 @font-face(파일·unicode-range·굵기 범위)를 워커용 ESM 목록으로. 파일은 ?url import라 ui 빌드가 묶은 주소가 들어간다. */
export function renderFontFaces(): string {
  const css = readFileSync(repoPath(`${FONT_PKG}/${FONT_CSS}`), "utf8");
  const faces = [...css.matchAll(/@font-face\s*\{([^}]*)\}/g)].map((m) => ({
    file: /url\(\.\/woff2-dynamic-subset\/([^)]+)\)/.exec(m[1]!)![1]!,
    unicodeRange: /unicode-range:\s*([^;]+);/.exec(m[1]!)![1]!.trim(),
  }));
  const family = /font-family:\s*'([^']+)'/.exec(css)![1]!;
  const weight = /font-weight:\s*([^;]+);/.exec(css)![1]!.trim();
  return [
    "// 만든 파일: npm run tokens가 pretendard 꾸러미 동적 부분집합 CSS에서 만든다. 손으로 고치지 않는다.",
    "// 인코딩 워커(encoder-worker.js)가 이 목록으로 FontFace를 넣는다. 글꼴 파일은 ui 빌드가 묶는다(?url).",
    "",
    ...faces.map((f, i) => `import f${i} from "pretendard/${FONT_DIR}/woff2-dynamic-subset/${f.file}?url";`),
    "",
    `export const family = ${JSON.stringify(family)};`,
    "",
    `export const weight = ${JSON.stringify(weight)};`,
    "",
    `export const faces = [\n${faces.map((f, i) => `  { url: f${i}, unicodeRange: ${JSON.stringify(f.unicodeRange)} },`).join("\n")}\n];`,
    "",
  ].join("\n");
}

export const PLAN_SVG = "ui/src/mobile/mokryeon-plan.svg";
const PLAN_FONT_DIR = "dist/web/static";
const PLAN_NOTE = "  <!-- npm run tokens가 넣는다: <img> 안 SVG는 페이지 글꼴을 못 써서 이 글자가 든 Pretendard SemiBold 조각(pretendard 1.3.9, OFL 1.1)을 품는다 -->";

/** unicode-range 글("U+20, U+ac00-ac0f")에 코드 포인트가 드는가. */
function inRange(range: string, cp: number): boolean {
  return range.split(",").some((part) => {
    const [a, b = a] = part.trim().replace(/^U\+/i, "").split("-").map((h) => parseInt(h!, 16));
    return cp >= a! && cp <= b!;
  });
}

/** 평면도 SVG의 <text> 글자가 든 꾸러미 정적 SemiBold 조각을 바꾸지 않고 data URI @font-face로 넣는다. */
export function renderPlanFont(svg: string): string {
  const cps = [...new Set([...svg.matchAll(/<text\b[^>]*>([^<]*)<\/text>/g)].flatMap((m) => [...m[1]!]))].map((c) => c.codePointAt(0)!);
  const css = readFileSync(repoPath(`${FONT_PKG}/${PLAN_FONT_DIR}/pretendard-dynamic-subset.css`), "utf8");
  const rules = [...css.matchAll(/@font-face\s*\{([^}]*)\}/g)]
    .map((m) => m[1]!)
    .filter((b) => /font-weight:\s*600;/.test(b))
    .map((b) => ({ file: /url\(\.\/(woff2-dynamic-subset\/[^)]+\.woff2)\)/.exec(b)![1]!, range: /unicode-range:\s*([^;]+);/.exec(b)![1]!.trim() }))
    .filter((f) => cps.some((cp) => inRange(f.range, cp)))
    .map((f) => {
      const data = readFileSync(repoPath(`${FONT_PKG}/${PLAN_FONT_DIR}/${f.file}`)).toString("base64");
      return `    @font-face{font-family:Pretendard;font-weight:600;src:url(data:font/woff2;base64,${data}) format("woff2");unicode-range:${f.range}}`;
    });
  const block = `${PLAN_NOTE}\n  <style>\n${rules.join("\n")}\n  </style>\n`;
  const old = /  <!-- npm run tokens가 넣는다[^\n]*-->\n  <style>[\s\S]*?<\/style>\n/;
  return old.test(svg) ? svg.replace(old, () => block) : svg.replace(/(<svg\b[^>]*>\n)/, (tag) => tag + block);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const plan = readFileSync(repoPath(PLAN_SVG), "utf8").replace(/\r\n/g, "\n");
  for (const [p, body] of [...Object.entries(renderTokens(readTokens())), [FONT_FACES, renderFontFaces()] as const, [PLAN_SVG, renderPlanFont(plan)] as const]) {
    mkdirSync(dirname(repoPath(p)), { recursive: true });
    writeFileSync(repoPath(p), body, "utf8");
    console.log(`만듦 ${p}`);
  }
  const list = copies();
  for (const c of list) {
    mkdirSync(dirname(repoPath(c.to)), { recursive: true });
    copyFileSync(repoPath(c.from), repoPath(c.to));
  }
  console.log(`옮김 ${list.length}개(글꼴 라이선스)`);
}
