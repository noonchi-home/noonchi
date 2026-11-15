// 저장소 뿌리 기준 경로(repoPath)와 직접 실행 검사(isEntry). 파일 자리(import.meta.url)로 자원 경로를 찾는 곳은 src/shared/paths.ts 하나다.
// 파일을 다른 폴더로 옮겨도 자원 경로(models/·twin/·ui/dist/·runtime/)가 바뀌지 않아야 한다.
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { isEntry, repoPath } from "../src/shared/paths.js";
import { MODELS_DIR } from "../src/brain/detector.js";
import { DEFAULT_TWIN_DIR } from "../src/model/devices.js";
import { DEFAULT_UI_DIR } from "../src/phone/server.js";
import { DEFAULT_WEB_DIR } from "../src/server/app.js";
import { phoneVideoDir } from "../src/server/home.js";

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
  const file = join(ROOT, "src", "mcp", "server.ts");
  const url = pathToFileURL(file).href;

  it("node로 바로 띄운 파일이면 참이다(확장자는 보지 않는다)", () => {
    expect(isEntry(url, file)).toBe(true);
    expect(isEntry(url, file.replace(/\.ts$/, ""))).toBe(true);
    expect(isEntry(url, file.replace(/\.ts$/, ".js"))).toBe(true);
  });

  it("Windows에서는 대소문자를 보지 않는다", () => {
    expect(isEntry(url, file.toUpperCase())).toBe(process.platform === "win32");
  });

  it("다른 파일이거나 띄운 파일이 없으면 거짓이다", () => {
    expect(isEntry(url, join(ROOT, "src", "mcp", "client.ts"))).toBe(false);
    expect(isEntry(url, undefined)).toBe(false);
    expect(isEntry(url, "")).toBe(false);
  });

  it("기본값은 process.argv[1]이다(시험 안에서는 이 파일이 입구가 아니다)", () => {
    expect(isEntry(import.meta.url)).toBe(false);
  });
});
