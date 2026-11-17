// 빌드·실행·시험·배포 파일이 옆 저장소 경로를 쓰면 실패한다. 오류는 대신 쓸 저장소 안 폴더를 말한다.
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { resolveTwinStudioDir } from "../src/layout/twin-files.js";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const SELF = fileURLToPath(import.meta.url);
/** 「main 합친 뒤 바꿀 것」 표(옛 .env를 새 값으로 옮기는 팀원용 안내, 2026-11-18 조정자 요청)는 옛 이름을 일부러 적는다: 그 칸만 빼고 본다.
 *  .env.example은 「# ── main 합친 뒤 바꿀 것」부터 다음 「# ──」 칸 전까지, 문서는 「### main 합친 뒤 바꿀 것」부터 다음 「### 」 전까지다. */
const withoutMigration = (text: string): string => text.replace(/\r/g, "")
  .replace(/^# ── main 합친 뒤 바꿀 것[^\n]*\n(?:(?!# ──)[^\n]*\n)*/m, "")
  .replace(/^### main 합친 뒤 바꿀 것[^\n]*\n(?:(?!### )[^\n]*\n)*/m, "");
const DIRS = ["src", "scripts", "tests", "ui/src", "ui/tests", "web", ".github"];
const FILES = [
  "package.json", "ui/package.json", "vitest.config.ts", "ui/vite.config.ts", "tsconfig.json", "Dockerfile", "compose.yaml",
  ".env.example", ".dockerignore", "README.md", "docs/reference.md", "docs/deploy.md", "docs/pam-interface.md", "docs/plan.md", "docs/plan-contract.md",
];
const SKIP = new Set(["node_modules", ".venv", "dist", "__pycache__", ".pytest_cache"]);
const TEXT = /\.(ts|tsx|mts|mjs|js|cjs|json|py|toml|ya?ml|md|txt|html|css|sh|ps1|cmd)$|(^|[\\/])(Dockerfile|\.env\.example|\.dockerignore)$/;

export const RULES = [
  { re: /(?:\.\.[\\/])+ai(?=[\\/"'`\s)]|$)/, use: "src/brain/pam/" },
  { re: /(?:\.\.[\\/])+twin-studio[\w-]*/, use: "twin/ (TWIN_STUDIO_DIR 기본값)" },
  { re: /noonchi[-_]server/, use: "src/ (TypeScript로 옮긴 모듈)" },
  { re: /소웨공[\\/]/, use: "이 저장소 안의 폴더" },
  // join(ROOT, "..", "ai")처럼 경로 조각으로 쓴 옆 저장소
  { re: /["'`]\.\.["'`]\s*,\s*(?:["'`]\.\.["'`]\s*,\s*)*["'`](?:ai|twin-studio[\w-]*)["'`]/, use: "src/brain/pam/·twin/" },
  // compose build·context가 저장소 밖(절대 경로·위 폴더)을 가리킴
  { re: /^\s*(?:build|context)\s*:\s*["']?(?:\/|[A-Za-z]:[\\/]|\.\.)/, use: "저장소 안 폴더(.)" },
];

function walk(dir: string, out: string[]): void {
  if (!existsSync(dir)) return;
  for (const name of readdirSync(dir)) {
    if (SKIP.has(name)) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (TEXT.test(p) && p !== SELF) out.push(p);
  }
}

function files(): string[] {
  const out: string[] = [];
  for (const d of DIRS) walk(join(ROOT, d), out);
  for (const f of FILES) if (existsSync(join(ROOT, f))) out.push(join(ROOT, f));
  return out;
}

export function scan(paths: string[]): string[] {
  const hits: string[] = [];
  for (const p of paths) {
    readFileSync(p, "utf8").split(/\r?\n/).forEach((line, i) => {
      for (const r of RULES) if (r.re.test(line)) hits.push(`${relative(ROOT, p)}:${i + 1}: 옆 저장소 경로 → ${r.use}를 쓴다`);
    });
  }
  return hits;
}

describe("한 저장소", () => {
  it("트윈 결과물 기본 폴더는 저장소 안 twin/", () => {
    const saved = process.env.TWIN_STUDIO_DIR;
    delete process.env.TWIN_STUDIO_DIR;
    try {
      expect(resolveTwinStudioDir(undefined, join(ROOT, "..", "elsewhere"))).toBe(join(ROOT, "twin"));
    } finally {
      if (saved !== undefined) process.env.TWIN_STUDIO_DIR = saved;
    }
  });

  it("빌드·실행·시험·배포 파일에 옆 저장소 경로가 없다", () => {
    expect(scan(files())).toEqual([]);
  });

  it("코드·설정에 옛 PAM 서비스 자리(services/pam·PAM_URL·PAM_HOST_PORT·PAM 이미지)가 없다", () => {
    const old = /services\/pam|\bPAM_URL\b|\bPAM_HOST_PORT\b|\bCHECK_PAM_PORT\b|noonchi-pam/;
    const hits = files().filter((f) => !f.endsWith(".md") && !f.endsWith("deploy-files.test.ts"))
      .filter((f) => old.test(withoutMigration(readFileSync(f, "utf8")))).map((f) => relative(ROOT, f)).sort();
    expect(hits).toEqual([]);
  });

  it("문서에 옛 PAM 서비스 자리·예전 추론 모드·OpenRouter 길이 없고, src/brain/pam에 안내가 있다", () => {
    for (const f of ["docs/reference.md", "docs/deploy.md", "docs/pam-interface.md", "README.md", "CLAUDE.md", "src/brain/pam/README.md"]) {
      const text = withoutMigration(readFileSync(join(ROOT, f), "utf8"));
      expect(text, f).not.toMatch(/services\/pam|\bPAM_URL\b|\bPAM_HOST_PORT\b|:8300|PAM_LLM_PROVIDER|OPENROUTER_API_KEY|qwen\/qwen3\.5-27b|INFERENCE_MODE=(mock|live)\b|`(mock|live)`\(/);
    }
    const guide = readFileSync(join(ROOT, "src/brain/pam/README.md"), "utf8");
    for (const s of ["prompts/paper", "source_map.json", "scenario.json", "prompt.ts", "answer.ts", "decide.ts", "decision.ts", "history/reflect.ts", "habits.ts",
      "src/world/text.ts", "src/act/tasks.ts", "npm test", "pam-golden", "-u", "OpenRouter 길은 2026-11-17에 뺐"]) expect(guide, s).toContain(s);
  });

  it("옛 이름은 「main 합친 뒤 바꿀 것」 표 안에만 둘 수 있다: 표 밖의 옛 이름은 그대로 잡는다", () => {
    const env = "# ── main 합친 뒤 바꿀 것(옛 .env) ──\n# PAM_URL | 지우기\n\n# ── 추론 ──\nPAM_URL=\n";
    expect(withoutMigration(env)).toBe("# ── 추론 ──\nPAM_URL=\n");
    const doc = "### main 합친 뒤 바꿀 것(옛 .env)\n\n| \`PAM_URL\` | 지우기 |\n\n### 변수\n\n| \`PAM_URL\` | 옛 주소 |\n";
    expect(withoutMigration(doc)).toBe("### 변수\n\n| \`PAM_URL\` | 옛 주소 |\n");
  });

  it("규칙이 옆 저장소 경로만 잡는다", () => {
    for (const s of ["../ai/pam", "..\\twin-studio\\homes.json", "../twin-studio-3d", "noonchi-server", "C:/Users/x/Desktop/소웨공/ai",
      'const AI = join(ROOT, "..", "ai", "pam");', 'TWIN_STUDIO_DIR: resolve(ROOT, "..", "twin-studio")', "join(here, '..', '..', 'twin-studio-3d')", "    context: /srv/ai", "  build: ../ai",
      "    build: C:/srv/ai"]) {
      expect(RULES.some((r) => r.re.test(s)), s).toBe(true);
    }
    for (const s of ["src/brain/pam/", "twin/homes.json", "my-ai", "twin-studio 저장소에서 빌드", 'join(ROOT, "..", "src")', 'join(ROOT, "ui")', "    build: ."]) {
      expect(RULES.some((r) => r.re.test(s)), s).toBe(false);
    }
  });
});
