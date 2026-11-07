// 폴더 안의 파일만 내주는 정적 응답(본 서버 web/·/twin/, 폰 서버 web/phone/ 공용).

import { readFileSync, statSync } from "node:fs";
import type { ServerResponse } from "node:http";
import { extname, join, resolve, sep } from "node:path";

export const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png",
  ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".ico": "image/x-icon", ".glb": "model/gltf-binary",
  ".gltf": "model/gltf+json", ".bin": "application/octet-stream", ".wasm": "application/wasm", ".txt": "text/plain; charset=utf-8",
  ".hdr": "application/octet-stream", ".ktx2": "image/ktx2", ".md": "text/markdown; charset=utf-8", ".woff2": "font/woff2",
};

export function serveFile(res: ServerResponse, root: string, rel: string, head: boolean): boolean {
  let decoded: string;
  try {
    decoded = decodeURIComponent(rel);
  } catch {
    return false;
  }
  if (decoded.includes("\0")) return false;
  let file = resolve(root, "." + sep + decoded.replace(/^[/\\]+/, ""));
  if (file !== root && !file.startsWith(root.endsWith(sep) ? root : root + sep)) return false;
  try {
    if (statSync(file).isDirectory()) file = join(file, "index.html");
    if (!statSync(file).isFile()) return false;
  } catch {
    return false;
  }
  const body = readFileSync(file);
  res.writeHead(200, { "content-type": TYPES[extname(file).toLowerCase()] ?? "application/octet-stream", "content-length": body.length, "cache-control": "no-cache" });
  res.end(head ? undefined : body);
  return true;
}
