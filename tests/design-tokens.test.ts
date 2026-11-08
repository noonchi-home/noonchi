// 디자인 토큰(src/design/tokens.json 하나): 화면마다 쓰는 파일은 이 원본에서 npm run tokens가 만든다. 어긋나면 실패한다.
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { FONT_FACES, OUTPUTS, SOURCE, copies, readTokens, renderFontFaces, renderTokens, repoPath, resolver } from "../scripts/design-tokens.js";

const tokens = readTokens();
const onDisk = (p: string) => (existsSync(repoPath(p)) ? readFileSync(repoPath(p), "utf8").replace(/\r\n/g, "\n") : null);

describe("디자인 토큰 원본", () => {
  it("만든 파일 둘이 원본과 같다(다르면 npm run tokens)", () => {
    expect([...OUTPUTS]).toEqual(["ui/src/tokens.css", "src/design/tokens.ts"]);
    const want = renderTokens(tokens);
    expect(Object.keys(want)).toEqual([...OUTPUTS]);
    const stale = OUTPUTS.filter((p) => onDisk(p) !== want[p]);
    expect(stale, `${stale.join(", ")}: ${SOURCE}에서 다시 만드세요(npm run tokens)`).toEqual([]);
  });

  it("글꼴 라이선스만 ui/public/fonts로 옮긴다. 폰 전용 사본(web/phone)은 없다", () => {
    expect(copies()).toEqual([{ from: "ui/node_modules/@fontsource-variable/noto-sans-kr/LICENSE", to: "ui/public/fonts/OFL-noto-sans-kr.txt" }]);
    const text = (p: string) => readFileSync(repoPath(p), "utf8").replace(/\r\n/g, "\n");
    expect(text("ui/public/fonts/OFL-noto-sans-kr.txt")).toBe(text("ui/node_modules/@fontsource-variable/noto-sans-kr/LICENSE"));
    expect(existsSync(repoPath("web/phone"))).toBe(false);
  });

  it("워커 글꼴 목록(ui/src/phone/core/font-faces.js)이 꾸러미 CSS와 같고, 글꼴 파일은 ui 빌드가 묶는다(?url)", () => {
    expect(FONT_FACES).toBe("ui/src/phone/core/font-faces.js");
    expect(onDisk(FONT_FACES)).toBe(renderFontFaces());
    const css = readFileSync(repoPath("ui/node_modules/@fontsource-variable/noto-sans-kr/index.css"), "utf8");
    const imports = renderFontFaces().match(/^import f\d+ from "@fontsource-variable\/noto-sans-kr\/files\/[\w-]+\.woff2\?url";$/gm) ?? [];
    expect(imports).toHaveLength(css.match(/@font-face/g)!.length);
    expect(renderFontFaces()).toMatch(/\{ url: f0, unicodeRange: "U\+/);
  });

  it("원본이 바뀌면 만든 파일도 바뀐다", () => {
    const changed = structuredClone(tokens);
    changed.color.brand!.value = "#000001";
    const a = renderTokens(tokens);
    const b = renderTokens(changed);
    for (const p of OUTPUTS) expect(b[p]).not.toBe(a[p]);
  });

  it("hex·rgb 값은 color에만 있다(legacy·raw·contrast 기록은 뺀다). 나머지는 토큰 이름만 가리킨다", () => {
    const raw: string[] = [];
    const walk = (v: unknown, at: string) => {
      if (typeof v === "string" && /#[0-9a-f]{3,8}\b|\brgba?\(\s*\d/i.test(v)) raw.push(`${at}: ${v}`);
      else if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) walk(x, `${at}.${k}`);
    };
    const all = JSON.parse(readFileSync(repoPath(SOURCE), "utf8")) as Record<string, unknown>;
    for (const [k, v] of Object.entries(all)) if (!["color", "legacy", "raw", "contrast"].includes(k)) walk(v, k);
    expect(raw).toEqual([]);
  });

  it("가리키는 토큰은 모두 있다", () => {
    const { deep } = resolver(tokens);
    expect(() => deep(JSON.parse(JSON.stringify({ twin: tokens.twin, viz: tokens.viz, overlay: tokens.overlayLine })))).not.toThrow();
    expect(resolver(tokens).value("twin-edge")).toBe(tokens.color.charcoal!.value);
    expect(resolver(tokens).value("scrim-phone")).toBe("rgb(42 38 39 / 0.8)");
  });

  it("ref만 있으면 값 글, 값이 더 있으면 { color, … }로 푼다", () => {
    const { deep } = resolver(tokens);
    expect(deep({ ref: "brand" })).toBe("#a1143e");
    expect(deep({ ref: "twin-casing", width: 9, opacity: 0.95 })).toEqual({ color: "#ffffff", width: 9, opacity: 0.95 });
  });
});
