// 글 자르기 검사(scripts/lint-text-cut.ts): 글을 `.slice(0, n)`으로 앞에서 자르면 이모지 대리쌍이 갈려 PAM 요청이 실패한다.
// 예시는 실제로 들어갔던 줄이다(state.ts 들은 말 200자, phone 말 500자, d71b61d PAM 글 줄 자르기).
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { CUT_HELPER, fileProblems, lintTextCut } from "../scripts/lint-text-cut.js";
import { WorldState } from "../src/world/state.js";
import { HEARD_MAX } from "../src/world/labels.js";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const lone = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

describe("글 자르기 검사", () => {
  it("지금 src·ui/src에는 글을 .slice(0, n)으로 자르는 곳이 없다(자르기는 shared/cut.ts headWithin 하나)", () => {
    expect(lintTextCut(ROOT)).toEqual([]);
  });

  it("실제로 들어갔던 글 자르기 세 줄을 잡고 headWithin을 알려 준다", () => {
    const heard = `function heard(text: string) {\n  const said = text.replace(/[「」]/g, "").replace(/\\s+/g, " ").trim().slice(0, HEARD_MAX);\n}`;
    const say = `const text = typeof msg.text === "string" ? msg.text.trim().slice(0, MAX_SAY) : "";`;
    const pamLine = `const lines = text.split("\\n");\nconst cut = (cap: number) => lines.map((l) => (l.length > cap ? \`\${l.slice(0, Math.max(0, cap - 1))}…\` : l)).join("\\n");`;
    for (const [file, src] of [["src/world/state.ts", heard], ["src/phone/server.ts", say]] as const) {
      const got = fileProblems(file, src);
      expect(got.map((p) => p.file)).toEqual([file]);
      expect(got[0]!.fix).toContain("headWithin");
    }
    // d71b61d 꼴 그대로: 줄 l은 split 결과(글 배열)의 map 콜백 인자다
    expect(fileProblems("src/world/text.ts", pamLine).map((p) => p.text)).toEqual(["l.slice(0, Math.max(0, cap - 1))"]);
  });

  it("split 결과(글 배열)의 map·forEach 콜백 인자도 글로 본다", () => {
    expect(fileProblems("src/x.ts", `const out = text.split("\\n").map((l) => l.slice(0, 5));`)).toHaveLength(1);
    expect(fileProblems("src/x.ts", `const lines = say.split(" ");\nlines.forEach((w) => keep(w.slice(0, 3)));`)).toHaveLength(1);
    expect(fileProblems("src/x.ts", `const out = text.split("\\n").filter(Boolean).map(function (l) { return l.slice(0, 5); });`)).toHaveLength(1);
    // 다른 배열의 콜백 인자는 글로 보지 않는다(같은 이름이 다른 곳에서 글이어도)
    expect(fileProblems("src/x.ts", `const a = text.split(",").map((p) => p);\nconst b = rows.map((p) => p.slice(0, 2));`)).toEqual([]);
  });

  it("음수 끝 위치로 잘라도 대리쌍이 갈리니 잡는다", () => {
    expect(fileProblems("src/x.ts", `const a = "😀".slice(0, -1);`)).toHaveLength(1);
    expect(fileProblems("src/x.ts", `const b = label.slice(0, -suffix.length);`)).toHaveLength(1);
  });

  it("concat은 받는 값이 글일 때만 글로 본다", () => {
    expect(fileProblems("src/x.ts", `const a = items.concat(more).slice(0, 3);`)).toEqual([]);
    expect(fileProblems("src/x.ts", `const b = "앞".concat(said).slice(0, 3);`)).toHaveLength(1);
  });

  it("ASCII 글에 붙인 값도 ASCII로 확인되지 않으면 글로 본다", () => {
    expect(fileProblems("src/x.ts", `const a = new Date().toISOString().concat(said).slice(0, 20);`)).toHaveLength(1);
    expect(fileProblems("src/x.ts", `const b = (new Date().toISOString() + said).slice(0, 20);`)).toHaveLength(1);
    expect(fileProblems("src/x.ts", `const c = new Date().toISOString().concat("Z").slice(0, 20);`)).toEqual([]);
  });

  it("지역 변수는 선언한 함수·블록 안에서만 뜻을 가진다(다른 함수의 같은 이름으로 판정하지 않는다)", () => {
    const miss = [
      "function a(rows: Row[]) { const parts = rows.map((r) => r.id); return parts.slice(0, 3); }",
      "function b(line: string) { const parts = line.split(\",\"); return parts.map((p) => p.slice(0, 2)); }",
    ].join("\n");
    expect(fileProblems("src/x.ts", miss).map((p) => p.text)).toEqual(["p.slice(0, 2)"]);
    const wrong = [
      "function a(said: string) { const parts = said.trim(); return headWithin(parts, 2); }",
      "function b(rows: Row[]) { const parts = rows.map((r) => r.id); return parts.slice(0, 3); }",
    ].join("\n");
    expect(fileProblems("src/x.ts", wrong)).toEqual([]);
    const blocks = "if (ok) { const parts = rows; use(parts.slice(0, 2)); } else { const parts = say.split(\" \"); use(parts[0].slice(0, 1)); }";
    expect(fileProblems("src/x.ts", blocks).map((p) => p.text)).toEqual(["parts[0].slice(0, 1)"]);
  });

  it("배열 자르기, toISOString 날짜, 자르기 도움 함수 자신은 잡지 않는다", () => {
    const src = [
      "const items: string[] = [];",
      "const a = items.slice(0, 3);",
      "const b = list.filter((x) => x).slice(0, 2);",
      "const day = new Date(0).toISOString().slice(0, 10);",
      "const at = now().toISOString();",
      "const id = at.slice(0, 19);",
      "const path = route.slice(0, -1);",
    ].join("\n");
    expect(fileProblems("src/x.ts", src)).toEqual([]);
    expect(fileProblems(CUT_HELPER, "export function headWithin(s: string, max: number) { return s.slice(0, max); }")).toEqual([]);
  });

  it("들은 말은 「가」 199개 뒤 이모지가 와도 대리쌍을 가르지 않는다", () => {
    const w = new WorldState({ evidenceStepMs: 1000, surfaces: () => [], floorAt: () => 0, roomAt: () => null, devices: () => [] });
    const [c] = w.heard(`${"가".repeat(HEARD_MAX - 1)}😀 더`, 0);
    expect(lone.test(c!.text)).toBe(false);
    expect(c!.text).toContain("가".repeat(HEARD_MAX - 1));
  });
});
