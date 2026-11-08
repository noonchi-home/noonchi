// 날 색 검사(scripts/lint-ui-color.ts): 화면 코드에 날 색 값이 있으면 실패한다. 예시는 실제로 화면에 들어갔던 값이다.
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { COLOR_FIX, COLOR_TARGETS, TOKEN_OUTPUTS, colorFiles, fileColors, lintUiColor } from "../scripts/lint-ui-color.js";

const at = (p: string) => fileURLToPath(new URL(`../${p}`, import.meta.url));
const rules = (file: string, src: string) => fileColors(file, src).map((p) => `${p.line} ${p.rule} ${p.text}`);

describe("날 색 값을 잡는다", () => {
  it("TSX 글·속성: #hex, 임의 값, 이름 색, Tailwind 팔레트", () => {
    const src = [
      'const a1 = <rect fill="#fff" />;',
      'const a2 = <b className="bg-on text-[#08201b]">1</b>;',
      'const a3 = <div className="relative h-96 w-56 bg-black/70" />;',
      'const a4 = <span className="text-white hover:bg-red-500 ring-zinc-700/40" />;',
      'const a5 = <b className={cn("rounded-full", id === "A" ? "bg-[#e8590c]" : "bg-[#1c7ed6]")}>A</b>;',
      'const ORDER = { on: "bg-green", alert: "bg-red" };',
      'const s = { color: "white" };',
    ].join("\n");
    expect(rules("ui/src/x.tsx", src)).toEqual([
      "1 #hex #fff",
      "2 임의 색 값 text-[#08201b]",
      "3 이름 색 bg-black/70",
      "4 이름 색 text-white",
      "4 Tailwind 팔레트 hover:bg-red-500",
      "4 Tailwind 팔레트 ring-zinc-700/40",
      "5 임의 색 값 bg-[#e8590c]",
      "5 임의 색 값 bg-[#1c7ed6]",
      "6 이름 색 bg-green",
      "6 이름 색 bg-red",
      "7 이름 색 white",
    ]);
  });

  it("CSS 값: #hex, rgb()·oklch(), 이름 색. 선택자는 보지 않는다", () => {
    const src = [
      "body { margin: 0; color: #34383e; background: #f7f4ef; }",
      "#start { width: 100%; }",
      ".topbar { background: rgb(0 0 0 / 0.45); }",
      ":root { --accent: oklch(62.6% 0.205 254.947); }",
      "#overlay { color: white; }",
      "/* #abc 주석은 보지 않는다 */",
    ].join("\n");
    expect(rules("web/phone/phone.css", src)).toEqual([
      "1 #hex #34383e",
      "1 #hex #f7f4ef",
      "3 색 함수 rgb(",
      "4 색 함수 oklch(",
      "5 이름 색 white",
    ]);
  });

  it("JS: 캔버스 색 글, 주석은 뺀다", () => {
    const src = [
      'const FOCUS_COLOR = "#2f6fde"; // #000',
      'ctx.fillStyle = "rgb(0 0 0 / 0.6)";',
      'ctx.strokeStyle = "white";',
      'document.body.style.background = "#6b6b6b";',
    ].join("\n");
    expect(rules("web/phone/marks.js", src)).toEqual(["1 #hex #2f6fde", "2 색 함수 rgb(", "3 이름 색 white", "4 #hex #6b6b6b"]);
  });

  it("HTML: 파비콘 data URI의 %23hex", () => {
    const src = '<link rel="icon" href="data:image/svg+xml,%3Csvg%3E%3Cpath fill=%22%232f6fde%22/%3E%3C/svg%3E">';
    expect(rules("ui/index.html", src)).toEqual(["1 #hex %232f6fde"]);
  });

  it("components/ui 밖에서 accent를 쓰면 brand를 쓰라고 한다", () => {
    expect(rules("ui/src/bubbles/BubbleLayer.tsx", 'const a = <span className="bg-accent" />;')).toEqual(["1 accent bg-accent"]);
    expect(rules("ui/src/components/ui/button.tsx", 'const a = <span className="hover:bg-accent" />;')).toEqual([]);
  });
});

describe("토큰은 통과한다", () => {
  it("토큰 class·var()·transparent·currentColor·주소 #", () => {
    const tsx = [
      'const b1 = <div className="bg-surface text-ink shadow-card border-transparent fill-current" />;',
      'const b2 = <svg fill="currentColor" stroke="none" />;',
      'location.hash = "#home"; const id = "#device-results";',
      'const s = { color: "var(--ink)", background: "transparent" };',
      'const b3 = <p className="text-left text-sm">흰 바탕</p>;',
    ].join("\n");
    expect(rules("ui/src/x.tsx", tsx)).toEqual([]);
    expect(rules("web/phone/phone.css", "#reticle { border: 3px solid var(--error-vivid); color: inherit; }\n.a:hover { color: currentColor; }")).toEqual([]);
  });

  it("토큰 원본에서 만든 파일은 보지 않는다", () => {
    expect(TOKEN_OUTPUTS).toEqual(["ui/src/tokens.css"]);
    for (const f of TOKEN_OUTPUTS) expect(rules(f, ':root { --brand: #a1143e; --scrim: rgb(42 38 39 / 0.6); }\nexport const brand = "#a1143e";')).toEqual([]);
    expect(colorFiles(COLOR_TARGETS).some((f) => TOKEN_OUTPUTS.some((t) => f.replace(/\\/g, "/").endsWith(t)))).toBe(false);
    expect(colorFiles([at("ui/index.html")])).toEqual([at("ui/index.html")]);
  });

  it("오류 글은 쓸 토큰 파일을 말한다", () => {
    expect(COLOR_FIX).toContain("src/design/tokens.json");
    expect(COLOR_FIX).toContain("ui/src/tokens.css");
    expect(COLOR_FIX).not.toContain("web/phone");
    expect(COLOR_FIX).toContain("src/design/tokens.ts");
  });
});

describe("ui/src·입구 HTML·web 전체", () => {
  it("대시보드·설정·폰 화면 파일을 본다", () => {
    const files = colorFiles(COLOR_TARGETS).map((f) => f.replace(/\\/g, "/"));
    for (const p of ["ui/index.html", "ui/setup/index.html", "ui/src/styles.css", "ui/src/bubbles/BubbleLayer.tsx", "ui/src/phone/PhoneScreen.tsx", "ui/src/phone/core/marks.js"]) {
      expect(files.some((f) => f.endsWith(p))).toBe(true);
    }
    expect(files.some((f) => /\.d\.ts$|[\\/]tests[\\/]|node_modules/.test(f))).toBe(false);
  });

  it("날 색 검사에 걸리는 곳이 없다(npm run lint)", () => {
    expect(lintUiColor(COLOR_TARGETS).map((p) => `${p.file}:${p.line} [${p.rule}] ${p.text}`)).toEqual([]);
  });
});
