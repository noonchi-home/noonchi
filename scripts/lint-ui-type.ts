// 글 크기 검사: 대시보드 입구(ui/src/dashboard/main.tsx)에서 import로 닿는 ui/src 파일의 글 크기를 본다.
// - 21st.dev 부품(ui/src/components/ui)은 받은 코드의 원래 글 크기까지만 쓴다. 파일 머리 「// 원래 글 크기: text-sm(14px)」 줄이 그 크기다.
//   화면 너비로 커지는 디자인 토큰 글 크기(text-caption·label·body-sm·body·title…·far, src/design/tokens.json type)는 쓰지 않는다.
// - 화면 코드(부품 밖)는 글 크기를 정하지 않고(부품 크기를 쓴다), 부품의 far 크기를 고르지 않고, 토큰 글 크기로 자리를 재지 않는다.
// - 원래 크기보다 큰 글은 사용자가 허락한 것(USER_SIZES: 부품 파일·줄·크기 하나씩, 사용자 말과 날짜)만 된다. 그 줄 밖의 큰 글은 그대로 막는다.
// 사용: npm run lint (tests/lint-ui-type.test.ts도 같은 검사를 돌린다). 다른 ui/src를 보려면 --src <폴더>.
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export type TypeProblem = { file: string; line: number; text: string; rule: string; fix: string };
type At = TypeProblem & { at: number };

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const TOKENS = JSON.parse(readFileSync(join(ROOT, "src/design/tokens.json"), "utf8")) as {
  type: Record<string, { size: Record<string, number | null> }>;
};

/** 사용자가 허락한 큰 글: 부품 파일(components/ui/…)의 그 줄(line)에 있는 그 크기(size)만 원래 크기보다 커도 된다. */
export const USER_SIZES = [
  {
    part: "components/ui/item.tsx", line: /^\s*say\s*:/, size: "text-base", px: 16,
    where: "마스코트 말풍선 카드 글(Item size say: 굵게·가운데)",
    quote: "말풍선 안에 글씨만 가운데 정렬 + 좀 더 크게 + 굵은글씨 가자", date: "2026-11-09",
  },
  {
    part: "components/ui/button.tsx", line: /^\s*setup\s*:/, size: "text-base", px: 16,
    where: "설정 1~3단계 이전·다음 단추(Button size setup)", quote: "1,2,3 번은 글씨 키워도되겠다 설정화면사진봤는데", date: "2026-11-09",
  },
  {
    part: "components/ui/alert.tsx", line: /^\s*setup\s*:/, size: "text-base", px: 16,
    where: "설정 1~3단계 알림 줄·안내 칸(Alert size setup)", quote: "1,2,3 번은 글씨 키워도되겠다 설정화면사진봤는데", date: "2026-11-09",
  },
  {
    part: "components/ui/status.tsx", line: /^\s*setup\s*:/, size: "text-sm", px: 14,
    where: "설정 1~3단계 상태 칩(Status size setup)", quote: "1,2,3 번은 글씨 키워도되겠다 설정화면사진봤는데", date: "2026-11-09",
  },
  {
    part: "components/ui/card.tsx", line: /size === "lg" && "text-headline"/, size: "text-headline", px: 22,
    where: "설정 1~3단계 말풍선 제목(CardTitle size lg, headline 토큰)", quote: "1,2,3 번은 글씨 키워도되겠다 설정화면사진봤는데", date: "2026-11-09",
  },
  {
    part: "components/ui/radio-group.tsx", line: /size === "lg" && "text-body(?:-sm)?"/, size: "text-body", px: 15,
    where: "설정 1~3단계 고르기 카드 이름 body·설명 body-sm(RadioCard size lg)", quote: "1,2,3 번은 글씨 키워도되겠다 설정화면사진봤는데", date: "2026-11-09",
  },
] as const;
const userSize = (file: string, lineText: string, size: string) =>
  USER_SIZES.some((u) => file.replaceAll("\\", "/").endsWith(u.part) && u.line.test(lineText) && u.size === size);

/** Tailwind 기본 글 크기(px). 받은 21st.dev 부품이 쓰는 이름이다. */
const SCALE: Record<string, number> = { xs: 12, sm: 14, base: 16, lg: 18, xl: 20, "2xl": 24, "3xl": 30, "4xl": 36, "5xl": 48, "6xl": 60, "7xl": 72, "8xl": 96, "9xl": 128 };
const HUB = Object.keys(TOKENS.type).sort((a, b) => b.length - a.length);
const hubPx = (name: string) => {
  const s = TOKENS.type[name]!.size;
  return `1440 ${s.hub1440}px, 1920 ${s.hub1920}px`;
};

