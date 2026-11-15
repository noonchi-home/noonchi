// 저장소 뿌리 기준 경로와 직접 실행 검사. 파일 자리(import.meta.url)로 자원 경로를 찾는 곳은 이 파일 하나다.
// 코드 파일을 다른 폴더로 옮겨도 자원 경로(models/·twin/·ui/dist/·runtime/)가 바뀌지 않는다(도메인 나누기 설계 2.2·3.1).

import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** 저장소 뿌리(이 파일은 src/shared/). Docker 이미지에서는 /app/. */
const ROOT_URL = new URL("../../", import.meta.url);

/** 저장소 뿌리에 rel을 이은 절대 경로. 끝의 /는 그대로 남는다(예: repoPath("ui/dist/")). */
export function repoPath(rel: string): string {
  return fileURLToPath(new URL(rel, ROOT_URL));
}

/** 부른 모듈이 node로 바로 띄운 파일인지(`isEntry(import.meta.url)`). 확장자(.ts·.js)는 보지 않고, Windows에서는 대소문자도 보지 않는다. */
export function isEntry(metaUrl: string, entry: string | undefined = process.argv[1]): boolean {
  if (!entry) return false;
  const norm = (p: string) => (process.platform === "win32" ? resolve(p).toLowerCase() : resolve(p)).replace(/\.(ts|js)$/, "");
  return norm(fileURLToPath(metaUrl)) === norm(entry);
}
