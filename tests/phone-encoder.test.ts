// 폰 JPEG 인코딩(capture.js createEncoder): 워커 두 개로 인코딩하고, close()하면 워커를 끝내고 기다리던 요청을 거절한다.
import { afterEach, describe, expect, it, vi } from "vitest";
import { createEncoder } from "../ui/src/phone/core/capture.js";

class FakeWorker {
  static all: FakeWorker[] = [];
  terminated = false;
  posted: unknown[] = [];
  onmessage: ((e: { data: unknown }) => void) | null = null;
  onerror: ((e: unknown) => void) | null = null;
  constructor(readonly url: URL, readonly opts: unknown) { FakeWorker.all.push(this); }
  postMessage(m: unknown) { this.posted.push(m); }
  terminate() { this.terminated = true; }
}

afterEach(() => { FakeWorker.all = []; vi.unstubAllGlobals(); });

describe("폰 JPEG 인코딩(createEncoder)", () => {
  it("close(): 워커 둘을 끝내고, 기다리던 요청과 그 뒤 요청을 거절한다", async () => {
    vi.stubGlobal("Worker", FakeWorker);
    vi.stubGlobal("OffscreenCanvas", class {});
    const enc = createEncoder();
    expect(enc.mode).toBe("worker×2");
    expect(FakeWorker.all).toHaveLength(2);
    const waiting = enc.encode(new Uint8Array(16), 2, 2, 0.5);
    expect(FakeWorker.all.flatMap((w) => w.posted)).toHaveLength(1);
    enc.close();
    expect(FakeWorker.all.map((w) => w.terminated)).toEqual([true, true]);
    await expect(waiting).rejects.toThrow("인코딩을 멈췄어요");
    await expect(enc.encode(new Uint8Array(16), 2, 2, 0.5)).rejects.toThrow("인코딩을 멈췄어요");
  });
});
