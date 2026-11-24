// 폴더 안의 파일만 내주는 정적 응답(본 서버 ui/dist·/twin/, 폰 서버 ui/dist 공용). 영상은 Range 요청으로 나눠 준다(serveRange).

import { createReadStream, readFileSync, statSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { extname, join, resolve, sep } from "node:path";
import { pipeline } from "node:stream";

export const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png",
  ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".ico": "image/x-icon", ".glb": "model/gltf-binary",
  ".gltf": "model/gltf+json", ".bin": "application/octet-stream", ".wasm": "application/wasm", ".txt": "text/plain; charset=utf-8",
  ".hdr": "application/octet-stream", ".ktx2": "image/ktx2", ".md": "text/markdown; charset=utf-8", ".woff2": "font/woff2",
  ".mp4": "video/mp4", ".webm": "video/webm",
};

const typeOf = (file: string) => TYPES[extname(file).toLowerCase()] ?? "application/octet-stream";

/** root 안의 rel 경로(URL 인코딩)를 푼다. 폴더 밖·널 문자·잘못된 인코딩이면 null. root는 상대 경로여도 된다(RUNTIME_DIR=runtime). */
function within(dir: string, rel: string): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(rel);
  } catch {
    return null;
  }
  if (decoded.includes("\0")) return null;
  // file이 절대 경로라 root도 절대 경로로 맞춰 비교한다
  const root = resolve(dir);
  const file = resolve(root, "." + sep + decoded.replace(/^[/\\]+/, ""));
  return file === root || file.startsWith(root.endsWith(sep) ? root : root + sep) ? file : null;
}

export function serveFile(res: ServerResponse, root: string, rel: string, head: boolean): boolean {
  let file = within(root, rel);
  if (!file) return false;
  try {
    if (statSync(file).isDirectory()) file = join(file, "index.html");
    if (!statSync(file).isFile()) return false;
  } catch {
    return false;
  }
  const body = readFileSync(file);
  res.writeHead(200, { "content-type": typeOf(file), "content-length": body.length, "cache-control": "no-cache" });
  res.end(head ? undefined : body);
  return true;
}

/** Range 머리 하나(bytes=s-e, bytes=s-, bytes=-n) → 보낼 범위. 머리가 없거나 모양이 틀리면(여러 범위 포함) undefined라 통째로 준다. 범위 밖이면 null. */
function byteRange(header: string | undefined, size: number): { start: number; end: number } | null | undefined {
  const m = header === undefined ? null : /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!m || (m[1] === "" && m[2] === "")) return undefined;
  if (m[1] === "") {
    const n = Number(m[2]);
    return n > 0 && size > 0 ? { start: Math.max(0, size - n), end: size - 1 } : null;
  }
  const start = Number(m[1]);
  const end = m[2] === "" ? size - 1 : Math.min(Number(m[2]), size - 1);
  return start < size && start <= end ? { start, end } : null;
}

/** 파일 하나를 스트림으로 준다(영상). Range 하나면 206과 Content-Range, 범위 밖이면 416과 bytes 별/크기. 없는 파일이면 false. */
export function serveRange(req: IncomingMessage, res: ServerResponse, root: string, rel: string, head: boolean): boolean {
  const file = within(root, rel);
  if (!file) return false;
  let size: number;
  try {
    const st = statSync(file);
    if (!st.isFile()) return false;
    size = st.size;
  } catch {
    return false;
  }
  const base = { "content-type": typeOf(file), "accept-ranges": "bytes", "cache-control": "no-cache" };
  const range = byteRange(req.headers.range, size);
  if (range === null) {
    res.writeHead(416, { ...base, "content-range": `bytes */${size}` });
    res.end();
    return true;
  }
  const { start, end } = range ?? { start: 0, end: size - 1 };
  res.writeHead(range ? 206 : 200, { ...base, "content-length": Math.max(0, end - start + 1), ...(range ? { "content-range": `bytes ${start}-${end}/${size}` } : {}) });
  if (head || size === 0) {
    res.end();
    return true;
  }
  // pipeline: 받는 쪽이 도중에 끊어도(다시 읽기·영상 바꾸기) 읽던 파일을 닫는다. 읽기 오류면 응답을 끊는다
  pipeline(createReadStream(file, { start, end }), res, () => {});
  return true;
}
