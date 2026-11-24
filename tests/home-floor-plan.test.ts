import jpeg from "jpeg-js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../src/server/app.js";
import { fetchRetry } from "../src/shared/net.js";
import { makeHome } from "./helpers/home.js";

const route = "/api/homes/mokryeon_180b/floor-plan.jpg";
const kbImage = "https://file.kbland.kr/image/kbstar/land/img/alian/kms/complex/plane/basic/objctidnfr/KBM005562/5562_10_202609114993157.jpg";
const jpegBytes = jpeg.encode({ data: Buffer.alloc(16, 255), width: 2, height: 2 }).data;
const largeDimensionJpeg = Buffer.from(jpegBytes);
const baselineFrame = largeDimensionJpeg.indexOf(Buffer.from([0xff, 0xc0]));
largeDimensionJpeg.writeUInt16BE(2500, baselineFrame + 5);
largeDimensionJpeg.writeUInt16BE(2500, baselineFrame + 7);
const upstreamJpeg = (body: ConstructorParameters<typeof Response>[0] = new Uint8Array(jpegBytes), headers: Record<string, string> = {}) =>
  new Response(body, { headers: { "content-type": "image/jpeg", ...headers } });
const fetchLocal = globalThis.fetch;
const close: (() => Promise<void>)[] = [];

afterEach(async () => {
  while (close.length) await close.pop()!();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function hub(upstream: typeof fetch) {
  vi.stubGlobal("fetch", upstream);
  const { hub, policy } = makeHome();
  const app = createApp({ hub, policy, home: { id: "oneroom", name: "원룸" }, log: () => {} });
  close.push(() => app.close());
  const { url } = await app.listen(0, "127.0.0.1");
  return (path = route, init?: RequestInit) => fetchRetry(url + path, init, { fetchImpl: fetchLocal });
}

describe("목련 KB 공개 평면도", () => {
  it("다른 집이 열린 상태에서도 정해진 KB JPEG를 수정 없이 같은 출처로 전달한다", async () => {
    const upstream = vi.fn(async () => upstreamJpeg());
    const request = await hub(upstream);
    const response = await request();
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/jpeg");
    expect(response.headers.get("content-length")).toBe(String(jpegBytes.length));
    expect(Buffer.from(await response.arrayBuffer())).toEqual(jpegBytes);
    expect(upstream).toHaveBeenCalledExactlyOnceWith(kbImage, expect.objectContaining({
      method: "GET", redirect: "error", signal: expect.any(AbortSignal),
    }));
  });

  it("다른 집, 외부 URL 쿼리, 쓰기 요청에서는 KB를 부르지 않는다", async () => {
    const upstream = vi.fn(async () => upstreamJpeg());
    const request = await hub(upstream);
    expect((await request(route.replace("mokryeon_180b", "oneroom"))).status).toBe(404);
    expect((await request(route + "?url=https://outside.example.test/anything")).status).toBe(400);
    expect((await request(route, { method: "POST" })).status).toBe(405);
    expect(upstream).not.toHaveBeenCalled();
  });

  it.each([
    ["실패한 HTTP 응답", () => new Response(null, { status: 404 })],
    ["JPEG가 아닌 Content-Type", () => new Response(new Uint8Array(jpegBytes), { headers: { "content-type": "text/html" } })],
    ["JPEG로 위장한 본문", () => upstreamJpeg("not an image")],
    ["너무 큰 해상도", () => upstreamJpeg(new Uint8Array(largeDimensionJpeg))],
    ["너무 큰 Content-Length", () => upstreamJpeg(new Uint8Array(jpegBytes), { "content-length": "1048577" })],
  ])("%s는 이미지 대신 502로 응답한다", async (_label, reply) => {
    const request = await hub(vi.fn(async () => reply()));
    const response = await request();
    expect(response.status).toBe(502);
    expect(response.headers.get("content-type")).not.toContain("image/");
  });

  it("크기 헤더가 없어도 1 MiB에서 내려받기를 멈춘다", async () => {
    const cancel = vi.fn();
    const chunk = new Uint8Array(1 << 19);
    const request = await hub(vi.fn(async () => upstreamJpeg(new ReadableStream({
      pull(controller) { controller.enqueue(chunk); },
      cancel,
    }))));
    expect((await request()).status).toBe(502);
    expect(cancel).toHaveBeenCalledOnce();
  });

  it("원본을 받는 도중 타임아웃이면 504로 응답한다", async () => {
    const timeout = new AbortController();
    const timer = vi.spyOn(AbortSignal, "timeout").mockReturnValueOnce(timeout.signal);
    const upstream = vi.fn(async (_url: Parameters<typeof fetch>[0], options?: RequestInit) =>
      upstreamJpeg(new ReadableStream({
        start(controller) {
          options?.signal?.addEventListener("abort", () => controller.error(options.signal?.reason), { once: true });
        },
        pull() { timeout.abort(new DOMException("deadline", "TimeoutError")); },
      })));
    const request = await hub(upstream);
    expect((await request()).status).toBe(504);
    expect(timer).toHaveBeenCalledWith(5_000);
  });
});
