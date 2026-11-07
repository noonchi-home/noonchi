// 디자인 토큰 만들기: 원본 src/design/tokens.json 하나에서 화면마다 쓰는 파일을 만든다.
//   ui/src/tokens.css      대시보드·설정(Tailwind @theme와 :root 변수)
//   web/phone/tokens.css   폰 화면 CSS 변수
//   web/phone/tokens.js    폰 캔버스·인코딩 워커가 쓰는 색 값(ESM)
//   src/design/tokens.ts   트윈·SVG·캔버스·3D 계획 색(TS 값)
// 원본의 {"ref": 이름}은 hex(또는 rgb(… / α))로, 값이 더 있는 {"ref": 이름, width, opacity}는 { color, width, opacity }로 푼다.
// 사용: npm run tokens (tests/design-tokens.test.ts가 만든 파일이 원본과 같은지 본다)

import { readFileSync, writeFileSync } from "node:fs";
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
  font: { sans: { family: string }; mono: { family: string }; canvas: string; weights: Record<string, number> };
  type: Record<string, { size: Record<Surface, number | null>; lineHeight: Record<Surface, number | null>; weight: number; tracking: string }>;
  motion: { duration: Record<string, number>; easing: Record<string, string> };
  overlayLine: Obj;
  twin: Obj;
  viz: Obj;
}

export const SOURCE = "src/design/tokens.json";
export const OUTPUTS = ["ui/src/tokens.css", "web/phone/tokens.css", "web/phone/tokens.js", "src/design/tokens.ts"] as const;

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
    `  --font-weight-brand: ${t.font.weights.brand};`,
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

function phoneCss(t: Tokens, value: (n: string) => string): string {
  return [
    HEAD(t, "/*") + " */",
    ":root {",
    ...rootVars(t, value),
    `  --font-sans: ${t.font.sans.family};`,
    `  --font-mono: ${t.font.mono.family};`,
    `  --font-weight-brand: ${t.font.weights.brand};`,
    ...Object.entries(t.radius).map(([k, v]) => `  --${k}: ${px(v)};`),
    ...Object.entries(t.shadow).map(([k, v]) => `  --${k}: ${shadow(t, value, v)};`),
    ...Object.entries(t.type).flatMap(([name, ty]) => [...typeVars({ ...t, type: { [name]: ty } }, "phone"), ...(ty.size.phone == null ? [] : [`  --type-${name}-weight: ${ty.weight};`, `  --type-${name}-tracking: ${ty.tracking === "0" ? "0em" : ty.tracking};`])]),
    "}",
    "",
  ].join("\n");
}

/** 캔버스 글꼴: font.canvas 틀의 글꼴 이름 부분. */
const canvasFamily = (t: Tokens) => /\}px (.+?)`/.exec(t.font.canvas)?.[1] ?? t.font.sans.family;

const js = (v: unknown) => JSON.stringify(v, null, 2);

/** 설명 글(한국어) 칸을 뺀다. 폰 화면 파일은 화면 글 검사(lint-ui-copy)를 받는다. */
const values = (v: Json): Json => {
  if (Array.isArray(v)) return v.map(values);
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).filter(([, x]) => !(typeof x === "string" && /[가-힣]/.test(x))).map(([k, x]) => [k, values(x)]));
  return v;
};

function phoneJs(t: Tokens, value: (n: string) => string, deep: (v: Json) => Json): string {
  const color = Object.fromEntries(Object.keys(t.color).map((n) => [n, value(n)]));
  const rgba = Object.fromEntries(Object.keys(t.colorRgba).map((n) => [n, value(n)]));
  return [
    HEAD(t, "//"),
    "// 폰 화면 캔버스(marks.js)와 인코딩 워커가 import한다.",
    "",
    `export const color = ${js(color)};`,
    "",
    `export const rgba = ${js(rgba)};`,
    "",
    `/** 트윈·지도·폰 영상 위 표시는 세 겹(바깥 숯색, 흰 테, 심). */`,
    `export const overlayLine = ${js(values(deep(t.overlayLine)))};`,
    "",
    `export const focus = ${js(values(deep((t.twin as Obj).phoneFocus!)))};`,
    "",
    `export const canvasFont = ${js(canvasFamily(t))};`,
    "",
  ].join("\n");
}

function designTs(t: Tokens, value: (n: string) => string, deep: (v: Json) => Json): string {
  const color = Object.fromEntries(Object.keys(t.color).map((n) => [n, value(n)]));
  const rgba = Object.fromEntries(Object.keys(t.colorRgba).map((n) => [n, value(n)]));
  const alias = Object.fromEntries(Object.keys(t.alias).map((n) => [n, value(n)]));
  return [
    HEAD(t, "//"),
    "// 트윈 위 표시·SVG·캔버스·3D 계획(VIZ) 색은 여기 값만 쓴다.",
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
    `export const font = ${js({ sans: t.font.sans.family, mono: t.font.mono.family, canvas: canvasFamily(t), weights: t.font.weights })} as const;`,
    "",
    "export type ColorToken = keyof typeof color;",
    "",
  ].join("\n");
}

/** 원본에서 만든 파일 넷: 저장소 기준 경로 → 내용. */
export function renderTokens(t: Tokens): Record<(typeof OUTPUTS)[number], string> {
  const { value, deep } = resolver(t);
  return {
    "ui/src/tokens.css": uiCss(t, value),
    "web/phone/tokens.css": phoneCss(t, value),
    "web/phone/tokens.js": phoneJs(t, value, deep),
    "src/design/tokens.ts": designTs(t, value, deep),
  };
}

export const repoPath = (p: string) => fileURLToPath(new URL(`../${p}`, import.meta.url));
export const readTokens = (): Tokens => JSON.parse(readFileSync(repoPath(SOURCE), "utf8")) as Tokens;

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  for (const [p, body] of Object.entries(renderTokens(readTokens()))) {
    writeFileSync(repoPath(p), body, "utf8");
    console.log(`만듦 ${p}`);
  }
}
