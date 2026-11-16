// 빌드·실행·시험·배포 파일이 옆 저장소 경로를 쓰면 실패한다. 오류는 대신 쓸 저장소 안 폴더를 말한다.
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { resolveTwinStudioDir } from "../src/devices/devices.js";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const SELF = fileURLToPath(import.meta.url);
const DIRS = ["src", "scripts", "tests", "ui/src", "ui/tests", "web", "services", ".github"];
const FILES = [
  "package.json", "ui/package.json", "vitest.config.ts", "ui/vite.config.ts", "tsconfig.json", "Dockerfile", "compose.yaml",
  ".env.example", ".dockerignore", "README.md", "docs/reference.md", "docs/deploy.md", "docs/pam-interface.md", "docs/plan.md", "docs/plan-contract.md",
];
const SKIP = new Set(["node_modules", ".venv", "dist", "__pycache__", ".pytest_cache"]);
const TEXT = /\.(ts|tsx|mts|mjs|js|cjs|json|py|toml|ya?ml|md|txt|html|css|sh|ps1|cmd)$|(^|[\\/])(Dockerfile|\.env\.example|\.dockerignore)$/;

export const RULES = [
  { re: /(?:\.\.[\\/])+ai(?=[\\/"'`\s)]|$)/, use: "services/pam/" },
  { re: /(?:\.\.[\\/])+twin-studio[\w-]*/, use: "twin/ (TWIN_STUDIO_DIR 기본값)" },
  { re: /noonchi[-_]server/, use: "src/ (TypeScript로 옮긴 모듈)" },
  { re: /소웨공[\\/]/, use: "이 저장소 안의 폴더" },
  // join(ROOT, "..", "ai")처럼 경로 조각으로 쓴 옆 저장소
  { re: /["'`]\.\.["'`]\s*,\s*(?:["'`]\.\.["'`]\s*,\s*)*["'`](?:ai|twin-studio[\w-]*)["'`]/, use: "services/pam/·twin/" },
  // compose build·context가 저장소 밖(절대 경로·위 폴더)을 가리킴
  { re: /^\s*(?:build|context)\s*:\s*["']?(?:\/|[A-Za-z]:[\\/]|\.\.)/, use: "저장소 안 폴더(. 또는 services/pam)" },
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

  it("규칙이 옆 저장소 경로만 잡는다", () => {
    for (const s of ["../ai/pam", "..\\twin-studio\\homes.json", "../twin-studio-3d", "noonchi-server", "C:/Users/x/Desktop/소웨공/ai",
      'const AI = join(ROOT, "..", "ai", "pam");', 'TWIN_STUDIO_DIR: resolve(ROOT, "..", "twin-studio")', "join(here, '..', '..', 'twin-studio-3d')", "    context: /srv/ai", "  build: ../ai",
      "    build: C:/srv/ai"]) {
      expect(RULES.some((r) => r.re.test(s)), s).toBe(true);
    }
    for (const s of ["services/pam/", "twin/homes.json", "my-ai", "twin-studio 저장소에서 빌드", 'join(ROOT, "..", "src")', 'join(ROOT, "ui")', "    build: services/pam", "    build: ."]) {
      expect(RULES.some((r) => r.re.test(s)), s).toBe(false);
    }
  });
});
