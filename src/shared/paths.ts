// 저장소 뿌리 기준 경로와 직접 실행 검사. 파일 자리(import.meta.url)로 자원 경로를 찾는 곳은 이 파일 하나다.
// 코드 파일을 다른 폴더로 옮겨도 자원 경로(models/·twin/·ui/dist/·runtime/)가 바뀌지 않는다.

import { realpathSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** 저장소 뿌리(이 파일은 src/shared/). Docker 이미지에서는 /app/. */
const ROOT_URL = new URL("../../", import.meta.url);

/** 저장소 뿌리에 rel을 이은 절대 경로. 끝의 /는 그대로 남는다(예: repoPath("ui/dist/")). */
export function repoPath(rel: string): string {
  return fileURLToPath(new URL(rel, ROOT_URL));
}

/** 링크(정션·심볼릭 링크)를 푼 실제 경로. 파일이 없으면(확장자 없이 띄움) 폴더만 풀고, 폴더도 없으면 그대로. */
function real(p: string): string {
  try { return realpathSync.native(p); } catch { /* 파일 없음 */ }
  try { return join(realpathSync.native(dirname(p)), basename(p)); } catch { return p; }
}

/** 부른 모듈이 node로 바로 띄운 파일인지(`isEntry(import.meta.url)`). 확장자(.ts·.js)는 보지 않고, Windows에서는 대소문자도 보지 않는다. 링크를 거친 경로도 같은 파일로 본다. */
export function isEntry(metaUrl: string, entry: string | undefined = process.argv[1]): boolean {
  if (!entry) return false;
  const norm = (p: string) => {
    const r = real(resolve(p));
    return (process.platform === "win32" ? r.toLowerCase() : r).replace(/\.(ts|js)$/, "");
  };
  return norm(fileURLToPath(metaUrl)) === norm(entry);
}