const SIZE_CLASS = new RegExp(`(?<![\\w-])text-(${Object.keys(SCALE).join("|")}|\\[\\d+(?:\\.\\d+)?(?:px|rem)\\])(?![\\w-])`, "g");
const HUB_CLASS = new RegExp(`(?<![\\w-])text-(${HUB.join("|")})(?![\\w-])`, "g");
const FAR_SIZE = /\bsize\s*=\s*\{?\s*["'`]far["'`]/g;
const TOKEN_TYPE = /\btokens\.type\b/g;
const ORIGINAL = /^\/\/ 원래 글 크기: (?:(text-(?:[\w]+|\[\d+px\]))\((\d+)px\)|없음)/m;

/** 주석을 빈칸으로 지운 코드(줄 번호는 그대로). 문자열 안 「//」는 남긴다. */
const stripComments = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " ")).replace(/(^|[^:"'`\w])\/\/.*$/gm, (m, a: string) => a + " ".repeat(m.length - a.length));
const lineAt = (src: string, index: number) => src.slice(0, index).split("\n").length;
const pxOf = (size: string) => (size.startsWith("[") ? Number.parseFloat(size.slice(1)) * (size.endsWith("rem]") ? 16 : 1) : SCALE[size]!);
const partName = (src: string, file: string) => src.match(/21st\.dev「([^」]+)」/)?.[1] ?? file;

/** 파일 하나의 글 크기 문제. kind: part(21st.dev 부품) | screen(화면 코드). */
export function fileProblems(file: string, src: string, kind: "part" | "screen"): TypeProblem[] {
  const code = stripComments(src);
  const out: At[] = [];
  const add = (index: number, text: string, rule: string, fix: string) => out.push({ file, line: lineAt(code, index), text, rule, fix, at: index });
  if (kind === "part") {
    const name = partName(src, file);
    const orig = src.match(ORIGINAL);
    if (!orig) {
      add(0, file, "원래 글 크기 없음", `출처 줄 아래에 「// 원래 글 크기: text-sm(14px)」처럼 ${name} 받은 코드의 가장 큰 글 크기를 적으세요(글 크기가 없으면 「없음」).`);
      return out.map(({ at: _, ...p }) => p);
    }
    const max = orig[2] ? Number(orig[2]) : 0;
    const use = orig[1] ? `${name} 원래 크기 ${orig[1]}(${max}px)로 바꾸세요.` : `${name} 받은 코드에는 글 크기가 없어요. 글 크기를 넣지 말고 감싼 글 크기를 따르세요.`;
    for (const m of code.matchAll(HUB_CLASS)) {
      add(m.index!, m[0], "커지는 글 크기", `화면 너비로 커지는 글 크기예요(${hubPx(m[1]!)}). ${use}`);
    }
    const lines = code.split(/\r?\n/);
    for (const m of code.matchAll(SIZE_CLASS)) {
      if (pxOf(m[1]!) <= max || userSize(file, lines[lineAt(code, m.index!) - 1] ?? "", m[0])) continue;
      add(m.index!, m[0], "원래보다 큰 글", `${pxOf(m[1]!)}px로 원래보다 커요. ${use}`);
    }
  } else {
    for (const m of code.matchAll(HUB_CLASS)) add(m.index!, m[0], "화면 글 크기", `화면 너비로 커지는 글 크기예요(${hubPx(m[1]!)}). 화면 코드는 글 크기를 정하지 말고 부품 원래 크기를 쓰세요.`);
    for (const m of code.matchAll(SIZE_CLASS)) add(m.index!, m[0], "화면 글 크기", "화면 코드는 글 크기를 정하지 말고 부품(ui/src/components/ui) 원래 크기를 쓰세요.");
    for (const m of code.matchAll(FAR_SIZE)) add(m.index!, m[0], "far 크기", "부품에 멀리서 읽는 far 크기는 없어요. 부품 기본 크기를 쓰세요(Item·Tooltip은 text-sm 14px).");
    for (const m of code.matchAll(TOKEN_TYPE)) add(m.index!, m[0], "토큰 글 크기로 자리 재기", "화면 너비로 커지는 토큰 글 크기(tokens.type)로 자리를 재지 마세요. 부품 원래 글의 줄 높이를 쓰세요(text-sm 20px, text-xs 16px).");
  }
  return out.sort((a, b) => a.at - b.at).map(({ at: _, ...p }) => p);
}

/** 입구에서 import(타입만 가져오는 것 포함)로 닿는 src 안 .ts·.tsx 파일. */
export function reach(src: string, entry: string): string[] {
  const seen = new Set<string>();
  const todo = [entry];
  while (todo.length) {
    const f = todo.pop()!;
    if (seen.has(f)) continue;
    seen.add(f);
    const text = readFileSync(f, "utf8");
    for (const m of text.matchAll(/(?:^|\n)\s*(?:import|export)\b[^;'"]*?(?:from\s*)?["']([^"']+)["']/g)) {
      const spec = m[1]!;
      const base = spec.startsWith("@/") ? join(src, spec.slice(2)) : spec.startsWith(".") ? resolve(dirname(f), spec) : null;
      if (!base) continue;
      const file = [base, `${base}.tsx`, `${base}.ts`, join(base, "index.tsx"), join(base, "index.ts")]
        .find((p) => existsSync(p) && statSync(p).isFile() && /\.tsx?$/.test(p));
      if (file && file.startsWith(src)) todo.push(file);
    }
  }
  return [...seen].sort();
}

export const UI_SRC = join(ROOT, "ui", "src");

/** 대시보드 입구에서 닿는 화면·부품 코드의 글 크기 문제. */
export function lintUiType(src = UI_SRC): TypeProblem[] {
  const root = resolve(src);
  const parts = join(root, "components", "ui");
  return reach(root, join(root, "dashboard", "main.tsx")).flatMap((f) =>
    fileProblems(relative(ROOT, f).replace(/\\/g, "/").replace(/^(\.\.\/)+/, ""), readFileSync(f, "utf8"), f.startsWith(parts) ? "part" : "screen"));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const at = process.argv.indexOf("--src");
  const problems = lintUiType(at > 0 ? resolve(process.argv[at + 1]!) : UI_SRC);
  for (const p of problems) console.log(`${p.file}:${p.line}  [${p.rule}] ${p.text}\n  → ${p.fix}`);
  if (problems.length) console.log(`글 크기 문제 ${problems.length}개`);
  process.exitCode = problems.length ? 1 : 0;
}
