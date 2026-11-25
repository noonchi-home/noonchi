// 글꼴: 화면 글은 ui가 묶은 Pretendard Variable(pretendard 1.3.9)이고, 굵기는 600(SemiBold) 이상이다.
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { readTokens, renderTokens, repoPath } from "../scripts/design-tokens.js";
import { font } from "../src/design/tokens.js";
import { markFont } from "../ui/src/phone/core/marks.js";
import { FONT_CSS, devFontCss, pretendardFaces } from "../ui/pretendard-css.js";

const FAMILY = "Pretendard Variable";
const FLOOR = 600;
const OLD_SANS = '"Noto Sans KR Variable", "Noto Sans KR", "Malgun Gothic", "Apple SD Gothic Neo", system-ui, sans-serif';
const OLD_CANVAS = '"Noto Sans KR Variable", "Malgun Gothic", sans-serif';
const OLD_MONO = 'ui-monospace, "Cascadia Mono", Consolas, "D2Coding", monospace';
const PKG_CSS = "ui/node_modules/pretendard/dist/web/variable/pretendardvariable-dynamic-subset.css";
const text = (p: string) => readFileSync(repoPath(p), "utf8").replace(/\r\n/g, "\n");

/** ui/src 아래 파일(저장소 기준 경로). */
function uiFiles(name: RegExp): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (name.test(e.name)) out.push(relative(repoPath(""), p).replace(/\\/g, "/"));
    }
  };
  walk(repoPath("ui/src"));
  return out;
}

/** 600 아래 굵기: 숫자 600 미만, normal·lighter. var(…)·inherit·bold·bolder는 된다. */
const low = (v: string) => (/^\d+$/.test(v) ? Number(v) < FLOOR : /^(normal|lighter)$/.test(v));

