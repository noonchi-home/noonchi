// deploy/Dockerfile 화면 빌드 단계(FROM … AS ui)가 ui 빌드(tsc --noEmit + vite build)가 ui/ 밖에서 읽는 경로를 모두 복사하는지 본다.
// 이 PC에는 저장소 전체가 있어 화면 빌드가 늘 통과하므로, 빠진 COPY는 이미지를 빌드해야 드러난다(2026-11-09 twin/ 두 번).
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const UI = join(ROOT, "ui");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");
const posix = (p: string) => p.split(sep).join("/");

/** ui 빌드가 ui/ 밖에서 읽는 저장소 경로: Vite 별칭과 tsconfig에 포함된 파일에서 시작한다. */
function uiOutsideReads(): string[] {
  const out = new Set<string>();
  const visited = new Set<string>();
  function outsideUi(abs: string): boolean {
    const r = posix(relative(ROOT, abs));
    if (r === "ui" || r.startsWith("ui/")) return false;
    if (!r.startsWith("..")) out.add(r);
    return true;
  }
  function walk(path: string) {
    if (outsideUi(path) || visited.has(path) || !existsSync(path)) return;
    visited.add(path);
    if (statSync(path).isDirectory()) {
      for (const name of readdirSync(path)) {
        if (name !== "node_modules" && name !== "dist") walk(join(path, name));
      }
    } else if (/\.(tsx?|m?js)$/.test(path)) {
      for (const match of readFileSync(path, "utf8").matchAll(/(?:from|import)\s*\(?\s*["'](\.{1,2}\/[^"']+)["']/g)) {
        const dep = resolve(dirname(path), match[1]!);
        if (outsideUi(dep)) continue;
        walk(dep);
        if (!existsSync(dep)) for (const extension of [".ts", ".tsx", ".js"]) walk(dep.replace(/\.js$/, "") + extension);
      }
    }
  }
  for (const match of read("ui/vite.config.ts").matchAll(/page\("(\.\.\/[^"]+)"\)/g)) outsideUi(resolve(UI, match[1]!));
  // ui/runtime의 로컬 QA 파일은 이 입력 목록에 없다. ui/tests는 tsc가 검사하므로 그대로 따라간다.
  for (const input of (JSON.parse(read("ui/tsconfig.json")) as { include: string[] }).include) walk(resolve(UI, input));
  return [...out].sort();
}

/** deploy/Dockerfile ui 단계의 COPY 원본(--from 없는 것). */
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

describe("deploy/Dockerfile 화면 빌드 단계", () => {
  const reads = uiOutsideReads();

  it("ui 밖에서 읽는 경로를 찾는다(트윈 뷰어 별칭, 서버 계약, 3D 트윈 시험의 장면 JSON)", () => {
    expect(reads).toContain("twin/apartment/viewer");
    expect(reads).toContain("src/contract");
    expect(reads).toContain("twin/homes/mokryeon_180b/scene.json");
  });

  it("ui 밖에서 읽는 경로를 모두 COPY한다", () => {
    const gone = missing(read("deploy/Dockerfile"), reads);
    expect(gone, `deploy/Dockerfile 화면 빌드 단계(FROM … AS ui)에 COPY가 없는 ui 밖 경로: ${gone.join(", ")}. 그 단계에 \`COPY <폴더> <폴더>\`를 더하세요.`).toEqual([]);
  });

  it("2026-11-09 CI를 깬 옛 단계(twin/ 없음)를 잡는다", () => {
    const old = ["FROM ${NODE_IMAGE} AS ui", "WORKDIR /app", "COPY ui/package.json ui/package-lock.json ui/", "RUN npm --prefix ui ci", "COPY src src", "COPY ui ui", "RUN npm --prefix ui run build", "FROM ${NODE_IMAGE} AS deps"].join("\n");
    const gone = missing(old, reads);
    expect(gone).toContain("twin/apartment/viewer");
    expect(gone).toContain("twin/homes/mokryeon_180b/scene.json");
    expect(gone.some((g) => g.startsWith("src/"))).toBe(false);
  });
});
