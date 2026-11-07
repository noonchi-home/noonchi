// 21st.dev 부품 검사(scripts/lint-ui-parts.ts): 화면 부품은 21st.dev에서 받은 코드(ui/src/components/ui, 출처 줄)만 쓰고, 화면 코드는 배치만 한다.
// 예시는 실제로 화면 코드에 들어갔던 손 꾸밈이다.
import { describe, expect, it } from "vitest";
import { PARTS_FIX, PARTS_TARGET, headerProblems, lintUiParts, screenFiles, screenProblems } from "../scripts/lint-ui-parts.js";

const found = (file: string, src: string) => screenProblems(file, src).map((p) => `${p.line} ${p.rule} ${p.text}`);

describe("ui/src/components/ui 출처 줄", () => {
  it("21st.dev 이름·id·작성자/slug와 바꾼 것 줄이 있으면 통과", () => {
    const src = '"use client";\n\n// 21st.dev「Chat Panel」(id 23601, theshanelevine/chat) 받은 코드.\n// 바꾼 것: 입력칸을 뺐다.\nexport {};\n';
    expect(headerProblems("ui/src/components/ui/chat-panel.tsx", src)).toEqual([]);
    expect(headerProblems("ui/src/components/ui/alert.tsx", "// 21st.dev「Alert」(id 11326, coss.com/alert) 받은 코드.\n// 바꾼 것: 색을 토큰으로.\n")).toEqual([]);
  });

  it("출처 줄이 없거나 id·slug가 없거나 바꾼 것 줄이 없으면 실패", () => {
    const tabs = '"use client";\n\n// shadcn tabs(21st.dev Assistant Tabs 의존 부품, 받은 코드 그대로).\nimport * as React from "react";\n';
    expect(headerProblems("ui/src/components/ui/tabs.tsx", tabs).map((p) => p.rule)).toEqual(["출처 줄"]);
    const cot = '"use client";\n\n// 21st.dev「Chain of Thought」(id 28391, nexus-ui/chain-of-thought) 받은 코드 그대로.\n// 도우미는 받은 꾸러미에 없어서 두었다.\n';
    expect(headerProblems("ui/src/components/ui/chain-of-thought.tsx", cot).map((p) => p.rule)).toEqual(["출처 줄"]);
    const noChange = "// 21st.dev「Button」(id 133, originui/button) 받은 코드.\nimport * as React from \"react\";\n";
    expect(headerProblems("ui/src/components/ui/button.tsx", noChange).map((p) => p.rule)).toEqual(["바꾼 것 줄"]);
  });
});

describe("화면 코드는 배치만", () => {
  it("꾸밈 class를 잡는다: 배경·글자색·크기·테두리·모서리·그림자·링·흐림·글꼴", () => {
    const src = [
      'const a = <div className={cn(!plain && "bg-surface shadow-card", kind === "pill" ? "rounded-full" : "rounded-card", className)} />;',
      'const b = <span data-order className={cn("grid size-4 shrink-0 place-items-center rounded-full text-[10px] font-semibold", ORDER[s.tone])}>1</span>;',
      'export const btn = "rounded-lg bg-field px-3 py-1.5 text-sm text-ink hover:bg-field-strong";',
      'const c = <button className={`absolute right-1.5 top-1.5 bg-white/70 backdrop-blur ${foldButton}`} />;',
      'const d = <i className="ring-1 ring-red leading-tight tracking-[-0.01em] border border-glass-line" />;',
    ].join("\n");
    expect(found("ui/src/x.tsx", src)).toEqual([
      "1 꾸밈 class bg-surface", "1 꾸밈 class shadow-card", "1 꾸밈 class rounded-full", "1 꾸밈 class rounded-card",
      "2 꾸밈 class rounded-full", "2 꾸밈 class text-[10px]", "2 꾸밈 class font-semibold",
      "3 꾸밈 class rounded-lg", "3 꾸밈 class bg-field", "3 꾸밈 class text-sm", "3 꾸밈 class text-ink", "3 꾸밈 class hover:bg-field-strong",
      "4 꾸밈 class bg-white/70", "4 꾸밈 class backdrop-blur",
      "5 꾸밈 class ring-1", "5 꾸밈 class ring-red", "5 꾸밈 class leading-tight", "5 꾸밈 class tracking-[-0.01em]", "5 꾸밈 class border", "5 꾸밈 class border-glass-line",
    ]);
  });

  it("꾸밈 inline style·SVG 색 속성을 잡는다", () => {
    const src = [
      "const a = <div style={{ left: p.x, borderRadius: 14, boxShadow: shade }} />;",
      'const b = <rect x={0} fill="#fff" />;',
      'el.style.background = "var(--canvas)";',
    ].join("\n");
    expect(found("ui/src/x.tsx", src)).toEqual(["1 꾸밈 style borderRadius", "1 꾸밈 style boxShadow", "2 꾸밈 style fill", "3 꾸밈 style background"]);
  });

  it("배치 class·자리 style은 통과한다", () => {
    const src = [
      'const a = <section className="absolute left-1/2 top-3 z-50 max-w-[calc(100%-1.5rem)] -translate-x-1/2 min-[1440px]:left-[calc(50%-78px)]" />;',
      'const b = <div className="flex items-center gap-1 overflow-x-auto p-1 *:pointer-events-auto max-sm:pointer-events-none! text-center hidden" />;',
      "const c = <div className=\"pointer-events-none absolute w-max scale-125 origin-bottom whitespace-nowrap\" style={{ left: p.x, top: p.y }} />;",
      'const d = <p className="text-left truncate">흰 바탕 · 둥근 글</p>;',
      'location.hash = "#home"; fetch("/api/setup/home"); const id = "h-devices";',
      'const e = <Button variant="outline" size="sm" aria-label="border 없음">이전</Button>;',
    ].join("\n");
    expect(found("ui/src/x.tsx", src)).toEqual([]);
  });

  it("three.js 장면 코드는 규칙 밖", () => {
    expect(found("ui/src/twin/scene.ts", 'import * as THREE from "three";\nconst m = { color: "x" }; const c = "rounded-full";')).toEqual([]);
  });

  it("오류 글은 ui/src/components/ui의 21st.dev 부품을 쓰라고 말한다", () => {
    expect(PARTS_FIX).toContain("ui/src/components/ui");
    expect(PARTS_FIX).toContain("21st.dev");
  });
});

describe("ui/src 전체", () => {
  it("화면 코드는 components/ui 밖 .ts·.tsx다", () => {
    const files = screenFiles(PARTS_TARGET).map((f) => f.replace(/\\/g, "/"));
    expect(files.some((f) => f.endsWith("ui/src/dashboard/Dashboard.tsx"))).toBe(true);
    expect(files.some((f) => f.endsWith("ui/src/setup/SetupApp.tsx"))).toBe(true);
    expect(files.some((f) => f.includes("/components/ui/"))).toBe(false);
  });

  it("21st.dev 부품 검사에 걸리는 곳이 없다(npm run lint)", () => {
    expect(lintUiParts(PARTS_TARGET).map((p) => `${p.file}:${p.line} [${p.rule}] ${p.text}`)).toEqual([]);
  });
});