/** font 줄임 표기 값의 굵기가 600 아래인지. 굵기를 빼면 normal(400)이다. inherit 같은 전체 값과 var(…)는 된다. */
function shorthandLow(value: string): boolean {
  const v = value.trim();
  if (/^(inherit|initial|unset|revert|revert-layer|var\()/.test(v)) return false;
  for (const token of v.split(/\s+/)) {
    if (/^(bold|bolder)$/.test(token)) return false;
    if (/^\d+$/.test(token)) return Number(token) < FLOOR;
    if (!/^(normal|italic|oblique|small-caps)$/.test(token)) break;
  }
  return true;
}

/** 한 줄에서 600 아래 굵기를 찾는다. css면 따옴표 없는 font 줄임 표기(CSS 선언)도 본다. TS 코드의 `font: string` 같은 타입은 CSS가 아니라서 뺀다. */
function lowWeights(line: string, css: boolean): string[] {
  const rules: [RegExp, (m: RegExpMatchArray) => boolean][] = [
    [/font-weight\s*[:=]\s*["']?([\w-]+)/g, (m) => low(m[1]!)],
    [/fontWeight\s*[:=]\s*\{?\s*["'`]?([\w-]+)/g, (m) => low(m[1]!)],
    [/\bfont-\[(\d+)\]/g, (m) => low(m[1]!)],
    [/(?<![\w$-])font\s*[:=]\s*(["'`])(.*?)\1/g, (m) => shorthandLow(m[2]!)],
  ];
  if (css) rules.push([/(?<![\w$-])font\s*:\s*(?!["'`{[])([^;}"']+)/g, (m) => shorthandLow(m[1]!)]);
  return rules.flatMap(([re, isLow]) => [...line.matchAll(re)].filter(isLow).map((m) => m[0]));
}

describe("글꼴 종류: Pretendard Variable", () => {
  it("꾸러미 동적 부분집합 CSS의 글꼴 이름이 Pretendard Variable 하나다", () => {
    expect([...new Set([...text(PKG_CSS).matchAll(/font-family:\s*'([^']+)'/g)].map((m) => m[1]))]).toEqual([FAMILY]);
  });

  it("--font-sans·캔버스 글꼴은 Pretendard Variable 다음에 예전 목록 그대로다", () => {
    expect(text("ui/src/tokens.css")).toContain(`  --font-sans: "${FAMILY}", ${OLD_SANS};\n`);
    expect(font.sans).toBe(`"${FAMILY}", ${OLD_SANS}`);
    expect(font.canvas).toBe(`"${FAMILY}", ${OLD_CANVAS}`);
    expect(markFont(640)).toBe(`bold 16px "${FAMILY}", ${OLD_CANVAS}`);
  });

  it("고정폭 자리(--font-mono, Tailwind가 <code>에 쓴다)도 Pretendard Variable 다음에 예전 고정폭 목록이다", () => {
    expect(text("ui/src/tokens.css")).toContain(`  --font-mono: "${FAMILY}", ${OLD_MONO};\n`);
    expect(font.mono).toBe(`"${FAMILY}", ${OLD_MONO}`);
  });

  it("글꼴 조각을 기다리는 곳(useFontsLoaded)은 모두 Pretendard Variable을 받는다", () => {
    const calls = uiFiles(/\.tsx?$/).flatMap((f) => [...text(f).matchAll(/useFontsLoaded\(\s*"([^"]+)"/g)].map((m) => `${f}: ${m[1]}`));
    expect(calls.length).toBeGreaterThanOrEqual(2);
    expect(calls.filter((c) => !c.endsWith(`: ${FAMILY}`))).toEqual([]);
  });

  it("워커 글꼴 목록(font-faces.js)은 꾸러미 조각 파일·unicode-range·굵기 범위와 같다", () => {
    const want = [...text(PKG_CSS).matchAll(/@font-face\s*\{([^}]*)\}/g)].map((m) => ({
      file: /url\(\.\/woff2-dynamic-subset\/([^)]+)\)/.exec(m[1]!)![1],
      range: /unicode-range:\s*([^;]+);/.exec(m[1]!)![1]!.trim(),
    }));
    expect(want).toHaveLength(92);
    const js = text("ui/src/phone/core/font-faces.js");
    const files = new Map([...js.matchAll(/^import (f\d+) from "pretendard\/dist\/web\/variable\/woff2-dynamic-subset\/([^"?]+)\?url";$/gm)].map((m) => [m[1], m[2]]));
    const got = [...js.matchAll(/\{ url: (f\d+), unicodeRange: "([^"]+)" \}/g)].map((m) => ({ file: files.get(m[1]!), range: m[2] }));
    expect(got).toEqual(want);
    expect(js).toContain(`export const family = "${FAMILY}";`);
    expect(js).toContain('export const weight = "45 920";');
    expect(js).not.toMatch(/noto|fontsource/i);
  });

  it("인코딩 워커는 목록의 굵기 범위로 FontFace를 넣는다", () => {
    const worker = text("ui/src/phone/core/encoder-worker.js");
    expect(worker).toMatch(/^import \{ faces, family, weight \} from "\.\/font-faces\.js";$/m);
    expect(worker).toContain("{ weight, unicodeRange: f.unicodeRange }");
    expect(worker).not.toContain("100 900");
  });

  it("ui 꾸러미는 pretendard 1.3.9 고정이고 Noto 꾸러미(@fontsource-variable/noto-sans-kr)는 없다", () => {
    const pkg = JSON.parse(text("ui/package.json")) as { dependencies: Record<string, string> };
    expect(pkg.dependencies.pretendard).toBe("1.3.9");
    expect(pkg.dependencies["@fontsource-variable/noto-sans-kr"]).toBeUndefined();
    const users = [...uiFiles(/\.(tsx?|jsx?|css)$/), "ui/vite.config.ts"].filter((f) => /fontsource|noto-sans-kr/.test(text(f)));
    expect(users).toEqual([]);
  });

  it("ui/src SVG 글(<text>)은 Pretendard 먼저(뒤는 예전 목록 system-ui,sans-serif), 600 이상", () => {
    const svgs = uiFiles(/\.svg$/).filter((f) => text(f).includes("<text"));
    expect(svgs.length).toBeGreaterThan(0);
    for (const f of svgs) {
      const families = [...text(f).matchAll(/font-family="([^"]*)"/g)].map((m) => m[1]);
      expect(families, f).not.toHaveLength(0);
      expect(families.filter((v) => v !== "Pretendard,system-ui,sans-serif"), f).toEqual([]);
      const weights = [...text(f).matchAll(/font-weight="([^"]*)"/g)].map((m) => m[1]!);
      expect(weights, f).not.toHaveLength(0);
      expect(weights.filter(low), f).toEqual([]);
    }
  });

  it("ui/src SVG는 <img>로 보여 페이지 글꼴을 못 쓰므로, 글자가 든 꾸러미 정적 SemiBold 조각을 바꾸지 않고 data URI로 품는다", () => {
    const STATIC = "ui/node_modules/pretendard/dist/web/static";
    const pkg = [...text(`${STATIC}/pretendard-dynamic-subset.css`).matchAll(/@font-face\s*\{([^}]*)\}/g)]
      .map((m) => m[1]!)
      .filter((b) => /font-weight:\s*600;/.test(b))
      .map((b) => ({
        bytes: readFileSync(repoPath(`${STATIC}/${/url\(\.\/(woff2-dynamic-subset\/[^)]+\.woff2)\)/.exec(b)![1]}`)),
        range: /unicode-range:\s*([^;]+);/.exec(b)![1]!.trim(),
      }));
    expect(pkg).toHaveLength(92);
    for (const f of uiFiles(/\.svg$/).filter((p) => text(p).includes("<text"))) {
      const svg = text(f);
      const faces = [...svg.matchAll(/@font-face\s*\{([^}]*)\}/g)].map((m) => m[1]!);
      expect(faces.length, f).toBeGreaterThan(0);
      const ranges: string[] = [];
      for (const face of faces) {
        expect(face, f).toMatch(/font-family:\s*Pretendard;/);
        expect(face, f).toMatch(/font-weight:\s*600;/);
        const data = Buffer.from(/src:\s*url\(data:font\/woff2;base64,([A-Za-z0-9+/=]+)\) format\("woff2"\)/.exec(face)![1]!, "base64");
        const range = /unicode-range:\s*([^;}]+)/.exec(face)![1]!.trim();
        const same = pkg.find((p) => p.bytes.equals(data));
        expect(same, `${f}: 꾸러미 조각과 같은 파일이어야 한다`).toBeDefined();
        expect(range, f).toBe(same!.range);
        ranges.push(range);
      }
      const covered = (cp: number) => ranges.some((r) => r.split(",").some((part) => {
        const [a, b = a] = part.trim().replace(/^U\+/i, "").split("-").map((h) => parseInt(h!, 16));
        return cp >= a! && cp <= b!;
      }));
      const chars = [...new Set([...svg.matchAll(/<text\b[^>]*>([^<]*)<\/text>/g)].flatMap((m) => [...m[1]!]))];
      expect(chars.length, f).toBeGreaterThan(10);
      expect(chars.filter((c) => !covered(c.codePointAt(0)!)), `${f}: 품은 조각에 없는 글자(npm run tokens로 다시 넣는다)`).toEqual([]);
    }
  });
});

describe("글꼴 라이선스", () => {
  it("Pretendard를 묶은 곳마다 꾸러미 OFL 글이 있고, THIRD_PARTY.md가 그 자리를 적는다", () => {
    const license = text("ui/node_modules/pretendard/dist/LICENSE.txt");
    const third = text("THIRD_PARTY.md");
    for (const p of ["ui/public/fonts/OFL-pretendard.txt"]) {
      expect(text(p), p).toBe(license);
      expect(third, p).toContain(`\`${p}\``);
    }
  });
});

describe("트윈 뷰어(/twin/viewer/, twin/apartment/viewer)", () => {
  const VIEWER = "twin/apartment/viewer";

  it("style.css는 ui 빌드가 내주는 /fonts/pretendard.css를 먼저 읽고, 글꼴은 Pretendard Variable 다음에 예전 목록, 굵기 600", () => {
    const css = text(`${VIEWER}/style.css`);
    expect(css.startsWith('@import url("/fonts/pretendard.css");\n')).toBe(true);
    expect(css).toContain(`  font: 600 14px/1.45 "${FAMILY}", system-ui, "Pretendard", "Malgun Gothic", sans-serif;\n`);
  });

  it("style.css·live.mjs의 글꼴 지정(font·font-family)은 inherit 말고는 모두 Pretendard Variable이 먼저다(CCTV 시각·<code> 포함)", () => {
    const found: string[] = [];
    for (const f of [`${VIEWER}/style.css`, `${VIEWER}/live.mjs`]) {
      for (const m of text(f).matchAll(/\bfont(?:-family)?:\s*([^;}]+)/g)) {
        const families = m[1]!.trim().replace(/^(\d+\s+)?[\d.]+px(\/[\d.]+)?\s+/, "");
        if (families !== "inherit" && !families.startsWith(`"${FAMILY}", `)) found.push(`${f} ${m[0]}`);
      }
    }
    expect(found).toEqual([]);
    // <code>는 브라우저 기본이 고정폭이라 따로 둔다
    expect(text(`${VIEWER}/style.css`)).toMatch(new RegExp(`\\ncode \\{[^}]*font-family: "${FAMILY}", monospace;`));
  });

  it("style.css·live.mjs에 600 아래 굵기가 없다(font 줄임 표기 포함, live.mjs는 CSS를 글로 품는다)", () => {
    const found: string[] = [];
    for (const f of [`${VIEWER}/style.css`, `${VIEWER}/live.mjs`]) {
      text(f).split("\n").forEach((line, i) => found.push(...lowWeights(line, true).map((m) => `${f}:${i + 1} ${m}`)));
    }
    expect(found).toEqual([]);
  });
});

describe("ui 빌드가 만드는 /fonts/pretendard.css(트윈 뷰어용)", () => {
  it("빌드한 CSS에서 Pretendard Variable @font-face만 고른다", () => {
    const built = [
      "body{color:red}",
      '@font-face{font-family:Pretendard Variable;font-weight:45 920;src:url(/assets/PretendardVariable.subset.0-a1.woff2)format("woff2-variations");unicode-range:U+AC00}',
      "@font-face{font-family:Other;src:url(/assets/o.woff2)}",
      '@font-face{font-family:"Pretendard Variable";src:url(/assets/PretendardVariable.subset.1-b2.woff2)}',
    ].join("");
    expect(pretendardFaces(built)).toEqual([
      '@font-face{font-family:Pretendard Variable;font-weight:45 920;src:url(/assets/PretendardVariable.subset.0-a1.woff2)format("woff2-variations");unicode-range:U+AC00}',
      '@font-face{font-family:"Pretendard Variable";src:url(/assets/PretendardVariable.subset.1-b2.woff2)}',
    ]);
  });

  it("개발 서버는 꾸러미 CSS의 조각 주소를 /node_modules/ 주소로 바꿔 내준다", () => {
    const pkg = "@font-face {\n\tsrc: url(./woff2-dynamic-subset/PretendardVariable.subset.0.woff2) format('woff2-variations');\n}\n";
    expect(devFontCss(pkg)).toBe("@font-face {\n\tsrc: url(/node_modules/pretendard/dist/web/variable/woff2-dynamic-subset/PretendardVariable.subset.0.woff2) format('woff2-variations');\n}\n");
  });

  it("ui/vite.config.ts가 이 플러그인을 쓰고, 고정 주소는 fonts/pretendard.css다", () => {
    expect(text("ui/vite.config.ts")).toMatch(/plugins: \[[^\]]*pretendardCss\(\)/);
    expect(FONT_CSS).toBe("fonts/pretendard.css");
  });
});

describe("굵기 바닥 600", () => {
  it("원본 토큰: 바닥이 600이고, 글꼴 굵기·글 종류 굵기가 모두 600 이상", () => {
    const t = readTokens();
    expect(t.font.weightFloor).toBe(FLOOR);
    expect(Object.entries(t.font.weights).filter(([, w]) => w < FLOOR)).toEqual([]);
    expect(Object.entries(t.type).filter(([, ty]) => ty.weight < FLOOR).map(([n]) => n)).toEqual([]);
  });

  it("tokens.css: Tailwind thin~medium 굵기 변수가 600이라 21st.dev 부품의 font-normal·font-medium도 600이다", () => {
    const css = text("ui/src/tokens.css");
    for (const n of ["thin", "extralight", "light", "normal", "medium"]) expect(css).toContain(`  --font-weight-${n}: 600;\n`);
    expect(css).toContain("  --font-weight-brand: 850;\n");
  });

  it("600 아래 굵기를 원본에 넣으면 npm run tokens가 멈춘다", () => {
    const a = structuredClone(readTokens());
    a.type.body!.weight = 400;
    expect(() => renderTokens(a)).toThrow(/body.*600/);
    const b = structuredClone(readTokens());
    b.font.weights.normal = 500;
    expect(() => renderTokens(b)).toThrow(/normal.*600/);
  });

  it("body 기본 굵기는 600(styles.css)", () => {
    const body = /\n {2}body \{([^}]*)\}/.exec(text("ui/src/styles.css"))![1]!;
    expect(body).toContain("font-weight: var(--font-weight-semibold);");
  });

  it("b·strong은 예전 굵기 700 그대로다(body가 600이면 기본 bolder가 900이 된다)", () => {
    expect(text("ui/src/styles.css")).toMatch(/\n {2}b, strong \{ font-weight: var\(--font-weight-bold\); \}\n/);
    expect(text("twin/apartment/viewer/style.css")).toMatch(/\nstrong \{ font-weight: 700; \}\n/);
  });

  it("<select>의 <option>도 600이다(크롬 기본 option 굵기는 normal 400)", () => {
    expect(text("ui/src/styles.css")).toMatch(/\n {2}option \{ font-weight: var\(--font-weight-semibold\); \}\n/);
    expect(text("twin/apartment/viewer/style.css")).toMatch(/\noption \{ font-weight: 600; \}\n/);
  });

  it("굵기 찾기는 낮은 굵기와 굵기 없는 font 줄임 표기를 잡고, 600 이상·bold·inherit는 두지 않는다", () => {
    const bad: [string, boolean][] = [
      ['<text fontWeight="400">', false],
      ["<text fontWeight={500}>", false],
      ["style={{ fontWeight: 500 }}", false],
      ['<text font-weight="normal">', true],
      ['className="font-[500]"', false],
      [".x { font: 12px/1.4 sans-serif; }", true],
      ["  font: lighter 12px sans-serif;", true],
      ["ctx.font = `${px}px ${font.canvas}`;", false],
      ['style={{ font: "400 12px sans-serif" }}', false],
    ];
    for (const [line, css] of bad) expect(lowWeights(line, css), line).not.toEqual([]);
    const good: [string, boolean][] = [
      ['<text fontWeight="600">', false],
      ["<text fontWeight={700}>", false],
      ['  font: 600 14px/1.45 "Pretendard Variable", sans-serif;', true],
      ["  font: inherit;", true],
      ["  font-family: Pretendard; font-weight: 600;", true],
      ["ctx.font = `bold ${px}px ${font.canvas}`;", false],
      ['style={{ font: "italic 600 12px sans-serif" }}', false],
      ["type Mark = { font: string; size: number };", false],
    ];
    for (const [line, css] of good) expect(lowWeights(line, css), line).toEqual([]);
  });

  it("ui/src의 CSS·SVG·코드(인라인 style·JSX 속성·font-[n]·font 줄임 표기·캔버스 ctx.font)에 600 아래 굵기가 없다", () => {
    const found: string[] = [];
    for (const f of uiFiles(/\.(css|svg|tsx?|jsx?)$/)) {
      const css = /\.(css|svg)$/.test(f);
      text(f).split("\n").forEach((line, i) => found.push(...lowWeights(line, css).map((m) => `${f}:${i + 1} ${m}`)));
    }
    expect(found).toEqual([]);
  });
});
