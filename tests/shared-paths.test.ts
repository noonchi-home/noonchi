// 저장소 뿌리 기준 경로(repoPath)와 직접 실행 검사(isEntry). 파일 자리(import.meta.url)로 자원 경로를 찾는 곳은 src/shared/paths.ts 하나다.
// 파일을 다른 폴더로 옮겨도 자원 경로(models/·twin/·ui/dist/·runtime/)가 바뀌지 않아야 한다.
import { mkdtempSync, rmSync, symlinkSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { isEntry, repoPath } from "../src/shared/paths.js";
import { MODELS_DIR } from "../src/observe/detector.js";
import { DEFAULT_TWIN_DIR } from "../src/layout/twin-files.js";
import { DEFAULT_UI_DIR } from "../src/phone/server.js";
import { DEFAULT_WEB_DIR } from "../src/server/app.js";
import { phoneVideoDir } from "../src/server/home/index.js";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const fromTests = (rel: string) => fileURLToPath(new URL(`../${rel}`, import.meta.url));

describe("저장소 뿌리 기준 경로", () => {
  it("repoPath는 저장소 뿌리에 rel을 이은 절대 경로이고 끝의 /를 남긴다", () => {
    expect(repoPath("ui/dist/")).toBe(fromTests("ui/dist/"));
    expect(repoPath("models/")).toBe(fromTests("models/"));
    expect(repoPath("twin/")).toBe(fromTests("twin/"));
    expect(repoPath("runtime/videos/")).toBe(fromTests("runtime/videos/"));
    expect(repoPath("package.json")).toBe(join(ROOT, "package.json"));
  });

  it("자원 폴더 상수는 옮기기 전과 같은 저장소 폴더다", () => {
    expect(MODELS_DIR).toBe(fromTests("models/"));
    expect(DEFAULT_TWIN_DIR).toBe(fromTests("twin/"));
    expect(DEFAULT_UI_DIR).toBe(fromTests("ui/dist/"));
    expect(DEFAULT_WEB_DIR).toBe(fromTests("ui/dist/"));
    expect(phoneVideoDir({})).toBe(fromTests("runtime/videos/"));
  });
});

describe("직접 실행 검사", () => {
  const file = join(ROOT, "src", "agent/mcp", "server.ts");
  const url = pathToFileURL(file).href;

  it("node로 바로 띄운 파일이면 참이다(확장자는 보지 않는다)", () => {
    expect(isEntry(url, file)).toBe(true);
    expect(isEntry(url, file.replace(/\.ts$/, ""))).toBe(true);
    expect(isEntry(url, file.replace(/\.ts$/, ".js"))).toBe(true);
  });

  it("Windows에서는 대소문자를 보지 않는다", () => {
    expect(isEntry(url, file.toUpperCase())).toBe(process.platform === "win32");
  });

  it("링크(정션·심볼릭 링크)를 거친 경로로 띄워도 같은 파일이면 참이다", () => {
    const dir = mkdtempSync(join(tmpdir(), "entry-link-"));
    const link = join(dir, "mcp");
    try {
      symlinkSync(join(ROOT, "src", "agent/mcp"), link, "junction");
      expect(isEntry(url, join(link, "server.ts"))).toBe(true);
      expect(isEntry(url, join(link, "server"))).toBe(true);
      expect(isEntry(url, join(link, "client.ts"))).toBe(false);
    } finally {
      // 링크만 지운다(링크가 가리키는 src/agent/mcp는 그대로)
      try { unlinkSync(link); } catch { /* 링크를 못 만들었음 */ }
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("다른 파일이거나 띄운 파일이 없으면 거짓이다", () => {
    expect(isEntry(url, join(ROOT, "src", "agent/mcp", "client.ts"))).toBe(false);
    expect(isEntry(url, undefined)).toBe(false);
    expect(isEntry(url, "")).toBe(false);
  });

  it("기본값은 process.argv[1]이다(시험 안에서는 이 파일이 입구가 아니다)", () => {
    expect(isEntry(import.meta.url)).toBe(false);
  });
});
