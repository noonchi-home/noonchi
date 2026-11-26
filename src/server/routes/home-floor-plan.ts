import type { IncomingMessage, ServerResponse } from "node:http";
import jpeg from "jpeg-js";

// KB부동산 한양목련 단지(4809), 180B 기본형.
const kbFloorPlan = "https://file.kbland.kr/image/kbstar/land/img/alian/kms/complex/plane/basic/objctidnfr/KBM005562/5562_10_202609114993157.jpg";
const maxBytes = 1 << 20;
const timeoutMs = 5_000;

async function download(signal: AbortSignal): Promise<Buffer> {
  const response = await fetch(kbFloorPlan, {
    method: "GET", headers: { accept: "image/jpeg" }, redirect: "error", signal,
  });
  const mime = response.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase();
  const length = response.headers.get("content-length");
  if (response.status !== 200 || mime !== "image/jpeg" || !response.body ||
      (length !== null && (!/^\d+$/.test(length) || Number(length) < 1 || Number(length) > maxBytes))) {
    void response.body?.cancel().catch(() => {});
    throw new Error("KB 평면도 응답 형식이 잘못됐어요.");
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) throw new Error("KB 평면도 응답이 너무 커요.");
      chunks.push(value);
    }
  } catch (error) {
    void reader.cancel().catch(() => {});
    throw error;
  } finally {
    reader.releaseLock();
  }

  const bytes = Buffer.concat(chunks, size);
  const { width, height } = jpeg.decode(bytes, {
    useTArray: true, formatAsRGBA: false, tolerantDecoding: false, maxResolutionInMP: 4, maxMemoryUsageInMB: 32,
  });
  if (width < 1 || height < 1) throw new Error("KB 평면도 크기가 잘못됐어요.");
  return bytes;
}

export async function serveMokryeonFloorPlan(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
  const head = req.method === "HEAD";
  function fail(status: number, error: string) {
    res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
    res.end(head ? undefined : JSON.stringify({ ok: false, error }));
  }
  if (req.method !== "GET" && !head) {
    res.setHeader("allow", "GET, HEAD");
    fail(405, "허용되지 않은 메서드입니다.");
    return;
  }
  if (url.search) {
    fail(400, "평면도 요청에는 검색 매개변수를 쓸 수 없어요.");
    return;
  }

  const signal = AbortSignal.timeout(timeoutMs);
  let bytes: Buffer;
  try {
    bytes = await download(signal);
  } catch {
    if (signal.aborted) fail(504, "KB 평면도를 기다리는 시간이 지났어요.");
    else fail(502, "KB 평면도를 불러오지 못했어요.");
    return;
  }
  res.writeHead(200, {
    "content-type": "image/jpeg", "content-length": bytes.length,
    "cache-control": "private, max-age=300",
    "x-content-type-options": "nosniff", "cross-origin-resource-policy": "same-origin",
  });
  res.end(head ? undefined : bytes);
}
