// Dockerfile 화면 빌드 단계(FROM … AS ui)가 ui 빌드(tsc --noEmit + vite build)가 ui/ 밖에서 읽는 경로를 모두 복사하는지 본다.
// 이 PC에는 저장소 전체가 있어 화면 빌드가 늘 통과하므로, 빠진 COPY는 올린 뒤 CI image에서야 드러난다(2026-11-09 twin/ 두 번).
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const UI = join(ROOT, "ui");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");
const posix = (p: string) => p.split(sep).join("/");

/** ui 빌드가 ui/ 밖에서 읽는 저장소 경로: vite 별칭, tsconfig include, ui 파일의 상대 import. */
function uiOutsideReads(): string[] {
  const out = new Set<string>();
  const add = (abs: string) => {
    const r = posix(relative(ROOT, abs));
    if (r !== "ui" && !r.startsWith("ui/") && !r.startsWith("..")) out.add(r);
  };
  for (const m of read("ui/vite.config.ts").matchAll(/page\("(\.\.\/[^"]+)"\)/g)) add(resolve(UI, m[1]!));
  for (const inc of (JSON.parse(read("ui/tsconfig.json")) as { include: string[] }).include) if (inc.startsWith("../")) add(resolve(UI, inc));
  const walk = (d: string) => {
    for (const n of readdirSync(d)) {
      if (n === "node_modules" || n === "dist") continue;
      const p = join(d, n);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.(tsx?|m?js)$/.test(n)) {
        for (const m of readFileSync(p, "utf8").matchAll(/(?:from|import)\s*\(?\s*["'](\.{1,2}\/[^"']+)["']/g)) add(resolve(dirname(p), m[1]!));
      }
    }
  };
  walk(UI);
  return [...out].sort();
}

/** Dockerfile ui 단계의 COPY 원본(--from 없는 것). */
function uiStageCopies(dockerfile: string): string[] {
  const lines = dockerfile.split(/\r?\n/).map((l) => l.trim());
  const start = lines.findIndex((l) => /^FROM\s+\S+\s+AS\s+ui$/i.test(l));
  if (start < 0) return [];
  const next = lines.findIndex((l, i) => i > start && /^FROM\s/i.test(l));
  return lines.slice(start + 1, next < 0 ? undefined : next)
    .filter((l) => /^COPY\s/i.test(l) && !/--from=/i.test(l))
    .flatMap((l) => l.split(/\s+/).slice(1).filter((w) => !w.startsWith("--")).slice(0, -1))
    .map((s) => s.replace(/\/$/, ""));
}

/** ui 단계 COPY가 덮지 않는 ui 밖 경로. */
const missing = (dockerfile: string, reads: string[]) => {
  const copies = uiStageCopies(dockerfile);
  return reads.filter((r) => !copies.some((c) => r === c || r.startsWith(`${c}/`)));
};

describe("Dockerfile 화면 빌드 단계", () => {
  const reads = uiOutsideReads();

  it("ui 밖에서 읽는 경로를 찾는다(트윈 뷰어 별칭, 서버 계약, 3D 트윈 시험의 장면 JSON)", () => {
    expect(reads).toContain("twin/apartment/viewer");
    expect(reads).toContain("src/contract");
    expect(reads).toContain("twin/homes/mokryeon_180b/scene.json");
  });

  it("ui 밖에서 읽는 경로를 모두 COPY한다", () => {
    const gone = missing(read("Dockerfile"), reads);
    expect(gone, `Dockerfile 화면 빌드 단계(FROM … AS ui)에 COPY가 없는 ui 밖 경로: ${gone.join(", ")}. 그 단계에 \`COPY <폴더> <폴더>\`를 더하세요.`).toEqual([]);
  });

  it("2026-11-09 CI를 깬 옛 단계(twin/ 없음)를 잡는다", () => {
    const old = ["FROM ${NODE_IMAGE} AS ui", "WORKDIR /app", "COPY ui/package.json ui/package-lock.json ui/", "RUN npm --prefix ui ci", "COPY src src", "COPY ui ui", "RUN npm --prefix ui run build", "FROM ${NODE_IMAGE} AS deps"].join("\n");
    const gone = missing(old, reads);
    expect(gone).toContain("twin/apartment/viewer");
    expect(gone).toContain("twin/homes/mokryeon_180b/scene.json");
    expect(gone.some((g) => g.startsWith("src/"))).toBe(false);
  });
});
